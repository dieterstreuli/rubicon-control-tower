#!/usr/bin/env python3
"""gen_eskalation_mail.py --id <input_id> --subject <email> — Eskalations-ENTWURF (Stufe 5).

Erzeugt EINEN Gmail-Entwurf (nie Send — DRS sendet) mit sachlich-verschärftem Ton für ein überfälliges
Item: To = Owner, Cc = Eskalations-Empfänger (eskalation.json: per_owner sonst default_cc, sonst Default
DRS). Bezieht sich auf die Konsequenz-Mechanik (2x Nichtlieferung -> eine Ebene höher / Steering Committee).

--subject EMAIL: DWD-Impersonation = dieser User (Server); Entwurf in dessen Postfach. Nur aus
verifizierter IAP-Identität, nie aus Client-Eingaben. Lokal wirkungslos (User-OAuth).
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
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / '_tools'))

import yaml  # noqa: E402
from _kontakte import OWNER_EMAILS, eskalation_cc  # noqa: E402

LOG_PATH = ROOT / 'src' / 'data' / 'eskalation_log.json'

e = lambda s: html.escape(str(s or ''))


def find_item(iid):
    doc = yaml.safe_load((ROOT / 'src' / 'data' / 'projekt.yaml').read_text())
    for i in doc.get('inputs', []):
        if i.get('id') == iid:
            return {'id': iid, 'item': i.get('item', ''), 'owner': i.get('owner'), 'due': i.get('due')}
    for t in json.loads((ROOT / 'src' / 'data' / 'tasks.json').read_text())['tasks']:
        if 'T-' + str(t.get('nr') or 0).rjust(3, '0') == iid:
            return {'id': iid, 'item': t.get('text', ''), 'owner': t.get('owner'), 'due': t.get('due')}
    return None


def _body_html(item):
    first = (item.get('owner') or '').split(' ')[0]
    return f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>Hallo {e(first)}</p>
<p>ich muss die folgende Lieferung förmlich eskalieren — sie ist überfällig und wurde trotz Erinnerung
nicht erbracht:</p>
<p><b>{e(item['id'])}</b> — {e(item['item'])} (fällig {e(item.get('due'))})</p>
<p>Gemäss unserer Konsequenz-Mechanik (48h-Reminder; bei wiederholter Nichtlieferung Eskalation eine
Ebene höher / Steering Committee) hebe ich das hiermit auf die nächste Stufe. Bitte liefere umgehend
oder nenne mir heute einen belastbaren Termin.</p>
<p>Beste Grüsse<br>Dieter</p>
<p style="color:#666;font-size:13px">Dieter Streuli · Chairman of the Board, AXS Group</p>
<p style="color:#999;font-size:11px">Eskalation aus dem RUBICON Control Tower.</p></div>"""


def create_draft(item, me):
    from _google_auth import load_credentials, GMAIL_MODIFY
    from googleapiclient.discovery import build
    creds = load_credentials('d.streuli@axs.aero', scopes=[GMAIL_MODIFY], subject=me)
    gmail = build('gmail', 'v1', credentials=creds)
    owner_email = OWNER_EMAILS.get(item.get('owner'))
    cc = eskalation_cc(item.get('owner'))
    body_html = _body_html(item)
    msg = MIMEMultipart('alternative')
    text = re.sub(r'<[^>]+>', '', body_html.replace('<br>', '\n').replace('</p>', '\n\n'))
    msg.attach(MIMEText(text, 'plain', 'utf-8'))
    msg.attach(MIMEText(body_html, 'html', 'utf-8'))
    msg['Subject'] = f"ESKALATION — {item['id']}: {item['item'][:60]}"
    if owner_email:
        msg['To'] = owner_email
    if cc:
        msg['Cc'] = ', '.join(cc)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    did = gmail.users().drafts().create(userId='me', body={'message': {'raw': raw}}).execute().get('id')
    return did, owner_email, cc


def main():
    args = sys.argv[1:]
    iid = args[args.index('--id') + 1] if '--id' in args else None
    me = args[args.index('--subject') + 1] if '--subject' in args else None
    if not iid:
        print(json.dumps({'ok': False, 'error': '--id fehlt'})); sys.exit(1)
    item = find_item(iid)
    if not item:
        print(json.dumps({'ok': False, 'error': f'Item {iid} nicht gefunden'})); sys.exit(1)
    hinweise = []
    if not OWNER_EMAILS.get(item.get('owner')):
        hinweise.append(f"{item.get('owner')}: keine verifizierte E-Mail — Entwurf ohne Empfänger")
    did, an, cc = create_draft(item, me)
    log = json.loads(LOG_PATH.read_text()) if LOG_PATH.exists() else {'eskalationen': []}
    log['eskalationen'].insert(0, {'created_at': datetime.datetime.now().isoformat(timespec='seconds'),
                                   'id': iid, 'draft_id': did, 'an': an, 'cc': cc})
    tmp = LOG_PATH.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(log, ensure_ascii=False, indent=2)); tmp.replace(LOG_PATH)
    print(json.dumps({'ok': True, 'id': iid, 'draft_id': did, 'an': an, 'cc': cc, 'hinweise': hinweise},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
