"""Shared Google credential loader for Chief Tools.

Serverseitig (RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT gesetzt): keyless
Domain-Wide-Delegation via IAM-Credentials signJwt -> Token als der Service-User.
Sonst: lokaler User-OAuth aus ~/.config/google-mcp. google-Libs lazy importiert,
damit das Modul ohne google-auth importierbar (testbar) bleibt.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_DIR = Path.home() / ".config" / "google-mcp"

# Account-Registry: short-name -> credentials filename (lokaler Dev).
ACCOUNTS = {
    "d.streuli@axs.aero": ".gdrive-write-credentials.json",
    "d.straus@axs.aero": ".gdrive-dstraus-credentials.json",
}

# DWD-freigegebene Schreib-Scopes (Drive/Docs).
DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
]


def _build_jwt_payload(sa_email, subject, scopes, now):
    """DWD-JWT-Claims: SA gibt sich als subject aus, 1h gueltig."""
    return {
        "iss": sa_email,
        "sub": subject,
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
        "scope": " ".join(scopes),
    }


def _dwd_credentials(sa_email, subject, scopes):
    """Keyless DWD via IAM-Credentials signJwt (kein JSON-Key). Basis-ADC
    (Cloud-Run-Metadata = Job-SA) signiert das JWT als sa_email -> Token als subject."""
    from google.auth import default
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    base, _ = default(scopes=["https://www.googleapis.com/auth/iam"])
    base.refresh(Request())
    payload = _build_jwt_payload(sa_email, subject, scopes, int(time.time()))
    sign_req = urllib.request.Request(
        f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa_email}:signJwt",
        data=json.dumps({"payload": json.dumps(payload)}).encode(),
        headers={"Authorization": f"Bearer {base.token}", "Content-Type": "application/json"},
    )
    signed = json.loads(urllib.request.urlopen(sign_req).read())["signedJwt"]
    tok_req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": signed,
        }).encode(),
    )
    token = json.loads(urllib.request.urlopen(tok_req).read())
    return Credentials(token["access_token"])


def _load_user_credentials(account):
    """Lokaler Dev-Pfad: User-OAuth aus ~/.config/google-mcp."""
    from google.oauth2.credentials import Credentials

    fname = ACCOUNTS.get(account)
    if not fname:
        raise ValueError(f"Unknown account '{account}'. Known: {list(ACCOUNTS)}")
    cred_path = CREDS_DIR / fname
    if not cred_path.exists():
        raise FileNotFoundError(
            f"OAuth credentials for {account} not found at {cred_path}. "
            f"Run: python3 ~/Chief/Tools/oauth_init.py {account}"
        )
    with open(cred_path) as f:
        creds_data = json.load(f)
    with open(CREDS_DIR / "gcp-oauth.keys.json") as f:
        keys = json.load(f)
    ci = keys.get("installed") or keys.get("web")
    return Credentials(
        token=creds_data.get("access_token") or creds_data.get("token"),
        refresh_token=creds_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=ci["client_id"],
        client_secret=ci["client_secret"],
        scopes=creds_data.get("scopes") or (creds_data.get("scope", "").split() or None),
    )


def load_credentials(account: str = "d.streuli@axs.aero", scopes=None, subject: str = None):
    """Server-seitig (RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT) keyless DWD
    als der Service-User; sonst lokaler User-OAuth fuer `account`.

    `subject` (Stufe 3, angemeldeter User): expliziter DWD-Impersonation-Subject, der
    `RUBICON_IMPERSONATE_SUBJECT` UEBERSCHREIBT — so handelt ein Server-Call im Kontext des
    eingeloggten Nutzers (z.B. seine persoenlichen Drive-Notizen) statt als `rubicon@`. Wirkt NUR
    im Server-Modus (DWD-Env gesetzt); lokal ohne DWD faellt es auf User-OAuth zurueck (Subject
    ignoriert). SICHERHEIT: der `subject` MUSS aus einer server-verifizierten Quelle stammen
    (IAP-Identitaet), NIE aus Client-Eingaben — sonst waere es Impersonation-Injection."""
    sa_email = os.environ.get("RUBICON_WORKSPACE_SA")
    eff_subject = subject or os.environ.get("RUBICON_IMPERSONATE_SUBJECT")
    if sa_email and eff_subject:
        return _dwd_credentials(sa_email, eff_subject, scopes or DEFAULT_SCOPES)
    return _load_user_credentials(account)
