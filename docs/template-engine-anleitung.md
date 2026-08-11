# Vorlagen-Engine (`doc_template`) — Anleitung

Praktischer Leitfaden zur RUBICON-**Vorlagen-Engine**: wie man eine AXS-gebrandete Google-Doc-Vorlage
baut und serverseitig zu Doc/PDF rendert — **ohne Chrome**. Das ist **Weg 1** der Doc-Erzeugung (feste
Struktur); für das dynamische Protokoll siehe README „Doc-Erzeugung: genau zwei Wege" (die Reporte
laufen seit 10.08. ebenfalls über Weg 1).

Engine: [`scripts/_tools/doc_template.py`](../scripts/_tools/doc_template.py) · Tests:
[`scripts/test_doc_template.py`](../scripts/test_doc_template.py).

---

## 1. Modell in einem Satz

Eine **gebrandete Google-Doc-Vorlage** mit `{{PLATZHALTERN}}` und `{{ANKERN}}` wird kopiert, per
Docs-REST-API gefüllt, und als PDF exportiert. Das Doc ist WYSIWYG in Google Docs editierbar (Branding
ohne Code); der Code füllt nur Werte, Tabellen und Listen.

## 2. Öffentliche API

```python
import doc_template as dt

# Ganzer Rundlauf: Vorlage kopieren -> füllen -> exportieren -> Zwischen-Doc trashen -> PDF-Bytes
pdf = dt.render_pdf_from_template(
    drive, docs, template_id, folder_id, name, values,
    tables=None,      # optional: Anker -> echte Docs-Tabelle
    bullets=None,     # optional: Anker -> Bullet-/Nummern-Liste
    cleanup=True,     # False = Doc behalten (dann trasht der Aufrufer selbst)
)
```

`drive`/`docs` = googleapiclient-Clients (`build('drive','v3',…)` / `build('docs','v1',…)`).
`values` = `dict` Feldname → Wert (Wert kann Liste/None sein). Rückgabe = **PDF-Bytes** (mit
`%PDF`-Validierung).

### Variante: Doc behalten (`render_doc_and_pdf`)

```python
# Wie render_pdf_from_template, aber das gebrandete Doc BLEIBT (kein Trash) — Weg-1-Endprodukt.
doc_id, pdf = dt.render_doc_and_pdf(
    drive, docs, template_id, folder_id, name, values,
    tables=None, bullets=None,
)   # -> (doc_id, pdf_bytes)
```

Der Gegensatz zu `render_pdf_from_template`: Letztere **trasht** das Zwischen-Doc (Default
`cleanup=True`, das PDF ist das einzige Endprodukt); `render_doc_and_pdf` **behält** das Doc und gibt
zusätzlich seine `doc_id` zurück (lebendes Google Doc als Nebenprodukt). Beide teilen intern
`_copy_fill_export` (Vorlage kopieren → füllen → exportieren) — **jeder Post-Copy-Fehler trägt die
`doc_id`** (die Exception bekommt `ex.doc_id` angehängt), damit der Aufrufer das angelegte Doc sicher
aufräumen kann (Cleanup-Garantie).

### Materializer (`doc_materialize.materialize`)

Ein Schritt höher sitzt der Materializer, der das behaltene Doc + PDF-Upload + das Wegräumen des
vorherigen Docs bündelt:

```python
import doc_materialize as dm

res = dm.materialize(
    drive, docs,
    template_id=dm.template_id("entscheide"),   # -> rubicon_templates.json / RUBICON_TEMPLATE_<TYP>
    name="E-2026-001.pdf", folder_id=ENTSCHEIDE_FOLDER,
    values=values, tables=None, bullets=None,
    prev_doc_id=None, prev_pdf_id=None,          # vorheriges Server-Doc/-PDF (update-in-place + trash)
)
# res = {doc_id, doc_url, pdf_id, pdf_url, pdf_bytes}
```

`materialize(...)` rendert das gebrandete Doc (bleibt), lädt das PDF hoch (update-in-place, wenn
`prev_pdf_id` gesetzt) und trasht das **vorherige** Doc. **Upload und Trash-Prev sind non-fatal** —
das Volume-PDF ist der eigentliche Auslieferweg, ein Fehler hier darf `materialize()` nicht kippen.
`template_id(typ)` liest die Template-ID aus `scripts/_tools/rubicon_templates.json`, übersteuerbar per
Env `RUBICON_TEMPLATE_<TYP>` (Singular, z.B. `RUBICON_TEMPLATE_ENTSCHEIDE`).

### Platzhalter + Modifier

Platzhalter im Vorlagentext: `{{KEY}}` oder mit Modifier-Kette `{{KEY:mod1:mod2(args)}}`. Die Engine
**scannt den Doc-Text** und ersetzt jeden Token; nicht aufgelöste `{{…}}` werden geleert (impliziter
Cleanup). Tabellen-/Bullet-Anker werden dabei automatisch ausgenommen.

| Modifier | Wirkung | Beispiel |
|---|---|---|
| `default(x)` | leerer Wert → `x` | `{{STATUS:default(offen)}}` |
| `or(k1,k2)` | leer → erster nichtleerer anderer Key | `{{GREMIUM:or(VR)}}` |
| `if(a,b)` | gefüllt → `a`, sonst `b` | `{{FLAG:if(ja,nein)}}` |
| `req` / `required` | leer → Fehler (Pflichtfeld) | `{{TITEL:req}}` |
| `upper` / `lower` | Groß-/Kleinschrift | `{{CODE:upper}}` |
| `trim` | Ränder trimmen | `{{X:trim}}` |
| `join(sep)` | **Liste** mit `sep` fügen (`\n`/`\t` erlaubt) | `{{TAGS:join( · )}}` |
| `pad(n)` | nur rein-numerisch: führende Nullen auf `n` | `{{NR:pad(3)}}` → `007` |

Ketten laufen links→rechts: `{{TITEL:upper:default(—)}}`. Nicht portiert (bewusst): `secret`,
`smart_*`, `flight`/`airline` (sicherheits-/domänenspezifisch).

### Anker → Tabelle (Wiederhol-Gruppen)

```python
tables = {
    "{{BODY_AGENDA}}": {
        "header": ["#", "Traktandum", "Output → wohin"],
        "rows":   [["1", "Review", "Handlungen"], ["2", "Cash-Lage", "Gate-Status"]],
        "col_widths_pt": [26, 300, 125],           # feste Spaltenbreiten (PFLICHT, sonst bläht Docs)
        "header_bg": AXS_BLUE,                      # optional: navy Kopfzeile
        # header_text_rgb: {...}                    # optional; default WEISS wenn header_bg gesetzt
    }
}
```

**Gruppen-Bandzeilen** (z.B. Kadenz-Trenner): ein `rows`-Eintrag darf ein `dict` sein statt Liste:

```python
"rows": [
    {"group": "Alle 2 Wochen", "bg": BAND_BG, "text_rgb": AXS_BLUE},   # Bandzeile (Label Spalte 0 fett)
    ["Steering", "alle 2 Wochen", "DRS + …", "Zweck", "Output"],       # normale Datenzeile
]
```

### Anker → Bullets

```python
bullets = {
    "{{BODY_DELIVERABLES}}": ["Erstes", "Zweites"],                    # disc-Bullets
    "{{BODY_SCHRITTE}}":     {"items": [...], "ordered": True},        # nummeriert
}
```
Leere Liste → nur der Anker wird entfernt (kein leerer Listenpunkt). **Achtung:** trägt die Quelle
schon eigene Nummern (`"1. …"`), bei `ordered` den Enumerator strippen
(`re.sub(r'^\s*\d+[.)]\s*', '', x)`), sonst Doppel-Nummerierung.

## 3. Eine gebrandete Vorlage anlegen (Rezept)

**Grundsatz:** Platzhalter **stylen** — `replaceAllText` erbt die Formatierung, der gefüllte Wert wird
also gestylt. Farben/Heading-Stile aus [`_templates.py`](../scripts/_tools/_templates.py)
**wiederverwenden**, nicht neu erfinden:

- **AXS-Navy** `#1E3E58` (`_templates.AXS_BLUE`), Grau `#5a6570`, Brass `#b07d2c`, Callout-BG `#F5F7FA`.
- Titel/Sektion via `heading_text_style(1|2)`, Fliesstext via `body_text_style()`.

Ablauf: Blank-Doc anlegen → gesamten Vorlagentext einfügen → Doc holen → je Absatz per Substring finden
→ `updateTextStyle` (bold/color/size) + `updateParagraphStyle` (alignment, `shading.backgroundColor`
+ `borderLeft` fürs Callout, `borderBottom`/`borderTop` für Trennlinien, `indentStart`, Abstände).
Styling verschiebt **keine** Indizes → alle Style-Requests aus **einem** `documents.get` in einem
Batch. Label-fett = Sub-Range `[start, start+len(label)]`. Logo = Text „a×s" navy-bold rechtsbündig
(echtes Bild als optionales Refinement). Landscape = `updateDocumentStyle` mit `pageSize`
(width>height) beim Anlegen der Vorlage — Kopien erben sie.

Die Tabelle stylt die **Engine** (`header_bg` + `col_widths_pt`); im Vorlagentext steht nur der Anker.

## 4. Fallstricke (bereits in der Engine gelöst — beim Erweitern beachten)

- **Absteigend nach Index füllen:** Zellen-Inserts von hinten, sonst verschieben frühe Inserts die
  späteren Positionen.
- **Anker vom Scan ausnehmen:** der Platzhalter-Scan würde sonst `{{BODY_*}}`-Anker leeren, bevor
  Tabelle/Bullets sie finden (`render` übergibt die Anker als `skip`).
- **`requiredRevisionId`-Riegel:** um nicht-idempotente `batchUpdate`s (insertTable/insertText); der
  Riegel muss **direkt** auf den `get` folgen — darum läuft die Zell-**Füllung vor** dem (idempotenten)
  Styling, sonst `400 required revision ID does not match`.
- **Kopftext weiß:** bei dunklem `header_bg` setzt die Engine automatisch weiß+fett (sonst schwarz auf
  navy = unlesbar).
- **Feste Spaltenbreiten** immer setzen, sonst verteilt Docs die Tabelle unschön.

## 5. Minimalbeispiel

```python
from googleapiclient.discovery import build
from _google_auth import load_credentials
import doc_template as dt

creds = load_credentials()                       # Bot rubicon@axs.aero (keyless-DWD)
drive = build("drive", "v3", credentials=creds, cache_discovery=False)
docs  = build("docs", "v1", credentials=creds, cache_discovery=False)

values = {"REGISTER_ID": "E-2026-001", "TITEL": "Kompetenzordnung", "STATUS": "kommuniziert"}
pdf = dt.render_pdf_from_template(drive, docs, ENTSCHEID_TEMPLATE_ID, ENTSCHEIDE_FOLDER,
                                  "E-2026-001.pdf", values)
open("out.pdf", "wb").write(pdf)                 # %PDF, kein Chrome
```

## 6. Server-Treiber (`gen_docs_server.py`)

Über der Engine und dem Materializer sitzt der Treiber [`scripts/gen_docs_server.py`](../scripts/gen_docs_server.py)
(`run(drive, docs, root)` + `main()`), der Weg 1 serverseitig produktiv fährt.

- **Dual-Mode / server-only:** läuft **nur im Server-Modus** — erkannt an der DWD-Env
  (`RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT`). Fehlt sie, bricht `main()` ab. Dieters
  lokale Generatoren (`gen_traktanden_docs.py`, `gen_entscheid_mail.py`, `gen_briefing_pdfs.py`,
  `gen_fuehrungsrhythmus_pdf.py`) bleiben unangetastet.
- **Vier Typen:** je Lauf werden Entscheide, Traktanden, Führungsrhythmus und Briefings materialisiert
  — die Specs (values/tables/bullets) kommen aus dem Mapper `scripts/_docmap.py`
  (`entscheid_spec`/`traktanden_spec`/`fr_spec`/`briefing_spec`), das Rendern + der Doc/PDF-Lebenszyklus
  aus `doc_materialize.materialize` (s. §2).
- **Volume-Auslieferung:** der Treiber schreibt die PDFs aller vier Typen ins Volume
  (`RUBICON_DOCS_DIR`, `_vol_pdf`) **und** die Seite-1-PNG-Previews für Briefings + Führungsrhythmus
  (`_vol_png`, PyMuPDF/`fitz`, ZOOM 2.0) — damit die App auf dem Server dieselben Artefakte/Previews
  bedient wie lokal. Beide Volume-Schritte sind **non-fatal** (das Drive-Doc/-PDF ist schon
  hochgeladen; `fitz` darf lokal fehlen).
- **Harte Regel:** der Server fasst **NUR `server_*`-Felder** an. Lokale Felder bleiben; und die
  **Alt-String-Doc-IDs** in `traktanden_docs.json` (Dieters lokale Traktanden-Docs) werden **NIE
  getrasht** — beim Traktanden-Lauf ist das Trash-Ziel ausschließlich das vorherige *Server*-Doc.
- **Ordner-Env (alle vier mit Code-Default):** `RUBICON_DRIVE_{TRAKTANDEN,ENTSCHEIDE,BRIEFINGS,FR}_FOLDER`
  übersteuern die Defaults im Treiber. Nur wenn `RUBICON_DRIVE_FR_FOLDER` **explizit leer** gesetzt ist,
  wird **kein** Führungsrhythmus-Doc erzeugt und der Typ als **`ENV_MISSING`** gemeldet (kein stiller
  Erfolg). Infrastruktur/Job: `DEPLOYMENT_GCP.md §12`.

### Store-Form (welcher Store trägt was)

Damit die additiven UI-Links (`traktDocUrl`, `BRIEFINGS_DOCS`, `FR_DOC`, `export.server_doc_url` in
`src/lib/data.js`) verständlich sind — das Modell folgt der Dual-Mode-Invariante „Server schreibt nur
`server_*`":

| Store | Form | Server-Felder |
|---|---|---|
| `entscheide.json` | `entscheide[].export` | `export.server_doc_id/url`, `server_pdf_id/url` (lokale `export.pdf`/`draft_id`/`stand` bleiben) |
| `traktanden_docs.json` | `{meeting_id: …}` | Neu-Objekt `{server_*}` **+** optional `doc_id` (Dieters lokale ID); Alt-**String** = lokale Doc-ID, wird erhalten |
| `briefings_docs.json` | `{milestone_id: {server_*}}` | `server_doc_id/url`, `server_pdf_id/url` |
| `fuehrungsrhythmus_doc.json` | `{server_*}` (flach) | `server_doc_id/url`, `server_pdf_id/url` |

Zusätzlich trägt jeder Server-Record ein **`server_hash`** (Content-Hash der Render-Eingaben) — Grundlage fürs **inkrementelle** Rendern: `gen_docs_server` überspringt unveränderte Docs (Hash gleich + `server_doc_id` vorhanden), `RUBICON_DOCS_FORCE=1` erzwingt den Vollauf. Additives Skalar-Feld, DB-tauglich; Dieters lokale Felder bleiben unangetastet.

`/api/state` (`plugins/api-core.js`) reicht `traktanden_docs`/`briefings_docs`/`fuehrungsrhythmus_doc`
an die SPA; `traktDocUrl(mid)` ist **shape-tolerant** (Alt-String → `docId`, Neu-Objekt →
`server_doc_id || doc_id`). Fehlt die `server_*_url` (rein lokaler Stand), rendert das UI **keinen**
Link. Merge-Brücke: `briefings_docs.json` + `fuehrungsrhythmus_doc.json` stehen in der **Transaktion**
(Volume-`server_*` überlebt einen Repo-Seed), `briefings.json`/`fuehrungsrhythmus.json` sind
**Stammdaten** (s. `DEPLOYMENT_GCP.md §10`).

## 7. Wann Weg 1 vs Weg 2?

- **Weg 1 (diese Engine):** feste Struktur, Felder + Wiederhol-Tabellen + Bullets, Branding ohne Code
  editierbar → **Traktanden, Entscheide, Briefings, Führungsrhythmus** sowie die **serverseitigen
  Reporte (woche/monat/vr)** (seit 10.08.; report_spec → values/tables/bullets, KI-Entwurf im Doc).
- **Weg 2 (HTML→PDF via Gotenberg):** berechnetes/dynamisches Layout (Ampel-Pills, Narrativ, git-Delta,
  Level-Varianten) → **Protokoll** (sowie Dieters lokaler Report-Pfad).

Leitplanken + Alternative (Jinja2+WeasyPrint) siehe README „Doc-Erzeugung: genau zwei Wege" und
`DEPLOYMENT_GCP.md §11`.
