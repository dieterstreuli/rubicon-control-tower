#!/usr/bin/env python3
"""Bestehende 4 gebrandete Vorlagen (traktanden/entscheide/briefings/fuehrungsrhythmus) auf die
BASIS heben: Basis kopieren (Logo-Header jede Seite + Footer-Seitenzahlen + {{FOOTER}}), bisherigen
Body (OHNE „a×s"-Zeile, OHNE inline-Footer-Absatz) an {{BODY}} einsetzen, Original-Styling anwenden
(minus logo/footer), Footer-Disclaimer als {{FOOTER}}-Wert (dynamisch, echter Engine-Pfad).
Rendert je Typ ein echtes Sample → /tmp/<typ>_migrated.pdf. ENV: DWD als rubicon@.

  python3 scripts/templates_build/build_fixed_templates.py [traktanden|entscheide|briefings|fuehrungsrhythmus|all]

ENV: RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT (DWD als rubicon@).
Optional: RUBICON_TEMPLATE_BASE (Basis-Doc), RUBICON_TEMPLATE_BUILD_FOLDER (Scratch).
"""
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / '_tools'))
sys.path.insert(0, str(REPO / 'scripts'))
import yaml
from _google_auth import load_credentials
from googleapiclient.discovery import build
import doc_template as dt
from _templates import AXS_BLUE, heading_text_style, body_text_style

BASE = os.environ.get('RUBICON_TEMPLATE_BASE', '14MbGXFG8ZCQwqMnnW1fMJbLvpWGcx6SSiFivDsPqTNs')
SCRATCH = os.environ.get('RUBICON_TEMPLATE_BUILD_FOLDER', '1j7IY11kYizNQhccFuDv3gahCcqwCCpB-')
GREY = {"red": 0x5a / 255, "green": 0x65 / 255, "blue": 0x70 / 255}
BRASS = {"red": 0xb0 / 255, "green": 0x7d / 255, "blue": 0x2c / 255}
CALLOUT_BG = {"red": 0xF5 / 255, "green": 0xF7 / 255, "blue": 0xFA / 255}
BAND_BG = {"red": 0xee / 255, "green": 0xf2 / 255, "blue": 0xf6 / 255}
DARK = {'red': 0.102, 'green': 0.102, 'blue': 0.102}

creds = load_credentials()
drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
docs = build('docs', 'v1', credentials=creds, cache_discovery=False)


# ── Styling-Helfer (auf EINEM Doc-Snapshot; Styling verschiebt keine Indizes) ──
def para_range(doc, needle):
    for el in doc.get('body', {}).get('content', []):
        if 'paragraph' not in el:
            continue
        txt = ''.join(e.get('textRun', {}).get('content', '') for e in el['paragraph'].get('elements', []))
        if needle in txt:
            return el['startIndex'], el['endIndex']
    raise ValueError(f'Paragraph mit "{needle}" nicht gefunden')


def T(s, e, style, fields):
    return {"updateTextStyle": {"range": {"startIndex": s, "endIndex": e}, "textStyle": style, "fields": fields}}


def P(s, e, style, fields):
    return {"updateParagraphStyle": {"range": {"startIndex": s, "endIndex": e}, "paragraphStyle": style, "fields": fields}}


def title(doc, needle):
    s, e = para_range(doc, needle)
    return [T(s, e, heading_text_style(1), "bold,weightedFontFamily,fontSize,foregroundColor"),
            P(s, e, {"spaceBelow": {"magnitude": 2, "unit": "PT"}}, "spaceBelow")]


def subtitle(doc, needle):
    s, e = para_range(doc, needle)
    return [T(s, e, {"weightedFontFamily": {"fontFamily": "Arial", "weight": 400}, "fontSize": {"magnitude": 9.5, "unit": "PT"},
                     "foregroundColor": {"color": {"rgbColor": GREY}}}, "weightedFontFamily,fontSize,foregroundColor"),
            P(s, e, {"borderBottom": {"color": {"color": {"rgbColor": AXS_BLUE}}, "width": {"magnitude": 1, "unit": "PT"},
                     "padding": {"magnitude": 4, "unit": "PT"}, "dashStyle": "SOLID"}, "spaceBelow": {"magnitude": 8, "unit": "PT"}},
              "borderBottom,spaceBelow")]


def h2(doc, needle):
    s, e = para_range(doc, needle)
    return [T(s, e, heading_text_style(2), "bold,weightedFontFamily,fontSize,foregroundColor"),
            P(s, e, {"spaceAbove": {"magnitude": 6, "unit": "PT"}, "spaceBelow": {"magnitude": 2, "unit": "PT"}}, "spaceAbove,spaceBelow")]


def h3(doc, needle):
    s, e = para_range(doc, needle)
    return [T(s, e, heading_text_style(3), "bold,weightedFontFamily,fontSize"),
            T(s, e, {"foregroundColor": {"color": {"rgbColor": AXS_BLUE}}}, "foregroundColor"),
            P(s, e, {"spaceAbove": {"magnitude": 5, "unit": "PT"}, "spaceBelow": {"magnitude": 1, "unit": "PT"}}, "spaceAbove,spaceBelow")]


def label_line(doc, needle, label):
    s, e = para_range(doc, needle)
    return [T(s, e, body_text_style(), "weightedFontFamily,fontSize"),
            T(s, s + len(label), {"bold": True}, "bold")]


def body(doc, needle, pt=10):
    s, e = para_range(doc, needle)
    return [T(s, e, {"weightedFontFamily": {"fontFamily": "Arial", "weight": 400}, "fontSize": {"magnitude": pt, "unit": "PT"}}, "weightedFontFamily,fontSize")]


def grey_line(doc, needle, pt=8.5):
    s, e = para_range(doc, needle)
    return [T(s, e, {"weightedFontFamily": {"fontFamily": "Arial", "weight": 400}, "fontSize": {"magnitude": pt, "unit": "PT"},
                     "foregroundColor": {"color": {"rgbColor": GREY}}}, "weightedFontFamily,fontSize,foregroundColor")]


def callout(doc, needle, label):
    s, e = para_range(doc, needle)
    return [T(s, e, {"weightedFontFamily": {"fontFamily": "Arial", "weight": 400}, "fontSize": {"magnitude": 10, "unit": "PT"}}, "weightedFontFamily,fontSize"),
            T(s, s + len(label), {"bold": True, "foregroundColor": {"color": {"rgbColor": AXS_BLUE}}}, "bold,foregroundColor"),
            P(s, e, {"shading": {"backgroundColor": {"color": {"rgbColor": CALLOUT_BG}}},
                     "borderLeft": {"color": {"color": {"rgbColor": BRASS}}, "width": {"magnitude": 2.5, "unit": "PT"},
                                    "padding": {"magnitude": 6, "unit": "PT"}, "dashStyle": "SOLID"},
                     "indentStart": {"magnitude": 8, "unit": "PT"}, "spaceAbove": {"magnitude": 4, "unit": "PT"},
                     "spaceBelow": {"magnitude": 8, "unit": "PT"}}, "shading,borderLeft,indentStart,spaceAbove,spaceBelow")]


# ── Typ-Definitionen: Body-STRUCT (ohne a×s, ohne inline-Footer), Styling, Footer-Text, Sample ──
def style_traktanden(doc):
    r = []
    r += title(doc, 'Traktandenliste')
    r += subtitle(doc, 'Projekt RUBICON')
    for lbl in ('Vorsitz:', 'Teilnehmer:'):
        r += label_line(doc, lbl, lbl)
    r += callout(doc, 'Stehende Regel:', 'Stehende Regel:')
    r += h2(doc, 'TRAKTANDEN')
    return r


def sample_traktanden():
    a = json.load(open(os.path.join(REPO, 'src/data/traktanden.json')))['agendas'][0]
    values = {'MEETING_ID': a.get('meeting_id'), 'DAUER': a.get('dauer'), 'VORSITZ': a.get('vorsitz'),
              'TEILNEHMER': a.get('teilnehmer'), 'STANDING_RULE': a.get('standing_rule')}
    tps = a.get('traktanden') or []
    tables = {'{{BODY_TRAKTANDEN}}': {'header': ['#', 'Traktandum', 'Output → wohin'],
        'rows': [[str(i + 1), tp.get('titel', ''), tp.get('output', '')] for i, tp in enumerate(tps)],
        'col_widths_pt': [26, 300, 125], 'header_bg': AXS_BLUE}}
    return values, tables, None


def style_entscheid(doc):
    r = []
    r += title(doc, 'Entscheid {{REGISTER_ID}}')
    r += subtitle(doc, 'AXS Group · Auszug')
    r += callout(doc, 'Beschluss:', 'Beschluss:')
    for lbl in ('Register-ID:', 'Entscheidungstyp:', 'Zuständiges Gremium:', 'Antragsteller:', 'Entscheid-Datum:', 'Status:'):
        r += label_line(doc, lbl, lbl)
    r += h3(doc, 'Begründung')
    r += body(doc, '{{BEGRUENDUNG}}')
    r += h3(doc, 'Datengrundlage')
    r += body(doc, '{{DATENGRUNDLAGE}}')
    r += label_line(doc, 'Quelle:', 'Quelle:')
    return r


def sample_entscheid():
    e = json.load(open(os.path.join(REPO, 'src/data/entscheide.json')))['entscheide'][0]
    values = {'REGISTER_ID': e.get('id'), 'TITEL': e.get('titel'), 'BESCHLUSS': e.get('entscheid'),
              'TYP': e.get('typ'), 'GREMIUM': e.get('gremium'), 'ANTRAGSTELLER': e.get('antragsteller'),
              'DATUM': e.get('datum'), 'STATUS': e.get('status'), 'BEGRUENDUNG': e.get('begruendung'),
              'DATENGRUNDLAGE': e.get('datengrundlage'), 'QUELLE': e.get('quelle') or 'direkte Register-Erfassung'}
    return values, None, None


def style_briefing(doc):
    r = []
    r += grey_line(doc, '{{MS_ID}} ·', pt=8)
    r += title(doc, '{{NAME}}')
    r += subtitle(doc, 'Owner-Briefing · Projekt RUBICON')
    for lbl in ('Owner:', 'Beteiligte:', 'Start:', 'Abhängig von:', 'Merkmale:'):
        r += label_line(doc, lbl, lbl)
    r += callout(doc, 'ZIEL IM KLARTEXT:', 'ZIEL IM KLARTEXT:')
    for hdr in ('KONTEXT — WARUM', 'ERWARTETE LEISTUNG', 'VORGEHEN', 'ERFOLGSMESSUNG (KPI)', 'RISIKEN & ABHÄNGIGKEITEN', 'DATENGRUNDLAGE'):
        r += h2(doc, hdr)
    r += body(doc, '{{KONTEXT}}')
    r += body(doc, '{{ERFOLGSMESSUNG}}')
    r += grey_line(doc, '{{GROUNDING}}')
    return r


def sample_briefing():
    proj = yaml.safe_load(open(os.path.join(REPO, 'src/data/projekt.yaml')))
    m, wsn = None, None
    for ws in proj['workstreams']:
        for mm in ws['milestones']:
            if mm['id'] == 'M01':
                m, wsn = mm, f"{ws['code']} — {ws['name']}"
    b = json.load(open(os.path.join(REPO, 'src/data/briefings.json'))).get('M01') or {}
    flags = []
    if m.get('gate'):
        flags.append(f"Gate {m['gate']}")
    if m.get('critical'):
        flags.append('kritischer Pfad ◆')
    if m.get('nachlauf'):
        flags.append('gesetzlicher Nachlauf ⏳')
    prog = m.get('progress')
    values = {'MS_ID': m['id'], 'WS_NAME': wsn, 'PRIO': m.get('prio') or '—',
              'MSTATUS': 'offen' if not isinstance(prog, (int, float)) or prog < 100 else 'erledigt',
              'QUARTAL': m.get('quarter') or m.get('phase') or '—', 'NAME': m.get('name'),
              'OWNER': m.get('owner') or 'zu klären', 'BETEILIGTE': b.get('beteiligte') or 'zu klären',
              'START': m.get('start') or '—', 'DUE': m.get('due') or '—',
              'DEPS': ', '.join(m.get('depends_on') or []) or '—', 'FLAGS': ' · '.join(flags) or '—',
              'ZIEL_KLARTEXT': b.get('ziel_klartext') or 'zu klären', 'KONTEXT': b.get('kontext') or 'zu klären',
              'ERFOLGSMESSUNG': b.get('erfolgsmessung') or m.get('kpi') or 'zu klären', 'GROUNDING': b.get('grounding') or '—'}
    bull = {'{{BODY_LEISTUNG}}': b.get('leistung') or ['zu klären'],
            '{{BODY_VORGEHEN}}': {'items': b.get('vorgehen') or ['zu klären'], 'ordered': True},
            '{{BODY_RISIKEN}}': b.get('risiken') or ['zu klären']}
    return values, None, bull


def style_fr(doc):
    r = []
    r += title(doc, '{{TITEL}}')
    r += subtitle(doc, '{{UNTERTITEL}}')
    r += h2(doc, 'Grundsätze')
    return r


def sample_fr():
    fr = json.load(open(os.path.join(REPO, 'src/data/fuehrungsrhythmus.json')))
    values = {'TITEL': fr['titel'], 'UNTERTITEL': fr['untertitel']}
    rows = []
    for g in fr['gruppen']:
        rows.append({'group': g['kadenz'], 'bg': BAND_BG, 'text_rgb': AXS_BLUE})
        for mm in g['meetings']:
            rows.append([mm['name'], mm['wann'], mm['teilnehmer'], mm['zweck'], mm['output']])
    # Landscape A4: usable = 841.89 - 2*50 = 741.89pt -> Spaltensumme MUSS darunter bleiben (sonst
    # ragt die Tabelle über den Seitenrand). Summe hier = 725pt.
    tables = {'{{BODY_RHYTHMUS}}': {'header': ['Meeting', 'Wann', 'Mit wem', 'Zweck', 'Output-Erwartung → wohin'],
        'rows': rows, 'col_widths_pt': [95, 80, 150, 210, 190], 'header_bg': AXS_BLUE}}
    bull = {'{{BODY_GRUNDSAETZE}}': fr.get('grundsaetze') or []}
    return values, tables, bull


TYPES = {
    'traktanden': dict(name='AXS Traktanden-Vorlage (RUBICON, gebrandet)', landscape=False,
        struct=("Traktandenliste — {{MEETING_ID}}\n{{DAUER}} · Projekt RUBICON\n\n"
                "Vorsitz: {{VORSITZ}}\nTeilnehmer: {{TEILNEHMER}}\n\n"
                "Stehende Regel: {{STANDING_RULE}}\n\nTRAKTANDEN\n{{BODY_TRAKTANDEN}}\n"),
        footer='Automatisch generiert aus dem Traktanden-Register (traktanden.json)  ·  Vertraulich — ExBoD / VR',
        style=style_traktanden, sample=sample_traktanden),
    'entscheide': dict(name='AXS Entscheid-Vorlage (RUBICON, gebrandet)', landscape=False,
        struct=("Entscheid {{REGISTER_ID}} — {{TITEL}}\nEntscheids-Register AXS Group · Auszug\n\n"
                "Beschluss: {{BESCHLUSS}}\n\nRegister-ID: {{REGISTER_ID}}\nEntscheidungstyp: {{TYP}}\n"
                "Zuständiges Gremium: {{GREMIUM}}\nAntragsteller: {{ANTRAGSTELLER}}\nEntscheid-Datum: {{DATUM}}\n"
                "Status: {{STATUS}}\n\nBegründung\n{{BEGRUENDUNG}}\n\nDatengrundlage\n{{DATENGRUNDLAGE}}\nQuelle: {{QUELLE}}\n"),
        footer='Automatisch generiert aus dem Entscheids-Register (entscheide.json).  Revisionssicher — Entscheide werden nie gelöscht.  Vertraulich — ExBoD / VR',
        style=style_entscheid, sample=sample_entscheid),
    'briefings': dict(name='AXS Briefing-Vorlage (RUBICON, gebrandet)', landscape=False,
        struct=("{{MS_ID}} · {{WS_NAME}} · Priorität {{PRIO}} · Status {{MSTATUS}} · {{QUARTAL}}\n{{NAME}}\n"
                "Owner-Briefing · Projekt RUBICON\n\nOwner: {{OWNER}}\nBeteiligte: {{BETEILIGTE}}\n"
                "Start: {{START}} · Fällig bis: {{DUE}}\nAbhängig von: {{DEPS}}\nMerkmale: {{FLAGS}}\n\n"
                "ZIEL IM KLARTEXT: {{ZIEL_KLARTEXT}}\n\nKONTEXT — WARUM DIESER MILESTONE\n{{KONTEXT}}\n\n"
                "ERWARTETE LEISTUNG (DELIVERABLES)\n{{BODY_LEISTUNG}}\n\nVORGEHEN\n{{BODY_VORGEHEN}}\n\n"
                "ERFOLGSMESSUNG (KPI)\n{{ERFOLGSMESSUNG}}\n\nRISIKEN & ABHÄNGIGKEITEN\n{{BODY_RISIKEN}}\n\n"
                "DATENGRUNDLAGE\n{{GROUNDING}}\n"),
        footer='Projekt RUBICON («Alea iacta est.»)  ·  Owner-Briefing  ·  automatisch generiert aus briefings.json  ·  Vertraulich — ExBoD / VR',
        style=style_briefing, sample=sample_briefing),
    'fuehrungsrhythmus': dict(name='AXS Führungsrhythmus-Vorlage (RUBICON, gebrandet)', landscape=True,
        struct=("{{TITEL}}\n{{UNTERTITEL}}\n{{BODY_RHYTHMUS}}\n\nGrundsätze\n{{BODY_GRUNDSAETZE}}\n"),
        footer='Projekt RUBICON («Alea iacta est.»)  ·  Führungsrhythmus-One-Pager  ·  automatisch generiert aus fuehrungsrhythmus.json  ·  Vertraulich — ExBoD / VR',
        style=style_fr, sample=sample_fr),
}


def build_one(typ):
    cfg = TYPES[typ]
    # alte Artefakte trashen
    for q in [f"name='{cfg['name']}'", f"name contains 'MIG-{typ.upper()}'"]:
        r = drive.files().list(q=f"{q} and '{SCRATCH}' in parents and trashed=false",
                               supportsAllDrives=True, includeItemsFromAllDrives=True, fields='files(id)').execute()
        for f in r['files']:
            drive.files().update(fileId=f['id'], body={'trashed': True}, supportsAllDrives=True).execute()
    # Basis kopieren
    tid = drive.files().copy(fileId=BASE, body={'name': cfg['name'], 'parents': [SCRATCH]},
                             supportsAllDrives=True, fields='id').execute()['id']
    reqs = []
    if cfg['landscape']:
        reqs.append({'updateDocumentStyle': {'documentStyle': {'pageSize': {
            'width': {'magnitude': 841.89, 'unit': 'PT'}, 'height': {'magnitude': 595.28, 'unit': 'PT'}}}, 'fields': 'pageSize'}})
    d = docs.documents().get(documentId=tid).execute()
    body_idx = next(el['startIndex'] for el in d['body']['content']
                    if el.get('paragraph') and '{{BODY}}' in ''.join(
                        e.get('textRun', {}).get('content', '') for e in el['paragraph'].get('elements', [])))
    reqs += [{'insertText': {'location': {'index': body_idx}, 'text': cfg['struct']}},
             {'replaceAllText': {'containsText': {'text': '{{BODY}}', 'matchCase': True}, 'replaceText': ''}}]
    docs.documents().batchUpdate(documentId=tid, body={'requests': reqs}).execute()
    # Body auf 11pt-Master normalisieren (Styling überschreibt Überschriften/Labels)
    d = docs.documents().get(documentId=tid).execute()
    bend = d['body']['content'][-1]['endIndex']
    docs.documents().batchUpdate(documentId=tid, body={'requests': [
        {'updateTextStyle': {'range': {'startIndex': 1, 'endIndex': bend - 1},
            'textStyle': {'bold': False, 'fontSize': {'magnitude': 11, 'unit': 'PT'},
                          'weightedFontFamily': {'fontFamily': 'Arial'}, 'foregroundColor': {'color': {'rgbColor': DARK}}},
            'fields': 'bold,fontSize,weightedFontFamily,foregroundColor'}}]}).execute()
    # Original-Styling (minus logo/footer)
    d = docs.documents().get(documentId=tid).execute()
    sreq = cfg['style'](d)
    if sreq:
        docs.documents().batchUpdate(documentId=tid, body={'requests': sreq}).execute()
    print(f"{typ.upper()}-TEMPLATE: https://docs.google.com/document/d/{tid}/edit")
    # Sample rendern (FOOTER dynamisch via Engine-Scan); Sample-Doc BEHALTEN (Gordon-Review)
    values, tables, bullets = cfg['sample']()
    values = dict(values, FOOTER=cfg['footer'])
    sdoc, pdf = dt.render_doc_and_pdf(drive, docs, tid, SCRATCH, f'MIG-{typ.upper()}', values, tables=tables, bullets=bullets)
    outp = f'/tmp/{typ}_migrated.pdf'
    open(outp, 'wb').write(pdf)
    print(f"  SAMPLE-DOC: https://docs.google.com/document/d/{sdoc}/edit  ({len(pdf)} bytes)")


which = sys.argv[1] if len(sys.argv) > 1 else 'all'
for t in ([which] if which != 'all' else list(TYPES)):
    build_one(t)
