import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import gdoc_pdf  # noqa: E402


class _Exec:
    def __init__(self, ret): self._ret = ret
    def execute(self): return self._ret


class _Files:
    def __init__(self): self.created = None; self.exported = None
    def create(self, body=None, supportsAllDrives=None, fields=None):
        self.created = {"body": body, "supportsAllDrives": supportsAllDrives}
        return _Exec({"id": "DOC123"})
    def export(self, fileId=None, mimeType=None):
        self.exported = {"fileId": fileId, "mimeType": mimeType}
        return _Exec(b"%PDF-1.7 fake")


class _Drive:
    def __init__(self, files=None): self._f = files or _Files()
    def files(self): return self._f


def test_create_gdoc_in_folder():
    d = _Drive()
    doc_id = gdoc_pdf.create_gdoc_in_folder(d, "R", "FOLDER1")
    assert doc_id == "DOC123"
    assert d._f.created["body"]["parents"] == ["FOLDER1"]
    assert d._f.created["body"]["mimeType"] == "application/vnd.google-apps.document"
    assert d._f.created["supportsAllDrives"] is True


def test_export_gdoc_pdf_ok():
    d = _Drive()
    pdf = gdoc_pdf.export_gdoc_pdf(d, "DOC123")
    assert pdf[:4] == b"%PDF"
    assert d._f.exported == {"fileId": "DOC123", "mimeType": "application/pdf"}


def test_export_rejects_nonpdf():
    class _Bad(_Files):
        def export(self, fileId=None, mimeType=None): return _Exec(b"<html>nope")
    d = _Drive(files=_Bad())
    try:
        gdoc_pdf.export_gdoc_pdf(d, "X")
        assert False, "sollte ValueError werfen"
    except ValueError:
        pass


if __name__ == "__main__":
    test_create_gdoc_in_folder()
    test_export_gdoc_pdf_ok()
    test_export_rejects_nonpdf()
    print("gdoc_pdf: 3/3 gruen")
