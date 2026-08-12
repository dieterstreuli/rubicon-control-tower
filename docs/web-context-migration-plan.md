# RUBICON — Migration in den eigenen Web-/Nutzerkontext

**Ziel:** Dieter nutzt künftig **ausschließlich die Web-App** und alle Funktionen laufen in **seinem eigenen
Google-Workspace-Kontext** (`d.streuli@axs.aero`): Drive/Docs, Gmail-Reminder/-Entscheidmails, Calendar-Termine,
später autonome Postfach-Verarbeitung. Schrittweise; Dieters heutiger lokaler Pfad bleibt bis zum jeweiligen
Cutover unangetastet.

**Architektur-Entscheid (Entscheid 09.08.2026):** Handlungs-Identität = **dynamischer DWD-Subject**. Der bestehende
Dienst-SA `rubicon-workspace@` impersoniert statt fix `rubicon@axs.aero` den **per IAP verifizierten** User. Kein
per-User-Browser-OAuth. Identitätsquelle = **IAP-Header** (`x-goog-authenticated-user-email`), den der Cloud-Run-Rand
bereits liefert, den der Code aber heute nicht liest.

## Global Constraints (gelten für jede Stufe)

- **Identität kommt vom Server, nie vom Client.** `role`/`me` werden aus der IAP-Identität abgeleitet, nicht mehr
  aus dem POST-Body vertraut. Client-Dropdown höchstens noch Auswahl innerhalb der erlaubten Menge.
- **Dual-Mode ist bis zum finalen Cutover PFLICHT (nicht verhandelbar):** lokal (Dieter, kein IAP/keine DWD-Env)
  läuft der bisherige Pfad **byte-identisch** weiter — jede Stufe fügt den Web-Kontext-Zweig ADDITIV neben dem
  lokalen hinzu, entfernt nie den lokalen Pfad. Dieter kann die App die ganze Migration hindurch wie gewohnt lokal
  nutzen. Kein Big-Bang. Erst der bewusste End-Switch (nach Abnahme aller Stufen) legt den lokalen Pfad still.
- **Cutover-Markierung mitschreiben:** jede lokale Referenz/Bindung, die additiv belassen wird, wird im Code mit dem
  greppbaren Tag **`RUBICON-CUTOVER`** kommentiert (kurzer Grund, was beim End-Switch zu entfernen ist) UND in die
  „Cutover-Refaktor-Liste" (unten) eingetragen. So ist der finale Switch ein abgegrenzter, vollständig
  vor-inventarisierter Schritt statt einer Suche. Regel je Stufe: lokale Abhängigkeit entweder JETZT entfernen (wenn
  die Stufe sie ablöst) ODER `RUBICON-CUTOVER`-taggen + listen.
- **DSGVO/EU:** Inferenz + Personendaten bleiben im EU-Tenant (`aixs-260106`), keine Dritt-SaaS. Sensible Daten s.
  Stufe 7.
- **Repo-Hygiene (Zeremonie):** keine KI-/Toolset-Spur in Commits/PRs/Code/Docs; Rahmen „IT/Didit". Outbound nur per
  PR (Ausnahmen nur auf ausdrückliche Ansage). Deterministische Report-Teile unverändert.
- **Wahrheitstreue:** „live/verifiziert" nur nach echtem Server-Smoke.

## Verifizierte Ausgangslage (Analyse 09.08.2026)

- **IAP** ist der einzige echte Auth-Layer (Gruppe `rubicon-app@axs.aero`, `--no-allow-unauthenticated`). Liefert die
  verifizierte E-Mail als Header — **im Code nirgends gelesen** (`plugins/api-core.js`, `server.mjs`: 0 Treffer).
- **DWD** eingerichtet, Subject **fix** `rubicon@axs.aero` (`RUBICON_IMPERSONATE_SUBJECT`). `_google_auth.load_credentials(scopes=None)`
  → `DEFAULT_SCOPES = drive+documents` (`scripts/_tools/_google_auth.py:24-27,97-104`). Am Client-ID `112708550499414880483`
  sind **6 Scopes autorisiert** (verifiziert, Admin-Konsole 09.08.2026): `drive`, `spreadsheets`, `documents`,
  `gmail.modify`, `gmail.send`, `calendar.events` — der Code fordert aber nur drive+documents an (Rest ungenutzt).
- **Tenant:** `axs.aero` und `did-it.ch` liegen im **selben Workspace-Tenant** → DWD impersoniert Nutzer beider Domains
  gleich (auch `g.suchomski@did-it.ch`), kein separater Grant nötig.
- **`role`/`me`** = freie Client-Dropdowns (`src/App.jsx:41-42,299-310`); `permissions.js`-Gate prüft nur die
  gesendeten Werte, keine echte Person.
- **`/api/state`** (`api-core.js:309-329`) hat **keine** Identität im Payload (Code-Kommentar Z.308: „Naht für Block B
  … rollen-gescopt" = offenes TODO).
- **`/api/sitzung`** (Sitzung→Tower) ist **schon voll serverseitig** (reine JSON-Writes). `gen_report --ki` läuft über
  Vertex (`ai_client.py`). `gen_docs_server.py` = sauberste Referenz.

---

## Stufe 1 — Identitäts-Fundament + Begrüßung (read-only, KEIN Kontextwechsel)

**Ziel:** App erkennt den angemeldeten Nutzer serverseitig, leitet Rolle ab, begrüßt und zeigt „was jetzt im Web geht".
Freigeschaltet für `d.streuli@axs.aero` + `g.suchomski@did-it.ch` (Test). Keine Google-Seiteneffekte.

**Dateien:**
- `plugins/api-core.js` — IAP-Identität lesen (`identityOf(req)`), in `/api/state` legen; `role`/`me` serverseitig ableiten.
- `src/lib/identity.js` (neu) oder `src/lib/data.js` — Identität ins SPA-State.
- `src/data/domain.json` **oder** neu `src/data/identity_map.json` — E-Mail→{person, rollen} + Test-User.
- `src/views/IntroView.jsx` + `src/App.jsx` (Header/Rollenband) — Begrüßungs-Panel „Angemeldet als … — im Web nutzbar: …".
- `src/lib/permissions.js` — `can()` gegen abgeleitete Rolle statt frei gewählte.
- `scripts/test_runtime_state.mjs` / neuer Test — Identitäts-Ableitung + Fallback.

**Tasks (bite-sized):**
1. `identityOf(req)`: liest `x-goog-authenticated-user-email` (Format `accounts.google.com:<email>` → E-Mail extrahieren);
   Fallback lokal (kein Header) = `RUBICON_DEV_IDENTITY` env oder `d.streuli@axs.aero`. Test: Header-Parsing + Fallback.
2. `identity_map.json`: `{ "d.streuli@axs.aero": {person, rollen:[CoS,…]}, "g.suchomski@did-it.ch": {person:"Test", rollen:[CoS]} }`.
   Loader + „unbekannte E-Mail → nur Leserolle".
3. `/api/state`: `identity: {email, person, rollen, isKnown}` ergänzen (sensible Stores bleiben ausgeschlossen).
4. Server-Gate: `role`/`me` aus Identität ableiten; POST-`role`/`me` nur akzeptieren, wenn in erlaubter Menge (sonst 403).
   **Übergangsschonend:** solange keine IAP-Identität da (lokal), altes Verhalten.
5. SPA: `identity` in State; Header zeigt „Angemeldet als <person> (<email>) — Rolle <X>" statt freiem Dropdown
   (Dropdown nur bei mehreren erlaubten Rollen).
6. **Begrüßungs-Panel** (IntroView/Landing): „Willkommen, <Person>. Diese Funktionen laufen jetzt im Web in deinem
   Kontext: …" — Liste dynamisch nach freigeschalteten Stufen. Einmal pro Session (sessionStorage), wegklickbar.
7. Test-User `g.suchomski@did-it.ch` in `identity_map.json` + IAP-Gruppe `rubicon-app@axs.aero` (Admin: Mitglied
   hinzufügen — **prüfen/anfordern**).
8. Tests grün, `npm run build`, Server-Smoke (Header simulieren), PR (Zeremonie).

**Admin-Vorbedingung:** `g.suchomski@did-it.ch` als Mitglied von `rubicon-app@axs.aero` (sonst kein IAP-Durchlass).

**Akzeptanz:** Aufruf als Dieter → „Angemeldet als Dieter Streuli", Rolle CoS aus Map, Begrüßung. Aufruf als
g.suchomski → erkannt + begrüßt (Testrolle). Kein Self-Assign CoS mehr möglich. Keine Google-Seiteneffekte berührt.

---

## Stufe 2 — Node-KI serverseitig (Vertex) + geparkten Bug beheben

**Ziel:** `/api/ask` „Frag die Daten" + `/api/task/suggest` laufen ohne lokales Binary. Behebt den geparkten
ENOENT-Bug.

**Status: ERLEDIGT (10.08.2026).** Umgesetzt: neuer Wrapper `scripts/ai_ask.py` (Prompt via stdin → `ai_client.generate`
→ stdout); `runClaudeOnce` shellt statt des lokalen Binaries `PY_BIN scripts/ai_ask.py`; `CLAUDE_BIN`- und
`HOME`-Default aus dem Node entfernt. Dual-Mode gewahrt (lokal ohne `RUBICON_AI_PROVIDER` = alte CLI; Server = Vertex
`claude-sonnet-5` @ `eu`). Zusammen mit I2/M1 (unten) via Live-Smoke bestätigt (40/40).

**Dateien:** `plugins/api-core.js` (`runClaude`/`runClaudeOnce`, `CLAUDE_BIN`, `/api/ask`, `/api/task/suggest`);
`scripts/_tools/ai_client.py` (Bridge-Einstieg); `Dockerfile` (falls Node-Vertex-Client).

**Ansatz (empfohlen):** die zwei Endpoints leiten auf einen **Python-Subprozess `ai_client.generate`** um
(execFile `PY_BIN`, Prompt via stdin) — reuse des bereits deployten Vertex-Pfads (SA `rubicon-ai@`, sonnet-5@eu),
dual-mode (lokal ohne `RUBICON_AI_PROVIDER` = alte CLI). `CLAUDE_BIN`/`HOME`-Default auf Dieters Pfad entfernen; im
Server-Modus (`IS_SERVER`) **nie** ein lokales Binary spawnen.

**Entscheidung `/api/ask` (10.08.2026):** `/api/ask` bleibt **bewusst ungegated** (rein lesende NL-Abfrage; passt zur
Stufe-1-Entscheidung „Read voll transparent"). Nur der KI-Backend-Umbau greift hier. `/api/task/suggest` bleibt wie
gehabt `ki.nutzen`-gegated. Die Prompt-Kontext-Begrenzung bleibt eine spätere, optionale Optimierung.

**Akzeptanz (erfüllt):** „Frag die Daten" + KI-Zerlegung antworten serverseitig (Vertex), kein ENOENT; lokal
unverändert; Rollen-Härtung (I2/M1) greift und ist per Live-Smoke belegt (40/40).

**Vorgemerkt aus dem Stufe-1-Review — in Stufe 2 umgesetzt (10.08.2026):**
- **I2 · `me`-Identitätsbindung (Server) — ERLEDIGT:** `requireIdentityRole` bindet unter echtem IAP-Login bei
  `role==='Owner'` die freie `me`-Wahl an `identity.person` (`ownerMeDenied` in `plugins/identity.js`); ohne IAP oder
  für andere Rollen No-op. So kann ein IAP-Owner nicht mehr unter fremdem Namen handeln.
- **M1 · Rollen-Gate für Report-/Protokoll-Endpoints — ERLEDIGT:** `/api/report/generate`, `/api/protokoll/export`,
  `/api/report/comment` sind jetzt `requireIdentityRole` + `requireCan(…, 'report.erzeugen')`-gegated (Frontend reicht
  `role`/`me` mit). Ohne IAP freies Verhalten; unter IAP greift das Gate (Smoke: „nur lesend" → 403).

---

## Stufe 3 — Dynamischer DWD-Subject = angemeldeter User

**Ziel:** Drive/Docs/Gmail/Calendar handeln als der eingeloggte User (Dieter) statt als `rubicon@axs.aero`.

**Dateien:** `scripts/_tools/_google_auth.py` (`load_credentials(subject=…)`); alle Aufrufer bekommen den Subject
durchgereicht (Node-Endpoints hängen die IAP-Identität als `--subject`/Env an die execFile-Aufrufe).

**Tasks:** `load_credentials` akzeptiert expliziten `subject` (überschreibt `RUBICON_IMPERSONATE_SUBJECT`); Node reicht
`identityOf(req).email` an die Skripte; Default bleibt `rubicon@axs.aero` für unpersonalisierte Batch-Jobs (docs-job).

**Admin-Vorbedingung:** DWD-Freigabe deckt **domänenweite** Impersonation von axs.aero-Usern (Client-ID
`112708550499414880483`) — verifizieren, dass beliebige axs.aero-Subjects erlaubt sind (nicht nur `rubicon@`).

**Akzeptanz:** ein Server-Call mit Subject=`d.streuli@axs.aero` erzeugt ein Doc/Drive-Objekt in **Dieters** Kontext
(Owner/Sichtbarkeit belegt per Smoke).

**STATUS (11.08.2026) — erste Scheibe LIVE-verifiziert (Meetingnotiz-Import):**
- `load_credentials(subject=…)` überschreibt `RUBICON_IMPERSONATE_SUBJECT` (nur Server-Modus; lokal ohne DWD-Env
  wirkungslos → User-OAuth). Sicherheit: `plugins/identity.js` `dwdSubject(id)` liefert die E-Mail **nur** bei echtem
  IAP-Login (`viaIap`), sonst `null` → der Subject stammt NIE aus dem Request-Body (keine Impersonation-Injection);
  Node-Route `/api/gemini/import` reicht `dwdSubject(gid)` als `--subject` durch, `import_gemini_doc.py --subject` →
  `get_drive(subject)`. Härtung: option-aussehende `body.doc_id` (führendes `-`) wird abgelehnt (kein `--subject=`/
  `--post`-Schmuggel über argparse). Tests: `test_google_auth_dwd` (subject-override + local-ignore), `test_identity`
  (dwdSubject-Gating).
- **Admin-Vorbedingung VERIFIZIERT:** `rubicon-workspace` darf **beliebige** axs.aero- UND did-it.ch-Subjects
  impersonieren (Live-Smoke: rubicon@ / d.streuli@axs.aero / g.suchomski@did-it.ch je OK). Ein frischer
  tokenCreator-Grant braucht ~1 Min IAM-Propagation (sonst transientes 403).
- **Akzeptanz belegt (Live):** Notiz als `g.suchomski` in dessen My-Drive angelegt + als `g.suchomski` gefunden
  (50 persönliche Gemini-Docs sichtbar); als `rubicon@` **nicht** sichtbar (404) → Per-User-Kontext + Isolation bestätigt.
- **Offen (Follow-up):** Scope-Verengung auf `drive.readonly` für den Import geht NICHT per Code — DWD ist Exact-Match
  auf `drive`+`documents`; bräuchte erst eine Admin-Scope-Freigabe. Gmail/Calendar (Stufe 4) noch als `rubicon@`.

---

## Stufe 4 — Gmail in Dieters Konto (Reminder + Entscheid-Mails)

**Dateien:** `scripts/gen_reminder_mail.py:148`, `scripts/gen_entscheid_mail.py:149` — `load_credentials(subject=me,
scopes=[…/gmail.modify])`. README/DEPLOYMENT-Statuszeilen von „⏳ geplant" auf „✅ live" (nach Smoke).

**Tasks:** expliziter `gmail.modify`-Scope (autorisiert; deckt Draft-Anlage + spätere Postfach-Verarbeitung Stufe 8);
Subject = angemeldeter User → Entwurf landet in **seinem** Postfach;
`mcp/calendar_bridge.md`-Gmail-Weg als deprecated markieren/entfernen.

**Akzeptanz:** „Reminder senden" erzeugt einen Gmail-**Entwurf im Postfach des angemeldeten Users** (kein Auto-Send);
Entscheid-Mail mit PDF-Anhang ebenso.

**Status: ERLEDIGT (12.08.2026).** `create_draft` in `gen_reminder_mail.py` + `gen_entscheid_mail.py` nimmt einen
`me`-Subject + fordert `gmail.modify` an (Entscheid zusätzlich `drive` für die Anhänge); die Node-Endpoints
`/api/reminder/draft` und `/api/entscheid/status`(→kommuniziert) reichen den Subject **nur aus der verifizierten
IAP-Identität** (`resolveIdentity`→`dwdSubject`) als `--subject` durch — identisch zum Stufe-3-Muster von
`/api/gemini/import`; option-aussehende Client-Werte (Empfänger/Auswahl mit führendem `-`) werden abgewiesen.
Dual-Mode gewahrt (lokal ohne DWD-Env unverändert). **Einmalig die Gmail-API im Projekt aktiviert**
(`gmail.googleapis.com`, sonst `accessNotConfigured`). **Mechanik + Isolation per DWD-Smoke bestätigt**
(Impersonation eines Test-Subjects: Entwurf landet in dessen Postfach, ein anderes Betriebskonto sieht ihn nicht,
danach gelöscht); **end-to-end über echten IAP-Login wirksam mit dem Deploy**. `mcp/calendar_bridge.md`-Gmail-Weg
als hinfällig markiert. Damit ist Zeile 152 (Follow-up „Gmail/Calendar noch als rubicon@") für Gmail erledigt.

---

## Stufe 5 — Kalender + Eskalation (Neubau, heute rein simuliert)

**Dateien:** neuer `scripts/gen_calendar_event.py` (analog gen_reminder_mail); neuer Endpoint `/api/kalender/event`
(`plugins/api-core.js`); Eskalationsmatrix als **Daten** (`src/data/eskalation.json` oder `_kontakte.py`);
`src/App.jsx` `remind()` → echter `runAction`-fetch statt `[SIMULIERT]`-Logzeile; persistentes Log (wie
`reminder_log.json`).

**Scope:** `calendar.events` (admin-autorisiert; Code muss ihn anfordern).

**Akzeptanz:** „Kalender" erzeugt einen echten Calendar-Event in Dieters Kalender; „Eskalieren" erzeugt einen
Gmail-Entwurf an die nächste Eskalationsstufe (Matrix-basiert) + persistentes Log.

**Status: ERLEDIGT (12.08.2026).** `gen_calendar_event.py` (Scope `calendar.events`, Subject=User) → echter
30-Min-Koordinationstermin am Fälligkeitstag, Teilnehmer = Owner + `immer_einladen`-Liste (Default DRS);
`sendUpdates` konfigurierbar (Default `none` = still). `gen_eskalation_mail.py` (Scope `gmail.modify`) → Gmail-
Entwurf (nie Send), To=Owner, CC=`eskalation.json` (`per_owner` sonst `default_cc`, sonst Default DRS). Node-
Endpoints `/api/kalender/event` + `/api/eskalation/mail` (CoS-gated, Subject nur aus IAP, `/^-/`-id-Guard);
`src/App.jsx` `remind()`-SIMULIERT → echte Fetches, Status im Automations-Log. Konfig in `src/data/kalender.json`
+ `src/data/eskalation.json` (Resolver in `_kontakte.py`, robust gg. fehlende/kaputte/null-Felder → Default DRS).
**Calendar-API im Projekt aktiviert.** Per DWD-Smoke bestätigt: Event + Eskal-Entwurf im Kontext des
angemeldeten Users, ein anderes Betriebskonto sieht beide nicht, `sendUpdates=none` = keine Mails; danach gelöscht.
**ANNAHME (DRS spezifiziert nach):** die Eskalations-Matrix hat nur einen Default (kein Owner→Vorgesetzten-Mapping
— die Owner sind GL-Ebene); `per_owner` bleibt für DRS zu füllen. **Zukunft:** `RUBICON-CUTOVER: future-rubicon-identity`
— Subject heute = User, später eigene `rubicon@`-Identität per Config/Env; die `immer_einladen`-Liste sichert, dass
DRS/Liste dann trotzdem Teilnehmer ist. `mcp/calendar_bridge.md` (Kalender-/Eskalations-Weg) damit hinfällig.

---

## Stufe 6 — „Notiz suchen" als Dieter + `gen_protokoll.py`-Dual-Mode + Cleanup

- **Notiz suchen:** mit Subject=Dieter (Stufe 3) sieht die Drive-Suche seine persönlichen Gemini-Meet-Notizen →
  Server-Smoke, ob Treffer kommen. `TOWER_ORIGIN`-Hardcoding (`127.0.0.1:8621`) auf Env.
- **`gen_protokoll.py`** auf `gen_report.py`-Muster heben: `_is_server`-Zweig (direkt gdoc/doc_template statt
  `md_to_gdoc`-Template-Copy → behebt fehlende `chief_templates.json`-Crash bei Erst-Anlage), `server_doc_id`/`_url`
  getrennt, Ziel-Ordner per Env.
- **Lokale-Pfad-Cleanup:** `sys.path.insert('/Users/dieterstreuli/Chief/Tools')` in ~10 Skripten entfernen (vendored
  `scripts/_tools/` = kanonisch); toter `gen_traktanden_docs.py`, `serve.sh`, `reports_cron.sh` archivieren;
  `RUBICON_PY`/`RUBICON_CLAUDE`/`HOME`-Mac-Defaults entschärfen.

---

## Stufe 7 — Sensible Daten (3-stufige Evolution, Entscheid IT/Didit)

Heute: `protokolle_sensitiv.json` strikt Gerät-only (`isLoopback`-403, git-/dockerignored). Risiko: Datenverlust
(nur auf einem Mac).

1. **Kurzfristig:** Gerät-only bleibt (unvermeidbar im ersten Schritt), aber **Backup** absichern.
2. **Mittelfristig — Account-only:** Ablage in Dieters **persönlichem GWS-Konto** (sein Drive, via Subject=Dieter),
   nicht mehr nur lokale Datei → web-erreichbar für ihn, kein Datenverlust.
3. **Zielbild — geteilte Ablage mit dedizierter ACL:** segregierter Store (eigener KMS-Key/enge Gruppen-ACL, EU),
   Zugriff nach IAP-Identität statt IP. (DEPLOYMENT §7 offener Punkt „Vertrauliche Daten segregieren".)

**Akzeptanz je Teilschritt eigener Smoke + DSGVO-Review.**

---

## Stufe 8 — Autonome Postfach-Verarbeitung (Endvision)

App verarbeitet Dieters Postfach selbstständig (Reminder-Antworten, Statuslieferungen erkennen). Braucht
`gmail.modify`/read-Scopes + Design (Trigger, Idempotenz, Sicherheit). Erst nach Stufe 1-7.

---

## Cutover-Refaktor-Liste (lokale Referenzen — beim finalen End-Switch entfernen)

Tag im Code: `RUBICON-CUTOVER`. Diese Liste ist die vollständige Karte für den finalen Switch; sie wächst, während
wir Stufen umsetzen (jede belassene lokale Bindung wird hier + im Code getaggt). Vor-inventarisiert aus der Analyse:

- **`plugins/api-core.js:20`** — `CLAUDE_BIN` Default `/Users/dieterstreuli/.local/bin/claude` → in Stufe 2 entfernt
  (Node-KI auf Vertex). **`:37`** `HOME`-Fallback `/Users/dieterstreuli` ebenso.
- **`plugins/api-core.js:19`** — `PY_BIN` macOS-Framework-Default (Env-Override greift; Default beim Switch entfernen).
- **`scripts/ai_ask.py` + `scripts/_tools/ai_client.py:_local_cli` / `RUBICON_CLAUDE`-Default** — der lokale
  CLI-Rückfall der Modell-Fassade (Node shellt `ai_ask.py` → `ai_client.generate`, das ohne `RUBICON_AI_PROVIDER` die
  `claude`-CLI ruft). Beim Web-only-Switch entfällt der CLI-Zweig; nur der Vertex-Pfad bleibt.
- **`scripts/_tools/_google_auth.py:15-21,69-94,101-104`** — lokaler User-OAuth-Fallback: `CREDS_DIR ~/.config/google-mcp`,
  `ACCOUNTS`-Registry, `_load_user_credentials()`, der `return _load_user_credentials(account)`-Else-Zweig. Beim Switch:
  DWD-Pfad wird alleinig, lokaler Zweig raus.
- **`sys.path.insert('/Users/dieterstreuli/Chief/Tools')` (~12 Stellen)** — `gen_traktanden_docs.py:17`,
  `gen_protokoll.py:25,32`, `gen_report.py:54,59`, `gen_fuehrungsrhythmus_pdf.py:18`, `gen_entscheid_mail.py:30`,
  `gen_reminder_mail.py:42`, `gen_briefing_pdfs.py:21`, `gen_traktanden_pdfs.py:15`, `import_gemini_doc.py:40`,
  `scripts/_tools/md_to_gdoc.py:24`, `validate.py:357`. Vendored `scripts/_tools/` = kanonisch → lokale Pfad-Inserts raus.
- **Hardcodierter Account `d.streuli@axs.aero`** — Default in `load_credentials()` + Call-Sites (`import_gemini_doc.get_drive`,
  `gen_reminder_mail`/`gen_entscheid_mail.create_draft`); mit dyn. Subject (Stufe 3) obsolet → entfernen/als Nur-Dev markieren.
- **Lokale Doc-Erzeugungs-Else-Zweige** — `gen_report.py:308-319` (md_to_gdoc-Subprocess), `gen_protokoll.py` (Stufe 6
  bekommt Server-Zweig; danach lokalen Zweig entfernen).
- **`import_gemini_doc.py` `TOWER_ORIGIN=http://127.0.0.1:8621`** — in Stufe 6 auf Env; Hardcode beim Switch weg.
- **`src/App.jsx` `role`/`me`/Dropdown** — ab Stufe 1 aus der IAP-Identität abgeleitet, **aber nur bei echtem
  IAP-Login (`viaIap`)**. Der hartkodierte Default-Owner „Andreas Fritthum" wurde in Stufe 1 bereits entfernt.
  Der `viaIap`-Nein-Zweig (volles Rollen-Dropdown + freie `me`-Wahl, ohne Server-Durchsetzung) ist der
  Dual-Mode-Rest für den Nicht-IAP-Betrieb (lokal/Tailnet) und entfällt beim finalen Web-only-Switch.
- **Nicht-IAP-Fallback / Tailnet-Zugang** — `resolveIdentity`-Dev-Fallback (`plugins/identity.js`), das
  `id.viaIap`-Gate im Write-Gate (`requireIdentityRole`), sowie der Tailnet-Origin in `OK_ORIGINS`
  (`plugins/api-core.js`, `…tail018620.ts.net:8621 // Tailnet-Zugang (Andreas etc.)`). Beim Web-only-Switch:
  Dev-Fallback + `viaIap`-Verzweigung + Tailnet-Origin entfernen → IAP-Identität gilt dann überall (s. Frage an Dieter).
- **Tote/lokale Launcher & Redundanz** — `gen_traktanden_docs.py` (redundant zu `gen_docs_server.py`), `serve.sh:4-5`,
  `scripts/reports_cron.sh:6` (durch Cloud-Run/Scheduler ersetzt). Beim Switch archivieren/entfernen.
- **Sensible Daten** — `isLoopback`-Gerät-only (api-core.js:283-301) ist KEIN „entfernen", sondern Stufe-7-Ablösung
  (Account-only → geteilte ACL). Hier nur als Cutover-relevant vermerkt, nicht als Löschung.

## Finaler Web-only-Switch — Frage an Dieter + Entscheidung (Tailnet-Betrieb)

**Hintergrund:** Die Identitäts-Erkennung/-Durchsetzung greift **nur bei echtem Google-IAP-Login** (Cloud Run).
Dein heutiger **lokal laufender Server, via Tailnet geteilt** (Andreas u.a., `OK_ORIGINS`-Tailnet-Origin) hat **kein
IAP** — dort gilt bewusst weiterhin das **alte freie Verhalten** (Rollen frei wählbar, keine Server-Durchsetzung,
keine Identitäts-Anzeige). Ohne diese Kopplung würde jeder Tailnet-Nutzer als „Dieter Streuli [CoS,Owner]" erkannt
(Privilege-Escalation + Fehlzuschreibung) — deshalb das `viaIap`-Gate.

**Entscheidung (Stufe 1):** Identitäts-Logik nur unter IAP; Nicht-IAP = altes freies Verhalten bewahrt (Dual-Mode).

**FRAGE AN DIETER (vor dem finalen Web-only-Switch zu beantworten):** Soll der **Tailnet-geteilte Lokal-Betrieb
abgekündigt** werden, sodass Andreas & Co. künftig **ausschließlich über die Cloud-Run-Web-App (mit IAP-Login)**
zugreifen? Erst dann können Dev-Fallback, `viaIap`-Verzweigung und der Tailnet-Origin entfernt werden und die
IAP-Identität gilt lückenlos. Solange der Tailnet-Betrieb bestehen bleibt, bleibt der Nicht-IAP-Zweig (ungesichert)
erhalten — d.h. der Web-only-Switch ist **nicht abschließbar**, bevor diese Frage geklärt ist.

## Offene Admin-Schritte (früh klären)

- `g.suchomski@did-it.ch` in Gruppe `rubicon-app@axs.aero` (IAP-Durchlass) — Stufe 1.
- **VOR dem Stufe-1-Deploy zwingend (sonst Prod-Write-Lockout):** `identity_map.json` muss im GCS-Volume liegen —
  das Volume verdeckt die ins Image gebackene Datei. Einmaliger Seed: `gcloud storage cp src/data/identity_map.json
  gs://aixs-rubicon-tower-data/identity_map.json` (Projekt aixs-260106). Danach hält sie die Merge-Brücke aktuell
  (`identity_map.json` ist in `merge_bridge.py` `STAMMDATEN` aufgenommen). `RUBICON_IAP_ACTIVE=1` ist am App-Service
  gesetzt (deploy.yml) — Identitäts-Durchsetzung greift nur bei echtem IAP-Login.
- **Erledigt/verifiziert:** 6 DWD-Scopes am Client-ID `112708550499414880483` autorisiert (drive/spreadsheets/
  documents/gmail.modify/gmail.send/calendar.events); `did-it.ch` + `axs.aero` = selber Tenant → DWD impersoniert
  beide Domains (inkl. g.suchomski) ohne Zusatz-Grant. **Rest ist reiner Code** (Subject durchreichen + `scopes=`
  anfordern), kein weiterer Admin-Schritt für die Kern-Funktionen.
