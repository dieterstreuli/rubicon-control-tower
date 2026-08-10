import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import doc_materialize as dm

def test_template_id_from_config():
    # Gegen die Config pruefen (nicht gegen eine hartkodierte ID) — IDs aendern sich bei
    # Vorlagen-Rebuild. Zusaetzlich: die Report-Typen (woche/monat/vr) sind registriert.
    import json
    from pathlib import Path
    cfg = json.loads((Path(dm.__file__).parent / "rubicon_templates.json").read_text())
    assert dm.template_id("traktanden") == cfg["traktanden"]
    for typ in ("woche", "monat", "vr", "entscheide", "briefings", "fuehrungsrhythmus"):
        assert dm.template_id(typ) == cfg[typ] and cfg[typ]

def test_template_id_env_override(monkeypatch=None):
    os.environ["RUBICON_TEMPLATE_ENTSCHEIDE"] = "OVERRIDE-1"
    try:
        assert dm.template_id("entscheide") == "OVERRIDE-1"
    finally:
        del os.environ["RUBICON_TEMPLATE_ENTSCHEIDE"]

class _FakeDrive:
    def __init__(self): self.trashed = []; self.uploaded = None
    def files(self): return self
    def update(self, fileId=None, body=None, supportsAllDrives=None, fields=None, media_body=None):
        if body and body.get("trashed"): self.trashed.append(fileId)
        class E:
            def execute(s): return {"id": fileId}
        return E()

def test_materialize_renders_uploads_and_trashes_prev(monkeypatch=None):
    dm._render = lambda *a, **k: ("DOC-NEW", b"%PDF-1.4 x")   # Stub render_doc_and_pdf
    dm._upload = lambda *a, **k: "PDF-NEW"                     # Stub upload_pdf_to_folder
    drv = _FakeDrive()
    out = dm.materialize(drv, None, template_id="T", name="n", folder_id="F",
                         values={"A": "b"}, prev_doc_id="DOC-OLD", prev_pdf_id="PDF-OLD")
    assert out["doc_id"] == "DOC-NEW" and out["pdf_id"] == "PDF-NEW"
    assert out["doc_url"].endswith("/DOC-NEW/edit")
    assert out["pdf_bytes"][:4] == b"%PDF"
    assert "DOC-OLD" in drv.trashed        # vorheriges Doc getrasht

if __name__ == "__main__":
    test_template_id_from_config(); test_template_id_env_override()
    test_materialize_renders_uploads_and_trashes_prev()
    print("doc_materialize: 3/3 gruen")
