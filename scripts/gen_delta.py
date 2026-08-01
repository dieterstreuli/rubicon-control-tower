#!/usr/bin/env python3
"""gen_delta.py — deterministischer Wochen-Delta («Was hat sich geändert?»).

B2/K3 (01.08.): Vergleicht den heutigen Stand mit dem git-Stand von vor N Tagen
(projekt.yaml ist git-versioniert — die Historie IST das Änderungsjournal) und
sammelt aus den Stores die Ereignisse im Fenster:

  · erledigte Handlungen   (tasks.json, erledigt_am im Fenster, inkl. erledigt_von)
  · Fortschritts-Änderungen je Milestone (git: alt→neu)
  · Ampel-Wechsel je Milestone (status_of alt/neu — Logik aus gen_report, Parität!)
  · neue Protokolle / Entscheide (created_at bzw. datum im Fenster)

REINE FAKTEN, kein KI-Anteil. Aufruf: gen_delta.py [--days 7] [--json]
Als Modul: compute(days) → dict. Letzte stdout-Zeile = JSON.
"""
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'src' / 'data'
sys.path.insert(0, str(ROOT / 'scripts'))
import gen_report as gr  # noqa: E402 — status_of/pdate 1:1 wiederverwenden (Paritäts-Disziplin)

import yaml  # noqa: E402


def _git(*args):
    r = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ''


def _ms_index(doc):
    return {m['id']: m for w in doc.get('workstreams', []) for m in w.get('milestones', [])}


def compute(days=7):
    today_real = dt.date.today()
    boundary = (today_real - dt.timedelta(days=days)).isoformat()
    out = {'fenster': {'von': boundary, 'bis': today_real.isoformat(), 'tage': days},
           'erledigt': [], 'fortschritt': [], 'ampel': [], 'protokolle': [], 'entscheide': [],
           'basis': None}

    # ── Stores: Ereignisse im Fenster ──
    tasks = json.loads((DATA / 'tasks.json').read_text()).get('tasks', [])
    tnr = lambda t: 'T-' + str(t.get('nr') or 0).rjust(3, '0')
    for t in tasks:
        am = t.get('erledigt_am')
        if t.get('status') == 'erledigt' and am and am >= boundary:
            out['erledigt'].append({'nr': tnr(t), 'text': t.get('text', ''), 'owner': t.get('owner'),
                                    'am': am, 'von': t.get('erledigt_von'), 'ms_id': t.get('ms_id')})
    protos = json.loads((DATA / 'protokolle.json').read_text()).get('protokolle', [])
    for p in protos:
        if (p.get('datum') or '') >= boundary:
            out['protokolle'].append({'id': p['id'], 'meeting': p.get('meeting_name'), 'datum': p.get('datum'),
                                      'eintraege': len(p.get('eintraege', []))})
    ents = json.loads((DATA / 'entscheide.json').read_text()).get('entscheide', [])
    for e in ents:
        rel = max(filter(None, [e.get('created_at'), e.get('datum'), (e.get('kommunikation') or {}).get('am')]), default=None)
        if rel and rel >= boundary:
            out['entscheide'].append({'id': e['id'], 'titel': e.get('titel'), 'status': e.get('status')})

    # ── git-Vergleich projekt.yaml: Stand vor N Tagen vs. heute ──
    new_doc = yaml.safe_load((DATA / 'projekt.yaml').read_text())
    rev = _git('rev-list', '-1', '--before', boundary + 'T23:59:59', 'HEAD', '--', 'src/data/projekt.yaml')
    if not rev:
        first = _git('rev-list', '--reverse', 'HEAD', '--', 'src/data/projekt.yaml').splitlines()
        rev = first[0] if first else ''
        out['basis'] = 'ältester verfügbarer Stand (Repo jünger als das Fenster)'
    if rev:
        raw = _git('show', f'{rev}:src/data/projekt.yaml')
        if raw:
            old_doc = yaml.safe_load(raw)
            out['basis'] = out['basis'] or f'git {rev[:8]} (Stand ≤ {boundary})'
            old_ms, new_ms = _ms_index(old_doc), _ms_index(new_doc)
            now_old = gr.pdate(old_doc['meta'].get('today'))
            now_new = gr.pdate(new_doc['meta'].get('today'))
            for mid, m_new in new_ms.items():
                m_old = old_ms.get(mid)
                if m_old is None:
                    out['fortschritt'].append({'id': mid, 'name': m_new.get('name'), 'von': None, 'zu': m_new.get('progress'), 'neu': True})
                    continue
                if m_old.get('progress') != m_new.get('progress'):
                    out['fortschritt'].append({'id': mid, 'name': m_new.get('name'),
                                               'von': m_old.get('progress'), 'zu': m_new.get('progress')})
                st_old, st_new = gr.status_of(m_old, now_old), gr.status_of(m_new, now_new)
                if st_old != st_new:
                    out['ampel'].append({'id': mid, 'name': m_new.get('name'), 'von': st_old, 'zu': st_new,
                                         'owner': m_new.get('owner')})
    else:
        out['basis'] = 'kein git-Stand verfügbar — nur Store-Ereignisse'

    out['summe'] = {k: len(out[k]) for k in ('erledigt', 'fortschritt', 'ampel', 'protokolle', 'entscheide')}
    return out


if __name__ == '__main__':
    days = 7
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    print(json.dumps({'ok': True, **compute(days)}, ensure_ascii=False))
