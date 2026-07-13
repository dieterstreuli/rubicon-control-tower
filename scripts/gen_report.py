#!/usr/bin/env python3
"""gen_report.py <level> <period> — verdichtete Standard-Reports aus der EINEN
Datenbasis (projekt.yaml + protokolle.json). Kein Neu-Erfassen; reine Aggregation.

  level  = woche | monat | vr
  period = woche: ein Datum in der KW (YYYY-MM-DD) · monat: YYYY-MM · vr: YYYY-Qn

Rendert PDF (public/reports/<level>-<period>.pdf) + Google Doc (Drive: RUBICON —
Reports), trägt optionale Freitext-Kommentare (report_comments.json) ein und
aktualisiert reports_index.json. Letzte stdout-Zeile = JSON {ok, pdf, doc_url}.
"""
import datetime as dt
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


def _atomic_write(path, text):
    # Atomarer Schreibvorgang (Audit #8): temp + os.replace → nie truncated bei Nebenläufigkeit
    tmp = f'{path}.tmp.{os.getpid()}'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

MD2GDOC = '/Users/dieterstreuli/Chief/Tools/md_to_gdoc.py'
import os as _os
if not _os.path.exists(MD2GDOC):
    MD2GDOC = __file__.rsplit('/', 1)[0] + '/_tools/md_to_gdoc.py'  # vendored (Portabilität)
PARENT = '1n8FcDCa8T5vYzME5zXrMpmt0i70pKXt5'  # Drive: RUBICON — Reports
DATA = ROOT / 'src' / 'data'
OUT = ROOT / 'public' / 'reports'
LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
STAMP = dt.datetime.now().strftime('%d.%m.%Y %H:%M')
MON = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
SIG = {'done': '#2f6fb0', 'onTrack': '#2f9e6f', 'atRisk': '#b8860b', 'delayed': '#c0392b', 'unknown': '#6b7480'}
SIG_LBL = {'done': 'Erledigt', 'onTrack': 'Auf Kurs', 'atRisk': 'Gefährdet', 'delayed': 'Verzug', 'unknown': 'Unbekannt'}


def e(s):
    return html.escape(str(s if s is not None else ''))


def pdate(s):
    try:
        return dt.date.fromisoformat(str(s).strip())
    except Exception:
        return None


def de(s):
    d = pdate(s)
    return d.strftime('%d.%m.%Y') if d else (s or '—')


# ---------- Statuslogik (Port aus status.js) ----------
def status_of(m, now):
    # 1:1-Parität zu src/lib/status.js statusOf (Audit #1). bool ist in Python int-
    # kompatibel → explizit ausschliessen, damit true/false nicht als Zahl gilt (wie JS typeof).
    prog = m.get('progress')
    has = isinstance(prog, (int, float)) and not isinstance(prog, bool)
    slip = m.get('reported_slip_days')
    slip = slip if (isinstance(slip, (int, float)) and not isinstance(slip, bool)) else 0
    due = pdate(m.get('due'))
    if has and prog >= 100 and slip <= 0:
        return 'done'
    if (due and now and (now - due).days > 0) or slip > 0:
        return 'delayed'
    if not has or not due or not now:
        return 'unknown'
    # Vor dem GEPLANTEN Start ist fehlender Fortschritt kein Risikosignal (13.07., 1:1 zu status.js)
    start = pdate(m.get('start'))
    if start and (start - now).days > 0:
        return 'onTrack'
    rest = (due - now).days
    if (rest <= 21 and prog < 50) or (rest <= 45 and prog < 15):
        return 'atRisk'
    return 'onTrack'


ORDER = ['delayed', 'atRisk', 'unknown', 'onTrack', 'done']


def ws_ampel(ws, now):
    sts = [status_of(m, now) for m in ws['milestones']]
    for s in ORDER:
        if s in sts:
            return s
    return 'unknown'


def period_range(level, period):
    if level == 'woche':
        d = pdate(period)
        if not d:
            raise ValueError(f'ungültige Wochen-Periode «{period}» (erwartet YYYY-MM-DD)')
        start = d - dt.timedelta(days=d.weekday())
        end = start + dt.timedelta(days=6)
        return start, end, f"KW {start.isocalendar()[1]} · {start.strftime('%d.%m.')}–{end.strftime('%d.%m.%Y')}"
    if level == 'monat':
        y, m = map(int, period.split('-'))
        start = dt.date(y, m, 1)
        end = (dt.date(y + (m // 12), (m % 12) + 1, 1) - dt.timedelta(days=1))
        return start, end, f"{MON[m]} {y}"
    # vr / quartal
    y, q = period.split('-Q')
    y, q = int(y), int(q)
    sm = (q - 1) * 3 + 1
    start = dt.date(y, sm, 1)
    em = sm + 2
    end = dt.date(y + (em // 12), (em % 12) + 1, 1) - dt.timedelta(days=1)
    return start, end, f"Q{q}/{y}"


CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4;margin:14mm 15mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;line-height:1.38}
 .logo{text-align:right}.logo img{height:10mm}
 h1{font-size:15pt;color:#1E3E58;margin-bottom:0.5mm}
 .sub{font-size:9pt;color:#5a6570;border-bottom:1.5pt solid #1E3E58;padding-bottom:2mm;margin-bottom:3mm}
 h2{font-size:10pt;color:#1E3E58;margin:3mm 0 1.2mm 0}
 h3{font-size:9.5pt;color:#1E3E58;margin:2.5mm 0 1mm 0}
 table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:1mm}
 th{background:#1E3E58;color:#fff;font-size:7pt;text-align:left;padding:1.2mm 1.8mm}
 td{padding:1.2mm 1.8mm;vertical-align:top;border-bottom:.4pt solid #d6dde4;font-size:8pt}
 .kpi{display:flex;gap:3mm;margin-bottom:3mm;flex-wrap:wrap}
 .kpibox{flex:1;min-width:34mm;border:.5pt solid #d6dde4;border-top:2pt solid #1E3E58;border-radius:1.5mm;padding:2mm 2.5mm}
 .kpibox .l{font-size:6.5pt;color:#5a6570;text-transform:uppercase;letter-spacing:.3px}
 .kpibox .v{font-size:13pt;font-weight:bold;color:#1E3E58}
 .pill{display:inline-block;font-size:7pt;padding:.3mm 1.6mm;border-radius:2mm;color:#fff;font-weight:bold}
 .wsblock{border:.5pt solid #d6dde4;border-radius:1.5mm;padding:2mm 2.5mm;margin-bottom:2.5mm}
 .wshead{font-size:9.5pt;font-weight:bold;color:#1E3E58;margin-bottom:1mm}
 .kom{background:#F5F7FA;border-left:2pt solid #b07d2c;padding:1.5mm 2.5mm;font-size:8pt;margin:1mm 0}
 ul{padding-left:4.5mm}li{font-size:8pt;margin-bottom:.4mm}
 .bar{height:2mm;background:#e6ebf0;border-radius:1mm;overflow:hidden}
 .bar > i{display:block;height:2mm;background:#2f9e6f}
 .muted{color:#8a94a8}
 .foot{margin-top:5mm;border-top:.5pt solid #C9D3DC;padding-top:1.2mm;font-size:7pt;color:#8a94a8}
 .vrflag{background:#c0392b;color:#fff;font-size:6.5pt;padding:.2mm 1.4mm;border-radius:1.5mm;font-weight:bold}
</style>"""


def pill(st):
    return f'<span class="pill" style="background:{SIG[st]}">{SIG_LBL[st]}</span>'


def load():
    doc = yaml.safe_load((DATA / 'projekt.yaml').read_text())
    protos = json.loads((DATA / 'protokolle.json').read_text()).get('protokolle', [])
    comments = json.loads((DATA / 'report_comments.json').read_text())
    return doc, protos, comments


def entries_in(protos, start, end, typ=None, ws_prefix=None):
    out = []
    for p in protos:
        d = pdate(p.get('datum'))
        if not d or not (start <= d <= end):
            continue
        for x in p.get('eintraege', []):
            if typ and x.get('typ') != typ:
                continue
            if ws_prefix and not str(x.get('ms_id', '')).startswith(ws_prefix):
                continue
            out.append({**x, '_meeting': p.get('meeting_name'), '_datum': p.get('datum')})
    return out


def generate(level, period):
    doc, protos, comments = load()
    # «Stand» aus dem Steuerungsdatum meta.today, nicht aus der Systemuhr (Audit #7) →
    # gleicher Input + gleiches meta.today = bit-identischer Report.
    global STAMP
    STAMP = f"Steuerungsstand {de(doc['meta'].get('today'))}"
    meta = doc['meta']
    now = pdate(meta['today'])
    start, end, label = period_range(level, period)
    inper = [p for p in protos if pdate(p.get('datum')) and start <= pdate(p['datum']) <= end]

    allms = [m for w in doc['workstreams'] for m in w['milestones']]
    def cnt(pred):
        return sum(1 for m in allms if pred(m))
    prog_ampel = 'delayed' if any(m.get('critical') and not m.get('nachlauf') and status_of(m, now) == 'delayed' for m in allms) else next((s for s in ORDER if any(status_of(m, now) == s for m in allms)), 'unknown')

    ckey = f'{level}:{period}'
    def kom(scope):
        return comments.get(f'{ckey}:{scope}', '')

    if level == 'vr':
        body = render_vr(doc, meta, now, inper, label, kom)
        title = f"VR-Report — {label}"
    elif level == 'monat':
        body = render_monat(doc, meta, now, inper, start, end, label, kom)
        title = f"Monats-Report — {label}"
    else:
        body = render_woche(doc, meta, now, inper, start, end, label, kom)
        title = f"Wochen-Report — {label}"

    html_doc = f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<h1>{e(title)}</h1>
<div class="sub">Projekt RUBICON («Alea iacta est.») · Programm-Ampel {pill(prog_ampel)} · Stand {STAMP} · automatisch aus der RUBICON-Plattform verdichtet</div>
{body}
<div class="foot">Automatisch generiert aus projekt.yaml + protokolle.json — verdichtete Sicht, kein manuelles Zusammentragen. Live-Detail: RUBICON Control Tower. Vertraulich ExBoD/VR.</div>
</body></html>"""

    OUT.mkdir(parents=True, exist_ok=True)
    slug = f'{level}-{period}'.replace('/', '-')
    hp = Path(tempfile.mktemp(suffix='.html'))
    hp.write_text(html_doc)
    pdf_rel = f'/reports/{slug}.pdf'
    html_to_pdf(str(hp), str(OUT / f'{slug}.pdf'))

    # Google Doc
    md = build_md(title, label, prog_ampel, level, doc, meta, now, inper, start, end, kom)
    with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
        f.write(md); mdp = f.name
    idx = json.loads((DATA / 'reports_index.json').read_text())
    prev = next((r for r in idx['reports'] if r['id'] == slug), None)
    cmd = ['python3', MD2GDOC, mdp, title, PARENT]
    if prev and prev.get('doc_id'):
        cmd += ['--doc-id', prev['doc_id']]
    out = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r'/document/d/([A-Za-z0-9_-]+)/', out.stdout)
    doc_id = m.group(1) if m else (prev.get('doc_id') if prev else None)

    rec = {'id': slug, 'level': level, 'period': period, 'label': label,
           'pdf': pdf_rel, 'doc_id': doc_id,
           'doc_url': f'https://docs.google.com/document/d/{doc_id}/edit' if doc_id else None,
           'stand': STAMP}
    idx['reports'] = [r for r in idx['reports'] if r['id'] != slug]
    idx['reports'].insert(0, rec)
    _atomic_write(DATA / 'reports_index.json', json.dumps(idx, ensure_ascii=False, indent=2))
    return {'ok': True, **rec}


def main():
    import time
    if sys.argv[1] == '--auto':
        # Aktuelle Woche/Monat/Quartal aus meta.today (Steuerungsdatum) ableiten
        m = yaml.safe_load((DATA / 'projekt.yaml').read_text())['meta']
        now = pdate(m['today'])
        specs = [('woche', now.isoformat()), ('monat', now.strftime('%Y-%m')),
                 ('vr', f"{now.year}-Q{(now.month - 1) // 3 + 1}")]
        res = []
        for i, (lvl, per) in enumerate(specs):
            if i:
                time.sleep(2)  # Chrome-Instanzen sauber trennen
            try:
                res.append(generate(lvl, per))
            except Exception as ex:  # noqa: BLE001
                res.append({'ok': False, 'level': lvl, 'error': str(ex)})
        print(json.dumps({'auto': True, 'results': res}, ensure_ascii=False))
    else:
        print(json.dumps(generate(sys.argv[1], sys.argv[2]), ensure_ascii=False))


# ---------- Templates ----------
def ws_period_lines(ws, inper, start, end, now):
    pref = ws['code'] + '-'
    def wsentries(typ):
        return [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == typ and (typ in ('commitment', 'entscheid', 'notiz') or str(x.get('ms_id', '')).startswith(pref))]
    return wsentries


def render_woche(doc, meta, now, inper, start, end, label, kom):
    parts = []
    for ws in doc['workstreams']:
        pref = ws['code'] + '-'
        fort = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'fortschritt' and str(x.get('ms_id', '')).startswith(pref)]
        blk = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'blocker' and str(x.get('ms_id', '')).startswith(pref)]
        # Commitments/Entscheide sind nicht MS-gebunden → dem WS zuordnen ist unscharf; im Wochenreport programmweit unten
        if not (fort or blk):
            continue
        rows = ''.join(f'<li><b>{e(x["ms_id"])}</b> → {e(x.get("wert"))}% · {e(x.get("text"))}</li>' for x in fort)
        rows += ''.join(f'<li style="color:#c0392b"><b>{e(x["ms_id"])}</b> +{e(x.get("slip"))} T · {e(x.get("text"))}</li>' for x in blk)
        parts.append(f'<div class="wsblock"><div class="wshead">{e(ws["code"])} — {e(ws["name"])} {pill(ws_ampel(ws, now))}</div><ul>{rows}</ul></div>')
    com = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'commitment']
    ent = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid']
    prog = f'<h2>Aktivität nach Arbeitsstrom</h2>{"".join(parts) or "<p class=muted>keine Fortschritts-/Blocker-Meldungen in dieser Woche erfasst.</p>"}'
    crows = ''.join(f'<tr><td style="width:54%">{e(x.get("text"))}</td><td style="width:22%">{e(x.get("owner"))}</td><td>{de(x.get("bis"))}</td></tr>' for x in com)
    erows = ''.join(f'<tr><td style="width:80%">{e(x.get("text"))} {"<span class=vrflag>VR</span>" if x.get("ebene")=="VR" else ""}</td><td>{e(x.get("status"))}</td></tr>' for x in ent)
    tab = ''
    if com:
        tab += f'<h2>Commitments der Woche</h2><table><tr><th>Commitment</th><th>Owner</th><th>bis</th></tr>{crows}</table>'
    if ent:
        tab += f'<h2>Entscheide</h2><table><tr><th>Entscheid</th><th>Status</th></tr>{erows}</table>'
    k = kom('programm')
    kdiv = f'<div class="kom"><b>Kommentar:</b> {e(k)}</div>' if k else ''
    return prog + tab + kdiv


def _ms_buckets(ws, now, start, end):
    erreicht, faellig, ueber = [], [], []
    for m in ws['milestones']:
        st = status_of(m, now)
        due = pdate(m.get('due'))
        if st == 'done' and due and start <= due <= end:
            erreicht.append(m)
        elif st == 'delayed':
            ueber.append(m)
        elif due and start <= due <= end:
            faellig.append(m)
    return erreicht, faellig, ueber


def render_monat(doc, meta, now, inper, start, end, label, kom):
    # Deckblatt: Erfüllungsgrad je Phase
    PH = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Nachlauf Q2/27']
    allms = [m for w in doc['workstreams'] for m in w['milestones']]
    phrows = ''
    for ph in PH:
        ms = [m for m in allms if m.get('phase') == ph]
        if not ms:
            continue
        done = sum(1 for m in ms if status_of(m, now) == 'done')
        pct = round(done / len(ms) * 100)
        phrows += f'<tr><td style="width:26%">{e(ph)}</td><td style="width:14%">{done}/{len(ms)}</td><td><div class="bar"><i style="width:{pct}%"></i></div></td><td style="width:10%">{pct}%</td></tr>'
    cover = f'<h2>Programm — Erfüllungsgrad je Phase</h2><table><tr><th>Phase</th><th>Erledigt</th><th>Fortschritt</th><th>%</th></tr>{phrows}</table>'
    blocks = []
    for ws in doc['workstreams']:
        pref = ws['code'] + '-'
        erreicht, faellig, ueber = _ms_buckets(ws, now, start, end)
        fort = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'fortschritt' and str(x.get('ms_id', '')).startswith(pref)]
        li = ''
        if erreicht:
            li += '<li><b>Erreicht:</b> ' + ', '.join(e(m['id']) for m in erreicht) + '</li>'
        if faellig:
            li += '<li><b>Fällig (Monat):</b> ' + ', '.join(f'{e(m["id"])} ({de(m["due"])})' for m in faellig[:8]) + '</li>'
        if ueber:
            li += '<li style="color:#c0392b"><b>Überfällig:</b> ' + ', '.join(e(m['id']) for m in ueber[:8]) + '</li>'
        if fort:
            li += '<li class="muted">Fortschritts-Meldungen: ' + ', '.join(f'{e(x["ms_id"])}→{e(x.get("wert"))}%' for x in fort[:8]) + '</li>'
        k = kom(ws['code'])
        kdiv = f'<div class="kom"><b>Kommentar:</b> {e(k)}</div>' if k else ''
        done = sum(1 for m in ws['milestones'] if status_of(m, now) == 'done')
        blocks.append(f'<div class="wsblock"><div class="wshead">{e(ws["code"])} — {e(ws["name"])} {pill(ws_ampel(ws, now))} <span class="muted" style="font-weight:normal">· {done}/{len(ws["milestones"])} erledigt</span></div><ul>{li or "<li class=muted>keine Änderung im Monat</li>"}</ul>{kdiv}</div>')
    com = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'commitment']
    ent = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid' and x.get('status') == 'offen']
    tail = ''
    if com:
        over = [x for x in com if pdate(x.get('bis')) and now and pdate(x['bis']) < now]
        crows = ''.join(f'<tr><td style="width:54%">{e(x.get("text"))}</td><td style="width:22%">{e(x.get("owner"))}</td><td>{de(x.get("bis"))}{" ⚠" if x in over else ""}</td></tr>' for x in com)
        tail += f'<h2>Commitments (im Monat erfasst) — {len(over)} überfällig</h2><table><tr><th>Commitment</th><th>Owner</th><th>bis</th></tr>{crows}</table>'
    if ent:
        erows = ''.join(f'<tr><td style="width:82%">{e(x.get("text"))} {"<span class=vrflag>VR</span>" if x.get("ebene")=="VR" else ""}</td><td>offen</td></tr>' for x in ent)
        tail += f'<h2>Offene Entscheide</h2><table><tr><th>Entscheid</th><th>Status</th></tr>{erows}</table>'
    return cover + '<h2>Arbeitsströme</h2>' + ''.join(blocks) + tail


def render_vr(doc, meta, now, inper, label, kom):
    allms = [m for w in doc['workstreams'] for m in w['milestones']]
    base = pdate(meta.get('baseline_end'))
    # Kern-Ende-Projektion
    crit = [m for m in allms if m.get('critical') and not m.get('nachlauf') and status_of(m, now) == 'delayed']
    slip = max([max((now - pdate(m['due'])).days if pdate(m.get('due')) else 0, m.get('reported_slip_days') or 0) for m in crit], default=0)
    proj = base + dt.timedelta(days=slip) if base else None
    # Gates — eine Zeile je Gate (frühester Termin)
    gate_due = {}
    for m in allms:
        g = m.get('gate')
        if g:
            d = m.get('due')
            if g not in gate_due or (d and str(d) < str(gate_due[g])):
                gate_due[g] = d
    gates = sorted(gate_due.items())
    grows = ''.join(f'<tr><td style="width:14%"><b>{e(g)}</b></td><td>{de(d)}</td></tr>' for g, d in gates)
    # Phasen
    PH = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Nachlauf Q2/27']
    phrows = ''
    for ph in PH:
        ms = [m for m in allms if m.get('phase') == ph]
        if not ms:
            continue
        done = sum(1 for m in ms if status_of(m, now) == 'done')
        pct = round(done / len(ms) * 100)
        phrows += f'<tr><td style="width:28%">{e(ph)}</td><td style="width:14%">{done}/{len(ms)}</td><td><div class="bar"><i style="width:{pct}%"></i></div></td><td style="width:8%">{pct}%</td></tr>'
    # Entscheidungsbedarf VR
    vrent = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid' and x.get('status') == 'offen' and x.get('ebene') == 'VR']
    vrrows = ''.join(f'<tr><td>{e(x.get("text"))}</td><td style="width:22%" class="muted">{e(x.get("_meeting") or "")}</td></tr>' for x in [dict(x, _meeting=p.get("meeting_name")) for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid' and x.get('status') == 'offen' and x.get('ebene') == 'VR'])
    # Risiken = offene Blocker
    blk = [dict(x, _m=p.get('meeting_name')) for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'blocker']
    brows = ''.join(f'<tr><td style="width:14%"><b>{e(x.get("ms_id"))}</b></td><td>{e(x.get("text"))}</td><td style="width:12%">+{e(x.get("slip"))} T</td></tr>' for x in blk)
    # WS-Einzeiler
    wsrows = ''
    for ws in doc['workstreams']:
        done = sum(1 for m in ws['milestones'] if status_of(m, now) == 'done')
        wsrows += f'<tr><td style="width:9%"><b>{e(ws["code"])}</b></td><td>{e(ws["name"])}</td><td style="width:16%">{pill(ws_ampel(ws, now))}</td><td style="width:16%">{done}/{len(ws["milestones"])} erledigt</td></tr>'
    kprog = kom('programm')
    stmt = f'<div class="kom"><b>Chairman-Statement:</b> {e(kprog)}</div>' if kprog else ''
    endline = f'{de(base)}' + (f' → <b style="color:#c0392b">{de(proj)} (+{slip} T)</b>' if slip else ' · auf Basislinie')
    return (
        f'<div class="kpi"><div class="kpibox"><div class="l">Kern-Ende</div><div class="v" style="font-size:10pt">{endline}</div></div>'
        f'<div class="kpibox"><div class="l">Hard Edge</div><div class="v" style="font-size:11pt">{de(meta.get("hard_edge"))}</div></div>'
        f'<div class="kpibox"><div class="l">Meilensteine</div><div class="v">{len(allms)}</div></div></div>'
        f'{stmt}'
        f'<h2>Zielerreichung je Phase</h2><table><tr><th>Phase</th><th>Erledigt</th><th>Fortschritt</th><th>%</th></tr>{phrows}</table>'
        f'<h2>Sequenz-Gates</h2><table><tr><th>Gate</th><th>Termin</th></tr>{grows}</table>'
        f'<h2>Entscheidungsbedarf VR</h2>' + (f'<table><tr><th>Entscheid</th><th>Quelle</th></tr>{vrrows}</table>' if vrrows else '<p class="muted">keine VR-Entscheide offen im Quartal.</p>')
        + f'<h2>Top-Risiken (offene Blocker)</h2>' + (f'<table><tr><th>MS</th><th>Risiko</th><th>Verzug</th></tr>{brows}</table>' if brows else '<p class="muted">keine offenen Blocker erfasst.</p>')
        + f'<h2>Status je Arbeitsstrom</h2><table><tr><th>WS</th><th>Bezeichnung</th><th>Ampel</th><th>Fortschritt</th></tr>{wsrows}</table>'
    )


def build_md(title, label, prog_ampel, level, doc, meta, now, inper, start, end, kom):
    # Kompakte Markdown-Fassung fürs Google Doc (echte Tabellen via md_to_gdoc)
    def esc(s): return str(s if s is not None else '').replace('|', '\\|').replace('\n', ' ')
    allms = [m for w in doc['workstreams'] for m in w['milestones']]
    L = [f"# {title}", "", f"Projekt RUBICON · Programm-Ampel: {SIG_LBL[prog_ampel]} · Stand {STAMP} · verdichtet aus der RUBICON-Plattform", ""]
    PH = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Nachlauf Q2/27']
    if level in ('monat', 'vr'):
        L += ["## Erfüllungsgrad je Phase", "", "| Phase | Erledigt | % |", "|---|---|---|"]
        for ph in PH:
            ms = [m for m in allms if m.get('phase') == ph]
            if not ms:
                continue
            done = sum(1 for m in ms if status_of(m, now) == 'done')
            L.append(f"| {ph} | {done}/{len(ms)} | {round(done/len(ms)*100)}% |")
        L.append("")
    L += ["## Status je Arbeitsstrom", "", "| WS | Bezeichnung | Ampel | Erledigt |", "|---|---|---|---|"]
    for ws in doc['workstreams']:
        done = sum(1 for m in ws['milestones'] if status_of(m, now) == 'done')
        L.append(f"| {ws['code']} | {esc(ws['name'])} | {SIG_LBL[ws_ampel(ws, now)]} | {done}/{len(ws['milestones'])} |")
    L.append("")
    if level == 'vr':
        vr = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid' and x.get('status') == 'offen' and x.get('ebene') == 'VR']
        L += ["## Entscheidungsbedarf VR", ""] + ([f"- {esc(x.get('text'))}" for x in vr] or ["- keine"]) + [""]
        blk = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'blocker']
        L += ["## Top-Risiken (offene Blocker)", ""] + ([f"- {esc(x.get('ms_id'))}: {esc(x.get('text'))} (+{esc(x.get('slip'))} T)" for x in blk] or ["- keine"]) + [""]
        if kom('programm'):
            L += ["## Chairman-Statement", "", esc(kom('programm')), ""]
    else:
        com = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'commitment']
        if com:
            L += ["## Commitments der Periode", "", "| Commitment | Owner | bis |", "|---|---|---|"] + [f"| {esc(x.get('text'))} | {esc(x.get('owner'))} | {de(x.get('bis'))} |" for x in com] + [""]
        ent = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid' and x.get('status') == 'offen']
        if ent:
            L += ["## Offene Entscheide", ""] + [f"- {esc(x.get('text'))}{' [VR]' if x.get('ebene')=='VR' else ''}" for x in ent] + [""]
    return "\n".join(L) + "\n"


if __name__ == '__main__':
    main()
