"""Stufe 5 — Durchsetzungs-Konfig (Kalender/Eskalation): der Resolver in _kontakte muss immer eine
verifizierte Adresse liefern und bei leerer Konfig auf DRS (SELF_EMAIL) zurückfallen — nie leer, nie
geraten. Läuft gegen die echten Repo-Daten (kalender.json/eskalation.json mit leeren Defaults)."""
import os
import sys

_S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _S)
sys.path.insert(0, os.path.join(_S, '_tools'))
import _kontakte as k  # noqa: E402


def test_self_email_present():
    # Default-Fallback braucht eine verifizierte DRS-Adresse; ohne sie wäre der Default None.
    assert k.SELF_EMAIL and '@' in k.SELF_EMAIL


def test_kalender_teilnehmer_owner_plus_default():
    t = k.kalender_teilnehmer('owner@example.com')
    assert t[0] == 'owner@example.com'
    assert k.SELF_EMAIL in t          # Default DRS immer dabei (immer_einladen leer)


def test_kalender_teilnehmer_dedup_and_no_owner():
    # Owner == Default -> nur einmal; kein Owner (None) -> nur Default.
    assert k.kalender_teilnehmer(k.SELF_EMAIL) == [k.SELF_EMAIL]
    assert k.kalender_teilnehmer(None) == [k.SELF_EMAIL]


def test_eskalation_cc_defaults_to_drs():
    assert k.eskalation_cc('Irgendwer') == [k.SELF_EMAIL]


def test_kalender_config_defaults():
    c = k.kalender_config()
    assert c['send_updates'] in ('none', 'all')
    assert isinstance(c['slot_minutes'], int) and c['slot_minutes'] > 0
    assert c['slot_start'] and c['timezone']


def test_resolvers_survive_malformed_and_null_config():
    # Die Konfig-Dateien sind für Handpflege durch DRS gedacht: ein Syntaxfehler (malformed JSON) ODER
    # ein explizites null-Feld darf die Resolver NICHT crashen — es muss auf den DRS-Default zurückfallen.
    import shutil
    import tempfile
    from pathlib import Path
    d = tempfile.mkdtemp(prefix='cfg_')
    orig = k._DATA
    try:
        k._DATA = Path(d)
        (Path(d) / 'kalender.json').write_text('{ kaputt kein json ')      # malformed -> ValueError
        assert k.kalender_teilnehmer('o@example.com') == ['o@example.com', k.SELF_EMAIL]
        (Path(d) / 'kalender.json').write_text('{"immer_einladen": null}')  # explizites null
        (Path(d) / 'eskalation.json').write_text('{"per_owner": null, "default_cc": null}')
        assert k.kalender_teilnehmer(None) == [k.SELF_EMAIL]
        assert k.eskalation_cc('Foo') == [k.SELF_EMAIL]
        # Feld als String statt Liste getippt: NICHT als Zeichenkette iterieren -> Default DRS.
        (Path(d) / 'kalender.json').write_text('{"immer_einladen": "a@b.c"}')
        (Path(d) / 'eskalation.json').write_text('{"per_owner": "x", "default_cc": "y@z.c"}')
        assert k.kalender_teilnehmer(None) == [k.SELF_EMAIL]
        assert k.eskalation_cc('Foo') == [k.SELF_EMAIL]
    finally:
        k._DATA = orig
        shutil.rmtree(d, ignore_errors=True)


TESTS = [
    test_self_email_present,
    test_kalender_teilnehmer_owner_plus_default,
    test_kalender_teilnehmer_dedup_and_no_owner,
    test_eskalation_cc_defaults_to_drs,
    test_kalender_config_defaults,
    test_resolvers_survive_malformed_and_null_config,
]

if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f'durchsetzung_config: {len(TESTS)}/{len(TESTS)} gruen')
