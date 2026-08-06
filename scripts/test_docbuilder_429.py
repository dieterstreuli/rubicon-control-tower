import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import md_to_gdoc as m  # noqa: E402


class _Resp:
    def __init__(self, status): self.status = status


class _FakeHttpError(Exception):
    def __init__(self, status): self.resp = _Resp(status)


class _Req:
    def __init__(self, api): self.api = api
    def execute(self):
        self.api.n += 1
        if self.api.n == 1:
            raise m.HttpError(429)
        return {"ok": True}


class _DocsApi:
    def __init__(self): self.n = 0
    def documents(self): return self
    def batchUpdate(self, documentId=None, body=None): return _Req(self)


def test_retry_429_counts_and_recovers():
    m.HttpError = _FakeHttpError          # bu() faengt diesen Namen
    m.time.sleep = lambda *a, **k: None   # keine 22s im Test
    b = m.DocBuilder(_DocsApi(), "DOC")
    out = b.bu([{"x": 1}])
    assert out == {"ok": True}
    assert b._retry_429 == 1, b._retry_429


if __name__ == "__main__":
    test_retry_429_counts_and_recovers()
    print("docbuilder 429: 1/1 gruen")
