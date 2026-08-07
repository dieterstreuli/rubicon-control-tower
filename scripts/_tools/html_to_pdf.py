#!/usr/bin/env python3
"""html_to_pdf.py — Render HTML to a clean PDF via headless Google Chrome.

STANDARD für CoS-generierte PDFs (Briefings, One-Pager, Reports, Decks-Export).
Grund: PyMuPDF/fitz.Story rendert dichte Tabellen fehlerhaft (überlappende
Header-Balken). Headless-Chrome liefert pixelgenaues CSS-/Tabellen-Rendering.

Usage:
    python3 Tools/html_to_pdf.py input.html [output.pdf]
        # default output: input.pdf neben dem HTML

HTML-Tipps für saubere Mehrseitigkeit:
    @page { size:A4; margin:13mm; }
    tr   { page-break-inside:avoid; }
    thead{ display:table-header-group; }   /* Tabellenkopf je Seite wiederholen */
"""
import subprocess, sys, time, os, uuid
from pathlib import Path

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def html_to_pdf(html_path, pdf_path=None, landscape=False, timeout=60):
    """Rendert HTML -> PDF. Startet Chrome non-blocking, wartet bis das PDF da ist,
    und beendet Chrome dann (mit eigenem Profilordner beendet es sich sonst nicht)."""
    html_path = Path(html_path).resolve()
    pdf_path = Path(pdf_path).resolve() if pdf_path else html_path.with_suffix(".pdf")
    gotenberg = os.environ.get("RUBICON_GOTENBERG_URL")
    if gotenberg:
        return _render_via_gotenberg(gotenberg.rstrip("/"), html_path, pdf_path, landscape, timeout)
    if not Path(CHROME).exists():
        raise FileNotFoundError(f"Chrome nicht gefunden: {CHROME}")
    if pdf_path.exists():
        pdf_path.unlink()
    # eigener Profilordner je AUFRUF (pid+uuid): kein Lock mit offenem Chrome UND thread-sicher
    # (Fix 07.07.2026: im ThreadPool teilen alle Threads dieselbe PID -> ProcessSingleton-Kollision)
    udd = f"/tmp/chrome_pdf_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
           f"--user-data-dir={udd}", f"--print-to-pdf={pdf_path}"]
    if landscape:
        cmd.append("--landscape")
    cmd.append(html_path.as_uri())
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.time() + timeout
    ok = False
    while time.time() < deadline:
        if pdf_path.exists() and pdf_path.stat().st_size > 0:
            time.sleep(0.3)                          # Schreiben fertigstellen lassen
            ok = True
            break
        if proc.poll() is not None:                  # Chrome ist selbst beendet
            ok = pdf_path.exists() and pdf_path.stat().st_size > 0
            break
        time.sleep(0.2)
    if proc.poll() is None:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()
    if not ok:
        err = proc.stderr.read().decode("utf-8", "ignore")[:600] if proc.stderr else ""
        raise RuntimeError(f"PDF nicht erzeugt. stderr: {err}")
    return pdf_path


def _multipart(boundary, fields, html_bytes):
    """multipart/form-data-Body: Formfelder + die HTML-Datei als `files`/index.html (Gotenberg-Pflicht)."""
    import io
    b = boundary.encode()
    buf = io.BytesIO()
    for name, value in fields:
        buf.write(b"--" + b + b"\r\n")
        buf.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        buf.write(value.encode() + b"\r\n")
    buf.write(b"--" + b + b"\r\n")
    buf.write(b'Content-Disposition: form-data; name="files"; filename="index.html"\r\n')
    buf.write(b"Content-Type: text/html\r\n\r\n")
    buf.write(html_bytes + b"\r\n")
    buf.write(b"--" + b + b"--\r\n")
    return buf.getvalue()


def _gotenberg_id_token(audience):
    """OIDC-ID-Token fuer den privaten Gotenberg-Service (Cloud-Run-Metadata-Server).
    Lokal (kein Metadata-Server) -> None (dann ohne Auth, z.B. lokaler Docker-Gotenberg)."""
    import urllib.request
    url = ("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/"
           "default/identity?audience=" + audience)
    try:
        req = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.read().decode("utf-8").strip()
    except Exception:  # noqa: BLE001 — kein Metadata-Server (lokal) o.ae.
        return None


def _render_via_gotenberg(base_url, html_path, pdf_path, landscape, timeout):
    """Serverseitige Fassung des lokalen Chrome-Renderers: POST self-contained HTML an einen
    Gotenberg-Chromium-Endpoint, schreibt die PDF-Antwort nach pdf_path. Ruft den privaten
    Service per OIDC-ID-Token auf (lokal ohne Token) und wiederholt transiente Fehler
    (5xx/Cold-Start-503, Netz-/Connection-Reset) mit Exponential-Backoff (3 Versuche)."""
    import time, random, urllib.request, urllib.error
    html_bytes = Path(html_path).read_bytes()
    boundary = f"----rubicon{uuid.uuid4().hex}"
    fields = [("preferCssPageSize", "true")]
    if landscape:
        fields.append(("landscape", "true"))
    body = _multipart(boundary, fields, html_bytes)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    tok = _gotenberg_id_token(base_url)
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"{base_url}/forms/chromium/convert/html",
                                         data=body, method="POST", headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                pdf = resp.read()
            if pdf[:4] != b"%PDF":
                raise RuntimeError(f"Gotenberg lieferte kein PDF (head={pdf[:8]!r})")
            if pdf_path.exists():
                pdf_path.unlink()
            pdf_path.write_bytes(pdf)
            return pdf_path
        except urllib.error.HTTPError as ex:
            last = ex
            if ex.code == 429 or 500 <= ex.code < 600:   # transient -> retry
                pass
            else:
                raise
        except (urllib.error.URLError, ConnectionError, TimeoutError) as ex:  # Netz/Cold-Start
            last = ex
        if attempt < 2:
            time.sleep(min(2 ** attempt + random.uniform(0, 0.5), 8))
    raise RuntimeError(f"Gotenberg-Render nach 3 Versuchen fehlgeschlagen: {last}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out = html_to_pdf(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"✓ {out}  ({out.stat().st_size // 1024} KB)")
