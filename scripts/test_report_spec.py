import os, sys
from datetime import date
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))
import gen_report as gr
import gen_delta

gr.STAMP = "Steuerungsstand 07.08.2026"

# Synthetische, deterministische Datenbasis (kein Datei-/Git-/Netz-Zugriff).
DOC = {"meta": {"today": "2026-08-07"}, "workstreams": [
    {"code": "WS7", "name": "VIE-Wegfall", "milestones": [
        {"id": "WS7-01", "phase": "Phase 0", "due": "2026-07-01", "progress": 10, "critical": True}]},
    {"code": "WS1", "name": "TOM", "milestones": [
        {"id": "WS1-01", "phase": "Phase 0", "due": "2026-12-01", "start": "2026-08-01", "progress": 0}]},
]}
NOW = date(2026, 8, 7)
META = DOC["meta"]


def _prog_ampel():
    allms = [m for w in DOC["workstreams"] for m in w["milestones"]]
    return "delayed" if any(m.get("critical") and not m.get("nachlauf") and gr.status_of(m, NOW) == "delayed" for m in allms) \
        else next((s for s in gr.ORDER if any(gr.status_of(m, NOW) == s for m in allms)), "unknown")


def _spec(level, inper=None, ki=False, kom=None):
    return gr.report_spec(level, DOC, META, NOW, inper or [], date(2026, 8, 1), date(2026, 8, 31),
                          "TESTLABEL", _prog_ampel(), kom or (lambda s: ""), ki=ki)


# Erwartete Anker je Ebene — MUSS 1:1 zu build_report_templates.py / den Vorlagen passen. Bildet
# den vollen alten HTML-Report ab (nichts weglassen). tables-Set + bullets-Set.
ANCHORS = {
    "vr":    ({"{{KENNZAHLEN}}", "{{PHASEN_TABELLE}}", "{{GATES_TABELLE}}", "{{ENTSCHEIDUNGSBEDARF_TABELLE}}",
               "{{RISIKEN_TABELLE}}", "{{WS_TABELLE}}", "{{KI_BEGRUENDUNGEN}}"}, set()),
    "monat": ({"{{PHASEN_TABELLE}}", "{{WS_TABELLE}}", "{{BEWEGUNGEN}}", "{{FORTSCHRITT_TABELLE}}",
               "{{WS_KOMMENTARE}}", "{{COMMITMENTS_TABELLE}}", "{{OFFENE_ENTSCHEIDE}}", "{{KI_BEGRUENDUNGEN}}"}, set()),
    "woche": ({"{{DELTA_AMPEL}}", "{{DELTA_FORTSCHRITT}}", "{{DELTA_ERLEDIGT}}", "{{DELTA_ENTSCHEIDE}}",
               "{{AKTIVITAET_TABELLE}}", "{{COMMITMENTS_TABELLE}}", "{{ENTSCHEIDE_TABELLE}}", "{{KI_BEGRUENDUNGEN}}"}, set()),
}


def _fake_delta():
    gen_delta.compute = lambda days=7: {"fenster": {"von": "2026-08-03", "bis": "2026-08-09"},
        "ampel": [{"id": "WS7-01", "von": "onTrack", "zu": "delayed"}],
        "fortschritt": [{"id": "WS7-01", "von": None, "zu": 10}], "erledigt": [{"nr": "H-1", "text": "done"}]}


def test_anchor_parity_per_level():
    _fake_delta()
    for lvl, (tset, bset) in ANCHORS.items():
        s = _spec(lvl)
        assert set(s["tables"]) == tset, (lvl, set(s["tables"]), tset)
        assert set(s["bullets"]) == bset, (lvl, set(s["bullets"]), bset)


def test_common_values_and_footer():
    s = _spec("vr")
    assert s["values"]["FOOTER"] == gr.REPORT_FOOTER
    assert s["values"]["UNTERTITEL"] == gr.PROJEKT_SUB
    assert s["values"]["TITEL"] == "TESTLABEL"
    assert s["values"]["PROGRAMM_AMPEL"] == gr.SIG_LBL["delayed"]   # 'Verzug' (WS7-01 kritisch+überfällig)
    assert s["name"] == "VR-Report — TESTLABEL"


def test_ws_table_ampel_colors_from_ssot():
    s = _spec("vr")
    ws = s["tables"]["{{WS_TABELLE}}"]
    # WS7 (delayed) rot #c0392b, WS1 (onTrack) grün #2f9e6f — Farbe = SSOT SIG.
    assert ws["cell_text_rgb"][(0, 2)] == gr._hex_rgb(gr.SIG["delayed"])
    assert ws["cell_text_rgb"][(1, 2)] == gr._hex_rgb(gr.SIG["onTrack"])
    assert ws["rows"][0][2] == gr.SIG_LBL["delayed"]                # Label-Text in der Zelle


def test_columns_fit_portrait():
    _fake_delta()
    for lvl in ("vr", "monat", "woche"):
        for anchor, t in _spec(lvl)["tables"].items():
            assert sum(t["col_widths_pt"]) <= 490, (lvl, anchor, sum(t["col_widths_pt"]))


def test_empty_data_fallback_rows():
    s = _spec("monat")
    assert s["tables"]["{{COMMITMENTS_TABELLE}}"]["rows"] == [["keine", "—", "—"]]
    assert s["tables"]["{{OFFENE_ENTSCHEIDE}}"]["rows"] == [["keine", "—"]]
    assert s["bullets"] == {}          # monat hat keine Bullets


def test_ki_off_leaves_note_and_placeholder_begruendung():
    s = _spec("vr", ki=False)
    assert s["values"]["KI_NARRATIV"] == "KI-Entwurf für diesen Lauf deaktiviert."
    assert s["tables"]["{{KI_BEGRUENDUNGEN}}"]["rows"] == [["—", "—"]]


def test_ki_data_normalizes_malformed_begruendungen():
    # Modell liefert eine LISTE statt Objekt -> darf NICHT .items()-crashen (F1), sondern {} werden.
    gr.ai_client.generate = lambda prompt: '{"narrativ": "N.", "begruendungen": ["kaputt"]}'
    d = gr.ki_data("vr", DOC, NOW, "L")
    assert d["begruendungen"] == {} and d["narrativ"] == "N." and d["error"] is False
    s = _spec("vr", ki=True)   # Konsument rendert Platzhalterzeile statt zu werfen
    assert s["tables"]["{{KI_BEGRUENDUNGEN}}"]["rows"] == [["—", "—"]]


def test_woche_delta_failure_is_soft():
    import gen_delta
    def boom(days=7):
        raise RuntimeError("store weg")
    gen_delta.compute = boom
    s = _spec("woche")
    t = s["tables"]
    # alle 4 Δ-Tabellen tragen den weichen Hinweis (Report kippt nicht)
    assert "Δ nicht verfügbar" in t["{{DELTA_AMPEL}}"]["rows"][0][1]
    assert set(t) >= {"{{DELTA_AMPEL}}", "{{DELTA_FORTSCHRITT}}", "{{DELTA_ERLEDIGT}}", "{{DELTA_ENTSCHEIDE}}"}
    assert s["values"]["DELTA_FENSTER"] == "Fenster nicht verfügbar"


def test_vr_restores_all_old_sections():
    # F10: nichts weniger als Dieters altes VR-HTML — Kennzahlen/Gates/Entscheidungsbedarf(+Quelle)/Risiken.
    t = _spec("vr")["tables"]
    assert t["{{KENNZAHLEN}}"]["header"] == ["Kern-Ende", "Hard Edge", "Meilensteine"]
    assert t["{{GATES_TABELLE}}"]["header"] == ["Gate", "Termin"]
    assert t["{{ENTSCHEIDUNGSBEDARF_TABELLE}}"]["header"] == ["Entscheid", "Quelle"]
    assert t["{{RISIKEN_TABELLE}}"]["header"] == ["MS", "Risiko", "Verzug"]


def test_monat_restores_fortschritt_and_ws_kommentare():
    t = _spec("monat")["tables"]
    assert "{{FORTSCHRITT_TABELLE}}" in t and "{{WS_KOMMENTARE}}" in t


def test_monat_offene_entscheide_keep_vr_flag():
    # R2-Fix: VR-pflichtiger offener Entscheid muss im Monat als [VR] erkennbar bleiben.
    inper = [{"meeting_name": "X", "eintraege": [
        {"typ": "entscheid", "status": "offen", "ebene": "VR", "text": "E1"},
        {"typ": "entscheid", "status": "offen", "text": "E2"}]}]
    rows = _spec("monat", inper=inper)["tables"]["{{OFFENE_ENTSCHEIDE}}"]["rows"]
    assert ["E1 [VR]", "offen"] in rows and ["E2", "offen"] in rows


def test_woche_delta_fenster_shown():
    _fake_delta()
    assert _spec("woche")["values"]["DELTA_FENSTER"] == "Fenster: 03.08.2026 – 09.08.2026"


def test_woche_aktivitaet_names_and_skip_mapping():
    _fake_delta()
    # Nur WS1 hat eine Meldung -> WS7 (erster im DOC) wird übersprungen; die eine Zeile muss Index 0
    # tragen (Skip darf den cell_text_rgb-Index nicht verschieben) + den Klartextnamen (F10).
    inper = [{"eintraege": [{"typ": "fortschritt", "ms_id": "WS1-01", "wert": 10, "text": "x"}]}]
    t = _spec("woche", inper=inper)["tables"]["{{AKTIVITAET_TABELLE}}"]
    assert t["rows"][0][0].startswith("WS1 — ")
    assert (0, 1) in t["cell_text_rgb"] and (1, 1) not in t["cell_text_rgb"]


def test_ki_on_fills_narrativ_and_begruendungen():
    gr.ai_client.generate = lambda prompt: '{"narrativ": "N.", "begruendungen": {"WS7-01": "B."}}'
    s = _spec("vr", ki=True)
    assert s["values"]["KI_NARRATIV"] == "N."
    assert s["tables"]["{{KI_BEGRUENDUNGEN}}"]["rows"] == [["WS7-01", "B."]]


def test_ki_data_error_is_visible_not_silent():
    def boom(_):
        raise RuntimeError("vertex weg")
    gr.ai_client.generate = boom
    d = gr.ki_data("vr", DOC, NOW, "L")
    assert d["error"] is True and "nicht verfügbar" in d["narrativ"] and d["begruendungen"] == {}


def test_woche_monat_carry_programm_kommentar():
    _fake_delta()
    kom = lambda s: "Testkommentar" if s == "programm" else ""
    for lvl in ("woche", "monat"):
        assert _spec(lvl, kom=kom)["values"]["KOMMENTAR"] == "Testkommentar"   # F4: nicht mehr verworfen
    vr = _spec("vr", kom=kom)                                    # VR nutzt CHAIRMAN_STATEMENT
    assert vr["values"]["CHAIRMAN_STATEMENT"] == "Testkommentar" and "KOMMENTAR" not in vr["values"]


def test_woche_delta_none_progress_dash():
    _fake_delta()
    rows = _spec("woche")["tables"]["{{DELTA_FORTSCHRITT}}"]["rows"]   # [MS, Meilenstein, Δ]
    assert rows[0][2] == "— → 10 %"     # von=None -> '—', kein 'None %'


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
    print(f"report_spec: {len(fns)}/{len(fns)} gruen")
