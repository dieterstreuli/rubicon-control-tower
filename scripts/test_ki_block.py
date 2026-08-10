import sys, os
_S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _S); sys.path.insert(0, os.path.join(_S, '_tools'))
os.chdir(_S)
import gen_report as g
import ai_client

doc, _, _ = g.load()
now = g.pdate(doc['meta']['today'])

def run(fake):
    orig = ai_client.generate
    ai_client.generate = fake
    try:
        return g.ki_block('vr', doc, now, 'Q3/2026')
    finally:
        ai_client.generate = orig

def test_valid_narrativ_for_vr():
    out = run(lambda p: '{"narrativ": "Das Quartal zeigt Fortschritt.", "begruendungen": {"WS7-01": "Grund."}}')
    assert 'KI-Entwurf' in out and 'Das Quartal zeigt Fortschritt.' in out and 'WS7-01' in out

def test_error_visible():
    def boom(p): raise RuntimeError('vertex 503')
    out = run(boom)
    assert 'nicht verfügbar' in out and 'vertex 503' in out

def test_empty_visible():
    out = run(lambda p: 'kein json hier')
    assert 'KI-Entwurf' in out and 'Keine KI-Ausgabe' in out

if __name__ == '__main__':
    for n, f in sorted(globals().items()):
        if n.startswith('test_') and callable(f):
            f(); print('ok', n)
    print('ALL PASS')
