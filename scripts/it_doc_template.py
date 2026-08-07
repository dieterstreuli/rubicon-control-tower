"""Callable Integrations-Test: rendert den ersten Entscheid aus entscheide.json gegen
die Entscheid-Vorlage -> PDF und verifiziert den %PDF-Header. Beweist die Vorlagen-Engine
(doc_template) live gegen Drive/Docs.

Braucht Bot-Creds (keyless-DWD, s. _google_auth) + eine Vorlage:
  RUBICON_WORKSPACE_SA + RUBICON_IMPERSONATE_SUBJECT   (DWD)
  RUBICON_ENTSCHEID_TEMPLATE_ID                        (Doc-ID der Entscheid-Vorlage)
  RUBICON_DRIVE_ENTSCHEIDE_FOLDER  (optional; Default = Endprodukt-Ordner entscheide)

Aufruf (lokal, mit temporaerem signJwt-Recht, s. DEPLOYMENT_GCP.md §9.5):
  RUBICON_WORKSPACE_SA=… RUBICON_IMPERSONATE_SUBJECT=rubicon@axs.aero \
  RUBICON_ENTSCHEID_TEMPLATE_ID=… <venv>/python3 scripts/it_doc_template.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
from _google_auth import load_credentials  # noqa: E402
from googleapiclient.discovery import build  # noqa: E402
import doc_template as dt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_ID = os.environ["RUBICON_ENTSCHEID_TEMPLATE_ID"]
ENTSCHEIDE_FOLDER = os.environ.get("RUBICON_DRIVE_ENTSCHEIDE_FOLDER",
                                   "1wI2ggCw3erqeQ3HW2bcKxk4rg-zKo0rb")


def entscheid_values(e):
    """Register-Eintrag -> Vorlagen-Platzhalter (Feld-Vertrag der Entscheid-Vorlage)."""
    return {
        "REGISTER_ID": e.get("id"), "TITEL": e.get("titel"), "BESCHLUSS": e.get("entscheid"),
        "TYP": e.get("typ"), "GREMIUM": e.get("gremium"), "ANTRAGSTELLER": e.get("antragsteller"),
        "DATUM": e.get("datum"), "STATUS": e.get("status"), "BEGRUENDUNG": e.get("begruendung"),
        "DATENGRUNDLAGE": e.get("datengrundlage"),
        "QUELLE": e.get("quelle") or "direkte Register-Erfassung",
    }


def main():
    creds = load_credentials()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    docs = build("docs", "v1", credentials=creds, cache_discovery=False)
    e = json.load(open(os.path.join(ROOT, "src/data/entscheide.json")))["entscheide"][0]
    pdf = dt.render_pdf_from_template(drive, docs, TEMPLATE_ID, ENTSCHEIDE_FOLDER,
                                      f"{e['id']}.pdf", entscheid_values(e))
    assert pdf[:4] == b"%PDF", pdf[:8]
    print(f"doc_template IT: {e['id']} -> {len(pdf)} bytes PDF OK")


if __name__ == "__main__":
    main()
