"""md_to_gdoc.py — Generischer Markdown → Google-Doc-Builder im AXS-Standard.

Erstellt ein neues Doc aus dem AXS-Template (via _templates.create_doc_from_template)
und baut den Body aus einer Markdown-Datei mit ECHTEN Google-Docs-Tabellen
(Regel 7: keine Pipe-Pseudo-Tabellen), AXS-blauen Tabellen-Headern und
Heading-Styles gemaess AXS-Style-Master.

Usage:
    python3 Tools/md_to_gdoc.py <input.md> "<Doc-Name>" <parent_folder_id> [--doc-id EXISTING_ID]

Unterstuetzt: # / ## / ### Headings, Absaetze mit **bold**, Markdown-Tabellen,
Listen (- / 1.) als Gedankenstrich-Absaetze (AXS: keine •-Bullets), --- wird
uebersprungen (AXS: keine Separatoren).
"""
import logging
import os
import re
import sys
import time
from pathlib import Path

log = logging.getLogger("rubicon.gdoc")

_CHIEF_TOOLS = "/Users/dieterstreuli/Chief/Tools"
if os.path.isdir(_CHIEF_TOOLS):
    sys.path.insert(0, _CHIEF_TOOLS)
from _google_auth import load_credentials
from _templates import (create_doc_from_template, ensure_doc_body_empty,
                        heading_text_style, body_text_style, AXS_STYLE)
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# ---------- Markdown-Parser: Datei -> Block-Liste ----------------------------

def parse_markdown(md_text):
    """Liefert Liste von Bloecken: ('h1'|'h2'|'h3'|'p', text) oder ('table', rows)."""
    blocks = []
    lines = md_text.splitlines()
    i = 0
    para = []

    def flush_para():
        if para:
            text = ' '.join(l.strip() for l in para).strip()
            if text:
                blocks.append(('p', text))
            para.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or re.fullmatch(r'[-*_]{3,}', stripped):
            flush_para(); i += 1; continue
        m = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if m:
            flush_para()
            level = min(len(m.group(1)), 3)
            blocks.append((f'h{level}', m.group(2).strip()))
            i += 1; continue
        if stripped.startswith('|') and stripped.endswith('|'):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-{2,}:?', c or '-') for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                width = max(len(r) for r in rows)
                rows = [r + [''] * (width - len(r)) for r in rows]
                blocks.append(('table', rows))
            continue
        lm = re.match(r'^\s*(?:[-*+]|\d+[.)])\s+(.*)$', line)
        if lm:
            # AXS-Style-Master: keine Bullet-Marker/Nummerierung — jede Info
            # als eigener kurzer NORMAL_TEXT-Absatz.
            flush_para()
            blocks.append(('p', lm.group(1).strip()))
            i += 1; continue
        para.append(line)
        i += 1
    flush_para()
    return blocks


def split_bold(text):
    """'a **b** *c*' -> [(seg, bold, italic), ...] — ohne Marker."""
    parts = []
    for j, seg in enumerate(re.split(r'\*\*(.+?)\*\*', text)):
        if not seg:
            continue
        bold = j % 2 == 1
        for k, sub in enumerate(re.split(r'\*(.+?)\*', seg)):
            if sub:
                parts.append((sub, bold, k % 2 == 1))
    return parts or [(text, False, False)]


# ---------- Docs-API-Builder --------------------------------------------------

class DocBuilder:
    def __init__(self, docs, doc_id):
        self.docs = docs
        self.doc_id = doc_id
        self._retry_429 = 0

    def bu(self, requests):
        for attempt in range(6):
            try:
                return self.docs.documents().batchUpdate(
                    documentId=self.doc_id, body={'requests': requests}).execute()
            except HttpError as e:
                if e.resp.status == 429 and attempt < 5:
                    self._retry_429 += 1
                    log.warning("docs 429 retry %d/5 doc_id=%s", attempt + 1, self.doc_id)
                    time.sleep(22)
                    continue
                raise

    def get(self):
        return self.docs.documents().get(documentId=self.doc_id).execute()

    def end_index(self):
        return self.get()['body']['content'][-1]['endIndex'] - 1

    def add_text(self, text, level=0, page_break_before=False):
        """level 0 = Fliesstext, 1-3 = Heading. **bold** und *kursiv* werden umgesetzt.
        Lesbarkeit: Abstand um Ueberschriften, Zeilenhoehe 115%; page_break_before
        beginnt das Kapitel auf einer neuen Seite."""
        parts = split_bold(text)
        plain = ''.join(p[0] for p in parts)
        idx = self.end_index()
        ps = {'namedStyleType': f'HEADING_{level}' if level else 'NORMAL_TEXT'}
        fields = ['namedStyleType']
        if level:
            ps['spaceAbove'] = {'magnitude': 18 if level == 2 else (10 if level == 3 else 6), 'unit': 'PT'}
            ps['spaceBelow'] = {'magnitude': 6 if level <= 2 else 4, 'unit': 'PT'}
            fields += ['spaceAbove', 'spaceBelow']
            if page_break_before:
                ps['pageBreakBefore'] = True
                fields.append('pageBreakBefore')
        else:
            ps['lineSpacing'] = 115
            ps['spaceBelow'] = {'magnitude': 4, 'unit': 'PT'}
            fields += ['lineSpacing', 'spaceBelow']
        reqs = [
            {'insertText': {'location': {'index': idx}, 'text': plain + '\n'}},
            {'updateParagraphStyle': {
                'range': {'startIndex': idx, 'endIndex': idx + len(plain) + 1},
                'paragraphStyle': ps, 'fields': ','.join(fields)}},
        ]
        if level:
            ts = heading_text_style(level)
            reqs.append({'updateTextStyle': {
                'range': {'startIndex': idx, 'endIndex': idx + len(plain)},
                'textStyle': ts, 'fields': ','.join(ts.keys())}})
        else:
            # Style-Master: Fliesstext explizit Arial 11pt (Template-Default zu gross)
            bts = body_text_style()
            reqs.append({'updateTextStyle': {
                'range': {'startIndex': idx, 'endIndex': idx + len(plain)},
                'textStyle': bts, 'fields': ','.join(bts.keys())}})
            pos = idx
            for seg, bold, italic in parts:
                if (bold or italic) and seg:
                    ts, fields = {}, []
                    if bold:
                        ts['bold'] = True; fields.append('bold')
                    if italic:
                        ts['italic'] = True; fields.append('italic')
                    reqs.append({'updateTextStyle': {
                        'range': {'startIndex': pos, 'endIndex': pos + len(seg)},
                        'textStyle': ts, 'fields': ','.join(fields)}})
                pos += len(seg)
        self.bu(reqs)

    def _last_table(self):
        for el in self.get()['body']['content']:
            if 'table' in el:
                table_el = el
        return table_el

    def add_table(self, rows):
        # Marker in Zellen strippen (** und *) — Zell-Styling bleibt Header-only
        rows = [[re.sub(r'\*(.+?)\*', r'\1', re.sub(r'\*\*(.+?)\*\*', r'\1', c))
                 for c in r] for r in rows]
        n_rows, n_cols = len(rows), len(rows[0])
        idx = self.end_index()
        self.bu([{'insertTable': {'rows': n_rows, 'columns': n_cols,
                                  'location': {'index': idx}}}])
        table_el = self._last_table()
        cells = []
        for r_idx, row in enumerate(table_el['table']['tableRows']):
            for c_idx, cell in enumerate(row['tableCells']):
                cells.append((r_idx, c_idx, cell['content'][0]['startIndex']))
        reqs = []
        for r, c, s in sorted(cells, key=lambda x: x[2], reverse=True):
            if rows[r][c]:
                reqs.append({'insertText': {'location': {'index': s},
                                            'text': rows[r][c]}})
        if reqs:
            self.bu(reqs)
        # Ganze Tabelle: Arial 11pt (Style-Master), dann Header-Zeile stylen
        table_el = self._last_table()
        start_loc = table_el['startIndex']
        bts = body_text_style()
        style_reqs = [{'updateTextStyle': {
            'range': {'startIndex': table_el['startIndex'],
                      'endIndex': table_el['endIndex']},
            'textStyle': bts, 'fields': ','.join(bts.keys())}}]
        style_reqs.append({'updateTableCellStyle': {
            'tableCellStyle': {'backgroundColor': {'color': {'rgbColor': AXS_STYLE['accent_rgb']}}},
            'fields': 'backgroundColor',
            'tableRange': {
                'tableCellLocation': {
                    'tableStartLocation': {'index': start_loc},
                    'rowIndex': 0, 'columnIndex': 0},
                'rowSpan': 1, 'columnSpan': n_cols}}})
        for c_idx, cell in enumerate(table_el['table']['tableRows'][0]['tableCells']):
            val = rows[0][c_idx]
            if not val:
                continue
            s = cell['content'][0]['startIndex']
            style_reqs.append({'updateTextStyle': {
                'range': {'startIndex': s, 'endIndex': s + len(val)},
                'textStyle': {'bold': True,
                              'foregroundColor': {'color': {'rgbColor':
                                  {'red': 1, 'green': 1, 'blue': 1}}}},
                'fields': 'bold,foregroundColor'}})
        self.bu(style_reqs)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    doc_id = None
    if '--doc-id' in sys.argv:
        doc_id = sys.argv[sys.argv.index('--doc-id') + 1]
        args = [a for a in args if a != doc_id]
    if len(args) < (2 if doc_id else 3):
        print(__doc__); sys.exit(1)
    md_path, doc_name = args[0], args[1]

    creds = load_credentials()
    drive = build('drive', 'v3', credentials=creds)
    docs = build('docs', 'v1', credentials=creds)

    if doc_id is None:
        parent_folder_id = args[2]
        f = create_doc_from_template(drive, doc_name, parent_folder_id)
        doc_id = f['id']
        print(f"Doc erstellt: {f['name']} ({doc_id})")

    ensure_doc_body_empty(docs, doc_id)
    print('Body geleert. Baue auf...')

    chapter_breaks = '--chapter-breaks' in sys.argv  # Seitenumbruch vor jedem H2-Kapitel
    blocks = parse_markdown(Path(md_path).read_text())
    b = DocBuilder(docs, doc_id)
    for kind, payload in blocks:
        if kind == 'table':
            b.add_table(payload)
            print(f'  + table {len(payload)}x{len(payload[0])}')
        else:
            level = int(kind[1]) if kind.startswith('h') else 0
            pb = chapter_breaks and level == 2  # jedes Kapitel auf neuer Seite (Seite 1 = Cover/Intro)
            b.add_text(payload, level, page_break_before=pb)
            print('  +', kind, (payload if isinstance(payload, str) else '')[:60])
        time.sleep(0.6)
    print(f'\nFERTIG: https://docs.google.com/document/d/{doc_id}/edit')


if __name__ == '__main__':
    main()
