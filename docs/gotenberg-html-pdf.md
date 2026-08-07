# Serverseitiger HTML→PDF-Weg (Gotenberg)

Diese Doku beschreibt **Weg 2** der Doc-Erzeugung: die serverseitige HTML→PDF-Wandlung über einen
selbst gehosteten **Gotenberg**-Dienst. Sie richtet sich an IT/Betrieb und deckt das Code-Verhalten,
die betroffenen Generatoren, die noch offene Container-Provisionierung sowie das validierte
Aufrufmuster ab.

Der Renderer-Code ist fertig und lokal end-to-end validiert. Die Container-/Deploy-Provisionierung
(Sidecar, Env-Variable, eine fehlende Python-Abhängigkeit) ist der **nächste, noch nicht ausgeführte
Schritt** — sie ist unten als Soll klar markiert.

---

## 1. Zweck & Abgrenzung

Es gibt **genau zwei** Wege, aus RUBICON heraus Dokumente zu erzeugen (verbindliche Leitplanken in der
README, Abschnitt „Doc-Erzeugung: genau zwei Wege"):

- **Weg 1 — Docs-REST-Vorlagen-Engine** (`scripts/_tools/doc_template.py`): AXS-gebrandete Fix-Struktur-
  Dokumente (Traktanden, Entscheid, Briefing, Führungsrhythmus). Läuft serverseitig **chromefrei** über
  Google-APIs (Vorlage kopieren → per Docs-API füllen → als PDF exportieren). Anleitung:
  [`docs/template-engine-anleitung.md`](template-engine-anleitung.md).
- **Weg 2 — HTML→PDF via Gotenberg** (diese Doku): dynamisches, berechnetes Layout (Ampel-Pills,
  Inline-Balken, Narrativ, git-Delta, Level-Varianten) — für **Report und Protokoll**. Das in Python
  erzeugte `render_*`-HTML wird als PDF gerendert.

**Warum Gotenberg statt Chrome im Container.** Der lokale Weg von Dieter rendert HTML mit einem
headless Google Chrome. Das Container-Image enthält **bewusst keinen** Chromium (Image-Größe, Cold-
Start, Browser-Pflege). [Gotenberg](https://gotenberg.dev) kapselt Chromium hinter einer zustandslosen
HTTP-API und wird als eigener Dienst (Sidecar) betrieben. Ergebnis: **optisch identisches** Rendering
des vorhandenen, Chrome-getunten HTMLs, **self-hosted** → es verlässt keine PII den Mandanten. Eine
dokumentierte, noch nicht gebaute Alternative (Jinja2 + WeasyPrint) ist in `DEPLOYMENT_GCP.md §11` und
der README festgehalten.

---

## 2. Code-Verhalten

Zentraler Renderer: **`scripts/_tools/html_to_pdf.py`**, Funktion

```python
html_to_pdf(html_path, pdf_path=None, landscape=False, timeout=60)
```

Die Funktion **verzweigt intern nach Umgebung** — Signatur und alle Aufrufer bleiben unverändert:

- Ist die Env-Variable **`RUBICON_GOTENBERG_URL`** gesetzt, läuft das Rendern über
  `_render_via_gotenberg(...)` (Server-Modus).
- Ist sie **nicht** gesetzt, greift unverändert der bestehende **lokale headless-Chrome-Pfad** (Dieters
  Mac). Dort ändert sich nichts.

### Gotenberg-Aufruf im Detail

- **Request:** `POST {RUBICON_GOTENBERG_URL}/forms/chromium/convert/html` als `multipart/form-data`.
  Eine abschließende `/` in der URL wird entfernt.
- **HTML-Datei:** als Part `files` mitgeschickt; der Dateiname **muss `index.html`** lauten (Gotenberg-
  Pflicht), Content-Type `text/html`.
- **Formfeld `preferCssPageSize=true`** wird **immer** gesetzt (Pflicht). Ohne dieses Feld ignoriert
  Gotenberg das `@page { size:A4; … }` der Vorlagen und nutzt seine Default-Seitengröße.
- **Querformat:** bei `landscape=True` kommt zusätzlich das Formfeld `landscape=true` hinzu.
- **Antwort:** die PDF-Bytes werden nach `pdf_path` geschrieben (eine vorhandene Datei wird zuvor
  entfernt).
- **`timeout`** (Default 60 s) wird an den HTTP-Request durchgereicht.

### Voraussetzung & Fehlerfall

- **Self-contained HTML vorausgesetzt:** die RUBICON-`render_*`-HTMLs sind eigenständig (Logo als
  base64, CSS inline) → es wird nur `index.html` hochgeladen, keine weiteren Asset-Uploads.
- **Nur Python-Standardbibliothek:** der Server-Pfad nutzt `urllib.request` — **keine neue
  Dependency**.
- **Fehlerfall:** liefert Gotenberg keine PDF-Bytes (Antwort beginnt nicht mit `%PDF`), wirft die
  Funktion einen `RuntimeError`.

---

## 3. Betroffene Generatoren

Alle PDF-Generatoren rufen denselben Renderer `html_to_pdf` auf. Serverseitig relevant für **Weg 2 /
Gotenberg** ist heute jedoch nur die Protokoll-Erzeugung — die übrigen Typen werden im Server entweder
chromefrei (Docs-Export) bedient oder sind reine Lokal-Generatoren.

| Generator | nutzt `html_to_pdf` | serverseitig relevant | Server-Weg |
|---|---|---|---|
| `gen_protokoll.py` | ja | **ja** — über die Node-Route `/api/protokoll/export` (`plugins/api-core.js` → `execFile python3 gen_protokoll.py`) getriggert | **Weg 2 (Gotenberg)** im Server-Modus |
| `gen_report.py` | ja (nur lokaler Pfad) | ja, aber **ohne Gotenberg** | **§9 Report-Automation** (Google-Docs-Export, chromefrei) — kein Gotenberg |
| `gen_traktanden_pdfs.py` | ja | serverseitig über den Weg-1-Treiber | **Weg 1** (`gen_docs_server.py`, Docs-Export) |
| `gen_briefing_pdfs.py` | ja | serverseitig über den Weg-1-Treiber | **Weg 1** (`gen_docs_server.py`) |
| `gen_entscheid_mail.py` | ja | serverseitig über den Weg-1-Treiber | **Weg 1** (`gen_docs_server.py`) |
| `gen_fuehrungsrhythmus_pdf.py` | ja (Querformat) | serverseitig über den Weg-1-Treiber | **Weg 1** (`gen_docs_server.py`) |

Konkret: `gen_traktanden_pdfs` / `gen_briefing_pdfs` / `gen_entscheid_mail` /
`gen_fuehrungsrhythmus_pdf` sind Dieters **lokale** Generatoren; serverseitig übernimmt für diese Typen
der Weg-1-Treiber `scripts/gen_docs_server.py` (Google-Docs-Export, kein Chrome/Gotenberg).
`gen_report.py` besitzt für den Server ebenfalls einen chromefreien §9-Server-Pfad (`gdoc_pdf`) und
braucht Gotenberg nicht. Der einzige heute im Container getriggerte Bruch ohne Chrome ist damit
**`gen_protokoll.py`** — mit gesetztem `RUBICON_GOTENBERG_URL` läuft dessen PDF-Schritt über den
Sidecar.

---

## 4. Provisionierung (Soll — nächster Schritt)

> Der Renderer-Code ist fertig. Die folgenden Punkte sind die **noch offene** Container-/Deploy-
> Provisionierung (Gordon-gegated); `Dockerfile`/`gcloud` sind hier **nicht** angefasst, nur
> beschrieben.

**a) Gotenberg-Sidecar in die Cloud-Run-Service-Definition.** Container `gotenberg/gotenberg:8` neben
dem RUBICON-Container (Multi-Container / Same-Pod), erreichbar über `http://localhost:3000`. Dann am
Service bzw. Job die Env-Variable setzen:

```
RUBICON_GOTENBERG_URL=http://localhost:3000
```

Damit greift automatisch der Server-Zweig in `html_to_pdf`. Betriebsvarianten (Sidecar vs. eigener
interner Cloud-Run-Service) sind in `DEPLOYMENT_GCP.md §11` gegenübergestellt; für den POC ist der
Sidecar empfohlen.

**b) Fehlende Python-Abhängigkeit `PyMuPDF` (`fitz`) im Image.** Das `Dockerfile` installiert
`google-api-python-client` und `google-auth` manuell per `pip3`, aber **nicht** `PyMuPDF` — obwohl
`scripts/requirements.txt` es listet. Ohne PyMuPDF scheitern im Container **`gen_protokoll.py`**
(`import fitz`) **und** die Weg-1-PNG-Vorschauen (`_vol_png` in `gen_docs_server.py`). `PyMuPDF` ist
deshalb in den `pip install`-Schritt des Dockerfiles aufzunehmen. Das ist die eigentliche **zweite**
Container-Lücke neben dem fehlenden Chrome.

**c) Deploy-Reihenfolge & Verifikation.** Sidecar, Env-Variable und PyMuPDF **gemeinsam** ausrollen;
danach eine **Protokoll-Erzeugung serverseitig** als Rauchtest (über `/api/protokoll/export`).

**d) Sicherheit / DSGVO.** Gotenberg ist **self-hosted** (Sidecar), **kein externer PDF-Dienst** → es
verlässt keine PII den Mandanten. (Sensitive Protokolle sind vom Export ohnehin gesperrt — die Route
`/api/protokoll/export` verweigert den Export für `protokolle_sensitiv`.)

---

## 5. Validiertes Aufrufmuster (Docker-E2E)

Lokal bestätigtes End-to-End-Muster (in `DEPLOYMENT_GCP.md §11` als bestanden dokumentiert):

```bash
docker run -d --rm -p 3000:3000 gotenberg/gotenberg:8      # /health healthy in ~2s
curl -F "files=@x.html;filename=index.html" \
     -F "preferCssPageSize=true" \
     http://localhost:3000/forms/chromium/convert/html -o x.pdf
```

Das entspricht 1:1 dem, was `_render_via_gotenberg` aufbaut: eine self-contained `index.html` plus das
Pflicht-Formfeld `preferCssPageSize=true` (bei Querformat zusätzlich `landscape=true`).

**Weiterführend:**
- `DEPLOYMENT_GCP.md §11` — Entscheidung „zwei Wege", Betriebsvarianten, dokumentierte Alternative
  (WeasyPrint), Status.
- `DEPLOYMENT_GCP.md §12` — Weg-1-Server-Job (`rubicon-docs-job`).
- `docs/template-engine-anleitung.md` — Weg 1 (Docs-REST-Vorlagen-Engine) im Detail.
