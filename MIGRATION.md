# MIGRATION.md — RUBICON Control Tower in die AXS-Welt überführen

Zweck: Dieses Projekt (Code **und** Daten) ist jederzeit vom DRS-Mac auf eine
AXS-Umgebung übertragbar (Server/VM, Mitarbeiter-Arbeitsplatz, später Cloud).
Dieses Runbook ist die vollständige Anleitung. Stand: 13.07.2026.

## 1 · Was die Wahrheit ist (Daten-Inventar)

| Ort | Inhalt | Transfer |
|---|---|---|
| `src/data/projekt.yaml` | EINZIGE Wahrheitsquelle: 134 MS, Inputs, meta | im Repo ✅ |
| `src/data/tasks.json` | 841 Handlungen (T-###, Status, Kopplungen) | im Repo ✅ |
| `src/data/protokolle.json` | Sitzungsprotokolle inkl. Gemini-Quellenbindung | im Repo ✅ |
| `src/data/*.json` (briefings, traktanden, reports_index, …) | abgeleitete/ergänzende Daten | im Repo ✅ |
| `scripts/_sources/` | Build-Quellen (rebuild-fähig, Round-Trip-verifiziert) | im Repo ✅ |
| `scripts/_drafts_*.json` | Zerlegungs-Archive (Re-Seed-fähig) | im Repo ✅ |
| `public/` (PDFs/PNGs) | regenerierbar (`gen_*.py`), aber mitversioniert | im Repo ✅ |
| **Google Drive** (Reports, Protokolle, Traktanden, **Datenlieferungen**) | Export-Artefakte | liegt BEREITS in der AXS-Welt (Drive) — unabhängig vom Mac ✅ |

## 2 · Abhängigkeits-Matrix (Mac-spezifisch → portabel)

| Abhängigkeit | Heute (DRS-Mac) | Portabler Mechanismus |
|---|---|---|
| Python-Interpreter | `/Library/Frameworks/…/3.14/bin/python3` | env `RUBICON_PY=<pfad>` (rubicon-api.js liest ihn) |
| Chief/Tools (md_to_gdoc, html_to_pdf, _google_auth, _templates) | `~/Chief/Tools` gewinnt | **vendored Snapshot `scripts/_tools/`** greift automatisch, wenn der Mac-Pfad fehlt |
| Python-Pakete | installiert | `pip install -r scripts/requirements.txt` (Python ≥ 3.11) |
| Node/Vite | nvm Node 24 | Node ≥ 20, `npm ci` |
| PDF-Rendering | headless Chrome | Chrome/Chromium im PATH nötig |
| Google-Zugriff (NUR für GDoc-/Drive-Exporte + Gemini-Import) | DRS-OAuth `~/.config/google-mcp/` | AXS-Service-Account oder eigene OAuth-Creds; **Tower-Kern läuft komplett OHNE Google** |
| Dauerbetrieb | launchd-Plists (im Repo als Vorlage) | systemd-Unit / Container / PM2 |
| Remote-Zugang | Tailscale Serve (DRS-Tailnet) | Internal-Apps-Gateway (Projekt #99) o.ä.; `OK_ORIGINS` in `plugins/rubicon-api.js` + `allowedHosts` in `vite.config.js` anpassen |
| Report-Cron | launchd Mo 06:00 | cron/systemd-timer → `gen_report.py --auto` |

## 3 · Zielszenarien

- **A (empfohlen): AXS-Server/VM hinter Internal-Apps-Gateway (#99)** — ein Ort, GL-Zugriff per Browser, echte Auth am Gateway.
- **B: Mitarbeiter-Arbeitsplatz (Mac/PC)** — identische Schritte, Zugriff lokal/VPN.
- **C: Cloud (Vertex-Stack)** — später; gleiche Artefakte, Container-Build.

## 4 · Transfer Schritt für Schritt (~1 h)

1. Repo übertragen: `git clone`/Kopie von `control-tower/` (ohne `node_modules`).
2. Node ≥ 20 installieren → `npm ci`.
3. Python ≥ 3.11 → `pip install -r scripts/requirements.txt`; Chrome/Chromium installieren.
4. `export RUBICON_PY=$(which python3)` (Umgebung des Servers/Users).
5. Start: `npm run dev -- --host 127.0.0.1 --port 8621` (bzw. `serve.sh` anpassen).
   **Wichtig:** Die Write-API (`plugins/rubicon-api.js`) ist eine Vite-Dev-Middleware —
   der Tower läuft bewusst im Dev-Modus (wie heute). Optionale Härtung für Dauerbetrieb:
   Middleware in kleinen Express-Server portieren (~1 Tag, Schnittstellen identisch).
6. Verifikation: `python3 scripts/validate.py` (EXIT=0) + `python3 scripts/test_status_parity.py` (16/16) + `curl localhost:8621` (200).
7. Google-Exporte (optional): Service-Account/OAuth einrichten, `scripts/_tools/_google_auth.py` → Credential-Pfad/Account anpassen; `import_gemini_doc.py` Account-Parameter.
8. Zugriff: Gateway/Reverse-Proxy → `OK_ORIGINS` (rubicon-api.js) + `allowedHosts` (vite.config.js) um neuen Host ergänzen.
9. Dauerbetrieb: systemd-Unit (After=network, WorkingDirectory=Repo, ExecStart=npm run dev …, Restart=always) + Timer für `gen_report.py --auto` (Mo 06:00 + Monatsanfang).
10. Cutover: Mac-launchd stoppen (`launchctl bootout gui/$UID ch.streuli.chief.rubicon-tower`), Tailscale-Serve entfernen, Nutzer auf neue URL.

## 5 · Was bewusst NICHT mitgeht

DRS-OAuth-Tokens (persönlich) · Tailnet-Konfiguration · launchd-Plists (nur als Vorlage) · caffeinate-Krücken.

## 6 · Sicherheit im Mehrbenutzer-Betrieb

`role`/`me` sind clientseitig (Defense-in-Depth, dokumentiert seit Audit #3) — im
AXS-Setup MUSS echte Authentisierung davor (Gateway #99 = genau dieses Projekt).
Bis dahin gilt: Zugriff = Netzwerk-Zugang (heute Tailnet, morgen Gateway).

## 7 · Betriebs-Sicherung heute

Nightly-Backup des gesamten `~/Chief` (03:00 ZRH) + Git-Versionierung (dieses Repo,
seit 13.07.2026) + Drive-Artefakte liegen ohnehin in der AXS-Welt.
