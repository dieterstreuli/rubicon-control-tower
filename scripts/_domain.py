#!/usr/bin/env python3
"""_domain.py — Python-Zugriff auf die Domänen-SSOT (Q2, 01.08.2026).

Liest dieselbe Datei wie das UI (src/data/domain.json). Damit gibt es für
Status-Labels/-Farben, Phasen-Reihenfolge und Entscheids-Flow genau EINE Liste
im Repo — vorher lagen Phasen 3× in gen_report.py und der Entscheids-Flow
doppelt (App + Plugin).
"""
import json
from pathlib import Path

_DOMAIN = json.loads((Path(__file__).resolve().parent.parent / 'src' / 'data' / 'domain.json').read_text())

ROLLEN = _DOMAIN['rollen']

# Status: Reihenfolge (schlechtester zuerst), Druckfarben + Labels
ORDER = _DOMAIN['status']['reihenfolge']
SIG = {k: v['pdf'] for k, v in _DOMAIN['status']['meta'].items()}
SIG_LBL = {k: v['label'] for k, v in _DOMAIN['status']['meta'].items()}

# Phasen (kanonische Reihenfolge)
PHASEN = _DOMAIN['phasen']['reihenfolge']

# Entscheids-Register
ENT_FLOW = _DOMAIN['entscheide']['flow']
ENT_TYPEN = _DOMAIN['entscheide']['typen']
ENT_GREMIEN = _DOMAIN['entscheide']['gremien']
ENT_BEGRUENDUNG_AB = _DOMAIN['entscheide']['begruendung_pflicht_ab']

# Report-Ebenen
REPORT_LABEL = {k: v['label'] for k, v in _DOMAIN['report_ebenen'].items()}
