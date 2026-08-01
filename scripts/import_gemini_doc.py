#!/usr/bin/env python3
"""import_gemini_doc.py — liest eine Gemini-«Notizen für mich»-Meet-Notiz (Google
Doc) und übersetzt sie in ein RUBICON-/api/sitzung-Payload (Modul B «Sitzung
erfassen»). STANDARD = Dry-Run: nichts wird geschrieben, das vorgeschlagene
Payload wird nur ausgegeben. Erst mit --post erfolgt der scharfe Write.

Warum so (RUBICON-Grundregeln):
 · projekt.yaml bleibt einzige Wahrheit — geschrieben wird NUR über /api/sitzung.
 · Menschliche Freigabe vor jedem Write — Dry-Run zeigt DRS erst das ganze Payload.
 · Datenehrlichkeit — Fortschritt/Verzug werden NUR erzeugt, wenn die Notiz einen
   konkreten Wert nennt. Gemini-«Take notes for me» liefert Zusammenfassung +
   Nächste Schritte (Action Items) + Details — KEINE Prozentwerte. Ergo erzeugt
   dieser Import in der Regel Commitments + eine Zusammenfassungs-Notiz und rührt
   projekt.yaml NICHT an (der Mensch pflegt progress weiter selbst).
 · Quellenbindung — jedes Payload trägt source='gemini' + Doc-ID/-URL als Beleg.

Gemini-Doc-Struktur (deterministisch, Stand 07/2026):
    # 📝 Notizen
    ## <Meeting-Titel>
    Eingeladen [Name](mailto:) …
    ### Zusammenfassung          → 1 notiz
    ### Nächste Schritte         → je «- [ ] \\[Owner\\] Titel: Text.» ein commitment
    ### Details                  → (optional, standardmässig übersprungen)
    # 📖 Transkript              → ab hier ignoriert (nur Notiz-Teil zählt)

Usage:
    python3 scripts/import_gemini_doc.py <google_doc_id> --meeting-id gl-weekly \\
        [--datum YYYY-MM-DD] [--vorsitz NAME] [--details] [--role CoS] [--me NAME] \\
        [--post]        # ← ohne --post = Dry-Run (nur Ausgabe)
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität, s. MIGRATION.md)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')  # Original gewinnt auf dem DRS-Mac
from _google_auth import load_credentials  # noqa: E402
from googleapiclient.discovery import build  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TOWER_ORIGIN = 'http://127.0.0.1:8621'
TRAKTANDEN = ROOT / 'src' / 'data' / 'traktanden.json'
GEM_MAP = ROOT / 'src' / 'data' / 'gemini_meetings.json'   # meeting_id → Suchbegriffe
GEMINI_SUFFIX = ('Notizen von Gemini', 'Notes by Gemini')   # Gemini-Notiz-Doc-Titel-Suffix (DE/EN)

# Gemini nennt Personen in verschiedenen Formen — auf die RUBICON-Kanon-Namen
# (volle Namen, DRS 13.07.) abbilden. NUR exakte, eindeutige Treffer; alles andere
# bleibt wortwörtlich (nie raten, keine Person erfinden). Mehrfach-Owner
# («Michael, Cüneyt») werden gesplittet und einzeln gemappt.
GEMINI_OWNER = {
    'Andreas FRITTHUM': 'Andreas Fritthum', 'Andreas Fritthum': 'Andreas Fritthum',
    'Dieter Rolf Streuli': 'Dieter Streuli', 'Dieter Streuli': 'Dieter Streuli',
    'Cüneyt Zafer Gökcöl': 'Cüneyt Gökcöl', 'Cüneyt Gökcöl': 'Cüneyt Gökcöl', 'Cüneyt': 'Cüneyt Gökcöl',
    'Michael Haeffner': 'Michael Haeffner', 'Michael': 'Michael Haeffner',
    'Amélie Charisius': 'Amélie Charisius', 'Amélie': 'Amélie Charisius',
    'Tine Petric': 'Tine Petric', 'Florian Matthei': 'Florian Matthei',
    'Stephanie Rohde': 'Stephanie Rohde', 'Thomas Pajor': 'Thomas Pajor',
}
DE_MONTHS = {'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6,
             'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12}

# ── Boilerplate/Deko, die Gemini anhängt — nie als Inhalt übernehmen ──
BOILERPLATE = ('Überprüfen Sie die Notizen', 'Wie bewerten Sie', 'Nehmen Sie an einer',
               'Hier finden Sie Tipps')
NO_SUMMARY = ('wurde keine Zusammenfassung', 'No summary was generated')


def norm_owner(raw):
    raw = (raw or '').replace('\\', '').strip()
    if not raw:
        return ''
    parts = [p.strip() for p in re.split(r'[,/]| und | and ', raw) if p.strip()]
    mapped = [GEMINI_OWNER.get(p, p) for p in parts]
    # Dedup unter Erhalt der Reihenfolge
    seen, out = set(), []
    for m in mapped:
        if m not in seen:
            seen.add(m); out.append(m)
    return ' · '.join(out)


def parse_date(text):
    """Nur EXPLIZITE Daten → ISO. Relative Angaben («Ende Juli», «Mittwoch») → None
    (bewusst: nie raten; die Formulierung bleibt im Commitment-Text erhalten)."""
    if not text:
        return None
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', text)
    if m:
        return m.group(0)
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', text)
    if m:
        return f'{int(m.group(3)):04d}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    m = re.search(r'(\d{1,2})\.?\s+(' + '|'.join(DE_MONTHS) + r')\s+(\d{4})', text, re.I)
    if m:
        return f'{int(m.group(3)):04d}-{DE_MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    return None


def strip_md(s):
    """**bold**/Links/Escapes entfernen → reiner Text."""
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)   # [text](url) → text
    s = s.replace('**', '').replace('\\', '').strip()
    return re.sub(r'\s+', ' ', s)


def get_drive():
    return build('drive', 'v3', credentials=load_credentials('d.streuli@axs.aero'))


def load_doc(drive, doc_id):
    meta = drive.files().get(fileId=doc_id, fields='name', supportsAllDrives=True).execute()
    name = meta.get('name', '')
    for mime in ('text/markdown', 'text/plain'):
        try:
            data = drive.files().export(fileId=doc_id, mimeType=mime).execute()
            return name, (data.decode('utf-8') if isinstance(data, bytes) else str(data))
        except Exception:  # noqa: BLE001 — nächster Mime-Typ
            continue
    raise RuntimeError(f'Konnte Doc {doc_id} nicht als Text exportieren')


def find_gemini_docs(drive):
    """Alle «Notizen von Gemini»-Google-Docs, die DRS sieht (eigene + geteilte),
    neueste zuerst — mit aus dem Titel extrahiertem Datum."""
    q = "mimeType='application/vnd.google-apps.document' and trashed=false and name contains 'Gemini'"
    files = drive.files().list(
        q=q, fields='files(id,name,modifiedTime)', pageSize=100, orderBy='modifiedTime desc',
        corpora='allDrives', includeItemsFromAllDrives=True, supportsAllDrives=True,
    ).execute().get('files', [])
    out = []
    for f in files:
        if not any(s in f['name'] for s in GEMINI_SUFFIX):
            continue
        m = re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})', f['name'])
        f['datum'] = f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else None
        out.append(f)
    return out


def resolve_doc(drive, meeting_id, target_date, days):
    """Kandidaten für ein Meeting im Datumsfenster [target_date-(days-1) … target_date].
    Filtert zusätzlich über die Suchbegriffe aus gemini_meetings.json (falls hinterlegt).
    Gibt (label, kandidaten) zurück — Entscheidung/Disambiguierung macht der Aufrufer."""
    docs = find_gemini_docs(drive)
    lo = (date.fromisoformat(target_date) - timedelta(days=max(0, days - 1))).isoformat()
    cands = [d for d in docs if d['datum'] and lo <= d['datum'] <= target_date]
    mapping = json.loads(GEM_MAP.read_text()) if GEM_MAP.exists() else {}
    conf = mapping.get(meeting_id) or {}
    terms = [t.lower() for t in (conf.get('match') or [])]
    if terms:
        cands = [d for d in cands if all(t in d['name'].lower() for t in terms)]
    return conf.get('label', ''), cands


def section(lines, title):
    """Zeilen einer «### <title>»-Sektion bis zur nächsten Überschrift gleicher/höherer Ebene."""
    out, capture = [], False
    for ln in lines:
        h = re.match(r'^(#{1,6})\s', ln)
        if h:
            capture = strip_md(re.sub(r'^#{1,6}\s+', '', ln)).lower() == title.lower()
            continue
        if capture:
            out.append(ln)
    return out


def parse_notes(md):
    """Notiz-Teil (oberhalb «📖 Transkript») → Meeting-Titel, Zusammenfassung, Action Items."""
    full = md.splitlines()
    # Alles ab dem Transkript-Header abschneiden
    notes = []
    for ln in full:
        if re.match(r'^#{1,6}\s*.*📖', ln) or re.search(r'📖\s*Transkript', ln):
            break
        notes.append(ln)

    # Meeting-Titel = erstes ## nach dem 📝-Header
    title = ''
    for ln in notes:
        if re.match(r'^##\s', ln):
            title = strip_md(re.sub(r'^#{1,6}\s+', '', ln)); break

    # Zusammenfassung
    summ = [strip_md(x) for x in section(notes, 'Zusammenfassung')]
    summ = [x for x in summ if x and not x.startswith('*') and not any(b in x for b in BOILERPLATE)]
    summary = ' '.join(summ).strip()
    if any(n in summary for n in NO_SUMMARY):
        summary = ''

    # Nächste Schritte → Action Items «- [ ] \[Owner\] Rest»
    items = []
    for ln in section(notes, 'Nächste Schritte'):
        m = re.match(r'^\s*[-*]\s*\[[ xX]?\]\s*(.*)$', ln)
        if not m:
            continue
        rest = m.group(1).strip()
        mo = re.match(r'^\\?\[([^\]]+)\\?\]\s*(.*)$', rest)   # \[Owner\] Text
        owner = norm_owner(mo.group(1)) if mo else ''
        text = strip_md(mo.group(2) if mo else rest)
        if not text or any(b in text for b in BOILERPLATE):
            continue
        items.append({'owner': owner, 'text': text, 'bis': parse_date(text)})
    return title, summary, items


def build_payload(args, doc_id, doc_name, title, summary, items, details_lines):
    m = re.search(r'(\d{4})[/-](\d{2})[/-](\d{2})', doc_name or '')
    datum = args.datum or (f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else None)
    if not datum:
        sys.exit('FEHLER: Kein Datum im Doc-Namen gefunden — bitte --datum YYYY-MM-DD angeben (nie geraten).')

    eintraege = []
    if summary:
        eintraege.append({'typ': 'notiz', 'text': f'Zusammenfassung (Gemini): {summary}'})
    for it in items:
        eintraege.append({'typ': 'commitment', 'text': it['text'], 'owner': it['owner'], 'bis': it['bis']})
    if args.details:
        for d in details_lines:
            eintraege.append({'typ': 'notiz', 'text': d})

    return {
        'meeting_id': args.meeting_id,
        'meeting_name': title or args.meeting_id,
        'datum': datum,
        'vorsitz': args.vorsitz or '',
        'erfasst_von': 'Gemini (Google Meet) → import_gemini_doc.py',
        'role': args.role,
        'me': args.me or 'Dieter Streuli',
        'source': 'gemini',
        'gemini_doc_id': doc_id,
        'gemini_doc_url': f'https://docs.google.com/document/d/{doc_id}/edit',
        # Sensitiv-Filter (#6): HR-/Personal-sensible Meetings → getrennter, nie
        # ausgelieferter Store; keine Task-/Register-Spiegel, kein Export.
        'sensitiv': bool(getattr(args, 'sensitiv', False)),
        'eintraege': eintraege,
    }


def human_summary(payload):
    typ_counts = {}
    for e in payload['eintraege']:
        typ_counts[e['typ']] = typ_counts.get(e['typ'], 0) + 1
    L = []
    L.append('┌─ RUBICON · Gemini-Import (DRY-RUN — nichts geschrieben) ─────────────')
    L.append(f"│ Meeting : {payload['meeting_name']}  [{payload['meeting_id']}]")
    L.append(f"│ Datum   : {payload['datum']}   Quelle: {payload['gemini_doc_url']}")
    L.append(f"│ Einträge: " + ', '.join(f'{v}× {k}' for k, v in typ_counts.items()))
    fort = [e for e in payload['eintraege'] if e['typ'] in ('fortschritt', 'blocker')]
    L.append(f"│ → projekt.yaml-Wirkung: {'KEINE (kein Prozent/Verzug in der Notiz)' if not fort else str(len(fort)) + ' Milestone-Änderungen'}")
    L.append('├─ Commitments (Vorschlag) ───────────────────────────────────────────')
    for e in payload['eintraege']:
        if e['typ'] == 'commitment':
            bis = e['bis'] or '—'
            L.append(f"│ • [{e['owner'] or '—'}] (bis {bis})")
            L.append(f"│     {e['text']}")
    for e in payload['eintraege']:
        if e['typ'] == 'notiz':
            L.append('├─ Notiz ─────────────────────────────────────────────────────────────')
            L.append('│ ' + (e['text'][:300] + ('…' if len(e['text']) > 300 else '')))
    L.append('└─────────────────────────────────────────────────────────────────────')
    return '\n'.join(L)


def post_sitzung(payload):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f'{TOWER_ORIGIN}/api/sitzung', data=body, method='POST',
                                 headers={'Content-Type': 'application/json', 'Origin': TOWER_ORIGIN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    ap = argparse.ArgumentParser(description='Gemini-Meet-Notiz → RUBICON /api/sitzung (Dry-Run-Standard)')
    ap.add_argument('doc_id', nargs='?', help='Google-Doc-ID (optional — ohne Angabe wird die Notiz automatisch gesucht)')
    ap.add_argument('--meeting-id', help='RUBICON meeting_id (z.B. gl-weekly) — Pflicht ausser bei --list')
    ap.add_argument('--on', help='Such-Zieldatum YYYY-MM-DD (Default: heute) — welcher Tag gesucht wird')
    ap.add_argument('--days', type=int, default=1, help='Such-Fenster in Tagen rückwärts ab --on (Default 1 = nur der Tag)')
    ap.add_argument('--list', action='store_true', help='alle gefundenen Gemini-Notiz-Docs auflisten (Titel/Datum/ID) und beenden')
    ap.add_argument('--datum', help='YYYY-MM-DD (überschreibt das Protokoll-Datum aus dem Doc-Namen)')
    ap.add_argument('--vorsitz', help='Vorsitz-Name (Default: leer, nicht geraten)')
    ap.add_argument('--me', help='Erfasser für Owner-Scoping (Default: Dieter Streuli)')
    ap.add_argument('--role', default='CoS', choices=['CoS', 'Owner'])
    ap.add_argument('--details', action='store_true', help='Details-Abschnitt als Notizen mitnehmen')
    ap.add_argument('--sensitiv', action='store_true', help='HR-/Personal-sensibel: Protokoll nur lokal einsehbar, keine Spiegel, kein Export')
    ap.add_argument('--post', action='store_true', help='SCHARF: wirklich an /api/sitzung senden (sonst nur Dry-Run)')
    ap.add_argument('--json', action='store_true', help='nur das JSON-Payload ausgeben')
    ap.add_argument('--api', action='store_true', help='K1 (01.08.): genau EINE JSON-Zeile ausgeben (für POST /api/gemini/import) — auch für not_found/ambiguous')
    args = ap.parse_args()

    drive = get_drive()

    # ── --list: alle Gemini-Notiz-Docs zeigen (Titel ablesen fürs Mapping) ──
    if args.list:
        docs = find_gemini_docs(drive)
        if args.api:
            print(json.dumps({'ok': True, 'docs': [{'id': d['id'], 'name': d['name'], 'datum': d.get('datum')} for d in docs[:40]]}, ensure_ascii=False))
            return
        print(f'Gefundene Gemini-Notiz-Docs ({len(docs)}), neueste zuerst:')
        for d in docs[:40]:
            print(f"  {d.get('datum') or '????-??-??'}  {d['id']}  {d['name']}")
        return

    # ── Doc-ID bestimmen: explizit ODER Auto-Suche über --meeting-id ──
    doc_id = args.doc_id
    if not doc_id:
        if not args.meeting_id:
            sys.exit('FEHLER: --meeting-id nötig (oder Doc-ID direkt angeben, oder --list).')
        target = args.on or date.today().isoformat()
        label, cands = resolve_doc(drive, args.meeting_id, target, args.days)
        span = target if args.days <= 1 else f'{(date.fromisoformat(target) - timedelta(days=args.days - 1)).isoformat()} … {target}'
        if not cands:
            if args.api:
                print(json.dumps({'ok': False, 'error': 'not_found', 'fenster': span, 'meeting': label or args.meeting_id}, ensure_ascii=False))
                return
            print(f'Keine Gemini-Notiz für «{label or args.meeting_id}» im Fenster {span} gefunden.')
            print('Tipp: Fenster erweitern (--days N), Datum setzen (--on YYYY-MM-DD) oder --list zum Nachsehen.')
            print('Falls das Meeting neu ist: Suchbegriffe in src/data/gemini_meetings.json ergänzen.')
            return
        if len(cands) > 1:
            if args.api:
                print(json.dumps({'ok': False, 'error': 'ambiguous', 'fenster': span,
                                  'kandidaten': [{'id': d['id'], 'name': d['name'], 'datum': d['datum']} for d in cands]}, ensure_ascii=False))
                return
            print(f'Mehrdeutig — {len(cands)} Kandidaten im Fenster {span}. Bitte die passende Doc-ID direkt angeben:')
            for d in cands:
                print(f"  {d['datum']}  {d['id']}  {d['name']}")
            return
        doc_id = cands[0]['id']
        if not args.api:
            print(f"✓ Gefunden: {cands[0]['name']}\n  Doc-ID {doc_id}\n")

    if not args.meeting_id:
        sys.exit('FEHLER: --meeting-id nötig.')

    doc_name, md = load_doc(drive, doc_id)
    title, summary, items = parse_notes(md)
    details_lines = [strip_md(x) for x in section(md.splitlines(), 'Details')]
    details_lines = [x for x in details_lines if x and not x.startswith('*') and not any(b in x for b in BOILERPLATE)]
    payload = build_payload(args, doc_id, doc_name, title, summary, items, details_lines)

    if args.api:
        out = {'ok': True, 'doc': {'id': doc_id, 'name': doc_name}, 'payload': payload, 'posted': None}
        if args.post:
            try:
                out['posted'] = post_sitzung(payload)
            except Exception as ex:  # noqa: BLE001 — Fehler sauber als JSON melden
                out['ok'] = False
                out['error'] = f'post_failed: {ex}'
        print(json.dumps(out, ensure_ascii=False))
        return

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(human_summary(payload))
        print('\n── /api/sitzung Payload ──')
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    if args.post:  # unabhängig von --json (Bugfix: --json kürzte den POST vorher ab)
        print('\n⚠️  --post gesetzt: sende scharf an den Tower …')
        res = post_sitzung(payload)
        print('Antwort:', json.dumps(res, ensure_ascii=False))
    elif not args.json:
        print('\nℹ️  DRY-RUN — nichts geschrieben. Zum scharfen Erfassen: --post ergänzen.')


if __name__ == '__main__':
    main()
