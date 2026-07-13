#!/usr/bin/env python3
"""gen_traktanden_pdfs.py — rendert je Führungsrhythmus-Meeting eine Traktandenliste
(A4 hoch, AXS-Stil) nach public/traktanden/<meeting_id>.pdf.

Quelle: src/data/traktanden.json (aus dem Workflow) + src/data/fuehrungsrhythmus.json
(für Kadenz/Farbe je Meeting). Idempotent.
"""
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
AG = json.loads((ROOT / 'src' / 'data' / 'traktanden.json').read_text())
FR = json.loads((ROOT / 'src' / 'data' / 'fuehrungsrhythmus.json').read_text())
OUT = ROOT / 'public' / 'traktanden'
TMP = ROOT / 'scripts' / '_trakt_html'

# Farbe + Kadenz je Meeting-ID aus fuehrungsrhythmus.json
COL = {'grey': '#5a6570', 'green': '#2f9e6f', 'blue': '#2f6fb0', 'brass': '#b07d2c'}
META = {}
for g in FR['gruppen']:
    for m in g['meetings']:
        META[m['id']] = {'farbe': COL.get(g['farbe'], '#1E3E58'), 'kadenz_grp': g['kadenz']}


def e(s):
    return html.escape(str(s or ''))


CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4;margin:15mm 16mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1a1a1a;line-height:1.4}
 .logo{text-align:right}.logo img{height:11mm}
 .tag{display:inline-block;font-size:7.5pt;color:#fff;padding:0.6mm 2mm;border-radius:2mm;font-weight:bold;margin-bottom:2mm}
 h1{font-size:15pt;color:#1E3E58;margin-bottom:0.5mm}
 .kad{font-size:9pt;color:#5a6570;border-bottom:1.5pt solid #1E3E58;padding-bottom:2mm;margin-bottom:3mm}
 table.head{width:100%;border-collapse:collapse;background:#F5F7FA;margin-bottom:3.5mm}
 table.head td{padding:1.6mm 2.5mm;font-size:8.5pt;vertical-align:top}
 table.head td.k{width:16%;color:#5a6570;font-weight:bold}
 .rule{background:#fff5e6;border-left:2.5pt solid #b07d2c;padding:2mm 3mm;font-size:8.5pt;margin-bottom:3.5mm}
 h2{font-size:9.5pt;color:#1E3E58;margin:2mm 0 1.5mm 0}
 table.tr{width:100%;border-collapse:collapse;table-layout:fixed}
 table.tr th{background:#1E3E58;color:#fff;font-size:7.5pt;text-align:left;padding:1.5mm 2mm}
 table.tr td{padding:1.6mm 2mm;vertical-align:top;border-bottom:.4pt solid #d6dde4;font-size:8.5pt}
 .nr{width:7%;font-weight:bold;color:#1E3E58}.zeit{width:11%;font-family:monospace;color:#5a6570}
 .ver{width:22%}.out{width:32%;color:#1E3E58}
 .erg{margin-top:3.5mm;background:#F5F7FA;border-left:2.5pt solid #1E3E58;padding:2mm 3mm;font-size:8.5pt}
 .erg b{color:#1E3E58}
 .hint{margin-top:2.5mm;font-size:8pt;color:#5a6570}
 .foot{margin-top:6mm;border-top:.5pt solid #C9D3DC;padding-top:1.5mm;font-size:7.5pt;color:#8a94a8}
</style>"""


def render(a):
    mid = a['meeting_id']
    col = META.get(mid, {}).get('farbe', '#1E3E58')
    kad_grp = META.get(mid, {}).get('kadenz_grp', '')
    rows = ''.join(
        f'<tr><td class="nr">{e(t.get("nr"))}</td><td>{e(t.get("titel"))}</td>'
        f'<td class="zeit">{e(t.get("zeit"))}</td><td class="ver">{e(t.get("verantwortlich"))}</td>'
        f'<td class="out">{e(t.get("output"))}</td></tr>'
        for t in a.get('traktanden', []))
    hints = a.get('hinweise') or []
    hints_html = ('<div class="hint"><b>Spielregeln:</b> ' + ' · '.join(e(h) for h in hints) + '</div>') if hints else ''
    return f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<span class="tag" style="background:{col}">{e(kad_grp)}</span>
<h1>Traktandenliste — {e(a.get('meeting_name'))}</h1>
<div class="kad">{e(a.get('kadenz'))} · Standard-Agenda (stehend) · Projekt RUBICON</div>
<table class="head">
 <tr><td class="k">Vorsitz</td><td>{e(a.get('vorsitz'))}</td><td class="k">Dauer</td><td>{e(a.get('dauer'))}</td></tr>
 <tr><td class="k">Teilnehmer</td><td colspan="3">{e(a.get('teilnehmer'))}</td></tr>
</table>
<div class="rule"><b>Eiserne Regel:</b> {e(a.get('standing_rule'))}</div>
<h2>TRAKTANDEN</h2>
<table class="tr"><tr><th class="nr">#</th><th>Traktandum</th><th class="zeit">Zeit</th><th class="ver">Verantwortlich</th><th class="out">Output → wohin</th></tr>
{rows}</table>
<div class="erg"><b>Ergebnis der Sitzung:</b> {e(a.get('ergebnis'))}</div>
{hints_html}
<div class="foot">Projekt RUBICON («Alea iacta est.») · Standard-Traktandenliste · automatisch generiert aus traktanden.json — entspricht dem aktuellen Stand. Vertraulich ExBoD/VR.</div>
</body></html>"""


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(exist_ok=True)
    items = AG['agendas'] if isinstance(AG, dict) else AG
    n = 0
    for a in items:
        if only and a['meeting_id'] != only:
            continue
        hp = TMP / f"{a['meeting_id']}.html"
        hp.write_text(render(a))
        html_to_pdf(str(hp), str(OUT / f"{a['meeting_id']}.pdf"))
        n += 1
    print(f"FERTIG: {n} Traktandenlisten-PDFs → public/traktanden/")


if __name__ == '__main__':
    main()
