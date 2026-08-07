# RUBICON Template-Engine — Übernahme-Leitfaden aus dem Monorepo

> **Zweck:** Konkrete, code-nahe Anleitung, welche Bausteine aus dem GAPPS-Monorepo als nächstes in
> `rubicon-dst/scripts/_tools/doc_template.py` einfließen sollten. Grundlage: geschürfte Bausteine aus
> catering_nxt, gmail_dedup, inform_flights, serienbrief_addon, read_and_sign, Aeropoint/form-sender/
> proforma und dem Gemini-v1-Vorfahr. Jede Empfehlung nennt die **beste Quelle** (dedupliziert),
> ein **wörtliches Quell-Snippet** und die **Docs-REST-/Python-Adaption** gegen die real vorhandenen
> Funktionen von `doc_template.py`.

## Stand von `doc_template.py` heute (verifiziert am Code)

- `build_replace_requests(values)` → ein `replaceAllText` je `{{FELD}}` (matchCase, `None`→`""`). API sucht über Run-Grenzen selbst — **kein** manuelles Run-Verketten nötig.
- `insert_table_at_anchor(...)` → Anker→echte Docs-Tabelle mit Gruppen-Bandzeilen (`{"group":...}`), festen Spaltenbreiten (PT), navy Kopf (weiß/fett), **absteigend nach Index gefüllt** (Kern-Invariante bereits vorhanden).
- `insert_bullets_at_anchor(...)` → Anker→Bullet/Numbered-Liste; leere Liste = nur Anker weg.
- `render_pdf_from_template(...)` → `drive.files().copy` → `batchUpdate` → optional Tabellen/Bullets → `drive.files().export(pdf)` → **Doc immer getrasht** (`finally`, cleanup-Fehler kippt das PDF nicht).

**Was fehlt und lohnt:** (1) eine Wert-**Modifier-Pipeline** vor `replaceAllText`, (2) ein **Cleanup-Sweep** für unersetzte `{{…}}`, (3) eine **Idempotenz-/Hash-Gate-Schicht** (skip-if-unchanged), (4) **race-/retry-sichere** Wiederhol-Läufe (`requiredRevisionId`, strikt-älter-Cleanup, deterministischer Gewinner), (5) **Occurrence-indexierte** Ersetzung für N Werte desselben Keys in einem Doc, (6) eine **Changeset-Diff-Engine** (neu/entfallen seit letztem Render), (7) **datengetriebene Zellfarben**, (8) diverse **kleine Utilities** (Safe-Filename, ID-aus-URL, Hex-Normalisierung, aggregate-then-format) und (9) betriebliche Extras (PNG-Preview, persistenter Living-Doc, Header-Map, Fan-out + 429-Retry, strukturiertes redigiertes Error-Logging).

---

## (a) TL;DR — was RUBICON als Nächstes übernehmen soll

**Sofort (direct, kleiner Aufwand, sofort Wert):**

1. **Modifier-Pipeline `{{KEY:mod1:mod2}}`** vor `build_replace_requests`. Beste Quelle: **gmail_dedup/templateHelper.js (Gen2)** — reichste, unter echten Anforderungen gewachsene Engine (`default`/`or`/`if`/`req`/`join`/`secret` + Raw-Passthrough). Als reines `dict[str, Callable]` + Regex 1:1 nach Python. Größter direkt übertragbarer Netto-Gewinn.
2. **Cleanup-Sweep** nach der Ersetzung: `documents.get` → Rest-`{{…}}` per einem literalen/Regex-`replaceAllText` auf Default ziehen. Quelle: serienbrief_addon / Aeropoint. Billigstes Sicherheitsnetz gegen sichtbaren Platzhalter-Müll im PDF.
3. **Kleine Utilities**: `generateSafeFilename`, `extractIdFromUrl` (bewährt über 3 Projekte), Hex-Farb-Normalisierung, Zero-Pad-nur-bei-numerisch, aggregate-then-format. Quelle: Aeropoint/proforma/catering_nxt.

**Als Nächstes (adapt, hoher Wert für Batch-Läufe):**

4. **Idempotenz-/Hash-Gate**: `docNextStatus` + kanonischer, reihenfolge-invarianter `docHashInput` + SHA-Digest. Quelle: **catering_nxt/docBatchLogic.js + docRenderLogic.js**. Voraussetzung: RUBICON persistiert je Ziel (status, hash) in einer kleinen JSON/SQLite-Registry. Verhindert unnötige Docs-API-Calls bei periodischer Regeneration.
5. **Retry-/Race-Sicherheit**: `writeControl.requiredRevisionId` um jeden nicht-idempotenten `batchUpdate` (AGENTS-Lektion), `idsToTrashSupersededBy` (nur strikt-älter trashen), `pickFolderWinner` (deterministischer Gewinner ohne Koordination). Quelle: catering_nxt.
6. **Idempotente Regeneration** (staleness-window skip / overwrite-by-name) + optional **persistenter Living-Doc** (create-or-update statt copy-and-trash). Quelle: Aeropoint / rubicon_v1.

**Wenn RUBICON je N gleichartige Karten/Etiketten aus 1 Item-Template rendert:** Occurrence-indexierte Ersetzung, Batch-Bündelung mit `{{PAGE}}`-Reset, 2-Spalten-Grid mit Gruppenband, Changeset-Diff, Vorrats-Dokument-Muster (belegte 1,9–3× Beschleunigung). Quelle: catering_nxt.

**Nicht portieren:** string-regex `{{#IF_X}}…{{/IF_X}}`-Conditional-DSL (inform_flights/serienbrief) — passt **nicht** ins Docs-REST-Modell. Bedingte Abschnitte im Doc gehören über **Anker-Paar + `deleteContentRange`** gelöst (Aeropoint-Muster), nicht per String-Manipulation. Details in Abschnitt (d).

---

## (b) Baustein-Tabelle (dedupliziert, rangiert)

| # | Baustein | Beste Quelle | Kategorie | RUBICON-Nutzen | Einstufung |
|---|----------|--------------|-----------|----------------|------------|
| 1 | Modifier-Pipeline `{{KEY:mod1:mod2}}` (upper/lower/trim/default/or/if/req/join/secret + `dNN`-Padding) | gmail_dedup/templateHelper.js (Gen2) | modifier/placeholder | Formatierung ohne Vorformatierung; Fallback-Ketten, Pflichtfeld-Guard | **adapt** (direkt portierbar) |
| 2 | Modifier-aware Missing-Value-Dispatch (kein Modifier+leer → sofort raus; mit Modifier → Chance geben) | gmail_dedup/templateHelper.js | operator | Macht `:default`/`:req` überhaupt sinnvoll | **direct** |
| 3 | Raw-Type-Passthrough vor String-Koerzierung (Array/Object für `:join`/`:asjson`) | gmail_dedup/templateHelper.js | modifier | Datentyp bis zum Modifier erhalten (keine `[object Object]`/`str(list)`) | **direct** |
| 4 | Unersetzte-Platzhalter-Cleanup-Sweep (Rest-`{{…}}` → Default) | serienbrief_addon / Aeropoint | placeholder | Kein sichtbarer Platzhalter-Müll im PDF | **direct** |
| 5 | `docNextStatus`/`docHashInput`/`batchSourceDigest` — Hash-Gate Skip-Automat | catering_nxt/docBatchLogic.js | idempotency | Skip-wenn-unverändert bei Regeneration; spart Docs-API-Calls | **direct** (Logik) / **adapt** (Persistenz) |
| 6 | `writeControl.requiredRevisionId` — Retry-Riegel für nicht-idempotenten batchUpdate | catering_nxt/AGENTS.md §10 | retry | Zweiter Retry scheitert hart statt fertige Inhalte zu löschen | **direct** |
| 7 | `idsToTrashSupersededBy` — nur strikt-ältere Duplikate trashen | catering_nxt/docFolderLogic.js | idempotency | Parallel-Renders annihilieren sich nicht | **direct** |
| 8 | `pickFolderWinner` — deterministischer Gewinner ohne Koordination | catering_nxt/docFolderLogic.js | idempotency | Race-sichere Konvergenz nach parallelem `copy` | **direct** |
| 9 | Idempotente Regeneration: staleness-window (24h skip/trash+recreate) & overwrite-by-name | Aeropoint/conductos/proforma | idempotency | Nicht bei jedem Lauf alles neu, keine „Copy of X (1)"-Ansammlung | **adapt** |
| 10 | Occurrence-indexierte Ersetzung + absteigende Sortier-Invariante | catering_nxt/docRenderLogic.js | operator | N verschiedene Werte für denselben Key in EINEM Doc | **adapt** |
| 11 | `generateSafeFilename` — dateisystemsicherer, deterministischer Name | Aeropoint | other | PDF-Export-Namen aus Entität/Zeit statt hartcodiert | **direct** |
| 12 | `extractIdFromUrl` — ID aus roher ID ODER Drive-URL | form-sender/serienbrief/proforma (3×) | other | Config-Zellen mal URL, mal ID | **direct** |
| 13 | Hex-Farb-Normalisierung (3→6-stellig, `#`-Guard, invalid→"") | catering_nxt/docTemplateLogic.js | other | Farbfelder aus benutzergepflegten Stammdaten | **direct** |
| 14 | Zero-Pad nur bei rein numerischem Rohwert (`_slipRefCode`) | catering_nxt/docTemplateLogic.js | other | Führende-Null-Rekonstruktion ohne Fremdformate zu verstümmeln | **direct** |
| 15 | Aggregate-then-format (Zahl akkumulieren, erst am Ende `f"{x:.2f}"`) | proforma/Code.js | other | Keine Rundungsfehler durch String-Rückparsen in Tabellenschleifen | **adapt** |
| 16 | Datengetriebene Zell-Hintergrundfarbe (`colorCells [{r,c,hex}]`) | catering_nxt/docRenderLogic.js | styling | Body-Zellen datengetrieben einfärben (Status-Ampel), nicht nur navy Kopf | **adapt** |
| 17 | `_slip2colGrid` — 2-Spalten-Grid mit gruppenbewusstem Zeilenumbruch | catering_nxt/docModel.js | table | Etikettenbogen-Layout, harte Gruppenbänder | **direct** (pure fn) |
| 18 | `batchCards`/`batchSlipPages` — N Modelle bündeln, `{{PAGE}}`-Reset je Quelle | catering_nxt/docBatchLogic.js | batching | N Records → 1 Sammel-PDF, 1 batchUpdate statt N Zyklen | **direct** |
| 19 | `docChangesetDiff` — Multimengen-Diff (changed vs. obsolete) | catering_nxt/docChangesetLogic.js | other | „Was ist neu/entfallen seit letztem Render" | **direct** (net-new) |
| 20 | Vorrats-Dokument-Muster (Blanko-Buckets + Fingerprint-Freshness + Registry-Wahl) | catering_nxt (DocRenderer/docModel) | caching | 1,9–3× für „N gleiche Karten aus 1 Template" | **adapt** |
| 21 | Dot-Path nested resolution + `_flattenApiResponseData` + `Response.`-Prefix | gmail_dedup | placeholder/other | Platzhalter gegen verschachteltes API-Objekt; Kollisionsschutz | **direct** |
| 22 | Zwei-Pass fixe Meta-Platzhalter (`{YYYY}` etc.) aus EINER Zeitzonen-Stelle | gmail_dedup/templateHelper.js | placeholder | `{{HEUTE}}`/`{{JJJJMMTT}}` konsistent, nicht pro Record dupliziert | **adapt** |
| 23 | `getHeaderMap` — namensbasiertes Spalten-Lookup | read_and_sign_v3/sheetsHelper.js | other | Mail-Merge robust gegen Spalten-Reorder | **adapt** |
| 24 | `withTrace` — redigiertes strukturiertes Fehler-Envelope (JSON, kein PII) | read_and_sign_v3/tracing.js | other | Cloud-Logging-filterbare Fehler um batchUpdate/export | **adapt** |
| 25 | PDF-Seite-1→PNG-Preview (PyMuPDF) | rubicon_v1/gen_pdf_previews.py | image | Karten-/Modal-Vorschau (Chrome rendert PDF-iframes schwarz) | **adapt** |
| 26 | Persistenter Living-Doc via persistierter Doc-ID (create-or-update) | rubicon_v1/gen_traktanden_docs.py | idempotency | Dauerhaft einsehbare, sich selbst aktualisierende Docs | **adapt** |
| 27 | Doc-Inhalt zurücklesen via `drive.files().export(text/markdown)` | rubicon_v1/import_gemini_doc.py | other | Befülltes Template validieren / externe Docs importieren | **adapt** |
| 28 | Fan-out (`ThreadPoolExecutor`, Fehler sammeln) + 429-Retry für Docs-Pfad | rubicon_v1 + md_to_gdoc.py | batching/retry | Viele Einzel-Renders in einem Lauf, ohne bei 1 Fehler zu kippen | **adapt** |
| 29 | Quota-Preflight (alles-oder-nichts vor Versand) | read_and_sign | batching | Budget vorab prüfen, Teil-Batch vermeiden | **adapt** |
| 30 | Column-Patterns Mini-DSL (`Header={tpl}\|Header={tpl}`) | LDM_Parser/gmail_dedup | table | Config-Zeile definiert n Spalten-Templates | **adapt** (nischig) |
| 31 | Optionaler Cross-File-Override-Hook (typeof-Guard/Plugin) | gmail_dedup/informFlightsResolve.js | other | Domänen-Sonderfälle einklinken ohne Engine-Kern zu ändern | **adapt** (Architektur) |
| — | Run-Verkettung/`docsTokenRanges` (Formatwechsel-Splitting) | catering_nxt/docRenderLogic.js | operator | `replaceAllText` löst das serverseitig | **skip-already-have** |
| — | Tabellenzeile klonen für N Datensätze; simple `{{Key}}`-Loop | Aeropoint/proforma | loop/placeholder | `insert_table_at_anchor`/`build_replace_requests` sind Superset | **skip-already-have** |
| — | `split_bold` gemischte Bold/Italic-Runs; 429-Backoff | rubicon-dst/md_to_gdoc.py | styling/retry | Existiert im Repo (nur nicht im Anker-Pfad) | **skip-already-have** |
| — | `{{#IF_X}}…{{/IF_X}}` string-Conditional (+Fixpoint-Loop, AND/OR) | inform_flights/serienbrief | conditional | String-Modell, kein Docs-REST-Äquivalent | **skip** (siehe (d)) |
| — | Regex-Escaping vor `replaceText`; Regex-Compile-Cache | serienbrief/gmail_dedup | escaping/caching | GAS-Footgun; `containsText`=literal | **skip** |
| — | Smart-Date-Inferenz, Reminder-Kadenz, BCC/sendEmail-Wrapper | LDM/read_and_sign | other | Domänen-/Email-spezifisch, außerhalb Doc/PDF-Scope | **skip** |

---

## (c) Übernahmewerte Bausteine im Detail

### 1 · Modifier-Pipeline `{{KEY:mod1:mod2}}` — beste Quelle: gmail_dedup (Gen2)

**Zweck:** Formatierung/Fallback/Pflichtfeld direkt in der Vorlagen-Syntax, damit der Aufrufer Werte nicht
vorformatieren muss. Gen2 ist die reichste Ausprägung im Repo (default/or/if/req/join/secret + Passthrough).

**Wörtliches Quell-Snippet (Regex + Missing-Value-Dispatch, gmail_dedup/templateHelper.js):**

```javascript
result.replace(/\{([a-zA-Z0-9_\.]+)(?::([a-zA-Z0-9_]+)(?:\((.*?)\))?)?\}/g,
    (_, key, modifier, args) => {
    let val = context[key];
    if (val === undefined && context.extractedData) val = context.extractedData[key];
    // Kein Modifier UND kein Wert -> sofort raus. MIT Modifier -> ihm die Chance geben (:default, :req).
    if ((val === undefined || val === null) && !modifier) return missingReplacement;
    if (modifier) {
        try { return _applyModifier(val, modifier, refDate, args, context, key); }
        catch (e) { throw new Error(`Template-Fehler bei {${key}:${modifier}}: ${e.message}`); }
    }
    return val;
});
```

Operatoren (gmail_dedup):

```javascript
if (mod === 'default') return value ? value : (args || '');
if (mod === 'or') { /* kommagetrennte Alt-Keys der Reihe nach, inkl. extractedData */ }
if (mod === 'if')  { const [t,e]=(args||'').split(','); return value ? t.trim() : (e||'').trim(); }
if (mod === 'req' || mod === 'required') { if (!value) throw new Error('Pflichtfeld fehlt.'); return value; }
if (mod === 'join' && Array.isArray(val)) {           // Escape-Unescaping!
    let sep = (args || ', ').replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\r/g,'\r');
    return val.join(sep);
}
```

Und der dynamische `dNN`-Padding-Fallback (identisch in inform_flights/serienbrief), mit expliziter Falsy-Zero-Unterscheidung:

```javascript
const dMatch = mod.match(/^d(\d+)$/);
if (dMatch) value = (value || value === 0) ? String(value).padStart(parseInt(dMatch[1],10),'0') : '';
```

**RUBICON-Adaption (Docs-REST):** Die gesamte Auflösung läuft **VOR** `replaceAllText` — die Docs-API sieht
nur noch den fertig formatierten String. In `doc_template.py` eine reine Funktion einhängen und in
`build_replace_requests` die Keys erweitern (der `containsText.text` muss die **volle** Platzhalter-Syntax
inkl. `:mod` treffen, weil so im Vorlagen-Doc geschrieben):

```python
import re
MODIFIERS = {
    'upper': lambda v, a: str(v).upper(),
    'lower': lambda v, a: str(v).lower(),
    'trim':  lambda v, a: str(v).strip(),
    'default': lambda v, a: v if (v not in (None, '') and str(v).strip()) else (a or ''),
    'req':   lambda v, a: _req(v),
    'join':  lambda v, a: (a or ', ').replace('\\n','\n').replace('\\t','\t').join(v) if isinstance(v, (list, tuple)) else str(v),
    # 'secret': lambda v, a: _secret(str(v)),  # -> os.environ / Secret Manager, wirft bei Fehlen
}
_PH = re.compile(r'\{\{([A-Za-z0-9_.]+)((?::[A-Za-z0-9_]+(?:\([^)]*\))?)*)\}\}')

def resolve(raw_value, mod_chain):
    val = raw_value
    for m in re.findall(r':([A-Za-z0-9_]+)(?:\(([^)]*)\))?', mod_chain or ''):
        name, args = m
        if name in MODIFIERS:
            val = MODIFIERS[name](val, args or None)
        else:                                    # dNN-Fallback
            dm = re.match(r'^d(\d+)$', name)
            if dm and (val or val == 0):
                val = str(val).zfill(int(dm.group(1)))
    return '' if val is None else str(val)
```

`build_replace_requests` scannt dann die Vorlage einmal (`documents.get` beim Kopieren) auf tatsächlich
vorkommende `{{KEY:mod}}` (Muster „einmal planen, N-fach anwenden" aus catering_nxt/`labelPlaceholdersInText`)
und emittiert je einzigartigem Vorkommen ein `replaceAllText` mit `containsText.text = "{{" + key + modchain + "}}"`.

**Fallstricke:**
- **Missing-Value-Dispatch nicht weglassen** — sonst kurzschließt ein fehlender Key, bevor `:default`/`:req`
  ihre Chance bekommen (genau der Fall, für den sie da sind).
- **`:join`-Escape-Unescaping**: Config-/Vorlagen-Texte liefern `\n` als literale zwei Zeichen, nie ein
  echtes Steuerzeichen — vor dem Join unescapen.
- **Falsy-Zero** (`(v or v == 0)`): echte `0` ist kein leerer Wert (catering_nxt/AGENTS-Klasse).
- **Stringly-typed Bool**: bei Präsenzprüfungen explizit gegen den String `'false'` prüfen (inform_flights `hasValue`).
- `matchCase: True` in `containsText` bleibt — die Vorlage muss den Key exakt so tragen wie im Plan.

---

### 4 · Cleanup-Sweep für unersetzte Platzhalter — Quelle: serienbrief_addon / Aeropoint

**Zweck:** Ein fehlendes Datenfeld darf nicht als sichtbarer `{{Foo}}`-Literal beim Empfänger im PDF landen.

**Wörtliches Quell-Snippet (Aeropoint/FormProcessor.js):**

```javascript
// Alle nicht ersetzten Platzhalter auf N/A setzen
const allPlaceholders = body.getText().match(/{{(.*?)}}/g) || [];
for (let placeholder of allPlaceholders) {
    body.replaceText(placeholder, EMPTY_PLACEHOLDER);
}
```

**RUBICON-Adaption:** In `render_pdf_from_template` **nach** dem Haupt-`batchUpdate` (und nach Tabellen/Bullets)
einen Sweep-Request hängen. Docs-`replaceAllText` kann keine Regex — daher zwei Wege:

```python
# einfach & billig: EIN Sweep, alle Reste -> "" bzw. Default
sweep = {"replaceAllText": {"containsText": {"text": "{{", "matchCase": True}, "replaceText": ""}}
# ABER: containsText ist literaler Substring, kein Regex -> "{{" allein trifft nur "{{", nicht das ganze Token.
```

Da `containsText` **literal** matcht, ist der saubere Weg: **`documents.get` → Body-Text scannen →
je gefundenem Rest-Token einen literalen `replaceAllText(token, default)`**:

```python
import re
doc = docs.documents().get(documentId=doc_id).execute()
full = "".join(_paragraph_text(el) for el in doc["body"]["content"] if "paragraph" in el)
leftover = set(re.findall(r"\{\{[^}]+\}\}", full))
if leftover:
    docs.documents().batchUpdate(documentId=doc_id, body={"requests": [
        {"replaceAllText": {"containsText": {"text": t, "matchCase": True}, "replaceText": ""}}
        for t in leftover
    ]}).execute()
    log.warning("cleanup-sweep entfernte %d unersetzte Platzhalter doc_id=%s", len(leftover), doc_id)
```

**Fallstricke:** Der GAS-Regex-Escaping-Footgun (`replaceText` interpretiert Regex) existiert im Docs-REST-Pfad
**nicht** (`containsText` ist literal) — daher hier kein Escaping nötig. Sweep **nach** Tabellen/Bullets laufen
lassen, sonst löscht er Anker, die die Tabellen-Insertion noch braucht. Das Logging der Rest-Tokens (nicht nur
stilles Leeren) hilft, Vorlage/Daten-Lücken zu finden.

---

### 5 · Hash-Gate Skip-Automat — Quelle: catering_nxt/docBatchLogic.js + docRenderLogic.js

**Zweck:** Bei periodischer Regeneration nicht jedes Doc neu bauen — nur wenn sich der Quellinhalt geändert hat.

**Wörtliche Quell-Snippets:**

```javascript
function docNextStatus(currentStatus, currentHash, storedHash) {
  const s = String(currentStatus || "");
  if (s === "" || s === "STALE" || s === "ERROR" || s === "PENDING") return "GENERATE";
  if (String(currentHash || "") !== String(storedHash || "")) return "GENERATE";
  return "SKIP"; // DONE oder NONE + gleicher Hash -> nichts zu tun
}
```

```javascript
// kanonischer, reihenfolge-invarianter Fingerabdruck: je Gruppe SORTIERT
const posPart = positions.map(p => [p.SCOPE, p.CODE_RAW, p.MAHLZEIT_ID, p.QTY_PLANNED,
  p.LEG_SEQ, p.FULFILL_KIND, p.ARTIKEL_ID, p.CREW_ID].join(",")).sort().join(";");
return "F["+flightPart+"]P["+posPart+"]C["+crewPart+"]...";
```

**RUBICON-Adaption:** Eine kleine Registry (JSON/SQLite) je Ziel-Dokument mit `{status, hash}`. Vor
`render_pdf_from_template` den kanonischen String über **alle** in die Vorlage fließenden `values`/`tables`/
`bullets` bauen (je Gruppe sortiert!), SHA-1-hexen, gegen den gespeicherten Hash vergleichen:

```python
import hashlib, json
def doc_hash_input(values, tables, bullets):
    v = ",".join(f"{k}={values[k]}" for k in sorted(values))
    t = ";".join(sorted(json.dumps(spec, sort_keys=True) for spec in (tables or {}).values()))
    b = ";".join(sorted(json.dumps(spec, sort_keys=True) for spec in (bullets or {}).values()))
    return f"V[{v}]T[{t}]B[{b}]"

def source_digest(values, tables, bullets):
    return hashlib.sha1(doc_hash_input(values, tables, bullets).encode("utf-8")).hexdigest()

def next_status(status, current_hash, stored_hash):
    if status in ("", "STALE", "ERROR", "PENDING"): return "GENERATE"
    return "GENERATE" if current_hash != stored_hash else "SKIP"
```

**Checkliste-Prinzip (wichtiger als der Code):** *Neues Feld im Output ⇒ Quelle im Hash?* Sonst driftet der
Output still, ohne Regeneration auszulösen. Bei Sammel-Docs aus **mehreren** Records den **Content-Hash jedes
Mitglieds** in den Gesamt-Digest aufnehmen (`batchHashInput`), nicht nur ID/Timestamp — sonst wird Live-Build-
Drift nicht erkannt.

**Fallstricke:** Sortierung je Gruppe ist Pflicht (Reihenfolge-Invarianz). Verschachtelte Listen/Dicts nie per
`str()` in den Hash — Keys sortieren, strukturtreu serialisieren (`json.dumps(sort_keys=True)`; das JS-Footgun
`[object Object]` existiert in Python nicht, das Reihenfolge-Problem schon). Fehlende/leere Registry-Werte
fail-closed als „GENERATE" behandeln.

---

### 6 · `requiredRevisionId`-Retry-Riegel — Quelle: catering_nxt/AGENTS.md §10

**Zweck:** Ein `delete+insert`-`batchUpdate` ist **nicht idempotent**. Committet der Batch serverseitig, geht
aber nur die Antwort verloren, wendet ein naiver Retry denselben Satz erneut auf das bereits mutierte Dokument
an — und löscht z.B. frisch eingefügte Inhalte.

**Wörtliche Lektion (Code liegt in DocRenderer.js):**

> „Docs.Documents.batchUpdate mit delete+insert unter executeWithRetry: … `writeControl: {requiredRevisionId}`
> lässt den zweiten Versuch hart scheitern (nicht-transient ⇒ Rückfall). Gilt für JEDEN retry-fähigen Write,
> der nicht idempotent ist."

**RUBICON-Adaption:** Betrifft in `doc_template.py` v.a. `insert_table_at_anchor` (insertTable→get→insertText)
und den geplanten Occurrence-Ersatz (#10). Die `revisionId` aus dem letzten `documents.get`/`copy`-Response
mitführen und in den `batchUpdate`-Body legen:

```python
doc = docs.documents().get(documentId=doc_id, fields="revisionId,body").execute()
rev = doc["revisionId"]
docs.documents().batchUpdate(documentId=doc_id, body={
    "requests": inserts,
    "writeControl": {"requiredRevisionId": rev},
}).execute()   # zweiter Retry auf denselben rev -> 400/409 statt stiller Doppel-Mutation
```

Der reine `replaceAllText`-Pfad (`build_replace_requests`) ist idempotent und braucht das nicht — nur die
index-basierten, nicht-idempotenten Schritte.

**Fallstricke:** `requiredRevisionId` muss aus dem **unmittelbar vorangehenden** get/copy stammen; nach jedem
committeten batchUpdate ändert sich die Revision. Konflikt (Revision veraltet) ist **nicht-transient** → nicht
weiter-retryen, sondern sauber neu aufsetzen.

---

### 7 · `idsToTrashSupersededBy` — nur strikt-ältere Duplikate trashen — Quelle: catering_nxt/docFolderLogic.js

**Zweck:** Zwei parallele Renders desselben Dateinamens dürfen sich nicht gegenseitig vernichten. Der naive
„alles außer meiner ID trashen"-Ansatz lässt am Ende **keine** Live-Datei übrig, obwohl Status DONE zeigt.

**Wörtliches Quell-Snippet:**

```javascript
function idsToTrashSupersededBy(files, keepId) {
  const parse = f => Date.parse(String((f && f.createdTime) || ""));
  let keepMs = NaN;
  for (const f of files) if (f && f.id === keepId) { keepMs = parse(f); break; }
  if (!isFinite(keepMs)) return [];
  return files.filter(f => f && f.id && f.id !== keepId
      && isFinite(parse(f)) && parse(f) < keepMs).map(f => f.id);
}
```

**RUBICON-Adaption:** Nach `drive.files().copy`/`export` mit deterministischem Zielnamen die gleichnamigen
Dateien listen, nur strikt ältere trashen:

```python
def ids_to_trash_superseded_by(files, keep_id):
    keep = next((f for f in files if f["id"] == keep_id), None)
    if not keep or not keep.get("createdTime"): return []
    keep_ms = keep["createdTime"]
    return [f["id"] for f in files
            if f["id"] != keep_id and f.get("createdTime") and f["createdTime"] < keep_ms]

files = drive.files().list(q=f"name='{name}' and '{folder_id}' in parents and trashed=false",
                           fields="files(id,createdTime)", supportsAllDrives=True).execute()["files"]
for fid in ids_to_trash_superseded_by(files, doc_id):
    drive.files().update(fileId=fid, body={"trashed": True}, supportsAllDrives=True).execute()
```

**Fallstricke:** ISO-8601-`createdTime`-Strings sind lexikografisch vergleichbar (gleiche Länge/UTC) — sonst
parsen. Ergänzt sich mit `pickFolderWinner` (#8) für den Fall, dass beide Racer denselben Gewinner brauchen.

---

### 8 · `pickFolderWinner` — deterministischer Gewinner ohne Koordination — Quelle: catering_nxt/docFolderLogic.js

**Zweck:** Wenn zwei Läufe parallel dasselbe logische Ziel anlegen, konvergieren beide **ohne** Koordination auf
denselben Gewinner (ältestes `createdTime`; fehlendes verliert; Gleichstand → kleinste ID).

**Wörtliches Quell-Snippet:**

```javascript
function pickFolderWinner(files) {
  const list = (files || []).filter(f => f && f.id);
  if (!list.length) return "";
  return list.slice().sort((a, b) => {
    const ta = a.createdTime ? String(a.createdTime) : "";
    const tb = b.createdTime ? String(b.createdTime) : "";
    if (ta !== tb) { if (!ta) return 1; if (!tb) return -1; return ta < tb ? -1 : 1; }
    return String(a.id) < String(b.id) ? -1 : 1;
  })[0].id;
}
```

**RUBICON-Adaption:** `drive.files.copy()` mehrfach/parallel (Retry nach Timeout, ohne zu wissen ob die erste
Kopie lief) → statt vorab zu prüfen, beide laufen lassen und danach konvergieren:

```python
def pick_winner(files):
    def key(f): return (f.get("createdTime") or "\uffff", f["id"])  # fehlend verliert
    return min((f for f in files if f.get("id")), key=key, default={}).get("id", "")
```

**Fallstricke:** Total & deterministisch halten (kein zufälliger Tiebreak), sonst wählen die Racer verschiedene
Gewinner. Danach die Verlierer via `ids_to_trash_superseded_by` räumen.

---

### 9 · Idempotente Regeneration (staleness-window / overwrite-by-name) — Quelle: Aeropoint/conductos/proforma

**Zweck:** Wiederholte Läufe sollen weder unnötig neu bauen noch „Copy of X (1)" ansammeln.

**Wörtliche Quell-Snippets:**

```javascript
// Variante A: Staleness-Window (conductos)
const ageInHours = (Date.now() - file.getDateCreated().getTime()) / 36e5;
if (ageInHours < 24) return;               // frisch -> skip
else { file.setTrashed(true); row[docLinkCol] = ''; }   // alt -> trash + recreate
```

```javascript
// Variante B: Overwrite-by-Name (proforma)
const existingFiles = folder.getFilesByName(pdfName);
while (existingFiles.hasNext()) existingFiles.next().setTrashed(true);
```

**RUBICON-Adaption:**

```python
existing = drive.files().list(
    q=f"name='{name}' and '{folder_id}' in parents and trashed=false",
    fields="files(id,createdTime)", supportsAllDrives=True).execute()["files"]
if existing:                                   # Variante A
    age_h = (datetime.now(timezone.utc) - parse(existing[0]["createdTime"])).total_seconds()/3600
    if age_h < 24:
        return None                            # skip: frisch genug
    for f in existing:                         # oder Variante B: immer alle vorher trashen
        drive.files().update(fileId=f["id"], body={"trashed": True}, supportsAllDrives=True).execute()
```

**Fallstricke:** Variantenwahl hängt vom Trigger ab (on-demand → overwrite; periodischer Batch → staleness-
window). Kombinierbar mit Hash-Gate (#5): erst Hash prüfen (Inhalt gleich?), dann Alter (nur bei Änderung neu).

---

### 10 · Occurrence-indexierte Ersetzung + absteigende Sortier-Invariante — Quelle: catering_nxt/docRenderLogic.js

**Zweck:** Steht derselbe Platzhalter **mehrfach** in EINEM Doc und braucht **jedes Vorkommen** einen anderen
Wert (Vorkommen i → Karte i), reicht globales `replaceAllText` nicht. RUBICON trifft das, sobald N Karten aus
1 Vorlage in einem Dokument liegen (Vorrats-Fall, #20).

**Wörtliches Quell-Snippet:**

```javascript
function docsReplaceRequests(ranges, values) {
  const rs = ranges.map((r, i) => ({ startIndex: r.startIndex, endIndex: r.endIndex, value: values[i] }));
  rs.sort((a, b) => b.startIndex - a.startIndex);        // ABSTEIGEND!
  const out = [];
  rs.forEach(r => {
    if (!(r.endIndex > r.startIndex)) return;
    out.push({ deleteContentRange: { range: { startIndex: r.startIndex, endIndex: r.endIndex } } });
    const v = r.value == null ? "" : String(r.value);
    if (v !== "") out.push({ insertText: { location: { index: r.startIndex }, text: v } });
  });
  return out;
}
```

**RUBICON-Adaption:** `doc_template.py` hat die absteigende Invariante bereits für den Tabellen-Fall
(`inserts.sort(key=lambda x: x[0], reverse=True)`). Für Occurrence-Ersatz die exakten Ranges je Vorkommen aus
`documents.get` ermitteln und dieselbe Buchführung anwenden:

```python
def docs_replace_requests(ranges, values):
    rs = sorted(({"s": r["startIndex"], "e": r["endIndex"], "v": values[i]}
                 for i, r in enumerate(ranges)), key=lambda r: r["s"], reverse=True)
    out = []
    for r in rs:
        if r["e"] <= r["s"]: continue
        out.append({"deleteContentRange": {"range": {"startIndex": r["s"], "endIndex": r["e"]}}})
        v = "" if r["v"] is None else str(r["v"])
        if v: out.append({"insertText": {"location": {"index": r["s"]}, "text": v}})
    return out
```

**Fallstricke:**
- **Immer absteigend** — aufsteigend wäre ab dem zweiten Bereich still falsch (frühere Ersetzung verschiebt
  spätere Indizes); Docs führt es lautlos trotzdem aus.
- Beim Vorrats-Muster: **Schnitt (Trim des Überschusses) VOR** die absteigenden Ersetzungen, sonst trifft der
  Schnitt nach verschobenen Längen die falsche Stelle. Und ab dem **Anfang** der ersten überzähligen Karte
  schneiden, nicht ab dem Ende der letzten behaltenen — sonst bleibt Docs' auto-eingefügter Absatz+Seitenumbruch
  → leere Schlussseite.
- Kombiniere mit `requiredRevisionId` (#6): nicht-idempotenter delete+insert unter Retry.
- Die Run-Verkettung (`docsTokenRanges`, Formatwechsel-Splitting) braucht RUBICON nur, sobald es von text- auf
  index-basierte Ops wechselt — für reines `replaceAllText` löst die API das selbst (**skip-already-have**).

---

### 11 · `generateSafeFilename` — Quelle: Aeropoint/FormProcessor.js

**Zweck:** Deterministischer, dateisystemsicherer PDF-Name aus Entität+Zeit statt hartcodiert.

**Wörtliches Quell-Snippet:**

```javascript
let filename = parts.join(' - ');
filename = filename.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
if (filename.length > 150) filename = filename.substring(0, 150).trim();
if (!filename) return `Formular-${date.getTime()}`;
```

**RUBICON-Adaption:**

```python
def safe_filename(*parts, when=None):
    when = when or datetime.now()
    base = " - ".join(p.strip() for p in parts if p) + " - " + when.strftime("%Y-%m-%d_%H%M")
    base = re.sub(r'[\\/:*?"<>|]', "_", base)
    base = re.sub(r"\s+", " ", base).strip()[:150].strip()
    return base or f"Dokument-{int(when.timestamp())}"
```

**Fallstricke:** 150-Zeichen-Cap gegen zu lange Namen; Timestamp-Fallback bei leerem Ergebnis. Deterministisch
halten (gleiche Eingabe → gleicher Name) ist Voraussetzung für overwrite-by-name (#9).

---

### 12 · `extractIdFromUrl` — Quelle: form-sender / serienbrief / proforma (3×, bewährt)

**Zweck:** File-ID aus nackter ID **oder** voller Drive/Docs-URL ziehen — tolerant gegen Copy-Paste-Varianten in
Config-Zellen.

**Wörtliches Quell-Snippet:**

```javascript
function extractIdFromUrl(url) {
  const match = url ? url.match(/[-\w]{25,}/) : null;
  return match ? match[0] : null;
}
```

**RUBICON-Adaption:**

```python
def extract_id(url):
    m = re.search(r"[-\w]{25,}", url or "")
    return m.group(0) if m else None
```

**Fallstricke:** Vor Übernahme gegen vorhandene ID-Parser in RUBICON abgleichen (evtl. schon da). Greift für
`template_id`/`folder_id`-Spalten, die mal URL, mal ID tragen.

---

### 13 · Hex-Farb-Normalisierung — Quelle: catering_nxt/docTemplateLogic.js (`_slipColor`)

**Zweck:** Farbwert aus Stammdaten (mit/ohne `#`, 3-/6-stellig) auf kanonisches `#RRGGBB` bringen; invalid → "".

**Wörtliches Quell-Snippet:**

```javascript
function _slipColor(raw) {
  let s = String(raw || "").trim(); if (!s) return "";
  if (s[0] !== "#") s = "#" + s;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return ("#"+s[1]+s[1]+s[2]+s[2]+s[3]+s[3]).toUpperCase();
  return "";
}
```

**RUBICON-Adaption:** Docs-API will `rgbColor` als 0..1-Floats, nicht Hex — daher zusätzlich konvertieren
(passt zu `header_bg`/`colorCells`):

```python
def hex_to_rgbcolor(raw):
    s = str(raw or "").strip()
    if not s: return None
    if not s.startswith("#"): s = "#" + s
    if re.match(r"^#[0-9a-fA-F]{3}$", s): s = "#" + "".join(c*2 for c in s[1:])
    if not re.match(r"^#[0-9a-fA-F]{6}$", s): return None
    r, g, b = (int(s[i:i+2], 16)/255 for i in (1, 3, 5))
    return {"red": r, "green": g, "blue": b}
```

**Fallstricke:** Ungültig → `None`/"", nicht werfen (fehlertolerant, wie im Original).

---

### 14 · Zero-Pad nur bei rein numerischem Rohwert — Quelle: catering_nxt/docTemplateLogic.js (`_slipRefCode`)

**Zweck:** Führende Nullen eines bekannten Sheets-Import-Datenverlusts rekonstruieren — **nur** bei rein
numerischem Wert; Fremdformate bleiben unangetastet.

**Wörtliches Quell-Snippet:**

```javascript
function _slipRefCode(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") return "";
  if (!/^\d+$/.test(s)) return s;                 // nicht rein numerisch -> unverändert
  return s.length >= 7 ? s : ("0000000" + s).slice(-7);
}
```

**RUBICON-Adaption:**

```python
def ref_code(raw, width=7):
    s = str(raw or "").strip()
    if not s or not s.isdigit(): return s
    return s if len(s) >= width else s.zfill(width)
```

**Fallstricke:** Wichtige Unterscheidung zum generischen `dNN`-Modifier (#1): dies ist eine **gezielte
Rekonstruktion** eines bekannten Datenverlusts, kein universelles Padding — nie auf beliebige Felder anwenden.

---

### 15 · Aggregate-then-format — Quelle: proforma/Code.js

**Zweck:** In Wiederhol-Tabellen Beträge als Zahl akkumulieren, **erst am Ende** formatieren — nie einen bereits
formatierten String zurückparsen (Rundungsfehler/Bugs).

**Wörtliches Quell-Snippet:**

```javascript
const acTypeAmount = acTypeFlightCount * acTypePrice;
totalPrice += acTypeAmount;
currentRow.replaceText('{{AcTypeAmount}}', acTypeAmount.toFixed(2));
body.replaceText('{{TotalPrice}}', totalPrice.toFixed(2));   // erst ganz am Schluss
```

**RUBICON-Adaption:** In der `rows`-Aufbereitung für `insert_table_at_anchor` Beträge als `Decimal`/`float`
halten, `f"{x:.2f}"` nur beim Bauen der Zell-Strings:

```python
from decimal import Decimal
total = Decimal(0)
rows = []
for it in items:
    amount = Decimal(it["count"]) * Decimal(it["price"])
    total += amount
    rows.append([it["type"], str(it["count"]), f"{amount:.2f}"])
values["{{TotalPrice}}"] = f"{total:.2f}"   # bzw. in build_replace_requests-values
```

**Fallstricke:** `Decimal` für Geld (float-Rundung vermeiden). Formatierung ausschließlich an der Ausgabekante.

---

### 16 · Datengetriebene Zell-Hintergrundfarbe (`colorCells`) — Quelle: catering_nxt/docRenderLogic.js

**Zweck:** Beliebige **Body**-Zellen datengetrieben einfärben (Status-Ampel, Kategorie je Zeile) — net-new
gegenüber RUBICONs nur **statischer** navy Kopfzeile.

**Wörtliches Quell-Snippet:**

```javascript
(grid.colorCells || []).forEach(cc => {
  try { t.getRow(cc.r).getCell(cc.c).setBackgroundColor(cc.hex); }
  catch (e) { /* tolerate geometry drift */ }
});
```

**RUBICON-Adaption:** `insert_table_at_anchor` hat bereits `_cell_bg_request(table_start, row_index, n_cols, bg)`
für ganze Zeilen (Gruppenbänder/Kopf). Für **einzelne** Zellen den `columnSpan`/`columnIndex` auf die Zielzelle
setzen und die Farben aus einer `color_cells=[{"r":..,"c":..,"rgb":..}]`-Spec vor dem Füllen anwenden (Styling
verschiebt keine Content-Indizes, daher wie im Bestandscode direkt nach dem `insertTable`-get):

```python
for cc in (color_cells or []):
    style.append({"updateTableCellStyle": {
        "tableRange": {"tableCellLocation": {"tableStartLocation": {"index": table_start},
                                             "rowIndex": cc["r"], "columnIndex": cc["c"]},
                       "rowSpan": 1, "columnSpan": 1},
        "tableCellStyle": {"backgroundColor": {"color": {"rgbColor": cc["rgb"]}}},
        "fields": "backgroundColor"}})
```

**Fallstricke:** Fehlertoleranz je Zelle (try/catch bzw. Index-Guard) gegen Geometrie-Drift — eine falsche
Koordinate darf nicht den ganzen Lauf kippen. `rgbColor` als 0..1-Floats (siehe #13).

---

### 17 · `_slip2colGrid` — 2-Spalten-Grid mit gruppenbewusstem Zeilenumbruch — Quelle: catering_nxt/docModel.js

**Zweck:** Flache Liste in ein 2-spaltiges Etiketten-Grid paaren, aber **nie über Gruppengrenzen** hinweg
(TYPE-Wechsel → rechte Hälfte leer, neue Gruppe startet frische Zeile). Reine Funktion, gegen 3306 Referenz-PDFs
verifiziert (0 gemischte Paare).

**Wörtliches Quell-Snippet:**

```javascript
function _slip2colGrid(list, header, itemToCols, codeOffset, groupOf) {
  if (!list || !list.length) return { cells: [], colorCells: [] };
  const width = itemToCols(list[0]).length;
  const blank = Array(width).fill("");
  const cells = header ? [header] : [];
  const colorCells = [];
  let i = 0;
  while (i < list.length) {
    const a = list[i]; let b = list[i + 1];
    if (b && groupOf && groupOf(a) !== groupOf(b)) b = null;   // Gruppengrenze -> nicht paaren
    const left = itemToCols(a), right = b ? itemToCols(b) : blank;
    const r = cells.length;
    cells.push(left.concat(right));
    if (codeOffset != null && a && a.COLOR) colorCells.push({ r, c: codeOffset, hex: a.COLOR });
    if (codeOffset != null && b && b.COLOR) colorCells.push({ r, c: width + codeOffset, hex: b.COLOR });
    i += b ? 2 : 1;
  }
  return { cells, colorCells };
}
```

**RUBICON-Adaption:** 1:1 nach Python (GAS-frei). Liefert direkt die `rows` für `insert_table_at_anchor` plus
`color_cells` für #16:

```python
def two_col_grid(items, header, item_to_cols, code_offset=None, group_of=None):
    if not items: return [], []
    width = len(item_to_cols(items[0])); blank = [""] * width
    cells = [header] if header else []; colors = []
    i = 0
    while i < len(items):
        a = items[i]; b = items[i+1] if i+1 < len(items) else None
        if b and group_of and group_of(a) != group_of(b): b = None
        r = len(cells)
        cells.append(item_to_cols(a) + (item_to_cols(b) if b else blank))
        if code_offset is not None and a.get("COLOR"): colors.append({"r": r, "c": code_offset, "rgb": hex_to_rgbcolor(a["COLOR"])})
        if code_offset is not None and b and b.get("COLOR"): colors.append({"r": r, "c": width+code_offset, "rgb": hex_to_rgbcolor(b["COLOR"])})
        i += 2 if b else 1
    return cells, colors
```

**Fallstricke:** `group_of` optional lassen (ohne = stures Paaren). Für Etiketten mit harten Gruppenbändern
Pflicht, sonst landen zwei verschieden-typisierte Items in derselben Druckzeile.

---

### 18 · `batchCards` / `batchSlipPages` — Batch-Bündelung mit `{{PAGE}}`-Reset — Quelle: catering_nxt/docBatchLogic.js

**Zweck:** N Record-Modelle **vor** dem einen Render zu einer gemeinsamen Werteliste zusammenführen (1
copy→batchUpdate→export statt N Zyklen). Bei mehrseitigen Modellen den `{{PAGE}}`-Zähler **je Quelle** neu bei 1
starten.

**Wörtliche Quell-Snippets:**

```javascript
function batchCards(memberCardArrays) {
  const out = [];
  (memberCardArrays || []).forEach(arr => (arr || []).forEach(card => out.push(card)));
  return out;
}
```

```javascript
let pageInFlight = 0;                     // Reset PRO Quelle, nicht global durchlaufend
m.pages.forEach(pg => { if (!pg) return; pageInFlight++;
  out.push({ layout: pg.layout, title: pg.title, page: pageInFlight, header }); });
```

**RUBICON-Adaption:** Reine Listen-Konkatenation vor `render_pdf_from_template`; `{{PAGE}}`/`{{SEITE}}`-Werte je
Quell-Abschnitt zurücksetzen:

```python
def batch_slip_pages(members, header_of):
    out = []
    for m in members:
        page = 0
        for pg in m["pages"]:
            page += 1
            out.append({**pg, "page": page, "header": header_of(m)})
    return out
```

**Fallstricke:** Konkreter Stolperstein: global durchlaufende Seitenzahl zeigt in jedem Abschnitt die falsche
Seite. Für „N Kopien EINER Vorlage in EINEM Doc" zusätzlich Occurrence-Ersatz (#10). Für Batch-**Export** vieler
**separater** PDFs stattdessen Fan-out (#28).

---

### 19 · `docChangesetDiff` — Multimengen-Diff (changed vs. obsolete) — Quelle: catering_nxt/docChangesetLogic.js

**Zweck:** Bei Re-Render eines bereits ausgelieferten Dokuments nicht nur neu ersetzen, sondern kommunizieren
**was neu/geändert** ist (Changes-PDF) und **was entfallen** ist (Obsolet-Doc mit ursprünglicher Seitenzahl).
Net-new — RUBICON hat dafür nichts.

**Wörtliches Quell-Snippet:**

```javascript
function docChangesetDiff(anchorCards, currentCards) {
  const anchorLeft = {};
  anchorCards.forEach(a => anchorLeft[a.h] = (anchorLeft[a.h] || 0) + 1);
  const changedIdx = [];
  currentCards.forEach((c, i) => { if (anchorLeft[c.h] > 0) anchorLeft[c.h]--; else changedIdx.push(i); });
  const curLeft = {};
  currentCards.forEach(c => curLeft[c.h] = (curLeft[c.h] || 0) + 1);
  const obsolete = [];
  anchorCards.forEach((a, i) => { if (curLeft[a.h] > 0) curLeft[a.h]--; else obsolete.push({ h: a.h, id: a.id, page: i + 1 }); });
  return { changedIdx, obsolete };
}
```

**RUBICON-Adaption:**

```python
from collections import Counter
def changeset_diff(anchor_cards, current_cards):
    anchor_left = Counter(a["h"] for a in anchor_cards)
    changed_idx = []
    for i, c in enumerate(current_cards):
        if anchor_left[c["h"]] > 0: anchor_left[c["h"]] -= 1
        else: changed_idx.append(i)
    cur_left = Counter(c["h"] for c in current_cards)
    obsolete = []
    for i, a in enumerate(anchor_cards):
        if cur_left[a["h"]] > 0: cur_left[a["h"]] -= 1
        else: obsolete.append({"h": a["h"], "id": a["id"], "page": i + 1})
    return {"changed_idx": changed_idx, "obsolete": obsolete}
```

**Fallstricke:** **Multiset**, nicht Set — Duplikate mit gleichem Hash einzeln verrechnen. Der Anker-Snapshot
(`docAnchorFromCards`) sollte bei Größen-Cap **fail-visible** (`overflow: True`) markieren statt still zu kürzen.
Card-Hash strukturtreu bauen (siehe #5-Fallstricke).

---

### 20 · Vorrats-Dokument-Muster — Quelle: catering_nxt (DocRenderer/docModel, node-getestet)

**Zweck:** Für „N gleichartige Karten aus 1 Item-Template" ist das teuerste (~84 %) das serverseitige Anhängen
der Vorlagen-Elemente je Karte. Lösung: EIN Vorrats-Dokument mit gestaffelten Blanko-Karten-Buckets wird
**einmal** vorgebaut; jedes Rendern kopiert nur den Vorrat, schneidet Überschuss (1 `deleteContentRange`) und
setzt alle Werte in EINEM batchUpdate. Gemessen 28,0 s statt 69,3 s bei 30 Karten; live 1,9–3,0×.

**Wörtliches Quell-Snippet (Bucket-Wahl + Freshness):**

```javascript
function stockBucketFor(cards, buckets, minCards) {
  const n = Number(cards), min = Number(minCards);
  if (!isFinite(n) || n < 1) return null;
  if (isFinite(min) && n < min) return null;                 // Untergrenze: lohnt erst ab minCards
  const sorted = buckets.map(Number).filter(b => isFinite(b) && b > 0).sort((a, b) => a - b);
  for (const b of sorted) if (b >= n) return b;
  return null;                                                // kein Bucket -> lieber langsam-aber-vollständig
}
function stockFingerprintMatches(s, c) {
  if (!s || !c) return false;
  return s.modifiedTime === c.modifiedTime
      && Number(s.childCount) === Number(c.childCount)
      && s.planJson === c.planJson;                           // NICHT nur modifiedTime
}
```

**RUBICON-Adaption:** Nur relevant, **falls** RUBICON je Etiketten/Preisschilder/Karten aus einem Item-Template
rendert. Buckets in externer Config (nicht Code — neue Größe ohne Deploy). Fingerprint aus `drive.files.get`
(`modifiedTime`) + Elementzahl + Platzhalter-Plan-JSON; fail-closed auf den langsamen Weg (Einzel-Render) bei
Miss. Zusammen mit Occurrence-Ersatz (#10) und dem Trim-vor-Ersetzen-Fallstrick.

**Fallstricke:** Unter- **und** Obergrenze test-pinnen (kein Bucket → langsam-aber-vollständig, nicht still
gekürzt). Fingerprint bewusst mehrteilig — `modifiedTime` allein meldet auch ohne Inhaltsänderung.

---

### 21 · Dot-Path Resolution + `_flattenApiResponseData` + Prefix — Quelle: gmail_dedup

**Zweck:** Platzhalter direkt gegen ein **verschachteltes** Objekt (`{{FlightIdentifier.Id}}`) auflösen statt
vorher manuell zu flatten; bei Merge mehrerer API-Antworten Kollisionsschutz per Prefix.

**Wörtliches Quell-Snippet:**

```javascript
function _flattenApiResponseData(obj, prefix) {
  const result = {};
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    const fullKey = prefix ? prefix + '.' + key : key;
    if (value == null) result[fullKey] = '';
    else if (Array.isArray(value)) continue;
    else if (typeof value === 'object') Object.assign(result, _flattenApiResponseData(value, fullKey));
    else result[fullKey] = String(value);
  }
  return result;
}
// Merge mit Kollisionsschutz: templateContext['Response.' + key] = flatResponse[key];
```

**RUBICON-Adaption:**

```python
def flatten(obj, prefix=""):
    out = {}
    for k, v in (obj or {}).items():
        fk = f"{prefix}.{k}" if prefix else k
        if v is None: out[fk] = ""
        elif isinstance(v, (list, tuple)): continue
        elif isinstance(v, dict): out.update(flatten(v, fk))
        else: out[fk] = str(v)
    return out
# values = {**flatten(get_resp), **{f"Response.{k}": v for k, v in flatten(put_resp).items()}}
```

Die Platzhalter-Regex muss Punkte im Key erlauben (`[A-Za-z0-9_.]+` — in #1 bereits so).

**Fallstricke:** Namenskollision zwischen zwei Antworten (GET-Lookup + PUT-Response) per `Response.`-Prefix
vermeiden. Arrays werden übersprungen (für Listen → `:join`-Modifier auf dem Rohwert, #3).

---

### 22 · Zwei-Pass fixe Meta-Platzhalter — Quelle: gmail_dedup/templateHelper.js

**Zweck:** Immer verfügbare Meta-Platzhalter (`{{HEUTE}}`, `{{JJJJMMTT}}`) aus **einer** zentralen Zeitzonen-
Stelle auflösen, statt sie in jeden Record-Context zu duplizieren (Konsistenz zwischen `{YYYY}` und `{YYYYMMDD}`).

**Wörtliches Quell-Snippet:**

```javascript
if (context.dateParts) {
  result = result
    .replace(/\{YYYY\}/g, context.dateParts.YYYY)
    .replace(/\{MM\}/g, context.dateParts.MM)
    .replace(/\{YYYYMMDD\}/g, context.dateParts.YYYYMMDD);
}
```

**RUBICON-Adaption:** Vor der Datenrunde EINEN Satz Meta-Werte aus einer definierten TZ bauen und in `values`
mergen (UTC als sicherer Default, `local`-Opt-in — Konvention aus copilot-instructions §7):

```python
now = datetime.now(timezone.utc)
meta = {"{{HEUTE}}": now.strftime("%Y-%m-%d"), "{{JJJJMMTT}}": now.strftime("%Y%m%d")}
values = {**meta, **record_values}
```

**Fallstricke:** Zeitzone **einmal** festlegen — sonst zeigen `{{HEUTE}}` und `{{JJJJMMTT}}` verschiedene Tage an
Tagesgrenzen.

---

### 23 · `getHeaderMap` — namensbasiertes Spalten-Lookup — Quelle: read_and_sign_v3/sheetsHelper.js

**Zweck:** Datenzeilen über Klartext-Spaltennamen adressieren statt über harte Indizes → robust gegen
Spalten-Reorder in der Quelltabelle.

**Wörtliches Quell-Snippet:**

```javascript
function getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = {};
  headers.forEach((header, index) => { headerMap[header] = index + 1; });
  return headerMap;
}
```

**RUBICON-Adaption:** Falls RUBICONs Sheet→Doc-Merge Zeilen per Hartindex liest, auf Namens-Lookup umstellen:

```python
header_map = {h: i for i, h in enumerate(rows[0])}
def cell(row, name): return row[header_map[name]] if name in header_map else ""
```

Plus `check_required_headers` **vor** der Verarbeitung (fehlende Pflichtspalten früh melden, nicht erst beim
`undefined`-Zugriff mitten im Loop).

**Fallstricke:** Doppelte Header-Namen kollidieren still — Header-Eindeutigkeit prüfen.

---

### 24 · `withTrace` — redigiertes strukturiertes Error-Envelope — Quelle: read_and_sign_v3/tracing.js

**Zweck:** Fehler um `batchUpdate`/`export` als filterbares JSON in Cloud Logging, **ohne PII** (nur
Identifikatoren, keine Namen/Emails/Feldinhalte).

**Wörtliches Quell-Snippet:**

```javascript
function withTrace(name, fn, contextFn) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (err) {
      let ctx = {};
      try { if (contextFn) ctx = contextFn.apply(this, arguments) || {}; } catch (_) {}
      traceError(name, err, ctx);   // console.error(JSON) -> jsonPayload, filterbar
      throw err;                    // Verhalten unverändert
    }
  };
}
```

**RUBICON-Adaption:** Als Decorator um die Render-Schritte:

```python
def with_trace(name, context_fn=None):
    def deco(fn):
        @functools.wraps(fn)
        def wrap(*a, **k):
            try: return fn(*a, **k)
            except Exception as err:
                ctx = {}
                try: ctx = (context_fn(*a, **k) or {}) if context_fn else {}
                except Exception: pass
                log.error(json.dumps({"evt": "trace_error", "fn": name,
                    "message": str(err), "ctx": ctx}))   # KEINE PII in ctx
                raise
        return wrap
    return deco
```

**Fallstricke:** `ctx` **nur** Identifikatoren (doc_id, template_id, Record-ID) — nie Personendaten (PII nie in
Logs, Repo-Regel). Fehler weiterwerfen (Observability, kein Schlucken).

---

### 25 · PDF-Seite-1→PNG-Preview — Quelle: rubicon_v1/gen_pdf_previews.py

**Zweck:** Anklickbare Modal-Vorschau, weil Chrome PDFs in verschachtelten iframes unzuverlässig (schwarz)
rendert; ein `<img>` lädt überall.

**Wörtliches Quell-Snippet:**

```python
def render_dir(d: Path):
    for pdf in sorted(d.glob('*.pdf')):
        png = pdf.with_suffix('.png')
        doc = fitz.open(pdf)
        doc[0].get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM)).save(png)   # ZOOM=2.0 ~144 DPI
        doc.close()
```

**RUBICON-Adaption:** Als eigenständiger Nachlauf nach `render_pdf_from_template` (PDF-Bytes → `fitz.open(stream=..., filetype="pdf")` → Seite 0 → PNG). Neuer Dependency-Zweig (PyMuPDF), aber isoliert.

**Fallstricke:** PyMuPDF-Abhängigkeit bewusst nur dort, wo Vorschau gebraucht wird. ZOOM=2.0 reicht für Modal.

---

### 26 · Persistenter Living-Doc via persistierter Doc-ID — Quelle: rubicon_v1/gen_traktanden_docs.py

**Zweck:** Gegenstück zu RUBICONs copy-and-trash: manche Artefakte (Protokolle, Traktandenlisten) sollen als
**dauerhaft einsehbarer** Doc im Drive leben und sich in-place aktualisieren statt bei jedem Lauf neu angelegt/
getrasht zu werden.

**Wörtliches Quell-Snippet:**

```python
cmd = ['python3', MD2GDOC, md, name, PARENT]
prev_doc = (rec.get('export') or {}).get('doc_id')
if prev_doc: cmd += ['--doc-id', prev_doc]      # vorhandene ID -> Body leeren + neu aufbauen
```

**RUBICON-Adaption:** Neben `render_pdf_from_template` (ephemer, `cleanup=True`) einen `update_living_doc(doc_id)`
-Pfad: bei vorhandener persistierter ID Body leeren (`deleteContentRange` über den ganzen Body) + neu füllen,
statt `copy`+`delete`. ID nach dem ersten Lauf in der Registry (#5) speichern.

**Fallstricke:** Body-Leeren muss den finalen leeren Absatz stehen lassen (Docs verlangt ihn). Nur für Artefakte
mit dauerhaftem Anzeige-Zweck — für reines PDF-Rohmaterial bleibt copy-and-trash richtig.

---

### 27 · Doc-Inhalt zurücklesen via Markdown-Export — Quelle: rubicon_v1/import_gemini_doc.py

**Zweck:** Ein bestehendes Doc als sauberen Text lesen (Validierung eines befüllten Templates, Import externer
Docs) — deutlich einfacher als Docs-API-JSON-Traversierung.

**Wörtliches Quell-Snippet:**

```python
for mime in ('text/markdown', 'text/plain'):
    try:
        data = drive.files().export(fileId=doc_id, mimeType=mime).execute()
        return name, (data.decode('utf-8') if isinstance(data, bytes) else str(data))
    except Exception: continue
```

**RUBICON-Adaption:** 1:1 übernehmbar. Für gezielte **Anker-Suche** beim Schreiben bleibt der bestehende
`_find_anchor_index`/`_paragraph_text`-Walk richtig; Bulk-Lesen zum Validieren geht über den Export.

**Fallstricke:** `text/markdown`-Export ist nicht in allen Kontexten verfügbar → `text/plain`-Fallback (im
Snippet enthalten).

---

### 28 · Fan-out + 429-Retry für den Docs-Pfad — Quelle: rubicon_v1/gen_briefing_pdfs.py + md_to_gdoc.py

**Zweck:** Viele Einzel-Renders in EINEM Lauf parallel, Fehler **sammeln** statt beim ersten Fehlschlag zu
kippen; Docs-`batchUpdate`-429 abfangen.

**Wörtliche Quell-Snippets:**

```python
with cf.ThreadPoolExecutor(max_workers=4) as ex:
    for fut in cf.as_completed([ex.submit(one, j) for j in jobs]):
        try: fut.result(); done += 1
        except Exception as exn: fail.append(str(exn))   # sammeln, Lauf läuft zu Ende
```

```python
def bu(self, requests):                                   # 429-Backoff
    for attempt in range(6):
        try: return self.docs.documents().batchUpdate(documentId=self.doc_id, body={'requests': requests}).execute()
        except HttpError as e:
            if e.resp.status == 429 and attempt < 5: time.sleep(22); continue
            raise
```

**RUBICON-Adaption:** `render_pdf_from_template` bleibt Einzel-Aufruf; die Fan-out-Orchestrierung darum bauen
(ThreadPool + Fehlerliste + Exit-Code erst am Schluss). Die 429-Retry-Hülle um die `batchUpdate`-Aufrufe in
`doc_template.py` legen (der reine md_to_gdoc-Pfad hat sie schon — `doc_template.py` selbst noch **nicht**).

**Fallstricke:** Docs-API-Schreibquota ist eng — Parallelität moderat (max_workers≈4) und mit 429-Retry
kombinieren. Kein `finally`-cleanup-Race zwischen Threads auf demselben Doc.

---

### 29 · Quota-Preflight (alles-oder-nichts) — Quelle: read_and_sign

**Zweck:** Vor einem Batch prüfen, ob das Budget reicht, und die **gesamte** Charge abbrechen statt mitten im
Lauf mit Quota-Fehler zu crashen und Teil-Output zu hinterlassen.

**Wörtliches Quell-Snippet:**

```javascript
if (mailCount > MailApp.getRemainingDailyQuota()) {
  showError(`more mails queued than daily quota. To send: ${mailCount} Remaining: ${...}`);
  return false;                                   // alles-oder-nichts
}
```

**RUBICON-Adaption:** Kanalunabhängiges Muster: vor einem Batch-PDF-Lauf die geplante Anzahl Docs-API-Writes/
Exporte gegen ein bekanntes Rate-/Quota-Budget schätzen und bei Überschreitung geordnet abbrechen (mit klarer
Meldung) statt Teil-Batch zu produzieren.

**Fallstricke:** Konservativ schätzen (mehrere `batchUpdate` je Doc). Ergänzt Fan-out (#28): Preflight vor dem
Submit.

---

### 30 · Column-Patterns Mini-DSL — Quelle: LDM_Parser / gmail_dedup

**Zweck:** Eine Config-Zelle definiert Spaltenzahl, Header **und** Pro-Zelle-Template (`Header={tpl}|Header={tpl}`)
— Nicht-Devs können Zielspalten ohne Code umdefinieren.

**Wörtliches Quell-Snippet:**

```javascript
parseColumnPatterns(patternsStr) {
  const segments = String(patternsStr).split('|');
  const result = [];
  for (const segment of segments) {
    const t = segment.trim(); if (!t) continue;
    const eq = t.indexOf('=');                    // ERSTES '=' trennt Header/Template
    if (eq <= 0) continue;
    result.push({ header: t.slice(0, eq).trim(), template: t.slice(eq + 1).trim() });
  }
  return result.length ? result : null;
}
```

**RUBICON-Adaption:** Nischig, aber interessant für **konfigurierbare** RUBICON-Tabellenspalten (statt fest
verdrahteter `header`/`rows`-Specs). Python-Split analog; die per-Spalte-Templates dann über die Modifier-Engine
(#1) gegen die Datenzeile auflösen.

**Fallstricke:** `indexOf('=')` (erstes `=`) — Templates dürfen `=` enthalten. Leere/kaputte Segmente still
überspringen (fail-soft).

---

### 31 · Optionaler Cross-File-Override-Hook — Quelle: gmail_dedup/informFlightsResolve.js

**Zweck:** Domänen-Sonderfälle einklinken, **ohne** den generischen Engine-Kern anzufassen (defensiv geprüfter
Override statt Sonderfall hart einkodiert).

**Wörtliches Quell-Snippet:**

```javascript
if (typeof _resolvedFlightDate === 'function') {
  const _rf = _resolvedFlightDate(context, key, modifier);
  if (_rf !== null && _rf !== undefined) return _rf;      // Override schlägt Standard
}
```

**RUBICON-Adaption:** GAS-Trick (ein globaler Namespace) → in Python ein optionaler `resolver`-Callback bzw. eine
kleine Plugin-Registry in der Modifier-Engine (#1):

```python
def resolve(raw_value, mod_chain, key, override=None):
    if override is not None:
        r = override(key, mod_chain, raw_value)
        if r is not None: return r
    ...  # Standard-Pipeline
```

**Fallstricke:** Override-Rückgabe `None` = „nicht zuständig, Standard weiter". Sonderfälle nie in den Kern
kodieren — sonst wächst die Engine unkontrolliert (siehe Evolutions-Notiz).

---

## (d) Explizite Nicht-Empfehlungen

**1. String-Regex Conditional-DSL `{{#IF_X}}…{{/IF_X}}` (inform_flights, serienbrief) — NICHT portieren.**
Diese Mechanik operiert auf einem **rohen String** (Regex über den ganzen Text, Fixpoint-Reprocessing-Loop mit
Safety-Counter, AND/OR über `||`/`&&`, Rand-Newline-Cleanup). Das Docs-REST-Modell arbeitet aber auf **Runs/
Indizes** via `batchUpdate`/`replaceAllText`, nicht auf Zeichenketten — es gibt keinen „ganzen Text" zum
Regex-Ersetzen. Bedingtes Entfernen eines Absatzes braucht `deleteContentRange` auf Paragraph-Ebene, ein völlig
anderer Mechanismus.

*Wenn RUBICON bedingte Abschnitte braucht,* ist der richtige Weg das **Aeropoint-Muster**: Start-/End-Anker als
Paragraphen, deren Indizes per `documents.get` auflösen, und bei falscher Bedingung den Bereich dazwischen per
`deleteContentRange` löschen. Die reine **Bedingungs-Auswertung** (`hasValue` + `split('||')/split('&&')`) ist
portierbar; die **String-Block-Entfernung** ist es nicht. Für **inline**-Bedingungen einzelner Werte gibt es
bereits den `:if(then,else)`-Modifier (#1), der ohne Block-Syntax auskommt und sauber in die Pipeline passt.

**2. Regex-Escaping vor `replaceText` (serienbrief/Aeropoint) — nicht nötig.** Das ist ein GAS-Footgun
(`DocumentApp.Body.replaceText` interpretiert sein Argument als Regex). Docs-REST `replaceAllText` nutzt
`containsText.text` als **literalen** Substring-Match — kein Escaping. Nur als Kontrastwissen relevant.

**3. Regex-Compile-Cache (gmail_dedup, L1/L2 + MD5-Key) — nicht anwendbar.** Betrifft nutzer-definierte Regexe,
die clientseitig kompiliert werden. RUBICONs `replaceAllText` läuft serverseitig bei Google — kein lokales
Regex-Compilieren.

**4. Smart-Date-Inferenz aus Tagesziffer (`_calculateSmartDate`) — nicht anwendbar.** Reines Luftfahrt-
Kurzdatumsformat-Problem (DD-only-Codes, Monatsgrenzen-Mehrdeutigkeit). Nur relevant, falls RUBICON je kurze
Datumscodes rekonstruieren muss — aktuell nicht der Fall.

**5. Reminder-Kadenz / BCC-Batch-Versand / sendEmail-Wrapper (read_and_sign) — außerhalb Doc/PDF-Scope.**
Betrifft E-Mail-Betrieb. Falls RUBICON nach dem PDF-Export benachrichtigt (vgl. `gen_entscheid_mail.py` baut
bewusst nur **Drafts**, nie Versand; Empfänger nur regex-validiert, nie geraten), sind das die richtigen Muster —
aber sie gehören nicht in `doc_template.py` als Fill-Engine.

**6. Run-Verkettung `docsTokenRanges` / `split_bold` / 429-Backoff — schon da (skip-already-have).** Die
Run-Splitting-Robustheit löst `replaceAllText` selbst; `split_bold`/429-Retry existieren im Repo
(`rubicon-dst/md_to_gdoc.py`), nur noch nicht im Anker-Pfad von `doc_template.py`. Bei Bedarf dort abkupfern, nicht
neu erfinden. Ebenso simple `{{Key}}`-Loops und Tabellenzeilen-Klonen — `build_replace_requests` /
`insert_table_at_anchor` sind bereits die Superset-Lösung.

---

## (e) Evolutions-Notiz: wie sich templateHelper / Serienbrief spezialisiert haben

Der Wert liegt oft weniger in einer einzelnen Funktion als im **Wachstumspfad** — er zeigt RUBICON, in welcher
Reihenfolge und warum ein anfangs simples `replaceAllText` typischerweise wächst.

**templateHelper: Gen1 → Gen2 (LDM_Parser → gmail_dedup).**
Gen1 (`LDM_Parser/templateHelper.js`, ~64 Zeilen) ist reine `{key}`-Ersetzung ohne Formatierung/Bedingung/
Fallback — **funktional identisch zu RUBICONs heutigem `build_replace_requests`-Stand**. Gen2
(`gmail_dedup/templateHelper.js`, ~432 Zeilen + verteilte Flatten-/DSL-Utilities in 4 Step-Dateien) ist dieselbe
Engine nach organischem Wachstum unter echten Anforderungen, in dieser Reihenfolge: (1) Modifier-Kette
`{key:mod(args)}`, (2) `:default`, (3) Multi-Key-`:or`, (4) inline `:if`, (5) Pflichtfeld-`:req` (wirft statt
still leer), (6) Raw-Type-Passthrough für `:join`/`:asjson`, (7) `:secret`-Indirection, (8) Dot-Path-Flatten aus
verschachtelten API-Responses mit `Response.`-Prefix, (9) Zwei-Pass-Datumsplatzhalter, (10) defensiver
Cross-File-Override-Hook. Bemerkenswert: der **DSL-Parser wanderte aus** der Engine heraus in die Aufrufer
(`sheetExportStep._parseColumnPatterns`) — die Engine spezialisierte sich auf Modifier+Context, Parsing wurde
Caller-Verantwortung. **Das ist exakt der Pfad, den `doc_template.py` als Nächstes nehmen dürfte,** sobald
Pflichtfelder, Fallback-Ketten, Secret-Referenzen und mehrquellige API-Kontexte auftauchen.

**Serienbrief: v1.7 → v1.10 (shair → serienbrief_addon).**
Beide sind Forks desselben `runMerge()`-Kerns, ein reiner „1 Sheet-Zeile = 1 Doc-Kopie"-Merge. v1.10 ist ein
direkter **Superset** von v1.7: zusätzlich Sammeldokument-Modus (`appendOtherBody` mit Element-Typ-Dispatch +
Seitenumbruch-Trenner), reicheres Abschluss-Dialog-HTML, und — wichtiger für RUBICON — **PDF-Fehler nicht mehr
fatal** (kein `return` nach Catch, Lauf läuft weiter). Der genuine Netto-Wert liegt nicht in der Doc-Struktur
(die kann RUBICON schon besser), sondern in vier entkoppelten Schichten: Modifier-DSL, Cleanup-Sweep,
Resume/Idempotenz über selbst-anlegende Log-Marker-Spalte, PDF-Blob-Wiederverwendung. Negativ-Befund: GAS/
DocumentApp hat **kein** natives „Doc an Doc anhängen" auf REST-Ebene — `appendOtherBody`'s Element-Klonen ist
via `batchUpdate` sehr fragil. **Für RUBICON ist Post-hoc-PDF-Merge (pypdf) der pragmatischere Weg** als der
Versuch, diesen Element-Dispatch nachzubauen.

**RUBICON-eigene Linie (rubicon_v1 → rubicon-dst).**
Der Gemini-v1-Vorfahr und das heutige RUBICON teilen fast wortgleich denselben Stamm (`_templates.py`,
`html_to_pdf.py`, `md_to_gdoc.py`). `doc_template.py` (copy→replaceAllText→Anker→export→trash) ist ein **neuerer,
bewusst ephemerer Zweig neben** dem alten HTML/Chrome- bzw. Markdown-Pfad — der ihn noch nicht abgelöst hat
(`gen_report.py`/`gen_protokoll.py` laufen bis heute über den alten Weg). Der Vorfahr trägt genau vier
Fähigkeiten, die dem neuen Docs-REST-Zweig fehlen und oben als adapt gelistet sind: PNG-Preview (#25),
Update-in-place-Living-Doc (#26), Doc-Zurücklesen via Markdown-Export (#27), erprobte Batch-Orchestrierung mit
isolierten Chrome-Profilen + Fehler-sammeln (#28).

**Roter Faden:** Jede Engine startet als flaches `replaceAllText` und wächst in derselben Reihenfolge —
Formatierung → Fallback → Bedingung → Pflichtfeld → Multi-Quelle → Idempotenz/Race-Sicherheit. RUBICON kann die
ersten Schritte (Modifier, Cleanup, Utilities) **direkt** übernehmen und die späteren (Hash-Gate, Retry-Riegel,
Changeset, Vorrat) **gezielt** dann ziehen, wenn Batch-/Wiederhol-Anforderungen real werden — statt den ganzen
Wachstumsschmerz nochmal selbst zu durchlaufen.
