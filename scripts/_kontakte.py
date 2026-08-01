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
