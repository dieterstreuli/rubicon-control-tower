import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "_tools"))
import _google_auth as ga  # noqa: E402


def test_build_jwt_payload():
    p = ga._build_jwt_payload("sa@x.iam", "user@axs.aero", ["s1", "s2"], 1000)
    assert p == {
        "iss": "sa@x.iam", "sub": "user@axs.aero",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": 1000, "exp": 4600, "scope": "s1 s2",
    }, p


def test_dispatch_sa_mode():
    os.environ["RUBICON_WORKSPACE_SA"] = "sa@x.iam"
    os.environ["RUBICON_IMPERSONATE_SUBJECT"] = "user@axs.aero"
    orig = ga._dwd_credentials
    seen = {}
    ga._dwd_credentials = lambda sa, sub, sc: seen.update(sa=sa, sub=sub, sc=sc) or "DWD"
    try:
        out = ga.load_credentials()
    finally:
        ga._dwd_credentials = orig
        os.environ.pop("RUBICON_WORKSPACE_SA", None)
        os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)
    assert out == "DWD"
    assert seen["sa"] == "sa@x.iam" and seen["sub"] == "user@axs.aero"
    assert seen["sc"] == ga.DEFAULT_SCOPES


def test_dispatch_user_mode():
    os.environ.pop("RUBICON_WORKSPACE_SA", None)
    os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)
    orig = ga._load_user_credentials
    ga._load_user_credentials = lambda account: f"USER:{account}"
    try:
        out = ga.load_credentials("d.streuli@axs.aero")
    finally:
        ga._load_user_credentials = orig
    assert out == "USER:d.streuli@axs.aero"


def test_default_scopes():
    assert "https://www.googleapis.com/auth/drive" in ga.DEFAULT_SCOPES
    assert "https://www.googleapis.com/auth/documents" in ga.DEFAULT_SCOPES


def test_subject_overrides_env():
    # Stufe 3: expliziter subject UEBERSCHREIBT RUBICON_IMPERSONATE_SUBJECT im Server-Modus
    # (Server-Call handelt im Kontext des angemeldeten Users, nicht als rubicon@).
    os.environ["RUBICON_WORKSPACE_SA"] = "sa@x.iam"
    os.environ["RUBICON_IMPERSONATE_SUBJECT"] = "rubicon@axs.aero"
    orig = ga._dwd_credentials
    seen = {}
    ga._dwd_credentials = lambda sa, sub, sc: seen.update(sub=sub) or "DWD"
    try:
        out = ga.load_credentials(subject="d.streuli@axs.aero")
    finally:
        ga._dwd_credentials = orig
        os.environ.pop("RUBICON_WORKSPACE_SA", None)
        os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)
    assert out == "DWD" and seen["sub"] == "d.streuli@axs.aero"


def test_subject_ignored_without_dwd_env():
    # Sicherheits-Guard: ohne DWD-Env (lokal) ist `subject` wirkungslos -> User-OAuth. Ein
    # durchgereichter Subject darf lokal NIEMALS ein Impersonieren ausloesen.
    os.environ.pop("RUBICON_WORKSPACE_SA", None)
    os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)
    orig = ga._load_user_credentials
    ga._load_user_credentials = lambda account: f"USER:{account}"
    try:
        out = ga.load_credentials("d.streuli@axs.aero", subject="fremd@evil.com")
    finally:
        ga._load_user_credentials = orig
    assert out == "USER:d.streuli@axs.aero"


if __name__ == "__main__":
    test_build_jwt_payload()
    test_dispatch_sa_mode()
    test_dispatch_user_mode()
    test_default_scopes()
    test_subject_overrides_env()
    test_subject_ignored_without_dwd_env()
    print("google_auth DWD: 6/6 gruen")
