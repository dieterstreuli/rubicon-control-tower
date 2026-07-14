#!/usr/bin/env python3
"""gen_briefing_pdfs.py — rendert je Milestone ein Briefing-PDF (A4, AXS-Stil)
nach public/briefings/<id>.pdf — Layout analog Commercial-Masterplan-Briefing
(M01-Muster: Kopfzeile · Titel · Meta-Tabelle · KONTEXT · LEISTUNG · VORGEHEN ·
ERFOLGSMESSUNG · RISIKEN · DATENGRUNDLAGE · Auto-Footer).

Quellen: src/data/projekt.yaml (MS-Felder) + src/data/briefings.json (Detail).
Parallelisiert (4 Chrome-Instanzen). Idempotent — immer aktueller Stand.
"""
import concurrent.futures as cf
import datetime
import html
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
OUT = ROOT / 'public' / 'briefings'
TMP = ROOT / 'scripts' / '_briefing_html'
STAMP = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')

CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4;margin:14mm 16mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1a1a1a;line-height:1.4}
 .logo{text-align:right}.logo img{height:11mm}
 .kopf{display:flex;gap:6mm;font-size:8pt;color:#5a6570;margin:2mm 0 1mm 0}
 .kopf b.prio{color:#9E2B25}
 h1{font-size:15pt;color:#1E3E58;border-bottom:1.5pt solid #1E3E58;padding-bottom:1.5mm;margin-bottom:3mm}
 table.meta{width:100%;border-collapse:collapse;background:#F5F7FA;margin-bottom:4mm}
 table.meta td{padding:1.6mm 2.5mm;font-size:8.5pt;vertical-align:top}
 table.meta td.k{width:16%;color:#5a6570;font-weight:bold}
 h2{font-size:9.5pt;color:#1E3E58;margin:3.5mm 0 1.2mm 0;letter-spacing:.3px}
 p,li{font-size:9pt}
 ul,ol{padding-left:5mm}
 li{margin-bottom:.8mm}
 .grounding{color:#5a6570;font-size:8.5pt}
 .klartext{background:#F5F7FA;border-left:2.5pt solid #b07d2c;padding:2mm 3mm;font-size:9pt;margin-bottom:4mm}
 .klartext b{color:#1E3E58}
 .foot{margin-top:6mm;border-top:.5pt solid #C9D3DC;padding-top:1.5mm;font-size:7.5pt;color:#8a94a8}
</style>"""


def e(s):
    return html.escape(str(s or ''))


def render(m, b):
    leistung = ''.join(f'<li>{e(x)}</li>' for x in (b.get('leistung') or []))
    vorgehen = ''.join(f'<li>{e(x)}</li>' for x in (b.get('vorgehen') or []))
    risiken = ''.join(f'<li>{e(x)}</li>' for x in (b.get('risiken') or []))
    deps = ', '.join(m.get('depends_on') or []) or '—'
    flags = []
    if m.get('gate'):
        flags.append(f"Gate {m['gate']}")
    if m.get('critical'):
        flags.append('kritischer Pfad ◆')
    if m.get('nachlauf'):
        flags.append('gesetzlicher Nachlauf Q2/27 ⏳')
    quartal = m.get('quarter') or (m.get('phase') or '—')
    prio = m.get('prio') or '—'
    status_txt = 'offen' if not isinstance(m.get('progress'), (int, float)) or m['progress'] < 100 else 'erledigt'
    return f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<div class="kopf"><b>{e(m['id'])}</b><span>{e(m.get('_wsName') or '')}</span>
<b class="prio">Priorität {e(prio)}</b><span>Status: {status_txt}</span><span>{e(quartal)}</span></div>
<h1>{e(m['name'])}</h1>
<table class="meta">
 <tr><td class="k">Owner</td><td>{e(m.get('owner') or 'zu klären')}</td>
     <td class="k">Start</td><td>{e(m.get('start') or '—')}</td></tr>
 <tr><td class="k">Beteiligte</td><td>{e(b.get('beteiligte') or 'zu klären')}</td>
     <td class="k">Fällig bis</td><td>{e(m.get('due'))}{' *' if m.get('date_assumed') else ''}</td></tr>
 <tr><td class="k">Abhängig von</td><td>{e(deps)}</td>
     <td class="k">Merkmale</td><td>{e(' · '.join(flags) or '—')}</td></tr>
</table>
{f'<div class="klartext"><b>ZIEL IM KLARTEXT:</b> {e(b.get("ziel_klartext"))}</div>' if b.get('ziel_klartext') else ''}
<h2>KONTEXT — WARUM DIESER MILESTONE</h2><p>{e(b.get('kontext') or 'zu klären')}</p>
<h2>ERWARTETE LEISTUNG (DELIVERABLES)</h2><ul>{leistung or '<li>zu klären</li>'}</ul>
<h2>VORGEHEN</h2><ol>{vorgehen or '<li>zu klären</li>'}</ol>
<h2>ERFOLGSMESSUNG (KPI)</h2><p>{e(b.get('erfolgsmessung') or m.get('kpi') or 'zu klären')}</p>
<h2>RISIKEN &amp; ABHÄNGIGKEITEN</h2><ul>{risiken or '<li>zu klären</li>'}</ul>
<h2>DATENGRUNDLAGE</h2><p class="grounding">{e(b.get('grounding') or '—')}</p>
<div class="foot">Projekt RUBICON («Alea iacta est.») · Owner-Briefing · automatisch generiert aus
briefings.json am {STAMP} — dieses PDF entspricht immer dem aktuellen Stand. Vertraulich ExBoD/VR.</div>
</body></html>"""


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None  # optional: einzelne ID
    data = yaml.safe_load((ROOT / 'src' / 'data' / 'projekt.yaml').read_text())
    briefings = json.loads((ROOT / 'src' / 'data' / 'briefings.json').read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(exist_ok=True)

    jobs = []
    for ws in data['workstreams']:
        for m in ws['milestones']:
            if only and m['id'] != only:
                continue
            mm = {**m, '_wsName': f"{ws['code']} — {ws['name']}"}
            jobs.append((mm, briefings.get(m['id']) or {}))

    def one(job):
        m, b = job
        hp = TMP / f"{m['id']}.html"
        hp.write_text(render(m, b))
        html_to_pdf(str(hp), str(OUT / f"{m['id']}.pdf"))
        return m['id']

    done, fail = 0, []
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for fut in cf.as_completed([ex.submit(one, j) for j in jobs]):
            try:
                fut.result()
                done += 1
                if done % 20 == 0:
                    print(f"  … {done}/{len(jobs)}")
            except Exception as exn:  # noqa: BLE001
                fail.append(str(exn))
    print(f"FERTIG: {done}/{len(jobs)} Briefing-PDFs → public/briefings/")
    if fail:
        print("FEHLER:", *fail[:5], sep="\n  ")
        sys.exit(1)


if __name__ == '__main__':
    main()
