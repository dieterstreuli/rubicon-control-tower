# RUBICON Control Tower — Grundregeln

Kontrollturm für Projekt RUBICON («Alea iacta est.») — Transformationsplan
AXS Group 2026/27. 8-Monats-Kernumsetzung (01.09.2026 → 30.04.2027) +
gesetzlicher Nachlauf Q2/27.

## Architektur-Grundregeln (verbindlich)

1. **Einzige Wahrheitsquelle:** alle Projektdaten leben in `src/data/projekt.yaml`.
   Kein Zustand wird anderswo dupliziert. UI liest NUR aus `src/lib/loader.js`.
   Session-Eingaben (Aktions-Log, gemeldeter Fortschritt, Reminder-Stempel) sind
   flüchtige Overlays und klar so markiert.
   AUSNAHME (Modul «Sitzung erfassen», 08.07.): erfasste Sitzungen schreiben
   PERSISTENT via `POST /api/sitzung` (plugins/rubicon-api.js) — Fortschritt/Blocker
   → projekt.yaml, vollständiges Protokoll → protokolle.json. Ampel bleibt ABGELEITET
   (nie manuell). Vite-HMR lädt nach dem Write neu → Tower zeigt neuen Stand.
2. **Determinismus statt Ermessen:** Status, Verzug, kritischer Pfad und
   Projektende folgen reinen Regeln in `src/lib/status.js` — keine Heuristik.
   Steuerungsdatum = `meta.today` (bewusst manuell, für reproduzierbare Sichten;
   bei jeder Steuerungssitzung aktualisieren; überlebt den Rebuild).
   **Start-bewusste atRisk-Regel (13.07.):** vor `m.start` ist fehlender
   Fortschritt KEIN Risikosignal (Arbeitsfenster noch nicht begonnen → onTrack);
   `start` der task-getriebenen MS = früheste Handlung, in Progress-Preserve.
   Jede status.js-Änderung ZWINGEND 1:1 in gen_report.status_of spiegeln +
   Fixture in test_status_parity.py (aktuell 16 Fälle).
3. **Nie raten:** fehlende Werte bleiben `null` und werden als Datenlücke
   gemeldet (Loader + `scripts/validate.py`) — niemals erfunden.
4. **Menschliche Kontrolle über Writes:** reale Reminder-/Kalender-/Eskalations-
   Writes nur über die MCP-Bridge mit einmaligem, payload-gebundenem
   Freigabe-Token (`mcp/calendar_bridge.md`). Im Prototyp: simuliert.

## RUBICON-Spezifika

- **7 Programm-Ströme** (WS1 TOM/AFR · WS2 MOS/AFR · WS3 Kosten/Rohde ·
  WS4 Commercial/Haeffner · OE Operational Excellence/CGO · WS5 Kultur/Charisius ·
  WS6 AI/Petric). **Der Commercial-Masterplan (43 MS, 1:1 aus
  `~/Chief/crm/cockpit/masterplan.json`) ist in WS4 GEMERGT** (DRS 07.07.):
  RUBICON-Deliverables = Programm-Gates; die 43 Masterplan-MS sind (DRS 07.07.)
  VOLL in die RUBICON-Phasen 0–3/Nachlauf integriert — Phase termin-getrieben aus
  dem due (`rubicon_phase()`), kein separater «Masterplan»-Bucket. Redundanz
  WS4-03 entfernt (→M10), Kopplungen via depends_on (WS4-01→M03, WS4-05→M06,
  WS4-08→M10, WS4-11→M21) — alles deterministisch in
  `scripts/build_projekt_yaml.py` (MERGE_DROP/MERGE_LINKS/rubicon_phase).
- **nachlauf: true** = arbeitsrechtlich gebundener Q2/27-Effekt (BER/AAST u.a.);
  zählt NIE gegen das Kern-Projektende (`baseline_end` 2027-04-30).
- **gate: G1..G7** = Sequenz-Gates; **critical: true** = kritischer Pfad
  (Kette: G1 12.09. → G2 15.10. → G6 Closing 31.10. → TOM Q4-VR → Verfahren
  eingeleitet → Zielnachweis Apr 27).
- Führungsmodell: DRS steuert/kontrolliert · AFR + CGO treiben · GL-6 liefert
  (Begriff «Power-Duo» ist aus dem Dashboard/den Briefings entfernt, DRS 07.07.).
  Rollen im UI: CoS (voll) · Owner (eigener Strom) · Chairman/Teilnehmer (lesend).
- Keine Daten-Duplikation zu CRM-Cockpit (:8600) / Chairman-Tracker /
  Agenda — Integration per Referenz bzw. spätere Sync-Stufe (Bridge Stufe 3).

## Dateikarte

| Datei | Zweck |
|---|---|
| `src/data/projekt.yaml` | EINZIGE Wahrheitsquelle (meta, workstreams, inputs) |
| `src/lib/status.js` | deterministische Statuslogik (rein, testbar) |
| `src/lib/loader.js` | YAML parsen, normalisieren, Datenlücken markieren |
| `src/lib/theme.js` | Design-Tokens (Ops-Center dunkel, Messing=kritisch) |
| `src/App.jsx` | Views + Rollen-Gating; liest nur aus dem Loader. **IA-Konsolidierung 01.08. (B0): 5 Tabs — Kontrollturm · Aufgaben · Sitzungen · Entscheide · Reports.** Intro = ⓘ-Overlay im Header; Arbeitsströme = Darstellungs-Umschalter im Kontrollturm (Tafel⇄Karten); CoS-Steuerung = CoS-Sektion im Kontrollturm; «Sitzungen» = Erfassen (CoS/Owner) + Protokoll-Archiv; Aktions-Log-Tab entfernt — die Wirkungsrechnung lebt als What-if-Widget im Milestone-Modal (reine Simulation). Alte Tab-IDs werden gemappt (`LEGACY_TAB`). **Quick-Wins 01.08.:** A1 Filter/Suche/Scroll überleben den HMR-Reload (sessionStorage + `reloadKeepScroll()`); A2 Textsuche in Abflugtafel + Aufgaben, `MsPicker` (filterbare MS-Auswahl) in der Sitzungserfassung; A3 Drift-Banner, wenn `meta.today` >2 Tage hinter dem realen Datum liegt (meta.today bleibt bewusst manuell). **Tab «Aufgaben» (13.07.):** flache Liste ALLER Handlungen aus tasks.json, filterbar Status×Phase×WS×Verantwortlicher + Textsuche, sortiert nach Fälligkeit; Abhaken inline; Rolle Owner startet vorgefiltert auf sich selbst |
| `scripts/validate.py` | Integritäts-Gate (Exit != 0 bei Fehlern) |
| `scripts/build_projekt_yaml.py` | Assembly Masterplan(1:1)+RUBICON → projekt.yaml + briefings.json |
| `scripts/gen_briefing_pdfs.py` | Briefing-PDF je MS → `public/briefings/<id>.pdf` |
| `scripts/gen_pdf_previews.py` | Seite-1-PNG je PDF → `public/*/<name>.png` (Modal-Vorschau; iframe rendert PDF im Preview nicht) |
| `src/data/fuehrungsrhythmus.json` | Führungsrhythmus-Daten (Meetings/Kadenz/Output) — Quelle für Frontseite + PDF |
| `scripts/gen_fuehrungsrhythmus_pdf.py` | Führungsrhythmus-One-Pager (A4 quer) → `public/fuehrungsrhythmus.pdf` + `.png` |
| `src/data/traktanden.json` | Standard-Traktandenlisten je Meeting (aus Workflow) — Quelle für die Agenda-PDFs |
| `scripts/gen_traktanden_pdfs.py` | Traktandenliste je Meeting → `public/traktanden/<meeting_id>.pdf` |
| `scripts/gen_traktanden_docs.py` | Traktandenliste je Meeting als Google Doc (via md_to_gdoc) → Drive `RUBICON — Traktandenlisten` |
| `src/data/traktanden_docs.json` | Map meeting_id → Google-Doc-ID (speist die Doc-Links im UI; idempotenter Re-Run) |
| `src/data/protokolle.json` | erfasste Sitzungsprotokolle (Write-Back-Ziel; via /api/sitzung) |
| `plugins/rubicon-api.js` | Vite-Middleware: POST /api/sitzung · /api/protokoll/export · /api/report/generate · /api/report/comment · /api/task/* · /api/entscheid/* · /api/reminder/draft · **/api/gemini/import (K1, 01.08.:** shellt `import_gemini_doc.py --api`; post:false=Vorschau, post:true=Übernahme via /api/sitzung**)**. **A4 (01.08.):** /api/entscheid/status lehnt «entschieden» ohne Begründung hart ab (400). **A5 (01.08.):** /api/task/status stempelt `erledigt_von` (Rolle bzw. Owner-Name) |
| `scripts/gen_protokoll.py` | Sitzungsprotokoll → PDF (`public/protokolle/<id>.pdf`) + Google Doc (Drive: RUBICON — Sitzungsprotokolle); schreibt export-Links in protokolle.json |
| `scripts/import_gemini_doc.py` | Gemini-«Notizen für mich»-Meet-Notiz (Google Doc) → RUBICON-`/api/sitzung`-Payload. **Dry-Run per Default**, `--post` = scharf. **Doc-ID optional** — ohne sie Auto-Suche im Drive via `--meeting-id` (+`--on YYYY-MM-DD`/`--days N`; `--list` zeigt alle Gemini-Docs); genau 1 Treffer → weiter, mehrdeutig → Kandidaten statt raten. Parst nur den Notiz-Teil (oberhalb `📖 Transkript`): Zusammenfassung→notiz, «Nächste Schritte» `- [ ] \[Owner\] …`→commitment (Owner auf volle Namen normalisiert). Erzeugt NIE fortschritt/blocker aus Prosa → `projekt.yaml` bleibt unangetastet, solange die Notiz keinen Prozentwert nennt. `source:'gemini'`+Doc-Beleg. **`--api` (K1, 01.08.): genau EINE JSON-Zeile (ok/not_found/ambiguous+Kandidaten) — Schnittstelle für `/api/gemini/import` und das UI-Panel «Aus Meet-Notiz importieren» im Sitzungen-Tab (Vorschau-Tabelle → «Übernehmen → Tower»; Formular darunter bleibt Fallback).** |
| `src/data/gemini_meetings.json` | Brücke `meeting_id → Suchbegriffe` (Gemini-Doc-Titel = Kalender-Event-Titel, ≠ meeting_id). `match`=alle Begriffe müssen im Titel vorkommen. Neue Meetings nach 1. Gemini-Erfassung ergänzen (Titel via `--list`). |
| `src/data/tasks.json` | **Handlungen (Tasks, 13.07. «treibend»)**: aus Milestones abgeleitete, binär abhakbare Handlungen `{id, nr, ms_id, text, owner, due, status offen\|erledigt, erledigt_am, source zerlegung\|sitzung\|gemini, origin, created_at}`. **`nr` = kurze laufende Referenz-Nummer (Anzeige «T-###»)** — vergibt der Server monoton in `mergeTasks()`, Upsert erhält sie; validate erzwingt Pflicht+Eindeutigkeit. Menschen referenzieren per T-Nummer («T-042 erledigt»), technischer Schlüssel bleibt `id`. Write NUR via `/api/task/*`. |
| `src/data/entscheide.json` | **Entscheids-Register (16.07., Säule 3 INS-001 Anhang B):** dauerhafte E-Nummern (`E-<Jahr>-###`, seq monoton, nie neu vergeben) + De-Dup-`key` (analog Tasks); Felder Titel/Typ/Gremium/Antragsteller/Entscheid/Begründung/Datengrundlage/Datum/Frist/Kommunikations-Stempel/Task-Verweise/Quelle. **Status-Modell fix:** beantragt→entscheidungsreif→entschieden→kommuniziert→umgesetzt. Revisionssicher: KEIN Delete-Endpoint. Write nur via `/api/entscheid/*`; `/api/sitzung` spiegelt Typ-Entscheid-Einträge automatisch (Gemini-De-Dup `G-<doc>-E<idx>`). UI: Tab «Entscheide» (Filter Status×Gremium, Detail-Aufklappen, Status-Advance CoS/Antragsteller) |
| `scripts/gen_report.py` | Verdichtete Reports Woche/Monat/Quartal → PDF (`public/reports/`) + Google Doc (Drive: RUBICON — Reports); Eskalations-Filter GL/VR. **01.08.: Wochen-Report enthält Δ-Block (gen_delta); `--ki` = optionaler KI-ENTWURF** (Wochen-Narrativ + 2-Satz-Ampel-Begründung je rot/gelb; Sonnet headless via `RUBICON_CLAUDE`; fakten-gebunden, klar markiert, non-fatal; Δ+KI nur im PDF, Google-Doc unverändert). Checkbox im Reports-Tab. |
| `scripts/gen_delta.py` | **B2/K3 (01.08.):** deterministischer Wochen-Delta — git-Vergleich projekt.yaml (Fortschritt/Ampel alt→neu, Statuslogik aus gen_report = Paritäts-Disziplin) + erledigte Handlungen/Protokolle/Entscheide im Fenster. `GET /api/delta?days=N`; UI-Karte «Δ Woche» im Kontrollturm; Block im Wochen-Report. |
| `scripts/gen_reminder_mail.py` | **K2 Stufe 1 (01.08.):** Reminder als Gmail-ENTWÜRFE — je Owner EIN Entwurf (überfällige Inputs + Handlungen, `--alle`/`--ids`/`--vorlauf N`/`--dry-run`/`--force`); 7-Tage-Bremse; Owner→E-Mail nur aus verifizierter Map (nie raten); Tine Petric englisch; kein Self-Reminder; NIE Versand — DRS sendet. Aufruf via `POST /api/reminder/draft` (nur CoS). **Stufe 2 (Auto-Versand Routine-Reminder) = bewusster DRS-Entscheid, Ziel 01.09.** — Log-Feld `mode` ist dafür vorbereitet (`draft`→`sent`). Eskalation/Kalender bleiben simuliert (Führungssignale, nie automatisch). |
| `src/data/reminder_log.json` | persistentes Reminder-Protokoll {created_at, owner, email, draft_id, mode, items} — Anzeige im CoS-Tab; ersetzt für Reminder das flüchtige Session-autoLog |
| `src/data/reports_index.json` · `report_comments.json` | Report-Index (Links) + optionale Freitext-Kommentare je Ebene:Periode:Scope |
| `scripts/reports_cron.sh` + Plist `ch.streuli.chief.rubicon-reports` | launchd-Cron: Mo 06:00 + Monatsanfang → `gen_report.py --auto` (Woche/Monat/Quartal aus meta.today) → Reports liegen vor der Sitzung bereit |
| `scripts/test_status_parity.py` + `_parity_node.mjs` | Golden-Master-Paritätstest JS↔Python-Statuslogik (Audit #1); Exit≠0 bei Drift |
| `mcp/calendar_bridge.md` | Spez. realer Writes (Freigabe-Token) |

## Portabilität (13.07.2026, DRS: «jederzeit in die AXS-Welt überführbar»)

**[MIGRATION.md](MIGRATION.md) ist das Runbook.** Kernmechanik: Git-versioniert (seit 13.07.);
`scripts/_tools/` = vendored Snapshot der Chief/Tools-Abhängigkeiten (greift automatisch,
wenn `~/Chief/Tools` fehlt — auf dem DRS-Mac gewinnt weiterhin das Original; bei
Tools-Änderungen Snapshot per `cp` erneuern); Python via env `RUBICON_PY` übersteuerbar;
`scripts/requirements.txt`. Transfer-Probelauf 13.07. bestanden (Clone: validate 0 Fehler,
Parität 16/16, vendored Module standalone). Tower-Kern braucht KEIN Google — nur
GDoc-/Drive-Exporte + Gemini-Import (Creds ersetzen, s. Runbook §7). Nach jeder
substanziellen Änderung: `git add -A && git commit` (Repo-Identität d.streuli@axs.aero).

## ⚠️ Betriebsmodell seit 05.08.2026 (Gordon/Didit — VERBINDLICH)

**Die Live-Umgebung ist `https://rubicon.axs.aero`, nicht mehr der Mac.**

| Regel | Konsequenz für die Arbeit hier |
|---|---|
| **Kanonisches Repo = `rubicon-dst` (main).** Push auf main → **Auto-Deploy** live. `rubicon-control-tower` ist archiviert. | Vor jeder Arbeit `git fetch dst && git merge --ff-only dst/main`. Grössere Änderungen über Feature-Branch + kurzen PR (verhindert Überschreiben). |
| **Live-Daten liegen im GCS-Volume** (`gs://aixs-rubicon-tower-data`, europe-west4, gemountet auf `/app/src/data`). Der Mount **überschattet** die ins Image gebackenen Dateien. | Ein Code-Deploy fasst Live-Daten NICHT an. `src/data/` im Repo ist **nur Baseline** — Änderungen dort werden NICHT automatisch live. |
| **Kein Re-Seed bei normalen Deploys** (`gcloud storage rsync` nur einmalig/bewusst). | Repo-`src/data` niemals als «so sieht die Produktion aus» lesen. Strukturänderungen (neue MS/Ströme/Briefings/Stores) brauchen einen **bewussten Weg live** — offener Punkt mit Gordon. |
| **Lokal = nur Entwicklung** (`npm run dev`). Keine parallele «Produktion» auf dem Mac. | Datenpflege, die live wirken soll, gehört in die Live-Instanz — nicht in lokale Dateien. |
| **Keine Credentials/Personendaten ins Git.** | Personendaten (kontakte.json) werden entkoppelt; Sensitiv-Store bleibt lokal. |
| **Versionsprüfung:** Footer zeigt Stand + Zeitstempel (Hover = Build-SHA). | So prüfen, ob ein Push wirklich live ist. |
| **Rollen:** DRS = inhaltlich-fachliche Führung · Didit/IT = Umsetzung, Infrastruktur, gesetzliche/interne Prüfung. | Infrastruktur-Themen (Volume, CMEK, SA, Pipeline) laufen über Gordon, nicht hier. |
| `RUBICON_SKIP_LINKCHECK=1` in der Pipeline (Drive-Link-Check ohne Service-Account). | Lokal ebenso setzen, wenn keine Google-Credentials aktiv sind. |

### Remotes — welcher wofür (DRS 06.08.2026, verbindlich)

Es gibt drei Remotes mit **klar getrennten Rollen**. Wer sie verwechselt, deployt entweder
nichts oder ins Leere:

| Remote | Repo | Rolle |
|---|---|---|
| **`dst`** | `diditgmbh/rubicon-dst` | **Wahrheit und Deploy-Pfad.** Hier wird gearbeitet, hierhin wird gepusht — Push auf `main` löst den Auto-Deploy nach `rubicon.axs.aero` aus. Vor der Arbeit `git fetch dst && git merge --ff-only dst/main`. |
| **`origin`** | `dieterstreuli/rubicon-control-tower` | **Reiner Spiegel / Backup — nie Quelle.** Nach dem `dst`-Push zusätzlich `git push origin HEAD`. Begründung: die AXS-Steuerungsplattform darf nicht ausschliesslich in der GitHub-Organisation des Dienstleisters liegen (Bus-Faktor-1-Risiko, Zielbild-Kriterium **Z-DAT-12**). Aus `origin` wird nie deployt und nie gemerged. |
| **`didit`** | `diditgmbh/rubicon-control-tower` | **Tot (archiviert).** Nichts mehr dorthin pushen, nichts von dort ziehen. |

**Merksatz:** *`dst` = wirkt · `origin` = versichert · `didit` = tot.*

## Code-Struktur (Refactoring-Programm 01.08.2026 — Q1-Q6, R1-R4)

**Absicherung zuerst:** `npm test` = `scripts/test_api_smoke.mjs` (33 Prüfungen über alle 15 Endpoints: Guards 415/403, Rollen-Gates, Pflichtfelder, 404/409, read-only, Sensitiv-Sperre). **Mutationsfrei** — schreibt auch dann nichts, wenn ein Gate bricht (Fortschritt wird als No-Op-Wert gesendet). `npm run test:parity` = Statuslogik JS↔Python. `npm run validate` = Daten- + Schema-Gate.

**⚠️ Vite lädt Plugins NUR beim Serverstart.** Nach jeder Änderung an `plugins/*` den Tower neu starten (`launchctl kickstart -k gui/501/ch.streuli.chief.rubicon-tower`), sonst testet man den alten Stand — genau das ist am 01.08. passiert.

| Baustein | Zweck |
|---|---|
| `src/data/domain.json` + `src/lib/domain.js` + `scripts/_domain.py` | **Domänen-SSOT**: Rollen, Status (Label/Token/PDF-Farbe), Phasen, Entscheids-Flow/Typen/Gremien, Sitzungs-Eintragstypen, Report-Ebenen, 25%-Stufen. Neuer Status/Phase/Workflow-Schritt = NUR hier. |
| `src/lib/permissions.js` | **Rechte-Matrix** (Rolle × Aktion; `true` \| `'eigene'` \| fehlt). `can()/canAny()` im UI, `requireCan()` im Server — eine Quelle, kann nicht auseinanderlaufen. Neue Rolle = 1 Eintrag. |
| `src/data/schema.json` + `scripts/_schema.py` | **Feld-SSOT** der JSON-Stores (Typ/Pflicht/null_ok/Enum/Muster/Eindeutigkeit); von validate.py erzwungen, meldet auch unbekannte Felder (Drift). |
| `src/data/kontakte.json` + `scripts/_kontakte.py` | **Personen-SSOT**: GL-Verteiler + Owner→E-Mail + Sprachregel. Personelle Änderung = Datenpflege, kein Code. |
| `plugins/api-core.js` | **API-Kern**: 15 Endpoints über die Factory `ep(path, opts, handler)` (Guard/Body/Fehler zentral) + `db.<store>.read()/write()` als **einzige** Datenzugriffs-Schicht + Dispatcher `handle(req,res)`. |
| `plugins/rubicon-api.js` | dünne Vite-Plugin-Hülle um den Kern (Entwicklung) |
| `server.mjs` | **eigenständiger App-Server** (`npm start`): derselbe Kern + `dist/`/`public/` statisch, SPA-Fallback, Traversal-Schutz. Damit hängt die API nicht mehr am Dev-Server. Zusätzliche Origins via `RUBICON_ORIGINS`. |
| `src/App.jsx` (796 Z.) | nur noch Rahmen + Kontrollturm; Views in `src/views/*.jsx`, Bausteine in `src/components/ui.jsx`, Daten/Radar in `src/lib/data.js` |
| `scripts/_lib.py` | gemeinsame Python-Helfer (atomic_write, e/pdate/de) |

## Arbeitsregeln für Änderungen

- Datenänderungen IMMER in `projekt.yaml`, danach `npm run validate`.
- Statuslogik nie im UI «interpretieren» — nur `status.js` erweitern (rein halten).
- **Build self-contained (13.07.):** Die Quell-Dateien liegen jetzt im Repo unter `scripts/_sources/` (tower_daten.json, rubicon_briefings.json, masterplan.FROZEN.json — 13.07. aus projekt.yaml+briefings.json rekonstruiert, **Round-Trip-verifiziert**: reiner Quell-Build reproduziert projekt.yaml+briefings.json semantisch identisch). `build_projekt_yaml.py` läuft damit wieder. Normaler Workflow bleibt: Datenänderungen DIREKT in projekt.yaml (SSOT) + `npm run validate`; ein Rebuild erhält gepflegte Felder via Progress-Preserve. Owner-Normalisierung (DRS 13.07.): **9 volle Namen** (Vorname Nachname, keine Kürzel) via `OWNER_NORMALIZE` (läuft NACH Preserve). Regeln: Commercial-Team→Michael Haeffner · Didit/Tine→Tine Petric · Wüst (nicht in GL)→Amélie Charisius. Map deckt Roh-Namen (Masterplan) UND Kürzel ab.
- **Nach Änderung von Briefings/PDFs IMMER PNGs neu generieren:** `python3 scripts/gen_briefing_pdfs.py` → dann `python3 scripts/gen_pdf_previews.py` (das Modal zeigt die PNG-Vorschau, weil Chrome PDFs im verschachtelten iframe nicht rendert).
- **Audit-Härtung 08.07.2026 (KRITISCH/HOCH behoben):** statusOf null-hart + done nur ohne gemeldeten Verzug (status.js); Python-Statuslogik 1:1 an status.js (bool-sicher) + Paritätstest (`test_status_parity.py`); alle Datei-Writes atomar (temp+rename); /api-Endpoints mit Origin/Content-Type-Guard + serverseitiger Rollen-/Owner-Durchsetzung in /api/sitzung; validate.py prüft progress 0–100; Report-«Stand» aus meta.today (deterministisch). NB: role/me clientseitig = Defense-in-Depth, keine echte Auth (Single-User-Localhost).
- **Tab «Input-Pflichten» aufgelöst (16.07., DRS):** 14/16 Inputs sind task-getriggert → eigener Tab war doppelte Buchführung. Jetzt kompakte Sektion «Offene Datenlieferungen» im Kontrollturm (nur offene, überfällige zuerst, Drive-Link, T-Kopplungen, manueller Knopf für ungekoppelte IN-02/IN-08); gelieferte verschwinden aus der Sicht. Datenmodell `inputs` in projekt.yaml UNVERÄNDERT — Reminder-Queue (CoS-Steuerung), Validierung und Kopplung laufen weiter.
- **Input↔Task-Kopplung (13.07., DRS «auto-geliefert»):** Inputs können `liefer_tasks: [task_ids]` tragen — Status wird dann ABGELEITET: `geliefert` sobald ALLE gekoppelten Handlungen erledigt (Sync in `/api/task/status`; Wiederöffnen ⇒ zurück auf `offen`). 14/16 gekoppelt; **IN-02 (Finanzierungsbetrag, externe #98-Achse) + IN-08 (Cottbus-Verfahren) bewusst ungekoppelt** (manueller Button bleibt). validate.py erzwingt Referenz-Existenz + Status-Konsistenz (Drift=FEHLER); Kopplung+Status überleben den Rebuild (Input-Preserve). UI: ⚙-Marker mit T-Nummern statt Manuell-Button.
- **Task-getriebener Fortschritt (13.07.2026, DRS: «treibend aufsetzen»):** Milestones können per `progress_source: 'tasks'` auf verdienten Fortschritt umgestellt werden — `progress` wird dann DETERMINISTISCH aus den Handlungen gerechnet (`erledigt/gesamt`, half-up; `rollupMs()` in rubicon-api.js, Parität in validate.py = FEHLER bei Drift). Ohne Flag bleibt `progress` manuell (kein Big Bang über 131 MS; Umstellung je MS als bewusster Akt NACH DRS-Freigabe der Zerlegung via `activate_ms`). Status-Kette: Ampel (status.js, UNVERÄNDERT) ← progress ← erledigte Handlungen. Endpoints: `/api/task/upsert` (nur CoS; UPSERT erhält status/erledigt_am) · `/api/task/status` (CoS immer, Owner nur eigene — analog Audit #3). `progress_source` überlebt den Rebuild (Progress-Preserve-Liste) UND den Loader (loader.js reicht es durch). **UI (13.07.):** `TaskSection` im Milestone-Modal (App.jsx) = Handlungsliste mit Abhak-Buttons (rollen-gesichert, Chairman/Teilnehmer lesend mit Lock-Hinweis); Abflugtafel-Spalte «HANDLUNGEN» (☑ x/y, ⚠ überfällig=due<meta.today) + KPI-Kachel «Handlungen offen». Abhaken merkt `rubicon_selms` VOR dem Fetch in sessionStorage (HMR-Reload kann schneller sein als die Antwort) → Modal öffnet nach Reload wieder; Tab wird generell in sessionStorage persistiert. Zerlegungen KI-gestützt aus dem Briefing ableiten, aber IMMER als Entwurf mit menschlicher Freigabe; due-Vorschläge nie als Fakt (Datenehrlichkeit).
- **Commitment→Handlung-Spiegel (13.07.2026, Schnitt 2):** `/api/sitzung` spiegelt jedes `typ:'commitment'` automatisch als Task in tasks.json (`mergeTasks()`-UPSERT — erhält status/erledigt_am; leerer Text wird übersprungen). **ID-Stabilität = De-Dup:** Gemini-Quelle → `G-<gemini_doc_id>-C<idx>` (Re-Import aktualisiert statt dupliziert; idx = Position im eintraege-Array), sonst `<protokoll_id>-C<idx>`. Optionale Milestone-Kopplung: Commitment-Eintrag in Modul B hat ms_id-Dropdown → gekoppelte Commitments treiben bei `progress_source:'tasks'` den Fortschritt (Nenner wächst — gewollt: Sitzung fügt dem MS Arbeit hinzu). `ms_id=null` erlaubt (validate: LÜCKE bei source sitzung/gemini, FEHLER bei zerlegung). «Offene Commitments» im Protokolle-Tab liest jetzt aus tasks.json (status-bewusst, Abhak-Kreis CoS/Owner-gated, ⚠ überfällig, ▸ms_id-Marker); erledigte fallen raus statt ewig offen zu stehen. Gemini-Import setzt NIE ms_id (nie raten) — Kopplung nachträglich via `/api/task/upsert`.
- **Gemini-Meet-Ingest (13.07.2026):** `import_gemini_doc.py` speist Google-Meet-Notizen über denselben `/api/sitzung`-Pfad wie Modul B ein — Dry-Run-Default, menschliche Freigabe (`--post`) vor jedem Write. `/api/sitzung` schreibt `projekt.yaml` jetzt NUR bei echten Milestone-Änderungen (`applied.length`), sonst bleibt die SSOT bytegleich stabil. Quellenbindung `source:'gemini'`+`gemini_doc_id/url` im Protokoll-Datensatz. **VERTRAULICHKEIT — GELÖST durch Sensitiv-Filter (16./17.07., Roadmap #6):** Checkbox «🔒 Sensitiv» beim Erfassen bzw. `--sensitiv` beim Gemini-Import → Protokoll landet in `src/data/protokolle_sensitiv.json` (gitignored, geht NICHT auf den Server/ins Repo, MIGRATION §5). Der Store wird über KEINEN Pfad ausgeliefert (Middleware-403, auch /@fs) und ist NUR via Loopback-gated `GET /api/protokoll/sensitiv` einsehbar — Härtung 17.07.: remoteAddress-Check reicht NICHT (Tailscale-Serve proxied von 127.0.0.1!), zusätzlich Host-Header==localhost + keine X-Forwarded-*-Header. Sensitive Sitzungen erzeugen KEINE Task-/Register-Spiegel (Wortlaut-Leak in geteilte Stores) und KEINEN Export (PDF/Doc-Sperre); nur Fortschritt/Blocker (aggregierte Zahlen) wirken auf Milestones. UI: 🔒-Badge, «kein Export (sensitiv)», Zähler-Hinweis; Netz-Clients sehen die Protokolle schlicht nicht.
- **CUTOVER 07.07.2026:** Der Commercial-Masterplan wird AUSSCHLIESSLICH hier
  (projekt.yaml) getrackt — masterplan.json ist EINGEFROREN (Snapshot
  `masterplan.FROZEN-20260707-rubicon-cutover.json`). Progress/Termine der
  M01–M43 direkt in projekt.yaml pflegen; der Rebuild (build_projekt_yaml.py)
  liest nur den Snapshot und ERHÄLT gepflegte Felder (Progress-Preserve).
