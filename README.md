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
6. **Cloud-/IAM-/Deploy-Änderungen laufen über die IT** (bzw. abgestimmt) — nicht
   doppelt, damit sich Infrastruktur-Stände nicht gegenseitig überschreiben.

## Änderungen 05.08.2026 (IT / Didit)

- **Konvergenz:** `rubicon-dst` = kanonische PROD-Quelle; `rubicon-control-tower`
  archiviert (Read-only-Mirror).
- **Deploy-Fixes:** Origin-Guard-Env auf `RUBICON_OK_ORIGINS` (rückwärtskompatibel),
  `RUBICON_PY=/usr/bin/python3` (Container-Python für die Renderer),
  `package.name` → `rubicon`, Dockerfile-Build-Args für den Build-Stamp.
- **Build-Stamp** im Footer (Datum/Zeit sichtbar, SHA im Hover).
- **CI/CD** neu: `.github/workflows/deploy.yml` (WIF, keyless) — Push auf `main`
  deployt auf `rubicon.axs.aero`.
- **Daten:** Bucket auf DSTs aktuellen Stand geseedet (11 Ströme/196 MS + Zielbild).
  Voriger Live-Stand gesichert unter `gs://aixs-rubicon-tower-backup/20260805-pre-dst-cutover/`
  (Merge späterer Live-Writes bei Bedarf möglich).

## Ausbaustufen

1. **v1:** Kontrollturm live, geteilt, IAP-gated; Durchsetzung simuliert.
2. **MCP-Bridge produktiv:** Reminder/Kalender/Eskalation real (`mcp/calendar_bridge.md`).
3. **Tracker-Sync:** Gruppen-Commitment-Tracker ↔ read-only-Import.
4. **Phase 2 (Datenschutz-Härtung):** `src/data`/`dist/` aus Git; Daten nur im
   EU-Volume; Client von Build-Zeit-Import auf Runtime-Fetch umstellen.
