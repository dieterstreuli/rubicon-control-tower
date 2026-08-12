"""Stufe 4 — Verdrahtungstest fuer die Gmail-Entwurfs-Erzeugung: create_draft muss den
`me`-Subject und den `gmail.modify`-Scope (Entscheid zusaetzlich `drive`) an load_credentials
durchreichen und den Entwurf via drafts().create(userId='me') anlegen — ohne echten Gmail-/
Drive-Call. _google_auth und googleapiclient.discovery werden per sys.modules gestubbt."""
import os
import sys
import tempfile
import types

_S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _S)
sys.path.insert(0, os.path.join(_S, '_tools'))

GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
DRIVE = 'https://www.googleapis.com/auth/drive'


def _install_stubs(rec):
    """Stubbt _google_auth (faengt load_credentials-Args) + googleapiclient.discovery.build
    (Fake gmail/drive) in sys.modules. Gibt die Original-Module zum Restore zurueck."""
    saved = {k: sys.modules.get(k) for k in ('_google_auth', 'googleapiclient', 'googleapiclient.discovery')}

    ga = types.ModuleType('_google_auth')
    ga.GMAIL_MODIFY = GMAIL_MODIFY
    ga.DRIVE = DRIVE
    ga.DOCUMENTS = 'https://www.googleapis.com/auth/documents'

    def load_credentials(account='d.streuli@axs.aero', scopes=None, subject=None):
        rec['load'] = {'account': account, 'scopes': scopes, 'subject': subject}
        return 'CREDS'
    ga.load_credentials = load_credentials
    sys.modules['_google_auth'] = ga

    class _Drafts:
        def create(self, userId, body):
            rec.setdefault('userIds', []).append(userId)
            return types.SimpleNamespace(execute=lambda: {'id': 'DRAFT1'})

    class _Users:
        def drafts(self):
            return _Drafts()

    class _Client:
        def users(self):
            return _Users()

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


def test_reminder_create_draft_wires_subject_and_scope():
    rec = {}
    saved = _install_stubs(rec)
    try:
        import gen_reminder_mail as m
        did = m.create_draft('x@y.z', 'Betreff', '<p>hi</p>', me='d.streuli@axs.aero')
    finally:
        _restore(saved)
    assert did == 'DRAFT1', did
    assert rec['load']['subject'] == 'd.streuli@axs.aero', rec['load']
    assert rec['load']['scopes'] == [GMAIL_MODIFY], rec['load']
    assert rec['userIds'] == ['me'], rec
    assert rec['built'] == ['gmail'], rec


def test_reminder_create_draft_local_no_subject():
    # Dual-Mode: ohne me (lokal) wird kein Subject gesetzt -> load_credentials(subject=None).
    rec = {}
    saved = _install_stubs(rec)
    try:
        import gen_reminder_mail as m
        m.create_draft('x@y.z', 'Betreff', '<p>hi</p>')
    finally:
        _restore(saved)
    assert rec['load']['subject'] is None, rec['load']


def test_entscheid_create_draft_wires_subject_and_scopes():
    rec = {}
    saved = _install_stubs(rec)
    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    tmp.write(b'%PDF-1.4 dummy'); tmp.close()
    try:
        import gen_entscheid_mail as m
        recd = {'id': 'E-001', 'titel': 'Test', 'entscheid': 'Beschluss', 'anhaenge': []}
        draft_id, n_anh, anh_err = m.create_draft(recd, tmp.name, None, me='d.streuli@axs.aero')
    finally:
        _restore(saved)
        os.unlink(tmp.name)
    assert draft_id == 'DRAFT1', draft_id
    assert rec['load']['subject'] == 'd.streuli@axs.aero', rec['load']
    assert set(rec['load']['scopes']) == {GMAIL_MODIFY, DRIVE}, rec['load']
    assert rec['userIds'] == ['me'], rec
    assert 'gmail' in rec['built'] and 'drive' in rec['built'], rec


def test_reminder_main_forwards_subject_to_create_draft():
    # Deckt den CLI-Seam: main() parst --subject aus argv und reicht es als me an create_draft.
    # create_draft + load_items + LOG_PATH werden gestubbt (kein Gmail-/Datei-Seiteneffekt).
    import gen_reminder_mail as m
    rec = {}
    orig_cd, orig_li, orig_log, orig_argv = m.create_draft, m.load_items, m.LOG_PATH, sys.argv
    tmp = tempfile.NamedTemporaryFile(suffix='.json', delete=False); tmp.close(); os.unlink(tmp.name)
    m.create_draft = lambda to, subj, body, me=None: rec.setdefault('me', me) or 'D1'
    m.load_items = lambda args: ({'inputs': []}, '2026-08-11',
        [{'ref': 'T-001', 'art': 'Handlung', 'text': 'x', 'owner': 'Niemand Bekannt', 'due': '2026-08-01', 'over': 10}])
    m.LOG_PATH = __import__('pathlib').Path(tmp.name)
    import io
    orig_out = sys.stdout
    try:
        sys.argv = ['gen_reminder_mail.py', '--ids', 'T-001', '--subject', 'u@x']
        sys.stdout = io.StringIO()
        m.main()
    finally:
        sys.stdout = orig_out
        m.create_draft, m.load_items, m.LOG_PATH, sys.argv = orig_cd, orig_li, orig_log, orig_argv
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
    assert rec.get('me') == 'u@x', rec


TESTS = [
    test_reminder_create_draft_wires_subject_and_scope,
    test_reminder_create_draft_local_no_subject,
    test_entscheid_create_draft_wires_subject_and_scopes,
    test_reminder_main_forwards_subject_to_create_draft,
]

if __name__ == '__main__':
    for t in TESTS:
        t()
    print(f'gen_mail_subject: {len(TESTS)}/{len(TESTS)} gruen')
