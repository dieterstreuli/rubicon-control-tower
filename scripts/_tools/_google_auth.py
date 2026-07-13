"""Shared Google OAuth credential loader for Chief Tools."""
import json
from pathlib import Path
from google.oauth2.credentials import Credentials

CREDS_DIR = Path.home() / ".config" / "google-mcp"

# Account-Registry: short-name → credentials filename
# Hinweis: commercial@axs.aero ist eine Group/Alias, kein eigener Account.
# Der User d.straus@axs.aero hat Zugriff und wird als Operator-Account verwendet.
ACCOUNTS = {
    "d.streuli@axs.aero":  ".gdrive-write-credentials.json",
    "d.straus@axs.aero":   ".gdrive-dstraus-credentials.json",
}


def load_credentials(account: str = "d.streuli@axs.aero"):
    """Load OAuth credentials for the given account (default d.streuli@axs.aero)."""
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
