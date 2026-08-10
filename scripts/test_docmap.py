import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _docmap as dmap

def test_entscheid_spec():
    e = {"id": "E-1", "titel": "T", "entscheid": "B", "status": "offen"}
    s = dmap.entscheid_spec(e)
    assert s["name"] == "E-1.pdf"
    assert s["values"]["REGISTER_ID"] == "E-1" and s["values"]["BESCHLUSS"] == "B"
    assert s["values"]["QUELLE"]                       # Default gesetzt

def test_briefing_spec_strips_vorgehen_numbers():
    m = {"id": "M01", "name": "N", "owner": "O"}
    b = {"vorgehen": ["1. Erst", "2. Zweit"], "leistung": ["A"], "risiken": ["R"]}
    s = dmap.briefing_spec(m, b, "WS4 — X")
    assert s["bullets"]["{{BODY_VORGEHEN}}"]["items"] == ["Erst", "Zweit"]   # Enumerator gestrippt
    assert s["bullets"]["{{BODY_VORGEHEN}}"]["ordered"] is True
    assert s["bullets"]["{{BODY_LEISTUNG}}"] == ["A"]

def test_fr_spec_has_group_bands():
    fr = {"titel": "T", "untertitel": "U", "grundsaetze": ["G"],
          "gruppen": [{"kadenz": "Alle 2 Wochen", "farbe": "brass",
                       "meetings": [{"name": "SC", "wann": "w", "teilnehmer": "t", "zweck": "z", "output": "o"}]}]}
    s = dmap.fr_spec(fr)
    rows = s["tables"]["{{BODY_RHYTHMUS}}"]["rows"]
    assert isinstance(rows[0], dict) and rows[0]["group"] == "Alle 2 Wochen"   # Bandzeile
    assert rows[1] == ["SC", "w", "t", "z", "o"]

def test_traktanden_spec():
    a = {"meeting_id": "steuerungsrunde", "dauer": "4h", "vorsitz": "DRS", "teilnehmer": "…",
         "standing_rule": "…", "traktanden": [{"titel": "R", "output": "H"}]}
    s = dmap.traktanden_spec(a)
    assert s["name"] == "steuerungsrunde.pdf"
    assert s["tables"]["{{BODY_TRAKTANDEN}}"]["rows"] == [["1", "R", "H"]]

def test_all_specs_carry_footer():
    # Dynamische Fusszeile: jeder Fix-Struktur-Typ liefert einen FOOTER-Wert (sonst fuellt der
    # Engine-Scan {{FOOTER}} leer). Die 4 Texte sind zentral in dmap.FOOTER hinterlegt.
    e = dmap.entscheid_spec({"id": "E-1"})
    b = dmap.briefing_spec({"id": "M01"}, {}, "WS4 — X")
    fr = dmap.fr_spec({"titel": "T", "untertitel": "U", "gruppen": []})
    t = dmap.traktanden_spec({"meeting_id": "x", "traktanden": []})
    for s, key in [(e, "entscheide"), (b, "briefings"), (fr, "fuehrungsrhythmus"), (t, "traktanden")]:
        assert s["values"]["FOOTER"] == dmap.FOOTER[key] and dmap.FOOTER[key]

def test_fr_columns_fit_landscape():
    # Landscape-A4 auf der Basis (Raender 50pt): nutzbar 741.89pt -> Spaltensumme MUSS darunter
    # bleiben, sonst ragt die Tabelle ueber den Seitenrand.
    fr = dmap.fr_spec({"titel": "T", "untertitel": "U", "gruppen": []})
    assert sum(fr["tables"]["{{BODY_RHYTHMUS}}"]["col_widths_pt"]) <= 741

if __name__ == "__main__":
    test_entscheid_spec(); test_briefing_spec_strips_vorgehen_numbers()
    test_fr_spec_has_group_bands(); test_traktanden_spec()
    test_all_specs_carry_footer(); test_fr_columns_fit_landscape()
    print("docmap: 6/6 gruen")
