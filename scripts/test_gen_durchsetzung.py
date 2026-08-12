"""Stufe 5 — Verdrahtungstest für die Durchsetzungs-Generatoren (Kalender-Event + Eskalations-Entwurf):
create_event / create_draft müssen den `me`-Subject und den richtigen Scope an load_credentials
durchreichen, im Kontext des Users schreiben (calendarId='primary' / userId='me'), Teilnehmer/Empfänger
aus der Konfig (Default DRS) setzen und sendUpdates durchreichen — ohne echten Google-Call. _google_auth
und googleapiclient.discovery werden per sys.modules gestubbt."""
import os
import sys
import types

_S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _S)
sys.path.insert(0, os.path.join(_S, '_tools'))

GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events'


def _install_stubs(rec):
    saved = {k: sys.modules.get(k) for k in ('_google_auth', 'googleapiclient', 'googleapiclient.discovery')}
    ga = types.ModuleType('_google_auth')
    ga.GMAIL_MODIFY = GMAIL_MODIFY
    ga.CALENDAR_EVENTS = CALENDAR_EVENTS
    ga.DRIVE = 'https://www.googleapis.com/auth/drive'

    def load_credentials(account='d.streuli@axs.aero', scopes=None, subject=None):
        rec['load'] = {'account': account, 'scopes': scopes, 'subject': subject}
        return 'CREDS'
    ga.load_credentials = load_credentials
    sys.modules['_google_auth'] = ga

    class _Events:
        def insert(self, calendarId, body, sendUpdates):
            rec['insert'] = {'calendarId': calendarId, 'body': body, 'sendUpdates': sendUpdates}
            return types.SimpleNamespace(execute=lambda: {'id': 'EV1', 'htmlLink': 'https://cal/EV1'})

    class _Drafts:
        def create(self, userId, body):
            rec['userId'] = userId
            return types.SimpleNamespace(execute=lambda: {'id': 'DRAFT1'})

    class _Client:
        def events(self):
            return _Events()

        def users(self):
            return types.SimpleNamespace(drafts=lambda: _Drafts())

    def build(api, ver, credentials=None):
        rec.setdefault('built', []).append(api)
        return _Client()

    disc = types.ModuleType('googleapiclient.discovery')
    disc.build = build
    gac = types.ModuleType('googleapiclient')
    gac.discovery = disc
    sys.modules['googleapiclient'] = gac
    sys.modules['googleapiclient.discovery'] = disc
    return saved


def _restore(saved):
    for k, v in saved.items():
        if v is not None:
            sys.modules[k] = v
        else:
            sys.modules.pop(k, None)


def test_calendar_event_wires_subject_scope_and_defaults():
    rec = {}
    saved = _install_stubs(rec)
    try:
        import _kontakte
        import gen_calendar_event as g
        item = {'id': 'IN-99', 'item': 'Testlieferung', 'owner': None, 'due': '2026-08-20'}
        eid, link, teilnehmer, su = g.create_event(item, 'd.streuli@axs.aero', send_updates='all')
    finally:
        _restore(saved)
    assert eid == 'EV1', eid
    assert rec['load']['subject'] == 'd.streuli@axs.aero'
    assert rec['load']['scopes'] == [CALENDAR_EVENTS]
    assert rec['insert']['calendarId'] == 'primary'
    assert rec['insert']['sendUpdates'] == 'all'                 # CLI-Override schlägt Config-Default
    assert teilnehmer == [_kontakte.SELF_EMAIL]                  # kein Owner -> Default DRS
    assert rec['insert']['body']['attendees'] == [{'email': _kontakte.SELF_EMAIL}]
    assert rec['built'] == ['calendar']
    # Slot: Ganztag due=2026-08-20, Config-Default 09:00 + 30 Min, Zeitzone durchgereicht.
    assert rec['insert']['body']['start'] == {'dateTime': '2026-08-20T09:00:00', 'timeZone': 'Europe/Zurich'}
    assert rec['insert']['body']['end'] == {'dateTime': '2026-08-20T09:30:00', 'timeZone': 'Europe/Zurich'}


def test_calendar_event_default_send_updates_from_config():
    rec = {}
    saved = _install_stubs(rec)
    try:
        import gen_calendar_event as g
        g.create_event({'id': 'IN-99', 'item': 'x', 'owner': None, 'due': '2026-08-20'}, 'd.streuli@axs.aero')
    finally:
        _restore(saved)
    # ohne CLI-Override greift der Config-Default (kalender.json: 'none')
    assert rec['insert']['sendUpdates'] == 'none'


def test_eskalation_draft_wires_subject_scope_to_cc():
    rec = {}
    saved = _install_stubs(rec)
    try:
        import _kontakte
        import gen_eskalation_mail as g
        item = {'id': 'IN-99', 'item': 'Testlieferung', 'owner': 'Niemand Bekannt', 'due': '2026-08-01'}
        did, an, cc = g.create_draft(item, 'd.streuli@axs.aero')
    finally:
        _restore(saved)
    assert did == 'DRAFT1', did
    assert rec['load']['subject'] == 'd.streuli@axs.aero'
    assert rec['load']['scopes'] == [GMAIL_MODIFY]
    assert rec['userId'] == 'me'
    assert an is None                                           # unbekannter Owner -> kein Empfänger
    assert cc == [_kontakte.SELF_EMAIL]                         # CC-Default DRS
    assert rec['built'] == ['gmail']


def test_calendar_slot_non_default_and_due_fallback():
    # Nicht-Default-Slot (14:15 + 45 Min) korrekt gerechnet; due=None -> heute als Fallback (kein Crash).
    rec = {}
    saved = _install_stubs(rec)
    try:
        import gen_calendar_event as g
        orig_cfg = g.kalender_config
        g.kalender_config = lambda: {'immer_einladen': [], 'send_updates': 'none',
                                     'slot_start': '14:15', 'slot_minutes': 45, 'timezone': 'Europe/Zurich'}
        try:
            g.create_event({'id': 'X', 'item': 'x', 'owner': None, 'due': '2026-09-01'}, 'u@x')
            assert rec['insert']['body']['start']['dateTime'] == '2026-09-01T14:15:00'
            assert rec['insert']['body']['end']['dateTime'] == '2026-09-01T15:00:00'
            rec.clear()
            g.create_event({'id': 'X', 'item': 'x', 'owner': None, 'due': None}, 'u@x')
            assert rec['insert']['body']['start']['dateTime'].endswith('T14:15:00')  # heute, kein Crash
        finally:
            g.kalender_config = orig_cfg
    finally:
        _restore(saved)


def test_calendar_main_forwards_flags():
    # CLI-Seam: main() parst --id/--subject/--send-updates aus argv und reicht sie an create_event.
    import io
    import os
    import tempfile
    from pathlib import Path
    import gen_calendar_event as g
    rec = {}
    orig_ce, orig_fi, orig_log, orig_argv, orig_out = g.create_event, g.find_item, g.LOG_PATH, sys.argv, sys.stdout
    tmp = tempfile.NamedTemporaryFile(suffix='.json', delete=False); tmp.close(); os.unlink(tmp.name)
    g.find_item = lambda iid: {'id': iid, 'item': 'x', 'owner': None, 'due': '2026-08-20'}
    g.create_event = lambda item, me, send_updates=None: (
        rec.update(me=me, su=send_updates, iid=item['id']) or ('EV', 'link', ['a'], send_updates or 'none'))
    g.LOG_PATH = Path(tmp.name)
    try:
        sys.argv = ['gen_calendar_event.py', '--id', 'IN-07', '--subject', 'u@x', '--send-updates', 'all']
        sys.stdout = io.StringIO()
        g.main()
    finally:
        g.create_event, g.find_item, g.LOG_PATH, sys.argv, sys.stdout = orig_ce, orig_fi, orig_log, orig_argv, orig_out
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
    assert rec == {'me': 'u@x', 'su': 'all', 'iid': 'IN-07'}, rec


TESTS = [
    test_calendar_event_wires_subject_scope_and_defaults,
    test_calendar_event_default_send_updates_from_config,
    test_calendar_slot_non_default_and_due_fallback,
    test_calendar_main_forwards_flags,
    test_eskalation_draft_wires_subject_scope_to_cc,
]

if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f'gen_durchsetzung: {len(TESTS)}/{len(TESTS)} gruen')
