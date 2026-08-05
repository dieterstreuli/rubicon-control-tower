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
  Python/Chromium bewusst NICHT drin → **PDF-/GDoc-Export deaktiviert** (Kern läuft ohne).
- **`.dockerignore`** (neu): `node_modules`, `dist`, `.git`, `public`, …
- **`vite.config.js`**: `server.allowedHosts: true` (DNS-Rebind-Check aus; Host variabel `*.run.app`/Custom-Domain; Schutz macht IAP).
- **`plugins/rubicon-api.js`**: `OK_ORIGINS` um **Env-Override** `RUBICON_OK_ORIGINS` (Komma-separiert) ergänzt — Deploy-Origins ohne Code-Redeploy.
- **Env am Service:** `RUBICON_OK_ORIGINS` = `https://rubicon.axs.aero` + beide run.app-URLs (Custom-Domain MUSS drin sein, sonst weist der Origin-Guard POSTs von `rubicon.axs.aero` ab); `RUBICON_PY=python3`; `PORT=8080`.

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
  src/data gs://aixs-rubicon-tower-data
```

> ⚠️ **Bei normalen Code-Redeploys NICHT erneut seeden** — das würde die im Bucket
> gesammelten Live-Writes (protokolle/tasks/entscheide) mit dem Repo-Stand **überschreiben**.
> Nur seeden, wenn bewusst ein neuer Voll-Datenstand die Cloud-Wahrheit ersetzen soll
> (dann vorher Bucket sichern: `gcloud storage cp -r gs://aixs-rubicon-tower-data <backup>`).

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
- **Kein PDF-/GDoc-Export** (Python/Chromium nicht im Image) — bei Bedarf nachrüsten + AXS-Service-Account.
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
