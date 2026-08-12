# RUBICON Control Tower

Kontrollturm-Plattform für **Projekt RUBICON** («Alea iacta est.») — den
Transformationsplan der AXS Group 2026/27. Bildet die Programm-Ströme + den
Commercial-Masterplan ab, erkennt Verzug deterministisch, projiziert das
Kern-Projektende und übernimmt (simuliert) die Durchsetzungsfunktion des CoS.

> **Kanonisches Repo:** `diditgmbh/rubicon-dst`, Branch **`main`**. Das frühere
> `diditgmbh/rubicon-control-tower` ist ein **archivierter Read-only-Mirror** —
> nicht mehr verwenden. Live-Umgebung: **https://rubicon.axs.aero**.

## Setup (lokal / Entwicklung)

```bash
npm install
npm run validate   # Schema-/Integritäts-Report für src/data (Drive-Link-Check: RUBICON_SKIP_LINKCHECK=1)
npm run dev        # Vite-DEV http://localhost:8621
npm run serve      # Produktions-Server lokal: build + node server.mjs
```

Python-Abhängigkeit für den Validator: `pip3 install pyyaml`.

## Bedienung

- **Steuerungsdatum** = `meta.today` in `src/data/projekt.yaml` (bewusst manuell
  für reproduzierbare Sichten — bei jeder Steuerungssitzung nachführen).
- **Rollen** oben rechts: CoS (volle Steuerung) · Owner (eigener Strom
  editierbar; Identität wählbar) · Chairman/Teilnehmer (lesend).
- **Mehr-Projekt-Sicht:** AXS-Gesamt ist Default; Programm ist ein Filter
  (Scope-Kacheln). Ungekoppelte Handlungen erscheinen nur in AXS-Gesamt.
- **Version prüfen:** Footer zeigt **`Stand TT.MM.JJJJ HH:MM`** (Build-Zeit);
  Hover darauf → **`Build <sha>`** (Git-SHA). So ist zweifelsfrei erkennbar,
  welcher Stand live ist.

## Deployment & geteilte Umgebung (seit 05.08.2026)

Die App läuft als **geteilte Umgebung** unter **https://rubicon.axs.aero** —
das ist die gemeinsame Wahrheit für Didit + DRS. Lokale Instanzen dienen nur der
Entwicklung, **nicht** als Parallel-Produktion.

**Architektur (Betrieb: Didit / GCP-Projekt `aixs-260106`):**
- **Cloud Run** Service `rubicon-tower` (europe-west4), Container = `node server.mjs`
  (eigenständiger Server, serviert `dist/` + `public/` + die `/api/*`-Endpoints).
- **IAP** vor dem Dienst; Zugang nur über die Gruppe **`rubicon-app@axs.aero`**
  (Mitglieder dort einladen). `--no-allow-unauthenticated`, `max-instances=1`.
- **Persistenz:** GCS-Volume **`aixs-rubicon-tower-data`** (EU, europe-west4)
  gemountet auf `/app/src/data`. **Alle Schreibvorgänge** (tasks/entscheide/
  protokolle/zielbild) landen dort und **überleben Neustart/Redeploy** — der
  frühere „flüchtiges Cloud-Run-FS"-Vorbehalt ist damit erledigt.
- **Dokument-Persistenz:** Beim Ausliefern hat **`RUBICON_DOCS_DIR`**
  (= `/app/src/data/_generated` auf dem GCS-Volume) Vorrang vor der ins Image
  gebackenen `public`-Baseline. Reports (Woche/Monat/Quartal) werden
  serverseitig **chromefrei** über die gebrandete **Vorlagen-Engine (Weg 1)** erzeugt (Google Doc +
  Drive-`files.export`, s. `DEPLOYMENT_GCP.md` §9) und landen dort — sie überleben damit Neustart/Redeploy.
  Briefings/Entscheide/Traktanden/Führungsrhythmus laufen **serverseitig live**
  (Weg 1, `gen_docs_server.py`, chromefrei via Docs-Export; Cloud-Run-Job
  `rubicon-docs-job`, `DEPLOYMENT_GCP.md` §12). Der dynamische HTML-PDF-Pfad
  (Protokolle) rendert serverseitig über den **eigenen privaten Cloud-Run-Service
  `rubicon-gotenberg`** (per OIDC, `RUBICON_GOTENBERG_URL`) statt lokales Chrome —
  **Chromium muss dafür nicht ins Image**.
- **Datenbezug (Runtime-Fetch):** Der Client holt die Daten **zur Laufzeit** über
  `GET /api/state` aus dem Volume (statt sie zur Build-Zeit ins Bundle zu backen) —
  Server-Writes sind damit **nach einem Reload sichtbar**. Der Sensitiv-Store bleibt
  davon ausgenommen (loopback-only).
- Details/Runbook: **`DEPLOYMENT_GCP.md`**.

**CI/CD — Push auf `main` deployt automatisch:**
- `.github/workflows/deploy.yml`: Auth **keyless via Workload Identity Federation**
  (kein Key im Repo) → Docker-Build (mit Build-Stamp) → Push in Artifact Registry
  → `gcloud run deploy` (Volume + IAP bleiben erhalten).
- Ein **Code-Deploy fasst die Daten NICHT an** (das Volume überschattet die ins
  Image gebackene `src/data`) — Deploys sind datensicher.

## Zusammenarbeit: Kunde (DRS) ↔ IT (Didit) — Rollentrennung

Die Plattform wird gemeinsam betrieben. Klare Rollentrennung, damit fachliche und
technische Arbeit sich nicht überschreiben und Datenstände nicht divergieren:

- **Fachlich-inhaltlich federführend: der Kunde (DRS).** Programm-/Projektdaten,
  Features, Zielbild-Katalog, Governance-Inhalte — das treibt und verantwortet DRS.
- **Umsetzung, Infrastruktur & Regulatorik: die IT (Didit).** Betrieb (GCP/Cloud Run/
  IAP/WIF/Bucket/Domain/Backups) und Deployment-Pipeline, sowie die **Prüfung von
  Anforderungen auf Einhaltung gesetzlicher und interner Regulatorien** (u.a.
  Datenhaltung/DSGVO, Zugriffs- und Secret-Management).

Betriebsregeln (für alle Beteiligten):

1. **Eine geteilte Umgebung.** `rubicon.axs.aero` ist der gemeinsame Live-Stand.
   **Nicht** lokal als „Produktion" parallel fahren — lokal nur `npm run dev` zum
   Entwickeln. So gibt es keinen zweiten, abweichenden Datenstand mehr.
2. **Ein kanonisches Repo + Branch/PR.** Alles in `rubicon-dst`. Bitte über
   **Feature-Branch + Pull Request** auf `main` arbeiten (kleine, häufige PRs),
   nicht mit langen Direct-to-`main`-Serien — sonst überschreiben sich Commits.
   Merge auf `main` löst automatisch den Deploy aus.
3. **Laufzeit-Daten leben im EU-Volume, nicht im Repo.** Die Cloud-Wahrheit ist
   das GCS-Volume. `src/data` im Repo ist nur **Seed/Baseline**. **`src/data`
   NICHT blind neu seeden** — das würde die im Volume aufgelaufenen Live-Writes
   (protokolle/entscheide/zielbild) überschreiben. Baseline-Daten ändern = bewusster,
   dokumentierter Re-Seed **mit vorherigem Backup** (siehe `DEPLOYMENT_GCP.md`).
4. **Single-Writer.** `max-instances=1` ist Absicht (ein Schreiber gegen das
   Volume). Nicht hochskalieren ohne Datenschicht-Umbau (Firestore/CAS).
5. **DSGVO/Secrets — nichts davon ins Git** (von der IT geprüft/durchgesetzt).
   Weder Credentials noch Personendaten. `src/data` trägt heute noch Personendaten
   (`kontakte.json`, owner-Namen in `projekt.yaml`/`tasks.json`); die **Entkopplung**
   (Daten nur ins EU-Volume, `src/data`+`dist/` aus Git) ist als **Phase 2** geplant.
   Bis dahin bitte **keine neuen** Personendaten committen. `.gitignore`; gitleaks-Gate.
   `dist/` + Render-HTML sind bereits aus Git (Build-Output) — der **Data-Guard**-CI-Check
   (`.github/workflows/data-guard.yml`) schlägt fehl, falls sie wieder eingecheckt werden
   (Fix: `git rm -r --cached <pfad>`; `dist/` wird im Container gebaut).
6. **Cloud-/IAM-/Deploy-Änderungen laufen über die IT** (bzw. abgestimmt) — nicht
   doppelt, damit sich Infrastruktur-Stände nicht gegenseitig überschreiben.

## Changelog (IT / Didit)

**12.08.2026 — Reminder-/Entscheid-Gmail-Entwürfe im Konto des angemeldeten Nutzers:**

- **Erinnerungs- und Entscheid-Mails landen jetzt als Entwurf im Postfach des angemeldeten Nutzers:**
  „Reminder senden" und die Entscheid-Kommunikation („kommuniziert") erzeugen den Gmail-**Entwurf**
  (nie automatischer Versand) serverseitig **im Postfach des per Login (IAP) erkannten Nutzers** statt in
  einem festen Betriebskonto — über dieselbe server-verifizierte Delegation wie der Notiz-Import. Der
  Absender-Kontext ist damit der Nutzer selbst; der Entscheid-Entwurf trägt weiterhin das Register-PDF (und
  hinterlegte Anhänge) im Anhang.
- **Sicherheit:** der Postfach-Kontext stammt ausschliesslich aus der verifizierten Login-Identität, **nie**
  aus Client-Eingaben; option-aussehende Eingaben (führendes `-` in Empfänger/Auswahl) werden abgewiesen.
  Ohne echten Login bleibt das bisherige lokale Verhalten unverändert.

**11.08.2026 — Meetingnotiz-Import im Nutzerkontext; Wochen-Report-KI wieder vollständig:**

- **Notiz-Import liest jetzt das Drive des angemeldeten Nutzers, nicht mehr ein festes Betriebskonto:**
  beim Import einer Meeting-/Gemini-Notiz übernimmt der Server den **Drive-Kontext des per Login (IAP)
  erkannten Nutzers**, sodass dessen persönliche Meet-Notizen gefunden werden. Technisch wird das
  Delegations-Subjekt pro Anfrage aus der **serverseitig verifizierten Login-Identität** abgeleitet.
- **Sicherheit:** das Subjekt stammt ausschliesslich aus der IAP-Identität, **nie** aus Client-Eingaben;
  ohne echten IAP-Login greift kein Nutzerkontext (Betriebskonto-Verhalten wie bisher). Eine
  Dokument-ID, die wie eine Option aussieht (führendes `-`), wird abgewiesen.
- Begrüssungs-Panel: der Punkt „Notiz-Suche in deinem Konto" ist damit **aktiv** markiert.
- **Leerer KI-Block im Wochen-Report behoben:** das Modell erzeugte das Wochen-Narrativ zwar vollständig,
  die Antwort wurde aber am Token-Budget abgeschnitten (das Modell „denkt" vor der Antwort und rechnet
  dieses Denken gegen das Budget — beim Wochen-Report allein ~2.8k Denk-Tokens), sodass das JSON-Narrativ
  unvollständig ankam und als „keine Auffälligkeiten" leer blieb. Das Antwort-Budget wurde erhöht (4096 →
  8192), sodass Denken **und** vollständiges Narrativ + Ampel-Begründungen Platz haben. Ein abgeschnittenes
  Ergebnis wird künftig als klarer Fehler sichtbar gemacht statt sich stumm als „leer" zu tarnen.

**10.08.2026 — Reporte auf die gebrandete Vorlagen-Engine; Identität, IAP-Rollen-Gate & serverseitige KI:**

_Reporte & Vorlagen (Weg 1):_
- **Reporte serverseitig auf die Vorlagen-Engine:** die serverseitige Report-Erzeugung (Woche/Monat/Quartal)
  läuft jetzt über die **AXS-gebrandete Vorlagen-Engine (Weg 1)** statt über den früheren Markdown→Doc-
  Zwischenweg — ein einheitlich gebrandetes Google-Doc + PDF mit **Logo im Header auf jeder Seite**,
  **Seitenzahlen** und dynamischer Fusszeile. Der **KI-Entwurf** (Narrativ + Ampel-Begründungen) steht damit
  erstmals **im Doc selbst** (vorher nur im lokalen PDF-Pfad) und wird für **alle Ebenen** erzeugt (bisher nur
  Woche); im UI ist die KI-Checkbox per Default aktiv (für einen schnellen Report ohne KI abwählbar).
  Ampel/Zahlen bleiben deterministisch; der KI-Block ist klar als ungeprüfter Entwurf markiert.
- **Vollständigkeit gewahrt:** die Reporte enthalten alle bisherigen Inhalte (VR: Kennzahlen inkl.
  Kern-Ende-Projektion, Sequenz-Gates, Entscheidungsbedarf mit Quelle, Top-Risiken; Monat: Bewegungen,
  Fortschritts-Meldungen und Kommentare je Strom, überfällige Commitments; Woche: Δ-Fenster + Ampel-
  Wechsel/Fortschritt/erledigte Handlungen/Entscheide, Aktivität je Strom) — erweitert um Branding,
  Seitenzahlen und den KI-Block. Es geht kein Inhalt verloren.
- **Einheitliche Basis für alle Vorlagen:** eine gemeinsame „Report-Basis" (Marke + Seitenzahlen +
  dynamische `{{FOOTER}}`-Fusszeile) wird kopiert und je Typ nur der Rumpf gefüllt. Die vier bestehenden
  Fix-Struktur-Vorlagen (Traktanden/Entscheid/Briefing/Führungsrhythmus) laufen jetzt auf **derselben
  Basis**. Vorlagen-Bau reproduzierbar unter `scripts/templates_build/` (inkl. Anker-Manifest); IDs in
  `scripts/_tools/rubicon_templates.json`.
- **Report-Kommentar sichtbar & löschbar:** das Programm-/Chairman-Statement-Feld lädt einen bereits
  gespeicherten Kommentar (sichtbar + editierbar) und leert ihn auf Wunsch (leeres Feld löscht den Eintrag
  serverseitig) — so bleiben keine unsichtbaren Alt-Kommentare mehr stehen.
- **Dual-Mode unverändert:** der Server fasst nur `server_*`-Felder an; Dieters lokaler Report-Pfad
  (HTML→PDF + eigenes Doc) bleibt vollständig unberührt.

_Identität, IAP-Rollen-Gate & serverseitige KI:_
- **Identität + Rollen-Gate (nur unter IAP):** die App erkennt den per **Google IAP** angemeldeten Nutzer
  serverseitig (Header → Person/Rollen über `src/data/identity_map.json`, geliefert in `GET /api/state`).
  **Schreib-Aktionen** (inkl. Report erzeugen, Kommentar, Protokoll-Export) sind an die Identität gebunden und
  rollen-gegated — ein Owner handelt nur im eigenen Namen; **Lesen bleibt voll transparent**.
- **Nur bei echtem IAP-Login:** die Durchsetzung greift ausschließlich, wenn der Service als hinter-IAP markiert ist
  (`RUBICON_IAP_ACTIVE=1`, nur am App-Service) **und** ein gültiger IAP-Header vorliegt. Im lokalen bzw. via Tailnet
  geteilten Betrieb bleibt das bisherige **freie Verhalten** (freie Rollen-/Personenwahl, keine Server-Durchsetzung)
  — kein Header-Spoofing, kein stiller Fail-open.
- **UI:** Rolle/Person aus der Identität, Rollen-Auswahl auf die erlaubten beschränkt, „Angemeldet als …" + einmalige
  Begrüßung mit Funktionsübersicht; der bisher fest vorbelegte Owner-Name entfällt. Ein Klick auf die „Angemeldet
  als …"-Anzeige öffnet die Begrüßung jederzeit erneut.
- **Betrieb:** `identity_map.json` als Stammdaten der Merge-Brücke (SEED überschreibt Volume, `DEPLOYMENT_GCP.md §10`).
  Erster Schritt der Migration in den eigenen Web-/Nutzerkontext — Gesamtplan: `docs/web-context-migration-plan.md`.
- **„Frag die Daten" & KI-Zerlegung serverseitig:** beide Funktionen laufen jetzt serverseitig über die zentrale
  Modell-Fassade (**Vertex AI, EU**) statt eines lokal installierten Programms (behebt einen Serverfehler bei
  „Frag die Daten"; keine neuen Rechte — derselbe Pfad wie das KI-Narrativ; lokal unverändert). Die Antwort weist
  zudem das **tatsächlich genutzte Modell** aus (serverseitig Vertex, lokal die CLI) statt eines festen Textes —
  bleibt auch bei einem Modellwechsel ehrlich.
- **Robustheit (Deploy):** eine während eines Deploys offene Seite lud bisher den alten, nun umbenannten Asset-Chunk
  → „Daten konnten nicht geladen werden: Failed to fetch dynamically imported module". Neu erkennt der Bootstrap den
  Chunk-Load-Fehler und lädt **genau einmal** hart neu (frisches `index.html` mit den neuen Chunk-Namen; gegen
  Endlos-Schleife per `sessionStorage` abgesichert) — der Erst-Load nach einem Deploy heilt sich damit selbst.
- **KI-Entwurf scheitert nicht mehr stumm:** ein Modell-Fehler oder eine leere Antwort erscheint jetzt als klar
  markierte Notiz im Report (statt spurlos zu verschwinden) — bei Fehlern mit Grund, bei leerer Antwort als Hinweis.

**09.08.2026 — Serverseitige KI (Vertex), Wochen-Delta & Robustheit (dual-mode):**
- **KI-Narrativ serverseitig (Vertex AI):** der **KI-Entwurf-Block** des Wochen-Reports (Narrativ +
  Ampel-Begründungen) lief bisher nur lokal über die `claude`-CLI — serverseitig fehlte das Binary, der
  Report zeigte den Platzhalter. Neu: **Fassade `scripts/_tools/ai_client.py`** — Provider per Env
  (`RUBICON_AI_PROVIDER`: unset = lokale CLI wie bisher; `google` = Vertex Gemini; `anthropic` = Vertex
  Claude), Modell/Region/Projekt per `RUBICON_AI_MODEL`/`_REGION`/`_PROJECT`. Vertex-Aufrufe laufen im
  Projekt `aixs-260106` über den **eu-Multi-Region-Endpoint** (Inferenz in der EEA) als dedizierter SA
  **`rubicon-ai@`** (impersoniert von `rubicon-runtime`). Prompt-Template als Repo-Datei
  (`scripts/prompts/ki_narrativ.txt`, Override via `RUBICON_AI_PROMPT_FILE`) — Tuning ohne Code-Änderung.
  Lokaler Pfad byte-identisch; Ampel/Zahlen deterministisch; KI-Block bleibt ENTWURF + non-fatal. Details:
  `DEPLOYMENT_GCP.md §9.6`.
- **Modellwahl + Gemini-SDK:** Prod-Narrativ auf **`claude-sonnet-5` @ `eu`** (EEA, per Vertex-Smoke
  bestätigt); Prompt auf diese Modellfamilie abgestimmt. **Gemini bleibt schaltbar** (reine ENV-Umschaltung)
  und läuft über die **`google-genai`-SDK** → **Flash-3.x @ `eu` DSGVO-konform** (`gemini-3.6-flash` @ `eu`
  smoke-bestätigt; die ältere `gemini-2.5-flash` @ `europe-west*`). Entscheidung, Konsequenzen und
  Preisunterschiede: `DEPLOYMENT_GCP.md §9.6`, Abschnitt „Modellwahl & Gemini-Schaltbarkeit".
- **Wochen-Delta serverseitig (git → datierte Snapshots):** der **Δ-Block** (`/api/delta`, „was hat sich in
  N Tagen geändert") verglich den heutigen `projekt.yaml`-Stand mit dem git-Stand von vor N Tagen —
  serverseitig steht git nicht zur Verfügung (schlankes Image, `.git` bewusst nicht im Container) → HTTP 500.
  Neu: **dual-mode** — serverseitig aus datierten `projekt.yaml`-Snapshots (`history/projekt-<ts>.yaml` im
  Volume), lokal unverändert aus der git-Historie. Die **Merge-Brücke** legt bei jedem
  `[publish-data]`-Publish einen Snapshot ab (Dedupe); beim Rollout wird die git-Historie einmalig als
  Snapshots nachgezogen (Backfill). Der git-Aufruf fängt ein fehlendes Binary sauber ab (kein 500 mehr).
- **Cold-Start-Absicherung:** der App-Service skaliert im Leerlauf bewusst auf 0; der erste Aufruf nach
  Ruhe zahlt einen Kaltstart, bei dem `GET /api/state` kurz 5xx liefern oder netzwerkseitig abbrechen kann.
  Neu holt der Bootstrap den Zustand mit **endlichem Retry** (4 Versuche, ansteigende Wartezeit) — der
  Erst-Load heilt sich selbst; 4xx (z. B. Auth) failen weiterhin sofort, „Erneut versuchen" bleibt Fallback.
- **Beobachtbarkeit:** jede serverseitige 5xx-Antwort hinterlässt jetzt eine Logzeile (Methode, Pfad,
  Grund; unbehandelte Fehler zusätzlich mit Stack) — vorher nur der nackte Request-Status ohne Ursache.

**07.08.2026 — Serverseitige Doc-Erzeugung (zwei Wege), Server-DWD, Robustheit & Datenvertrag:**
- **Weg 1 — feste, gebrandete Fix-Struktur-Dokumente live:** Traktanden/Entscheide/Briefings/
  Führungsrhythmus entstehen serverseitig über die Docs-Vorlagen-Engine als Google-Doc + PDF; Treiber
  als Cloud-Run-Job **`rubicon-docs-job`** (Dual-Mode, fasst nur `server_*`-Felder an). Additive
  „Doc ↗"-Drive-Links im Tower; PDF + Seite-1-PNG ins Volume.
- **Weg 2 — dynamische HTML→PDF (Report/Protokoll):** Gotenberg-Service **`rubicon-gotenberg`** ist
  deployed; App-Wiring **live** (`RUBICON_GOTENBERG_URL` am App-Service, Aufruf per **OIDC-ID-Token**),
  `html_to_pdf` verzweigt serverseitig auf Gotenberg (lokal unverändert Chrome).
- **Server-DWD am Web-Service:** die App agiert server-seitig als `rubicon@axs.aero` (Env
  `RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT`) — nötig für on-demand Protokoll-Export,
  Report-Generierung und Gemini-Notiz-Import (fielen sonst auf eine lokale User-OAuth-Datei zurück,
  die im Container fehlt). **Keine neue IAM-Bindung** — die bestehende `rubicon-runtime`-Delegation
  wird nur am Service aktiviert (`DEPLOYMENT_GCP.md §9.1`).
- **Robustheit:** Exponential-Backoff um die Docs-API-Writes (429 bei Docs-API-Quota 60/min) **+**
  `batchUpdate`-Bündelung (Tabellen-Fill+Style in einem Batch; Bullet-Anker eines Docs in **einem**
  Batch; ein Anker-Sweep) **+ Pacing** (< 60 Docs-Writes/min) gegen die 429-Sättigung bei großen
  Läufen (viele Briefings); `rubicon-docs-job` gehärtet (2 GiB, kein Retry, Timeout 3600 s).
- **Datenvertrag `meta` Repo-getrieben:** das Steuerungsdatum (`meta.today`) + `datenlieferungen_url`
  kommen jetzt aus dem **Repo** (`projekt.yaml`, via `[publish-data]` live) statt aus dem Volume
  bewahrt — vorher ließ sich das Steuerungsdatum live nicht fortschreiben (`DEPLOYMENT_GCP.md §10`).
- **FR-Ordner-Default:** der Führungsrhythmus-Ordner hat wie die anderen drei einen Code-Default.
- **Inkrementelle Doc-Erzeugung:** der `rubicon-docs-job` rendert nur noch **geänderte** Docs — je Doc ein Content-Hash der Quelldaten (`server_hash`); unveränderte werden übersprungen. Ein normaler Lauf schreibt typisch 0–wenige statt ~214 Docs (nimmt die Quota-Last raus). `RUBICON_DOCS_FORCE=1` erzwingt den Vollauf (Vorlagen-Inhaltsänderung / extern getrashtes Doc).
- **Doc-Regenerierung nach Merge:** ein `[publish-data]`-Merge (Struktur → Live) stößt danach automatisch den `rubicon-docs-job` an (sequenziell, inkrementell) — die Server-Docs sind ohne separaten Trigger zum Datenstand aktuell.
- **Kosten:** Label `app=rubicon` auf allen RUBICON-Ressourcen (Kosten-Separierung im geteilten Projekt).

**06.08.2026 — Serverseitige Doc-Erzeugung + Merge-Brücke:**
- Reports (Woche/Monat/Quartal) werden jetzt **serverseitig chromefrei** erzeugt (Google
  Doc + PDF-Datei im Shared Drive); Cloud-Run-Job + Scheduler (Mo 06:00) live; Report-Links
  im Tower modusabhängig auf die Server-Docs. Details: `DEPLOYMENT_GCP.md §9`.
- **Merge-Brücke** (`DEPLOYMENT_GCP.md §10`): Struktur-Änderungen (Repo) live nachziehen
  **ohne** Live-Daten zu zerstören — Merge-by-Key, Backup, Konflikt-Meldung; Trigger
  `[publish-data]` (Vorschau) + manuell (Anwenden). `mergeTasks`-Fix: `erledigt_von` bleibt erhalten.
- Bucket auf **200 MS / 11 Ströme** nachgezogen (Owner-Review-Stand).

**05.08.2026 — Zentralisierung & geteilte Umgebung:**
- **Konvergenz:** `rubicon-dst` = kanonische PROD-Quelle; `rubicon-control-tower` archiviert (Read-only-Mirror).
- **CI/CD:** `deploy.yml` (WIF, keyless) — Push auf `main` deployt auf `rubicon.axs.aero`.
  Deploy-Fixes: `RUBICON_OK_ORIGINS`, `RUBICON_PY=/usr/bin/python3`, `package.name`→`rubicon`, Build-Stamp im Footer.
- **Runtime-Fetch:** Client liest die Stores zur Laufzeit über `GET /api/state` (Live-Writes
  nach Reload sichtbar; Bundle ~618→146 KB); Sensitiv-Store loopback-only.
- **Daten:** Bucket erstmals geseedet; Live-Stand gesichert unter `gs://aixs-rubicon-tower-backup/20260805-pre-dst-cutover/`.
- **Sicherheit:** Data-at-rest **CMEK** (EU-Key), **least-privilege Runtime-SA**,
  Object-Versioning + Public-Access-Prevention; `dist/`/Render-Artefakte aus Git, **Data-Guard**
  blockt Re-Add. Details: `DEPLOYMENT_GCP.md §7/§8`.

## Dual-Mode: lokal ↔ zentral (Migrations-Status)

Der Tower läuft **unverändert lokal** (`npm run dev`) UND serverseitig — dasselbe Image, dieselbe
Codebasis. Die Anpassung an die Umgebung ist **automatisch über Env-Variablen (kein Flag):** lokal
(Env unset) = wie bisher (Chrome-PDF, User-OAuth, `public/`, git-Historie); serverseitig = GCS-Volume
+ Google Drive via Service-Account-Impersonation. Env-Signale: die **DWD-Env** (`RUBICON_WORKSPACE_SA`
+ `RUBICON_IMPERSONATE_SUBJECT`) schaltet den Server-Modus (Drive/Docs als `rubicon@axs.aero`) — sie
trägt der **Job** und (seit 07.08.) auch der **Web-Service** (für on-demand Drive/Docs-Aktionen);
**`RUBICON_DOCS_DIR`** steuert zusätzlich am Service u.a. die Report-Links im Tower. So
lässt sich lokal **1:1 weiterarbeiten**, bis alle Funktionen serverseitig migriert sind. Server-Infra
im Detail: `DEPLOYMENT_GCP.md §9` (Reports) + `§10` (Merge-Brücke).

| Funktion | Lokal (Env unset) | Serverseitig | Status |
|---|---|---|---|
| Report-Doc + PDF | Chrome-HTML-PDF + Doc in Dieters Drive | **Weg 1 — gebrandete Vorlagen-Engine**: gebrandetes Google Doc + PDF (Template, KI-Entwurf im Doc; seit 10.08.) | ✅ live |
| Google-Auth | User-OAuth (`~/.config/google-mcp`) | keyless-DWD als `rubicon@axs.aero` | ✅ |
| Dokument-Persistenz | `public/` | GCS-Volume `_generated/` + Serving-Precedence | ✅ |
| Report-Trigger | launchd-Cron (Mac) | Cloud Scheduler → Cloud-Run-Job (Mo 06:00) | ✅ live |
| Report-Links im Tower | Dieters `doc_url` | `server_doc_url` (Shared Drive), modusabhängig; nur-lokale Alt-Reports ohne tote Links | ✅ live |
| Struktur → Live-Daten | git / Re-Seed (überschreiben) | **Merge-Brücke**: Repo-Struktur + Volume-Live per Merge-by-Key, Backup, Konflikt-Meldung | ✅ Code (§10) |
| Δ-Block (Wochen-Delta) | git-Vergleich `projekt.yaml` | **datierte `projekt.yaml`-Snapshots** (`history/`, aus git backfilled + je Publish fortgeschrieben) | ✅ Code — serverseitig ab Deploy + Backfill |
| KI-Narrativ | lokale CLI (`claude`, unverändert) | **Vertex AI** in `aixs-260106` via `ai_client`-Fassade (Provider `google`/`anthropic`, Modell/Region/Prompt per Env, SA `rubicon-ai@`) | ✅ Code + Deploy-Wiring — serverseitig **live erst nach Deploy + Cloud-Smoke** (`DEPLOYMENT_GCP.md §9.6`) |
| Traktanden, Entscheid, Briefing, Führungsrhythmus (feste Struktur) **+ AXS-Branding** | Chrome-HTML-PDF je Generator | **Weg 1 — Docs-REST-Vorlagen-Engine**: AXS-gebrandete Google-Doc-Vorlage je Typ + Merge, kein Chrome | ✅ serverseitig live (`rubicon-docs-job`) |
| Protokoll (dynamisch, berechnetes Layout) | Chrome-HTML-PDF (lokal) | **Weg 2 — HTML→PDF via Gotenberg**: bestehendes `render_*`-HTML serverseitig gerendert | ✅ Service `rubicon-gotenberg` live + App-Wiring aktiv (`RUBICON_GOTENBERG_URL`/OIDC am App-Service); Server-Protokoll-Export-PDF läuft über Gotenberg. **Server-Report** läuft seit 10.08. über **Weg 1** (Zeile „Report-Doc + PDF"); Dieters lokaler Report-Pfad nutzt weiter HTML/Chrome |
| Reminder / Mailversand | Gmail-Entwurf lokal (DRS sendet) | serverseitig via DWD `gmail.send`/`gmail.modify` als `rubicon@axs.aero` | ⏳ geplant (Scopes autorisiert) |
| Kalender / Eskalation | simuliert / MCP-Bridge lokal | serverseitig via DWD `calendar.events` | ⏳ geplant (Scopes autorisiert) |

**Bis zur 1:1-Parität** bleibt lokal die vollständige Umgebung; serverseitig wächst die Abdeckung
inkrementell. Diese Tabelle wird je Ausbauschritt aktualisiert.

### Doc-Erzeugung: genau zwei Wege (verbindliche Leitplanken)

Entschieden 07.08.2026. Dokumente entstehen über **genau zwei** Systeme — kein drittes. Jeder neue
Doc-Typ wählt beim Design **einen** davon.

**Weg 1 — Docs-REST-Vorlagen-Engine** (`scripts/_tools/doc_template.py`)
Eine AXS-gebrandete **Google-Doc-Vorlage** je Typ wird serverseitig gefüllt: `drive.files.copy` →
`documents.batchUpdate` (`replaceAllText` für Platzhalter, Anker→Tabelle für Wiederhol-Gruppen,
`createParagraphBullets` für Listen) → `drive.files.export(pdf)`. **Kein Chrome.**
→ **Traktanden, Entscheid, Briefing, Führungsrhythmus** sowie die **Reporte (Woche/Monat/Quartal)
serverseitig** (seit 10.08.2026 — löst den früheren Markdown→Doc-Zwischenweg für Reporte ab; der
KI-Entwurf steht damit im Doc selbst). Alle Vorlagen teilen **eine gebrandete Basis** (Logo je Seite +
Seitenzahlen + dynamische `{{FOOTER}}`-Fusszeile); reproduzierbar unter `scripts/templates_build/`.
Nimm ihn, wenn: **feste Struktur**; Inhalt = Felder + Wiederhol-Tabellen + Bullets; Branding soll
**ohne Code** in Google Docs editierbar sein (WYSIWYG); ein lebendes Google Doc als Nebenprodukt
gewünscht ist. **Anleitung** (Vorlage bauen + rendern, API, Modifier, Fallstricke):
[`docs/template-engine-anleitung.md`](docs/template-engine-anleitung.md).

**Serverseitig live:** Der Treiber `scripts/gen_docs_server.py`
(`run(drive, docs, root)`) erzeugt für alle vier Typen je ein gebrandetes Google-Doc + PDF über die
Engine und legt sie in die Shared-Ablage-Ordner. Er läuft **Dual-Mode** und nur im Server-Modus
(DWD-Env `RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT`) — Dieters lokale Generatoren
bleiben unverändert. Kernpunkte:
- **Harte Invariante:** der Server fasst **ausschließlich `server_*`-Felder** an; lokale Felder
  (`export.pdf`/`draft_id`/`stand`, Dieters lokale Traktanden-Doc-IDs) bleiben unberührt und werden
  **nie getrasht**.
- **Eigene Stores** je Typ: `entscheide.json` → `export.server_*`, plus `traktanden_docs.json`,
  `briefings_docs.json`, `fuehrungsrhythmus_doc.json` (nur `server_*`).
- **Additive UI-Links:** das Frontend zeigt „Doc ↗"-Drive-Links **neben** den Volume-PDF-Links —
  nur wenn `server_*_url` gesetzt ist (lokal fehlt → kein Link).
- **Volume-Auslieferung:** der Treiber schreibt die PDFs aller vier Typen sowie die Seite-1-PNG-
  Previews (Briefings + Führungsrhythmus) ins Volume (`RUBICON_DOCS_DIR`), damit die App
  serverseitig dieselben Artefakte/Previews bedient wie lokal.

Serverseitig getrieben vom Cloud-Run-Job `rubicon-docs-job` (live), s. `DEPLOYMENT_GCP.md §12`.

**Weg 2 — HTML→PDF via Gotenberg** (self-hosted, eigener privater Cloud-Run-Service `rubicon-gotenberg`, s. `DEPLOYMENT_GCP.md §11`)
Das in Python erzeugte `render_*`-HTML wird an den Gotenberg-Container geschickt und als PDF
zurückgegeben — **optisch identisch** zum lokalen Chrome-Pfad (`html_to_pdf`). Templating bleibt in
Python. Dedizierte Doku (Code-Verhalten, betroffene Generatoren, Provisionierung):
[`docs/gotenberg-html-pdf.md`](docs/gotenberg-html-pdf.md).
→ **Protokoll** (sowie Dieters **lokaler** Report-Pfad; der **serverseitige** Report läuft seit
10.08.2026 über Weg 1, s.o.).
Nimm ihn, wenn: **berechnetes/bedingtes Layout** über einfache Sektionen hinaus (farbige Ampel-Pills,
Inline-Balken, Narrativ-Prosa, git-Delta, KI-Entwürfe, Level-Varianten VR/Monat/Woche); oder schon
bewiesenes HTML/CSS existiert; oder pixelgenaues Druck-Layout zählt.

**Harte Regeln:**
- Genau diese zwei Wege. Keine dritte Engine, **keine externen PDF-APIs** (DoRaptor/PDFShift o.ä.) —
  `protokolle_sensitiv` u.a. Personendaten dürfen den Tenant **nie** verlassen (DSGVO).
- Der String-basierte Conditional/Operator-**DSL-Port** aus vergleichbaren Vorlagen-Engines wurde
  **verworfen** (Overkill für strukturierte Google-Docs: kein Loop-Konstrukt, Presence-only-
  Operatoren, bedingtes Weglassen ist ohnehin eine Code-Entscheidung — die `doc_template.py` schon
  abbildet).

**Dokumentierte Alternative zu Weg 2 — Jinja2 + WeasyPrint** (vorgemerkt, noch nicht gebaut)
Reiner Python-Weg (browserless HTML→PDF), **sinnvoll ab dem Punkt, wo**: (a) die **Chromium-
Abhängigkeit** raus soll (Image-Größe, Cold-Start, Pflege eines Browsers im Container stören);
(b) **strenge Bit-Determinismus/Print-Feinheiten** (paged-media, Kopf-/Fußzeilen, Seitenzahlen)
wichtiger werden als Chrome-Pixeltreue; (c) man das Templating aus Python-String-Bau in echte
**Template-Dateien mit Conditionals/Loops/Filtern** (Jinja2) heben will. **Kosten:** CSS-Port auf das
WeasyPrint-Subset (flexbox/grid nur teilweise) + visuelle Neu-Abnahme des VR-sichtbaren Reports.
Solange keiner dieser Punkte greift, bleibt **Gotenberg** (Weg 2), weil es das vorhandene,
Chrome-getunte HTML **1:1 ohne Rework** rendert.

## Ausbaustufen

1. **v1:** Kontrollturm live, geteilt, IAP-gated; Durchsetzung simuliert.
2. **Mail/Kalender serverseitig:** Reminder-Versand + Kalender/Eskalation real —
   serverseitig via SA-Impersonation (`rubicon@axs.aero`), DWD-Scopes `gmail.send`/
   `gmail.modify`/`calendar.events` **bereits autorisiert** (kein erneuter Admin-Approval
   nötig). Löst den bisherigen lokalen MCP-Bridge-Weg (`mcp/calendar_bridge.md`) ab.
3. **Tracker-Sync:** Gruppen-Commitment-Tracker ↔ read-only-Import.
4. **Phase 2 (Datenschutz-Härtung):** Client-Runtime-Fetch (`/api/state`) ✅ umgesetzt
   (Daten zur Laufzeit aus dem Volume); verbleibend: `src/data`-Personendaten +
   `public/`-PDFs aus Git lösen (EU-Volume als alleinige Quelle).
