#!/usr/bin/env python3
"""gen_traktanden_docs.py — erzeugt/aktualisiert je Meeting ein Google Doc der
Traktandenliste (AXS-Stil, echte Tabelle) über Tools/md_to_gdoc.py.

Quelle: src/data/traktanden.json (+ fuehrungsrhythmus.json für Kadenz-Gruppe).
Doc-IDs werden in src/data/traktanden_docs.json gespeichert → Re-Run aktualisiert
dasselbe Doc (idempotent, kein Duplikat). Diese Map speist die Doc-Links im UI.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MD2GDOC = '/Users/dieterstreuli/Chief/Tools/md_to_gdoc.py'
import os as _os
if not _os.path.exists(MD2GDOC):
    MD2GDOC = __file__.rsplit('/', 1)[0] + '/_tools/md_to_gdoc.py'  # vendored (Portabilität)
PARENT = '1DdG7NZ1s4bSE2loI1dOLNA2xuUpFS61F'  # Drive: RUBICON — Traktandenlisten
AG = json.loads((ROOT / 'src' / 'data' / 'traktanden.json').read_text())['agendas']
FR = json.loads((ROOT / 'src' / 'data' / 'fuehrungsrhythmus.json').read_text())
DOCS_MAP = ROOT / 'src' / 'data' / 'traktanden_docs.json'

KAD = {m['id']: g['kadenz'] for g in FR['gruppen'] for m in g['meetings']}


def md_escape(s):
    return str(s or '').replace('|', '\\|').replace('\n', ' ')


def build_md(a):
    mid = a['meeting_id']
    lines = [
        f"# Traktandenliste — {a.get('meeting_name')}",
        "",
        f"{KAD.get(mid,'')} · Standard-Agenda (stehend) · Projekt RUBICON («Alea iacta est.»)",
        "",
        "| Feld | Angabe |",
        "|---|---|",
        f"| Vorsitz | {md_escape(a.get('vorsitz'))} |",
        f"| Dauer | {md_escape(a.get('dauer'))} |",
        f"| Teilnehmer | {md_escape(a.get('teilnehmer'))} |",
        "",
        f"**Eiserne Regel:** {a.get('standing_rule')}",
        "",
        "## Traktanden",
        "",
        "| # | Traktandum | Zeit | Verantwortlich | Output → wohin |",
        "|---|---|---|---|---|",
    ]
    for t in a.get('traktanden', []):
        lines.append(
            f"| {t.get('nr')} | {md_escape(t.get('titel'))} | {md_escape(t.get('zeit'))} "
            f"| {md_escape(t.get('verantwortlich'))} | {md_escape(t.get('output'))} |")
    lines += ["", f"**Ergebnis der Sitzung:** {a.get('ergebnis')}", ""]
    if a.get('hinweise'):
        lines.append("**Spielregeln:** " + " · ".join(a['hinweise']))
    return "\n".join(lines) + "\n"


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    docs = {}
    if DOCS_MAP.exists():
        docs = json.loads(DOCS_MAP.read_text())
    for a in AG:
        mid = a['meeting_id']
        if only and mid != only:
            continue
        md = build_md(a)
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
            f.write(md)
            tmp = f.name
        name = f"Traktandenliste — {a.get('meeting_name')}"
        cmd = ['python3', MD2GDOC, tmp, name, PARENT]
        if mid in docs:
            cmd += ['--doc-id', docs[mid]]
        out = subprocess.run(cmd, capture_output=True, text=True)
        m = re.search(r'/document/d/([A-Za-z0-9_-]+)/', out.stdout)
        if not m:
            print(f"  ! {mid}: keine Doc-ID — {out.stdout.strip()[-160:]} {out.stderr.strip()[-160:]}")
            continue
        docs[mid] = m.group(1)
        print(f"  ✓ {mid} → {m.group(1)}")
    DOCS_MAP.write_text(json.dumps(docs, ensure_ascii=False, indent=2))
    print(f"FERTIG: {len(docs)} Docs → {DOCS_MAP.name}")


if __name__ == '__main__':
    main()
