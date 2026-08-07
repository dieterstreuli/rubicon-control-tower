import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import doc_template as dt  # noqa: E402


class _Exec:
    def __init__(self, ret): self._ret = ret
    def execute(self): return self._ret


class _Docs:
    def __init__(self, doc_text="{{REGISTER_ID}} — {{TITEL}}\n"):
        self.batched = None; self._doc_text = doc_text
    def documents(self): return self
    def get(self, documentId=None):
        return _Exec({"revisionId": "rev-1", "body": {"content": [
            {"paragraph": {"elements": [{"textRun": {"content": self._doc_text}}]}}]}})
    def batchUpdate(self, documentId=None, body=None):
        self.batched = {"id": documentId, "requests": body["requests"],
                        "writeControl": body.get("writeControl")}
        return _Exec({})


class _Drive:
    def __init__(self, pdf=b"%PDF-1.7 x"):
        self.copied = None; self.exported = None; self.deleted = None; self._pdf = pdf
    def files(self): return self
    def copy(self, fileId=None, body=None, supportsAllDrives=None, fields=None):
        self.copied = {"fileId": fileId, "body": body, "sad": supportsAllDrives}
        return _Exec({"id": "COPY-1"})
    def export(self, fileId=None, mimeType=None):
        self.exported = {"fileId": fileId, "mimeType": mimeType}
        return _Exec(self._pdf)
    def delete(self, fileId=None, supportsAllDrives=None):
        self.deleted = fileId
        return _Exec({})


def test_build_replace_requests():
    reqs = dt.build_replace_requests({"REGISTER_ID": "E-1", "STATUS": None, "N": 3})
    by_text = {r["replaceAllText"]["containsText"]["text"]: r["replaceAllText"]["replaceText"] for r in reqs}
    assert by_text["{{REGISTER_ID}}"] == "E-1"
    assert by_text["{{STATUS}}"] == ""            # None -> leerer String, kein 'None'
    assert by_text["{{N}}"] == "3"                # nicht-String -> str()
    assert all(r["replaceAllText"]["containsText"]["matchCase"] is True for r in reqs)


def test_render_copies_fills_exports_and_cleans():
    d = _Drive(); docs = _Docs()
    pdf = dt.render_pdf_from_template(d, docs, "TPL-1", "FOLDER-1", "E-2026-001.pdf",
                                      {"REGISTER_ID": "E-2026-001", "TITEL": "Kompetenzordnung"})
    assert pdf[:4] == b"%PDF"
    assert d.copied["fileId"] == "TPL-1"          # aus der Vorlage kopiert
    assert d.copied["body"]["parents"] == ["FOLDER-1"]
    assert d.copied["sad"] is True
    assert docs.batched["id"] == "COPY-1"         # Platzhalter im KOPIERTEN Doc gefuellt
    assert len(docs.batched["requests"]) == 2
    assert d.exported == {"fileId": "COPY-1", "mimeType": "application/pdf"}
    assert d.deleted == "COPY-1"                  # Zwischen-Doc getrasht


def test_render_rejects_nonpdf_but_still_cleans():
    d = _Drive(pdf=b"<html>nope"); docs = _Docs()
    try:
        dt.render_pdf_from_template(d, docs, "TPL-1", "FOLDER-1", "x.pdf", {"A": "b"})
        assert False, "sollte ValueError werfen"
    except ValueError:
        pass
    assert d.deleted == "COPY-1"                  # Cleanup auch im Fehlerfall


def test_render_trashes_when_export_api_fails():
    class _DErr(_Drive):
        def export(self, fileId=None, mimeType=None):
            raise RuntimeError("api 500")
    d = _DErr(); docs = _Docs()
    try:
        dt.render_pdf_from_template(d, docs, "TPL-1", "F", "x.pdf", {"A": "b"})
        assert False, "sollte werfen"
    except RuntimeError:
        pass
    assert d.deleted == "COPY-1"   # Cleanup auch bei Nicht-ValueError-Post-Copy-Fehler


def test_render_doc_and_pdf_keeps_doc():
    d = _Drive(); docs = _Docs()
    doc_id, pdf = dt.render_doc_and_pdf(d, docs, "TPL-1", "F", "x.pdf", {"REGISTER_ID": "E-1", "TITEL": "T"})
    assert doc_id == "COPY-1"          # Doc-ID zurueckgegeben
    assert pdf[:4] == b"%PDF"
    assert d.deleted is None           # Doc NICHT getrasht (Kontrast zu render_pdf_from_template)


def test_build_grid_normal_and_group_rows():
    header = ["Meeting", "Wann", "Zweck"]
    rows = [
        {"group": "Alle 2 Wochen", "bg": {"red": 1, "green": 1, "blue": 1}, "text_rgb": {"red": 0, "green": 0, "blue": 0}},
        ["Steuerung", "Mo", "Takt"],
        ["Review", None, "Rueckblick"],
    ]
    grid, groups = dt._build_grid(header, rows)
    assert grid[0] == header
    assert grid[1] == ["Alle 2 Wochen", "", ""]   # Gruppen-Label in Spalte 0, Rest leer
    assert grid[2] == ["Steuerung", "Mo", "Takt"]
    assert grid[3] == ["Review", "", "Rueckblick"]  # None -> "" (kein rohes 'None')
    assert set(groups.keys()) == {1}                # nur Zeile 1 ist eine Gruppen-Bandzeile
    assert groups[1]["bg"] == {"red": 1, "green": 1, "blue": 1}


class _DocsBullets:
    """Fake: get() liefert ein Doc (mit revisionId fuer den Riegel-Check) samt Anker-Paragraph;
    sammelt Requests je Aufruf in `calls` und das writeControl parallel in `controls`."""
    def __init__(self, anchor, idx=5):
        self._anchor, self._idx = anchor, idx
        self.calls = []; self.controls = []
    def documents(self): return self
    def get(self, documentId=None): return _Exec({"revisionId": "rev-b", "body": {"content": [
        {"startIndex": self._idx, "endIndex": self._idx + len(self._anchor) + 1,
         "paragraph": {"elements": [{"textRun": {"content": self._anchor + "\n"}}]}}]}})
    def batchUpdate(self, documentId=None, body=None):
        self.calls.append(body["requests"]); self.controls.append(body.get("writeControl"))
        return _Exec({})


def test_insert_bullets_inserts_lists_and_removes_anchor():
    docs = _DocsBullets("{{BODY}}", idx=5)
    dt.insert_bullets_at_anchor(docs, "D", "{{BODY}}", ["Alpha", "", "  ", "Beta"])
    flat = [r for call in docs.calls for r in call]
    ins = next(r for r in flat if "insertText" in r)
    assert ins["insertText"]["text"] == "Alpha\nBeta\n"     # leere/Whitespace-items raus
    assert ins["insertText"]["location"]["index"] == 5
    bul = next(r for r in flat if "createParagraphBullets" in r)
    assert bul["createParagraphBullets"]["range"] == {"startIndex": 5, "endIndex": 5 + len("Alpha\nBeta\n")}
    assert any("replaceAllText" in r and r["replaceAllText"]["containsText"]["text"] == "{{BODY}}" for r in flat)


def test_insert_bullets_empty_just_removes_anchor():
    docs = _DocsBullets("{{BODY}}")
    dt.insert_bullets_at_anchor(docs, "D", "{{BODY}}", [])
    flat = [r for call in docs.calls for r in call]
    assert all("insertText" not in r for r in flat)   # keine leere Liste eingefuegt
    assert flat and "replaceAllText" in flat[0]        # nur der Anker entfernt


def test_insert_bullets_single_batch_and_defers_anchor():
    # Buendelung: insertText + createParagraphBullets in EINEM batchUpdate (war 2 Round-Trips);
    # remove_anchor=False laesst den Anker fuer den Treiber-Sweep stehen.
    docs = _DocsBullets("{{BODY}}", idx=5)
    dt.insert_bullets_at_anchor(docs, "D", "{{BODY}}", ["Alpha", "Beta"], remove_anchor=False)
    assert len(docs.calls) == 1                        # genau EIN batchUpdate
    reqs = docs.calls[0]
    assert any("insertText" in r for r in reqs)
    assert any("createParagraphBullets" in r for r in reqs)
    assert not any("replaceAllText" in r for r in reqs)  # Anker deferred (kein Cleanup hier)
    assert docs.controls[0] == {"requiredRevisionId": "rev-b"}  # nicht-idempotenter Insert unter Riegel


class _DocsMultiBullets:
    """get() liefert EIN Doc mit mehreren Anker-Paragraphen (anchor->startIndex); sammelt Batches."""
    def __init__(self, anchors_idx):
        self._a = anchors_idx
        self.calls = []; self.controls = []
    def documents(self): return self
    def get(self, documentId=None):
        content = [{"startIndex": idx, "endIndex": idx + len(a) + 1,
                    "paragraph": {"elements": [{"textRun": {"content": a + "\n"}}]}}
                   for a, idx in self._a.items()]
        return _Exec({"revisionId": "rev-m", "body": {"content": content}})
    def batchUpdate(self, documentId=None, body=None):
        self.calls.append(body["requests"]); self.controls.append(body.get("writeControl"))
        return _Exec({})


def test_insert_bullets_multi_one_batch_descending():
    # Mehrere Bullet-Anker in EINEM Batch, (insertText+bullets)-Paare ABSTEIGEND nach Index.
    docs = _DocsMultiBullets({"{{A}}": 10, "{{B}}": 50})
    dt.insert_bullets_at_anchors(docs, "D",
                                 {"{{A}}": ["a1", "a2"], "{{B}}": {"items": ["b1"], "ordered": True}},
                                 remove_anchor=False)
    assert len(docs.calls) == 1                          # EIN batchUpdate fuer beide Anker
    reqs = docs.calls[0]
    inserts = [r for r in reqs if "insertText" in r]
    assert [r["insertText"]["location"]["index"] for r in inserts] == [50, 10]  # absteigend
    assert len([r for r in reqs if "createParagraphBullets" in r]) == 2
    # Ordered-Flag von B respektiert (NUMBERED preset), A disc (BULLET preset).
    presets = [r["createParagraphBullets"]["bulletPreset"] for r in reqs if "createParagraphBullets" in r]
    assert presets[0].startswith("NUMBERED")            # B (idx 50) zuerst, ordered=True
    assert presets[1].startswith("BULLET")              # A (idx 10), ordered=False
    assert not any("replaceAllText" in r for r in reqs)  # Anker deferred
    assert docs.controls[0] == {"requiredRevisionId": "rev-m"}  # rev-Riegel


def test_pace_write_throttles_over_limit():
    # Pacing: unter _MAX_WRITES_PER_MIN kein Sleep; der erste darueber muss drosseln.
    import time as _t
    dt._WRITE_TIMES.clear()
    clock = [0.0]; slept = []
    orig_mono, orig_sleep = _t.monotonic, _t.sleep
    _t.monotonic = lambda: clock[0]
    _t.sleep = lambda s: (slept.append(s), clock.__setitem__(0, clock[0] + s))
    try:
        for _ in range(dt._MAX_WRITES_PER_MIN):
            dt._pace_write()
        assert slept == []                              # Fenster voll, aber noch nicht drueber
        dt._pace_write()                                # einer zu viel -> Drosselung
        assert slept and slept[0] > 0
    finally:
        _t.monotonic, _t.sleep = orig_mono, orig_sleep
        dt._WRITE_TIMES.clear()


# ── Tabellen-Pfad (get() liefert nacheinander: Anker-Doc -> Tabellen-Doc) ─────
_ANCHOR_DOC = {"revisionId": "rev-0", "body": {"content": [
    {"startIndex": 1, "paragraph": {"elements": [{"textRun": {"content": "{{TAB}}\n"}}]}}]}}
_TABLE_DOC = {"revisionId": "rev-1", "body": {"content": [
    {"startIndex": 1, "table": {"tableRows": [
        {"tableCells": [{"content": [{"startIndex": 3, "paragraph": {"elements": []}}]},
                        {"content": [{"startIndex": 5, "paragraph": {"elements": []}}]}]},
        {"tableCells": [{"content": [{"startIndex": 7, "paragraph": {"elements": []}}]},
                        {"content": [{"startIndex": 9, "paragraph": {"elements": []}}]}]},
    ]}},
    {"startIndex": 20, "paragraph": {"elements": [{"textRun": {"content": "{{TAB}}\n"}}]}}]}}


class _DocsTable:
    """Fake: get() liefert nacheinander die gecannten Doc-Zustaende; batchUpdate sammelt
    Requests + writeControl je Aufruf."""
    def __init__(self, gets):
        self._gets, self._gi = list(gets), 0
        self.calls = []   # [{"requests": [...], "writeControl": {...}|None}, ...]
    def documents(self): return self
    def get(self, documentId=None):
        g = self._gets[min(self._gi, len(self._gets) - 1)]; self._gi += 1
        return _Exec(g)
    def batchUpdate(self, documentId=None, body=None):
        self.calls.append({"requests": body["requests"], "writeControl": body.get("writeControl")})
        return _Exec({})


def test_insert_table_merges_fill_and_style_and_defers_anchor():
    docs = _DocsTable([_ANCHOR_DOC, _TABLE_DOC])
    dt.insert_table_at_anchor(docs, "D", "{{TAB}}", ["H1", "H2"], [["a", "b"]],
                              col_widths_pt=[100, 100], remove_anchor=False)
    # Batch 0 = insertTable (rev-0-Riegel); Batch 1 = Zellen-Fill + Spalten-Styling in EINEM
    # rev-1-Batch (frueher separater Style-Batch). Kein Anker-Batch (deferred).
    assert len(docs.calls) == 2
    assert any("insertTable" in r for r in docs.calls[0]["requests"])
    assert docs.calls[0]["writeControl"] == {"requiredRevisionId": "rev-0"}
    b_fill = docs.calls[1]["requests"]
    assert any("insertText" in r for r in b_fill)                    # Zellen gefuellt
    assert any("updateTableColumnProperties" in r for r in b_fill)   # Styling IM Fill-Batch
    assert docs.calls[1]["writeControl"] == {"requiredRevisionId": "rev-1"}
    assert not any("replaceAllText" in r for c in docs.calls for r in c["requests"])  # deferred


def test_insert_table_removes_anchor_when_requested():
    docs = _DocsTable([_ANCHOR_DOC, _TABLE_DOC])
    dt.insert_table_at_anchor(docs, "D", "{{TAB}}", ["H1", "H2"], [["a", "b"]], remove_anchor=True)
    last = docs.calls[-1]["requests"]
    assert len(last) == 1 and "replaceAllText" in last[0]
    assert last[0]["replaceAllText"]["containsText"]["text"] == "{{TAB}}"


def test_copy_fill_export_bundles_anchor_sweep():
    # Treiber ruft insert_* mit remove_anchor=False und wischt danach ALLE Anker in EINEM
    # Sweep-Batch. insert_* hier durch No-Ops ersetzt -> nur der Sweep bleibt beobachtbar.
    orig_tab, orig_bul = dt.insert_table_at_anchor, dt.insert_bullets_at_anchors
    dt.insert_table_at_anchor = lambda *a, **k: None
    dt.insert_bullets_at_anchors = lambda *a, **k: None   # Treiber nutzt die Multi-Variante
    try:
        d = _Drive(); docs = _Docs(doc_text="{{AG}} {{BODY}} {{FLD}}\n")
        dt._copy_fill_export(d, docs, "TPL", "F", "n", {"FLD": "x"},
                             {"{{AG}}": {"header": ["H"], "rows": [["a"]]}},
                             {"{{BODY}}": ["i1"]})
        reqs = docs.batched["requests"]              # letzter batchUpdate = Sweep
        toks = {r["replaceAllText"]["containsText"]["text"] for r in reqs if "replaceAllText" in r}
        assert toks == {"{{AG}}", "{{BODY}}"}        # beide Anker in EINEM Sweep-Batch
    finally:
        dt.insert_table_at_anchor, dt.insert_bullets_at_anchors = orig_tab, orig_bul


def test_apply_modifiers():
    vals = {"T": "kompetenz", "S": "", "G": None, "VR": "Verwaltungsrat", "L": ["a", "b", "c"], "N": "7"}

    def r(key, mods):
        return dt.apply_modifiers(vals.get(key), dt._parse_mods(mods), vals)
    assert r("T", ":upper") == "KOMPETENZ"
    assert r("S", ":default(offen)") == "offen"        # leer -> default
    assert r("G", ":or(VR)") == "Verwaltungsrat"       # None -> or-Lookup
    assert r("S", ":if(ja,nein)") == "nein"            # leer -> else
    assert r("T", ":if(ja,nein)") == "ja"              # gefuellt -> then
    assert r("L", ":join( · )") == "a · b · c"         # Liste join (Roh-Typ erhalten)
    assert r("N", ":pad(3)") == "007"                  # numerisch -> zero-pad
    assert r("VR", ":pad(3)") == "Verwaltungsrat"      # nicht-numerisch -> unveraendert
    assert r("T", ":upper:default(x)") == "KOMPETENZ"  # Kette
    try:
        r("S", ":req"); assert False, "req sollte werfen"
    except ValueError:
        pass


def test_build_replace_requests_scanning():
    txt = "Titel {{T:upper}} — {{S:default(offen)}} — {{G:or(VR)}} — plain {{T}} — {{T:upper}}"
    reqs = dt.build_replace_requests_scanning(txt, {"T": "kompetenz", "S": "", "G": None, "VR": "VRat"})
    by = {r["replaceAllText"]["containsText"]["text"]: r["replaceAllText"]["replaceText"] for r in reqs}
    assert by["{{T:upper}}"] == "KOMPETENZ"
    assert by["{{S:default(offen)}}"] == "offen"
    assert by["{{G:or(VR)}}"] == "VRat"
    assert by["{{T}}"] == "kompetenz"                  # plain-Token weiter unterstuetzt
    assert len(reqs) == 4                              # {{T:upper}} nur EINMAL (dedupliziert)


def test_scanning_skips_anchors():
    # Tabellen-/Bullet-Anker duerfen NICHT vom Scan gewischt werden (sonst findet
    # insert_table/insert_bullets sie nicht mehr).
    txt = "{{A}} und {{BODY_TAB}} und {{BODY_LIST}}"
    reqs = dt.build_replace_requests_scanning(txt, {"A": "x"}, skip={"{{BODY_TAB}}", "{{BODY_LIST}}"})
    toks = {r["replaceAllText"]["containsText"]["text"] for r in reqs}
    assert toks == {"{{A}}"}                            # nur A ersetzt, Anker unangetastet


def test_all_text_walks_paragraphs_and_tables():
    doc = {"body": {"content": [
        {"paragraph": {"elements": [{"textRun": {"content": "Kopf {{A}} "}}]}},
        {"table": {"tableRows": [{"tableCells": [
            {"content": [{"paragraph": {"elements": [{"textRun": {"content": "{{B}}"}}]}}]}]}]}},
    ]}}
    t = dt._all_text(doc)
    assert "{{A}}" in t and "{{B}}" in t                # Tabellenzellen werden mitgescannt


def test_exec_retry_backs_off_on_429():
    """1. execute() wirft HttpError(429), 2. liefert einen Wert -> Rueckgabe + genau 2 Calls."""
    import time
    from googleapiclient.errors import HttpError

    class _Resp(dict):
        status = 429
        reason = "Too Many Requests"

    class _Req:
        def __init__(self): self.n = 0
        def execute(self):
            self.n += 1
            if self.n == 1:
                raise HttpError(_Resp(), b"{}")
            return {"ok": True}

    req = _Req()
    orig_sleep = time.sleep
    time.sleep = lambda *a: None                        # Backoff nicht wirklich schlafen
    try:
        out = dt._exec_retry(req)
    finally:
        time.sleep = orig_sleep
    assert out == {"ok": True}
    assert req.n == 2                                   # 1x 429 (retry) + 1x Erfolg


if __name__ == "__main__":
    test_build_replace_requests()
    test_render_copies_fills_exports_and_cleans()
    test_render_rejects_nonpdf_but_still_cleans()
    test_render_trashes_when_export_api_fails()
    test_render_doc_and_pdf_keeps_doc()
    test_build_grid_normal_and_group_rows()
    test_insert_bullets_inserts_lists_and_removes_anchor()
    test_insert_bullets_empty_just_removes_anchor()
    test_insert_bullets_single_batch_and_defers_anchor()
    test_insert_bullets_multi_one_batch_descending()
    test_pace_write_throttles_over_limit()
    test_insert_table_merges_fill_and_style_and_defers_anchor()
    test_insert_table_removes_anchor_when_requested()
    test_copy_fill_export_bundles_anchor_sweep()
    test_apply_modifiers()
    test_build_replace_requests_scanning()
    test_scanning_skips_anchors()
    test_all_text_walks_paragraphs_and_tables()
    test_exec_retry_backs_off_on_429()
    print("doc_template: 19/19 gruen")
