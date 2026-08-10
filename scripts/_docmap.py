import re
AXS_BLUE = {"red": 0x1E / 255, "green": 0x3E / 255, "blue": 0x58 / 255}
BAND_BG = {"red": 0xee / 255, "green": 0xf2 / 255, "blue": 0xf6 / 255}
_ENUM = re.compile(r"^\s*\d+[.)]\s*")

# Dynamischer Fusszeilen-Text je Typ. Die Basis-Vorlagen tragen im Footer-Segment den {{FOOTER}}-
# Platzhalter (Seitenzahlen daneben als Autofeld); die Engine fuellt {{FOOTER}} segment-uebergreifend
# aus values. Frueher stand dieser Disclaimer als letzter Body-Absatz in der Vorlage — jetzt Daten.
FOOTER = {
    "traktanden": "Automatisch generiert aus dem Traktanden-Register (traktanden.json)  ·  Vertraulich — ExBoD / VR",
    "entscheide": "Automatisch generiert aus dem Entscheids-Register (entscheide.json).  Revisionssicher — Entscheide werden nie gelöscht.  Vertraulich — ExBoD / VR",
    "briefings": "Projekt RUBICON («Alea iacta est.»)  ·  Owner-Briefing  ·  automatisch generiert aus briefings.json  ·  Vertraulich — ExBoD / VR",
    "fuehrungsrhythmus": "Projekt RUBICON («Alea iacta est.»)  ·  Führungsrhythmus-One-Pager  ·  automatisch generiert aus fuehrungsrhythmus.json  ·  Vertraulich — ExBoD / VR",
}

def entscheid_spec(e):
    return {"name": f"{e.get('id')}.pdf", "values": {
        "REGISTER_ID": e.get("id"), "TITEL": e.get("titel"), "BESCHLUSS": e.get("entscheid"),
        "TYP": e.get("typ"), "GREMIUM": e.get("gremium"), "ANTRAGSTELLER": e.get("antragsteller"),
        "DATUM": e.get("datum"), "STATUS": e.get("status"), "BEGRUENDUNG": e.get("begruendung"),
        "DATENGRUNDLAGE": e.get("datengrundlage"),
        "QUELLE": e.get("quelle") or "direkte Register-Erfassung",
        "FOOTER": FOOTER["entscheide"]}}

def briefing_spec(m, b, ws_name):
    flags = []
    if m.get("gate"): flags.append(f"Gate {m['gate']}")
    if m.get("critical"): flags.append("kritischer Pfad ◆")
    if m.get("nachlauf"): flags.append("gesetzlicher Nachlauf ⏳")
    prog = m.get("progress")
    values = {"MS_ID": m["id"], "WS_NAME": ws_name, "PRIO": m.get("prio") or "—",
              "MSTATUS": "offen" if not isinstance(prog, (int, float)) or prog < 100 else "erledigt",
              "QUARTAL": m.get("quarter") or m.get("phase") or "—", "NAME": m.get("name"),
              "OWNER": m.get("owner") or "zu klären", "BETEILIGTE": b.get("beteiligte") or "zu klären",
              "START": m.get("start") or "—", "DUE": m.get("due") or "—",
              "DEPS": ", ".join(m.get("depends_on") or []) or "—", "FLAGS": " · ".join(flags) or "—",
              "ZIEL_KLARTEXT": b.get("ziel_klartext") or "zu klären", "KONTEXT": b.get("kontext") or "zu klären",
              "ERFOLGSMESSUNG": b.get("erfolgsmessung") or m.get("kpi") or "zu klären",
              "GROUNDING": b.get("grounding") or "—", "FOOTER": FOOTER["briefings"]}
    bullets = {"{{BODY_LEISTUNG}}": b.get("leistung") or ["zu klären"],
               "{{BODY_VORGEHEN}}": {"items": [_ENUM.sub("", str(x)) for x in (b.get("vorgehen") or ["zu klären"])],
                                     "ordered": True},
               "{{BODY_RISIKEN}}": b.get("risiken") or ["zu klären"]}
    return {"name": f"{m['id']}.pdf", "values": values, "bullets": bullets}

def fr_spec(fr):
    rows = []
    for g in fr["gruppen"]:
        rows.append({"group": g["kadenz"], "bg": BAND_BG, "text_rgb": AXS_BLUE})
        for mm in g["meetings"]:
            rows.append([mm["name"], mm["wann"], mm["teilnehmer"], mm["zweck"], mm["output"]])
    return {"name": "fuehrungsrhythmus.pdf",
            "values": {"TITEL": fr["titel"], "UNTERTITEL": fr["untertitel"], "FOOTER": FOOTER["fuehrungsrhythmus"]},
            # Landscape-A4 auf der Basis (Ränder 50pt): nutzbar 741.89pt → Spaltensumme 725pt (< 741).
            "tables": {"{{BODY_RHYTHMUS}}": {
                "header": ["Meeting", "Wann", "Mit wem", "Zweck", "Output-Erwartung → wohin"],
                "rows": rows, "col_widths_pt": [95, 80, 150, 210, 190], "header_bg": AXS_BLUE}},
            "bullets": {"{{BODY_GRUNDSAETZE}}": fr.get("grundsaetze") or []}}

def traktanden_spec(a):
    tps = a.get("traktanden") or []
    return {"name": f"{a['meeting_id']}.pdf",
            "values": {"MEETING_ID": a.get("meeting_id"), "DAUER": a.get("dauer"),
                       "VORSITZ": a.get("vorsitz"), "TEILNEHMER": a.get("teilnehmer"),
                       "STANDING_RULE": a.get("standing_rule"), "FOOTER": FOOTER["traktanden"]},
            "tables": {"{{BODY_TRAKTANDEN}}": {
                "header": ["#", "Traktandum", "Output → wohin"],
                "rows": [[str(i + 1), tp.get("titel", ""), tp.get("output", "")] for i, tp in enumerate(tps)],
                "col_widths_pt": [26, 300, 125], "header_bg": AXS_BLUE}}}
