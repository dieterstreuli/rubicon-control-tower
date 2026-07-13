# RUBICON Control Tower

Kontrollturm-Plattform für **Projekt RUBICON** («Alea iacta est.») — den
Transformationsplan der AXS Group 2026/27. Bildet die 7 Programm-Ströme + den
Commercial-Masterplan (43 MS, 1:1) ab, erkennt Verzug deterministisch,
projiziert das Kern-Projektende und übernimmt (simuliert) die
Durchsetzungsfunktion des CoS.

## Setup

```bash
npm install
npm run validate   # Integritäts-Gate für src/data/projekt.yaml (Exit != 0 bei Fehlern)
npm run dev        # http://localhost:8621
```

Python-Abhängigkeit für den Validator: `pip3 install pyyaml`.

## Bedienung

- **Steuerungsdatum** = `meta.today` in `src/data/projekt.yaml` (bewusst manuell
  für reproduzierbare Sichten — bei jeder Steuerungssitzung nachführen).
- **Rollen** oben rechts: CoS (volle Steuerung) · Owner (eigener Strom
  editierbar; Identität wählbar) · Chairman/Teilnehmer (lesend).
- **Abflugtafel:** ◆ = kritischer Pfad · ⏳ = gesetzlicher Nachlauf Q2/27
  (zählt nicht gegen das Kern-Ende) · `*` = Termin ist Monatsende-Annahme ·
  G1–G7 = Sequenz-Gates.
- **Aktion erfassen** (Aktions-Log): Fortschritt/Blocker melden → Wirkung auf
  Status und projiziertes Projektende wird deterministisch berechnet und
  protokolliert. Session-only (Wahrheitsquelle bleibt die YAML).
- **CoS-Steuerung:** Durchsetzungs-Queue über überfällige Inputs; Reminder/
  Kalender/Eskalation sind im Prototyp **simuliert** (siehe
  `mcp/calendar_bridge.md` für den realen Write-Pfad mit Freigabe-Token).

## Datenpflege

- Programmdaten: `src/data/projekt.yaml` editieren → `npm run validate`.
- Commercial-Masterplan (Strom CMP): Quelle ist
  `~/Chief/crm/cockpit/masterplan.json`; Neuaufbau der YAML via
  `python3 scripts/build_projekt_yaml.py` (1:1-Übernahme, Mapping-Report).

## Ausbaustufen

1. **v1 (dieser Stand):** lokal, DRS/CoS-only; Durchsetzung simuliert.
2. **MCP-Bridge produktiv:** Reminder/Kalender/Eskalation real via Gmail-/
   Calendar-MCP, einmalige payload-gebundene Freigabe-Token (`mcp/calendar_bridge.md`).
3. **Tracker-Sync:** Gruppen-Commitment-Tracker (Master ab Okt 26) ↔ read-only-
   Import; CRM-Cockpit (:8600) bleibt Commercial-DATEN-Spezialsicht — das
   Masterplan-TRACKING ist seit 07.07.2026 hierher überführt (Cutover).
4. **GL-Zugang:** über das Internal-Apps-Gateway (IAP vor Cloud Run, Task #99);
   der UI-Rollen-Umschalter wird dann durch echte Identitäten ersetzt.
