import os, sys, json, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))

class _D:  # Dummy client (materialize gestubbt -> ungenutzt)
    pass

def test_run_writes_stores():
    # Hermetik: Volume-/Data-Overrides aus der Umgebung nehmen -> root/src/data + root/public.
    for k in ("RUBICON_DATA_DIR", "RUBICON_DOCS_DIR"):
        os.environ.pop(k, None)
    os.environ["RUBICON_DRIVE_FR_FOLDER"] = "F-FR"  # sonst greift FIX 3 (FR-Ordner-Guard)
    import doc_materialize as dm, gen_docs_server as gds
    gds.FOLDERS["fuehrungsrhythmus"] = "F-FR"  # FOLDERS ist import-cached -> deterministisch setzen
    dm.materialize = lambda *a, **k: {"doc_id": "D", "doc_url": "u/D/edit",
                                      "pdf_id": "P", "pdf_url": "v/P", "pdf_bytes": b"%PDF x"}
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "src/data"))
    json.dump({"entscheide": [{"id": "E-1", "titel": "T", "entscheid": "B"}]},
              open(os.path.join(root, "src/data/entscheide.json"), "w"))
    json.dump({"agendas": [{"meeting_id": "m1", "traktanden": []}]},
              open(os.path.join(root, "src/data/traktanden.json"), "w"))
    json.dump({"titel": "T", "untertitel": "U", "gruppen": [], "grundsaetze": []},
              open(os.path.join(root, "src/data/fuehrungsrhythmus.json"), "w"))
    json.dump({"M01": {"kontext": "k"}}, open(os.path.join(root, "src/data/briefings.json"), "w"))
    open(os.path.join(root, "src/data/projekt.yaml"), "w").write(
        "meta: {today: 2026-08-01}\nworkstreams:\n- code: WS4\n  name: X\n  milestones:\n  - {id: M01, name: N}\n")
    res = gds.run(_D(), _D(), root)
    assert res["ok"]
    ent = json.load(open(os.path.join(root, "src/data/entscheide.json")))
    assert ent["entscheide"][0]["export"]["server_doc_id"] == "D"
    frd = json.load(open(os.path.join(root, "src/data/fuehrungsrhythmus_doc.json")))
    assert frd["server_pdf_id"] == "P"
    bd = json.load(open(os.path.join(root, "src/data/briefings_docs.json")))
    assert bd["M01"]["server_doc_id"] == "D"
    td = json.load(open(os.path.join(root, "src/data/traktanden_docs.json")))
    assert td["m1"]["server_doc_id"] == "D"
    assert os.path.exists(os.path.join(root, "public/traktanden/m1.pdf"))    # Traktanden-Volume-PDF NEU
    assert os.path.exists(os.path.join(root, "public/entscheide/E-1.pdf"))
    assert os.path.exists(os.path.join(root, "public/briefings/M01.pdf"))
    assert os.path.exists(os.path.join(root, "public/fuehrungsrhythmus.pdf"))

def test_traktanden_never_trashes_local_doc():
    for k in ("RUBICON_DATA_DIR", "RUBICON_DOCS_DIR"):
        os.environ.pop(k, None)
    os.environ.pop("RUBICON_DRIVE_FR_FOLDER", None)
    import doc_materialize as dm, gen_docs_server as gds
    calls = []
    def _fake_mat(*a, **k):
        calls.append(k)
        return {"doc_id": "SRV", "doc_url": "u/SRV/edit", "pdf_id": "P2", "pdf_url": "v/P2", "pdf_bytes": b"%PDF x"}
    dm.materialize = _fake_mat
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "src/data"))
    json.dump({"agendas": [{"meeting_id": "m1", "traktanden": []}]},
              open(os.path.join(root, "src/data/traktanden.json"), "w"))
    json.dump({"m1": "DIETER-LOCAL-DOC"}, open(os.path.join(root, "src/data/traktanden_docs.json"), "w"))
    gds.run(_D(), _D(), root)
    assert all(k.get("prev_doc_id") != "DIETER-LOCAL-DOC" for k in calls)  # NIE getrasht
    td = json.load(open(os.path.join(root, "src/data/traktanden_docs.json")))
    assert td["m1"]["server_doc_id"] == "SRV"          # neuer Server-Doc
    assert td["m1"]["doc_id"] == "DIETER-LOCAL-DOC"    # lokale ID erhalten

def test_fr_guard_env_missing():
    for k in ("RUBICON_DATA_DIR", "RUBICON_DOCS_DIR", "RUBICON_DRIVE_FR_FOLDER"):
        os.environ.pop(k, None)
    import doc_materialize as dm, gen_docs_server as gds
    gds.FOLDERS["fuehrungsrhythmus"] = ""  # FOLDERS ist import-cached -> Guard-Bedingung deterministisch
    dm.materialize = lambda *a, **k: {"doc_id": "D", "doc_url": "u/D/edit",
                                      "pdf_id": "P", "pdf_url": "v/P", "pdf_bytes": b"%PDF x"}
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "src/data"))
    json.dump({"titel": "T", "untertitel": "U", "gruppen": [], "grundsaetze": []},
              open(os.path.join(root, "src/data/fuehrungsrhythmus.json"), "w"))
    res = gds.run(_D(), _D(), root)
    assert res["per_typ"]["fuehrungsrhythmus"] == "ENV_MISSING"   # lauter Marker, kein 0/ok
    assert not os.path.exists(os.path.join(root, "src/data/fuehrungsrhythmus_doc.json"))  # nicht geschrieben

if __name__ == "__main__":
    test_run_writes_stores()
    test_traktanden_never_trashes_local_doc()
    test_fr_guard_env_missing()
    print("gen_docs_server: 3/3 gruen")
