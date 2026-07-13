#!/usr/bin/env python3
"""gen_fuehrungsrhythmus_pdf.py — rendert den Führungsrhythmus-One-Pager (A4 quer,
AXS-Stil) aus src/data/fuehrungsrhythmus.json → public/fuehrungsrhythmus.pdf + .png.
Eine Datenquelle für PDF UND Frontseite (App liest dieselbe JSON).
"""
import html
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF (PNG-Vorschau)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
DATA = json.loads((ROOT / 'src' / 'data' / 'fuehrungsrhythmus.json').read_text())
OUT_PDF = ROOT / 'public' / 'fuehrungsrhythmus.pdf'
OUT_PNG = ROOT / 'public' / 'fuehrungsrhythmus.png'
TMP = ROOT / 'scripts' / '_fr.html'

COL = {'grey': '#64748b', 'green': '#2f9e6f', 'blue': '#2f6fb0', 'brass': '#b07d2c'}


def e(s):
    return html.escape(str(s or ''))


CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4 landscape;margin:10mm 11mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:7.6pt;color:#1a1a1a;line-height:1.28}
 .logo{position:absolute;top:9mm;right:11mm}.logo img{height:9mm}
 h1{font-size:14pt;color:#1E3E58;margin-bottom:0.5mm}
 .sub{font-size:8.5pt;color:#5a6570;border-bottom:1.5pt solid #1E3E58;padding-bottom:2mm;margin-bottom:3mm}
 table{width:100%;border-collapse:collapse;table-layout:fixed}
 th{background:#1E3E58;color:#fff;font-size:7pt;text-align:left;padding:1.4mm 2mm;font-weight:bold}
 td{padding:1.4mm 2mm;vertical-align:top;border-bottom:.4pt solid #d6dde4}
 .grp td{background:#eef2f6;font-weight:bold;font-size:7.4pt;color:#1E3E58;padding:1.2mm 2mm}
 .grp .dot{display:inline-block;width:2.4mm;height:2.4mm;border-radius:50%;vertical-align:middle;margin-right:2mm}
 .nm{font-weight:bold;color:#1E3E58}
 .out{color:#1E3E58}
 .prin{margin-top:3mm;background:#F5F7FA;border-left:2.5pt solid #b07d2c;padding:2mm 3mm;font-size:7.2pt}
 .prin b{color:#1E3E58}
 .foot{margin-top:2.5mm;font-size:6.6pt;color:#8a94a8;border-top:.5pt solid #C9D3DC;padding-top:1.2mm}
</style>"""


def rows():
    out = []
    cols = '<col style="width:15%"><col style="width:13%"><col style="width:20%"><col style="width:26%"><col style="width:26%">'
    out.append(f'<table>{cols}')
    out.append('<tr><th>Meeting</th><th>Wann</th><th>Mit wem</th><th>Zweck</th><th>Output-Erwartung → wohin</th></tr>')
    for g in DATA['gruppen']:
        c = COL.get(g['farbe'], '#64748b')
        out.append(f'<tr class="grp"><td colspan="5"><span class="dot" style="background:{c}"></span>{e(g["kadenz"])}</td></tr>')
        for m in g['meetings']:
            out.append(
                f'<tr><td class="nm">{e(m["name"])}</td><td>{e(m["wann"])}</td>'
                f'<td>{e(m["teilnehmer"])}</td><td>{e(m["zweck"])}</td>'
                f'<td class="out">{e(m["output"])}</td></tr>')
    out.append('</table>')
    return ''.join(out)


def main():
    prin = ''.join(f'<div>{"<b>• </b>" if i == 0 else "• "}{e(p)}</div>' for i, p in enumerate(DATA['grundsaetze']))
    doc = f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<h1>{e(DATA['titel'])}</h1>
<div class="sub">{e(DATA['untertitel'])}</div>
{rows()}
<div class="prin"><b>Grundsätze:</b><br>{prin}</div>
<div class="foot">Projekt RUBICON («Alea iacta est.») · Führungsrhythmus-One-Pager · automatisch generiert aus fuehrungsrhythmus.json · Vertraulich ExBoD/VR</div>
</body></html>"""
    TMP.write_text(doc)
    html_to_pdf(str(TMP), str(OUT_PDF), landscape=True)
    d = fitz.open(OUT_PDF)
    d[0].get_pixmap(matrix=fitz.Matrix(2, 2)).save(OUT_PNG)
    pages = len(d)
    d.close()
    print(f'FERTIG: {OUT_PDF.name} ({pages} Seite/n) + {OUT_PNG.name}')
    if pages > 1:
        print('WARNUNG: One-Pager überschreitet 1 Seite — kompakter machen.')


if __name__ == '__main__':
    main()
