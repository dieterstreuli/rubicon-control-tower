import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import html_to_pdf as h  # noqa: E402


def _tmp_html(text="<html><body>hallo</body></html>"):
    d = tempfile.mkdtemp()
    hp = Path(d) / "in.html"; hp.write_text(text)
    return hp, Path(d) / "out.pdf"


def test_routes_to_gotenberg_when_env_set():
    hp, pp = _tmp_html()
    seen = {}
    orig = h._render_via_gotenberg
    def fake(base, html_path, pdf_path, landscape, timeout):
        seen["base"] = base; seen["landscape"] = landscape
        Path(pdf_path).write_bytes(b"%PDF x"); return Path(pdf_path)
    h._render_via_gotenberg = fake
    os.environ["RUBICON_GOTENBERG_URL"] = "http://gotenberg:3000/"
    try:
        out = h.html_to_pdf(str(hp), str(pp), landscape=True)
    finally:
        h._render_via_gotenberg = orig
        del os.environ["RUBICON_GOTENBERG_URL"]
    assert seen["base"] == "http://gotenberg:3000"    # trailing slash gestrippt
    assert seen["landscape"] is True
    assert Path(out).read_bytes()[:4] == b"%PDF"


def test_render_via_gotenberg_multipart_and_write():
    import urllib.request
    hp, pp = _tmp_html("<html><body>x</body></html>")
    cap = {}
    class _Resp:
        def __enter__(s): return s
        def __exit__(s, *a): return False
        def read(s): return b"%PDF-1.7 xx"
    orig = urllib.request.urlopen
    def fake_urlopen(req, timeout=None):
        cap["url"] = req.full_url; cap["body"] = req.data
        cap["ctype"] = req.headers.get("Content-type")
        return _Resp()
    urllib.request.urlopen = fake_urlopen
    try:
        out = h._render_via_gotenberg("http://g:3000", hp, pp, True, 60)
    finally:
        urllib.request.urlopen = orig
    assert Path(out).read_bytes()[:4] == b"%PDF"
    assert cap["url"].endswith("/forms/chromium/convert/html")
    assert cap["ctype"].startswith("multipart/form-data; boundary=")
    body = cap["body"]
    assert b'filename="index.html"' in body
    assert b'name="files"' in body
    assert b'name="preferCssPageSize"' in body and b"true" in body
    assert b'name="landscape"' in body


def test_gotenberg_non_pdf_raises():
    import urllib.request
    hp, pp = _tmp_html()
    class _Resp:
        def __enter__(s): return s
        def __exit__(s, *a): return False
        def read(s): return b"<html>error"
    orig = urllib.request.urlopen
    urllib.request.urlopen = lambda req, timeout=None: _Resp()
    try:
        try:
            h._render_via_gotenberg("http://g:3000", hp, pp, False, 60)
            assert False, "sollte RuntimeError werfen"
        except RuntimeError:
            pass
    finally:
        urllib.request.urlopen = orig


if __name__ == "__main__":
    test_routes_to_gotenberg_when_env_set()
    test_render_via_gotenberg_multipart_and_write()
    test_gotenberg_non_pdf_raises()
    print("html_to_pdf: 3/3 gruen")
