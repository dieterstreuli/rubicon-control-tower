import io, os, sys, types
_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPTS)
sys.path.insert(0, os.path.join(_SCRIPTS, '_tools'))
import ai_client
import ai_ask

def _run(prompt, gen):
    orig_gen, orig_in, orig_out, orig_err = ai_client.generate, sys.stdin, sys.stdout, sys.stderr
    ai_client.generate = gen
    sys.stdin = io.StringIO(prompt); sys.stdout = io.StringIO(); sys.stderr = io.StringIO()
    try:
        rc = ai_ask.main()
        return rc, sys.stdout.getvalue(), sys.stderr.getvalue()
    finally:
        ai_client.generate, sys.stdin, sys.stdout, sys.stderr = orig_gen, orig_in, orig_out, orig_err

def test_ok():
    rc, out, err = _run('Frage', lambda p, **kw: 'ANTWORT:' + p)
    assert rc == 0 and out == 'ANTWORT:Frage' and err == ''

def test_empty_prompt():
    rc, out, err = _run('   ', lambda p, **kw: 'x')
    assert rc == 1 and out == '' and 'leer' in err

def test_exception_to_stderr():
    def boom(p, **kw): raise RuntimeError('vertex kaputt')
    rc, out, err = _run('Frage', boom)
    assert rc == 1 and out == '' and 'vertex kaputt' in err

def test_timeout_passed_through():
    # Fix #3: inneres Timeout (230s) < Nodes 240s-SIGKILL, damit Python den
    # CLI-Enkel selbst sauber beendet statt vom SIGKILL erwischt zu werden.
    seen = {}
    def gen(p, **kw):
        seen.update(kw)
        return 'x'
    rc, out, err = _run('Frage', gen)
    assert rc == 0 and seen.get('timeout') == 230

if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn(); print('ok', name)
    print('ALL PASS')
