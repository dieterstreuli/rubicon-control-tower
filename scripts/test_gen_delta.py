import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yaml  # noqa: E402
import gen_delta as gd  # noqa: E402


# ── Fixture-Helfer ───────────────────────────────────────────────────────────
def _tmp():
    return tempfile.mkdtemp(prefix='delta_')


def _projekt(milestones, today):
    return {'meta': {'projekt': 'X', 'today': today},
            'workstreams': [{'code': 'WS1', 'name': 'WS1', 'milestones': milestones}]}


def _dump(doc):
    return yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)


def _snap(hist, ts, doc, raw=None):
    os.makedirs(hist, exist_ok=True)
    Path(hist, f'projekt-{ts}.yaml').write_text(raw if raw is not None else _dump(doc), encoding='utf-8')


def _point_gd(data):
    """gen_delta-Modulglobale auf ein Temp-DATA umbiegen (compute/_snapshots lesen sie zur Laufzeit)."""
    gd.DATA = Path(data)
    gd.HISTORY = Path(data) / 'history'


def _fake_git(rev='', reverse='', show=''):
    """_git-Stub: unterscheidet rev-list / rev-list --reverse / show an den Args."""
    def g(*args):
        if args and args[0] == 'rev-list' and '--reverse' in args:
            return reverse
        if args and args[0] == 'rev-list':
            return rev
        if args and args[0] == 'show':
            return show
        return ''
    return g


# ── 1. _git faengt fehlendes Binary ab (der eigentliche 500-Fix) ─────────────
def test_git_hardening_no_binary():
    orig = gd.subprocess.run
    gd.subprocess.run = lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError('git'))
    try:
        assert gd._git('rev-list', 'HEAD') == ''      # kein uncaught FileNotFoundError
    finally:
        gd.subprocess.run = orig


# ── 2. _git faengt non-zero returncode ab ────────────────────────────────────
def test_git_nonzero_returncode():
    class R:  # minimaler CompletedProcess-Stand-in
        returncode = 1
        stdout = 'irrelevant'
    orig = gd.subprocess.run
    gd.subprocess.run = lambda *a, **k: R()
    try:
        assert gd._git('show', 'x') == ''
    finally:
        gd.subprocess.run = orig


# ── 3. Snapshots aufsteigend sortiert ────────────────────────────────────────
def test_snapshots_sorted():
    data = _tmp()
    try:
        _point_gd(data)
        hist = os.path.join(data, 'history')
        for ts in ('20260807T120000Z', '20260801T090000Z', '20260805T150000Z'):
            _snap(hist, ts, _projekt([{'id': 'M1', 'progress': 0}], '2026-08-01'))
        assert [ts for ts, _ in gd._snapshots()] == \
            ['20260801T090000Z', '20260805T150000Z', '20260807T120000Z']
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 4. git hat Vorrang: normaler Boundary-Treffer (lokaler Pfad) ─────────────
def test_old_projekt_git_boundary_hit():
    data = _tmp()
    try:
        _point_gd(data)                                 # keine history/ noetig — git gewinnt
        orig = gd._git
        gd._git = _fake_git(rev='abcdef1234',
                            show=_dump(_projekt([{'id': 'M1', 'progress': 42}], '2026-08-01')))
        try:
            old, basis = gd._old_projekt('2026-08-05')
            assert old['workstreams'][0]['milestones'][0]['progress'] == 42
            assert basis == 'git abcdef12 (Stand ≤ 2026-08-05)'
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 5. git-Oldest-Fallback: kein rev <= boundary -> aeltester git-Stand ──────
def test_old_projekt_git_oldest_fallback():
    data = _tmp()
    try:
        _point_gd(data)
        orig = gd._git
        gd._git = _fake_git(rev='',                     # rev-list --before: nichts
                            reverse='old1234abcd\nnewer99',   # rev-list --reverse: aeltester zuerst
                            show=_dump(_projekt([{'id': 'M1', 'progress': 5}], '2026-07-01')))
        try:
            old, basis = gd._old_projekt('2026-08-05')
            assert old['workstreams'][0]['milestones'][0]['progress'] == 5
            assert basis == 'ältester verfügbarer Stand (Repo jünger als das Fenster)'
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 6. Server (git-los): juengster Snapshot <= boundary ──────────────────────
def test_old_projekt_snapshot_picks_boundary():
    data = _tmp()
    try:
        _point_gd(data)
        hist = os.path.join(data, 'history')
        _snap(hist, '20260801T090000Z', _projekt([{'id': 'M1', 'progress': 10}], '2026-08-01'))
        _snap(hist, '20260805T150000Z', _projekt([{'id': 'M1', 'progress': 30}], '2026-08-05'))
        _snap(hist, '20260807T120000Z', _projekt([{'id': 'M1', 'progress': 80}], '2026-08-07'))
        orig = gd._git
        gd._git = _fake_git()                           # git-los -> Snapshots
        try:
            old, basis = gd._old_projekt('2026-08-05')
            assert old['workstreams'][0]['milestones'][0]['progress'] == 30
            assert basis.startswith('Snapshot 20260805T150000Z')
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 7. Server: Fenster aelter als alle Snapshots -> aeltester ────────────────
def test_old_projekt_snapshot_oldest_when_window_older():
    data = _tmp()
    try:
        _point_gd(data)
        hist = os.path.join(data, 'history')
        _snap(hist, '20260805T150000Z', _projekt([{'id': 'M1', 'progress': 30}], '2026-08-05'))
        _snap(hist, '20260807T120000Z', _projekt([{'id': 'M1', 'progress': 80}], '2026-08-07'))
        orig = gd._git
        gd._git = _fake_git()
        try:
            old, basis = gd._old_projekt('2026-08-01')  # alle Snapshots juenger
            assert old['workstreams'][0]['milestones'][0]['progress'] == 30   # aeltester
            assert 'ältester Snapshot' in basis
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 8. Formwidriger neuester Snapshot -> naechst-aelteren nehmen (kein 500) ──
def test_snapshot_skips_invalid():
    data = _tmp()
    try:
        _point_gd(data)
        hist = os.path.join(data, 'history')
        _snap(hist, '20260801T090000Z', _projekt([{'id': 'M1', 'progress': 30}], '2026-08-01'))
        _snap(hist, '20260805T150000Z', None, raw='hallo')            # parsebar -> str, KEIN dict
        _snap(hist, '20260807T120000Z', None, raw='- a\n- b\n')       # parsebar -> list, KEIN meta
        _snap(hist, '20260808T120000Z', {'meta': {'today': 'x'}, 'workstreams': 'oops'})  # meta ok, workstreams KEINE Liste
        orig = gd._git
        gd._git = _fake_git()
        try:
            old, basis = gd._old_projekt('2026-08-09')
            assert old['workstreams'][0]['milestones'][0]['progress'] == 30   # gueltiger Aelterer
            assert basis.startswith('Snapshot 20260801T090000Z')
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 9. Nur formwidrige Snapshots + kein git -> (None, Store-only), kein Crash ─
def test_all_snapshots_invalid_storeonly():
    data = _tmp()
    try:
        _point_gd(data)
        _snap(os.path.join(data, 'history'), '20260805T150000Z', None, raw='hallo')
        orig = gd._git
        gd._git = _fake_git()
        try:
            old, basis = gd._old_projekt('2026-08-09')
            assert old is None
            assert basis == 'kein projekt.yaml-Stand verfügbar — nur Store-Ereignisse'
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 10. Weder git noch Snapshots -> (None, Store-only) ───────────────────────
def test_old_projekt_none_when_nothing():
    data = _tmp()
    try:
        _point_gd(data)                                 # keine history/
        orig = gd._git
        gd._git = _fake_git()                           # git liefert nichts
        try:
            old, basis = gd._old_projekt('2026-08-01')
            assert old is None
            assert basis == 'kein projekt.yaml-Stand verfügbar — nur Store-Ereignisse'
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


def _write_stores(data):
    for name, obj in (('tasks.json', {'tasks': []}),
                      ('protokolle.json', {'protokolle': []}),
                      ('entscheide.json', {'entscheide': []})):
        Path(data, name).write_text(json.dumps(obj), encoding='utf-8')


# ── 11. compute() end-to-end (git-los, Snapshot-Diff): Fortschritt 30 -> 80 ──
def test_compute_snapshot_diff_end_to_end():
    data = _tmp()
    try:
        _point_gd(data)
        _write_stores(data)
        new = _projekt([{'id': 'M1', 'name': 'Meilenstein 1', 'progress': 80, 'owner': 'A'}], '2026-08-07')
        Path(data, 'projekt.yaml').write_text(_dump(new), encoding='utf-8')
        old = _projekt([{'id': 'M1', 'name': 'Meilenstein 1', 'progress': 30, 'owner': 'A'}], '2026-08-01')
        _snap(os.path.join(data, 'history'), '20200101T090000Z', old)   # weit vor jeder boundary
        orig = gd._git
        gd._git = _fake_git()                           # Server-Simulation (git-los)
        try:
            out = gd.compute(days=1)
            assert out['basis'].startswith('Snapshot 20200101T090000Z')
            f = [x for x in out['fortschritt'] if x['id'] == 'M1']
            assert f and f[0]['von'] == 30 and f[0]['zu'] == 80
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 12. compute() git-los + keine Historie -> Store-only, KEIN 500 ───────────
#      (deckt den geteilten Pfad gen_report.compute -> gen_delta.compute mit ab)
def test_compute_gitless_no_history_storeonly():
    data = _tmp()
    try:
        _point_gd(data)
        _write_stores(data)
        Path(data, 'projekt.yaml').write_text(
            _dump(_projekt([{'id': 'M1', 'name': 'a', 'progress': 50, 'owner': 'A'}], '2026-08-07')),
            encoding='utf-8')
        orig = gd._git
        gd._git = _fake_git()                           # git-los, keine history/
        try:
            out = gd.compute(days=7)                    # darf NICHT werfen
            assert out['basis'] == 'kein projekt.yaml-Stand verfügbar — nur Store-Ereignisse'
            assert out['fortschritt'] == [] and out['ampel'] == []
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


# ── 13. compute() mit formwidrigem workstreams im einzigen Snapshot -> KEIN 500 ──
#      (Repro des Re-Review-Findings: meta ok, aber workstreams='oops' -> _ms_index-Crash)
def test_compute_malformed_workstreams_no_500():
    data = _tmp()
    try:
        _point_gd(data)
        _write_stores(data)
        Path(data, 'projekt.yaml').write_text(
            _dump(_projekt([{'id': 'M1', 'name': 'a', 'progress': 50, 'owner': 'A'}], '2026-08-07')),
            encoding='utf-8')
        _snap(os.path.join(data, 'history'), '20200101T090000Z',
              {'meta': {'today': '2026-08-01'}, 'workstreams': 'oops-not-a-list'})
        orig = gd._git
        gd._git = _fake_git()                           # git-los -> Snapshot-Pfad
        try:
            out = gd.compute(days=1)                    # darf NICHT werfen
            # einziger Snapshot ist formwidrig -> uebersprungen -> Store-only, kein Crash
            assert out['basis'] == 'kein projekt.yaml-Stand verfügbar — nur Store-Ereignisse'
            assert out['fortschritt'] == [] and out['ampel'] == []
        finally:
            gd._git = orig
    finally:
        shutil.rmtree(data, ignore_errors=True)


TESTS = [
    test_git_hardening_no_binary,
    test_git_nonzero_returncode,
    test_snapshots_sorted,
    test_old_projekt_git_boundary_hit,
    test_old_projekt_git_oldest_fallback,
    test_old_projekt_snapshot_picks_boundary,
    test_old_projekt_snapshot_oldest_when_window_older,
    test_snapshot_skips_invalid,
    test_all_snapshots_invalid_storeonly,
    test_old_projekt_none_when_nothing,
    test_compute_snapshot_diff_end_to_end,
    test_compute_gitless_no_history_storeonly,
    test_compute_malformed_workstreams_no_500,
]


if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f"gen_delta: {len(TESTS)}/{len(TESTS)} gruen")
