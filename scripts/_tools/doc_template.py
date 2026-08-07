#!/usr/bin/env python3
"""doc_template.py — vorlagenbasierte Doc-Erzeugung (Ersatz fuer HTML->Headless-Chrome).

Ansatz (aus bewährten GAS-Vorlagen-Engines abgeleitet): eine AXS-gebrandete Google-Doc-VORLAGE
mit {{PLATZHALTERN}} wird kopiert, die Platzhalter werden ueber die Docs-API gefuellt und
das Ergebnis als PDF exportiert. Der Doc ist ein ZWISCHENPRODUKT (wird nach dem Export
getrasht); das PDF ist das Endprodukt.

Pilot = reine {{FELD}}-Ersetzung ueber `documents.batchUpdate` mit `replaceAllText` — die
API sucht ueber Run-Grenzen hinweg und ersetzt selbst; darum ist hier KEIN manuelles
Run-Verketten/Index-Rechnen noetig (das kommt erst mit Wiederhol-Tabellen / Anker->Tabelle).

Laeuft serverseitig (Node/Cloud Run oder lokal) ueber die googleapis-REST-Clients; die
Credentials kommen von aussen (keyless-DWD, s. _google_auth). Keine Chrome-Abhaengigkeit.
"""
import logging
import re
import time

log = logging.getLogger("rubicon.doctpl")

PDF_MIME = "application/pdf"


def _exec_retry(request, tries=6):
    """request.execute() mit Backoff bei transienten Fehlern. Retryt 429/500/503 UND das
    Drive-Rate-Limit, das als `403` mit reason `userRateLimitExceeded`/`rateLimitExceeded`
    kommt (NICHT ein echtes Permission-403). Andere Fehler sofort weiter."""
    import time, random
    from googleapiclient.errors import HttpError
    for attempt in range(tries):
        try:
            return request.execute()
        except HttpError as ex:
            status = getattr(getattr(ex, "resp", None), "status", None)
            content = getattr(ex, "content", b"") or b""
            if isinstance(content, str):
                content = content.encode("utf-8", "ignore")
            rate_403 = status == 403 and (b"userRateLimitExceeded" in content or b"rateLimitExceeded" in content)
            if (status in (429, 500, 503) or rate_403) and attempt < tries - 1:
                time.sleep(min(2 ** attempt + random.uniform(0, 1), 30))
                continue
            raise


_WRITE_TIMES = []          # monotonic-Zeitstempel der letzten Docs-batchUpdate-Aufrufe
_MAX_WRITES_PER_MIN = 55   # unter dem 60/min-Docs-Write-Limit (Puffer gegen Jitter)


def _pace_write():
    """Drosselt Docs-batchUpdate-Aufrufe proaktiv auf < 60/min (Docs-API-Write-Quota per user).
    Blockt, bis im gleitenden 60-Sekunden-Fenster wieder < _MAX_WRITES_PER_MIN Writes liegen.
    Backoff (_exec_retry) allein faengt eine DURCHGEHENDE 429-Saettigung bei grossen Laeufen
    (z.B. ~30 Briefings) nicht auf — Pacing haelt die Rate von vornherein unter dem Limit.
    Scope = PRO PROZESS: exakt richtig fuer den sequenziellen `rubicon-docs-job` (der Quota-
    Verursacher, ein Prozess). Der Web-Service rendert on-demand je in einem eigenen Python-
    Subprozess -> parallele Exporte teilen das per-user-60/min-Limit nicht koordiniert; wegen
    der geringen on-demand-Last akzeptiert (der Batch-Job ist der relevante Fall)."""
    import time
    now = time.monotonic()
    while _WRITE_TIMES and now - _WRITE_TIMES[0] >= 60.0:
        _WRITE_TIMES.pop(0)
    if len(_WRITE_TIMES) >= _MAX_WRITES_PER_MIN:
        wait = 60.0 - (now - _WRITE_TIMES[0]) + 0.05
        if wait > 0:
            time.sleep(wait)
        now = time.monotonic()
        while _WRITE_TIMES and now - _WRITE_TIMES[0] >= 60.0:
            _WRITE_TIMES.pop(0)
    _WRITE_TIMES.append(time.monotonic())


def build_replace_requests(values):
    """Pure: baut die batchUpdate-Requests fuer {{FELD}}->Wert. Ein replaceAllText je Feld
    (matchCase). None/fehlend -> leerer String (kein rohes 'None' im Dokument)."""
    requests = []
    for key, val in values.items():
        text = "" if val is None else str(val)
        requests.append({
            "replaceAllText": {
                "containsText": {"text": "{{" + key + "}}", "matchCase": True},
                "replaceText": text,
            }
        })
    return requests


# ── Modifier-Pipeline (Port aus einer bewährten Mail-Vorlagen-Engine, Gen2) ──
# Token: {{KEY}} | {{KEY:mod}} | {{KEY:mod(args)}} | {{KEY:mod1:mod2(args)}} (Ketten).
# Statt values zu iterieren wird der Dokument-TEXT gescannt (build_replace_requests_scanning)
# — so werden auch Modifier-Varianten desselben Keys getroffen und KEINE {{...}} bleiben
# unersetzt (impliziter Cleanup-Sweep). Portiert sind die DOK-relevanten Modifier; NICHT
# secret/smart_*/flight/airline (sicherheits-sensitiv bzw. domaenenspezifisch).
_TOKEN_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)((?::[A-Za-z0-9_]+(?:\([^)]*\))?)*)\s*\}\}")
_MOD_RE = re.compile(r":([A-Za-z0-9_]+)(?:\(([^)]*)\))?")


def _parse_mods(mod_str):
    """':upper:default(—)' -> [('upper', None), ('default', '—')]."""
    return [(m.group(1).lower(), m.group(2)) for m in _MOD_RE.finditer(mod_str or "")]


def _apply_one_modifier(val, mod, args, values):
    """Ein Modifier auf `val` (kann Liste/None sein). values = ganzer Kontext (fuer :or)."""
    if mod == "join":  # operiert auf der ROHEN Liste, vor der String-Koerzierung
        sep = (args or ", ").replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
        if isinstance(val, (list, tuple)):
            return sep.join("" if x is None else str(x) for x in val)
        return "" if val is None else str(val)
    raw = "" if val is None else str(val)
    s = raw.strip()
    if mod == "default":
        return s if s else (args or "")
    if mod == "or":
        if s:
            return s
        for k in (args or "").split(","):
            k = k.strip()
            if k and values.get(k) not in (None, ""):
                return str(values.get(k))
        return ""
    if mod == "if":
        parts = [p.strip() for p in (args or "").split(",")]
        then_v = parts[0] if parts else ""
        else_v = parts[1] if len(parts) > 1 else ""
        return then_v if s else else_v
    if mod in ("req", "required"):
        if not s:
            raise ValueError(f"Pflichtfeld leer (Modifier :{mod})")
        return s
    if mod == "upper":
        return raw.upper()
    if mod == "lower":
        return raw.lower()
    if mod == "trim":
        return s
    if mod == "pad":  # dNN-Padding NUR bei rein numerischem Rohwert (fuehrende Null erhalten)
        n = int(args) if (args and args.isdigit()) else 0
        return raw.zfill(n) if raw.isdigit() else raw
    return raw  # unbekannter Modifier -> unveraendert


def apply_modifiers(raw, mods, values):
    """Wendet die Modifier-Kette an; gibt finalen String. `raw` kann Liste/None sein."""
    val = raw
    for mod, args in mods:
        val = _apply_one_modifier(val, mod, args, values)
    return "" if val is None else str(val)


def _all_text(doc):
    """Gesamter Textinhalt eines Docs (Body-Paragraphen + Tabellenzellen, rekursiv) fuer das
    Token-Scanning."""
    out = []

    def walk(elements):
        for el in elements or []:
            p = el.get("paragraph")
            if p:
                for e in p.get("elements", []):
                    tr = e.get("textRun")
                    if tr:
                        out.append(tr.get("content", ""))
            t = el.get("table")
            if t:
                for row in t.get("tableRows", []):
                    for cell in row.get("tableCells", []):
                        walk(cell.get("content", []))
    walk(doc.get("body", {}).get("content", []))
    return "".join(out)


def build_replace_requests_scanning(doc_text, values, skip=None):
    """Scannt `doc_text` nach {{KEY:mods}}-Tokens, loest jedes via Modifiern und gibt
    replaceAllText-Requests (ein Request je EINZIGARTIGEM Token). Subsumiert
    build_replace_requests: plain {{KEY}} = leere Modifier-Kette = str(value); trifft aber
    zusaetzlich Modifier-Tokens und laesst keine {{...}} unersetzt (impliziter Cleanup).
    `skip` = Menge von Token-Texten, die UNANGETASTET bleiben (Tabellen-/Bullet-Anker!) —
    sonst wischt der Scan die Anker weg, bevor insert_table/insert_bullets sie findet."""
    skip = skip or set()
    seen = {}
    for m in _TOKEN_RE.finditer(doc_text):
        token = m.group(0)
        if token in seen or token in skip:
            continue
        key, mod_str = m.group(1), m.group(2)
        seen[token] = apply_modifiers(values.get(key), _parse_mods(mod_str), values)
    return [{"replaceAllText": {"containsText": {"text": t, "matchCase": True},
                                "replaceText": v}} for t, v in seen.items()]


# ── Anker -> Tabelle (Wiederhol-Gruppen, z.B. Traktanden-Agenda) ─────────────
# Docs-API kann keine dynamischen Zeilen per replaceAllText — darum: leere Tabelle an
# der Anker-Position einfuegen, Doc neu holen (Indizes verschieben sich), Zellen ABSTEIGEND
# nach Index fuellen (spaetere Inserts verschieben fruehere nicht). Bewährtes Muster aus einer
# vergleichbaren Doc-Vorlagen-Engine.

def _paragraph_text(el):
    """Text eines Paragraph-StructuralElements (alle textRuns verkettet)."""
    parts = []
    for e in (el.get("paragraph", {}).get("elements") or []):
        tr = e.get("textRun")
        if tr:
            parts.append(tr.get("content", ""))
    return "".join(parts)


def _find_anchor_index(doc, anchor):
    """Start-Index des Paragraphen, der den Anker-Text enthaelt (oder None)."""
    for el in doc.get("body", {}).get("content", []):
        if "paragraph" in el and anchor in _paragraph_text(el):
            return el.get("startIndex")
    return None


def _find_table_at(doc, min_index):
    """Erstes Tabellen-StructuralElement mit startIndex >= min_index (die eben eingefuegte)."""
    for el in doc.get("body", {}).get("content", []):
        if "table" in el and el.get("startIndex", -1) >= min_index:
            return el
    return None


def _rev(doc):
    """revisionId eines documents.get-Resultats (fuer writeControl.requiredRevisionId)."""
    return doc.get("revisionId")


def _batch(docs, doc_id, requests, revision_id=None):
    """batchUpdate; mit `revision_id` -> writeControl.requiredRevisionId-Riegel: schreibt NUR,
    wenn der Doc-Kopf noch bei dieser Revision steht. Fuer NICHT-idempotente Ops (insertTable/
    insertText) — ein stale-Retry scheitert dann hart (400) statt Inhalte zu verdoppeln
    (Lektion aus einer vergleichbaren Doc-Vorlagen-Engine). Idempotente Ops (replaceAllText/Styling) ohne Riegel.
    Zentrale Route ALLER Docs-batchUpdates -> `_pace_write` drosselt hier die 60/min-Write-Quota."""
    body = {"requests": requests}
    if revision_id:
        body["writeControl"] = {"requiredRevisionId": revision_id}
    _pace_write()
    return _exec_retry(docs.documents().batchUpdate(documentId=doc_id, body=body))


def _build_grid(header, rows):
    """Pure: baut das Zell-Raster [header] + Datenzeilen und erkennt Gruppen-Bandzeilen.
    Ein `rows`-Eintrag ist ENTWEDER eine Liste (normale Datenzeile) ODER ein dict
    {"group": label, "bg": rgb?, "text_rgb": rgb?} — dann wird das Label in Spalte 0
    gesetzt, der Rest leer, und die Zeile als Gruppen-Band markiert (z.B. Kadenz-Trenner).
    Gibt (grid, group_rows) zurueck; group_rows = {grid_zeilen_index: {"bg","text_rgb"}}."""
    n_cols = len(header)
    grid = [list(header)]
    group_rows = {}
    for r in rows:
        if isinstance(r, dict) and "group" in r:
            grid.append([str(r["group"])] + [""] * (n_cols - 1))
            group_rows[len(grid) - 1] = {"bg": r.get("bg"), "text_rgb": r.get("text_rgb")}
        else:
            grid.append([("" if c is None else str(c)) for c in r])
    return grid, group_rows


def _cell_bg_request(table_start, row_index, n_cols, bg):
    """updateTableCellStyle-Request: ganze Zeile `row_index` mit `bg` hinterlegen."""
    return {"updateTableCellStyle": {
        "tableRange": {"tableCellLocation": {"tableStartLocation": {"index": table_start},
                                             "rowIndex": row_index, "columnIndex": 0},
                       "rowSpan": 1, "columnSpan": n_cols},
        "tableCellStyle": {"backgroundColor": {"color": {"rgbColor": bg}}},
        "fields": "backgroundColor",
    }}


def _cell_text_style_requests(cell, text_style, fields):
    """updateTextStyle-Requests fuer allen Text einer Zelle (alle Paragraphen)."""
    reqs = []
    for para in cell.get("content", []):
        if "paragraph" not in para:
            continue
        s, e = para.get("startIndex"), para.get("endIndex")
        if s is None or e is None or e - s < 1:
            continue
        reqs.append({"updateTextStyle": {"range": {"startIndex": s, "endIndex": e},
                                         "textStyle": text_style, "fields": fields}})
    return reqs


def insert_table_at_anchor(docs, doc_id, anchor, header, rows, col_widths_pt=None,
                           header_bg=None, header_text_rgb=None, remove_anchor=True):
    """Ersetzt den Anker `{{...}}` durch eine echte Docs-Tabelle: erste Zeile = header,
    danach je Eintrag eine Datenzeile. rows = Liste; ein Eintrag ist eine Liste (Zellen
    als Strings) ODER ein dict {"group": label, "bg": rgb?, "text_rgb": rgb?} fuer eine
    Gruppen-Bandzeile (Kadenz-Trenner o.ae.): Label in Spalte 0 fett, ganze Zeile mit bg.
    col_widths_pt: optionale feste Spaltenbreiten in PT (sonst blaeht Docs die Tabelle,
    bekannter Fallstrick). header_bg: optionale rgbColor-dict fuer die Kopfzeile.
    header_text_rgb: optionale rgbColor-dict fuer den Kopftext; default WEISS wenn ein
    header_bg gesetzt ist (dunkler Grund -> heller Text, sonst schwarz auf navy = unlesbar)."""
    grid, group_rows = _build_grid(header, rows)
    n_rows, n_cols = len(grid), len(header)

    doc = docs.documents().get(documentId=doc_id).execute()
    rev0 = _rev(doc)
    idx = _find_anchor_index(doc, anchor)
    if idx is None:
        raise ValueError(f"Anker {anchor} nicht im Dokument gefunden")

    # 1. Leere Tabelle VOR dem Anker-Paragraphen einfuegen (nicht-idempotent -> Riegel).
    _batch(docs, doc_id, [
        {"insertTable": {"location": {"index": idx}, "rows": n_rows, "columns": n_cols}}
    ], rev0)

    # 2. Neu holen: Tabellen-Start + Zellen-Start-Indizes der frisch eingefuegten Tabelle.
    doc = docs.documents().get(documentId=doc_id).execute()
    rev1 = _rev(doc)
    table_el = _find_table_at(doc, idx)
    if table_el is None:
        raise ValueError("eingefuegte Tabelle nicht wiedergefunden")
    table_start = table_el["startIndex"]

    # 3. Zellen ABSTEIGEND nach Index fuellen (Kern-Invariant: sonst verschieben fruehe Inserts
    #    die spaeteren Positionen) + das STRUKTURELLE Styling (Spaltenbreiten/Kopf-/Gruppen-
    #    Hintergrund) im SELBEN rev1-Batch. insertText ist NICHT idempotent -> Riegel rev1; der
    #    Riegel MUSS direkt auf den rev1-get folgen (kein Write dazwischen). Die Style-Requests
    #    adressieren die Tabelle strukturell (tableStartLocation/rowIndex/columnIndex) und sind
    #    gegen die in-Batch-Textinserts stabil (die Inserts liegen INNERHALB der Zellen, hinter
    #    table_start) -> kein separater Round-Trip noetig. Das INDEXabhaengige Text-Styling (3b)
    #    laeuft danach nach einem frischen get.
    inserts = []  # (index, text)
    for r, trow in enumerate(table_el["table"]["tableRows"]):
        for c, cell in enumerate(trow["tableCells"]):
            text = grid[r][c]
            if text:
                # content[0] = erster Paragraph der Zelle; dort ab startIndex einfuegen.
                inserts.append((cell["content"][0]["startIndex"], text))
    inserts.sort(key=lambda x: x[0], reverse=True)
    fill_and_style = [{"insertText": {"location": {"index": i}, "text": t}} for i, t in inserts]
    for ci, w in enumerate(col_widths_pt or []):
        fill_and_style.append({"updateTableColumnProperties": {
            "tableStartLocation": {"index": table_start}, "columnIndices": [ci],
            "tableColumnProperties": {"widthType": "FIXED_WIDTH", "width": {"magnitude": w, "unit": "PT"}},
            "fields": "widthType,width",
        }})
    if header_bg:
        fill_and_style.append(_cell_bg_request(table_start, 0, n_cols, header_bg))
    for ri, meta in group_rows.items():
        if meta["bg"]:
            fill_and_style.append(_cell_bg_request(table_start, ri, n_cols, meta["bg"]))
    if fill_and_style:
        _batch(docs, doc_id, fill_and_style, rev1)

    # 3b. Text-Styling (Kopf weiss+fett auf header_bg; Gruppen-Label fett+farbig). Erst JETZT
    #     moeglich, weil der Zelltext eben erst eingefuegt wurde; Styling verschiebt keine
    #     Indizes, darum ein frisches get.
    hdr_rgb = header_text_rgb or ({"red": 1, "green": 1, "blue": 1} if header_bg else None)
    if hdr_rgb is not None or group_rows:
        doc = docs.documents().get(documentId=doc_id).execute()
        table_el = _find_table_at(doc, idx)
        text_reqs = []
        if table_el is not None:
            trows = table_el["table"]["tableRows"]
            if hdr_rgb is not None:
                for cell in trows[0]["tableCells"]:
                    text_reqs += _cell_text_style_requests(
                        cell, {"bold": True, "foregroundColor": {"color": {"rgbColor": hdr_rgb}}},
                        "bold,foregroundColor")
            for ri, meta in group_rows.items():
                if ri >= len(trows):
                    continue
                ts = {"bold": True}
                fields = "bold"
                if meta["text_rgb"]:
                    ts["foregroundColor"] = {"color": {"rgbColor": meta["text_rgb"]}}
                    fields = "bold,foregroundColor"
                text_reqs += _cell_text_style_requests(trows[ri]["tableCells"][0], ts, fields)
        if text_reqs:
            _batch(docs, doc_id, text_reqs)

    # 4. Anker-Text entfernen (die Tabelle steht jetzt davor). Der Treiber (_copy_fill_export)
    #    buendelt alle Anker in EINEM Sweep am Ende (remove_anchor=False); ein Standalone-Aufruf
    #    raeumt selbst auf.
    if remove_anchor:
        _batch(docs, doc_id, [
            {"replaceAllText": {"containsText": {"text": anchor, "matchCase": True}, "replaceText": ""}}
        ])
    log.info("table inserted anchor=%s rows=%d cols=%d groups=%d doc_id=%s",
             anchor, n_rows, n_cols, len(group_rows), doc_id)


def insert_bullets_at_anchor(docs, doc_id, anchor, items, ordered=False, remove_anchor=True):
    """Ersetzt den Anker `{{...}}` durch eine Bullet-/Nummern-Liste (ein Punkt je item).
    Docs kann Listen nicht per replaceAllText erzeugen -> Text mit \\n an der Anker-Position
    einfuegen, dann `createParagraphBullets` ueber den eingefuegten Bereich. Beides laeuft in
    EINEM batchUpdate: die Requests eines Batches wirken sequenziell, darum sieht das
    createParagraphBullets ueber [idx, idx+len(text)) den insertText schon — ein Round-Trip
    statt zwei, weniger Docs-Write-Quota-Last (60/min).
    `remove_anchor=True` haengt den Anker-Cleanup (idempotent, textbasiert) an denselben Batch;
    der Treiber (_copy_fill_export) setzt False und wischt alle Anker gebuendelt am Ende.
    Leere/keine items -> nur Anker entfernen (kein leerer Listenpunkt)."""
    items = [str(x) for x in (items or []) if str(x).strip()]
    remove_req = {"replaceAllText": {"containsText": {"text": anchor, "matchCase": True},
                                     "replaceText": ""}}
    if not items:
        if remove_anchor:
            _batch(docs, doc_id, [remove_req])
        return

    doc = docs.documents().get(documentId=doc_id).execute()
    rev = _rev(doc)
    idx = _find_anchor_index(doc, anchor)
    if idx is None:
        raise ValueError(f"Anker {anchor} nicht im Dokument gefunden")

    text = "\n".join(items) + "\n"
    preset = "NUMBERED_DECIMAL_ALPHA_ROMAN" if ordered else "BULLET_DISC_CIRCLE_SQUARE"
    # Ein Batch (rev-Riegel, weil insertText NICHT idempotent ist -> stale-Retry scheitert statt
    # doppelt zu bulleten): erst den Text einfuegen, dann die eben eingefuegten Paragraphen
    # [idx, idx+len(text)) bulleten, optional den Anker entfernen. Alles sequenziell im Batch.
    reqs = [
        {"insertText": {"location": {"index": idx}, "text": text}},
        {"createParagraphBullets": {"range": {"startIndex": idx, "endIndex": idx + len(text)},
                                     "bulletPreset": preset}},
    ]
    if remove_anchor:
        reqs.append(remove_req)
    _batch(docs, doc_id, reqs, rev)
    log.info("bullets inserted anchor=%s n=%d ordered=%s doc_id=%s", anchor, len(items), ordered, doc_id)


def insert_bullets_at_anchors(docs, doc_id, specs, remove_anchor=False):
    """Fuegt MEHRERE Bullet-Listen an ihren Ankern in EINEM batchUpdate ein (statt je Anker einem)
    — deutlich weniger Docs-Writes bei bullet-lastigen Docs (z.B. Briefings mit 3 Ankern:
    Leistung/Vorgehen/Risiken). `specs` = {anchor: {"items":[...], "ordered":bool}} ODER
    {anchor: [items]}. EIN `get` -> alle Anker-Indizes; die (insertText+createParagraphBullets)-
    Paare werden ABSTEIGEND nach Anker-Index in einen rev-gelockten Batch gelegt: hoehere Indizes
    zuerst -> ein spaeterer (niedrigerer) insertText verschiebt die bereits erledigten hoeheren
    Positionen nicht, und jede Bullet-Range [idx, idx+len(text)) trifft den eben eingefuegten Text.
    Leere/fehlende Anker werden uebersprungen (der Treiber-Sweep raeumt sie). remove_anchor=True
    haengt je Anker den Cleanup an denselben Batch; der Treiber setzt False (gebuendelter Sweep)."""
    if not specs:
        return
    doc = docs.documents().get(documentId=doc_id).execute()
    rev = _rev(doc)
    entries = []  # (idx, anchor, text, ordered)
    for anchor, spec in specs.items():
        items = spec.get("items") if isinstance(spec, dict) else spec
        ordered = spec.get("ordered", False) if isinstance(spec, dict) else False
        items = [str(x) for x in (items or []) if str(x).strip()]
        if not items:
            continue
        idx = _find_anchor_index(doc, anchor)
        if idx is None:
            raise ValueError(f"Anker {anchor} nicht im Dokument gefunden")
        entries.append((idx, anchor, "\n".join(items) + "\n", ordered))
    if not entries:
        return
    entries.sort(key=lambda e: e[0], reverse=True)   # absteigend: hoechster Index zuerst
    reqs = []
    for idx, anchor, text, ordered in entries:
        preset = "NUMBERED_DECIMAL_ALPHA_ROMAN" if ordered else "BULLET_DISC_CIRCLE_SQUARE"
        reqs.append({"insertText": {"location": {"index": idx}, "text": text}})
        reqs.append({"createParagraphBullets": {"range": {"startIndex": idx, "endIndex": idx + len(text)},
                                                 "bulletPreset": preset}})
        if remove_anchor:
            reqs.append({"replaceAllText": {"containsText": {"text": anchor, "matchCase": True},
                                            "replaceText": ""}})
    _batch(docs, doc_id, reqs, rev)
    log.info("bullets(multi) inserted anchors=%d doc_id=%s", len(entries), doc_id)


def _copy_fill_export(drive, docs, template_id, folder_id, name, values, tables, bullets):
    """copy Vorlage -> {{...}} scannend fuellen -> Tabellen/Bullets -> PDF exportieren+validieren.
    Gibt (doc_id, pdf_bytes) zurueck; trasht NICHT."""
    # 1. Vorlage in den Zielordner kopieren (Shared-Drive-tauglich).
    copy = _exec_retry(drive.files().copy(
        fileId=template_id,
        body={"name": name, "parents": [folder_id]},
        supportsAllDrives=True, fields="id",
    ))
    doc_id = copy["id"]
    log.info("template copied doc_id=%s from=%s", doc_id, template_id)
    # Alles NACH dem Copy in EINEN try/except: jede Post-Copy-Exception (get/batchUpdate/
    # insert_table/insert_bullets/export/Nicht-PDF-Validierung) traegt danach `doc_id`, damit
    # der Aufrufer (render_pdf_from_template) das Zwischen-Doc IMMER trashen kann — nicht nur
    # im Nicht-PDF-Sonderfall (sonst Leak bei echten API-Fehlern wie 429/500).
    try:
        # 2. Platzhalter fuellen: Doc-Text scannen -> {{KEY:mods}} via Modifier-Pipeline aufloesen
        #    (subsumiert plain {{KEY}}, trifft Modifier-Varianten, laesst keine {{...}} zurueck).
        #    replaceAllText ist idempotent -> kein requiredRevisionId noetig. Tabellen-/Bullet-Anker
        #    AUSNEHMEN, sonst wischt der Scan sie weg, bevor insert_table/insert_bullets sie findet.
        anchors = set(tables or {}) | set(bullets or {})
        doc = docs.documents().get(documentId=doc_id).execute()
        requests = build_replace_requests_scanning(_all_text(doc), values, skip=anchors)
        if requests:
            _batch(docs, doc_id, requests)
        # 2b. Anker->Tabellen (Wiederhol-Gruppen, z.B. Traktanden-Agenda) einfuegen.
        # spec = {"header":[...], "rows":[[...]], "col_widths_pt":[...]?, "header_bg":{...}?}
        for anchor, spec in (tables or {}).items():
            insert_table_at_anchor(docs, doc_id, anchor, spec["header"], spec["rows"],
                                   col_widths_pt=spec.get("col_widths_pt"),
                                   header_bg=spec.get("header_bg"),
                                   header_text_rgb=spec.get("header_text_rgb"),
                                   remove_anchor=False)
        # 2c. Anker->Bullet-Listen (z.B. Briefing-Deliverables, FR-Grundsaetze) — ALLE Anker
        #     dieses Docs in EINEM batchUpdate (Multi-Bullet), statt je Anker einem Round-Trip.
        insert_bullets_at_anchors(docs, doc_id, bullets or {}, remove_anchor=False)
        # 2d. Alle Anker in EINEM batchUpdate entfernen statt je Tabelle/Liste einzeln —
        #     replaceAllText ist idempotent + textbasiert, darum Reihenfolge egal und
        #     buendelbar. Spart je Anker einen Round-Trip -> weniger Docs-Write-Quota-Last.
        if anchors:
            _batch(docs, doc_id, [
                {"replaceAllText": {"containsText": {"text": a, "matchCase": True}, "replaceText": ""}}
                for a in sorted(anchors)
            ])
        # 3. PDF exportieren + validieren.
        data = _exec_retry(drive.files().export(fileId=doc_id, mimeType=PDF_MIME))
        pdf = bytes(data) if not isinstance(data, (bytes, bytearray)) else bytes(data)
        if pdf[:4] != b"%PDF":
            raise ValueError(f"export lieferte kein PDF (doc_id={doc_id}, head={pdf[:8]!r})")
        return doc_id, pdf
    except Exception as e:
        e.doc_id = doc_id  # dem Aufrufer (render_pdf_from_template) das Cleanup-Ziel mitgeben,
        raise             # auch wenn die (doc_id, pdf)-Rueckgabe wegen des raise ausbleibt.


def render_pdf_from_template(drive, docs, template_id, folder_id, name, values,
                             tables=None, bullets=None, cleanup=True):
    """Vorlage kopieren -> {{Platzhalter}} fuellen -> optionale Anker->Tabellen/Bullets
    einfuegen -> als PDF exportieren -> Zwischen-Doc trashen. Gibt die PDF-Bytes zurueck.
    tables:  dict {anker: {"header":[...], "rows":[...], "col_widths_pt":[...]?, "header_bg":{...}?}}.
    bullets: dict {anker: [items]} ODER {anker: {"items":[...], "ordered":bool}}."""
    _t0 = time.monotonic()
    doc_id = None
    try:
        doc_id, pdf = _copy_fill_export(drive, docs, template_id, folder_id, name, values, tables, bullets)
        log.info("template rendered doc_id=%s bytes=%d total_ms=%d",
                 doc_id, len(pdf), int((time.monotonic() - _t0) * 1000))
        return pdf
    except Exception as ex:
        # _copy_fill_export kann VOR der (doc_id, pdf)-Rueckgabe werfen (z.B. Nicht-PDF-Export);
        # dann traegt die Exception die doc_id (s.o.), damit das Cleanup unten trotzdem greift.
        doc_id = getattr(ex, "doc_id", doc_id)
        raise
    finally:
        # 4. Zwischen-Doc immer wegraeumen (auch bei Fehler) — nur das PDF ist das Endprodukt.
        if cleanup and doc_id is not None:
            try:
                drive.files().delete(fileId=doc_id, supportsAllDrives=True).execute()
            except Exception as ex:  # noqa: BLE001 — Cleanup-Fehler darf das PDF nicht kippen
                log.warning("cleanup delete doc_id=%s fehlgeschlagen: %s", doc_id, ex)


def render_doc_and_pdf(drive, docs, template_id, folder_id, name, values, tables=None, bullets=None):
    """Wie render_pdf_from_template, aber das gebrandete Doc BLEIBT (Weg-1-Endprodukt)."""
    doc_id, pdf = _copy_fill_export(drive, docs, template_id, folder_id, name, values, tables, bullets)
    log.info("doc rendered+kept doc_id=%s bytes=%d", doc_id, len(pdf))
    return doc_id, pdf
