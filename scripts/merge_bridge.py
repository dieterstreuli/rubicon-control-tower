#!/usr/bin/env python3
"""merge_bridge.py — zieht Struktur-Änderungen aus dem Repo (SEED) live nach, ohne die
Live-Daten im Volume (SSOT) zu zerstören.

Zwei Quellen:
  SEED  (Repo-Struktur)  = os.environ['RUBICON_REPO_SEED']  (Default '/app/_repo_seed')
  DATA  (Live-/Volume)   = os.environ['RUBICON_DATA_DIR']    (Default <script>/../src/data)

Drei Datei-Klassen (s. Konstanten): Stammdaten (Repo überschreibt Volume), Transaktion
(Volume unberührt) und Misch (Merge-by-Key: projekt.yaml + tasks.json). Ohne --apply reiner
Dry-Run — es wird NICHTS geschrieben, nur berechnet und als eine JSON-Zeile auf stdout
berichtet. Kein Backup, keine Validierung (macht der Workflow drumherum); dieses Script
mergt nur und meldet. Reine Datei-Logik, keine Google-API-Calls.
"""
import copy
import json
import logging
import os
import sys
import tempfile
from pathlib import Path

import yaml

log = logging.getLogger("rubicon.merge")


# ── Datei-Klassifikation ─────────────────────────────────────────────────────
# STAMMDATEN: aus dem Repo gepflegte Struktur/Definitionen — SEED überschreibt Volume.
STAMMDATEN = ['domain.json', 'schema.json', 'briefings.json', 'fuehrungsrhythmus.json',
              'traktanden.json', 'kontakte.json', 'gemini_meetings.json']
# TRANSAKTION: job-/app-geschriebene Live-Daten — Volume bleibt unberührt. reports_index.json,
# traktanden_docs.json, briefings_docs.json und fuehrungsrhythmus_doc.json stehen hier, WEIL sie
# job-geschriebene server_doc_id/server_pdf_id tragen; ein Repo-Überschreiben würde diese wipen.
# protokolle_sensitiv.json ist volume-only.
TRANSAKTION = ['protokolle.json', 'protokolle_sensitiv.json', 'entscheide.json', 'reminder_log.json',
               'report_comments.json', 'zielbild.json', 'reports_index.json', 'traktanden_docs.json',
               'briefings_docs.json', 'fuehrungsrhythmus_doc.json']
# MISCH: Struktur (SEED) + Live-Pflege (Volume) müssen zusammengeführt werden (Merge-by-Key).
MISCH = ['projekt.yaml', 'tasks.json']

# projekt.yaml — Milestone-Felder, die (falls im Volume gepflegt und abweichend) das
# manuell/laufend gepflegte Tracking tragen und aus dem Volume erhalten werden.
MS_PRESERVE_FIELDS = ('progress', 'reported_slip_days', 'due', 'owner', 'progress_source', 'start')
# projekt.yaml — Input-Felder aus dem Volume (gepflegter Lieferstatus + Task-Kopplung).
INPUT_PRESERVE_FIELDS = ('status', 'liefer_tasks')
# tasks.json — Struktur-Felder aus dem SEED (Stammdaten der Handlung).
TASK_SEED_FIELDS = ('text', 'owner', 'due', 'ms_id', 'source', 'origin')
# tasks.json — Live-/Lifecycle-Felder aus dem Volume (durch die App gesetzt).
TASK_VOLUME_FIELDS = ('nr', 'status', 'erledigt_am', 'erledigt_von', 'created_at')


# ── Misch-Merge: projekt.yaml ────────────────────────────────────────────────
def merge_projekt(seed, volume):
    """Basis = SEED-Struktur; gepflegte Live-Felder aus dem Volume je id erhalten.
    Gibt (ergebnis_dict, conflicts_liste) zurück. Lösch-Politik = behalten + melden:
    ein Milestone/Input, den der SEED entfernt hat, der im Volume aber Live-Daten trägt,
    wird zurück ins Ergebnis übernommen und als Konflikt gemeldet (kein stiller Verlust).
    """
    conflicts = []
    result = copy.deepcopy(seed)

    # 1. meta: aus SEED, aber manuell gepflegtes Steuerungsdatum + Datenlieferungs-URL
    #    aus dem Volume erhalten, falls dort gesetzt.
    vmeta = volume.get('meta') or {}
    if vmeta.get('today') or vmeta.get('datenlieferungen_url'):
        result.setdefault('meta', {})
    for f in ('today', 'datenlieferungen_url'):
        if vmeta.get(f):
            result['meta'][f] = vmeta[f]

    # Volume-Indizes (Milestone → sein Workstream-Code merken, für die Rück-Einsortierung)
    vol_ms = {}
    for w in volume.get('workstreams') or []:
        for m in w.get('milestones') or []:
            if m.get('id'):
                vol_ms[m['id']] = (w.get('code'), m)
    vol_in = {i['id']: i for i in (volume.get('inputs') or []) if i.get('id')}

    # 2. Milestones (flach über alle Workstreams): Live-Felder aus dem Volume überschreiben,
    #    nur wenn im Volume gesetzt (is not None) UND vom SEED-Wert abweichend.
    seed_ms_ids = set()
    for w in result.get('workstreams') or []:
        for m in w.get('milestones') or []:
            mid = m.get('id')
            if not mid:
                continue
            seed_ms_ids.add(mid)
            entry = vol_ms.get(mid)
            if not entry:
                continue
            vm = entry[1]
            for f in MS_PRESERVE_FIELDS:
                if vm.get(f) is not None and vm.get(f) != m.get(f):
                    m[f] = vm[f]

    # 3. Inputs: gepflegter Lieferstatus + Task-Kopplung aus dem Volume erhalten.
    seed_in_ids = set()
    for inp in result.get('inputs') or []:
        iid = inp.get('id')
        if not iid:
            continue
        seed_in_ids.add(iid)
        vi = vol_in.get(iid)
        if not vi:
            continue
        for f in INPUT_PRESERVE_FIELDS:
            if vi.get(f) is not None:
                inp[f] = vi[f]

    # 4. Lösch-Konflikte: im Volume vorhanden, im SEED entfernt, hat aber Live-Daten →
    #    Volume-Eintrag behalten + melden. Milestone wird in seinen früheren Workstream
    #    zurücksortiert; fehlt dieser im SEED, kommt er in einen __orphans__-Workstream
    #    am ENDE (bewusste Wahl: hängt sichtbar hinten an, verfälscht keine Kern-Reihenfolge).
    ws_by_code = {w.get('code'): w for w in (result.get('workstreams') or []) if w.get('code')}
    orphan_ws = None
    for mid, (ws_code, vm) in vol_ms.items():
        if mid in seed_ms_ids:
            continue
        has_live = bool(vm.get('progress')) or vm.get('reported_slip_days') is not None
        if not has_live:
            continue  # Struktur bewusst entfernt, keine Live-Daten → nicht zurückholen
        conflicts.append({'file': 'projekt.yaml', 'kind': 'milestone', 'id': mid,
                          'reason': 'structure_removed_has_live_data'})
        target = ws_by_code.get(ws_code)
        if target is None:
            if orphan_ws is None:
                orphan_ws = {'code': '__orphans__',
                             'name': 'Verwaiste Milestones (Struktur entfernt, Live-Daten erhalten)',
                             'milestones': []}
                result.setdefault('workstreams', []).append(orphan_ws)
            target = orphan_ws
        target.setdefault('milestones', []).append(vm)

    for iid, vi in vol_in.items():
        if iid in seed_in_ids:
            continue
        if not vi.get('status'):
            continue  # kein Lieferstatus → keine Live-Daten
        conflicts.append({'file': 'projekt.yaml', 'kind': 'input', 'id': iid,
                          'reason': 'structure_removed_has_live_data'})
        result.setdefault('inputs', []).append(vi)

    return result, conflicts


# ── Misch-Merge: tasks.json ──────────────────────────────────────────────────
def merge_tasks(seed, volume):
    """Union by id. Struktur-Felder (text/owner/due/ms_id/source/origin) aus dem SEED,
    Live-/Lifecycle-Felder (nr/status/erledigt_am/erledigt_von/created_at) aus dem Volume.
    Volume-only Tasks (in der App erfasst) bleiben erhalten — Union ist korrekt, KEIN
    Konflikt. Reihenfolge stabil: erst SEED-Reihenfolge, dann Volume-only in Volume-Reihenfolge.
    """
    seed_tasks = seed.get('tasks') or []
    vol_tasks = volume.get('tasks') or []
    vol_by_id = {t['id']: t for t in vol_tasks if t.get('id')}

    out = []
    seed_ids = set()
    for st in seed_tasks:
        tid = st.get('id')
        if not tid:
            continue
        seed_ids.add(tid)
        merged = dict(st)  # Struktur-Basis aus dem SEED
        vt = vol_by_id.get(tid)
        if vt:
            # Live-Felder aus dem Volume erhalten (auch explizite null-Werte, z.B. erledigt_am
            # bei offenen Tasks) — nur wenn das Feld im Volume-Eintrag tatsächlich vorkommt.
            for f in TASK_VOLUME_FIELDS:
                if f in vt:
                    merged[f] = vt[f]
            # App-seitig gesetzte Live-Zusatzfelder (z.B. artefakt), die die Repo-Struktur
            # (noch) nicht kennt — mit erhalten, sonst stiller Datenverlust.
            for k, v in vt.items():
                if k not in merged:
                    merged[k] = v
        out.append(merged)

    volume_only = 0
    for vt in vol_tasks:
        tid = vt.get('id')
        if not tid or tid in seed_ids:
            continue
        out.append(dict(vt))  # live-erfasste Handlung — legitim volume-only
        volume_only += 1

    result = dict(seed)
    result['tasks'] = out
    stats = {'seed': len(seed_ids), 'volume_only': volume_only, 'total': len(out)}
    return result, stats


# ── Datei-Helfer ─────────────────────────────────────────────────────────────
def _read_text(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _write_atomic(path, text):
    """Atomar schreiben: Temp-Datei im ZIELVERZEICHNIS, dann os.replace — nie eine
    halb geschriebene Datei im DATA-Verzeichnis."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.merge_', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _copy_atomic(src, dst):
    """Roher Byte-Kopie SEED → DATA (Inhalt 1:1), atomar via Temp + os.replace."""
    with open(src, 'rb') as f:
        blob = f.read()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix='.merge_', suffix='.tmp')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(blob)
        os.replace(tmp, dst)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ── Orchestrierung ───────────────────────────────────────────────────────────
def _plan_projekt(seed_dir, data_dir, report):
    """Berechnet den projekt.yaml-Merge OHNE zu schreiben. Fuellt report um conflicts +
    misch-Statistik; gibt (data_path, merged_dict) zurueck oder None (SEED fehlt)."""
    seed_path = os.path.join(seed_dir, 'projekt.yaml')
    data_path = os.path.join(data_dir, 'projekt.yaml')
    if not os.path.exists(seed_path):
        # Ohne SEED-Struktur kann nicht gemergt werden — Volume bleibt unberührt (resilient).
        log.warning('projekt.yaml fehlt im SEED — Merge übersprungen, Volume unberührt')
        report['misch']['projekt.yaml'] = {'skipped': 'seed_missing'}
        return None
    seed_doc = yaml.safe_load(_read_text(seed_path)) or {}
    vol_doc = (yaml.safe_load(_read_text(data_path)) or {}) if os.path.exists(data_path) else {}
    merged, conflicts = merge_projekt(seed_doc, vol_doc)
    report['conflicts'].extend(conflicts)
    report['misch']['projekt.yaml'] = {
        'workstreams': len(merged.get('workstreams') or []),
        'milestones': sum(len(w.get('milestones') or []) for w in (merged.get('workstreams') or [])),
        'inputs': len(merged.get('inputs') or []),
        'conflicts': len(conflicts),
    }
    return (data_path, merged)


def _plan_tasks(seed_dir, data_dir, report):
    """Berechnet den tasks.json-Merge OHNE zu schreiben; gibt (data_path, merged) oder None."""
    seed_path = os.path.join(seed_dir, 'tasks.json')
    data_path = os.path.join(data_dir, 'tasks.json')
    if not os.path.exists(seed_path):
        log.warning('tasks.json fehlt im SEED — Merge übersprungen, Volume unberührt')
        report['misch']['tasks.json'] = {'skipped': 'seed_missing'}
        return None
    seed_doc = json.loads(_read_text(seed_path))
    vol_doc = json.loads(_read_text(data_path)) if os.path.exists(data_path) else {'tasks': []}
    merged, stats = merge_tasks(seed_doc, vol_doc)
    report['misch']['tasks.json'] = stats
    return (data_path, merged)


def run(seed_dir, data_dir, mode):
    """mode: 'dry-run' | 'auto' | 'apply'. Berechnet den kompletten Merge, ermittelt die
    Konfliktzahl und entscheidet DANN, ob geschrieben wird:
      apply   = immer schreiben (bewusster manueller Apply),
      auto    = nur schreiben, wenn 0 Konflikte (sonst halten + melden),
      dry-run = nie schreiben (reine Vorschau).
    Schreiben ist atomar (Stammdaten-Copy + Misch-Write). Gibt den Report-Dict zurueck."""
    seed_dir, data_dir = str(seed_dir), str(data_dir)
    os.makedirs(data_dir, exist_ok=True)
    report = {'mode': mode, 'applied': False, 'stammdaten': [], 'transaktion': [],
              'misch': {}, 'conflicts': []}

    # 1. Stammdaten-Plan: welche SEED-Dateien wuerden das Volume ueberschreiben.
    stamm = [n for n in STAMMDATEN if os.path.exists(os.path.join(seed_dir, n))]
    for n in STAMMDATEN:
        if n not in stamm:
            log.info('Stammdaten übersprungen (nicht im SEED): %s', n)
    report['stammdaten'] = stamm

    # 2. Transaktion — nie anfassen, nur die im Volume vorhandenen melden.
    report['transaktion'] = [n for n in TRANSAKTION if os.path.exists(os.path.join(data_dir, n))]

    # 3. Misch berechnen (noch NICHT schreiben) — liefert die Konflikte.
    projekt_plan = _plan_projekt(seed_dir, data_dir, report)
    tasks_plan = _plan_tasks(seed_dir, data_dir, report)

    # 4. Schreib-Entscheidung nach Modus + Konfliktzahl.
    n_conflicts = len(report['conflicts'])
    write = (mode == 'apply') or (mode == 'auto' and n_conflicts == 0)
    report['applied'] = write
    log.info('Stammdaten: %d · Transaktion: %d unberührt · Konflikte: %d · schreibt: %s',
             len(stamm), len(report['transaktion']), n_conflicts, write)
    if mode == 'auto' and n_conflicts:
        log.warning('AUTO: %d Konflikt(e) → NICHT angewandt; manueller Apply nach Prüfung nötig', n_conflicts)

    # 5. Schreiben (falls entschieden) — atomar, Stammdaten + Misch.
    if write:
        for n in stamm:
            _copy_atomic(os.path.join(seed_dir, n), os.path.join(data_dir, n))
        if projekt_plan is not None:
            _write_atomic(projekt_plan[0], yaml.safe_dump(projekt_plan[1], allow_unicode=True,
                                                          sort_keys=False, default_flow_style=False))
        if tasks_plan is not None:
            _write_atomic(tasks_plan[0], json.dumps(tasks_plan[1], ensure_ascii=False, indent=2))

    return report


def _seed_dir():
    return os.environ.get('RUBICON_REPO_SEED', '/app/_repo_seed')


def _data_dir():
    return os.environ.get('RUBICON_DATA_DIR') or str(Path(__file__).resolve().parent.parent / 'src' / 'data')


def main(argv=None):
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format='%(message)s')
    args = list(sys.argv[1:] if argv is None else argv)
    mode = 'apply' if '--apply' in args else ('auto' if '--auto' in args else 'dry-run')
    seed_dir = _seed_dir()
    data_dir = _data_dir()
    if not os.path.isdir(seed_dir):
        # Fehlendes SEED-Verzeichnis = Fehlkonfiguration, kein informativer Konflikt → Exit 1.
        log.error('SEED-Verzeichnis fehlt: %s', seed_dir)
        return 1
    log.info('Merge-Brücke (%s) — SEED=%s DATA=%s', mode, seed_dir, data_dir)
    try:
        report = run(seed_dir, data_dir, mode)
    except Exception as ex:  # noqa: BLE001 — Parse-/IO-Fehler sind echte Fehler → Exit 1
        log.error('Merge-Fehler: %s', ex)
        return 1
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
