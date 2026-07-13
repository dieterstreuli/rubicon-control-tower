#!/usr/bin/env python3
"""test_status_parity.py — Golden-Master-Paritätstest (Audit #1): erzwingt, dass die
Python-Statuslogik (gen_report.status_of) für dieselben Eingaben EXAKT dasselbe liefert
wie die kanonische JS-Quelle src/lib/status.js. Verhindert Drift der duplizierten Regeln.

Exit != 0 bei jeder Abweichung → als CI-/Pre-Commit-Gate nutzbar.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from gen_report import status_of, pdate  # noqa: E402

NOW = '2026-07-15'

# Grenzfälle inkl. der zuvor divergierenden bool-progress-Falle
FIXTURES = [
    {'id': 'done-late',        'due': '2026-01-01', 'progress': 100},
    {'id': 'done-blocked',     'due': '2026-01-01', 'progress': 100, 'reported_slip_days': 5},
    {'id': 'overdue',          'due': '2026-07-01', 'progress': 0},
    {'id': 'reported-no-due',  'reported_slip_days': 10},
    {'id': 'atrisk-21',        'due': '2026-07-20', 'progress': 0},
    {'id': 'atrisk-45',        'due': '2026-08-20', 'progress': 10},
    {'id': 'ontrack',          'due': '2026-12-01', 'progress': 60},
    {'id': 'unknown-no-prog',  'due': '2026-12-01'},
    {'id': 'unknown-no-due',   'progress': 50},
    {'id': 'boundary-due-day', 'due': '2026-07-15', 'progress': 0},
    {'id': 'bool-progress',    'due': '2026-12-01', 'progress': True},
    {'id': 'done-exact',       'due': '2026-12-01', 'progress': 100},
    # start-bewusste atRisk-Regel (13.07.): vor geplantem Start kein Risikosignal
    {'id': 'prestart-ontrack', 'due': '2026-08-19', 'progress': 0, 'start': '2026-08-14'},  # NOW < start → onTrack
    {'id': 'poststart-atrisk', 'due': '2026-08-19', 'progress': 0, 'start': '2026-07-01'},  # Start vorbei, ≤45d, <15% → atRisk
    {'id': 'start-boundary',   'due': '2026-08-19', 'progress': 0, 'start': '2026-07-15'},  # start == NOW → Regel greift NICHT mehr
    {'id': 'prestart-overdue', 'due': '2026-07-01', 'progress': 0, 'start': '2026-08-01'},  # überfällig schlägt start (delayed)
]


def main():
    now = pdate(NOW)
    py = [status_of(m, now) for m in FIXTURES]

    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(FIXTURES, f)
        fix = f.name
    r = subprocess.run(['node', 'scripts/_parity_node.mjs', fix, NOW],
                       capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode != 0:
        print('FEHLER node:', r.stderr.strip()[-300:]); sys.exit(2)
    js = json.loads(r.stdout)

    mismatch = 0
    print('── Status-Parität JS (status.js) ↔ Python (gen_report.py) ──')
    for m, p, j in zip(FIXTURES, py, js):
        ok = (p == j)
        if not ok:
            mismatch += 1
        print(f"  {'OK ' if ok else 'DIFF'}  {m['id']:<18} python={p:<9} js={j}")
    print(f"  {len(FIXTURES) - mismatch}/{len(FIXTURES)} identisch")
    sys.exit(1 if mismatch else 0)


if __name__ == '__main__':
    main()
