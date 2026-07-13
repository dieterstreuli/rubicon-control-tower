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


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out = html_to_pdf(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"✓ {out}  ({out.stat().st_size // 1024} KB)")
