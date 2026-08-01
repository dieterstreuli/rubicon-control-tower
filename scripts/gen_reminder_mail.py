#!/usr/bin/env python3
"""gen_reminder_mail.py — K2 Stufe 1 (DRS 01.08.2026): Reminder als Gmail-ENTWÜRFE.

Erzeugt pro Owner EINEN Gmail-Entwurf, der alle seine fälligen Bring-Pflichten
(inputs aus projekt.yaml) und überfälligen Handlungen (tasks.json) bündelt.
Wird NIE gesendet (harte Regel: Automation sendet nie — DRS sendet).
Eskalationen und Kalender-Koordination bleiben bewusst AUSSERHALB dieses
Scripts (Führungssignale, nie automatisch).

Auswahl:
  --alle              alle überfälligen Inputs + Tasks (Stichtag = meta.today)
  --vorlauf N         zusätzlich Items, die in den nächsten N Tagen fällig werden
                      (Vorbereitung Stufe 2: T-3-Reminder)
  --ids IN-02,T-042   explizite Auswahl (Input-IDs und/oder T-Nummern)
  --dry-run           nur zeigen, was entstünde — kein Gmail-Zugriff, kein Log
  --force             7-Tage-Bremse übergehen (sonst: kürzlich erinnerte Items skip)

Leitplanken (Stufe 1):
  · Empfänger NUR aus der verifizierten Owner→E-Mail-Map — nie geraten.
    Unbekannte Owner ⇒ Entwurf OHNE Empfänger + Hinweis.
  · 7-Tage-Bremse je Item (reminder_log.json) — Reminder behalten ihre Wirkung.
  · Tine Petric erhält Englisch (feste DRS-Regel).
  · Kein Self-Reminder an DRS.
  · Persistentes Protokoll: src/data/reminder_log.json (mode 'draft'; Stufe 2
    ergänzt später mode 'sent').

Letzte stdout-Zeile: JSON {ok, drafts, uebersprungen, hinweise} (für die API).
"""
import base64
import datetime
import html
import json
import re
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / '_tools'))          # vendored Fallback (Portabilität)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')        # Original gewinnt auf dem DRS-Mac

import yaml  # noqa: E402

YAML_PATH = ROOT / 'src' / 'data' / 'projekt.yaml'
TASKS_PATH = ROOT / 'src' / 'data' / 'tasks.json'
LOG_PATH = ROOT / 'src' / 'data' / 'reminder_log.json'

# Owner → E-Mail. NUR verifizierte Adressen (Quelle: GL_VERTEILER in
# gen_entscheid_mail.py, mailbox-verifiziert 16.07.). Fehlende Owner werden
# NIE geraten — Entwurf entsteht ohne Empfänger, mit Hinweis.
OWNER_EMAILS = {
    'Andreas Fritthum': 'a.fritthum@axs.aero',
    'Cüneyt Gökcöl': 'c.gokcol@axs.aero',
    'Stephanie Rohde': 'stephanie.Rohde@ahs-aero.de',
    'Thomas Pajor': 't.pajor@group.aas.aero',
    'Michael Haeffner': 'm.haeffner@axs.aero',
    'Amélie Charisius': 'Amelie.Charisius@ahs-aero.de',
}
ENGLISH_OWNERS = {'Tine Petric'}          # feste DRS-Regel: an Tine immer Englisch
SELF = 'Dieter Streuli'                   # kein Self-Reminder
BREMSE_TAGE = 7

e = lambda s: html.escape(str(s or ''))


def de_date(s):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(s or ''))
    return f'{m.group(3)}.{m.group(2)}.{m.group(1)}' if m else (s or '—')


def days_over(due, today):
    d1 = datetime.date.fromisoformat(due)
    d0 = datetime.date.fromisoformat(today)
    return (d0 - d1).days


def load_items(args):
    doc = yaml.safe_load(YAML_PATH.read_text())
    today = doc['meta']['today']
    tasks = json.loads(TASKS_PATH.read_text())['tasks']
    tnr = lambda t: 'T-' + str(t.get('nr') or 0).rjust(3, '0')

    vorlauf = 0
    if '--vorlauf' in args:
        vorlauf = int(args[args.index('--vorlauf') + 1])
    horizon = (datetime.date.fromisoformat(today) + datetime.timedelta(days=vorlauf)).isoformat()

    wanted_ids = None
    if '--ids' in args:
        wanted_ids = {x.strip() for x in args[args.index('--ids') + 1].split(',') if x.strip()}

    items = []
    for i in doc.get('inputs', []):
        if i.get('status') != 'offen' or not i.get('due'):
            continue
        picked = (wanted_ids is not None and i['id'] in wanted_ids) or \
                 (wanted_ids is None and i['due'] <= horizon)
        if picked:
            items.append({'ref': i['id'], 'art': 'Datenlieferung', 'text': i.get('item', ''),
                          'owner': i.get('owner'), 'due': i['due'], 'over': days_over(i['due'], today)})
    for t in tasks:
        if t.get('status') != 'offen' or not t.get('due'):
            continue
        ref = tnr(t)
        picked = (wanted_ids is not None and ref in wanted_ids) or \
                 (wanted_ids is None and t['due'] <= horizon)
        if picked:
            items.append({'ref': ref, 'art': 'Handlung', 'text': t.get('text', ''),
                          'owner': t.get('owner'), 'due': t['due'], 'over': days_over(t['due'], today),
                          'ms': t.get('ms_id')})
    return doc, today, items


def mail_for(owner, items, today):
    en = owner in ENGLISH_OWNERS
    first = (owner or '').split(' ')[0]

    def row(it):
        ms = f" <span style='color:#888'>({e(it['ms'])})</span>" if it.get('ms') else ''
        unit = ' d' if en else ' T'
        over = f" <b style='color:#c0392b'>(+{it['over']}{unit})</b>" if it['over'] > 0 else ''
        return (f"<tr><td style='padding:4px 10px 4px 0;white-space:nowrap;font-family:monospace'>{e(it['ref'])}</td>"
                f"<td style='padding:4px 10px 4px 0'>{e(it['text'])}{ms}</td>"
                f"<td style='padding:4px 0;white-space:nowrap'>{de_date(it['due'])}{over}</td></tr>")

    rows = ''.join(row(it) for it in items)
    if en:
        subject = f"RUBICON — Reminder: open deliverables (as of {de_date(today)})"
        body = f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>Hi {e(first)}</p>
<p>A short reminder from the RUBICON programme — the following items are assigned to you and are due or overdue:</p>
<table style="font-size:13px;border-collapse:collapse">{rows}</table>
<p>Please deliver or give me a brief status. If a date no longer holds, let's adjust it in the tower rather than let it slip silently.</p>
<p>Best regards<br>Dieter</p>
<p style="color:#666;font-size:13px">Dieter Streuli<br>Chairman of the Board, AXS Group</p>
<p style="color:#999;font-size:11px">Created from the RUBICON Control Tower ({de_date(today)}).</p>
</div>"""
    else:
        subject = f"RUBICON — Erinnerung: offene Lieferungen (Stand {de_date(today)})"
        body = f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>Hallo {e(first)}</p>
<p>kurze Erinnerung aus dem Programm RUBICON — folgende Punkte liegen bei dir und sind fällig bzw. überfällig:</p>
<table style="font-size:13px;border-collapse:collapse">{rows}</table>
<p>Bitte liefern oder mir kurz den Stand geben. Falls ein Termin nicht mehr hält: lieber im Tower anpassen als still rutschen lassen.</p>
<p>Beste Grüsse<br>Dieter</p>
<p style="color:#666;font-size:13px">Dieter Streuli<br>Chairman of the Board, AXS Group</p>
<p style="color:#999;font-size:11px">Erstellt aus dem RUBICON Control Tower ({de_date(today)}).</p>
</div>"""
    return subject, body


def create_draft(to_email, subject, body_html):
    from _google_auth import load_credentials
    from googleapiclient.discovery import build
    creds = load_credentials('d.streuli@axs.aero')
    gmail = build('gmail', 'v1', credentials=creds)
    msg = MIMEMultipart('alternative')
    text = re.sub(r'<[^>]+>', '', body_html.replace('<br>', '\n').replace('</p>', '\n\n'))
    msg.attach(MIMEText(text, 'plain', 'utf-8'))
    msg.attach(MIMEText(body_html, 'html', 'utf-8'))
    msg['Subject'] = subject
    if to_email:
        msg['To'] = to_email
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return gmail.users().drafts().create(userId='me', body={'message': {'raw': raw}}).execute().get('id')


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    force = '--force' in args
    if '--alle' not in args and '--ids' not in args and '--vorlauf' not in args:
        print(json.dumps({'ok': False, 'error': 'Auswahl fehlt: --alle, --ids oder --vorlauf'})); sys.exit(1)

    doc, today, items = load_items(args)
    log = json.loads(LOG_PATH.read_text()) if LOG_PATH.exists() else {'reminders': []}

    # 7-Tage-Bremse: Items, die in den letzten BREMSE_TAGE bereits in einem Entwurf waren
    cutoff = (datetime.date.today() - datetime.timedelta(days=BREMSE_TAGE)).isoformat()
    recent = {ref for r in log['reminders'] if r.get('created_at', '')[:10] >= cutoff for ref in r.get('items', [])}

    hinweise, skipped = [], []
    by_owner = {}
    for it in items:
        if it['owner'] == SELF:
            skipped.append({'ref': it['ref'], 'grund': 'Owner = DRS (kein Self-Reminder)'}); continue
        if not it['owner']:
            skipped.append({'ref': it['ref'], 'grund': 'Owner fehlt (Datenlücke)'}); continue
        if not force and it['ref'] in recent:
            skipped.append({'ref': it['ref'], 'grund': f'bereits erinnert (< {BREMSE_TAGE} T; --force übergeht)'}); continue
        by_owner.setdefault(it['owner'], []).append(it)

    drafts = []
    for owner, its in sorted(by_owner.items()):
        its.sort(key=lambda x: x['due'])
        email = OWNER_EMAILS.get(owner)
        if not email:
            hinweise.append(f'{owner}: keine verifizierte E-Mail — Entwurf ohne Empfänger (manuell ergänzen)')
        subject, body = mail_for(owner, its, today)
        draft_id = None
        if not dry:
            draft_id = create_draft(email, subject, body)
            log['reminders'].insert(0, {
                'created_at': datetime.datetime.now().isoformat(timespec='seconds'),
                'owner': owner, 'email': email, 'draft_id': draft_id, 'mode': 'draft',
                'items': [x['ref'] for x in its],
            })
        drafts.append({'owner': owner, 'email': email, 'draft_id': draft_id,
                       'items': [x['ref'] for x in its], 'betreff': subject})

    if not dry and drafts:
        tmp = LOG_PATH.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(log, ensure_ascii=False, indent=2))
        tmp.replace(LOG_PATH)

    print(json.dumps({'ok': True, 'dry_run': dry, 'stichtag': today,
                      'drafts': drafts, 'uebersprungen': skipped, 'hinweise': hinweise},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
