#!/usr/bin/env python3
"""gen_protokoll.py <protokoll_id> — rendert ein erfasstes Sitzungsprotokoll als
PDF (public/protokolle/<id>.pdf) UND als Google Doc (Drive: RUBICON —
Sitzungsprotokolle), aus src/data/protokolle.json. Schreibt die Export-Links
zurück in den Datensatz (record.export). Idempotent (Doc via gespeicherte ID).

Gibt als LETZTE stdout-Zeile ein JSON {ok, pdf, doc_id, doc_url} aus (für die API).
"""
import datetime
import html
import json
import os
import re
import subprocess
import sys
import tempfile


from pathlib import Path
sys.path.insert(0, __file__.rsplit('/', 1)[0])                  # _lib (Q6)
from _lib import atomic_write as _atomic_write, docs_dir  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

MD2GDOC = '/Users/dieterstreuli/Chief/Tools/md_to_gdoc.py'
import os as _os
if not _os.path.exists(MD2GDOC):
    MD2GDOC = __file__.rsplit('/', 1)[0] + '/_tools/md_to_gdoc.py'  # vendored (Portabilität)
PARENT = '16eHUDx59O5_nR3wIcDim7OhEqlg86jB0'  # Drive: RUBICON — Sitzungsprotokolle
PROTO = ROOT / 'src' / 'data' / 'protokolle.json'
OUT = Path(docs_dir('protokolle', ROOT))
LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
STAMP = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')


def e(s):
    return html.escape(str(s or ''))


def de_date(s):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(s or ''))
    return f'{m.group(3)}.{m.group(2)}.{m.group(1)}' if m else (s or '')


def by(rec, typ):
    return [x for x in rec.get('eintraege', []) if x.get('typ') == typ]


def _is_server():
    """Server-Betrieb (Web-App/Cloud Run) an der keyless-DWD-Env erkennen — wie gen_report."""
    return bool(os.environ.get('RUBICON_WORKSPACE_SA') and os.environ.get('RUBICON_IMPERSONATE_SUBJECT'))


# Server-Ziel (Weg 1): der Shared-Drive-Ordner „RUBICON — Sitzungsprotokolle" (Shared Drive „00 AXS -
# Rubicon", Geschwister zu Reports/Templates) — rubicon@ ist dort schreibberechtigt. NICHT der lokale
# PARENT: der ist Dieters PERSÖNLICHER Drive-Ordner (nur über seine OAuth erreichbar; DWD-rubicon@ = 404).
# Der lokale md->gdoc-Zweig nutzt weiter PARENT; nur der Server-Zweig geht hierher (Override per Env).
SERVER_PROTOKOLLE_FOLDER = '1jX2CYbfTJP4P9Na1zpy6fimNamSY1oo7'


def _protokolle_folder():
    return os.environ.get('RUBICON_DRIVE_PROTOKOLLE_FOLDER', SERVER_PROTOKOLLE_FOLDER)


# ---------- protokoll_spec: Protokoll-Daten -> Template-Engine (Weg 1, Server) ----------
# Server rendert das Protokoll aus der gebrandeten {{ANKER}}-Vorlage (statt md->gdoc, der 3. Weg).
# Die Anker-Namen MÜSSEN 1:1 zu templates_build/build_protokoll_template.py passen:
#   Werte : {{TITEL}} {{DATUM}} {{VORSITZ}} {{ERFASSER}} {{QUELLE}} {{FOOTER}}
#   Bullets: {{NOTIZEN}} · Tabellen: {{FORTSCHRITT}} {{COMMITMENTS}} {{ENTSCHEIDE}}
# Spaltenbreiten Portrait: nutzbar ~490pt (jede Tabellensumme <= 490).
NAVY = {'red': 0x1E / 255, 'green': 0x3E / 255, 'blue': 0x58 / 255}
PROTOKOLL_FOOTER = ('Automatisch generiert aus der RUBICON-Plattform  ·  Sitzungsprotokoll'
                    '  ·  Vertraulich — ExBoD / VR')


def _s(v, default='—'):
    """None-sichere String-Koerzierung fuers Doc (kein rohes 'None' im Protokoll)."""
    return default if v is None else str(v)


def _tbl(header, rows, widths):
    return {'header': header, 'rows': rows, 'col_widths_pt': widths, 'header_bg': NAVY}


def protokoll_spec(rec):
    """Protokoll-Datensatz -> {name, values, tables, bullets} für die Protokoll-Vorlage (Weg 1).
    Deckt alle Einträge des lokalen HTML-/MD-Reports ab: Notizen als Bullets, Fortschritt UND Blocker
    gemeinsam als «MS / Meldung», Commitments und Entscheide als eigene Tabellen. Die lokale
    «Wirkung im Tower»-Zusammenfassung (ms→% / +T) ist hier redundant in der Fortschritt-/Blocker-
    Tabelle enthalten und bekommt daher keine eigene Zeile (die abgenommene Vorlage hat keinen Anker)."""
    ent, com = by(rec, 'entscheid'), by(rec, 'commitment')
    fort, blo, notiz = by(rec, 'fortschritt'), by(rec, 'blocker'), by(rec, 'notiz')
    quelle = f"{_s(rec.get('id'), '')} · Projekt RUBICON"
    if rec.get('source'):
        quelle = f"Quelle: {rec.get('source')} · " + quelle
    values = {'TITEL': _s(rec.get('meeting_name'), ''), 'DATUM': de_date(rec.get('datum')),
              'VORSITZ': _s(rec.get('vorsitz')), 'ERFASSER': _s(rec.get('erfasst_von')),
              'QUELLE': quelle, 'FOOTER': PROTOKOLL_FOOTER}

    fb_rows = []
    for x in fort:
        meld = f"Fortschritt → {_s(x.get('wert'), '?')} %"
        if x.get('text'):
            meld += f" · {x.get('text')}"
        fb_rows.append([_s(x.get('ms_id')), meld])
    for x in blo:
        fb_rows.append([_s(x.get('ms_id')), f"Blocker: {_s(x.get('text'), '')} (+{_s(x.get('slip'), '0')} T)"])

    tables = {
        '{{FORTSCHRITT}}': _tbl(['MS', 'Meldung'], fb_rows or [['—', 'keine Fortschritts-/Blocker-Meldung']], [70, 420]),
        '{{COMMITMENTS}}': _tbl(['Commitment', 'Owner', 'bis'],
            [[_s(x.get('text')), _s(x.get('owner')), de_date(x.get('bis'))] for x in com] or [['keine', '—', '—']],
            [300, 105, 85]),
        '{{ENTSCHEIDE}}': _tbl(['Entscheid', 'Status'],
            [[_s(x.get('text')), _s(x.get('status'))] for x in ent] or [['keine', '—']], [405, 85]),
    }
    bullets = {'{{NOTIZEN}}': [x.get('text') for x in notiz if x.get('text')]}
    name = f"Sitzungsprotokoll — {rec.get('meeting_name')} ({de_date(rec.get('datum'))})"
    return {'name': name, 'values': values, 'tables': tables, 'bullets': bullets}


CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4;margin:15mm 16mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1a1a1a;line-height:1.4}
 .logo{text-align:right}.logo img{height:11mm}
 h1{font-size:15pt;color:#1E3E58;margin-bottom:0.5mm}
 .sub{font-size:9pt;color:#5a6570;border-bottom:1.5pt solid #1E3E58;padding-bottom:2mm;margin-bottom:3.5mm}
 h2{font-size:10pt;color:#1E3E58;margin:3.5mm 0 1.5mm 0}
 table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:1mm}
 th{background:#1E3E58;color:#fff;font-size:7.5pt;text-align:left;padding:1.4mm 2mm}
 td{padding:1.4mm 2mm;vertical-align:top;border-bottom:.4pt solid #d6dde4;font-size:8.5pt}
 ul{padding-left:5mm}li{font-size:8.5pt;margin-bottom:.6mm}
 .wirkung{margin-top:4mm;background:#F5F7FA;border-left:2.5pt solid #b07d2c;padding:2mm 3mm;font-size:8.5pt}
 .wirkung b{color:#1E3E58}
 .foot{margin-top:6mm;border-top:.5pt solid #C9D3DC;padding-top:1.5mm;font-size:7.5pt;color:#8a94a8}
</style>"""


def render_html(rec, wirkung):
    parts = []
    ent = by(rec, 'entscheid')
    if ent:
        rows = ''.join(f'<tr><td style="width:82%">{e(x.get("text"))}</td><td>{e(x.get("status"))}</td></tr>' for x in ent)
        parts.append(f'<h2>Entscheide</h2><table><tr><th>Entscheid</th><th>Status</th></tr>{rows}</table>')
    com = by(rec, 'commitment')
    if com:
        rows = ''.join(f'<tr><td style="width:56%">{e(x.get("text"))}</td><td style="width:24%">{e(x.get("owner"))}</td><td>{de_date(x.get("bis"))}</td></tr>' for x in com)
        parts.append(f'<h2>Commitments</h2><table><tr><th>Commitment</th><th>Owner</th><th>bis</th></tr>{rows}</table>')
    fort = by(rec, 'fortschritt')
    if fort:
        rows = ''.join(f'<tr><td style="width:16%"><b>{e(x.get("ms_id"))}</b></td><td style="width:14%">{e(x.get("wert"))}%</td><td>{e(x.get("text"))}</td></tr>' for x in fort)
        parts.append(f'<h2>Fortschritt</h2><table><tr><th>Milestone</th><th>Stand</th><th>Bemerkung</th></tr>{rows}</table>')
    blo = by(rec, 'blocker')
    if blo:
        rows = ''.join(f'<tr><td style="width:16%"><b>{e(x.get("ms_id"))}</b></td><td style="width:14%">+{e(x.get("slip"))} T</td><td>{e(x.get("text"))}</td></tr>' for x in blo)
        parts.append(f'<h2>Blocker / Verzug</h2><table><tr><th>Milestone</th><th>Verzug</th><th>Bemerkung</th></tr>{rows}</table>')
    notiz = by(rec, 'notiz')
    if notiz:
        parts.append('<h2>Notizen</h2><ul>' + ''.join(f'<li>{e(x.get("text"))}</li>' for x in notiz) + '</ul>')
    return f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<h1>Sitzungsprotokoll — {e(rec.get('meeting_name'))}</h1>
<div class="sub">{de_date(rec.get('datum'))} · Vorsitz {e(rec.get('vorsitz')) or '—'} · erfasst: {e(rec.get('erfasst_von')) or '—'} · {e(rec.get('id'))} · Projekt RUBICON («Alea iacta est.»)</div>
{''.join(parts) or '<p style="color:#5a6570">Keine Einträge erfasst.</p>'}
<div class="wirkung"><b>Wirkung im RUBICON Control Tower:</b> {e(wirkung) or 'keine Milestone-Änderung'}</div>
<div class="foot">Automatisch generiert aus protokolle.json am {STAMP} — entspricht dem erfassten Stand. Vertraulich ExBoD/VR.</div>
</body></html>"""


def render_md(rec, wirkung):
    L = [f"# Sitzungsprotokoll — {rec.get('meeting_name')}", "",
         f"{de_date(rec.get('datum'))} · Vorsitz {rec.get('vorsitz') or '—'} · erfasst: {rec.get('erfasst_von') or '—'} · {rec.get('id')} · Projekt RUBICON", ""]
    def esc(s): return str(s or '').replace('|', '\\|').replace('\n', ' ')
    ent = by(rec, 'entscheid')
    if ent:
        L += ["## Entscheide", "", "| Entscheid | Status |", "|---|---|"] + [f"| {esc(x.get('text'))} | {esc(x.get('status'))} |" for x in ent] + [""]
    com = by(rec, 'commitment')
    if com:
        L += ["## Commitments", "", "| Commitment | Owner | bis |", "|---|---|---|"] + [f"| {esc(x.get('text'))} | {esc(x.get('owner'))} | {de_date(x.get('bis'))} |" for x in com] + [""]
    fort = by(rec, 'fortschritt')
    if fort:
        L += ["## Fortschritt", "", "| Milestone | Stand | Bemerkung |", "|---|---|---|"] + [f"| {esc(x.get('ms_id'))} | {esc(x.get('wert'))}% | {esc(x.get('text'))} |" for x in fort] + [""]
    blo = by(rec, 'blocker')
    if blo:
        L += ["## Blocker / Verzug", "", "| Milestone | Verzug | Bemerkung |", "|---|---|---|"] + [f"| {esc(x.get('ms_id'))} | +{esc(x.get('slip'))} T | {esc(x.get('text'))} |" for x in blo] + [""]
    notiz = by(rec, 'notiz')
    if notiz:
        L += ["## Notizen", ""] + [f"- {esc(x.get('text'))}" for x in notiz] + [""]
    L += [f"**Wirkung im Tower:** {wirkung or 'keine Milestone-Änderung'}"]
    return "\n".join(L) + "\n"


def main():
    pid = sys.argv[1]
    store = json.loads(PROTO.read_text())
    rec = next((p for p in store['protokolle'] if p['id'] == pid), None)
    if not rec:
        print(json.dumps({'ok': False, 'error': f'Protokoll {pid} nicht gefunden'})); sys.exit(1)

    wirkung = ' · '.join(
        [f"{x['ms_id']} → {x['wert']}%" for x in by(rec, 'fortschritt') if x.get('ms_id')]
        + [f"{x['ms_id']} +{x['slip']} T" for x in by(rec, 'blocker') if x.get('ms_id')])

    OUT.mkdir(parents=True, exist_ok=True)
    # PDF — für BEIDE Modi gleich (lokal headless-Chrome, server Gotenberg; html_to_pdf entscheidet).
    hp = Path(tempfile.mktemp(suffix='.html'))
    hp.write_text(render_html(rec, wirkung))
    pdf_rel = f'/protokolle/{pid}.pdf'
    html_to_pdf(str(hp), str(OUT / f'{pid}.pdf'))

    name = f"Sitzungsprotokoll — {rec.get('meeting_name')} ({de_date(rec.get('datum'))})"
    prev = dict(rec.get('export') or {})

    if _is_server():
        # Google Doc via gebrandete Vorlage (Weg 1) — ersetzt serverseitig den md->gdoc-Weg (3. Weg,
        # dessen chief_templates.json im Container fehlt). Doc BLEIBT; PDF kam schon aus html_to_pdf.
        from googleapiclient.discovery import build
        sys.path.insert(0, str(ROOT / 'scripts' / '_tools'))
        from _google_auth import load_credentials
        import doc_template as dt
        import doc_materialize as dm
        creds = load_credentials()
        drive = build('drive', 'v3', credentials=creds)
        docs = build('docs', 'v1', credentials=creds)
        spec = protokoll_spec(rec)
        prev_srv = prev.get('server_doc_id')
        doc_id, _pdf = dt.render_doc_and_pdf(drive, docs, dm.template_id('protokoll'),
                                             _protokolle_folder(), spec['name'],
                                             spec['values'], spec['tables'], spec['bullets'])
        # vorheriges server-Doc trashen (idempotent via gespeicherte ID; non-fatal)
        if prev_srv and prev_srv != doc_id:
            try:
                drive.files().update(fileId=prev_srv, body={'trashed': True},
                                     supportsAllDrives=True, fields='id').execute()
            except Exception:  # noqa: BLE001 — Cleanup-Fehler darf den Export nicht kippen
                pass
        # ADDITIV: Dieters lokale doc_id/doc_url NIE anfassen; nur die server_*-Felder fortschreiben.
        server_url = f'https://docs.google.com/document/d/{doc_id}/edit'
        export = dict(prev)
        export['pdf'] = pdf_rel
        export['stand'] = STAMP
        export['server_doc_id'] = doc_id
        export['server_doc_url'] = server_url
        out_json = {'ok': True, 'id': pid, 'pdf': pdf_rel, 'server_doc_id': doc_id,
                    'server_doc_url': server_url,
                    'doc_id': prev.get('doc_id'), 'doc_url': prev.get('doc_url')}
    else:
        # --- lokaler Pfad (Dieter, Mac) UNVERAENDERT: md->gdoc-Subprocess ---
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
            f.write(render_md(rec, wirkung)); md = f.name
        cmd = ['python3', MD2GDOC, md, name, PARENT]
        prev_doc = prev.get('doc_id')
        if prev_doc:
            cmd += ['--doc-id', prev_doc]
        out = subprocess.run(cmd, capture_output=True, text=True)
        m = re.search(r'/document/d/([A-Za-z0-9_-]+)/', out.stdout)
        doc_id = m.group(1) if m else None
        doc_url = f'https://docs.google.com/document/d/{doc_id}/edit' if doc_id else None
        # byte-identisch zu frueher: exakt {pdf, doc_id, doc_url, stand} in dieser Reihenfolge.
        # Etwaige server_*-Felder (falls derselbe Store dual bespielt wird) hinten ERHALTEN.
        export = {'pdf': pdf_rel, 'doc_id': doc_id, 'doc_url': doc_url, 'stand': STAMP}
        for k in ('server_doc_id', 'server_doc_url'):
            if k in prev:
                export[k] = prev[k]
        out_json = {'ok': True, 'id': pid, 'pdf': pdf_rel, 'doc_id': doc_id, 'doc_url': doc_url}

    rec['export'] = export
    _atomic_write(PROTO, json.dumps(store, ensure_ascii=False, indent=2))
    print(json.dumps(out_json))


if __name__ == '__main__':
    main()
