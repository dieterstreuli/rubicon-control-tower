"""Serverseitige Google-Doc-Erzeugung im Shared Drive + PDF-Export (files.export).
Kein Chrome, kein Template, keine lokale Toolchain. Wiederverwendet md_to_gdoc's
Markdown->Docs-Builder. Logging fuer frueh sichtbare Fehler in Cloud-Run."""
import logging
import os
import sys
import time

log = logging.getLogger("rubicon.gdoc")

_TOOLS = os.path.dirname(os.path.abspath(__file__))
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)


def create_gdoc_in_folder(drive, name, folder_id):
    """Leeres Google Doc direkt im (Shared-Drive-)Ordner anlegen. Gibt doc_id zurueck."""
    log.info("create gdoc name=%s folder=%s", name, folder_id)
    _t = time.monotonic()
    f = drive.files().create(
        body={"name": name, "mimeType": "application/vnd.google-apps.document",
              "parents": [folder_id]},
        supportsAllDrives=True, fields="id",
    ).execute()
    doc_id = f["id"]
    log.info("created doc_id=%s create_ms=%d", doc_id, int((time.monotonic() - _t) * 1000))
    return doc_id


def build_doc_body(docs, doc_id, md_text):
    """Body aus Markdown bauen (reuse md_to_gdoc.parse_markdown + DocBuilder, AXS-gestylt)."""
    from md_to_gdoc import parse_markdown, DocBuilder
    from _templates import ensure_doc_body_empty
    ensure_doc_body_empty(docs, doc_id)
    b = DocBuilder(docs, doc_id)
    n = 0
    _t = time.monotonic()
    for kind, payload in parse_markdown(md_text):
        if kind == "table":
            b.add_table(payload)
        else:
            level = int(kind[1]) if kind.startswith("h") else 0
            b.add_text(payload, level)
        n += 1
    log.info("body built blocks=%d build_ms=%d docs_429=%d doc_id=%s",
              n, int((time.monotonic() - _t) * 1000), getattr(b, "_retry_429", 0), doc_id)


def export_gdoc_pdf(drive, doc_id):
    """Google Doc als PDF exportieren (files.export). Gibt PDF-Bytes zurueck; validiert Header."""
    log.info("export pdf doc_id=%s", doc_id)
    _t = time.monotonic()
    data = drive.files().export(fileId=doc_id, mimeType="application/pdf").execute()
    pdf = data if isinstance(data, (bytes, bytearray)) else bytes(data)
    if pdf[:4] != b"%PDF":
        raise ValueError(f"export lieferte kein PDF (doc_id={doc_id}, head={pdf[:8]!r})")
    log.info("exported pdf bytes=%d export_ms=%d doc_id=%s", len(pdf), int((time.monotonic() - _t) * 1000), doc_id)
    return bytes(pdf)


def upload_pdf_to_folder(drive, name, folder_id, pdf_bytes, file_id=None):
    """PDF-Bytes als Drive-Datei ablegen: update-in-place wenn file_id gegeben (stabile
    Datei + URL je Report), sonst neu im Ordner anlegen. Gibt die file_id zurueck."""
    from googleapiclient.http import MediaInMemoryUpload
    media = MediaInMemoryUpload(bytes(pdf_bytes), mimetype="application/pdf", resumable=False)
    if file_id:
        f = drive.files().update(fileId=file_id, media_body=media,
                                 supportsAllDrives=True, fields="id").execute()
    else:
        f = drive.files().create(body={"name": name, "parents": [folder_id],
                                       "mimeType": "application/pdf"},
                                 media_body=media, supportsAllDrives=True, fields="id").execute()
    fid = f["id"]
    log.info("uploaded pdf file_id=%s bytes=%d", fid, len(pdf_bytes))
    return fid
