"""KI-Modell-Fassade fuer das Report-Narrativ (Dual-Mode).

RUBICON_AI_PROVIDER unset     -> lokale claude-CLI (byte-identisch zum frueheren
                                 Inline-Aufruf in gen_report.ki_block; Dieters Pfad).
RUBICON_AI_PROVIDER=google    -> Vertex Gemini  (google-genai-SDK, eu-Endpoint).
RUBICON_AI_PROVIDER=anthropic -> Vertex Claude  (AnthropicVertex, eu-Endpoint).

Vertex-SDKs werden LAZY in den Zweig-Funktionen importiert, damit das Modul ohne
sie importierbar (testbar) bleibt. Vertex-Credentials via Impersonation des
dedizierten SA rubicon-ai@ (Source = ADC der Laufzeit, DEPLOYMENT_GCP.md §9.6).
"""
import os
import subprocess
from pathlib import Path

# Lokaler CLI-Pfad (vormals in gen_report.py). RUBICON_AI_MODEL gilt NUR im
# Vertex-Modus — das lokale Modell bleibt fest, damit Dieters Pfad exakt gleich bleibt.
CLAUDE_BIN = os.environ.get('RUBICON_CLAUDE', '/Users/dieterstreuli/.local/bin/claude')
_SCOPES = ['https://www.googleapis.com/auth/cloud-platform']
PROMPT_DIR = Path(__file__).resolve().parent.parent / 'prompts'


def _project():
    return os.environ.get('RUBICON_AI_PROJECT') or 'aixs-260106'


def _region():
    return os.environ.get('RUBICON_AI_REGION') or 'eu'


def _model():
    model = os.environ.get('RUBICON_AI_MODEL')
    if not model:
        raise ValueError('RUBICON_AI_MODEL fehlt (Pflicht im Vertex-Modus)')
    return model


def _max_tokens():
    # 8192 statt frueher 1024: die Claude-5-Familie denkt (thinking-Bloecke) VOR dem Text und
    # zaehlt das Thinking gegen max_tokens. Beim Wochen-Report verbraucht das Thinking ~2.8k
    # Tokens; mit einem knappen Budget wird die Text-Antwort (das JSON-Narrativ) mitten im
    # String abgeschnitten (stop_reason=max_tokens) und laesst sich nicht mehr parsen -> leerer
    # KI-Entwurf. 8192 laesst Thinking + volles Narrativ + Begruendungen bequem Platz.
    return int(os.environ.get('RUBICON_AI_MAX_TOKENS') or 8192)


def _local_cli(prompt, timeout):
    """Bisheriger lokaler Weg — Aufruf unveraendert zu gen_report vor dem Umbau."""
    r = subprocess.run([CLAUDE_BIN, '-p', '--model', 'claude-sonnet-4-6'], input=prompt,
                       capture_output=True, text=True, timeout=timeout)
    # Nicht-Null-Exit ohne stdout: den Grund (stderr) als Fehler sichtbar machen, statt still ''
    # zurueckzugeben. Sonst erschiene ein CLI-Fehler (z.B. abgelaufene Anmeldung, die nur auf
    # stderr landet) als leere Antwort. Aufrufer behandeln die Exception: Node runClaude -> 500
    # (+ AUTH_RE-Retry, da auch err.message geprueft wird); gen_report.ki_block faengt sie non-fatal ab.
    if r.returncode != 0 and not r.stdout.strip():
        raise RuntimeError((r.stderr.strip() or f'exit {r.returncode}')[-300:])
    return r.stdout.strip()


def _ai_sa():
    return f'rubicon-ai@{_project()}.iam.gserviceaccount.com'


def _ai_credentials():
    """Access-Token-Credentials des dedizierten Vertex-SA rubicon-ai@ per
    Impersonation (Source = ADC der Laufzeit; auf Cloud Run: rubicon-runtime)."""
    import google.auth
    from google.auth import impersonated_credentials
    source, _ = google.auth.default(scopes=_SCOPES)
    return impersonated_credentials.Credentials(
        source_credentials=source,
        target_principal=_ai_sa(),
        target_scopes=_SCOPES,
    )


def _vertex_gemini(prompt):
    # Neue google-genai-SDK (nicht die alte `vertexai`): nur sie trägt den
    # eu-Multi-Region-Endpoint (DSGVO/EEA) und die aktuelle Gemini-Generation
    # inkl. der Flash-3.x-Familie. Vertex-Backend via vertexai=True + project/location.
    from google import genai
    client = genai.Client(vertexai=True, project=_project(),
                          location=_region(), credentials=_ai_credentials())
    return client.models.generate_content(model=_model(), contents=prompt).text


def _claude_text(message):
    """Nur die TEXT-Bloecke der Anthropic-Antwort verketten. Die Claude-5-Familie liefert
    Thinking-Bloecke (kein `.text`) — `message.content[0]` ist dann ein ThinkingBlock, und ein
    blindes `.text` wirft `'ThinkingBlock' object has no attribute 'text'`. Text-Bloecke tragen
    `type == 'text'`; alles andere (thinking/redacted_thinking/tool_use) wird uebersprungen."""
    return ''.join(b.text for b in message.content if getattr(b, 'type', None) == 'text')


def _vertex_claude(prompt):
    from anthropic import AnthropicVertex
    client = AnthropicVertex(region=_region(), project_id=_project(),
                             credentials=_ai_credentials())
    budget = _max_tokens()
    message = client.messages.create(
        model=_model(), max_tokens=budget,
        messages=[{'role': 'user', 'content': prompt}],
    )
    # Abgeschnittene Antwort (Budget im Thinking+Text erschoepft) NICHT still zurueckgeben: der
    # Text ist dann unvollstaendiges JSON, der Aufrufer parst nichts und faellt auf die
    # irrefuehrende «keine Auffaelligkeiten»-Meldung zurueck. Sichtbar als Fehler melden, damit
    # die Ursache (zu kleines max_tokens) im UI erscheint statt sich als «leer» zu tarnen.
    if message.stop_reason == 'max_tokens':
        raise RuntimeError(
            f'Modellausgabe bei max_tokens={budget} abgeschnitten (stop_reason=max_tokens) — '
            'Budget erhoehen (RUBICON_AI_MAX_TOKENS).')
    return _claude_text(message)


def generate(prompt, *, timeout=240):
    """Rohen Modelltext liefern (Aufrufer parst JSON). Dispatch s. Modul-Docstring.

    timeout wirkt nur im CLI-Zweig (subprocess); die Vertex-SDKs nutzen ihre
    eigenen Defaults. Diese Funktion ist die einzige Naht Prompt-rein/Text-raus —
    ein spaeterer Sanitize-Hook waere hier additiv einhaengbar (bewusst nicht aktiv).
    """
    provider = os.environ.get('RUBICON_AI_PROVIDER')
    if not provider:
        return _local_cli(prompt, timeout)
    if provider == 'google':
        return _vertex_gemini(prompt)
    if provider == 'anthropic':
        return _vertex_claude(prompt)
    raise ValueError(f'Unbekannter RUBICON_AI_PROVIDER: {provider}')


def load_prompt(fallback):
    """Prompt-Template laden: RUBICON_AI_PROMPT_FILE > <scripts>/prompts/ki_narrativ.txt
    > Inline-Fallback des Aufrufers (kein harter Bruch bei fehlender Datei)."""
    path = Path(os.environ.get('RUBICON_AI_PROMPT_FILE') or (PROMPT_DIR / 'ki_narrativ.txt'))
    try:
        return path.read_text(encoding='utf-8')
    except OSError:
        return fallback
