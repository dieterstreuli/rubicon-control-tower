"""Shared helpers for creating new Google Docs/Sheets from AXS templates."""
import json
from pathlib import Path
from googleapiclient.discovery import build

TEMPLATES_CONFIG = Path(__file__).parent / "chief_templates.json"

# --- AXS Doc-Style-Master (verbindlich, DRS-Freigabe 23.06.2026) -------------
# Einheitliches Format für ALLE neu erstellten Google Docs. Google Docs erlaubt
# kein Umdefinieren benannter Heading-Stile via API → daher hier als Konstanten,
# die der Build-Code beim Einfügen pro Absatz/Tabelle anwendet.
AXS_BLUE = {"red": 0x1E / 255, "green": 0x3E / 255, "blue": 0x58 / 255}  # #1E3E58
AXS_STYLE = {
    "font": "Arial",
    "body_pt": 11,          # Fliesstext: Arial 11pt schwarz
    "h1_pt": 16,            # Titel: Arial 16pt fett, AXS-Blau
    "h2_pt": 13,            # Sektion: Arial 13pt fett, AXS-Blau
    "h3_pt": 11,            # Untertitel: Arial 11pt fett, schwarz
    "accent_rgb": AXS_BLUE,
    "table_header_fill": AXS_BLUE,   # Tabellen-Kopf: #1E3E58, Text weiss fett
    "table_header_text_white": True,
    "thousands_sep": "'",  # Apostroph: 10'359
    "no_bullets": True,    # keine •-Bullets, keine 1.2.3.-Nummerierung im Fliesstext
}


def heading_text_style(level):
    """TextStyle-dict für eine Überschrift gemäss AXS-Style-Master.
    level: 1 (Titel), 2 (Sektion), 3 (Untertitel)."""
    pt = {1: AXS_STYLE["h1_pt"], 2: AXS_STYLE["h2_pt"], 3: AXS_STYLE["h3_pt"]}[level]
    ts = {
        "bold": True,
        "weightedFontFamily": {"fontFamily": AXS_STYLE["font"], "weight": 700},
        "fontSize": {"magnitude": pt, "unit": "PT"},
    }
    if level in (1, 2):  # H1/H2 in AXS-Blau, H3 bleibt schwarz
        ts["foregroundColor"] = {"color": {"rgbColor": AXS_STYLE["accent_rgb"]}}
    return ts


def body_text_style():
    """TextStyle-dict für Fliesstext: Arial 11pt, schwarz."""
    return {
        "weightedFontFamily": {"fontFamily": AXS_STYLE["font"], "weight": 400},
        "fontSize": {"magnitude": AXS_STYLE["body_pt"], "unit": "PT"},
    }


def load_templates():
    return json.loads(TEMPLATES_CONFIG.read_text())


def default_doc_template_id():
    return load_templates()["doc_axs_standard"]["id"]


def create_doc_from_template(drive, name, parent_folder_id,
                             template_id=None):
    """Copy the AXS standard Doc template into `parent_folder_id` with the
    given `name`. Returns the full Drive file metadata (id, name, webViewLink,
    parents)."""
    if template_id is None:
        template_id = default_doc_template_id()
    f = drive.files().copy(
        fileId=template_id,
        body={"name": name, "parents": [parent_folder_id]},
        fields="id,name,webViewLink,parents,mimeType",
    ).execute()
    return f


def ensure_doc_body_empty(docs, doc_id):
    """Clear the main body of a Google Doc (preserving template header/footer/styles).
    Template title content is deleted; new content can then be inserted from index 1."""
    doc = docs.documents().get(documentId=doc_id).execute()
    content = doc.get("body", {}).get("content", [])
    if not content:
        return
    end_index = content[-1].get("endIndex", 1)
    if end_index > 2:
        docs.documents().batchUpdate(
            documentId=doc_id,
            body={"requests": [{
                "deleteContentRange": {
                    "range": {"startIndex": 1, "endIndex": end_index - 1}
                }
            }]},
        ).execute()
