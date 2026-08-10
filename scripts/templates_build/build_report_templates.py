#!/usr/bin/env python3
"""Pro-Typ-Report-Vorlage (woche|monat|vr) aus der BASIS (Header-Logo + Footer-Seitenzahlen) ableiten.
Basis kopieren, typ-spezifischen Body an {{BODY}} einsetzen, Marken-Styling. Header/Footer/Seitenzahlen
kommen aus der Kopie — NICHT neu erzeugen. + Sample-Render (Footer dynamisch) zur Layout-Abnahme.

  python3 scripts/templates_build/build_report_templates.py <woche|monat|vr>

ENV: RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT (DWD als rubicon@).
Optional: RUBICON_TEMPLATE_BASE (Basis-Doc), RUBICON_TEMPLATE_BUILD_FOLDER (Scratch)."""
import os
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts'))
sys.path.insert(0, str(REPO / 'scripts' / '_tools'))
from _google_auth import load_credentials
from googleapiclient.discovery import build
import doc_template as dt

TYP = sys.argv[1] if len(sys.argv) > 1 else 'vr'
assert TYP in ('woche', 'monat', 'vr'), TYP

creds = load_credentials()
drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
docs = build('docs', 'v1', credentials=creds, cache_discovery=False)

# BASE = manuell gepflegte „AXS Report-Basis (Grundlage)": Logo im Header + Seitenzahlen in der
# Fusszeile sind API-unfaehig -> von Hand gesetzt (s. build_base_template.py + README). Der Build
# kopiert die Basis und setzt nur den {{BODY}} je Typ. SCRATCH = Iterations-/Sample-Ordner.
BASE = os.environ.get('RUBICON_TEMPLATE_BASE', '14MbGXFG8ZCQwqMnnW1fMJbLvpWGcx6SSiFivDsPqTNs')
SCRATCH = os.environ.get('RUBICON_TEMPLATE_BUILD_FOLDER', '1j7IY11kYizNQhccFuDv3gahCcqwCCpB-')
NAVY = {'red': 0.11764706, 'green': 0.24313726, 'blue': 0.34509805}
BRASS = {'red': 0.6901961, 'green': 0.49019608, 'blue': 0.17254902}
MUTED = {'red': 0.5411765, 'green': 0.5803922, 'blue': 0.65882355}
DARK = {'red': 0.102, 'green': 0.102, 'blue': 0.102}
AMPEL = {'Verzug': {'red': 0.7529, 'green': 0.2235, 'blue': 0.1686},
         'Gefährdet': {'red': 0.78, 'green': 0.486, 'blue': 0.067},
         'Auf Kurs': {'red': 0.184, 'green': 0.619, 'blue': 0.435}}
FOOTER_TXT = ('Automatisch generiert aus der RUBICON-Plattform  ·  Ampel und Zahlen deterministisch'
              '  ·  Vertraulich — ExBoD / VR')
KIHEAD = 'KI-Entwurf — ungeprüft, Freigabe durch CoS/DRS'
TITLE_WORD = {'woche': 'Wochen', 'monat': 'Monats', 'vr': 'VR'}[TYP]
TITLE = f'{TITLE_WORD}-Report — {{{{TITEL}}}}'

# ── Typ-Definition: geordnete Abschnitte (Überschrift, Anker) + Sample-Daten ──
tbl = lambda header, rows, cw, ctr=None: dict(
    {'header': header, 'rows': rows, 'col_widths_pt': cw, 'header_bg': NAVY},
    **({'cell_text_rgb': ctr} if ctr else {}))
WS_ROWS = [['WS2', 'Führungsprozesse & Management Operating System', 'Gefährdet', '0 / 17'],
           ['WS7', 'VIE-Wegfall & Restrukturierung (Kompensation & Overhead-Abbau)', 'Verzug', '1 / 14'],
           ['FIN', 'Refinanzierung Lieferanten-Ausstände (EUR 15 Mio, Closing 31.10.2026)', 'Gefährdet', '1 / 9']]
WS_CTR = {(r, 2): AMPEL[row[2]] for r, row in enumerate(WS_ROWS) if row[2] in AMPEL}
WS_TABLE = {'header': ['WS', 'Bezeichnung', 'Ampel', 'Erledigt'], 'rows': WS_ROWS,
            'col_widths_pt': [38, 322, 75, 55], 'header_bg': NAVY, 'cell_text_rgb': WS_CTR}
PHASEN_TABLE = tbl(['Phase', 'Erledigt', 'Anteil'],
    [['Phase 0 — Fundament', '3 / 59', '5 %'], ['Phase 1 — Aufbau', '0 / 59', '0 %'],
     ['Phase 2 — Skalierung', '0 / 27', '0 %'], ['Phase 3 — Verstetigung', '0 / 9', '0 %']],
    [290, 105, 90])
KI_BEG_TABLE = tbl(['Meilenstein', 'Warum gefährdet + Gegenmassnahme'],
    [['WS7-01', 'Kompensationsmodell verzögert; Eskalation an den VR eingeleitet, Zielentscheid bis KW 34.'],
     ['FIN-03', 'Closing-Risiko zum 31.10.; Brückenfinanzierung wird mit zwei Instituten geprüft.']],
    [90, 400])
COMMON_VALS = {'UNTERTITEL': 'Projekt RUBICON — AXS Group Transformation', 'PROGRAMM_AMPEL': 'Verzug',
    'KI_NARRATIV': 'Der Berichtszeitraum steht unter Verzug: mehrere Arbeitsströme sind gefährdet, '
    'insbesondere WS7 (VIE-Wegfall & Restrukturierung). Gegenmassnahmen sind eingeleitet; die '
    'Refinanzierung der Lieferanten-Ausstände (FIN) bleibt kritisch bis zum Closing am 31.10.2026. '
    'Der Programm-Fortschritt liegt bei rund 5 % der Phase-0-Meilensteine.'}

if TYP == 'vr':
    SECTIONS = [('Kennzahlen', '{{KENNZAHLEN}}'),
                ('Chairman-Statement', '{{CHAIRMAN_STATEMENT}}'),
                ('Zielerreichung je Phase', '{{PHASEN_TABELLE}}'),
                ('Sequenz-Gates', '{{GATES_TABELLE}}'),
                ('Entscheidungsbedarf VR', '{{ENTSCHEIDUNGSBEDARF_TABELLE}}'),
                ('Top-Risiken (offene Blocker)', '{{RISIKEN_TABELLE}}'),
                ('Status je Arbeitsstrom', '{{WS_TABELLE}}'),
                (KIHEAD, '{{KI_NARRATIV}}'),
                ('Ampel-Begründungen (Entwurf)', '{{KI_BEGRUENDUNGEN}}')]
    VALS = dict(COMMON_VALS, TITEL='Q3/2026', STAND='Steuerungsstand 07.08.2026',
                CHAIRMAN_STATEMENT='Fokus des VR bleibt die Sicherung der Refinanzierung und die Kompensation des VIE-Wegfalls.')
    TABLES = {'{{PHASEN_TABELLE}}': PHASEN_TABLE, '{{WS_TABELLE}}': WS_TABLE, '{{KI_BEGRUENDUNGEN}}': KI_BEG_TABLE,
        '{{KENNZAHLEN}}': tbl(['Kern-Ende', 'Hard Edge', 'Meilensteine'],
            [['31.10.2026 → 15.12.2026 (+45 T)', '31.12.2026', '241']], [210, 160, 120]),
        '{{GATES_TABELLE}}': tbl(['Gate', 'Termin'], [['G3', '26.08.2026'], ['G6', '31.10.2026']], [140, 350]),
        '{{ENTSCHEIDUNGSBEDARF_TABELLE}}': tbl(['Entscheid', 'Quelle'],
            [['Overhead-Abbau-Ziel für Q4 festlegen', 'Steuerungsrunde 07.08.'],
             ['Brückenfinanzierung freigeben', 'ExBoD 05.08.']], [360, 130]),
        '{{RISIKEN_TABELLE}}': tbl(['MS', 'Risiko', 'Verzug'],
            [['WS7-01', 'Kompensationsmodell verzögert; Eskalation an VR', '+7 T'],
             ['FIN-03', 'Closing-Risiko 31.10.; Brückenfinanzierung offen', '+3 T']], [70, 350, 70])}
    BULLETS = {}

elif TYP == 'monat':
    SECTIONS = [('Erfüllungsgrad je Phase', '{{PHASEN_TABELLE}}'),
                ('Status je Arbeitsstrom', '{{WS_TABELLE}}'),
                ('Bewegungen im Monat', '{{BEWEGUNGEN}}'),
                ('Fortschritts-Meldungen je Strom', '{{FORTSCHRITT_TABELLE}}'),
                ('Kommentare je Strom', '{{WS_KOMMENTARE}}'),
                ('Commitments (im Monat erfasst)', '{{COMMITMENTS_TABELLE}}'),
                ('Offene Entscheide', '{{OFFENE_ENTSCHEIDE}}'),
                ('Programm-Kommentar', '{{KOMMENTAR}}'),
                (KIHEAD, '{{KI_NARRATIV}}'),
                ('Ampel-Begründungen (Entwurf)', '{{KI_BEGRUENDUNGEN}}')]
    VALS = dict(COMMON_VALS, TITEL='August 2026', STAND='Steuerungsstand 07.08.2026',
                KOMMENTAR='Der Monat bleibt unter Verzug; Fokus auf Refinanzierung und Kompensation des VIE-Wegfalls.')
    TABLES = {'{{PHASEN_TABELLE}}': PHASEN_TABLE, '{{WS_TABELLE}}': WS_TABLE, '{{KI_BEGRUENDUNGEN}}': KI_BEG_TABLE,
        '{{BEWEGUNGEN}}': tbl(['WS', 'Erreicht', 'Fällig (Monat)', 'Überfällig'],
            [['WS2', '—', 'WS2-03 (20.08.)', '—'], ['WS7', 'WS7-00', '—', 'WS7-01'],
             ['FIN', '—', 'FIN-02 (28.08.)', 'FIN-03']], [40, 130, 165, 155]),
        '{{FORTSCHRITT_TABELLE}}': tbl(['WS', 'Fortschritts-Meldungen'],
            [['WS7', 'WS7-02 → 40 %, WS7-03 → 15 %'], ['FIN', 'FIN-02 → 60 %']], [50, 440]),
        '{{WS_KOMMENTARE}}': tbl(['WS', 'Kommentar'],
            [['WS7', 'Kompensationsmodell hat Vorrang; Overhead-Abbau nachgelagert.'],
             ['FIN', 'Brückenfinanzierung mit zwei Instituten in Prüfung.']], [50, 440]),
        '{{COMMITMENTS_TABELLE}}': tbl(['Commitment', 'Owner', 'bis'],
            [['Kompensationsmodell VR-fähig ausarbeiten', 'CoS', '22.08.2026'],
             ['Brückenfinanzierung mit Instituten sondieren', 'CFO', '18.08.2026 ⚠']], [300, 105, 85]),
        '{{OFFENE_ENTSCHEIDE}}': tbl(['Entscheid', 'Status'],
            [['Overhead-Abbau-Ziel für Q4 festlegen', 'offen'],
             ['Standort-Konsolidierung VIE final beschliessen', 'offen']], [405, 85])}
    BULLETS = {}

else:  # woche
    SECTIONS = [('Veränderungen zur Vorwoche', '{{DELTA_FENSTER}}'),
                ('Ampel-Wechsel', '{{DELTA_AMPEL}}'),
                ('Fortschritts-Änderungen', '{{DELTA_FORTSCHRITT}}'),
                ('Erledigte Handlungen', '{{DELTA_ERLEDIGT}}'),
                ('Entscheide (neu / bewegt)', '{{DELTA_ENTSCHEIDE}}'),
                ('Aktivität nach Arbeitsstrom', '{{AKTIVITAET_TABELLE}}'),
                ('Commitments der Woche', '{{COMMITMENTS_TABELLE}}'),
                ('Entscheide der Woche', '{{ENTSCHEIDE_TABELLE}}'),
                ('Programm-Kommentar', '{{KOMMENTAR}}'),
                (KIHEAD, '{{KI_NARRATIV}}'),
                ('Ampel-Begründungen (Entwurf)', '{{KI_BEGRUENDUNGEN}}')]
    VALS = dict(COMMON_VALS, TITEL='KW 32 · 04.08.–10.08.2026', STAND='Steuerungsstand 07.08.2026',
                DELTA_FENSTER='Fenster: 03.08.2026 – 09.08.2026',
                KOMMENTAR='Woche unter Verzug; Eskalation WS7 an den VR ausgelöst, Refinanzierung bleibt kritisch.')
    AKT_ROWS = [['WS2 — Führungsprozesse & MOS', 'Gefährdet', 'MOS-Workshop durchgeführt; 2 Meilensteine terminiert.'],
                ['WS7 — VIE-Wegfall & Restrukturierung', 'Verzug', 'Kompensationsmodell verzögert (+7 T); Eskalation an VR ausgelöst.'],
                ['FIN — Refinanzierung Lieferanten', 'Gefährdet', 'Zwei Institute für Brückenfinanzierung kontaktiert.']]
    AKT_CTR = {(r, 1): AMPEL[row[1]] for r, row in enumerate(AKT_ROWS) if row[1] in AMPEL}
    TABLES = {'{{KI_BEGRUENDUNGEN}}': KI_BEG_TABLE,
        '{{DELTA_AMPEL}}': tbl(['MS', 'Meilenstein', 'Wechsel'],
            [['WS7-01', 'Kompensationsmodell VR-Vorlage', 'Gefährdet → Verzug']], [70, 250, 170]),
        '{{DELTA_FORTSCHRITT}}': tbl(['MS', 'Meilenstein', 'Δ'],
            [['WS2-03', 'MOS-Roadmap verabschiedet', '40 % → 55 %']], [70, 250, 170]),
        '{{DELTA_ERLEDIGT}}': tbl(['Nr', 'Handlung', 'Owner', 'am'],
            [['H-231', 'Lieferantenliste finalisiert', 'PMO', '06.08.2026']], [40, 280, 90, 80]),
        '{{DELTA_ENTSCHEIDE}}': tbl(['ID', 'Titel', 'Status'],
            [['E-2026-004', 'Eskalation WS7 an VR', 'entschieden']], [70, 320, 100]),
        '{{AKTIVITAET_TABELLE}}': {'header': ['Arbeitsstrom', 'Ampel', 'Aktivität der Woche'], 'rows': AKT_ROWS,
            'col_widths_pt': [150, 70, 270], 'header_bg': NAVY, 'cell_text_rgb': AKT_CTR},
        '{{COMMITMENTS_TABELLE}}': tbl(['Commitment', 'Owner', 'bis'],
            [['Kompensationsmodell-Skizze an VR', 'CoS', '11.08.2026'],
             ['Term-Sheet Brückenfinanzierung', 'CFO', '13.08.2026']], [300, 105, 85]),
        '{{ENTSCHEIDE_TABELLE}}': tbl(['Entscheid', 'Status'],
            [['Eskalation WS7 an VR [VR]', 'beschlossen'], ['Priorisierung FIN vor Skalierung', 'offen']], [405, 85])}
    BULLETS = {}

# 0) alte Bau-Artefakte trashen (idempotent iterierbar)
NAME = f'AXS {TITLE_WORD}-Report-Vorlage'
SAMPLE = f'{TYP.upper()}-REPORT-SAMPLE'
for q in [f"name contains '{NAME}'", f"name contains '{SAMPLE}'"]:
    r = drive.files().list(q=f"{q} and '{SCRATCH}' in parents and trashed=false",
                           supportsAllDrives=True, includeItemsFromAllDrives=True, fields='files(id)').execute()
    for f in r['files']:
        drive.files().update(fileId=f['id'], body={'trashed': True}, supportsAllDrives=True).execute()

# 1) BASIS kopieren
tid = drive.files().copy(fileId=BASE, body={'name': NAME, 'parents': [SCRATCH]},
                         supportsAllDrives=True, fields='id').execute()['id']

# 2) Body: {{BODY}} durch die Typ-Struktur ersetzen (Titel + Untertitel + Abschnitte)
struct = (f'{TITLE}\n'
          '{{UNTERTITEL}}  ·  Programm-Ampel {{PROGRAMM_AMPEL}}  ·  {{STAND}}\n'
          + ''.join(f'{h}\n{a}\n' for h, a in SECTIONS))
d = docs.documents().get(documentId=tid).execute()
body_idx = next(el['startIndex'] for el in d['body']['content']
                if el.get('paragraph') and '{{BODY}}' in ''.join(
                    e.get('textRun', {}).get('content', '') for e in el['paragraph'].get('elements', [])))
docs.documents().batchUpdate(documentId=tid, body={'requests': [
    {'insertText': {'location': {'index': body_idx}, 'text': struct}},
    {'replaceAllText': {'containsText': {'text': '{{BODY}}', 'matchCase': True}, 'replaceText': ''}}]}).execute()

# 2b) eingefügten Body normalisieren (Arial 10pt, nicht fett, dunkel)
d = docs.documents().get(documentId=tid).execute()
bend = d['body']['content'][-1]['endIndex']
docs.documents().batchUpdate(documentId=tid, body={'requests': [
    {'updateTextStyle': {'range': {'startIndex': 1, 'endIndex': bend - 1},
        'textStyle': {'bold': False, 'fontSize': {'magnitude': 10, 'unit': 'PT'},
                      'weightedFontFamily': {'fontFamily': 'Arial'},
                      'foregroundColor': {'color': {'rgbColor': DARK}}},
        'fields': 'bold,fontSize,weightedFontFamily,foregroundColor'}}]}).execute()

# 3) Marken-Styling per Text-Match (KEINE a×s-Zeile, KEIN Footer — kommen aus der Basis)
d = docs.documents().get(documentId=tid).execute()
paras = []
for el in d['body']['content']:
    p = el.get('paragraph')
    if not p:
        continue
    txt = ''.join(e.get('textRun', {}).get('content', '') for e in p.get('elements', [])).rstrip('\n')
    paras.append((el['startIndex'], el['endIndex'], txt.strip()))

H2 = {h for h, _ in SECTIONS if h != KIHEAD}
sreq = []
def ptext(s, e, style, fields):
    sreq.append({'updateTextStyle': {'range': {'startIndex': s, 'endIndex': max(s + 1, e - 1)}, 'textStyle': style, 'fields': fields}})
def pstyle(s, e, style, fields):
    sreq.append({'updateParagraphStyle': {'range': {'startIndex': s, 'endIndex': e}, 'paragraphStyle': style, 'fields': fields}})

for s, e, t in paras:
    if t == TITLE:
        pstyle(s, e, {'namedStyleType': 'HEADING_1', 'spaceAbove': {'magnitude': 0, 'unit': 'PT'}, 'spaceBelow': {'magnitude': 2, 'unit': 'PT'}}, 'namedStyleType,spaceAbove,spaceBelow')
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': NAVY}}, 'fontSize': {'magnitude': 16, 'unit': 'PT'}, 'bold': True}, 'foregroundColor,fontSize,bold')
    elif t.startswith('{{UNTERTITEL}}'):
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': MUTED}}, 'fontSize': {'magnitude': 10, 'unit': 'PT'}}, 'foregroundColor,fontSize')
        pstyle(s, e, {'borderBottom': {'color': {'color': {'rgbColor': NAVY}}, 'width': {'magnitude': 1, 'unit': 'PT'}, 'padding': {'magnitude': 4, 'unit': 'PT'}, 'dashStyle': 'SOLID'}, 'spaceBelow': {'magnitude': 10, 'unit': 'PT'}}, 'borderBottom,spaceBelow')
    elif t in H2 or t == KIHEAD:
        col = BRASS if t == KIHEAD else NAVY
        pstyle(s, e, {'namedStyleType': 'HEADING_2', 'spaceAbove': {'magnitude': 12, 'unit': 'PT'}, 'spaceBelow': {'magnitude': 3, 'unit': 'PT'}}, 'namedStyleType,spaceAbove,spaceBelow')
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': col}}, 'fontSize': {'magnitude': 11, 'unit': 'PT'}, 'bold': True}, 'foregroundColor,fontSize,bold')
if sreq:
    docs.documents().batchUpdate(documentId=tid, body={'requests': sreq}).execute()

print(f"{TYP.upper()}-TEMPLATE:", f"https://docs.google.com/document/d/{tid}/edit")

# 4) Sample-Render + Footer dynamisch füllen + neu exportieren
doc_id, _ = dt.render_doc_and_pdf(drive, docs, tid, SCRATCH, SAMPLE, VALS, TABLES, BULLETS)
docs.documents().batchUpdate(documentId=doc_id, body={'requests': [
    {'replaceAllText': {'containsText': {'text': '{{FOOTER}}', 'matchCase': True}, 'replaceText': FOOTER_TXT}}]}).execute()
pdf = drive.files().export(fileId=doc_id, mimeType='application/pdf').execute()
outp = f'/tmp/{TYP}_from_base.pdf'
open(outp, 'wb').write(pdf)
print(f"SAMPLE-DOC:", f"https://docs.google.com/document/d/{doc_id}/edit")
print(f"SAMPLE-PDF:", outp, len(pdf), "bytes")
