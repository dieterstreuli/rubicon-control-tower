#!/usr/bin/env python3
"""Basis-Template (Grundlage) bauen: Logo im Header (jede Seite) + {{FOOTER}}-Fußzeile (dynamisch)
+ leerer Body-Platzhalter. Seitenzahlen fügt Gordon danach MANUELL ein (API-unfähig). Pro-Typ-
Vorlagen kopieren diese Basis und bauen nur den Body. ENV: DWD (rubicon@)."""
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts'))
sys.path.insert(0, str(REPO / 'scripts' / '_tools'))
from _google_auth import load_credentials
from googleapiclient.discovery import build

creds = load_credentials()
drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
docs = build('docs', 'v1', credentials=creds, cache_discovery=False)

TPL_DIR = '1e7vQKQl3TbQMF7ae9WY65bMFg-8u-WOV'   # Templates (Shared Drive 00 AXS - Rubicon)
BRIEF = '1XgqsqnGVPXBOoRMM-dqp0KlqjsNrz2tziDgtq2shM8g'  # Branding-Basis (erbt Named-Styles/Page-Setup)
LOGO_ID = '1MC-FUqzmXsk1ByMS0wxgr048yiqK79-C'  # axs-logo.png im Templates-Ordner
NAVY = {'red': 0.11764706, 'green': 0.24313726, 'blue': 0.34509805}
MUTED = {'red': 0.5411765, 'green': 0.5803922, 'blue': 0.65882355}

# Logo wird MANUELL von Gordon eingefügt (org sperrt script-basierte öffentliche Bilder:
# publishOutNotPermitted). Wortmarke liegt in Templates: axs-wordmark.png / -navy.png.

# alte Basis trashen (idempotent iterierbar)
r = drive.files().list(q=f"name='AXS Report-Basis (Grundlage)' and '{TPL_DIR}' in parents and trashed=false",
                       supportsAllDrives=True, includeItemsFromAllDrives=True, fields='files(id)').execute()
for f in r['files']:
    drive.files().update(fileId=f['id'], body={'trashed': True}, supportsAllDrives=True).execute()

# Basis = Kopie der Briefing-Vorlage
bid = drive.files().copy(fileId=BRIEF, body={'name': 'AXS Report-Basis (Grundlage)', 'parents': [TPL_DIR]},
                         supportsAllDrives=True, fields='id').execute()['id']

# Body leeren + Ränder + Body-Platzhalter
d = docs.documents().get(documentId=bid).execute()
end = d['body']['content'][-1]['endIndex']
reqs = [{'updateDocumentStyle': {'documentStyle': {
    'marginLeft': {'magnitude': 50, 'unit': 'PT'}, 'marginRight': {'magnitude': 50, 'unit': 'PT'},
    'marginTop': {'magnitude': 46, 'unit': 'PT'}, 'marginBottom': {'magnitude': 40, 'unit': 'PT'}},
    'fields': 'marginLeft,marginRight,marginTop,marginBottom'}}]
if end - 1 > 1:
    reqs.append({'deleteContentRange': {'range': {'startIndex': 1, 'endIndex': end - 1}}})
reqs.append({'insertText': {'location': {'index': 1}, 'text': '{{BODY}}\n'}})
docs.documents().batchUpdate(documentId=bid, body={'requests': reqs}).execute()

# {{BODY}}-Platzhalter normalisieren (sonst erbt er den 22pt-bold-Stil der briefings-a×s-Marke)
d = docs.documents().get(documentId=bid).execute()
bend = d['body']['content'][-1]['endIndex']
if bend - 1 > 1:
    docs.documents().batchUpdate(documentId=bid, body={'requests': [
        {'updateTextStyle': {'range': {'startIndex': 1, 'endIndex': bend - 1},
            'textStyle': {'bold': False, 'fontSize': {'magnitude': 11, 'unit': 'PT'}, 'weightedFontFamily': {'fontFamily': 'Arial'},
                          'foregroundColor': {'color': {'rgbColor': {'red': 0.102, 'green': 0.102, 'blue': 0.102}}}},
            'fields': 'bold,fontSize,weightedFontFamily,foregroundColor'}}]}).execute()

# Leerer, rechtsbündiger Header — Gordon fügt die a×s-Wortmarke oben-rechts MANUELL ein.
hid = docs.documents().batchUpdate(documentId=bid, body={'requests': [{'createHeader': {'type': 'DEFAULT'}}]}).execute()['replies'][0]['createHeader']['headerId']
hd = docs.documents().get(documentId=bid).execute()
for el in hd['headers'][hid]['content']:
    if el.get('paragraph') and 'endIndex' in el:
        docs.documents().batchUpdate(documentId=bid, body={'requests': [
            {'updateParagraphStyle': {'range': {'segmentId': hid, 'startIndex': el.get('startIndex', 0), 'endIndex': el['endIndex']},
                'paragraphStyle': {'alignment': 'END'}, 'fields': 'alignment'}}]}).execute()
        break

# Footer mit dynamischem {{FOOTER}}-Platzhalter (Gordon ergänzt danach Seitenzahlen manuell)
fid = docs.documents().batchUpdate(documentId=bid, body={'requests': [{'createFooter': {'type': 'DEFAULT'}}]}).execute()['replies'][0]['createFooter']['footerId']
FOOT = '{{FOOTER}}'
docs.documents().batchUpdate(documentId=bid, body={'requests': [
    {'insertText': {'location': {'segmentId': fid, 'index': 0}, 'text': FOOT}},
    {'updateTextStyle': {'range': {'segmentId': fid, 'startIndex': 0, 'endIndex': len(FOOT)},
        'textStyle': {'fontSize': {'magnitude': 8, 'unit': 'PT'}, 'weightedFontFamily': {'fontFamily': 'Arial'},
                      'foregroundColor': {'color': {'rgbColor': MUTED}}}, 'fields': 'fontSize,weightedFontFamily,foregroundColor'}},
    {'updateParagraphStyle': {'range': {'segmentId': fid, 'startIndex': 0, 'endIndex': len(FOOT)},
        'paragraphStyle': {'alignment': 'CENTER', 'borderTop': {'color': {'color': {'rgbColor': MUTED}}, 'width': {'magnitude': 0.5, 'unit': 'PT'}, 'padding': {'magnitude': 4, 'unit': 'PT'}, 'dashStyle': 'SOLID'}},
        'fields': 'alignment,borderTop'}},
]}).execute()

print("BASIS:", bid)
print("LINK:", f"https://docs.google.com/document/d/{bid}/edit")
