#!/usr/bin/env python3
"""gen_entscheid_mail.py <entscheid_id> [--an "Verteiler"] — Kommunikations-Paket
für einen Register-Entscheid (Säule 3, INS-001 Anhang B):

1. Entscheid-PDF (public/entscheide/<id>.pdf) — der Antragsinhalt überführt in den
   Entscheid: Wortlaut, Begründung, Datengrundlage, Gremium, Datum, Stempel.
2. Gmail-ENTWURF mit Kommunikationstext + PDF im Anhang — wird NIE gesendet
   (harte Regel: Claude/Automation sendet nie, DRS sendet). Empfänger werden nur
   gesetzt, wenn der Verteiler echte E-Mail-Adressen enthält — nie geraten.

Schreibt den PDF-Link zurück in entscheide.json (record.export).
Gibt als LETZTE stdout-Zeile ein JSON {ok, pdf, draft_id} aus (für die API).
"""
import base64
import datetime
import html
import json
import os
import re
import sys
import tempfile
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0] + '/_tools')   # vendored Fallback (Portabilität)
sys.path.insert(0, '/Users/dieterstreuli/Chief/Tools')       # Original gewinnt auf dem DRS-Mac
from html_to_pdf import html_to_pdf  # noqa: E402

ENTS = ROOT / 'src' / 'data' / 'entscheide.json'

# Fester Verteiler (DRS 16.07.: «der Versand geht immer an die GL») — identisch mit dem
# etablierten GL-Verteiler in Tools/adv_newsletter_to_gl.py (ohne DRS selbst = Absender).
# Gökcöl-Adresse mailbox-verifiziert 16.07. (c.gokcol@, nicht c.goelcoel@).
GL_VERTEILER = [
    'a.fritthum@axs.aero',
    'c.gokcol@axs.aero',
    'stephanie.Rohde@ahs-aero.de',
    't.pajor@group.aas.aero',
    'm.haeffner@axs.aero',
    'Amelie.Charisius@ahs-aero.de',
]
OUT = ROOT / 'public' / 'entscheide'
LOGO = (ROOT / 'scripts' / 'axs_logo.png.b64').read_text().strip()
STAMP = datetime.datetime.now().strftime('%d.%m.%Y %H:%M')


def _atomic_write(path, text):
    tmp = f'{path}.tmp.{os.getpid()}'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)


def e(s):
    return html.escape(str(s or ''))


def de_date(s):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(s or ''))
    return f'{m.group(3)}.{m.group(2)}.{m.group(1)}' if m else (s or '—')


CSS = """
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 @page{size:A4;margin:15mm 16mm}
 body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1a1a1a;line-height:1.45}
 .logo{text-align:right}.logo img{height:11mm}
 h1{font-size:15pt;color:#1E3E58;margin-bottom:0.5mm}
 .sub{font-size:9pt;color:#5a6570;border-bottom:1.5pt solid #1E3E58;padding-bottom:2mm;margin-bottom:4mm}
 table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:3mm}
 th{background:#1E3E58;color:#fff;font-size:7.5pt;text-align:left;padding:1.4mm 2mm;width:32mm}
 td{padding:1.6mm 2mm;vertical-align:top;border-bottom:.4pt solid #d6dde4;font-size:9pt}
 .beschluss{background:#F5F7FA;border-left:2.5pt solid #b07d2c;padding:2.5mm 3mm;font-size:9.5pt;margin-bottom:3mm}
 .beschluss b{color:#1E3E58}
 .foot{margin-top:6mm;border-top:.5pt solid #C9D3DC;padding-top:1.5mm;font-size:7.5pt;color:#8a94a8}
</style>"""


def render_pdf_html(rec):
    rows = ''.join(
        f'<tr><th>{k}</th><td>{v}</td></tr>' for k, v in [
            ('Register-ID', e(rec['id'])),
            ('Entscheidungstyp', e(rec.get('typ'))),
            ('Zuständiges Gremium', e(rec.get('gremium'))),
            ('Antragsteller', e(rec.get('antragsteller'))),
            ('Entscheid-Datum', de_date(rec.get('datum'))),
            ('Status', e(rec.get('status'))),
            ('Begründung', e(rec.get('begruendung')) or '—'),
            ('Datengrundlage', e(rec.get('datengrundlage')) or '—'),
            ('Kommuniziert', (f"an {e(rec['kommunikation'].get('an') or '—')} am {de_date(rec['kommunikation'].get('am'))}"
                              if rec.get('kommunikation') else '—')),
            ('Quelle', e(rec.get('quelle')) or 'direkte Register-Erfassung'),
        ])
    return f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">{CSS}</head><body>
<div class="logo"><img src="data:image/png;base64,{LOGO}"></div>
<h1>Entscheid {e(rec['id'])} — {e(rec['titel'])}</h1>
<div class="sub">Entscheids-Register AXS Group · Entscheidungsordnung INS-001 Anhang B · Auszug vom {STAMP}</div>
<div class="beschluss"><b>Beschluss:</b> {e(rec.get('entscheid'))}</div>
<table>{rows}</table>
<div class="foot">Automatisch generiert aus dem Entscheids-Register (entscheide.json) — entspricht dem registrierten Stand. Revisionssicher, Entscheide werden nie gelöscht. Vertraulich.</div>
</body></html>"""


def mail_html(rec):
    komm_an = (rec.get('kommunikation') or {}).get('an') or 'Verteiler'
    return f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>Liebe Kolleginnen und Kollegen</p>
<p>hiermit informiere ich über folgenden Entscheid aus dem Entscheids-Register der AXS Group:</p>
<p><b>{e(rec['id'])} — {e(rec['titel'])}</b></p>
<p><b>Beschluss:</b> {e(rec.get('entscheid'))}</p>
<p><b>Gremium:</b> {e(rec.get('gremium') or '—')} · <b>Entscheid-Datum:</b> {de_date(rec.get('datum'))}</p>
{f'<p><b>Begründung:</b> {e(rec.get("begruendung"))}</p>' if rec.get('begruendung') else ''}
<p>Der vollständige Registerauszug ist als PDF beigefügt. Der Entscheid ist im Entscheids-Register (RUBICON, Tab «Entscheide») dauerhaft dokumentiert.</p>
<p>Beste Grüsse<br>Dieter</p>
<p style="color:#666;font-size:13px">Dieter Streuli<br>Chairman of the Board, AXS Group</p>
</div>"""


def _drive_id(s):
    """Drive-ID aus Link ODER roher ID — nie raten (None, wenn nicht erkennbar)."""
    m = re.search(r'/d/([A-Za-z0-9_-]{20,})', s or '') or re.search(r'[?&]id=([A-Za-z0-9_-]{20,})', s or '')
    if m:
        return m.group(1)
    s = (s or '').strip()
    return s if re.fullmatch(r'[A-Za-z0-9_-]{20,}', s) else None


def fetch_anhaenge(drive, rec):
    """Hinterlegte Anhänge (rec['anhaenge'], DRS 01.08.) laden: Google-Docs als
    PDF-Export, sonstige Dateien roh (Cap 15 MB). Fehler sind non-fatal —
    die Kommunikation geht nicht an einem Anhang zugrunde."""
    atts, errs = [], []
    for a in rec.get('anhaenge') or []:
        fid = _drive_id(a)
        if not fid:
            errs.append(f'{a[:60]}: keine Drive-ID erkennbar'); continue
        try:
            meta = drive.files().get(fileId=fid, fields='name,mimeType,size', supportsAllDrives=True).execute()
            name = re.sub(r'[^\w. \-()]+', '_', meta.get('name') or 'Dokument')
            mt = meta.get('mimeType', '')
            if mt.startswith('application/vnd.google-apps'):
                data = drive.files().export(fileId=fid, mimeType='application/pdf').execute()
                fname = name + ('.pdf' if not name.lower().endswith('.pdf') else '')
            else:
                if int(meta.get('size') or 0) > 15 * 1024 * 1024:
                    errs.append(f'{name}: > 15 MB — übersprungen'); continue
                data = drive.files().get_media(fileId=fid).execute()
                fname = name
            atts.append((fname, data if isinstance(data, bytes) else bytes(data)))
        except Exception as ex:  # noqa: BLE001
            errs.append(f'{fid[:24]}…: {str(ex)[-120:]}')
    return atts, errs


def create_draft(rec, pdf_path, an):
    from _google_auth import load_credentials
    from googleapiclient.discovery import build
    creds = load_credentials('d.streuli@axs.aero')
    gmail = build('gmail', 'v1', credentials=creds)
    drive = build('drive', 'v3', credentials=creds)
    extra_atts, att_errs = fetch_anhaenge(drive, rec)

    msg = MIMEMultipart('mixed')
    alt = MIMEMultipart('alternative')
    body_html = mail_html(rec)
    body_text = re.sub(r'<[^>]+>', '', body_html.replace('<br>', '\n').replace('</p>', '\n\n'))
    alt.attach(MIMEText(body_text, 'plain', 'utf-8'))
    alt.attach(MIMEText(body_html, 'html', 'utf-8'))
    msg.attach(alt)
    with open(pdf_path, 'rb') as f:
        att = MIMEApplication(f.read(), _subtype='pdf')
    att.add_header('Content-Disposition', 'attachment', filename=f"Entscheid_{rec['id']}.pdf")
    msg.attach(att)
    # Hinterlegte Dokumente (z.B. Kompetenzordnung) mitsenden — DRS 01.08.
    for fname, data in extra_atts:
        xa = MIMEApplication(data, _subtype='pdf' if fname.lower().endswith('.pdf') else 'octet-stream')
        xa.add_header('Content-Disposition', 'attachment', filename=fname)
        msg.attach(xa)

    msg['Subject'] = f"Entscheid {rec['id']} — {rec['titel']}"
    # Empfänger: IMMER der feste GL-Verteiler (DRS 16.07.); enthält der beim Klick
    # eingegebene Verteiler zusätzlich echte Adressen, kommen sie dazu — nie geraten.
    extra = re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', an or '')
    lower = {a.lower() for a in GL_VERTEILER}
    msg['To'] = ', '.join(GL_VERTEILER + [a for a in extra if a.lower() not in lower])

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    draft = gmail.users().drafts().create(userId='me', body={'message': {'raw': raw}}).execute()
    return draft.get('id'), len(extra_atts), att_errs


def main():
    eid = sys.argv[1]
    an = None
    if '--an' in sys.argv:
        an = sys.argv[sys.argv.index('--an') + 1]
    store = json.loads(ENTS.read_text())
    rec = next((x for x in store['entscheide'] if x['id'] == eid), None)
    if not rec:
        print(json.dumps({'ok': False, 'error': f'Entscheid {eid} nicht gefunden'})); sys.exit(1)

    OUT.mkdir(parents=True, exist_ok=True)
    hp = Path(tempfile.mktemp(suffix='.html'))
    hp.write_text(render_pdf_html(rec))
    pdf_abs = OUT / f'{eid}.pdf'
    html_to_pdf(str(hp), str(pdf_abs))
    pdf_rel = f'/entscheide/{eid}.pdf'

    draft_id, draft_err, n_anh, anh_err = None, None, 0, []
    if '--pdf-only' not in sys.argv:                           # Vorschau/Beispiel ohne Gmail-Entwurf
        try:
            draft_id, n_anh, anh_err = create_draft(rec, pdf_abs, an or (rec.get('kommunikation') or {}).get('an'))
        except Exception as ex:                                # PDF bleibt auch ohne Gmail nutzbar
            draft_err = str(ex)[-200:]

    rec['export'] = {'pdf': pdf_rel, 'draft_id': draft_id, 'stand': STAMP}
    _atomic_write(ENTS, json.dumps(store, ensure_ascii=False, indent=2))
    print(json.dumps({'ok': True, 'id': eid, 'pdf': pdf_rel, 'draft_id': draft_id, 'draft_error': draft_err,
                      'anhaenge': n_anh, 'anhang_fehler': anh_err}))


if __name__ == '__main__':
    main()
