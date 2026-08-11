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
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml


log = logging.getLogger("rubicon.report")


def _is_server():
    return bool(os.environ.get("RUBICON_WORKSPACE_SA") and os.environ.get("RUBICON_IMPERSONATE_SUBJECT"))


def _reports_folder():
    return os.environ.get("RUBICON_DRIVE_REPORTS_FOLDER", PARENT)


def _merge_report_record(prev, base, doc_id, server):
    """Merge-sicheren Report-Datensatz bilden: bestehende Felder erhalten (v.a. die
    doc-Felder der ANDEREN Umgebung), nur die Felder DIESER Umgebung + die geteilten
    (base) aktualisieren. Server schreibt server_doc_id/server_doc_url, lokal
    doc_id/doc_url — so ueberschreiben sich die Umgebungen im selben Index nie."""
    rec = dict(prev) if prev else {}
    rec.update(base)
    doc_key = 'server_doc_id' if server else 'doc_id'
    url_key = 'server_doc_url' if server else 'doc_url'
    rec[doc_key] = doc_id
    rec[url_key] = f'https://docs.google.com/document/d/{doc_id}/edit' if doc_id else None
    return rec


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402
from _lib import atomic_write as _atomic_write, docs_dir  # noqa: E402
import ai_client  # noqa: E402 — KI-Modell-Fassade (lokale CLI / Vertex), s. _tools/ai_client.py

MD2GDOC = '/Users/dieterstreuli/Chief/Tools/md_to_gdoc.py'
import os as _os
if not _os.path.exists(MD2GDOC):
    MD2GDOC = __file__.rsplit('/', 1)[0] + '/_tools/md_to_gdoc.py'  # vendored (Portabilität)
PARENT = '1hiuxVPBO3Hwd3I0g1lDTxKFAwk851Y0m'  # Drive: RUBICON — Reports (Shared Drive „00 AXS - Rubicon", s. DEPLOYMENT_GCP §9.2).
# Fallback-Default MUSS auf den gueltigen Reports-Ordner zeigen: die Vorlagen-Engine (materialize) KOPIERT
# je Lauf in diesen Ordner — anders als der fruehere MD->Doc-Weg, der ein bestehendes Doc wiederverwendete.
# Der on-demand-Report des Web-Service hat RUBICON_DRIVE_REPORTS_FOLDER nicht zwingend gesetzt und fiel sonst
# auf einen stale/404-Ordner zurueck (File not found beim copy). Der Job setzt die Env zusaetzlich (gleicher Wert).
DATA = ROOT / 'src' / 'data'
OUT = Path(docs_dir('reports', ROOT))
LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
STAMP = dt.datetime.now().strftime('%d.%m.%Y %H:%M')
MON = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
from _domain import SIG, SIG_LBL, ORDER, PHASEN  # Domänen-SSOT (Q2, 01.08.) — src/data/domain.json


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


def generate(level, period, ki=False):
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

    title = {'vr': f'VR-Report — {label}', 'monat': f'Monats-Report — {label}',
             'woche': f'Wochen-Report — {label}'}[level]

    OUT.mkdir(parents=True, exist_ok=True)
    slug = f'{level}-{period}'.replace('/', '-')
    pdf_rel = f'/reports/{slug}.pdf'
    idx = json.loads((DATA / 'reports_index.json').read_text())
    prev = next((r for r in idx['reports'] if r['id'] == slug), None)
    # Dual-Mode: die doc_id ist umgebungsspezifisch. Der Server fuehrt eigene Felder
    # (server_doc_id/server_doc_url) und fasst Dieters lokale doc_id/doc_url NIE an;
    # lokal bleibt alles wie bisher. Merge-by-Key haelt beide Umgebungen nebeneinander.
    server = _is_server()
    doc_id = prev.get('server_doc_id' if server else 'doc_id') if prev else None
    pdf_file_id = prev.get('server_pdf_id') if prev else None

    if server:
        # Server (Web-App): gebrandete Template-Engine (Weg 1). report_spec -> {{ANKER}} füllen,
        # gebrandetes Doc BLEIBT + PDF. Ersetzt den frueheren MD->Doc-Weg (build_md/gdoc_pdf) fuer
        # Reporte. Der KI-Entwurf (Narrativ/Begruendungen) steckt jetzt IM Doc (report_spec), nicht
        # mehr nur im lokalen HTML. materialize legt je Lauf ein neues Doc an und trasht das vorige
        # (selbstheilend gegen stale/geloeschte prev-IDs — trash+upload sind non-fatal).
        from googleapiclient.discovery import build
        from _google_auth import load_credentials
        sys.path.insert(0, str(Path(__file__).parent / '_tools'))
        import doc_materialize as dm
        creds = load_credentials()
        _t0 = time.monotonic()
        drive = build('drive', 'v3', credentials=creds)
        docs = build('docs', 'v1', credentials=creds)
        spec = report_spec(level, doc, meta, now, inper, start, end, label, prog_ampel, kom, ki=ki)
        r = dm.materialize(drive, docs, template_id=dm.template_id(level), name=title,
                           folder_id=_reports_folder(), values=spec['values'],
                           tables=spec.get('tables'), bullets=spec.get('bullets'),
                           prev_doc_id=doc_id, prev_pdf_id=pdf_file_id)
        pdf = r['pdf_bytes']
        doc_id = r['doc_id']
        # materialize-Upload ist non-fatal -> pdf_id kann None sein; validen alten Wert NICHT
        # mit None ueberschreiben (sonst geht der Link auf das eingefrorene Drive-PDF verloren).
        pdf_file_id = r['pdf_id'] or pdf_file_id
        (OUT / f'{slug}.pdf').write_bytes(pdf)
        log.info("server report slug=%s doc_id=%s pdf_id=%s pdf_bytes=%d total_ms=%d",
                 slug, doc_id, pdf_file_id, len(pdf), int((time.monotonic() - _t0) * 1000))
    else:
        # --- lokaler Pfad (Dieter, Mac) UNVERAENDERT: HTML->Chrome-PDF + md_to_gdoc-Subprocess ---
        if level == 'vr':
            body = render_vr(doc, meta, now, inper, label, kom)
        elif level == 'monat':
            body = render_monat(doc, meta, now, inper, start, end, label, kom)
        else:
            body = render_woche(doc, meta, now, inper, start, end, label, kom)
            # K3: deterministischer Δ-Block («Was hat sich geändert?») vorangestellt.
            try:
                import gen_delta
                body = render_delta_html(gen_delta.compute(7)) + body
            except Exception as ex:  # noqa: BLE001 — Report bleibt auch ohne Δ nutzbar
                body = f'<p class="muted">Δ-Woche nicht verfügbar ({e(str(ex)[:100])})</p>' + body
        if ki:
            body += ki_block(level, doc, now, label)
        html_doc = f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<h1>{e(title)}</h1>
<div class="sub">Projekt RUBICON («Alea iacta est.») · Programm-Ampel {pill(prog_ampel)} · Stand {STAMP} · automatisch aus der RUBICON-Plattform verdichtet</div>
{body}
<div class="foot">Automatisch generiert aus projekt.yaml + protokolle.json — verdichtete Sicht, kein manuelles Zusammentragen. Live-Detail: RUBICON Control Tower. Vertraulich ExBoD/VR.</div>
</body></html>"""
        md = build_md(title, label, prog_ampel, level, doc, meta, now, inper, start, end, kom)
        hp = Path(tempfile.mktemp(suffix='.html'))
        hp.write_text(html_doc)
        html_to_pdf(str(hp), str(OUT / f'{slug}.pdf'))
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
            f.write(md); mdp = f.name
        cmd = ['python3', MD2GDOC, mdp, title, _reports_folder()]
        if prev and prev.get('doc_id'):
            cmd += ['--doc-id', prev['doc_id']]
        out = subprocess.run(cmd, capture_output=True, text=True)
        m = re.search(r'/document/d/([A-Za-z0-9_-]+)/', out.stdout)
        doc_id = m.group(1) if m else doc_id

    base = {'id': slug, 'level': level, 'period': period, 'label': label,
            'pdf': pdf_rel, 'stand': STAMP}
    if server:
        base['server_pdf_id'] = pdf_file_id
        base['server_pdf_url'] = f'https://drive.google.com/file/d/{pdf_file_id}/view' if pdf_file_id else None
    rec = _merge_report_record(prev, base, doc_id, server)
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
                # K5 (10.08.): KI-Entwurf jetzt in JEDEM Auto-Report (nicht nur Woche)
                res.append(generate(lvl, per, ki=True))
            except Exception as ex:  # noqa: BLE001
                log.exception("report failed level=%s periode=%s", lvl, per)
                res.append({'ok': False, 'level': lvl, 'error': str(ex)})
        print(json.dumps({'auto': True, 'results': res}, ensure_ascii=False))
    else:
        print(json.dumps(generate(sys.argv[1], sys.argv[2], ki='--ki' in sys.argv), ensure_ascii=False))


# ---------- Δ-Woche (K3) + KI-Entwurf (K5) ----------
# Die frühere lokale-CLI-Binary-Konstante lebt jetzt in _tools/ai_client.py (Dispatch lokale CLI / Vertex).
# Inline-Fallback des Prompt-Templates — kanonisch: scripts/prompts/ki_narrativ.txt.
KI_PROMPT_FALLBACK = (
    'Du bist Programm-Analyst des AXS-Transformationsprogramms RUBICON. Antworte NUR mit einem JSON-Objekt:\n'
    '{"narrativ": "<5-8 Sätze Management-Zusammenfassung des Berichtszeitraums (siehe FAKTEN.zeitraum) — was geschah, was es fürs Programm bedeutet; nüchtern, deutsch>",\n'
    ' "begruendungen": {"<ms_id>": "<2 Sätze: warum gefährdet/verzögert + welche Gegenmassnahme naheliegt>"}}\n'
    'HARTE REGELN: Nutze AUSSCHLIESSLICH die folgenden Fakten — nichts erfinden, keine Zahlen ausserhalb der Daten. '
    'Wenn die Fakten für eine Begründung nicht reichen: "Datenlage unzureichend — beim Owner nachfassen." '
    'Kein Lob, kein Alarmismus.\n'
)


def render_delta_html(d):
    s = d.get('summe', {})
    if not any(s.values()):
        return '<h2>Δ zur Vorwoche</h2><p class="muted">Keine Veränderungen im Fenster.</p>'
    parts = [f'<h2>Δ zur Vorwoche ({de(d["fenster"]["von"])} – {de(d["fenster"]["bis"])})</h2>']
    if d.get('ampel'):
        rows = ''.join(f'<tr><td>{e(x["id"])}</td><td>{e(x["name"])}</td><td>{pill(x["von"])} → {pill(x["zu"])}</td></tr>' for x in d['ampel'][:10])
        parts.append(f'<h3>Ampel-Wechsel</h3><table><tr><th>MS</th><th>Meilenstein</th><th>Wechsel</th></tr>{rows}</table>')
    if d.get('fortschritt'):
        rows = ''.join(f'<tr><td>{e(x["id"])}</td><td>{e(x["name"])}</td><td>{e(x.get("von"))}% → {e(x.get("zu"))}%</td></tr>' for x in d['fortschritt'][:12])
        parts.append(f'<h3>Fortschritts-Änderungen</h3><table><tr><th>MS</th><th>Meilenstein</th><th>Δ</th></tr>{rows}</table>')
    if d.get('erledigt'):
        rows = ''.join(f'<tr><td>{e(x["nr"])}</td><td>{e(x["text"])}</td><td>{e(x.get("owner"))}</td><td>{de(x["am"])}</td></tr>' for x in d['erledigt'][:15])
        parts.append(f'<h3>Erledigte Handlungen ({len(d["erledigt"])})</h3><table><tr><th>Nr</th><th>Handlung</th><th>Owner</th><th>am</th></tr>{rows}</table>')
    if d.get('entscheide'):
        rows = ''.join(f'<tr><td>{e(x["id"])}</td><td>{e(x["titel"])}</td><td>{e(x["status"])}</td></tr>' for x in d['entscheide'])
        parts.append(f'<h3>Entscheide (neu/bewegt)</h3><table><tr><th>ID</th><th>Titel</th><th>Status</th></tr>{rows}</table>')
    return ''.join(parts)


_ZEITRAUM_WORT = {'woche': 'Woche', 'monat': 'Monat', 'vr': 'Quartal'}


def ki_data(level, doc, now, label):
    """KI-ENTWURF strukturiert: {'narrativ': str, 'begruendungen': {ms_id: text}, 'error': bool}.
    Fakten-gebunden — der Prompt erhält NUR Plattform-Daten. Fehler/Leerfall werden als
    narrativ-Hinweis SICHTBAR gemacht (nie stilles Verschwinden). EINE Fassade für beide
    Ausgabewege: HTML (ki_block, lokal) und Template-Werte (report_spec, Server)."""
    try:
        allms = [m for w in doc['workstreams'] for m in w['milestones']]
        problems = [m for m in allms if status_of(m, now) in ('delayed', 'atRisk')][:12]
        briefings = {}
        bp = DATA / 'briefings.json'
        if bp.exists():
            briefings = json.loads(bp.read_text())
        facts = {
            'zeitraum': f'{_ZEITRAUM_WORT.get(level, level)} {label}',
            'stichtag': doc['meta'].get('today'),
            'problem_ms': [{
                'id': m['id'], 'name': m.get('name'), 'owner': m.get('owner'), 'due': m.get('due'),
                'progress': m.get('progress'), 'verzug_tage': m.get('reported_slip_days') or 0,
                'status': status_of(m, now),
                'kontext': (briefings.get(m['id'], {}).get('kontext') or '')[:280],
            } for m in problems],
        }
        if level == 'woche':
            import gen_delta
            d = gen_delta.compute(7)
            # NUR die Kern-Änderungen an die KI (IDs + Übergänge/Δ) — NICHT die teils sehr langen
            # Meilenstein-Namen/Beschreibungen (manche tragen ganze Statusabsätze + URLs). Sonst
            # bläht der Prompt so auf, dass das Modell sein Token-Budget im Thinking verbraucht und
            # KEINEN Text mehr liefert (leerer KI-Entwurf — nur beim Wochen-Report reproduziert).
            facts['delta'] = {
                'summe': d.get('summe'),
                'ampel': [{'id': x.get('id'), 'von': x.get('von'), 'zu': x.get('zu')} for x in d.get('ampel', [])[:15]],
                'fortschritt': [{'id': x.get('id'), 'von': x.get('von'), 'zu': x.get('zu')} for x in d.get('fortschritt', [])[:15]],
                'erledigt': [{'nr': x.get('nr'), 'text': (x.get('text') or '')[:120]} for x in d.get('erledigt', [])[:15]],
            }
        template = ai_client.load_prompt(KI_PROMPT_FALLBACK)
        prompt = template.rstrip('\n') + '\n\nFAKTEN:\n' + json.dumps(facts, ensure_ascii=False)
        out = ai_client.generate(prompt)
        m = re.search(r'\{[\s\S]*\}', out)
        data = json.loads(m.group(0)) if m else {}
        # Modellausgabe ist UNTRUSTED: der Prompt fordert ein Objekt, garantiert es aber nicht.
        # Hart auf {narrativ:str, begruendungen:{str:str}} normalisieren, sonst wirft ein späteres
        # .items() beim Konsumenten (report_spec/ki_block) — AUSSERHALB dieses try.
        data = data if isinstance(data, dict) else {}
        narrativ = str(data.get('narrativ') or '')
        raw_beg = data.get('begruendungen')
        beg = {str(k): str(v) for k, v in raw_beg.items()} if isinstance(raw_beg, dict) else {}
        if not narrativ and not beg:
            log.warning('ki_data: leere Modellausgabe level=%s period=%s', level, label)
            narrativ = ('Keine KI-Ausgabe für diesen Zeitraum (keine Auffälligkeiten oder leere '
                        'Modellantwort) — bei Bedarf erneut erzeugen.')
        return {'narrativ': narrativ, 'begruendungen': beg, 'error': False}
    except Exception as ex:  # noqa: BLE001 — sichtbar machen statt still leer
        log.warning('ki_data fehlgeschlagen level=%s period=%s: %s', level, label, ex)
        return {'narrativ': f'KI-Entwurf nicht verfügbar: {str(ex)[:200]}. Ampel und Zahlen bleiben '
                            'deterministisch; bitte erneut erzeugen.',
                'begruendungen': {}, 'error': True}


def ki_block(level, doc, now, label):
    """HTML-Fassung des KI-Entwurfs (lokaler Pfad). Nutzt ki_data (eine Quelle, EIN Modell-Call)."""
    header = '<h2 style="color:#b07d2c">🤖 KI-Entwurf — ungeprüft, Freigabe durch CoS/DRS</h2>'
    d = ki_data(level, doc, now, label)
    parts = [header]
    if d['narrativ']:
        parts.append(f'<p>{e(d["narrativ"])}</p>')
    if d['begruendungen']:
        rows = ''.join(f'<tr><td>{e(k)}</td><td>{e(v)}</td></tr>' for k, v in d['begruendungen'].items())
        parts.append(f'<h3>Ampel-Begründungen (Entwurf)</h3><table><tr><th>MS</th><th>Warum + Gegenmassnahme</th></tr>{rows}</table>')
    if not d['error']:
        parts.append('<p class="muted">Automatisch entworfen auf Basis der Plattform-Daten — Ampel und Zahlen bleiben deterministisch; dieser Block ist Interpretation und wird vor Verteilung geprüft.</p>')
    return ''.join(parts)


# ---------- report_spec: report-Daten -> Template-Engine (Weg 1, Server) ----------
# Server rendert die Reporte jetzt aus den gebrandeten {{ANKER}}-Vorlagen (woche/monat/vr) statt
# via MD->Doc. Die Anker-Namen MÜSSEN 1:1 zu build_type_from_base.py passen. Ampel-Farbe/-Label
# kommen aus der Domänen-SSOT (SIG/SIG_LBL). Spaltenbreiten: Portrait nutzbar ~495pt (Ränder 50),
# Landscape entfällt hier (Reporte sind Portrait) -> jede Tabellensumme <= 490pt.
NAVY = {'red': 0x1E / 255, 'green': 0x3E / 255, 'blue': 0x58 / 255}
REPORT_FOOTER = ('Automatisch aus der RUBICON-Plattform verdichtet  ·  Ampel und Zahlen '
                 'deterministisch  ·  Live-Detail: RUBICON Control Tower  ·  Vertraulich — ExBoD / VR')
PROJEKT_SUB = 'Projekt RUBICON («Alea iacta est.»)'


def _hex_rgb(h):
    h = h.lstrip('#')
    return {'red': int(h[0:2], 16) / 255, 'green': int(h[2:4], 16) / 255, 'blue': int(h[4:6], 16) / 255}


def _s(v, default='—'):
    """None-sichere String-Koerzierung fuers Doc (kein rohes 'None'/'+None T' im Management-Report)."""
    return default if v is None else str(v)


def _tbl(header, rows, widths):
    return {'header': header, 'rows': rows, 'col_widths_pt': widths, 'header_bg': NAVY}


def report_spec(level, doc, meta, now, inper, start, end, label, prog_ampel, kom, ki=True):
    """report-Daten -> {name, values, tables, bullets} für die Report-Vorlage (Weg 1).
    Deterministisch (Ampel/Zahlen) + optionaler KI-Entwurf (Narrativ/Begründungen)."""
    allms = [m for w in doc['workstreams'] for m in w['milestones']]
    title = {'vr': f'VR-Report — {label}', 'monat': f'Monats-Report — {label}',
             'woche': f'Wochen-Report — {label}'}[level]
    kd = ki_data(level, doc, now, label) if ki else {
        'narrativ': 'KI-Entwurf für diesen Lauf deaktiviert.', 'begruendungen': {}}
    values = {'TITEL': label, 'UNTERTITEL': PROJEKT_SUB, 'PROGRAMM_AMPEL': SIG_LBL.get(prog_ampel, prog_ampel),
              'STAND': STAMP, 'FOOTER': REPORT_FOOTER, 'KI_NARRATIV': kd['narrativ']}
    tables, bullets = {}, {}
    beg_rows = [[k, v] for k, v in (kd['begruendungen'] or {}).items()] or [['—', '—']]
    tables['{{KI_BEGRUENDUNGEN}}'] = _tbl(['Meilenstein', 'Warum gefährdet + Gegenmassnahme'], beg_rows, [90, 400])

    def phasen_table():
        rows = []
        for ph in PHASEN:
            ms = [m for m in allms if m.get('phase') == ph]
            if not ms:
                continue
            done = sum(1 for m in ms if status_of(m, now) == 'done')
            rows.append([ph, f'{done} / {len(ms)}', f'{round(done / len(ms) * 100)} %'])
        return _tbl(['Phase', 'Erledigt', 'Anteil'], rows, [290, 105, 90])

    def ws_table():
        rows, ctr = [], {}
        for i, ws in enumerate(doc['workstreams']):
            st = ws_ampel(ws, now)
            done = sum(1 for m in ws['milestones'] if status_of(m, now) == 'done')
            rows.append([ws['code'], ws['name'], SIG_LBL.get(st, st), f'{done} / {len(ws["milestones"])}'])
            ctr[(i, 2)] = _hex_rgb(SIG.get(st, '#6b7480'))
        return dict(_tbl(['WS', 'Bezeichnung', 'Ampel', 'Erledigt'], rows, [38, 322, 75, 55]), cell_text_rgb=ctr)

    def commitments_table(overdue_mark=False):
        com = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'commitment']
        def _bis(x):
            d = de(x.get('bis'))
            od = pdate(x.get('bis'))
            return f'{d} ⚠' if (overdue_mark and od and now and od < now) else d
        rows = [[_s(x.get('text')), _s(x.get('owner')), _bis(x)] for x in com] or [['keine', '—', '—']]
        return _tbl(['Commitment', 'Owner', 'bis'], rows, [300, 105, 85])

    # Alle Sektionen bilden 1:1 den alten HTML-Report ab (render_vr/monat/woche + render_delta_html) —
    # nichts weglassen (Gordon 2026-08-10: „nur erweitern, nicht weniger"). Zusatz: Basis-Chrome + KI im Doc.
    if level == 'vr':
        base = pdate(meta.get('baseline_end'))
        crit = [m for m in allms if m.get('critical') and not m.get('nachlauf') and status_of(m, now) == 'delayed']
        slip = max([max((now - pdate(m['due'])).days if pdate(m.get('due')) else 0, m.get('reported_slip_days') or 0)
                    for m in crit], default=0)
        proj = base + dt.timedelta(days=slip) if base else None
        endline = de(base) + (f' → {de(proj)} (+{slip} T)' if slip else ' · auf Basislinie')
        tables['{{KENNZAHLEN}}'] = _tbl(['Kern-Ende', 'Hard Edge', 'Meilensteine'],
                                        [[endline, de(meta.get('hard_edge')), str(len(allms))]], [210, 160, 120])
        values['CHAIRMAN_STATEMENT'] = kom('programm') or '—'
        tables['{{PHASEN_TABELLE}}'] = phasen_table()
        gate_due = {}
        for m in allms:
            g = m.get('gate')
            if g:
                d = m.get('due')
                if g not in gate_due or (d and str(d) < str(gate_due[g])):
                    gate_due[g] = d
        grows = [[_s(g), de(d)] for g, d in sorted(gate_due.items())] or [['—', '—']]
        tables['{{GATES_TABELLE}}'] = _tbl(['Gate', 'Termin'], grows, [140, 350])
        vrent = [dict(x, _m=p.get('meeting_name')) for p in inper for x in p.get('eintraege', [])
                 if x.get('typ') == 'entscheid' and x.get('status') == 'offen' and x.get('ebene') == 'VR']
        erows = [[_s(x.get('text')), _s(x.get('_m'), '')] for x in vrent] or [['keine VR-Entscheide offen im Quartal', '']]
        tables['{{ENTSCHEIDUNGSBEDARF_TABELLE}}'] = _tbl(['Entscheid', 'Quelle'], erows, [360, 130])
        blk = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'blocker']
        brows = [[_s(x.get('ms_id')), _s(x.get('text')), f'+{_s(x.get("slip"), "0")} T'] for x in blk] or [['—', 'keine offenen Blocker erfasst', '—']]
        tables['{{RISIKEN_TABELLE}}'] = _tbl(['MS', 'Risiko', 'Verzug'], brows, [70, 350, 70])
        tables['{{WS_TABELLE}}'] = ws_table()
    elif level == 'monat':
        values['KOMMENTAR'] = kom('programm') or '—'
        tables['{{PHASEN_TABELLE}}'] = phasen_table()
        tables['{{WS_TABELLE}}'] = ws_table()
        bew = []
        for ws in doc['workstreams']:
            erreicht, faellig, ueber = _ms_buckets(ws, now, start, end)
            bew.append([ws['code'], ', '.join(m['id'] for m in erreicht) or '—',
                        ', '.join(f'{m["id"]} ({de(m["due"])})' for m in faellig[:8]) or '—',
                        ', '.join(m['id'] for m in ueber[:8]) or '—'])
        tables['{{BEWEGUNGEN}}'] = _tbl(['WS', 'Erreicht', 'Fällig (Monat)', 'Überfällig'], bew, [40, 130, 165, 155])
        frows = []
        for ws in doc['workstreams']:
            pref = ws['code'] + '-'
            fort = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'fortschritt' and str(x.get('ms_id', '')).startswith(pref)]
            if fort:
                frows.append([ws['code'], ', '.join(f'{_s(x.get("ms_id"))} → {_s(x.get("wert"))} %' for x in fort[:8])])
        tables['{{FORTSCHRITT_TABELLE}}'] = _tbl(['WS', 'Fortschritts-Meldungen'], frows or [['—', 'keine Fortschritts-Meldungen im Monat']], [50, 440])
        krows = [[ws['code'], _s(kom(ws['code']))] for ws in doc['workstreams'] if kom(ws['code'])]
        tables['{{WS_KOMMENTARE}}'] = _tbl(['WS', 'Kommentar'], krows or [['—', 'keine Kommentare erfasst']], [50, 440])
        tables['{{COMMITMENTS_TABELLE}}'] = commitments_table(overdue_mark=True)
        ent = [x for p in inper for x in p.get('eintraege', [])
               if x.get('typ') == 'entscheid' and x.get('status') == 'offen']
        erows = [[_s(x.get('text')) + (' [VR]' if x.get('ebene') == 'VR' else ''), 'offen'] for x in ent] or [['keine', '—']]
        tables['{{OFFENE_ENTSCHEIDE}}'] = _tbl(['Entscheid', 'Status'], erows, [405, 85])
    else:  # woche
        values['KOMMENTAR'] = kom('programm') or '—'
        def _pct(v):
            return '—' if v is None else f'{v} %'
        # Δ-Block darf den Report nicht kippen (Store-Read kann werfen) — wie der lokale Pfad.
        try:
            import gen_delta
            dl = gen_delta.compute(7)
        except Exception as ex:  # noqa: BLE001 — Report bleibt auch ohne Δ nutzbar
            log.warning('report_spec Δ-Woche nicht verfügbar: %s', ex)
            dl = None
        # Δ-Bezugsfenster sichtbar machen (compute(7) = letzte 7 Tage ab Lauf, NICHT die Report-KW).
        fw = (dl or {}).get('fenster') or {}
        values['DELTA_FENSTER'] = (f"Fenster: {de(fw.get('von'))} – {de(fw.get('bis'))}"
                                   if fw else 'Fenster nicht verfügbar')
        if dl is None:
            note = 'Δ nicht verfügbar'
            tables['{{DELTA_AMPEL}}'] = _tbl(['MS', 'Meilenstein', 'Wechsel'], [['—', note, '—']], [70, 250, 170])
            tables['{{DELTA_FORTSCHRITT}}'] = _tbl(['MS', 'Meilenstein', 'Δ'], [['—', note, '—']], [70, 250, 170])
            tables['{{DELTA_ERLEDIGT}}'] = _tbl(['Nr', 'Handlung', 'Owner', 'am'], [['—', note, '—', '—']], [40, 280, 90, 80])
            tables['{{DELTA_ENTSCHEIDE}}'] = _tbl(['ID', 'Titel', 'Status'], [['—', note, '—']], [70, 320, 100])
        else:
            amp = list(dl.get('ampel', [])[:10])
            arow = [[_s(x.get('id')), _s(x.get('name')), f'{SIG_LBL.get(x.get("von"), x.get("von"))} → {SIG_LBL.get(x.get("zu"), x.get("zu"))}'] for x in amp]
            # Ampel-Wechsel-Zelle in der ZIEL-Ampelfarbe (neuer Status) einfärben — sonst zeigt der
            # Wochen-Report gar keine Ampelfarben (die „Status je Arbeitsstrom"-Tabelle hat er nicht).
            a_ctr = {(r, 2): _hex_rgb(SIG.get(x.get('zu'), '#6b7480')) for r, x in enumerate(amp)}
            frow = [[_s(x.get('id')), _s(x.get('name')), f'{_pct(x.get("von"))} → {_pct(x.get("zu"))}'] for x in dl.get('fortschritt', [])[:12]]
            erl = dl.get('erledigt', [])
            erow = [[_s(x.get('nr')), _s(x.get('text')), _s(x.get('owner')), de(x.get('am'))] for x in erl[:15]]
            if len(erl) > 15:  # Gesamtzahl bei Kappung nicht verschlucken (alt: „Erledigte Handlungen (N)")
                erow.append(['—', f'… und {len(erl) - 15} weitere', '—', '—'])
            enrow = [[_s(x.get('id')), _s(x.get('titel')), _s(x.get('status'))] for x in dl.get('entscheide', [])]
            tables['{{DELTA_AMPEL}}'] = dict(_tbl(['MS', 'Meilenstein', 'Wechsel'],
                arow or [['—', 'keine Ampel-Wechsel', '—']], [70, 250, 170]), cell_text_rgb=(a_ctr if arow else {}))
            tables['{{DELTA_FORTSCHRITT}}'] = _tbl(['MS', 'Meilenstein', 'Δ'], frow or [['—', 'keine Fortschritts-Änderungen', '—']], [70, 250, 170])
            tables['{{DELTA_ERLEDIGT}}'] = _tbl(['Nr', 'Handlung', 'Owner', 'am'], erow or [['—', 'keine erledigten Handlungen', '—', '—']], [40, 280, 90, 80])
            tables['{{DELTA_ENTSCHEIDE}}'] = _tbl(['ID', 'Titel', 'Status'], enrow or [['—', 'keine Entscheide bewegt', '—']], [70, 320, 100])
        arows, actr, i = [], {}, 0
        for ws in doc['workstreams']:
            pref = ws['code'] + '-'
            fort = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'fortschritt' and str(x.get('ms_id', '')).startswith(pref)]
            blk = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'blocker' and str(x.get('ms_id', '')).startswith(pref)]
            if not (fort or blk):
                continue
            acts = [f'{_s(x.get("ms_id"))} → {_s(x.get("wert"))} % · {_s(x.get("text"))}' for x in fort]
            acts += [f'{_s(x.get("ms_id"))} +{_s(x.get("slip"), "0")} T · {_s(x.get("text"))}' for x in blk]
            st = ws_ampel(ws, now)
            arows.append([f'{ws["code"]} — {ws["name"]}', SIG_LBL.get(st, st), ' · '.join(acts)])
            actr[(i, 1)] = _hex_rgb(SIG.get(st, '#6b7480'))
            i += 1
        tables['{{AKTIVITAET_TABELLE}}'] = dict(
            _tbl(['Arbeitsstrom', 'Ampel', 'Aktivität der Woche'],
                 arows or [['—', '—', 'keine Fortschritts-/Blocker-Meldungen in dieser Woche']], [150, 70, 270]),
            cell_text_rgb=actr)
        tables['{{COMMITMENTS_TABELLE}}'] = commitments_table()
        ent = [x for p in inper for x in p.get('eintraege', []) if x.get('typ') == 'entscheid']
        erows = [[_s(x.get('text')) + (' [VR]' if x.get('ebene') == 'VR' else ''), _s(x.get('status'))] for x in ent] or [['keine', '—']]
        tables['{{ENTSCHEIDE_TABELLE}}'] = _tbl(['Entscheid', 'Status'], erows, [405, 85])
    return {'name': title, 'values': values, 'tables': tables, 'bullets': bullets}


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
    PH = PHASEN
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
    PH = PHASEN
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
    PH = PHASEN
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
    # Logs (rubicon.report/rubicon.gdoc: Messpunkte + Fehler) auf stderr sichtbar machen;
    # stdout bleibt sauberes JSON (server.mjs parst stdout). Ohne dies unterdrückt der
    # Root-Default (WARNING) alle INFO-Messpunkte — ein Job-Fehler bleibt unsichtbar.
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s %(message)s',
        stream=sys.stderr,
    )
    main()
