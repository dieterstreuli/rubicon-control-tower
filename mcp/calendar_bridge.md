# MCP-Bridge — Reminder / Kalender / Eskalation (Spezifikation)

> **Hinweis (Stufe 4/5 — dieses Spec ist abgelöst):** Reminder, Entscheid-Kommunikation, **Eskalation**
> und **Kalender** laufen jetzt serverseitig direkt über Domain-Wide Delegation **im Kontext des
> angemeldeten Nutzers**, nicht mehr über eine MCP-Bridge: `gen_reminder_mail.py` / `gen_entscheid_mail.py`
> / `gen_eskalation_mail.py` erzeugen Gmail-**Entwürfe** (`gmail.modify`), `gen_calendar_event.py` einen
> echten Calendar-Event (`calendar.events`) — je über `--subject` = verifizierte IAP-Identität. Der hier
> skizzierte MCP-Weg gilt nur noch als **historische Referenz**.

Status: **Spezifikation** — im Prototyp sind alle Durchsetzungs-Aktionen simuliert.
Reale Writes (Gmail-Draft/Send, Google-Calendar-Events) laufen später ausschliesslich
über dieses Muster. Ohne Freigabe-Token gibt es **keinen** Write.

## Grundmuster (vier Schritte, hart sequenziert)

```
UI-Aktion (CoS klickt «Reminder» / «Kalender» / «Eskalieren»)
   │
   ▼
1) DETERMINISTISCHER VORSCHLAG (read-only)
   Bridge rendert aus projekt.yaml (einzige Wahrheitsquelle) einen Payload:
   { typ: reminder|calendar|eskalation,
     input_id, empfänger (aus meta.owners → Adressbuch-Mapping),
     betreff, text (Template, deterministisch aus item/due/status),
     payload_hash: sha256(kanonisches JSON) }
   → wird dem Menschen ANGEZEIGT, nichts wird gesendet.
   │
   ▼
2) FREIGABE-TOKEN (einmalig, menschlich)
   Der Mensch (CoS/DRS) erteilt ein Token, das an GENAU diesen payload_hash
   gebunden ist: token = sign(payload_hash, nonce, ttl=15min).
   Kein generalisiertes «immer erlauben». Kein Token → kein Write.
   │
   ▼
3) MCP-WRITE
   reminder    → mcp gmail: draft_email (Default) — Senden bleibt beim Menschen;
                 send nur, wenn das Token explizit scope=send trägt
   calendar    → mcp google-calendar: create-event (Koordinations-Slot,
                 Teilnehmer = Owner + CoS)
   eskalation  → mcp gmail: draft_email an Eskalationsstufe +1
                 (Owner → GL-Mitglied → Power-Duo → Chairman) gemäss
                 Eskalationsmatrix (INS-001-Nachtrag)
   Die Bridge prüft vor dem Write: hash(payload) == token.payload_hash,
   ttl gültig, nonce unverbraucht. Sonst Abbruch.
   │
   ▼
4) LOG (append-only)
   { ts, aktion, input_id, empfänger, payload_hash, token_id, ergebnis }
   → Automations-Log. Jeder Write ist nachvollziehbar.
```

## Harte Regeln

1. **Kein Write ohne Token.** Simulation bleibt der Default, bis die Bridge
   produktiv geschaltet ist.
2. **Token einmalig + payload-gebunden.** Ein Token autorisiert exakt einen
   Payload (hash-Bindung). Wiederverwendung/Änderung → ungültig.
3. **Keine generalisierten Freigaben.** «Alle Reminder senden» erzeugt n
   Vorschläge und braucht n Token (oder ein Batch-Token, das die Liste der
   n Hashes signiert — sichtbar aufgelistet vor Freigabe).
4. **Nur Daten aus projekt.yaml.** Die Bridge liest Empfänger, Fristen und
   Inhalte ausschliesslich aus der Wahrheitsquelle; kein Freitext-Injection
   aus dem UI in den Payload.
5. **E-Mail-Versand:** Default ist Draft (Mensch sendet). Direkter Versand nur
   mit explizitem scope=send im Token — konsistent mit der Hard Rule
   «Claude sendet nie selbst».
6. **Kalender-Grenzen:** keine Termine vor 09:00, keine Wochenenden,
   Sport-Blöcke unantastbar (bestehende Kalender-Regeln gelten auch hier).

## Ausbaustufen

- **Stufe 1 (jetzt):** Simulation im UI + dieses Dokument.
- **Stufe 2:** Bridge als kleiner lokaler Service; Gmail/Calendar via bestehende
  MCP-Server; Token-Erteilung im UI (CoS bestätigt Payload-Anzeige).
- **Stufe 3:** Tracker-Sync (Gruppen-Commitment-Tracker/Google Sheet) —
  read-only-Import in projekt.yaml-Struktur, nie Duplikat-Schreiben in beide
  Richtungen ohne definierten Master (Master = Gruppen-Tracker ab Okt 26).
