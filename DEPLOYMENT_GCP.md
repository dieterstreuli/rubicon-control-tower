# DEPLOYMENT_GCP.md — RUBICON Control Tower auf AXS-GCP (POC)

**Stand:** 30.07.2026 · Deployt von Didit (Gordon) · Zweck: RUBICON weg vom DRS-Mac, hinter
echtem `@…`-Login auf der AXS-Plattform. **Dieser Stand läuft mit dem echten DRS-Vollstand**
(Drop „RUBICON control-tower — Vollstand inkl. src-data", 30.07.2026: 9 Ströme, 2 Programme,
135 Briefings, echte tasks/projekt.yaml). Der frühere Mock-Stand (30.06.) ist ersetzt.
Die echten `src/data/` wurden **einmalig in den GCS-Bucket geseedet** (= SSOT, s. §4a).

---

## 1 · Was live ist

| Baustein | Wert |
|---|---|
| GCP-Projekt | `aixs-260106` (Nr. `646221535662`) |
| Region | `europe-west4` |
| Cloud-Run-Service | `rubicon-tower` (privat, `--no-allow-unauthenticated`, `--max-instances=1`) |
| Service-URL | `https://rubicon-tower-646221535662.europe-west4.run.app` |
| Custom Domain | `https://rubicon.axs.aero` (Cloud-Run-Domain-Mapping, CNAME → `ghs.googlehosted.com`, managed Cert) |
| Auth | **IAP** direkt am Service (Google-managed OAuth-Client) |
| Zugriffs-Gruppe | `rubicon-app@axs.aero` → `roles/iap.httpsResourceAccessor` |
| **Persistenz / SSOT** | GCS-Volume `gs://aixs-rubicon-tower-data` (europe-west4) RW-gemountet auf `/app/src/data` → **Writes überleben Neustart** (verifiziert). Bucket mit echtem DRS-Stand geseedet = laufende Wahrheitsquelle (der Mount überschattet die ins Image gebackenen `src/data`). |

Kette: **Browser → IAP (Google-Login) → nur Gruppen-Mitglieder → Cloud Run → Vite-Dev (SPA + Write-API).**
Unauth-Zugriff wird von IAP mit `302 → accounts.google.com` abgewiesen (`x-goog-iap-generated-response: true`).

## 2 · Zugriffs-Gruppe `rubicon-app@axs.aero`

Angelegt nach Gemini-GWS-Regeln (`GWS-Gemini/GEMINI.md` §2.2/§3.1, Label `[App]`):

| Setting | Wert |
|---|---|
| Label / Security-Group | `[App]` · `cloudidentity…/groups.security: True` (IAM/IAP-tauglich) |
| Mitglieder | `d.streuli@axs.aero`, `g.suchomski@did-it.ch` |
| Erreichbarkeit | `who_can_post_message ALL_MANAGERS_CAN_POST` (nur Manager) |
| GAL/Verzeichnis | `show_in_group_directory false` + `who_can_discover_group ALL_MEMBERS_CAN_DISCOVER` (versteckt) |
| Extern | `allow_external_members false` |
| Join | `INVITED_CAN_JOIN` |

Weitere Personen freischalten = einfach Mitglied der Gruppe machen:
`gam update group rubicon-app@axs.aero add member <email>`

## 3 · Code-/Config-Änderungen für den Container

- **`Dockerfile`** (neu): `node:20-slim`, `npm ci`, startet **Vite-Dev** (`--host 0.0.0.0 --port $PORT`).
  `python3` + die Google-API-Client-Libs (`google-api-python-client`, `google-auth`) sind im Image
  (für die Renderer-Skripte, inkl. serverseitige Report-Erzeugung, s. §9). Chromium ist bewusst
  NICHT drin (Image-Größe) → der Chromium-abhängige **HTML-PDF-Export für Protokolle/Briefings/
  Entscheide/Traktanden bleibt vorerst lokal beim CoS**; Reports laufen bereits serverseitig
  chromefrei über die Docs-API (§9).
- **`.dockerignore`** (neu): `node_modules`, `dist`, `.git`, `public`, …
- **`vite.config.js`**: `server.allowedHosts: true` (DNS-Rebind-Check aus; Host variabel `*.run.app`/Custom-Domain; Schutz macht IAP).
- **`plugins/rubicon-api.js`**: `OK_ORIGINS` um **Env-Override** `RUBICON_OK_ORIGINS` (Komma-separiert) ergänzt — Deploy-Origins ohne Code-Redeploy.
- **Env am Service:** `RUBICON_OK_ORIGINS` = `https://rubicon.axs.aero` + beide run.app-URLs (Custom-Domain MUSS drin sein, sonst weist der Origin-Guard POSTs von `rubicon.axs.aero` ab); `RUBICON_PY=python3`; `PORT=8080`.
- **Dokumenten-Ablage:** `RUBICON_DOCS_DIR=/app/src/data/_generated`
  (liegt mit auf dem GCS-Volume, s. §1) hat beim Ausliefern Vorrang vor der ins Image gebackenen
  `public`-Baseline (`resolveStaticPath` in `server.mjs`). Der Report-Job (s. §9) schreibt bereits
  serverseitig und **chromefrei** dorthin (Google Doc + Drive-`files.export`) — diese PDFs
  überleben damit Neustart/Redeploy. Protokolle/Briefings/Entscheide/Traktanden laufen weiterhin
  über den lokalen HTML-PDF-Pfad (Chromium fehlt im Image, s. §5) und werden bis zu ihrer eigenen
  serverseitigen Migration weiterhin über die `public`-Baseline ausgeliefert.

## 4 · Reproduzieren / Verwalten

> **Achtung gcloud-Projekt-Drift:** die globale `gcloud config` stand beim Deploy auf `catering-nxt`
> mit Quota-Override `read-and-sign-499413` (Parallel-Session). Daher **per-Command** übersteuert —
> globale Config NICHT anfassen:
> `CLOUDSDK_CORE_PROJECT=aixs-260106 CLOUDSDK_BILLING_QUOTA_PROJECT=aixs-260106 gcloud …`

```bash
Q="CLOUDSDK_CORE_PROJECT=aixs-260106 CLOUDSDK_BILLING_QUOTA_PROJECT=aixs-260106"
P="--project aixs-260106 --region europe-west4"

# Deploy (Source-Build via Cloud Build)
env $Q gcloud run deploy rubicon-tower --source . $P \
  --no-allow-unauthenticated --port 8080 --memory 1Gi --cpu 1 --max-instances 1 --timeout 300

# Env setzen (Komma im Wert → Custom-Delimiter ^@^) — Custom-Domain MIT drin
env $Q gcloud run services update rubicon-tower $P \
  --update-env-vars "^@^RUBICON_OK_ORIGINS=https://rubicon.axs.aero,https://rubicon-tower-646221535662.europe-west4.run.app,https://rubicon-tower-tprubysumq-ez.a.run.app"

# IAP am Service aktivieren + Gruppe binden
env $Q gcloud beta run services update rubicon-tower $P --iap
env $Q gcloud beta iap web add-iam-policy-binding --resource-type=cloud-run \
  --service=rubicon-tower --region=europe-west4 \
  --member="group:rubicon-app@axs.aero" --role="roles/iap.httpsResourceAccessor" --project=aixs-260106

# Custom Domain
env $Q gcloud beta run domain-mappings create --service=rubicon-tower --domain=rubicon.axs.aero $P
#   DNS: rubicon.axs.aero  CNAME  ghs.googlehosted.com.   → Cert provisioniert automatisch

# Auth-Smoke (privat) via Proxy
env $Q gcloud run services proxy rubicon-tower $P --port 8899   # dann: curl http://localhost:8899/
```

Lokaler Boot (ohne GCP): `npm ci && npm run validate && node node_modules/vite/bin/vite.js --port 8621`.

### 4a · Daten-Seed in den Bucket (EINMALIG — nicht bei jedem Redeploy!)

Der Mount `/app/src/data` = Bucket überschattet die ins Image gebackenen Dateien → der Bucket
ist die laufende SSOT. Beim **ersten** Aufspielen eines echten Datenstands den Bucket spiegeln:

```bash
env $Q gcloud storage rsync -r --delete-unmatched-destination-objects \
  -x '(_generated/|protokolle_sensitiv\.json)' \
  src/data gs://aixs-rubicon-tower-data
```

> ⚠️ **Bei normalen Code-Redeploys NICHT erneut seeden** — das würde die im Bucket
> gesammelten Live-Writes (protokolle/tasks/entscheide) mit dem Repo-Stand **überschreiben**.
> Nur seeden, wenn bewusst ein neuer Voll-Datenstand die Cloud-Wahrheit ersetzen soll
> (dann vorher Bucket sichern: `gcloud storage cp -r gs://aixs-rubicon-tower-data <backup>`).
>
> ⚠️ **`_generated/` UND `protokolle_sensitiv.json` MÜSSEN ausgeschlossen bleiben** (`-x`, oben) —
> beide liegen NUR im Volume, NICHT im Repo: `_generated/` = die vom Report-Job (§9) erzeugten
> Dokumente, `protokolle_sensitiv.json` = der loopback-only Sensitiv-Store (gitignored). Ohne den
> Ausschluss würde `--delete-unmatched-destination-objects` beide beim Voll-Seed **löschen**.

## 5 · POC-Grenzen / To-do für Produktiv

- **Writes persistent (erledigt):** `src/data/` liegt auf dem GCS-Volume `gs://aixs-rubicon-tower-data`
  (RW-Mount, `max-instances=1` → ein Schreiber, atomare temp+rename bleiben korrekt). Verifiziert: ein
  `/api/sitzung`-Write landet in `protokolle.json` im Bucket und überlebt Neustart. Bucket-SA:
  `646221535662-compute@developer.gserviceaccount.com` (`roles/storage.objectAdmin`).
  - **Reload-Caveat (Dev-Modus):** die SPA bündelt `projekt.yaml` zur Build-Zeit (`?raw`); der Vite-Dev-Server
    liest bei **Seiten-Reload** frisch von der Platte (= Volume) → Änderungen erscheinen nach Reload. Live-HMR
    feuert nicht (GCS-FUSE liefert keine inotify-Events). Für Governance-Betrieb: **Drive-Ablage als SSOT** via
    Drive-API (siehe Antwort-Analyse / README §Ausblick).
- **Dev-Modus im Container:** faithful zum heutigen Mac-Betrieb (Runbook §4/5). Härtung = Write-API als
  kleiner Express-Server (~1 Tag), dann `vite build` + statisch.
- **Kein HTML-PDF-Export im Container für Protokolle/Briefings/Entscheide/Traktanden**
  (Chromium bewusst nicht im Image — Image-Größe; diese PDFs entstehen weiterhin außerhalb des
  Containers) — bei Bedarf Headless-Chromium nachrüsten + AXS-Service-Account. Reports laufen
  bereits serverseitig chromefrei über die Docs-API (s. §9).
- **Echter DRS-Vollstand live (30.07., erledigt):** Mock ersetzt, Bucket geseedet (§4a).
- **Multi-Writer:** für die 2 Nutzer sicher, solange `max-instances=1` bleibt — ein Node-Prozess,
  Read→merge→`writeAtomic` (temp+rename) läuft synchron (einziges `await` = Body-Lesen, vor dem
  Store-Read) → kein Lost-Update, kein Truncate; Merges sind Upsert-by-key (idempotent). gcsfuse 3.10
  im Image hat `EnableAtomicRenameObject:true`+HNS (rename atomar). **Scale-out (`maxScale>1`) bricht
  es** (kein Cross-Instance-Lock, GCS kein CAS) → dann State nach Firestore/optimistic-lock via
  `ifGenerationMatch`.
- **Sensitiv-Protokolle im Cloud-Modus (Abweichung vom lokalen Design):** ein „🔒 Sensitiv"-Write
  landet hier in `protokolle_sensitiv.json` **im Bucket** (persistent in der Cloud) — anders als am
  DRS-Mac („nur lokal"). Abruf bleibt gesperrt: Middleware-403 auf jeden Auslieferpfad + der einzige
  Lese-Endpoint ist Loopback+Host==localhost-gated und schlägt hinter IAP nie an. Für Produktiv
  entweder das Sensitiv-Feature im Cloud-Deploy deaktivieren oder bewusst als CMEK-verschlüsselten
  Cloud-Store führen. Aktuell im Bucket leer.
- **Gruppe** aktuell nur Dieter + Gordon — finale GL/VR-Mitglieder ergänzen.

## 6 · Referenzen
- `MIGRATION.md` — DRS-Runbook (Daten-Inventar, Portabilität).
- `README.md` — Tower-Funktion, Ausbaustufen (§Ausblick nennt genau dieses Gateway).
- `GWS-Gemini/GEMINI.md` §2.2/§3.1 + `agents/group-expert.md` — Gruppen-Regeln.

## 7 · Datensicherung & Datenschutz (Data-at-rest)

Datenschicht = GCS-Bucket `gs://aixs-rubicon-tower-data` (EUROPE-WEST4, EU).

- **Object Versioning: AKTIV (seit 05.08.2026).** Jede Überschreibung/Löschung
  behält die Vorversion → Point-in-time-Rollback ohne Handarbeit.
  Prüfen: `gcloud storage buckets describe gs://aixs-rubicon-tower-data | grep versioning`.
  Vorversionen listen: `gcloud storage ls -a gs://aixs-rubicon-tower-data/<datei>`;
  wiederherstellen: `gcloud storage cp gs://…/<datei>#<generation> gs://…/<datei>`.
- **Soft-Delete: 7 Tage** (Bucket-Default, `retentionDurationSeconds: 604800`) —
  auch hart gelöschte Objekte 7 Tage wiederherstellbar.
- **Manuelles Voll-Backup:** `gs://aixs-rubicon-tower-backup/20260805-pre-dst-cutover/`
  (Stand vor dem DST-Cutover). Weitere: `gcloud storage cp -r gs://aixs-rubicon-tower-data gs://aixs-rubicon-tower-backup/<datum>/`.

**Pre-Deploy-Check: Read-only-Stores (seit dem Runtime-Fetch-Umbau, 05.08.2026).**
Seit Block A liest der Client die Read-only-Stores (`domain.json`, `reports_index.json`,
`fuehrungsrhythmus.json`, `traktanden.json`, `traktanden_docs.json`) zur Laufzeit über
`GET /api/state` aus dem GCS-Volume statt aus dem Build-Bundle. Diese Stores werden vom
Server NICHT geschrieben, sondern im Repo gepflegt — **vor jedem Deploy** prüfen, ob die
Bucket-Kopien dem Repo-Stand entsprechen, sonst zeigt Prod still den (einmalig geseedeten)
Alt-Stand:

```bash
gcloud storage rsync --dry-run \
  -x '(protokolle_sensitiv\.json|projekt\.yaml|tasks\.json|entscheide\.json|protokolle\.json|reminder_log\.json|zielbild\.json|report_comments\.json|_generated/)' \
  src/data gs://aixs-rubicon-tower-data
```

Die vom Server geschriebenen Live-Stores sind im Exclude-Pattern bewusst ausgeschlossen
(sonst überschreibt der Diff die Live-Writes) — bei Abweichungen anschließend nur die
Read-only-Stores gezielt nachziehen (z.B. `gcloud storage cp src/data/domain.json
gs://aixs-rubicon-tower-data/domain.json`). `_generated/` ist ebenfalls ausgeschlossen: dort würden
serverseitig erzeugte PDFs landen (`RUBICON_DOCS_DIR`, aktuell ungenutzt, s. §3/§5) — der Sync darf
den Pfad trotzdem nicht anfassen.

**Offen (DSGVO/Geheimhaltung — Zielarchitektur):**
- **Noncurrent-Version-Lifecycle** setzen (Kosten + DSGVO-Retention: Vorversionen
  nicht unbegrenzt halten, z.B. 90 Tage) — bewusste Aufbewahrungsdauer wählen.
- **CMEK** statt Google-managed (vorhandene `europe`-KMS-Keys nutzen) — Key-Kontrolle/Widerruf.
- **Cloud Audit Data-Access-Logs** (wer liest/schreibt) aktivieren.
- **Vertrauliche Daten (ExBoD/VR, Sensitiv) segregieren** (eigener Store/Key/engere Gruppe).
- Zielbild Datenschicht: **Firestore (Native, EU)** als SSOT + Runtime-Fetch (Phase 2),
  Personendaten aus dem Git-Repo entkoppeln.

## 8 · Infra-/Datenschutz-Härtung (Stand)

Stand der Härtung der Datenschicht (data-at-rest + Zugriff).

**Erledigt (05.08.):**
- GCS Object Versioning auf Daten- UND Backup-Bucket aktiv (§7); Sensitiv-Store im Bucket leer (verifiziert).
- **Teil-Reduktion Repo:** `dist/` (376) + `scripts/_briefing_html` (167) + `_trakt_html` (14)
  aus Git-Tracking entfernt + gitignored; **Guardrail** `.github/workflows/data-guard.yml`
  blockt Re-Add. (`dist/` wird im Container gebaut.)
- **Positiv-Ist:** Daten EU-resident (europe-west4); IAP-Invoker nur IAP-Service-Agent;
  GCS-Data-Access-Audit-Logs AN; `protokolle_sensitiv.json` git-/dockerignored (Vorbild).

**Infra-Hardening ERLEDIGT (05.08.):**
- **CMEK**: dedizierter EU-Keyring `axs-rubicon-keyring` (europe-west4) + Key `rubicon-ssot-key`
  (Auto-Rotation 90d); GCS-Service-Agent via `service-agent --authorize-cmek` berechtigt;
  `--default-encryption-key` auf **beide** Buckets; **alle** Bestandsobjekte umgeschlüsselt
  (Daten 17/17, Backup 12/12). Prüfen: `gcloud storage buckets describe … | grep kms`.
- **Runtime-SA least-privilege**: Dienst läuft als `rubicon-runtime@aixs-260106` (Rev 00008+)
  mit **bucket-scoped** `roles/storage.objectAdmin` (nur Datenbucket) + logging/monitoring;
  Default-Compute-SA-Binding am Bucket entfernt; in `deploy.yml` als `--service-account` verankert.
- **Public-Access-Prevention = enforced** + **UBLA = on** auf beiden Buckets.

**Zurückgestellt (bewusst — höhere Tragweite):**
- **Org-Policy `gcp.resourceLocations=in:eu`** projektweit: kann Vertex/Discovery-Ressourcen-
  erstellung im geteilten AI-Projekt blocken → erst prüfen was jede Last erzeugt, dann setzen.
- Backup-Bucket **Bucket-Lock/Retention** (WORM) — irreversibel, eigene Entscheidung.
- Legacy-Projekt-Primitive-Bucketzugriff (projectViewer/Editor lesen/schreiben) restringieren —
  Sperr-Risiko, separat.
- Default-Compute-SA projektweiten `roles/editor` entziehen — betrifft andere Dienste, separat.
- Sensitiv-Pfad im Cloud-Deploy segregieren/deaktivieren (Store leer, aber scharf) → Phase 2.

## 9 · Serverseitige Report-Automation (Infrastruktur)

Die Reports (Woche/Monat/Quartal) werden serverseitig als **Google Doc im Shared Drive**
erzeugt und per **Drive-`files.export`** zu PDF gewandelt — **ohne Chrome**, geplant über einen
Cloud-Run-Job. Der Code passt sich der Laufzeitumgebung an (**Dual-Mode**, s. „Migrations-Status"
im README): lokal unverändert (Chrome + User-OAuth), serverseitig nur wenn die DWD-Env-Variablen
gesetzt sind. Der Web-Service setzt sie NICHT → dort ändert sich nichts.

### 9.1 Identitäts-Kette (keyless Domain-Wide-Delegation)

| Element | Wert | Zweck |
|---|---|---|
| **Service-User** | `rubicon@axs.aero` (Workspace-Konto, OU `/nouser`, GAL-hidden, Business-Standard) | Identität, unter der Dokumente in Drive erzeugt werden (Autor) |
| **Service Account** | `rubicon-workspace@aixs-260106` (Client-ID `112708550499414880483`) | impersoniert `rubicon@axs.aero` per **keyless DWD** (IAM-Credentials `signJwt`, kein JSON-Key) |
| **DWD-Freigabe** | Admin-Konsole → API-Controls → Domain-Wide-Delegation: Client-ID oben + Scopes `…/auth/drive` + `…/auth/documents` | erlaubt dem SA das Handeln als der Service-User (braucht 2.-Admin-Approval) |
| **Job-Prozess-SA** | `rubicon-runtime@aixs-260106` (hat Bucket-Zugriff) | führt den Job aus; DWD-Basis, signiert das JWT als `rubicon-workspace` |
| **Grant** | `rubicon-runtime` → `iam.serviceAccountTokenCreator` auf `rubicon-workspace` | erlaubt `rubicon-runtime` das `signJwt` als `rubicon-workspace` |

In-House-Vorlage der keyless-DWD-Mechanik: `scripts/_tools/gdoc_pdf.py` (bzw. das Muster aus
`_google_auth._dwd_credentials`). Kein statischer Key nötig (Metadata-ADC signiert per IAM-API).

### 9.2 Shared Drive

**„00 AXS - Rubicon"** (`0AK8sNCBforeMUk9PVA`, europe/Workspace) — `rubicon@axs.aero` ist Mitglied
(content-manager genügt). Endprodukt-Ordner:

| Ordner | ID |
|---|---|
| reports | `1hiuxVPBO3Hwd3I0g1lDTxKFAwk851Y0m` |
| protokolle | `1MlvxkY4Ti8MdTwT3ODs7HM-7mF74lPHm` |
| entscheide | `1wI2ggCw3erqeQ3HW2bcKxk4rg-zKo0rb` |
| briefings | `1uopFGM23gaWQV_3CuHA3wRYT-Bei3VKa` |
| traktanden | `1hQ_9DP-NlwDSHr-pSAw0B5hXHC37mAYY` |
| pakete | `1gE8EgiNHAmPuKwDe4QHDCWbemCMMcHB_` |

### 9.3 Cloud-Run-Job `rubicon-report-job`

Gleiches Image wie der Service (von der Pipeline gebaut, `:latest`), Command-Override auf
`gen_report.py --auto`, dasselbe GCS-Volume, SA `rubicon-runtime`, DWD-Env, Timeout 1800s.

```bash
gcloud run jobs create rubicon-report-job \
  --project=aixs-260106 --region=europe-west4 \
  --image=<PIPELINE-IMAGE>:latest \
  --service-account=rubicon-runtime@aixs-260106.iam.gserviceaccount.com \
  --add-volume=name=data,type=cloud-storage,bucket=aixs-rubicon-tower-data \
  --add-volume-mount=volume=data,mount-path=/app/src/data \
  --command=python3 --args=scripts/gen_report.py,--auto \
  --task-timeout=1800 --max-retries=1 \
  --set-env-vars="^#^RUBICON_PY=/usr/bin/python3#RUBICON_DOCS_DIR=/app/src/data/_generated#RUBICON_WORKSPACE_SA=rubicon-workspace@aixs-260106.iam.gserviceaccount.com#RUBICON_IMPERSONATE_SUBJECT=rubicon@axs.aero#RUBICON_DRIVE_REPORTS_FOLDER=1hiuxVPBO3Hwd3I0g1lDTxKFAwk851Y0m"
# Delimiter MUSS ^#^ sein (nicht ^@^): die Werte enthalten @ (SA-/Subject-Emails) →
# ^@^ würde mitten in den Email-Adressen splitten und die Env-Var kaputt setzen.
# Manueller Test-Lauf:
gcloud run jobs execute rubicon-report-job --project=aixs-260106 --region=europe-west4 --wait
```

Der Job liest die Daten vom Volume (`projekt.yaml`/`protokolle`/…), erzeugt je Report ein Doc im
reports-Ordner + exportiert das PDF nach `/app/src/data/_generated/reports/` (persistent),
aktualisiert `reports_index.json`. Logs (`rubicon.gdoc`/`rubicon.report`) tragen Messpunkte:
`create_ms`/`build_ms`/`blocks`/`export_ms`/`bytes`/`total_ms` + `docs_429` (Docs-API-Rate-Limit-Retries).

### 9.4 Cloud Scheduler `rubicon-report-sched`

Dedizierter Mini-SA `rubicon-scheduler@aixs-260106` (**nur** `run.jobs.run`, least-privilege)
triggert den Job wöchentlich (Mo 06:00 Europe/Zurich — entspricht dem früheren launchd-Rhythmus).

```bash
# Mini-SA + minimale Rolle:
gcloud iam service-accounts create rubicon-scheduler --project=aixs-260106 \
  --display-name="RUBICON Scheduler (run.jobs.run)"
gcloud run jobs add-iam-policy-binding rubicon-report-job \
  --project=aixs-260106 --region=europe-west4 \
  --member=serviceAccount:rubicon-scheduler@aixs-260106.iam.gserviceaccount.com \
  --role=roles/run.invoker
# Scheduler:
gcloud scheduler jobs create http rubicon-report-sched \
  --project=aixs-260106 --location=europe-west4 \
  --schedule="0 6 * * 1" --time-zone="Europe/Zurich" --http-method=POST \
  --uri="https://run.googleapis.com/v2/projects/aixs-260106/locations/europe-west4/jobs/rubicon-report-job:run" \
  --oauth-service-account-email=rubicon-scheduler@aixs-260106.iam.gserviceaccount.com
```

### 9.5 Status (transparent — Migrations-Stand)

| Element | Status |
|---|---|
| Shared Drive „00 AXS - Rubicon" + 6 Ordner + 373 Baseline-Dokumente | ✅ angelegt/befüllt |
| Service-User `rubicon@axs.aero` | ✅ angelegt |
| SA `rubicon-workspace` + DWD-Freigabe (drive/documents) | ✅ angelegt/approved |
| `rubicon@axs.aero` = Mitglied des Shared Drive | ✅ |
| Grant `rubicon-runtime` → `rubicon-workspace` (tokenCreator) | ⏳ beim Job-Anlegen (ersetzt das Test-Self-Binding) |
| Cloud-Run-Job `rubicon-report-job` | ⏳ nach dem Push (Job nutzt das frische Image) |
| SA `rubicon-scheduler` + Cloud Scheduler `rubicon-report-sched` | ⏳ nach dem Job |

**Noch nicht serverseitig** (Follow-ups, s. README-Migrations-Status): Δ-Block (via GCS-Object-Version
statt git), KI-Narrativ (via AIXS-Plattform), AXS-Template, die Generatoren protokoll/traktanden/entscheide.
**Gebrandeter HTML-Chrome-Renderer** (die heute lokal via MCP erzeugte gebrandete Report-Version) kann
später serverseitig **optional per Feature-Flag** angeboten werden (Headless-Chrome ins Image); die
PDF-Quelle im Code ist dafür pluggbar gehalten (Alternative zum aktuellen chromefreien Doc-Export-Weg).
