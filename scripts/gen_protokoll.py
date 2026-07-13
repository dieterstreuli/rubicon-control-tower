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


def _atomic_write(path, text):
    # Atomarer Schreibvorgang (Audit #8): temp + os.replace
    tmp = f'{path}.tmp.{os.getpid()}'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402
import fitz  # noqa: E402

MD2GDOC = '/Users/dieterstreuli/Chief/Tools/md_to_gdoc.py'
import os as _os
if not _os.path.exists(MD2GDOC):
    MD2GDOC = __file__.rsplit('/', 1)[0] + '/_tools/md_to_gdoc.py'  # vendored (Portabilität)
PARENT = '16eHUDx59O5_nR3wIcDim7OhEqlg86jB0'  # Drive: RUBICON — Sitzungsprotokolle
PROTO = ROOT / 'src' / 'data' / 'protokolle.json'
OUT = ROOT / 'public' / 'protokolle'
LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
STAMP = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')


def e(s):
    return html.escape(str(s or ''))


def de_date(s):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(s or ''))
    return f'{m.group(3)}.{m.group(2)}.{m.group(1)}' if m else (s or '')


def by(rec, typ):
    return [x for x in rec.get('eintraege', []) if x.get('typ') == typ]


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
    # PDF
    hp = Path(tempfile.mktemp(suffix='.html'))
    hp.write_text(render_html(rec, wirkung))
    pdf_rel = f'/protokolle/{pid}.pdf'
    html_to_pdf(str(hp), str(OUT / f'{pid}.pdf'))
    # Google Doc
    with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
        f.write(render_md(rec, wirkung)); md = f.name
    name = f"Sitzungsprotokoll — {rec.get('meeting_name')} ({de_date(rec.get('datum'))})"
    cmd = ['python3', MD2GDOC, md, name, PARENT]
    prev_doc = (rec.get('export') or {}).get('doc_id')
    if prev_doc:
        cmd += ['--doc-id', prev_doc]
    out = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r'/document/d/([A-Za-z0-9_-]+)/', out.stdout)
    doc_id = m.group(1) if m else None

    rec['export'] = {'pdf': pdf_rel, 'doc_id': doc_id,
                     'doc_url': f'https://docs.google.com/document/d/{doc_id}/edit' if doc_id else None,
                     'stand': STAMP}
    _atomic_write(PROTO, json.dumps(store, ensure_ascii=False, indent=2))
    print(json.dumps({'ok': True, 'id': pid, 'pdf': pdf_rel, 'doc_id': doc_id,
                      'doc_url': rec['export']['doc_url']}))


if __name__ == '__main__':
    main()
