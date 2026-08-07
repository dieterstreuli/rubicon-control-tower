import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_bridge as mb  # noqa: E402


# ── Fixture-Helfer ───────────────────────────────────────────────────────────
def _mkdirs():
    seed = tempfile.mkdtemp(prefix='seed_')
    data = tempfile.mkdtemp(prefix='data_')
    return seed, data


def _cleanup(*paths):
    for p in paths:
        shutil.rmtree(p, ignore_errors=True)


def _write(path, name, obj, raw=None):
    with open(os.path.join(path, name), 'w', encoding='utf-8') as f:
        f.write(raw if raw is not None else json.dumps(obj, ensure_ascii=False, indent=2))


def _read(path, name):
    with open(os.path.join(path, name), 'r', encoding='utf-8') as f:
        return f.read()


def _projekt(milestones, inputs=None, meta=None, ws_code='WS1'):
    return {
        'meta': meta or {'projekt': 'X', 'today': '2026-01-01'},
        'workstreams': [{'code': ws_code, 'name': 'WS1', 'milestones': milestones}],
        'inputs': inputs or [],
    }


# ── 1. Stammdaten: SEED überschreibt Volume ──────────────────────────────────
def test_stammdaten_overwrite():
    seed, data = _mkdirs()
    try:
        _write(seed, 'domain.json', {'phasen': ['neu'], 'v': 2})
        _write(data, 'domain.json', {'phasen': ['alt'], 'v': 1})
        mb.run(seed, data, 'apply')
        assert json.loads(_read(data, 'domain.json')) == {'phasen': ['neu'], 'v': 2}
    finally:
        _cleanup(seed, data)


# ── 2. Transaktion: Volume unberührt (server_doc_id überlebt) ────────────────
def test_transaktion_untouched():
    seed, data = _mkdirs()
    try:
        _write(data, 'reports_index.json', {'reports': [{'id': 'r1', 'server_doc_id': 'SRV-1'}]})
        # SEED trägt bewusst anderen Inhalt — darf NICHT durchschlagen.
        _write(seed, 'reports_index.json', {'reports': []})
        before = _read(data, 'reports_index.json')
        report = mb.run(seed, data, 'apply')
        after = _read(data, 'reports_index.json')
        assert before == after
        assert json.loads(after)['reports'][0]['server_doc_id'] == 'SRV-1'
        assert 'reports_index.json' in report['transaktion']
    finally:
        _cleanup(seed, data)


# ── 3. projekt.yaml Merge: Struktur aus SEED, Live-Pflege aus Volume ─────────
def test_projekt_merge_keeps_live_fields():
    seed = _projekt(
        milestones=[{'id': 'M1', 'name': 'Neuer Name (Struktur)', 'progress': 0,
                     'due': '2026-05-01', 'owner': 'Alt'}],
        inputs=[{'id': 'IN-1', 'item': 'x', 'status': None}],
        meta={'projekt': 'X', 'today': '2026-01-01'},
    )
    volume = _projekt(
        milestones=[{'id': 'M1', 'name': 'Alter Name', 'progress': 50,
                     'due': '2026-06-15', 'owner': 'Neu'}],
        inputs=[{'id': 'IN-1', 'item': 'x', 'status': 'geliefert', 'liefer_tasks': ['T-9']}],
        meta={'projekt': 'X', 'today': '2026-08-01'},
    )
    result, conflicts = mb.merge_projekt(seed, volume)
    m = result['workstreams'][0]['milestones'][0]
    assert m['name'] == 'Neuer Name (Struktur)'      # Struktur aus SEED
    assert m['progress'] == 50                        # Live-Fortschritt aus Volume
    assert m['due'] == '2026-06-15'                   # gepflegtes Datum aus Volume
    assert m['owner'] == 'Neu'                        # gepflegter Owner aus Volume
    inp = result['inputs'][0]
    assert inp['status'] == 'geliefert'               # Lieferstatus aus Volume
    assert inp['liefer_tasks'] == ['T-9']             # Task-Kopplung aus Volume
    assert result['meta']['today'] == '2026-01-01'    # Steuerungsdatum aus SEED (Repo-getrieben, nicht Volume)
    assert conflicts == []


# ── 4. projekt.yaml Lösch-Konflikt: behalten + melden, nur bei Live-Daten ────
def test_projekt_delete_conflict():
    # SEED hat M1 entfernt; Volume trägt M1 mit Live-Fortschritt und M2 ohne Live-Daten.
    seed = _projekt(milestones=[{'id': 'KEEP', 'name': 'bleibt', 'progress': 0}])
    volume = _projekt(milestones=[
        {'id': 'KEEP', 'name': 'bleibt', 'progress': 0},
        {'id': 'M1', 'name': 'entfernt, aber gearbeitet', 'progress': 80},
        {'id': 'M2', 'name': 'entfernt, unbearbeitet', 'progress': 0},
    ])
    result, conflicts = mb.merge_projekt(seed, volume)
    ids = [m['id'] for w in result['workstreams'] for m in w['milestones']]
    assert 'M1' in ids                                # mit Live-Daten → zurückgeholt
    assert 'M2' not in ids                            # ohne Live-Daten → nicht zurückgeholt
    kinds = [(c['kind'], c['id'], c['reason']) for c in conflicts]
    assert ('milestone', 'M1', 'structure_removed_has_live_data') in kinds
    assert all(c['id'] != 'M2' for c in conflicts)    # M2 nicht geflaggt
    m1 = next(m for w in result['workstreams'] for m in w['milestones'] if m['id'] == 'M1')
    assert m1['progress'] == 80                        # Live-Wert erhalten


# ── 5. tasks.json Merge: Union by id, Feld-Herkunft, volume-only + seed-only ─
def test_tasks_merge():
    seed = {'tasks': [
        {'id': 'T-1', 'nr': 1, 'ms_id': 'M1', 'text': 'Neuer Text', 'owner': 'A',
         'due': '2026-09-01', 'status': 'offen', 'erledigt_am': None, 'source': 'zerlegung',
         'origin': 'seed', 'created_at': '2026-08-01'},
        {'id': 'T-neu', 'nr': 99, 'text': 'nur im SEED', 'status': 'offen', 'source': 'zerlegung'},
    ]}
    volume = {'tasks': [
        {'id': 'T-1', 'nr': 7, 'ms_id': 'M1', 'text': 'Alter Text', 'owner': 'A',
         'due': '2026-09-01', 'status': 'erledigt', 'erledigt_am': '2026-08-04',
         'erledigt_von': 'CoS', 'source': 'zerlegung', 'origin': 'seed',
         'created_at': '2026-07-13', 'artefakt': 'https://docs/xyz'},
        {'id': 'T-live', 'nr': 42, 'text': 'in der App erfasst', 'status': 'offen'},
    ]}
    result, stats = mb.merge_tasks(seed, volume)
    by_id = {t['id']: t for t in result['tasks']}
    t1 = by_id['T-1']
    assert t1['text'] == 'Neuer Text'                 # Struktur aus SEED
    assert t1['status'] == 'erledigt'                 # Live-Status aus Volume
    assert t1['erledigt_am'] == '2026-08-04'          # Live aus Volume
    assert t1['erledigt_von'] == 'CoS'                # Live-Audit-Feld aus Volume
    assert t1['nr'] == 7                              # Live-Nummer aus Volume
    assert t1['created_at'] == '2026-07-13'           # Live aus Volume
    assert t1['artefakt'] == 'https://docs/xyz'       # App-Zusatzfeld nicht verloren
    assert 'T-live' in by_id                          # volume-only bleibt erhalten
    assert 'T-neu' in by_id                           # seed-only kommt dazu
    assert stats == {'seed': 2, 'volume_only': 1, 'total': 3}
    # Reihenfolge stabil: SEED zuerst, dann volume-only.
    assert [t['id'] for t in result['tasks']] == ['T-1', 'T-neu', 'T-live']


# ── 6. Dry-Run schreibt nichts, berichtet aber die geplanten Änderungen ──────
def test_dry_run_writes_nothing():
    seed, data = _mkdirs()
    try:
        _write(seed, 'domain.json', {'v': 2})
        _write(data, 'domain.json', {'v': 1})
        import yaml
        seed_pj = _projekt(milestones=[{'id': 'KEEP', 'name': 'a', 'progress': 0}])
        vol_pj = _projekt(milestones=[
            {'id': 'KEEP', 'name': 'a', 'progress': 0},
            {'id': 'GONE', 'name': 'weg', 'progress': 30},
        ])
        _write(seed, 'projekt.yaml', None, raw=yaml.safe_dump(seed_pj, allow_unicode=True, sort_keys=False))
        _write(data, 'projekt.yaml', None, raw=yaml.safe_dump(vol_pj, allow_unicode=True, sort_keys=False))
        _write(seed, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}]})
        _write(data, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}, {'id': 'T-2', 'text': 'live'}]})

        before = {n: _read(data, n) for n in ('domain.json', 'projekt.yaml', 'tasks.json')}
        report = mb.run(seed, data, 'dry-run')
        after = {n: _read(data, n) for n in ('domain.json', 'projekt.yaml', 'tasks.json')}

        assert before == after                        # DATA byte-identisch (nichts geschrieben)
        assert report['mode'] == 'dry-run'
        assert report['applied'] is False
        assert 'domain.json' in report['stammdaten']  # geplante Änderung gelistet
        assert report['misch']['tasks.json']['volume_only'] == 1
        assert any(c['id'] == 'GONE' for c in report['conflicts'])  # Konflikt gemeldet
    finally:
        _cleanup(seed, data)


# ── 7. AUTO: 0 Konflikte → wendet automatisch an ─────────────────────────────
def test_auto_applies_when_clean():
    seed, data = _mkdirs()
    try:
        import yaml
        _write(seed, 'domain.json', {'v': 2})
        _write(data, 'domain.json', {'v': 1})
        clean = _projekt(milestones=[{'id': 'M1', 'name': 'a', 'progress': 0}])
        _write(seed, 'projekt.yaml', None, raw=yaml.safe_dump(clean, allow_unicode=True, sort_keys=False))
        _write(data, 'projekt.yaml', None, raw=yaml.safe_dump(clean, allow_unicode=True, sort_keys=False))
        _write(seed, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}]})
        _write(data, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}]})
        report = mb.run(seed, data, 'auto')
        assert report['conflicts'] == []
        assert report['applied'] is True
        assert json.loads(_read(data, 'domain.json')) == {'v': 2}   # sauber → angewandt
    finally:
        _cleanup(seed, data)


# ── 8. AUTO: Konflikt → hält (schreibt NICHT), meldet ────────────────────────
def test_auto_holds_on_conflict():
    seed, data = _mkdirs()
    try:
        import yaml
        _write(seed, 'domain.json', {'v': 2})
        _write(data, 'domain.json', {'v': 1})
        seed_pj = _projekt(milestones=[{'id': 'KEEP', 'name': 'a', 'progress': 0}])
        vol_pj = _projekt(milestones=[{'id': 'KEEP', 'name': 'a', 'progress': 0},
                                      {'id': 'GONE', 'name': 'weg', 'progress': 30}])
        _write(seed, 'projekt.yaml', None, raw=yaml.safe_dump(seed_pj, allow_unicode=True, sort_keys=False))
        _write(data, 'projekt.yaml', None, raw=yaml.safe_dump(vol_pj, allow_unicode=True, sort_keys=False))
        _write(seed, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}]})
        _write(data, 'tasks.json', {'tasks': [{'id': 'T-1', 'text': 'x'}]})
        before = _read(data, 'domain.json')
        report = mb.run(seed, data, 'auto')
        assert any(c['id'] == 'GONE' for c in report['conflicts'])
        assert report['applied'] is False
        assert _read(data, 'domain.json') == before       # Konflikt → NICHT geschrieben (gehalten)
    finally:
        _cleanup(seed, data)


# ── 9. Neue Doc-Index-Stores sind TRANSAKTION (server_doc_id/server_pdf_id) ──
def test_new_doc_indexes_are_transaktion():
    import merge_bridge as mb
    assert "briefings_docs.json" in mb.TRANSAKTION
    assert "fuehrungsrhythmus_doc.json" in mb.TRANSAKTION
    # briefings.json/fuehrungsrhythmus.json bleiben STAMMDATEN (Struktur)
    assert "briefings.json" in mb.STAMMDATEN and "fuehrungsrhythmus.json" in mb.STAMMDATEN


TESTS = [
    test_stammdaten_overwrite,
    test_transaktion_untouched,
    test_projekt_merge_keeps_live_fields,
    test_projekt_delete_conflict,
    test_tasks_merge,
    test_dry_run_writes_nothing,
    test_auto_applies_when_clean,
    test_auto_holds_on_conflict,
    test_new_doc_indexes_are_transaktion,
]


if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f"merge bridge: {len(TESTS)}/{len(TESTS)} gruen")
