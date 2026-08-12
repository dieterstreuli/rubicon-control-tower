#!/usr/bin/env python3
"""_kontakte.py — Personen-SSOT für die Mail-Generatoren (Q5, 01.08.2026).

Liest src/data/kontakte.json: EINE Liste für GL-Verteiler (Entscheid-Kommunikation)
und Owner→E-Mail (Reminder). Personelle Änderungen sind damit Datenpflege statt
Code-Commit — vorher standen dieselben Adressen in zwei Scripts.
"""
import json
from pathlib import Path

_K = json.loads((Path(__file__).resolve().parent.parent / 'src' / 'data' / 'kontakte.json').read_text())
PERSONEN = _K['personen']

#: Owner-Name → E-Mail (nur verifizierte; None-Einträge fallen raus → nie geraten)
OWNER_EMAILS = {n: p['email'] for n, p in PERSONEN.items() if p.get('email')}

#: Fester GL-Verteiler der Entscheid-Kommunikation (ohne DRS = Absender)
GL_VERTEILER = [p['email'] for p in PERSONEN.values() if p.get('gl_verteiler') and p.get('email')]

#: Personen, die auf Englisch angeschrieben werden (feste DRS-Regel)
ENGLISH_OWNERS = {n for n, p in PERSONEN.items() if p.get('sprache') == 'en'}

#: Absender/Selbst — bekommt keine Self-Reminder
SELF = next((n for n, p in PERSONEN.items() if p.get('absender')), 'Dieter Streuli')

#: E-Mail des Absenders/Selbst (DRS) — Default-Fallback für Verteiler/Teilnehmer (nie geraten).
SELF_EMAIL = OWNER_EMAILS.get(SELF) or next(
    (p['email'] for p in PERSONEN.values() if p.get('absender') and p.get('email')), None)

_DATA = Path(__file__).resolve().parent.parent / 'src' / 'data'

# Stufe 5: Durchsetzungs-Konfig (Kalender/Eskalation) — Empfänger/Teilnehmer aus Daten, nie geraten.
_KAL_DEFAULTS = {'immer_einladen': [], 'send_updates': 'none',
                 'slot_start': '09:00', 'slot_minutes': 30, 'timezone': 'Europe/Zurich'}


def _load_cfg(name):
    # Diese Dateien sind für Handpflege durch DRS gedacht — ein Tipp-/Syntaxfehler (JSONDecodeError,
    # eine ValueError) darf NICHT die ganze Durchsetzungs-Aktion mit 500 killen, sondern auf die Defaults
    # (und damit den DRS-Fallback) zurückfallen. Fehlende Datei = OSError, ebenfalls Defaults.
    try:
        return json.loads((_DATA / name).read_text())
    except (OSError, ValueError):
        return {}


def _as_list(v):
    # Handpflege-Robustheit: ein Feld, das eine Liste sein soll, aber als String/None getippt wurde,
    # darf NICHT als Zeichenkette iteriert werden (sonst Einzelbuchstaben als Adressen). Nicht-Liste -> [].
    return v if isinstance(v, list) else []


def kalender_config():
    """Kalender-Konfig aus src/data/kalender.json über die Defaults gelegt (fehlende Datei -> Defaults).
    Nur Skalar-/Listen-Felder; kein Raten."""
    cfg = dict(_KAL_DEFAULTS)
    cfg.update({k: v for k, v in _load_cfg('kalender.json').items() if not k.startswith('_')})
    return cfg


def kalender_teilnehmer(owner_email):
    """Teilnehmer eines Kalender-Events: Owner (falls E-Mail bekannt) + 'immer_einladen'-Liste; ist die
    Liste leer, greift der Default DRS (SELF_EMAIL). Dedupliziert (case-insensitiv), Reihenfolge stabil."""
    immer = [a for a in _as_list(kalender_config().get('immer_einladen')) if a] or ([SELF_EMAIL] if SELF_EMAIL else [])
    out, seen = [], set()
    for a in ([owner_email] if owner_email else []) + immer:
        if a and a.lower() not in seen:
            seen.add(a.lower()); out.append(a)
    return out


def eskalation_cc(owner_name):
    """CC-Empfänger der Eskalations-Mail: per_owner[owner] (falls gesetzt) sonst default_cc aus
    eskalation.json; ist beides leer, Default DRS (SELF_EMAIL). Nur verifizierte Adressen."""
    cfg = _load_cfg('eskalation.json')
    per = cfg.get('per_owner') if isinstance(cfg.get('per_owner'), dict) else {}
    cc = [a for a in (_as_list(per.get(owner_name)) or _as_list(cfg.get('default_cc'))) if a]
    return cc or ([SELF_EMAIL] if SELF_EMAIL else [])
