#!/usr/bin/env python3
"""gen_calendar_event.py --id <input_id> --subject <email> [--send-updates none|all] — Stufe 5.

Erzeugt EINEN echten Calendar-Event im Kalender des angemeldeten Nutzers (DWD-Subject): ein fixer
Slot (Default 30 Min, konfigurierbar) am Fälligkeitstag des Items, Titel
„RUBICON: <item> — Koordination mit <owner>". Teilnehmer = Owner (falls E-Mail bekannt) +
'immer_einladen'-Liste (Default DRS) — siehe _kontakte/kalender.json.

--subject EMAIL: DWD-Impersonation = dieser User (Server); Event in dessen Kalender. Nur aus
verifizierter IAP-Identität, nie aus Client-Eingaben. Lokal wirkungslos (User-OAuth).
--send-updates none|all: ob Teilnehmer eine Einladungs-Mail bekommen. Fehlt das Flag, gilt der
konfigurierbare Default aus kalender.json (Standard 'none' = still angelegt, DRS lädt bei Bedarf selbst ein).

RUBICON-CUTOVER: future-rubicon-identity — Subject ist heute der angemeldete User; später umschaltbar
auf die eigene RUBICON-Identität (rubicon@axs.aero) per Config/Env, dann sichert die immer_einladen-Liste,
dass DRS/Liste trotzdem Teilnehmer ist.
"""
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / '_tools'))

import yaml  # noqa: E402
from _kontakte import OWNER_EMAILS, kalender_teilnehmer, kalender_config  # noqa: E402

YAML_PATH = ROOT / 'src' / 'data' / 'projekt.yaml'
TASKS_PATH = ROOT / 'src' / 'data' / 'tasks.json'
LOG_PATH = ROOT / 'src' / 'data' / 'kalender_log.json'


def find_item(iid):
    doc = yaml.safe_load(YAML_PATH.read_text())
    for i in doc.get('inputs', []):
        if i.get('id') == iid:
            return {'id': iid, 'item': i.get('item', ''), 'owner': i.get('owner'), 'due': i.get('due')}
    for t in json.loads(TASKS_PATH.read_text())['tasks']:
        if 'T-' + str(t.get('nr') or 0).rjust(3, '0') == iid:
            return {'id': iid, 'item': t.get('text', ''), 'owner': t.get('owner'), 'due': t.get('due')}
    return None


def _slot(due, cfg):
    """Start/Ende (ISO dateTime ohne Zeitzonen-Offset; die Zeitzone reist als Feld mit) für den Slot am
    Fälligkeitstag. Fällt auf heute zurück, wenn kein due gesetzt ist."""
    day = due or datetime.date.today().isoformat()
    hh, mm = (str(cfg.get('slot_start') or '09:00').split(':') + ['0'])[:2]
    start = datetime.datetime.fromisoformat(f'{day}T{int(hh):02d}:{int(mm):02d}:00')
    end = start + datetime.timedelta(minutes=int(cfg.get('slot_minutes') or 30))
    return start.isoformat(), end.isoformat()


def create_event(item, me, send_updates=None):
    from _google_auth import load_credentials, CALENDAR_EVENTS
    from googleapiclient.discovery import build
    creds = load_credentials('d.streuli@axs.aero', scopes=[CALENDAR_EVENTS], subject=me)
    cal = build('calendar', 'v3', credentials=creds)
    cfg = kalender_config()
    su = send_updates or cfg.get('send_updates') or 'none'
    owner_email = OWNER_EMAILS.get(item.get('owner'))
    teilnehmer = kalender_teilnehmer(owner_email)
    start, end = _slot(item.get('due'), cfg)
    tz = cfg.get('timezone') or 'Europe/Zurich'
    body = {
        'summary': f"RUBICON: {item['item']} — Koordination mit {item.get('owner') or '—'}",
        'description': (f"Programm RUBICON — Koordination/Deadline.\n"
                        f"Item: {item['id']} · Owner: {item.get('owner')}\nFällig: {item.get('due')}"),
        'start': {'dateTime': start, 'timeZone': tz},
        'end': {'dateTime': end, 'timeZone': tz},
        'attendees': [{'email': a} for a in teilnehmer],
    }
    ev = cal.events().insert(calendarId='primary', body=body, sendUpdates=su).execute()
    return ev.get('id'), ev.get('htmlLink'), teilnehmer, su


def main():
    args = sys.argv[1:]
    iid = args[args.index('--id') + 1] if '--id' in args else None
    me = args[args.index('--subject') + 1] if '--subject' in args else None
    su = args[args.index('--send-updates') + 1] if '--send-updates' in args else None
    if not iid:
        print(json.dumps({'ok': False, 'error': '--id fehlt'})); sys.exit(1)
    item = find_item(iid)
    if not item:
        print(json.dumps({'ok': False, 'error': f'Item {iid} nicht gefunden'})); sys.exit(1)
    hinweise = []
    if not OWNER_EMAILS.get(item.get('owner')):
        hinweise.append(f"{item.get('owner')}: keine verifizierte E-Mail — ohne Owner als Teilnehmer")
    event_id, link, teilnehmer, su_eff = create_event(item, me, su)
    log = json.loads(LOG_PATH.read_text()) if LOG_PATH.exists() else {'events': []}
    log['events'].insert(0, {'created_at': datetime.datetime.now().isoformat(timespec='seconds'),
                             'id': iid, 'event_id': event_id, 'teilnehmer': teilnehmer, 'send_updates': su_eff})
    tmp = LOG_PATH.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(log, ensure_ascii=False, indent=2)); tmp.replace(LOG_PATH)
    print(json.dumps({'ok': True, 'id': iid, 'event_id': event_id, 'htmlLink': link,
                      'teilnehmer': teilnehmer, 'send_updates': su_eff, 'hinweise': hinweise},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
