#!/usr/bin/env python3
"""_schema.py — prüft die JSON-Stores gegen die Feld-SSOT (R4, 01.08.2026).

Der Vertrag steht in src/data/schema.json. Bisher war er implizit über Plugin
(mergeTasks/mergeEntscheide), UI und validate.py verteilt: ein neues Feld traf
4 Stellen, ohne dass irgendwo stand, wie der Datensatz auszusehen hat.

`pruefe_stores(root)` gibt eine Liste (level, where, msg) zurück — validate.py
hängt sie in seinen bestehenden Fehler-/Warnungs-/Lücken-Report ein.
"""
import json
import re
from pathlib import Path

TYPCHECK = {
    'str': lambda v: isinstance(v, str),
    'int': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'bool': lambda v: isinstance(v, bool),
    'date': lambda v: isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) is not None,
    'list': lambda v: isinstance(v, list),
    'obj': lambda v: isinstance(v, dict),
    'any': lambda v: True,
}


def _wert_aus_domain(domain, pfad):
    """z.B. 'domain.entscheide.flow' → Liste aus domain.json."""
    node = domain
    for teil in pfad.split('.')[1:]:
        node = node.get(teil, {})
    return node if isinstance(node, list) else []


def pruefe_stores(root: Path):
    data = root / 'src' / 'data'
    schema = json.loads((data / 'schema.json').read_text())
    domain = json.loads((data / 'domain.json').read_text())
    befunde = []

    for datei, spec in schema['stores'].items():
        pfad = data / datei
        if not pfad.exists():
            befunde.append(('LÜCKE', datei, 'Store fehlt (noch nicht angelegt)'))
            continue
        try:
            inhalt = json.loads(pfad.read_text())
        except json.JSONDecodeError as ex:
            befunde.append(('FEHLER', datei, f'kein gültiges JSON: {ex}'))
            continue

        rows = inhalt.get(spec['wurzel'])
        if not isinstance(rows, list):
            befunde.append(('FEHLER', datei, f"Wurzel «{spec['wurzel']}» fehlt oder ist keine Liste"))
            continue

        felder = spec['felder']
        gesehen = {f: set() for f, d in felder.items() if d.get('eindeutig')}
        schluessel = spec.get('schluessel')

        for i, row in enumerate(rows):
            ref = f"{datei}[{row.get(schluessel, i) if schluessel else i}]"
            if not isinstance(row, dict):
                befunde.append(('FEHLER', ref, 'Eintrag ist kein Objekt'))
                continue
            # unbekannte Felder sichtbar machen (Schema-Drift)
            for k in row:
                if k not in felder:
                    befunde.append(('LÜCKE', ref, f'Feld «{k}» nicht im Schema — schema.json nachziehen'))
            for name, d in felder.items():
                if name not in row:
                    if d.get('pflicht'):
                        befunde.append(('FEHLER', ref, f'Pflichtfeld «{name}» fehlt'))
                    continue
                v = row[name]
                if v is None:
                    if not d.get('null_ok') and d.get('pflicht'):
                        befunde.append(('FEHLER', ref, f'«{name}» darf nicht null sein'))
                    continue
                if not TYPCHECK[d['typ']](v):
                    befunde.append(('FEHLER', ref, f'«{name}» erwartet {d["typ"]}, ist {type(v).__name__}'))
                    continue
                if 'werte' in d and v not in d['werte']:
                    befunde.append(('FEHLER', ref, f'«{name}» = «{v}» nicht erlaubt (nur {"|".join(d["werte"])})'))
                if 'werte_aus' in d:
                    erlaubt = _wert_aus_domain({'domain': domain}, d['werte_aus'])
                    if erlaubt and v not in erlaubt:
                        befunde.append(('FEHLER', ref, f'«{name}» = «{v}» nicht in {d["werte_aus"]}'))
                if 'muster' in d and not re.fullmatch(d['muster'], str(v)):
                    befunde.append(('FEHLER', ref, f'«{name}» = «{v}» verletzt Muster {d["muster"]}'))
                if d.get('eindeutig'):
                    if v in gesehen[name]:
                        befunde.append(('FEHLER', ref, f'«{name}» = {v} doppelt vergeben'))
                    gesehen[name].add(v)
    return befunde


if __name__ == '__main__':
    for lvl, where, msg in pruefe_stores(Path(__file__).resolve().parent.parent):
        print(f'[{lvl}] {where}: {msg}')
