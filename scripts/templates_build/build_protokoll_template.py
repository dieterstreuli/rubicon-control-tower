#!/usr/bin/env python3
"""Sitzungsprotokoll-Vorlage aus der BASIS (Header-Logo + Footer-Seitenzahlen) ableiten — Weg 1.
Basis kopieren, Protokoll-Struktur an {{BODY}} einsetzen, Marken-Styling. Header/Footer/Seitenzahlen
kommen aus der Kopie — NICHT neu erzeugen. + Sample-Render (Footer dynamisch) zur Layout-Abnahme.

  python3 scripts/templates_build/build_protokoll_template.py

ENV: RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT (DWD als rubicon@).
Optional: RUBICON_TEMPLATE_BASE (Basis-Doc), RUBICON_TEMPLATE_BUILD_FOLDER (Scratch).

Consumer: gen_protokoll.protokoll_spec (Server-Zweig). Anker MUSS 1:1 dazu passen:
  Werte  : {{TITEL}}, {{DATUM}}, {{VORSITZ}}, {{ERFASSER}}, {{QUELLE}}, {{FOOTER}}
  Tabellen/Bullets: {{NOTIZEN}} (Bullets), {{FORTSCHRITT}}, {{COMMITMENTS}}, {{ENTSCHEIDE}} (Tabellen)
"""
import os
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts'))
sys.path.insert(0, str(REPO / 'scripts' / '_tools'))
from _google_auth import load_credentials
from googleapiclient.discovery import build
import doc_template as dt

creds = load_credentials()
drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
docs = build('docs', 'v1', credentials=creds, cache_discovery=False)

BASE = os.environ.get('RUBICON_TEMPLATE_BASE', '14MbGXFG8ZCQwqMnnW1fMJbLvpWGcx6SSiFivDsPqTNs')
SCRATCH = os.environ.get('RUBICON_TEMPLATE_BUILD_FOLDER', '1j7IY11kYizNQhccFuDv3gahCcqwCCpB-')
NAVY = {'red': 0.11764706, 'green': 0.24313726, 'blue': 0.34509805}
BRASS = {'red': 0.6901961, 'green': 0.49019608, 'blue': 0.17254902}
MUTED = {'red': 0.5411765, 'green': 0.5803922, 'blue': 0.65882355}
DARK = {'red': 0.102, 'green': 0.102, 'blue': 0.102}
FOOTER_TXT = ('Automatisch generiert aus der RUBICON-Plattform  ·  Sitzungsprotokoll'
              '  ·  Vertraulich — ExBoD / VR')
TITLE = 'Sitzungsprotokoll — {{TITEL}}'

# geordnete Abschnitte (Überschrift, Anker) — dynamische Einträge je Typ
SECTIONS = [('Zusammenfassung & Notizen', '{{NOTIZEN}}'),
            ('Fortschritt & Blocker', '{{FORTSCHRITT}}'),
            ('Commitments', '{{COMMITMENTS}}'),
            ('Entscheide', '{{ENTSCHEIDE}}')]

tbl = lambda header, rows, cw: {'header': header, 'rows': rows, 'col_widths_pt': cw, 'header_bg': NAVY}

# Sample-Daten (nur zur Layout-Abnahme)
VALS = {'TITEL': 'Steering Committee (SC) · 07.08.2026', 'DATUM': '07.08.2026',
        'VORSITZ': 'Dieter Streuli', 'ERFASSER': 'Gemini (Google Meet) → Import',
        'QUELLE': 'Quelle: Notizen von Gemini', 'FOOTER': FOOTER_TXT}
TABLES = {
    '{{FORTSCHRITT}}': tbl(['MS', 'Meldung'],
        [['WS7-02', 'Fortschritt → 40 %'], ['WS7-01', 'Blocker: Kompensationsmodell verzögert (+7 T)']], [70, 420]),
    '{{COMMITMENTS}}': tbl(['Commitment', 'Owner', 'bis'],
        [['Kompensationsmodell-Skizze an VR', 'CoS', '11.08.2026'],
         ['Term-Sheet Brückenfinanzierung', 'CFO', '13.08.2026']], [300, 105, 85]),
    '{{ENTSCHEIDE}}': tbl(['Entscheid', 'Status'],
        [['Eskalation WS7 an VR', 'entschieden'], ['Priorisierung FIN vor Skalierung', 'offen']], [405, 85])}
BULLETS = {'{{NOTIZEN}}': ['Zusammenfassung (Gemini): SC-Runde zur Lage WS7 und Refinanzierung.',
                           'VIE-Wegfall bleibt Schwerpunkt; Kompensation vor Overhead-Abbau.']}

NAME = 'AXS Sitzungsprotokoll-Vorlage'
SAMPLE = 'PROTOKOLL-SAMPLE'

# 0) alte Bau-Artefakte trashen (idempotent)
for q in [f"name contains '{NAME}'", f"name contains '{SAMPLE}'"]:
    r = drive.files().list(q=f"{q} and '{SCRATCH}' in parents and trashed=false",
                           supportsAllDrives=True, includeItemsFromAllDrives=True, fields='files(id)').execute()
    for f in r['files']:
        drive.files().update(fileId=f['id'], body={'trashed': True}, supportsAllDrives=True).execute()

# 1) BASIS kopieren
tid = drive.files().copy(fileId=BASE, body={'name': NAME, 'parents': [SCRATCH]},
                         supportsAllDrives=True, fields='id').execute()['id']

# 2) Body: {{BODY}} durch die Protokoll-Struktur ersetzen (Titel + Meta + Abschnitte)
struct = (f'{TITLE}\n'
          '{{DATUM}}  ·  Vorsitz: {{VORSITZ}}  ·  Erfasst von: {{ERFASSER}}  ·  {{QUELLE}}\n'
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

H2 = {h for h, _ in SECTIONS}
sreq = []
def ptext(s, e, style, fields):
    sreq.append({'updateTextStyle': {'range': {'startIndex': s, 'endIndex': max(s + 1, e - 1)}, 'textStyle': style, 'fields': fields}})
def pstyle(s, e, style, fields):
    sreq.append({'updateParagraphStyle': {'range': {'startIndex': s, 'endIndex': e}, 'paragraphStyle': style, 'fields': fields}})

for s, e, t in paras:
    if t == TITLE:
        pstyle(s, e, {'namedStyleType': 'HEADING_1', 'spaceAbove': {'magnitude': 0, 'unit': 'PT'}, 'spaceBelow': {'magnitude': 2, 'unit': 'PT'}}, 'namedStyleType,spaceAbove,spaceBelow')
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': NAVY}}, 'fontSize': {'magnitude': 16, 'unit': 'PT'}, 'bold': True}, 'foregroundColor,fontSize,bold')
    elif t.startswith('{{DATUM}}'):
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': MUTED}}, 'fontSize': {'magnitude': 10, 'unit': 'PT'}}, 'foregroundColor,fontSize')
        pstyle(s, e, {'borderBottom': {'color': {'color': {'rgbColor': NAVY}}, 'width': {'magnitude': 1, 'unit': 'PT'}, 'padding': {'magnitude': 4, 'unit': 'PT'}, 'dashStyle': 'SOLID'}, 'spaceBelow': {'magnitude': 10, 'unit': 'PT'}}, 'borderBottom,spaceBelow')
    elif t in H2:
        pstyle(s, e, {'namedStyleType': 'HEADING_2', 'spaceAbove': {'magnitude': 12, 'unit': 'PT'}, 'spaceBelow': {'magnitude': 3, 'unit': 'PT'}}, 'namedStyleType,spaceAbove,spaceBelow')
        ptext(s, e, {'foregroundColor': {'color': {'rgbColor': NAVY}}, 'fontSize': {'magnitude': 11, 'unit': 'PT'}, 'bold': True}, 'foregroundColor,fontSize,bold')
if sreq:
    docs.documents().batchUpdate(documentId=tid, body={'requests': sreq}).execute()

print("PROTOKOLL-TEMPLATE:", f"https://docs.google.com/document/d/{tid}/edit")

# 4) Sample-Render — {{FOOTER}} wird über VALS gefüllt (der Scan trifft auch den Footer-Bereich der Basis)
doc_id, _ = dt.render_doc_and_pdf(drive, docs, tid, SCRATCH, SAMPLE, VALS, TABLES, BULLETS)
pdf = drive.files().export(fileId=doc_id, mimeType='application/pdf').execute()
outp = '/tmp/protokoll_from_base.pdf'
open(outp, 'wb').write(pdf)
print("SAMPLE-DOC:", f"https://docs.google.com/document/d/{doc_id}/edit")
print("SAMPLE-PDF:", outp, len(pdf), "bytes")
