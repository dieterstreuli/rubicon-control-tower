import json, os
import logging
from pathlib import Path
_CFG = Path(__file__).parent / "rubicon_templates.json"

log = logging.getLogger("rubicon.docmat")

def template_id(typ):
    env = os.environ.get(f"RUBICON_TEMPLATE_{typ.upper()}")
    if env:
        return env
    return json.loads(_CFG.read_text())[typ]


def _render(drive, docs, template_id, folder_id, name, values, tables, bullets):
    import doc_template as dt
    return dt.render_doc_and_pdf(drive, docs, template_id, folder_id, name, values, tables, bullets)


def _upload(drive, name, folder_id, pdf_bytes, file_id):
    import gdoc_pdf
    return gdoc_pdf.upload_pdf_to_folder(drive, name, folder_id, pdf_bytes, file_id)


def materialize(drive, docs, *, template_id, name, folder_id, values,
                tables=None, bullets=None, prev_doc_id=None, prev_pdf_id=None):
    """Rendert ein gebrandetes Doc (bleibt) + PDF, laedt das PDF hoch (update-in-place bei
    prev_pdf_id) und trasht das vorherige Doc. Upload und Trash-Prev sind NON-FATAL — das
    Volume-PDF bleibt der eigentliche Auslieferweg, ein Fehler hier darf materialize() nicht
    kippen."""
    doc_id, pdf = _render(drive, docs, template_id, folder_id, name, values, tables, bullets)
    pdf_id = None
    try:
        pdf_id = _upload(drive, name if name.endswith(".pdf") else name + ".pdf", folder_id, pdf, prev_pdf_id)
    except Exception as ex:  # noqa: BLE001 — Upload non-fatal, Volume-PDF bleibt der Weg
        log.warning("pdf upload fehlgeschlagen folder=%s: %s", folder_id, ex)
    if prev_doc_id and prev_doc_id != doc_id:
        try:
            drive.files().update(fileId=prev_doc_id, body={"trashed": True}, supportsAllDrives=True,
                                 fields="id").execute()
        except Exception as ex:  # noqa: BLE001
            log.warning("trash prev doc_id=%s fehlgeschlagen: %s", prev_doc_id, ex)
    return {"doc_id": doc_id, "doc_url": f"https://docs.google.com/document/d/{doc_id}/edit",
            "pdf_id": pdf_id, "pdf_url": (f"https://drive.google.com/file/d/{pdf_id}/view" if pdf_id else None),
            "pdf_bytes": pdf}
