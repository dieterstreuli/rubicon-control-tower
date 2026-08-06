import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_report as gr  # noqa: E402

URL = 'https://docs.google.com/document/d/{}/edit'


def _base(slug='woche-2026-08-01'):
    return {'id': slug, 'level': 'woche', 'period': '2026-08-01',
            'label': 'KW 31', 'pdf': f'/reports/{slug}.pdf', 'stand': '2026-08-06'}


def test_server_writes_own_field_preserves_local():
    prev = {'id': 'woche-2026-08-01', 'doc_id': 'DIETER',
            'doc_url': URL.format('DIETER'), 'label': 'alt'}
    rec = gr._merge_report_record(prev, _base(), 'SRV', server=True)
    assert rec['server_doc_id'] == 'SRV'
    assert rec['server_doc_url'] == URL.format('SRV')
    assert rec['doc_id'] == 'DIETER'              # Dieters Feld unangetastet
    assert rec['doc_url'] == URL.format('DIETER')
    assert rec['label'] == 'KW 31'                # geteiltes Feld aktualisiert


def test_local_writes_doc_id_preserves_server():
    prev = {'id': 'woche-2026-08-01', 'server_doc_id': 'SRV',
            'server_doc_url': URL.format('SRV')}
    rec = gr._merge_report_record(prev, _base(), 'LOCAL', server=False)
    assert rec['doc_id'] == 'LOCAL'
    assert rec['doc_url'] == URL.format('LOCAL')
    assert rec['server_doc_id'] == 'SRV'          # Server-Feld unangetastet
    assert rec['server_doc_url'] == URL.format('SRV')


def test_new_report_no_prev_server():
    rec = gr._merge_report_record(None, _base(), 'SRV', server=True)
    assert rec['server_doc_id'] == 'SRV'
    assert 'doc_id' not in rec                     # keine fremde Umgebung erfunden
    assert rec['id'] == 'woche-2026-08-01'


def test_none_doc_id_yields_null_url():
    rec = gr._merge_report_record(None, _base(), None, server=True)
    assert rec['server_doc_id'] is None
    assert rec['server_doc_url'] is None


if __name__ == '__main__':
    test_server_writes_own_field_preserves_local()
    test_local_writes_doc_id_preserves_server()
    test_new_report_no_prev_server()
    test_none_doc_id_yields_null_url()
    print("report record merge: 4/4 gruen")
