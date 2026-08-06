"""Integrationstest: erzeugt mit DWD-Env einen echten Report-Doc im Shared-Drive-Ordner
+ PDF-Export, prueft %PDF+Groesse, raeumt auf. Aufruf:
  RUBICON_WORKSPACE_SA=... RUBICON_IMPERSONATE_SUBJECT=... RUBICON_DRIVE_REPORTS_FOLDER=... \
  python3 scripts/it_gen_report_server.py
Basis-ADC muss signJwt auf den SA duerfen (Cloud Run: Job-SA; lokal: tokenCreator)."""
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))

from googleapiclient.discovery import build  # noqa: E402
from _google_auth import load_credentials  # noqa: E402
import gdoc_pdf  # noqa: E402

folder = os.environ["RUBICON_DRIVE_REPORTS_FOLDER"]
creds = load_credentials()
drive = build("drive", "v3", credentials=creds)
docs = build("docs", "v1", credentials=creds)
doc_id = gdoc_pdf.create_gdoc_in_folder(drive, "_it_report", folder)
try:
    gdoc_pdf.build_doc_body(docs, doc_id, "# IT Report\n\nZeile eins.\n\n## Sektion\n\nText.\n")
    pdf = gdoc_pdf.export_gdoc_pdf(drive, doc_id)
    ok = pdf[:4] == b"%PDF" and len(pdf) > 500
    print(f"IT {'PASS' if ok else 'FAIL'} — pdf_bytes={len(pdf)}")
finally:
    drive.files().delete(fileId=doc_id, supportsAllDrives=True).execute()
    print("cleanup: doc geloescht")
sys.exit(0 if ok else 1)
