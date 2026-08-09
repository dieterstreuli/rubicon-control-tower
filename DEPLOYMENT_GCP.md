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

- **`Dockerfile`** (neu): `node:24-slim`, `npm ci`, startet **Vite-Dev** (`--host 0.0.0.0 --port $PORT`).
  `python3` + die Google-API-Client-Libs (`google-api-python-client`, `google-auth`) sind im Image
  (für die Renderer-Skripte, inkl. serverseitige Report-Erzeugung, s. §9). Chromium ist bewusst
  NICHT drin (Image-Größe): Reports (§9) und die Fix-Struktur-Docs (Weg 1, §12) laufen serverseitig
  chromefrei über die Docs-API; der dynamische HTML-PDF-Pfad (Report/Protokoll, Weg 2) rendert über
  den **eigenen privaten Gotenberg-Service `rubicon-gotenberg`** (§11).
- **`.dockerignore`** (neu): `node_modules`, `dist`, `.git`, `public`, …
- **`vite.config.js`**: `server.allowedHosts: true` (DNS-Rebind-Check aus; Host variabel `*.run.app`/Custom-Domain; Schutz macht IAP).
- **`plugins/rubicon-api.js`**: `OK_ORIGINS` um **Env-Override** `RUBICON_OK_ORIGINS` (Komma-separiert) ergänzt — Deploy-Origins ohne Code-Redeploy.
- **Env am Service:** `RUBICON_OK_ORIGINS` = `https://rubicon.axs.aero` + beide run.app-URLs (Custom-Domain MUSS drin sein, sonst weist der Origin-Guard POSTs von `rubicon.axs.aero` ab); `RUBICON_PY=python3`; `PORT=8080`; `RUBICON_GOTENBERG_URL` (Gotenberg-Service-URL, **live gesetzt**, s. §11); **`RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT=rubicon@axs.aero`** (keyless-DWD auch für den Service — nötig für server-seitige Drive/Docs-Aktionen der App: on-demand Protokoll-Export, Report-Generierung, Gemini-Notiz-Import; sonst fällt der Code auf eine lokale User-OAuth-Datei zurück, die es im Container nicht gibt). Delimiter der `--set-env-vars`-Kette ist `^;^` (nicht `^@^`), weil SA-Email/Subject ein `@` enthalten.
- **Dokumenten-Ablage:** `RUBICON_DOCS_DIR=/app/src/data/_generated`
  (liegt mit auf dem GCS-Volume, s. §1) hat beim Ausliefern Vorrang vor der ins Image gebackenen
  `public`-Baseline (`resolveStaticPath` in `server.mjs`). Der Report-Job (s. §9) schreibt bereits
  serverseitig und **chromefrei** dorthin (Google Doc + Drive-`files.export`) — diese PDFs
  überleben damit Neustart/Redeploy. Briefings/Entscheide/Traktanden/Führungsrhythmus schreibt der
  Weg-1-Job `rubicon-docs-job` (§12) ebenso serverseitig dorthin; Protokolle rendern serverseitig über
  den privaten Gotenberg-Service `rubicon-gotenberg` (§11).

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
- **HTML-PDF ohne Chromium im Container (erledigt):** Fix-Struktur-Docs (Weg 1, §12) laufen
  serverseitig chromefrei über die Docs-API; der dynamische HTML-PDF-Pfad (Report/Protokoll, Weg 2)
  rendert über den eigenen privaten Gotenberg-Service `rubicon-gotenberg` (§11). Chromium bleibt
  bewusst aus dem Image.
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
erzeugt und per **Drive-`files.export`** zu PDF gewandelt — **ohne Chrome**, über einen
Cloud-Run-Job (live). Der Code passt sich der Laufzeitumgebung an (**Dual-Mode**, s. „Migrations-Status"
im README): lokal unverändert (Chrome + User-OAuth), serverseitig nur wenn die DWD-Env-Variablen
gesetzt sind. **Diese Env tragen die Jobs UND — seit 07.08.2026 — der Web-Service** (für die
on-demand Drive/Docs-Aktionen der App, s. §11); die Umschaltung erfolgt allein über die Env, kein Flag.

### 9.1 Identitäts-Kette (keyless Domain-Wide-Delegation)

| Element | Wert | Zweck |
|---|---|---|
| **Service-User** | `rubicon@axs.aero` (Workspace-Konto, OU `/nouser`, GAL-hidden, Business-Standard) | Identität, unter der Dokumente in Drive erzeugt werden (Autor) |
| **Service Account** | `rubicon-workspace@aixs-260106` (Client-ID `112708550499414880483`) | impersoniert `rubicon@axs.aero` per **keyless DWD** (IAM-Credentials `signJwt`, kein JSON-Key) |
| **DWD-Freigabe** | Admin-Konsole → API-Controls → Domain-Wide-Delegation: Client-ID oben + Scopes `…/auth/drive` + `…/auth/documents` | erlaubt dem SA das Handeln als der Service-User (braucht 2.-Admin-Approval) |
| **Prozess-SA** | `rubicon-runtime@aixs-260106` (hat Bucket-Zugriff) | Laufzeit-Identität von **Jobs UND Web-Service**; DWD-Basis, signiert das JWT als `rubicon-workspace` |
| **Grant** | `rubicon-runtime` → `iam.serviceAccountTokenCreator` auf `rubicon-workspace` | erlaubt `rubicon-runtime` das `signJwt` als `rubicon-workspace` |

**Rechte-Stand (07.08.2026) — was aktiviert wurde, ohne neue IAM-Bindings:** Der Web-Service läuft
unter derselben SA `rubicon-runtime`; mit der neuen DWD-Env am Service (§0/§11) **nutzt jetzt auch der
Service** die *bestehende* `serviceAccountTokenCreator`-Delegation (Zeile „Grant") und agiert
server-seitig als `rubicon@axs.aero` — für die on-demand Drive/Docs-Aktionen der App. Ebenso ruft der
Service den privaten Gotenberg über die *bestehende* `roles/run.invoker`-Bindung von `rubicon-runtime`
auf `rubicon-gotenberg` (§11). **Es wurde in dieser Runde KEINE neue IAM-Bindung erteilt** — beide
Grants existierten bereits (für die Jobs); neu ist allein die Aktivierung der Fähigkeit am Service via
Env. Scope-Umfang unverändert: nur `…/auth/drive` + `…/auth/documents`.

In-House-Vorlage der keyless-DWD-Mechanik: `scripts/_tools/gdoc_pdf.py` (bzw. das Muster aus
`_google_auth._dwd_credentials`). Kein statischer Key nötig (Metadata-ADC signiert per IAM-API).

### 9.2 Shared Drive + Identitäten

**Shared Drive „00 AXS - Rubicon"** (`0AK8sNCBforeMUk9PVA`, europe/Workspace) — `rubicon@axs.aero` ist
Mitglied (content-manager genügt). **8 Ordner im Root:**

| Ordner | ID |
|---|---|
| Templates | — (AXS-Vorlagen, Weg 1) |
| reports | `1hiuxVPBO3Hwd3I0g1lDTxKFAwk851Y0m` |
| protokolle | `1MlvxkY4Ti8MdTwT3ODs7HM-7mF74lPHm` |
| entscheide | `1wI2ggCw3erqeQ3HW2bcKxk4rg-zKo0rb` |
| briefings | `1uopFGM23gaWQV_3CuHA3wRYT-Bei3VKa` |
| traktanden | `1hQ_9DP-NlwDSHr-pSAw0B5hXHC37mAYY` |
| fuehrungsrhythmus | `1pPACow-VB9UOZ8N2RDDqZGGExsnDznB1` |
| pakete | `1gE8EgiNHAmPuKwDe4QHDCWbemCMMcHB_` |

**Identitäten (alle):**

| Identität | Zweck |
|---|---|
| `rubicon-workspace@aixs-260106.iam.gserviceaccount.com` | Workspace-Integration (keyless DWD; hält die Domain-Wide-Delegation, impersoniert `rubicon@axs.aero`) |
| `rubicon-runtime@aixs-260106.iam.gserviceaccount.com` | Cloud-Run-Runtime (least-privilege; Identität von Service + Jobs; `roles/iam.serviceAccountTokenCreator` auf `rubicon-workspace`; `run.invoker` auf `rubicon-gotenberg`) |
| `rubicon-deployer@aixs-260106.iam.gserviceaccount.com` | GitHub-Actions-Deployer (keyless via WIF) |
| `rubicon-scheduler@aixs-260106.iam.gserviceaccount.com` | Cloud-Scheduler-Mini-SA (`run.jobs.run`) |
| `rubicon-gotenberg@aixs-260106.iam.gserviceaccount.com` | Identität des privaten Gotenberg-Service (no-role) |
| `rubicon@axs.aero` | Workspace-Service-User = DWD-Subject; Mitglied des Shared Drive |
| `rubicon-app@axs.aero` | Zugriffs-/Editoren-Gruppe (s. §2) |

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
  --labels=app=rubicon \
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
| Shared Drive „00 AXS - Rubicon" + 8 Ordner + 373 Baseline-Dokumente | ✅ angelegt/befüllt |
| Service-User `rubicon@axs.aero` | ✅ angelegt |
| SA `rubicon-workspace` + DWD-Freigabe (`drive`/`documents`/`spreadsheets`/`gmail.send`/`gmail.modify`/`calendar.events`) | ✅ angelegt/approved (Gmail/Calendar für spätere Features vorab autorisiert) |
| `rubicon@axs.aero` = Mitglied des Shared Drive | ✅ |
| Grant `rubicon-runtime` → `rubicon-workspace` (tokenCreator) | ✅ gesetzt |
| Cloud-Run-Job `rubicon-report-job` | ✅ angelegt (Image-Loop in `deploy.yml`) |
| SA `rubicon-scheduler` + Cloud Scheduler `rubicon-report-sched` | ✅ live (Mo 06:00) |

**Noch nicht serverseitig** (Follow-ups, s. README-Migrations-Status): Δ-Block (via GCS-Object-Version
statt git) und KI-Narrativ (via AIXS-Plattform). Die Doc-Generatoren sind serverseitig abgedeckt —
**zwei verbindliche Wege** (entschieden 07.08.2026, s. `§11` + README „Doc-Erzeugung: genau zwei
Wege"): **Weg 1** = Docs-REST-Vorlagen-Engine (feste, gebrandete Docs —
Traktanden/Entscheid/Briefing/Führungsrhythmus), live über `rubicon-docs-job` (§12); **Weg 2** =
HTML→PDF via **Gotenberg** (eigener privater Cloud-Run-Service `rubicon-gotenberg`) für die dynamischen
Docs (Report/Protokoll). Die PDF-Quelle im Code ist dafür pluggbar gehalten.

---

## 10. Merge-Brücke — Struktur (Repo) → Live-Daten (Volume)

**Problem:** Der Code-Deploy fasst das Volume nicht an (Deploy ≠ Daten) → Struktur-Änderungen (neue
Meilensteine/Ströme/Briefings) erreichen den Live-Server nie. Das Volume aber einfach überschreiben
zerstört den Live-Zustand (Protokolle, Entscheide, abgehakte Tasks, Fortschritt). Die Merge-Brücke
zieht Struktur nach, **ohne** Live-Daten zu zerstören.

**Struktur-Quelle im Container:** Das Volume mountet über `/app/src/data` und verdeckt die gebackene
`src/data`. Darum legt der `Dockerfile` eine Kopie nach **`/app/_repo_seed`** (außerhalb des
Mount-Punkts) = Repo-Struktur; das Volume `/app/src/data` = Live-SSOT.

**Datei-Klassen** (`scripts/merge_bridge.py`):
- **Stammdaten** (Repo überschreibt): `domain/schema/briefings/fuehrungsrhythmus/traktanden/kontakte/gemini_meetings.json`
- **Transaktion** (Volume unberührt): `protokolle/protokolle_sensitiv/entscheide/reminder_log/report_comments/zielbild.json` **+ `reports_index.json`/`traktanden_docs.json`** (tragen job-geschriebene `server_doc_id`/`server_pdf_id` → Repo-Überschreiben würde die wipen)
- **Misch** (Merge-by-Key, Schlüssel `id`): `projekt.yaml`, `tasks.json`

**Feld-Vertrag** (aus `build_projekt_yaml.py:242-266` + `api-core.js` `mergeTasks`):
- `projekt.yaml`/Milestones: Struktur (`name/depends_on/gate/critical/phase/nachlauf`) aus Repo;
  Live (`progress/reported_slip_days/due/owner/progress_source/start`) aus Volume. Inputs:
  `status`+`liefer_tasks` aus Volume.
- **`meta` ist Repo-getrieben (Datenvertrag, geändert 07.08.2026):** der gesamte `meta`-Block —
  insb. **`today` (Steuerungsdatum)** und `datenlieferungen_url` — kommt aus dem **Repo (SEED)** und
  wird via `[publish-data]` live nachgezogen. Die App schreibt `meta` **nie** (nur Lesen), darum
  gibt es keinen Live-Wert zu bewahren; ein früheres Volume-Preserve fror das Steuerungsdatum ein
  (Repo-Update kam live nicht an). **Source-of-Truth = `projekt.yaml` im Repo:** Steuerungsdatum
  fortschreiben = Wert dort ändern + Commit mit `[publish-data]` im Subject.
- `tasks.json`: Repo (`text/owner/due/ms_id/source/origin`); Volume (`nr/status/erledigt_am/erledigt_von/created_at`).
  Volume-only Tasks (live erfasst) bleiben erhalten.
- **Lösch-Politik = behalten + melden:** Milestone/Input im Volume mit Live-Daten, im Repo entfernt →
  bleibt erhalten + wird als Konflikt gemeldet (nie stiller Verlust).

**Wochen-Delta-Historie (`projekt.yaml`-Snapshots):** Der Δ-Block (`/api/delta`, `scripts/gen_delta.py`)
vergleicht den heutigen `projekt.yaml`-Stand mit dem Stand von vor N Tagen. **Lokal** liefert das die
git-Historie; **serverseitig gibt es kein git** (schlankes Image, `.git` bewusst nicht im Container) →
stattdessen **datierte Snapshots** unter `/app/src/data/history/projekt-<YYYYMMDDThhmmssZ>.yaml`
(= Volume-Prefix `history/`). Die Merge-Brücke schreibt nach jedem angewandten `projekt.yaml`-Publish
einen Snapshot (`merge_bridge._write_snapshot`, Dedupe bei unverändert, kollisionssicher, non-fatal).
`gen_delta` wählt die Quelle automatisch (kein Flag): **git hat Vorrang, wo verfügbar** (lokal),
serverseitig (kein git) der **jüngste gültige** Snapshot ≤ Fenstergrenze (formwidrige/defekte werden
übersprungen), sonst nur Store-Ereignisse. So verdrängt eine lokal versehentlich angelegte `history/`
nie die reiche git-Historie. **Einmaliger Backfill** der bestehenden git-Historie in den `history/`-Prefix
gibt der Funktion ab Deploy volle Tiefe:
```bash
# je Commit, der src/data/projekt.yaml berührte: Inhalt RE-SERIALISIERT (wie der Merge-Output, damit der
# erste Live-Publish sauber dedupt) -> history/projekt-<commit-UTC>.yaml -> Bucket
mkdir -p /tmp/hist
git -C <repo> log --follow --format='%H %cI' -- src/data/projekt.yaml | while read rev iso; do
  ts=$(python3 -c "import sys,datetime;print(datetime.datetime.fromisoformat(sys.argv[1]).astimezone(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))" "$iso")
  git -C <repo> show "$rev:src/data/projekt.yaml" \
    | python3 -c "import sys,yaml;yaml.safe_dump(yaml.safe_load(sys.stdin),sys.stdout,allow_unicode=True,sort_keys=False,default_flow_style=False)" \
    > "/tmp/hist/projekt-$ts.yaml"
done
gcloud storage cp "/tmp/hist/projekt-*.yaml" gs://aixs-rubicon-tower-data/history/
```
Nur `projekt.yaml`-Versionen (dieselbe Datenklasse wie die live liegende Datei) — **nicht** das ganze
`.git` (DSGVO: die Repo-Historie trägt Personendaten und gehört nie ins Volume/Image). Der `history/`-
Prefix ist per gcsfuse-`ImplicitDirs` (Laufzeit-Config bestätigt) sichtbar; `gen_delta._snapshots` globt
ohne `is_dir`-Gate → robust auch ohne Verzeichnis-Platzhalter. **Retention (Follow-up):** ein Snapshot je
Publish wächst langsam; ein Lifecycle-/Prune-Schritt (z.B. nur die letzten ~120 Tage behalten) steht aus.

**Job anlegen** (analog `rubicon-report-job`, gleicher SA/Volume/Image; Default = Dry-Run):
```bash
gcloud run jobs create rubicon-merge-job \
  --project=aixs-260106 --region=europe-west4 \
  --image=<PIPELINE-IMAGE>:latest \
  --service-account=rubicon-runtime@aixs-260106.iam.gserviceaccount.com \
  --add-volume=name=data,type=cloud-storage,bucket=aixs-rubicon-tower-data \
  --add-volume-mount=volume=data,mount-path=/app/src/data \
  --command=python3 --args=scripts/merge_bridge.py \
  --task-timeout=900 --max-retries=0 \
  --labels=app=rubicon
# Test (Dry-Run, schreibt nichts):
gcloud run jobs execute rubicon-merge-job --project=aixs-260106 --region=europe-west4 --wait
```
Die Deploy-Pipeline hebt den Job automatisch aufs neue Image (§ „Cloud-Run-Jobs auf neues Image heben").

**Trigger** (`.github/workflows/merge-data.yml`):
- **A (auto):** nach erfolgreichem Deploy, dessen **Commit-Subject (ERSTE Zeile)** `[publish-data]`
  trägt → Modus **`--auto`**: **wendet automatisch an, WENN der Merge 0 Konflikte hat** (mit Backup
  vorher) — der Normalfall (neue Struktur ohne Löschungen) publiziert damit automatisch live. Bei
  **Konflikten** (entfernte Struktur mit Live-Daten) wird **NICHT** angewandt, sondern gehalten +
  gemeldet → manueller Apply nach Prüfung (nie stiller Apply). Bewusst nur die erste Zeile: eine
  Prosa-Erwähnung von `[publish-data]` im Commit-**Body** (z.B. Feature-Beschreibung) triggert NICHT.
- **B (manuell):** `workflow_dispatch` mit `apply` — `false` = Dry-Run, `true` = **Backup + Anwenden**
  (`--apply`, erzwingt das Schreiben auch bei Konflikten = bewusste Entscheidung). Fehlt der Job,
  wird sauber übersprungen (Guard).

Der Job kennt drei Modi (`scripts/merge_bridge.py`): **dry-run** (nie schreiben), **`--auto`**
(schreiben nur bei 0 Konflikten), **`--apply`** (immer schreiben).

**Doc-Regenerierung nach Merge (Hook):** Bei `apply`/`auto` führt der Workflow **nach** dem Merge-Job
sequenziell den **`rubicon-docs-job`** aus — so passen die serverseitigen Weg-1-Docs (Traktanden/
Entscheide/Briefings/FR) zum frisch publizierten Datenstand. Dank Content-Hash-Gating (§12.1) ist das
**inkrementell** (nur geänderte Docs; No-Op, wenn nichts sich änderte) und **sequenziell** (kein
Backup-Race mit der Doc-Erzeugung). Damit haben Datenänderer keinen separaten Trigger nötig: ein
`[publish-data]`-Merge zieht die Docs automatisch nach.

**Backup + Konflikte:** Bei `apply`/`auto` sichert der Workflow zuerst die **Quell-Stores** (Top-Level
`*.json`/`*.yaml`) nach `gs://aixs-rubicon-tower-backup/merge-<ts>/` (rollback-fähig). **Bewusst OHNE
`_generated/`** (PDFs/PNGs): regenerierbar über den docs-job, blähen das Backup auf und racen mit
gleichzeitigen docs-job-Writes (ein rekursives `cp` traf eine gerade ersetzte Datei → 404 → Backup-Step
failte → Merge übersprungen). Der Merge fasst nur die Stores an — nur die gehören ins Rollback-Backup.
**Betriebsregel:** docs-job-Vollauf und Merge-`apply`/`auto` NICHT gleichzeitig laufen lassen. Der
Merge-Job gibt eine JSON-Zusammenfassung + Konfliktliste in die Logs; der Workflow-Step
„Merge-Zusammenfassung" macht sie sichtbar.

**IAM (beim Einrichten):** `rubicon-deployer` braucht auf `rubicon-report-job`/`rubicon-merge-job`
`run.jobs.run`/`update` (act-as `rubicon-runtime`, schon vorhanden) **+ Storage-Zugriff** auf
`aixs-rubicon-tower-data` (lesen) und `aixs-rubicon-tower-backup` (schreiben) für das Backup.

**Status (06.08. erledigt):** `rubicon-merge-job` **angelegt** (Image `2d8db5d`, SA `rubicon-runtime`,
Volume, `merge_bridge.py`, Default Dry-Run); `rubicon-deployer` Storage-Grants gesetzt
(`objectViewer` auf data, `objectAdmin` auf backup). **Dry-Run E2E verifiziert** (Exec `v4m9d`):
Stammdaten 7 / Transaktion 8 unberührt / projekt.yaml **0 Konflikte** / tasks.json 836 (0 volume-only),
schreibt nichts. Die Deploy-Pipeline hebt den Job künftig automatisch aufs neue Image.

---

## 11. Doc-Erzeugung — zwei Wege (Docs-REST + Gotenberg)

**Entscheidung (07.08.2026):** Dokumente entstehen über **genau zwei** Systeme; kein drittes, keine
externen PDF-APIs (DSGVO — Personendaten verlassen den Tenant nie). Leitplanken „wann welches" in der
README („Doc-Erzeugung: genau zwei Wege"). Hier die Infrastruktur.

**Weg 1 — Docs-REST-Vorlagen-Engine** (`scripts/_tools/doc_template.py`)
Braucht **keine** neue Infra: nutzt dieselbe keyless-DWD-Kette wie die Reports (`§9.1`) — Vorlage
kopieren, per Docs-API füllen, als PDF exportieren, alles über Google-APIs. Feste, gebrandete Docs
(Traktanden/Entscheid/Briefing/Führungsrhythmus). AXS-Vorlagen liegen im Shared-`Templates/`-Ordner;
die Template-IDs kommen als Container-Config (nicht Dieters lokale `chief_templates.json`).
Serverseitig **verdrahtet** über den Treiber `scripts/gen_docs_server.py` (Dual-Mode); die
Job-Provisionierung (`rubicon-docs-job`) ist in **§12** beschrieben.

**Weg 2 — HTML→PDF via Gotenberg** (self-hosted, für Report/Protokoll)
Dedizierte Doku (Code-Verhalten, betroffene Generatoren, Provisionierung inkl. PyMuPDF-Auflage):
[`docs/gotenberg-html-pdf.md`](docs/gotenberg-html-pdf.md).
[Gotenberg](https://gotenberg.dev) kapselt Chromium (+ LibreOffice) hinter einer stateless HTTP-API:
POST HTML (+ Assets als Multipart) an `/forms/chromium/convert/html` → PDF-Bytes zurück. Es ist die
serverseitige Fassung von Dieters lokalem `html_to_pdf` — **identische Optik**, self-hosted → **kein
PII-Abfluss**.

**Betrieb (deployed):** Gotenberg läuft als **eigener privater Cloud-Run-Service `rubicon-gotenberg`**
(Image `docker.io/gotenberg/gotenberg:8`, Port 3000, 2 GiB, scale-to-zero, `--no-allow-unauthenticated`,
eigener no-role SA `rubicon-gotenberg`, Label `app=rubicon`). Der App-Service ruft ihn **Service-to-Service per
OIDC-ID-Token** (SA `rubicon-runtime` hat `run.invoker` auf dem Gotenberg-Service); `RUBICON_GOTENBERG_URL`
am App-Service zeigt auf die Service-URL (in `deploy.yml` gesetzt). Cold-Start (scale-to-zero) wird durch
Retry/Backoff in `_render_via_gotenberg` abgefedert. *(Historischer Pivot: der zunächst geplante
Multi-Container-Sidecar scheiterte an der EXPOSE-3000-Portkollision mit dem App-Port.)*

Wiring (Code): die PDF-Quelle der Weg-2-Generatoren (`gen_report.py`, `gen_protokoll.py`) ist
pluggbar — im Server-Modus (env **`RUBICON_GOTENBERG_URL`** gesetzt) geht der PDF-Schritt an Gotenberg
statt an lokales Chrome; das HTML-Rendering (`render_*`) bleibt unverändert. Das HTML ist
self-contained (inline CSS, Logo als base64) — es braucht keine Asset-Uploads; Gotenberg läuft als
reines Stock-Image (`docker.io/gotenberg/gotenberg:8`) ohne eigene Font-/Asset-Ergänzungen.

**Dokumentierte Alternative zu Weg 2 — Jinja2 + WeasyPrint** (vorgemerkt, nicht gebaut)
Reiner Python-Weg ohne Browser (kein separater Dienst, Bibliothek im Hauptimage: `weasyprint` + System-Libs
Pango/Cairo/GDK-Pixbuf ~+100 MB). **Sinnvoll ab dem Punkt, wo** (a) die Chromium-Abhängigkeit raus
soll (Image/Cold-Start/Browser-Pflege), (b) Bit-Determinismus/Print-Feinheiten (paged-media,
Seitenzahlen) über Chrome-Pixeltreue gehen, oder (c) das Templating in echte Jinja2-Template-Dateien
(Conditionals/Loops/Filter) wandern soll. **Kosten:** CSS-Port auf das WeasyPrint-Subset
(flexbox/grid nur teilweise) + visuelle Neu-Abnahme. Bis dahin bleibt Gotenberg, weil es das
vorhandene Chrome-getunte HTML 1:1 rendert.

**Bewiesenes Invocation-Pattern** (lokaler Docker-Test 07.08.2026 bestanden):
```bash
docker run -d --rm -p 3000:3000 gotenberg/gotenberg:8      # /health healthy in ~2s
curl -F "files=@report.html;filename=index.html" \
     -F "preferCssPageSize=true" \                          # <- ehrt @page{size:A4;margin} der HTMLs
     http://localhost:3000/forms/chromium/convert/html -o report.pdf
```
Die RUBICON-HTMLs (`render_*`) sind self-contained (inline CSS + base64-Logo) → nur `index.html`,
keine Asset-Uploads. **`preferCssPageSize=true` ist Pflicht**, sonst nutzt Gotenberg seine
Default-Seitengröße statt des `@page`-A4 der Vorlagen.

**Status:** **Service + App-Wiring live.** Gotenberg läuft als eigener privater Service
`rubicon-gotenberg` (OIDC). Die PDF-Quelle der Weg-2-Generatoren ist im Code auf `RUBICON_GOTENBERG_URL`
umgebogen; die Variable ist am App-Service gesetzt (in `deploy.yml` hinterlegt), `html_to_pdf` verzweigt
serverseitig auf Gotenberg. Lokal E2E validiert — Report (inkl. Ampel-Pill) + Protokoll (alle bedingten
Sektionen) via echte Gotenberg-HTTP-API gerendert, optisch identisch zum Live-Stand. (Der vollständige
on-demand Protokoll-Export über den Live-Service inkl. Google-Doc-Schritt: End-to-End-Verifikation offen.)

---

## 12. Weg-1 Server-Job (`rubicon-docs-job`)

> **Angelegt + live.** Der serverseitige Weg-1-Treiber (`scripts/gen_docs_server.py`) ist deployed und
> der Cloud-Run-Job `rubicon-docs-job` ist **angelegt**; ein **Live-Lauf ist bestätigt** (echte
> gebrandete Docs + PDFs in der Shared-Ablage). Die `gcloud`-Zeilen unten dokumentieren die
> Job-Konfiguration (analog §9.3/§10). Offen bleibt nur der Scheduler (§12.3).

**Zweck:** `python3 scripts/gen_docs_server.py` serverseitig laufen lassen. Der Treiber erzeugt für
Traktanden, Entscheide, Briefings und Führungsrhythmus je ein gebrandetes Google-Doc + PDF über die
Weg-1-Vorlagen-Engine (`§11`), legt sie in die Shared-Ablage-Ordner (`§9.2`) und schreibt die PDFs +
Seite-1-PNG-Previews zusätzlich ins Volume (`RUBICON_DOCS_DIR`). Der Job **spiegelt
`rubicon-report-job` (§9.3)**: SA `rubicon-runtime`, dasselbe GCS-Volume, dasselbe Pipeline-Image,
DWD-Env für den Server-Modus, Timeout 1800s.

**Dual-Mode-Invariante:** Der Job fasst **ausschließlich `server_*`-Felder** an (`export.server_*`,
`traktanden_docs.json`, `briefings_docs.json`, `fuehrungsrhythmus_doc.json`). Dieters lokale Felder
und lokale Doc-IDs bleiben unberührt und werden nie getrasht. Wie bei den anderen Jobs erkennt der
Treiber den Server-Modus **allein** an der DWD-Env (`RUBICON_WORKSPACE_SA` +
`RUBICON_IMPERSONATE_SUBJECT`). Diese Env trägt der Job; seit 07.08.2026 auch der Web-Service (für
seine eigenen on-demand Drive/Docs-Aktionen, s. §11) — an dieser Job-Invariante ändert das nichts.

### 12.1 Pflicht-/Konfig-Env

- **`RUBICON_DRIVE_FR_FOLDER` (Default gesetzt).** Der Führungsrhythmus-Ordner hat — wie die anderen
  drei — einen **Code-Default im Treiber**: `fuehrungsrhythmus` = `1pPACow-VB9UOZ8N2RDDqZGGExsnDznB1`
  (Shared-Drive-Root `0AK8sNCBforeMUk9PVA`, Geschwister zu `traktanden`/`entscheide`/`briefings`); die
  Env übersteuert ihn. Nur bei **explizit leerer** Variable meldet der Treiber den Typ als
  **`ENV_MISSING`** (lauter Marker im `per_typ`-Log — kein stiller Erfolg).
- **Ordner-Overrides (optional, Defaults im Treiber = die IDs aus §9.2):**
  `RUBICON_DRIVE_TRAKTANDEN_FOLDER`, `RUBICON_DRIVE_ENTSCHEIDE_FOLDER`,
  `RUBICON_DRIVE_BRIEFINGS_FOLDER`, `RUBICON_DRIVE_FR_FOLDER`.
- **Template-Override (optional):** `RUBICON_TEMPLATE_<TYP>` (Singular, z.B.
  `RUBICON_TEMPLATE_ENTSCHEIDE`) übersteuert die Template-ID aus
  `scripts/_tools/rubicon_templates.json`.
- **`RUBICON_DOCS_FORCE` (optional):** hebt das **inkrementelle Hash-Gating** auf und rendert
  ALLES neu. Standard ist inkrementell: je Doc wird ein Content-Hash der Render-Eingaben
  (Vorlagen-ID + Spec, ohne Zeitstempel) als `server_hash` neben `server_doc_id` gespeichert;
  ein Lauf **überspringt** unveränderte Docs (Hash gleich + Server-Doc existiert) und rendert nur
  geänderte/neue → ein normaler Lauf schreibt typisch 0–wenige Docs (nimmt die Docs-/Drive-Quota-
  Last raus). FORCE nötig bei **Vorlagen-Inhaltsänderung** (gleiche Template-ID) oder wenn ein
  Server-Doc **extern getrasht** wurde (Hash matcht sonst → dauerhaft übersprungen).
- **Volume/Standard-Env wie die anderen Jobs:** `RUBICON_DATA_DIR`/`RUBICON_DOCS_DIR` (= Volume),
  `RUBICON_PY`, plus die DWD-Env (`RUBICON_WORKSPACE_SA`, `RUBICON_IMPERSONATE_SUBJECT`).

**Container-Abhängigkeit — PyMuPDF (`fitz`):** wird für die Seite-1-PNG-Previews (Briefings +
Führungsrhythmus, ZOOM 2.0) gebraucht. Ist bereits für die Report-/Protokoll-Preview-Erzeugung im
Image vorhanden — beim Job-Bau sicherstellen, dass es im Image bleibt. (Fehlt `fitz`, ist der
PNG-Schritt non-fatal übersprungen; die PDFs entstehen trotzdem.)

### 12.2 Job-Konfiguration (angelegt)

```bash
# Angelegt. Analog rubicon-report-job (§9.3): Command-Override auf gen_docs_server.py, gleiches
# Image/Volume/SA, DWD-Env; gehärtet (2 GiB, kein Retry, Timeout 3600 s).
gcloud run jobs create rubicon-docs-job \
  --project=aixs-260106 --region=europe-west4 \
  --image=<PIPELINE-IMAGE>:latest \
  --service-account=rubicon-runtime@aixs-260106.iam.gserviceaccount.com \
  --add-volume=name=data,type=cloud-storage,bucket=aixs-rubicon-tower-data \
  --add-volume-mount=volume=data,mount-path=/app/src/data \
  --command=python3 --args=scripts/gen_docs_server.py \
  --memory=2Gi --task-timeout=3600 --max-retries=0 \
  --labels=app=rubicon \
  --set-env-vars="^#^RUBICON_PY=/usr/bin/python3#RUBICON_DOCS_DIR=/app/src/data/_generated#RUBICON_WORKSPACE_SA=rubicon-workspace@aixs-260106.iam.gserviceaccount.com#RUBICON_IMPERSONATE_SUBJECT=rubicon@axs.aero#RUBICON_DRIVE_FR_FOLDER=1pPACow-VB9UOZ8N2RDDqZGGExsnDznB1"
# Delimiter MUSS ^#^ sein (nicht ^@^): die Werte enthalten @ (SA-/Subject-Emails) — s. §9.3.
# RUBICON_DRIVE_FR_FOLDER ist PFLICHT (sonst FR-Typ = ENV_MISSING). Traktanden/Entscheide/Briefings
# nutzen sonst die Default-Ordner-IDs aus §9.2 — optional per RUBICON_DRIVE_{TRAKTANDEN,ENTSCHEIDE,
# BRIEFINGS}_FOLDER übersteuerbar; Template-Override optional per RUBICON_TEMPLATE_<TYP>.

# Manueller Test-Lauf (nach dem Anlegen):
gcloud run jobs execute rubicon-docs-job --project=aixs-260106 --region=europe-west4 --wait
```

### 12.3 Scheduler `rubicon-docs-sched` + Merge-Hook (Soll)

Wöchentlicher Trigger **nach** dem Report-Lauf (§9.4 läuft Mo 06:00), über denselben least-privilege
Mini-SA `rubicon-scheduler` (nur `run.jobs.run`):

```bash
# SOLL. Invoke-Recht des Scheduler-SA auf den neuen Job:
gcloud run jobs add-iam-policy-binding rubicon-docs-job \
  --project=aixs-260106 --region=europe-west4 \
  --member=serviceAccount:rubicon-scheduler@aixs-260106.iam.gserviceaccount.com \
  --role=roles/run.invoker
# Scheduler (z.B. Mo 06:15, gestaffelt hinter dem Report-Lauf 06:00):
gcloud scheduler jobs create http rubicon-docs-sched \
  --project=aixs-260106 --location=europe-west4 \
  --schedule="15 6 * * 1" --time-zone="Europe/Zurich" --http-method=POST \
  --uri="https://run.googleapis.com/v2/projects/aixs-260106/locations/europe-west4/jobs/rubicon-docs-job:run" \
  --oauth-service-account-email=rubicon-scheduler@aixs-260106.iam.gserviceaccount.com
```

Zusätzlich als **Hook im Merge-Flow**: nach einem erfolgreichen `[publish-data]`-Publish (§10) — wenn
neue/geänderte Struktur live ist — den Doc-Job anstoßen, damit die gebrandeten Docs den frischen Stand
abbilden.

### 12.4 IAM + Pipeline

- **`rubicon-deployer`** braucht auf `rubicon-docs-job` `run.jobs.run`/`run.jobs.update` (act-as
  `rubicon-runtime`, wie bei `rubicon-report-job`/`rubicon-merge-job` schon vorhanden).
- Der **`deploy.yml`-Loop** „Cloud-Run-Jobs auf neues Image heben" (§10) ist um `rubicon-docs-job`
  **erweitert (erledigt)** — der Job wird bei jedem Deploy automatisch aufs frische Image gezogen.

### 12.5 Status

| Element | Status |
|---|---|
| Treiber `scripts/gen_docs_server.py` + Mapper (`_docmap.py`) + Materializer (`_tools/doc_materialize.py`) | ✅ im Code / deployed |
| `server_*`-Stores + additive UI-„Doc ↗"-Links (`api-core.js`/`src/lib/data.js` + Views) | ✅ im Code / deployed |
| Template-IDs (`scripts/_tools/rubicon_templates.json`) | ✅ hinterlegt |
| Image mit Weg-1-/Gotenberg-Code deployed (Revision live) | ✅ |
| Führungsrhythmus-Ordner (`1pPACow-…`) — Code-Default + optionale Env `RUBICON_DRIVE_FR_FOLDER` | ✅ angelegt + Default gesetzt |
| Cloud-Run-Job `rubicon-docs-job` (2 GiB, kein Retry, Timeout 3600 s) | ✅ angelegt |
| Grant `rubicon-runtime` → `rubicon-workspace` (tokenCreator) | ✅ gesetzt |
| Erster Live-Lauf (echte Docs/PDFs) | ✅ Entscheide/Traktanden/FR + Teil der Briefings gerendert; bei der Briefing-Masse trat 429-Sättigung auf (Backoff allein reicht nicht) → `batchUpdate`-Bündelung + Pacing (< 60/min) ergänzt; sauberer Vollauf nach Deploy ausstehend |
| Doc-Pipeline-Robustheit: `batchUpdate`-Bündelung + Pacing (`doc_template.py`) | ✅ im Code (Tests) — greift ab nächstem Job-Deploy |
| Gotenberg-Service `rubicon-gotenberg` (privat, OIDC) | ✅ Service live + App-Wiring live (`RUBICON_GOTENBERG_URL` am App-Service) |
| Server-DWD am Web-Service (`RUBICON_WORKSPACE_SA` + `RUBICON_IMPERSONATE_SUBJECT`) | ✅ live — über den Live-Service bestätigt: Report-Generierung (Google-Doc erzeugt) + Gemini-Import (Auth statt lokaler-OAuth-Fehler). Protokoll-Export-E2E s. §11. Keine neue IAM-Bindung (§9.1) |
| Datenvertrag `meta` Repo-getrieben (`merge_bridge.py`, §10) | ✅ im Code — greift ab nächstem Merge-Job-Deploy |
| `deploy.yml`-Image-Loop um `rubicon-docs-job` erweitert | ✅ |
| Scheduler `rubicon-docs-sched` + Merge-Hook | ⏳ offen (§12.3) |
