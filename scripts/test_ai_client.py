import datetime as dt
import io
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPTS)                             # gen_report (Task 4)
sys.path.insert(0, os.path.join(_SCRIPTS, '_tools'))     # ai_client
import ai_client  # noqa: E402


# ── ENV-Hygiene ──────────────────────────────────────────────────────────────
_AI_KEYS = ['RUBICON_AI_PROVIDER', 'RUBICON_AI_MODEL', 'RUBICON_AI_REGION',
            'RUBICON_AI_PROJECT', 'RUBICON_AI_MAX_TOKENS', 'RUBICON_AI_PROMPT_FILE']


def _clean_env():
    return {k: os.environ.pop(k) for k in _AI_KEYS if k in os.environ}


def _restore_env(saved):
    for k in _AI_KEYS:
        os.environ.pop(k, None)
    os.environ.update(saved)


# ── 1. Konfig-Defaults (Projekt/Region/max_tokens) ───────────────────────────
def test_config_defaults():
    saved = _clean_env()
    try:
        assert ai_client._project() == 'aixs-260106'
        assert ai_client._region() == 'eu'
        assert ai_client._max_tokens() == 1024
    finally:
        _restore_env(saved)


# ── 2. Konfig-Overrides aus ENV ──────────────────────────────────────────────
def test_config_overrides():
    saved = _clean_env()
    try:
        os.environ['RUBICON_AI_PROJECT'] = 'anderes-projekt'
        os.environ['RUBICON_AI_REGION'] = 'europe-west4'
        os.environ['RUBICON_AI_MAX_TOKENS'] = '2048'
        os.environ['RUBICON_AI_MODEL'] = 'irgendein-modell'
        assert ai_client._project() == 'anderes-projekt'
        assert ai_client._region() == 'europe-west4'
        assert ai_client._max_tokens() == 2048
        assert ai_client._model() == 'irgendein-modell'
    finally:
        _restore_env(saved)


# ── 3. RUBICON_AI_MODEL ist Pflicht im Vertex-Modus -> klare ValueError ──────
def test_model_required_raises():
    saved = _clean_env()
    try:
        try:
            ai_client._model()
            raise AssertionError('ValueError erwartet')
        except ValueError as ex:
            assert 'RUBICON_AI_MODEL' in str(ex)
    finally:
        _restore_env(saved)


# ── 4. Provider unset -> lokale CLI, byte-identischer Aufruf ─────────────────
def test_provider_unset_uses_cli():
    saved = _clean_env()

    class R:  # minimaler CompletedProcess-Stand-in
        returncode = 0
        stdout = ' modelltext \n'
        stderr = ''

    calls = {}

    def fake_run(cmd, **kw):
        calls['cmd'] = cmd
        calls['kw'] = kw
        return R()

    orig = ai_client.subprocess.run
    ai_client.subprocess.run = fake_run
    try:
        out = ai_client.generate('hi prompt')
        assert out == 'modelltext'                       # stdout.strip()
        assert calls['cmd'] == [ai_client.CLAUDE_BIN, '-p', '--model', 'claude-sonnet-4-6']
        assert calls['kw'] == {'input': 'hi prompt', 'capture_output': True,
                               'text': True, 'timeout': 240}
        ai_client.generate('x', timeout=99)              # timeout wird durchgereicht
        assert calls['kw']['timeout'] == 99
    finally:
        ai_client.subprocess.run = orig
        _restore_env(saved)


# ── 5. Unbekannter Provider -> ValueError ────────────────────────────────────
def test_unknown_provider_raises():
    saved = _clean_env()
    try:
        os.environ['RUBICON_AI_PROVIDER'] = 'openai'
        try:
            ai_client.generate('x')
            raise AssertionError('ValueError erwartet')
        except ValueError as ex:
            assert 'openai' in str(ex)
    finally:
        _restore_env(saved)


# ── 6. Dispatch google/anthropic routet auf die Zweig-Funktionen ─────────────
def test_dispatch_vertex_branches():
    saved = _clean_env()
    orig_g, orig_c = ai_client._vertex_gemini, ai_client._vertex_claude
    try:
        os.environ['RUBICON_AI_PROVIDER'] = 'google'
        ai_client._vertex_gemini = lambda p: 'gemini:' + p
        assert ai_client.generate('x') == 'gemini:x'
        os.environ['RUBICON_AI_PROVIDER'] = 'anthropic'
        ai_client._vertex_claude = lambda p: 'claude:' + p
        assert ai_client.generate('y') == 'claude:y'
    finally:
        ai_client._vertex_gemini, ai_client._vertex_claude = orig_g, orig_c
        _restore_env(saved)


# ── 7. Gemini-Zweig: google-genai-SDK (Vertex), lazy import via sys.modules-Fake ──
#      Neue SDK (`from google import genai`) — Voraussetzung, dass Gemini @ eu
#      DSGVO-konform trägt (die alte `vertexai`-SDK lehnt den eu-Alias ab).
def test_vertex_gemini_branch_lazy_import():
    saved = _clean_env()
    os.environ['RUBICON_AI_MODEL'] = 'gemini-modell-x'
    rec = {}
    genai_mod = types.ModuleType('google.genai')

    class FakeClient:
        def __init__(self, **kw):
            rec['ctor'] = kw
            self.models = types.SimpleNamespace(generate_content=self._gen)

        def _gen(self, **kw):
            rec['gen'] = kw
            return types.SimpleNamespace(text='gemini-antwort')
    genai_mod.Client = FakeClient

    google_mod = types.ModuleType('google')
    google_mod.genai = genai_mod
    orig_cred = ai_client._ai_credentials
    ai_client._ai_credentials = lambda: 'FAKE-CREDS'

    keys = ('google', 'google.genai')
    had = {k: sys.modules.get(k) for k in keys}
    sys.modules['google'] = google_mod
    sys.modules['google.genai'] = genai_mod
    try:
        out = ai_client._vertex_gemini('mein prompt')
        assert out == 'gemini-antwort'
        assert rec['ctor'] == {'vertexai': True, 'project': 'aixs-260106',
                               'location': 'eu', 'credentials': 'FAKE-CREDS'}
        assert rec['gen'] == {'model': 'gemini-modell-x', 'contents': 'mein prompt'}
    finally:
        ai_client._ai_credentials = orig_cred
        for k in keys:
            if had[k] is not None:
                sys.modules[k] = had[k]
            else:
                sys.modules.pop(k, None)
        _restore_env(saved)


# ── 8. Claude-Zweig: AnthropicVertex-Fake, Kwargs + content[0].text ──────────
def test_vertex_claude_branch_lazy_import():
    saved = _clean_env()
    os.environ['RUBICON_AI_MODEL'] = 'claude-sonnet-4-6'
    os.environ['RUBICON_AI_MAX_TOKENS'] = '2048'
    rec = {}
    anthropic_mod = types.ModuleType('anthropic')

    class FakeVertex:
        def __init__(self, **kw):
            rec['ctor'] = kw
            self.messages = types.SimpleNamespace(create=self._create)

        def _create(self, **kw):
            rec['create'] = kw
            return types.SimpleNamespace(content=[types.SimpleNamespace(text='claude-antwort')])
    anthropic_mod.AnthropicVertex = FakeVertex
    orig_cred = ai_client._ai_credentials
    ai_client._ai_credentials = lambda: 'FAKE-CREDS'
    had_real = sys.modules.get('anthropic')
    sys.modules['anthropic'] = anthropic_mod
    try:
        out = ai_client._vertex_claude('mein prompt')
        assert out == 'claude-antwort'
        assert rec['ctor'] == {'region': 'eu', 'project_id': 'aixs-260106',
                               'credentials': 'FAKE-CREDS'}
        assert rec['create'] == {'model': 'claude-sonnet-4-6', 'max_tokens': 2048,
                                 'messages': [{'role': 'user', 'content': 'mein prompt'}]}
    finally:
        ai_client._ai_credentials = orig_cred
        if had_real is not None:
            sys.modules['anthropic'] = had_real
        else:
            del sys.modules['anthropic']
        _restore_env(saved)


# ── 9. load_prompt: ENV-Datei gewinnt; fehlende Datei -> Fallback ────────────
def test_load_prompt_env_file_and_fallback():
    saved = _clean_env()
    d = tempfile.mkdtemp(prefix='ai_prompt_')
    try:
        p = Path(d, 'p.txt')
        p.write_text('DATEI-TEMPLATE\n', encoding='utf-8')
        os.environ['RUBICON_AI_PROMPT_FILE'] = str(p)
        assert ai_client.load_prompt('FALLBACK') == 'DATEI-TEMPLATE\n'
        os.environ['RUBICON_AI_PROMPT_FILE'] = str(Path(d, 'gibts-nicht.txt'))
        assert ai_client.load_prompt('FALLBACK') == 'FALLBACK'
    finally:
        shutil.rmtree(d, ignore_errors=True)
        _restore_env(saved)


# ── 10. load_prompt: Default-Pfad = scripts/prompts/ki_narrativ.txt ──────────
def test_load_prompt_default_file():
    saved = _clean_env()
    try:
        text = ai_client.load_prompt('FALLBACK')
        assert text != 'FALLBACK'                        # Repo-Datei existiert
        assert text.startswith('Du bist Programm-Analyst')
        assert text.rstrip('\n').endswith('Kein Lob, kein Alarmismus.')
    finally:
        _restore_env(saved)


# ── ki_block-Fixture: leere Workstreams -> keine status_of-/Briefing-Abhaengigkeit;
#    level='monat' vermeidet den gen_delta-Zweig (nur 'woche' rechnet Delta) ──
def _ki_doc():
    return {'meta': {'today': '2026-08-09'}, 'workstreams': []}


# ── 11. ki_block nutzt ai_client.generate und baut das ENTWURF-HTML ──────────
def test_ki_block_uses_generate_and_builds_html():
    import gen_report as gr
    orig = ai_client.generate

    def fake_generate(prompt, **kw):
        return '{"begruendungen": {"WS1-01": "Verzug wegen X. Gegenmassnahme Y."}}'
    ai_client.generate = fake_generate
    try:
        html_out = gr.ki_block('monat', _ki_doc(), dt.date(2026, 8, 9), 'August 2026')
        assert 'KI-Entwurf' in html_out
        assert 'WS1-01' in html_out and 'Gegenmassnahme Y.' in html_out
        assert 'Freigabe durch CoS/DRS' in html_out
    finally:
        ai_client.generate = orig


# ── 12. Prompt = Template (Datei/Fallback) + FAKTEN-JSON, byte-kompatibel ────
def test_ki_block_prompt_from_template():
    import gen_report as gr
    orig = ai_client.generate
    seen = {}

    def fake_generate(prompt, **kw):
        seen['prompt'] = prompt
        return '{}'
    ai_client.generate = fake_generate
    try:
        gr.ki_block('monat', _ki_doc(), dt.date(2026, 8, 9), 'August 2026')
        p = seen['prompt']
        assert p.startswith('Du bist Programm-Analyst des AXS-Transformationsprogramms RUBICON.')
        assert 'Kein Lob, kein Alarmismus.\n\nFAKTEN:\n' in p     # exakt wie der alte Inline-Prompt
        facts = json.loads(p.split('\n\nFAKTEN:\n', 1)[1])
        assert facts['stichtag'] == '2026-08-09'
        assert facts['problem_ms'] == []
    finally:
        ai_client.generate = orig


# ── 13. Fehler in generate -> non-fataler Platzhalter (Report laeuft weiter) ─
def test_ki_block_error_placeholder():
    import gen_report as gr
    orig = ai_client.generate

    def fake_generate(prompt, **kw):
        raise RuntimeError('vertex kaputt')
    ai_client.generate = fake_generate
    try:
        html_out = gr.ki_block('monat', _ki_doc(), dt.date(2026, 8, 9), 'August 2026')
        assert 'KI-Entwurf nicht verfügbar' in html_out
        assert 'vertex kaputt' in html_out
    finally:
        ai_client.generate = orig


# ── 14. --auto weist ki JEDEM Report zu (alle Ebenen) ────────────────────────
#      main() ohne echte Report-Generierung: gr.generate wird durch einen Spy
#      ersetzt, der (level, ki) sammelt; gr.time.sleep + gr.DATA gemockt.
def test_auto_assigns_ki_to_all_levels():
    import gen_report as gr

    orig_generate = gr.generate
    orig_sleep = gr.time.sleep
    orig_data = gr.DATA
    orig_argv = sys.argv
    orig_stdout = sys.stdout

    calls = []

    def spy_generate(level, period, ki=False):
        calls.append((level, ki))
        return {'ok': True, 'level': level, 'period': period}

    d = tempfile.mkdtemp(prefix='gr_auto_')
    try:
        Path(d, 'projekt.yaml').write_text(
            "meta:\n  today: '2026-08-09'\nworkstreams: []\n", encoding='utf-8')
        gr.generate = spy_generate
        gr.time.sleep = lambda *_a, **_kw: None
        gr.DATA = Path(d)
        sys.argv = ['gen_report.py', '--auto']
        sys.stdout = io.StringIO()  # main() druckt ein JSON-Ergebnis — hier verschluckt
        gr.main()
    finally:
        sys.stdout = orig_stdout
        gr.generate = orig_generate
        gr.time.sleep = orig_sleep
        gr.DATA = orig_data
        sys.argv = orig_argv
        shutil.rmtree(d, ignore_errors=True)

    assert ('woche', True) in calls
    assert ('monat', True) in calls
    assert ('vr', True) in calls


# ── 15. _ai_credentials: Impersonation-Verdrahtung (Source-ADC -> rubicon-ai@) ─
#      google/google.auth/google.auth.impersonated_credentials komplett gefaked
#      via sys.modules, damit kein echtes ADC/Netzwerk noetig ist.
def test_ai_credentials_impersonation_wiring():
    saved = _clean_env()
    FAKE_SOURCE = object()
    rec = {}

    google_mod = types.ModuleType('google')
    auth_mod = types.ModuleType('google.auth')

    def fake_default(scopes=None):
        rec['default_scopes'] = scopes
        return (FAKE_SOURCE, 'proj')
    auth_mod.default = fake_default

    impersonated_mod = types.ModuleType('google.auth.impersonated_credentials')

    class FakeCredentials:
        def __init__(self, **kw):
            rec['kw'] = kw
    impersonated_mod.Credentials = FakeCredentials
    auth_mod.impersonated_credentials = impersonated_mod
    google_mod.auth = auth_mod

    keys = ('google', 'google.auth', 'google.auth.impersonated_credentials')
    had = {k: sys.modules.get(k) for k in keys}
    sys.modules['google'] = google_mod
    sys.modules['google.auth'] = auth_mod
    sys.modules['google.auth.impersonated_credentials'] = impersonated_mod
    try:
        ai_client._ai_credentials()
        assert rec['kw']['target_principal'] == 'rubicon-ai@aixs-260106.iam.gserviceaccount.com'
        assert rec['kw']['target_scopes'] == ['https://www.googleapis.com/auth/cloud-platform']
        assert rec['kw']['source_credentials'] is FAKE_SOURCE
        assert rec['default_scopes'] == ['https://www.googleapis.com/auth/cloud-platform']
    finally:
        for k in keys:
            if had[k] is not None:
                sys.modules[k] = had[k]
            else:
                sys.modules.pop(k, None)
        _restore_env(saved)


# ── 16. Nicht-Null-Exit ohne stdout -> RuntimeError mit stderr (Fix #1) ───────
def test_local_cli_nonzero_exit_raises():
    saved = _clean_env()

    class R:  # minimaler CompletedProcess-Stand-in mit Fehler-Exit
        returncode = 1
        stdout = ''
        stderr = 'error: not logged in\n'

    def fake_run(cmd, **kw):
        return R()

    orig = ai_client.subprocess.run
    ai_client.subprocess.run = fake_run
    try:
        try:
            ai_client.generate('hi prompt')
            raise AssertionError('RuntimeError erwartet')
        except RuntimeError as ex:
            assert str(ex) == 'error: not logged in'
    finally:
        ai_client.subprocess.run = orig
        _restore_env(saved)


TESTS = [
    test_config_defaults,
    test_config_overrides,
    test_model_required_raises,
    test_provider_unset_uses_cli,
    test_unknown_provider_raises,
    test_dispatch_vertex_branches,
    test_vertex_gemini_branch_lazy_import,
    test_vertex_claude_branch_lazy_import,
    test_load_prompt_env_file_and_fallback,
    test_load_prompt_default_file,
    test_ki_block_uses_generate_and_builds_html,
    test_ki_block_prompt_from_template,
    test_ki_block_error_placeholder,
    test_auto_assigns_ki_to_all_levels,
    test_ai_credentials_impersonation_wiring,
    test_local_cli_nonzero_exit_raises,
]


if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f"ai_client: {len(TESTS)}/{len(TESTS)} gruen")
