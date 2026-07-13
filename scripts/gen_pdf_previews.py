#!/usr/bin/env python3
"""gen_pdf_previews.py — rendert die ERSTE Seite jeder Briefing-/Paket-PDF als PNG.

Grund: Chrome rendert PDFs in (verschachtelten) iframes unzuverlässig (im
Preview/Embedded-Kontext bleibt der iframe schwarz). Ein <img> lädt dagegen
überall. Das Modal zeigt das PNG als klickbare Vorschau; der Klick öffnet die
vollständige (mehrseitige) PDF in einem neuen Tab.

public/briefings/<id>.pdf  -> public/briefings/<id>.png  (Seite 1)
public/pakete/<code>.pdf   -> public/pakete/<code>.png   (Seite 1)
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
ZOOM = 2.0  # ~144 DPI — scharf genug für die Modal-Vorschau


def render_dir(d: Path):
    n = 0
    for pdf in sorted(d.glob('*.pdf')):
        png = pdf.with_suffix('.png')
        doc = fitz.open(pdf)
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
        pix.save(png)
        doc.close()
        n += 1
    return n


def main():
    b = render_dir(ROOT / 'public' / 'briefings')
    p = render_dir(ROOT / 'public' / 'pakete')
    print(f'FERTIG: {b} Briefing-PNGs + {p} Paket-PNGs → public/*/<name>.png')


if __name__ == '__main__':
    main()
