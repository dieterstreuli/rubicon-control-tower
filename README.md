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
  gebackenen `public`-Baseline. Reports (Woche/Monat/Quartal) werden bereits
  serverseitig **chromefrei** erzeugt (Google Doc + Drive-`files.export`, s.
  `DEPLOYMENT_GCP.md` §9) und landen dort — sie überleben damit Neustart/Redeploy.
  Protokolle/Briefings/Entscheide/Traktanden entstehen weiterhin außerhalb des
  Containers über den lokalen HTML-PDF-Pfad (Chromium bleibt dafür vorerst lokal
  beim CoS, s. `DEPLOYMENT_GCP.md` §5) und werden über die `public`-Baseline
  ausgeliefert, bis auch ihre Generierung serverseitig nach `RUBICON_DOCS_DIR`
  schreibt.
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

## Änderungen 05.08.2026 (IT / Didit)

- **Konvergenz:** `rubicon-dst` = kanonische PROD-Quelle; `rubicon-control-tower`
  archiviert (Read-only-Mirror).
- **Deploy-Fixes:** Origin-Guard-Env auf `RUBICON_OK_ORIGINS` (rückwärtskompatibel),
  `RUBICON_PY=/usr/bin/python3` (Container-Python für die Renderer),
  `package.name` → `rubicon`, Dockerfile-Build-Args für den Build-Stamp.
- **Build-Stamp** im Footer (Datum/Zeit sichtbar, SHA im Hover).
- **Runtime-Fetch der Datenschicht:** Der Client liest die 12 Stores zur Laufzeit über
  `GET /api/state` statt aus dem Build-Bundle → Live-Writes nach Reload sichtbar
  (Bundle ~618→146 KB); Sensitiv-Store bleibt loopback-only. Die Read-only-Stores
  (`domain`/`reports_index`/`fuehrungsrhythmus`/`traktanden`/`traktanden_docs`) kommen
  nun aus dem Bucket → Pre-Deploy-Sync-Check in `DEPLOYMENT_GCP.md`.
- **CI/CD** neu: `.github/workflows/deploy.yml` (WIF, keyless) — Push auf `main`
  deployt auf `rubicon.axs.aero`.
- **Dokument-Persistenz (Infrastruktur):** Serving-Precedence ergänzt —
  `RUBICON_DOCS_DIR=/app/src/data/_generated` auf dem GCS-Volume geht beim Ausliefern
  vor der `public`-Baseline. Es findet noch keine serverseitige PDF-Generierung statt
  (die PDFs entstehen weiterhin außerhalb des Containers, `public`-Baseline unverändert
  im Einsatz); sobald eine Generierung dorthin schreibt, überlebt sie Redeploy.
- **Daten:** Bucket auf DSTs aktuellen Stand geseedet (11 Ströme/196 MS + Zielbild).
  Voriger Live-Stand gesichert unter `gs://aixs-rubicon-tower-backup/20260805-pre-dst-cutover/`
  (Merge späterer Live-Writes bei Bedarf möglich).
- **Sicherheit/Datenschutz:** Data-at-rest **CMEK-verschlüsselt** (dedizierter EU-Key);
  Cloud Run mit **least-privilege Runtime-SA** (bucket-scoped); Buckets Object-Versioning
  + Public-Access-Prevention enforced. `dist/` + Render-Zwischenstände aus Git entfernt,
  **Data-Guard**-Workflow blockt Re-Add. Details/Plan: `DEPLOYMENT_GCP.md §7/§8`.

## Dual-Mode: lokal ↔ zentral (Migrations-Status)

Der Tower läuft **unverändert lokal** (`npm run dev`) UND serverseitig — dasselbe Image, dieselbe
Codebasis. Die Anpassung an die Umgebung ist **automatisch über Env-Variablen (kein Flag):** lokal
(Env unset) = wie bisher (Chrome-PDF, User-OAuth, `public/`, git-Historie); serverseitig = GCS-Volume
+ Google Drive via Service-Account-Impersonation. Zwei Env-Signale: der **Job** erkennt den
Server-Modus an der **DWD-Env** (`RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT`) für die
Doc-Erzeugung; **Service/App** an **`RUBICON_DOCS_DIR`** (steuert u.a. die Report-Links im Tower). So
lässt sich lokal **1:1 weiterarbeiten**, bis alle Funktionen serverseitig migriert sind. Server-Infra
im Detail: `DEPLOYMENT_GCP.md §9` (Reports) + `§10` (Merge-Brücke).

| Funktion | Lokal (Env unset) | Serverseitig | Status |
|---|---|---|---|
| Report-Doc + PDF | Chrome-HTML-PDF + Doc in Dieters Drive | Google Doc + PDF-Datei im Shared Drive (`files.export`) | ✅ live |
| Google-Auth | User-OAuth (`~/.config/google-mcp`) | keyless-DWD als `rubicon@axs.aero` | ✅ |
| Dokument-Persistenz | `public/` | GCS-Volume `_generated/` + Serving-Precedence | ✅ |
| Report-Trigger | launchd-Cron (Mac) | Cloud Scheduler → Cloud-Run-Job (Mo 06:00) | ✅ live |
| Report-Links im Tower | Dieters `doc_url` | `server_doc_url` (Shared Drive), modusabhängig; nur-lokale Alt-Reports ohne tote Links | ✅ live |
| Struktur → Live-Daten | git / Re-Seed (überschreiben) | **Merge-Brücke**: Repo-Struktur + Volume-Live per Merge-by-Key, Backup, Konflikt-Meldung | ✅ Code (§10) |
| Δ-Block (Wochen-Delta) | git-Vergleich `projekt.yaml` | GCS-Object-Version statt git | ⏳ Follow-up |
| KI-Narrativ | lokale `claude`-CLI | AIXS-Plattform (konfigurierbares Modell/Prompt) | ⏳ Follow-up |
| Protokoll/Traktanden/Entscheide-Doc | Chrome-HTML-PDF | **Vorlagen-Engine** (Google-Doc-Template + Merge, kein Chrome) | ⏳ geplant |
| AXS-Branding (Logo/Header/Footer) | im HTML/CSS je Generator | in der Google-Doc-Vorlage (WYSIWYG) | ⏳ geplant |

**Bis zur 1:1-Parität** bleibt lokal die vollständige Umgebung; serverseitig wächst die Abdeckung
inkrementell. Diese Tabelle wird je Ausbauschritt aktualisiert.

Das serverseitige Report-PDF ist aktuell die schlichtere **Doc-Export-Fassung** (kein Chromium im
Image). Die **gebrandete** HTML-Chrome-Version (Logo/Ampel-Pills/Styling), die heute lokal via MCP
erzeugt wird, kann in einer späteren Phase **optional per Feature-Flag** auch serverseitig angeboten
werden (Headless-Chrome ins Image) — die PDF-Quelle im Code ist dafür pluggbar gehalten.

## Ausbaustufen

1. **v1:** Kontrollturm live, geteilt, IAP-gated; Durchsetzung simuliert.
2. **MCP-Bridge produktiv:** Reminder/Kalender/Eskalation real (`mcp/calendar_bridge.md`).
3. **Tracker-Sync:** Gruppen-Commitment-Tracker ↔ read-only-Import.
4. **Phase 2 (Datenschutz-Härtung):** Client-Runtime-Fetch (`/api/state`) ✅ umgesetzt
   (Daten zur Laufzeit aus dem Volume); verbleibend: `src/data`-Personendaten +
   `public/`-PDFs aus Git lösen (EU-Volume als alleinige Quelle).
