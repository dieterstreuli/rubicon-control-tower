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
    orig_tok = h._gotenberg_id_token
    def fake_urlopen(req, timeout=None):
        cap["url"] = req.full_url; cap["body"] = req.data
        cap["ctype"] = req.headers.get("Content-type")
        return _Resp()
    urllib.request.urlopen = fake_urlopen
    h._gotenberg_id_token = lambda a: None   # kein Metadata-Server -> kein Auth-Header
    try:
        out = h._render_via_gotenberg("http://g:3000", hp, pp, True, 60)
    finally:
        urllib.request.urlopen = orig
        h._gotenberg_id_token = orig_tok
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
    orig_tok = h._gotenberg_id_token
    urllib.request.urlopen = lambda req, timeout=None: _Resp()
    h._gotenberg_id_token = lambda a: None   # kein Metadata-Server -> kein Auth-Header
    try:
        try:
            h._render_via_gotenberg("http://g:3000", hp, pp, False, 60)
            assert False, "sollte RuntimeError werfen"
        except RuntimeError:
            pass
    finally:
        urllib.request.urlopen = orig
        h._gotenberg_id_token = orig_tok


def test_render_retries_on_5xx():
    """1. Versuch 503 (Cold-Start), 2. Versuch liefert %PDF -> Erfolg nach genau 2 Calls."""
    import urllib.request, urllib.error, time
    hp, pp = _tmp_html()
    calls = {"n": 0}
    class _Resp:
        def __enter__(s): return s
        def __exit__(s, *a): return False
        def read(s): return b"%PDF-1.7 ok"
    def fake_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(url="http://x", code=503, msg="x", hdrs=None, fp=None)
        return _Resp()
    orig = urllib.request.urlopen
    orig_tok = h._gotenberg_id_token
    orig_sleep = time.sleep
    urllib.request.urlopen = fake_urlopen
    h._gotenberg_id_token = lambda a: None   # kein Metadata-Server -> kein Auth-Header
    time.sleep = lambda *a: None             # Backoff nicht wirklich schlafen
    try:
        out = h._render_via_gotenberg("http://g:3000", hp, pp, False, 60)
    finally:
        urllib.request.urlopen = orig
        h._gotenberg_id_token = orig_tok
        time.sleep = orig_sleep
    assert Path(out).read_bytes()[:4] == b"%PDF"
    assert calls["n"] == 2                     # 1x 503 (retry) + 1x Erfolg


if __name__ == "__main__":
    test_routes_to_gotenberg_when_env_set()
    test_render_via_gotenberg_multipart_and_write()
    test_gotenberg_non_pdf_raises()
    test_render_retries_on_5xx()
    print("html_to_pdf: 4/4 gruen")
