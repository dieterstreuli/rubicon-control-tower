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
HISTORY = DATA / 'history'   # serverseitige projekt.yaml-Snapshots (Volume-Prefix history/)
sys.path.insert(0, str(ROOT / 'scripts'))
import gen_report as gr  # noqa: E402 — status_of/pdate 1:1 wiederverwenden (Paritäts-Disziplin)

import yaml  # noqa: E402


def _git(*args):
    """git-CLI im Repo. Faengt FileNotFoundError (git nicht installiert — z.B. im schlanken
    Server-Image) UND non-zero returncode ab -> ''. Ohne dieses Abfangen riss ein fehlendes
    git-Binary den /api/delta-Endpoint per uncaught FileNotFoundError auf HTTP 500; jetzt faellt
    der Aufrufer sauber auf Snapshots bzw. reine Store-Ereignisse zurueck."""
    try:
        r = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True)
    except (FileNotFoundError, OSError):
        return ''
    return r.stdout.strip() if r.returncode == 0 else ''


def _ms_index(doc):
    """Milestone-Index {id: milestone}. Formtolerant: nicht-dict Workstreams/Milestones und
    Eintraege ohne id werden uebersprungen — ein formwidriger (alter ODER live-)Stand darf
    compute() nie mit AttributeError/TypeError auf HTTP 500 reissen."""
    idx = {}
    for w in (doc.get('workstreams') or []):
        if not isinstance(w, dict):
            continue
        for m in (w.get('milestones') or []):
            if isinstance(m, dict) and 'id' in m:
                idx[m['id']] = m
    return idx


def _snapshots():
    """Datierte projekt.yaml-Snapshots (projekt-<YYYYMMDDThhmmssZ>.yaml) als nach ts aufsteigend
    sortierte Liste (ts, Path). Serverseitige Historie unter history/ (aus git backfilled + je
    Publish von der Merge-Bruecke fortgeschrieben). glob auf ein fehlendes Verzeichnis liefert leer
    (kein is_dir-Gate — robust, egal ob der gcsfuse-Prefix als implicit dir sichtbar ist)."""
    snaps = [(p.stem[len('projekt-'):], p) for p in HISTORY.glob('projekt-*.yaml')]   # 'YYYYMMDDThhmmssZ'
    snaps.sort()
    return snaps


def _valid_projekt(doc):
    """projekt.yaml-Grundform: dict mit dict-`meta` UND Listen-`workstreams`. Ein formwidriger
    (aber parsebarer) Snapshot/rev — Top-Level-String/-Liste, fehlendes/kaputtes `meta` oder
    `workstreams` (z.B. ein String) — wuerde sonst in compute()/_ms_index auf AttributeError/
    TypeError laufen = HTTP 500 (der Fehler, den dieses Feature beseitigt). Solche werden
    uebersprungen und ein aelterer Stand probiert. (_ms_index toleriert zusaetzlich einzelne
    formwidrige Eintraege INNERHALB einer sonst gueltigen workstreams-Liste.)"""
    return (isinstance(doc, dict) and isinstance(doc.get('meta'), dict)
            and isinstance(doc.get('workstreams'), list))


def _snapshot_old(boundary):
    """(old_doc, basis) aus den datierten Snapshots: juengster <= Fenstergrenze; ein defekter/
    formwidriger Snapshot wird UEBERSPRUNGEN und der naechst-aeltere probiert (nie hart 500en).
    Fenster aelter als alle Snapshots -> aeltester gueltiger. Kein gueltiger -> (None, None)."""
    snaps = _snapshots()
    if not snaps:
        return None, None
    cutoff = boundary.replace('-', '') + 'T235959Z'         # lexvergleichbar zu ts (Tagesende)
    candidates = [(ts, p) for ts, p in snaps if ts <= cutoff]
    if candidates:
        trial, older = list(reversed(candidates)), False    # juengster <= cutoff zuerst
    else:
        trial, older = list(snaps), True                    # alle juenger -> aeltester zuerst
    for ts, p in trial:
        try:
            doc = yaml.safe_load(p.read_text())
        except Exception:                                   # noqa: BLE001 — defekter Snapshot -> naechster
            continue
        if _valid_projekt(doc):
            return doc, (f'ältester Snapshot {ts} (Historie jünger als das Fenster)' if older
                         else f'Snapshot {ts} (Stand ≤ {boundary})')
    return None, None


def _old_projekt(boundary):
    """(old_doc, basis) fuer den Wochen-Delta: der projekt.yaml-Stand <= boundary. Dual-Mode OHNE
    Flag: **git hat Vorrang, wo verfuegbar** (lokal) — serverseitig fehlt git (schlankes Image),
    dann greifen die datierten Snapshots. So kann eine lokal versehentlich angelegte history/ die
    reiche git-Historie NICHT verdraengen. Ohne nutzbare Quelle -> (None, Hinweis) = nur Store-Ereignisse."""
    rev = _git('rev-list', '-1', '--before', boundary + 'T23:59:59', 'HEAD', '--', 'src/data/projekt.yaml')
    git_basis = None
    if not rev:
        first = _git('rev-list', '--reverse', 'HEAD', '--', 'src/data/projekt.yaml').splitlines()
        if first:
            rev, git_basis = first[0], 'ältester verfügbarer Stand (Repo jünger als das Fenster)'
    if rev:
        try:
            doc = yaml.safe_load(_git('show', f'{rev}:src/data/projekt.yaml'))
        except Exception:                                   # noqa: BLE001
            doc = None
        if _valid_projekt(doc):
            return doc, (git_basis or f'git {rev[:8]} (Stand ≤ {boundary})')
    # kein (nutzbares) git -> serverseitige Snapshots
    doc, basis = _snapshot_old(boundary)
    if doc is not None:
        return doc, basis
    return None, 'kein projekt.yaml-Stand verfügbar — nur Store-Ereignisse'


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

    # ── projekt.yaml-Vergleich: Stand ≤ boundary vs. heute ──
    # Dual-Mode ohne Flag: serverseitig aus datierten Snapshots (history/, aus git backfilled +
    # je Publish fortgeschrieben), lokal aus der git-Historie. Quellenwahl: _old_projekt.
    new_doc = yaml.safe_load((DATA / 'projekt.yaml').read_text())
    old_doc, out['basis'] = _old_projekt(boundary)
    if old_doc is not None:
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

    out['summe'] = {k: len(out[k]) for k in ('erledigt', 'fortschritt', 'ampel', 'protokolle', 'entscheide')}
    return out


if __name__ == '__main__':
    days = 7
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    print(json.dumps({'ok': True, **compute(days)}, ensure_ascii=False))
