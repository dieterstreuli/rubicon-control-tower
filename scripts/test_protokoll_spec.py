import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import gen_protokoll as gp

gp.STAMP = "07.08.2026 10:00"

# Synthetischer, deterministischer Datensatz (kein Datei-/Netz-Zugriff).
REC = {
    "id": "P-2026-08-07-SC-1", "meeting_name": "Steering Committee (SC)", "datum": "2026-08-07",
    "vorsitz": "Dieter Streuli", "erfasst_von": "Gemini (Meet) → Import", "source": "gemini",
    "eintraege": [
        {"typ": "fortschritt", "ms_id": "WS7-02", "wert": 40, "text": "gut"},
        {"typ": "blocker", "ms_id": "WS7-01", "slip": 7, "text": "Kompensationsmodell verzögert"},
        {"typ": "commitment", "text": "Skizze an VR", "owner": "CoS", "bis": "2026-08-11"},
        {"typ": "entscheid", "text": "Eskalation WS7", "status": "entschieden"},
        {"typ": "notiz", "text": "SC-Runde zur Lage WS7."},
    ],
}

# Anker MUSS 1:1 zu templates_build/build_protokoll_template.py passen.
TABLE_ANCHORS = {"{{FORTSCHRITT}}", "{{COMMITMENTS}}", "{{ENTSCHEIDE}}"}
BULLET_ANCHORS = {"{{NOTIZEN}}"}
VALUE_KEYS = {"TITEL", "DATUM", "VORSITZ", "ERFASSER", "QUELLE", "FOOTER"}


def test_anchor_parity():
    s = gp.protokoll_spec(REC)
    assert set(s["tables"]) == TABLE_ANCHORS, set(s["tables"])
    assert set(s["bullets"]) == BULLET_ANCHORS, set(s["bullets"])
    assert set(s["values"]) == VALUE_KEYS, set(s["values"])


def test_footer_supplied():
    # LEKTION: doc_template loescht unersetzte {{...}} — {{FOOTER}} MUSS einen Wert bekommen,
    # sonst verschwindet die dynamische Fusszeile. Der Wert ist die feste Protokoll-Fusszeile.
    s = gp.protokoll_spec(REC)
    assert s["values"]["FOOTER"] == gp.PROTOKOLL_FOOTER
    assert s["values"]["FOOTER"]  # nicht leer


def test_name_and_meta_values():
    s = gp.protokoll_spec(REC)
    assert s["name"] == "Sitzungsprotokoll — Steering Committee (SC) (07.08.2026)"
    assert s["values"]["TITEL"] == "Steering Committee (SC)"
    assert s["values"]["DATUM"] == "07.08.2026"
    assert s["values"]["VORSITZ"] == "Dieter Streuli"
    assert s["values"]["ERFASSER"] == "Gemini (Meet) → Import"


def test_quelle_with_and_without_source():
    s = gp.protokoll_spec(REC)
    assert s["values"]["QUELLE"] == "Quelle: gemini · P-2026-08-07-SC-1 · Projekt RUBICON"
    rec2 = dict(REC); rec2.pop("source")
    s2 = gp.protokoll_spec(rec2)
    assert s2["values"]["QUELLE"] == "P-2026-08-07-SC-1 · Projekt RUBICON"


def test_fortschritt_blocker_merged_two_columns():
    # Fortschritt UND Blocker teilen sich die «MS / Meldung»-Tabelle (abgenommenes Layout);
    # die Bemerkung (text) darf nicht verloren gehen.
    t = gp.protokoll_spec(REC)["tables"]["{{FORTSCHRITT}}"]
    assert t["header"] == ["MS", "Meldung"]
    assert t["rows"][0] == ["WS7-02", "Fortschritt → 40 % · gut"]
    assert t["rows"][1] == ["WS7-01", "Blocker: Kompensationsmodell verzögert (+7 T)"]


def test_commitments_and_entscheide_rows():
    t = gp.protokoll_spec(REC)["tables"]
    assert t["{{COMMITMENTS}}"]["header"] == ["Commitment", "Owner", "bis"]
    assert t["{{COMMITMENTS}}"]["rows"] == [["Skizze an VR", "CoS", "11.08.2026"]]
    assert t["{{ENTSCHEIDE}}"]["rows"] == [["Eskalation WS7", "entschieden"]]


def test_notizen_bullets():
    b = gp.protokoll_spec(REC)["bullets"]["{{NOTIZEN}}"]
    assert b == ["SC-Runde zur Lage WS7."]


def test_columns_fit_portrait():
    for anchor, t in gp.protokoll_spec(REC)["tables"].items():
        assert sum(t["col_widths_pt"]) <= 490, (anchor, sum(t["col_widths_pt"]))


def test_empty_data_fallback_rows():
    s = gp.protokoll_spec({"id": "P-x", "meeting_name": "M", "datum": "2026-08-07", "eintraege": []})
    t = s["tables"]
    assert t["{{FORTSCHRITT}}"]["rows"] == [["—", "keine Fortschritts-/Blocker-Meldung"]]
    assert t["{{COMMITMENTS}}"]["rows"] == [["keine", "—", "—"]]
    assert t["{{ENTSCHEIDE}}"]["rows"] == [["keine", "—"]]
    assert s["bullets"]["{{NOTIZEN}}"] == []      # keine leeren Listenpunkte


def test_is_server_reads_dwd_env(monkeypatch=None):
    # _is_server haengt an den keyless-DWD-Env-Variablen (wie gen_report).
    old = (os.environ.get("RUBICON_WORKSPACE_SA"), os.environ.get("RUBICON_IMPERSONATE_SUBJECT"))
    try:
        os.environ.pop("RUBICON_WORKSPACE_SA", None)
        os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)
        assert gp._is_server() is False
        os.environ["RUBICON_WORKSPACE_SA"] = "sa@x"
        os.environ["RUBICON_IMPERSONATE_SUBJECT"] = "u@x"
        assert gp._is_server() is True
    finally:
        for k, v in zip(("RUBICON_WORKSPACE_SA", "RUBICON_IMPERSONATE_SUBJECT"), old):
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
    print(f"protokoll_spec: {len(fns)}/{len(fns)} gruen")
