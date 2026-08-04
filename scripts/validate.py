#!/usr/bin/env python3
"""validate.py — deterministisches Integritäts-Gate für src/data/projekt.yaml.

Spiegelt die Loader-Prüfungen (src/lib/loader.js):
  FEHLER  : fehlende Pflichtfelder (id, due, meta.*), ungültige Daten,
            doppelte IDs, tote depends_on-Referenzen, Zyklen, start > due
  WARNUNG : unbekannte Owner (nicht in meta.owners)
  LÜCKE   : progress/owner/phase = null (explizit als Datenlücke — nie geraten)

Exit-Code != 0 bei FEHLERn (als Pre-Commit/CI-Gate nutzbar).
"""
import json
import math
import os
import re
import sys
import datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FEHLER: pyyaml fehlt (pip3 install pyyaml)")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / "src" / "data" / "projekt.yaml"
TASKS_PATH = ROOT / "src" / "data" / "tasks.json"

errors, warnings, gaps = [], [], []


def err(where, msg): errors.append(f"  [FEHLER]  {where}: {msg}")
def warn(where, msg): warnings.append(f"  [WARNUNG] {where}: {msg}")
def gap(where, msg): gaps.append(f"  [LÜCKE]   {where}: {msg}")


def parse_date(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.date.fromisoformat(s.strip())
    except ValueError:
        return None


from _schema import pruefe_stores   # R4 (01.08.): Feld-SSOT src/data/schema.json


def main():
    if not YAML_PATH.exists():
        print(f"FEHLER: {YAML_PATH} fehlt"); sys.exit(1)
    doc = yaml.safe_load(YAML_PATH.read_text()) or {}

    meta = doc.get("meta") or {}
    for k in ("projekt", "today", "baseline_end"):
        if not meta.get(k):
            err("meta", f"meta.{k} fehlt")
    for k in ("today", "baseline_end"):
        if meta.get(k) and not parse_date(str(meta[k])):
            err("meta", f"meta.{k} = «{meta[k]}» kein gültiges Datum (YYYY-MM-DD)")
    owners = set(map(str, meta.get("owners") or []))
    if not owners:
        warn("meta", "meta.owners leer — Owner-Prüfung eingeschränkt")

    # Programm-Dimension (16.07.): Registry eindeutig, Default registriert, WS-Referenzen gültig
    programme = meta.get("programme") or []
    prog_ids = set()
    for p in programme:
        pid = p.get("id")
        if not pid:
            err("meta.programme", "Programm ohne id")
        elif pid in prog_ids:
            err("meta.programme", f"doppelte Programm-ID «{pid}»")
        prog_ids.add(pid)
        if p.get("status") not in ("aktiv", "abgeschlossen", "geplant"):
            err(f"programm {pid}", f"status «{p.get('status')}» ungültig (aktiv|abgeschlossen|geplant)")
    if not programme:
        gap("meta", "meta.programme fehlt (Programm-Registry)")
    if meta.get("default_programm") and prog_ids and meta["default_programm"] not in prog_ids:
        err("meta", f"default_programm «{meta['default_programm']}» nicht registriert")

    ids, adj = set(), {}
    n_ms = 0
    for ws in doc.get("workstreams") or []:
        code = ws.get("code") or "?"
        if not ws.get("code"):
            err("workstream", "workstream ohne code")
        if prog_ids and ws.get("programm") and str(ws["programm"]) not in prog_ids:
            err(f"WS {code}", f"programm «{ws['programm']}» nicht in meta.programme registriert")
        if programme and not ws.get("programm"):
            gap(f"WS {code}", "programm fehlt (Fallback default_programm)")
        if not ws.get("owner"):
            gap(f"WS {code}", "owner fehlt")
        elif owners and str(ws["owner"]) not in owners:
            warn(f"WS {code}", f"unbekannter Owner «{ws['owner']}»")
        for m in ws.get("milestones") or []:
            n_ms += 1
            mid = m.get("id") or f"{code}/?"
            if not m.get("id"):
                err(f"WS {code}", "Milestone ohne id")
            elif m["id"] in ids:
                err(mid, "doppelte Milestone-ID")
            else:
                ids.add(m["id"])
            due = m.get("due")
            if not due:
                err(mid, "due fehlt (Pflichtfeld)")
            elif not parse_date(str(due)):
                err(mid, f"due «{due}» kein gültiges Datum")
            start = m.get("start")
            if start and parse_date(str(start)) and parse_date(str(due or "")) and \
               parse_date(str(start)) > parse_date(str(due)):
                err(mid, "start liegt nach due")
            pv = m.get("progress")
            if not isinstance(pv, (int, float)) or isinstance(pv, bool):
                gap(mid, "progress unbekannt (null)")
            elif not (0 <= float(pv) <= 100):
                err(mid, f"progress {pv} ausserhalb 0-100 (Audit #6)")
            mo = m.get("owner") or ws.get("owner")
            if not mo:
                gap(mid, "owner fehlt")
            elif owners and str(mo) not in owners:
                warn(mid, f"unbekannter Owner «{mo}»")
            if m.get("phase") is None:
                gap(mid, "phase fehlt (null)")
            adj[m.get("id") or mid] = list(m.get("depends_on") or [])

    for mid, deps in adj.items():
        for d in deps:
            if d not in ids:
                err(mid, f"depends_on verweist auf unbekannte ID «{d}»")

    # Zyklen (DFS)
    state = {}
    def dfs(u, stack):
        state[u] = 1
        for v in adj.get(u, []):
            if v not in adj:
                continue
            if state.get(v) == 1:
                err(u, "Abhängigkeits-Zyklus: " + " → ".join(stack + [u, v]))
            elif not state.get(v):
                dfs(v, stack + [u])
        state[u] = 2
    for u in adj:
        if not state.get(u):
            dfs(u, [])

    # ── Handlungen/Tasks (13.07., «treibend»): tasks.json-Integrität + Roll-up-Parität.
    # Für Milestones mit progress_source:'tasks' MUSS der gespeicherte progress dem
    # deterministischen Roll-up entsprechen (half-up, identisch zu rubicon-api.js
    # rollupMs — Drift = FEHLER, analog Golden-Master-Parität Audit #1).
    n_tasks = 0
    tasks = []
    if TASKS_PATH.exists():
        try:
            tasks = (json.loads(TASKS_PATH.read_text()) or {}).get("tasks") or []
        except json.JSONDecodeError as ex:
            err("tasks.json", f"kein gültiges JSON: {ex}")
    tids = set()
    tnrs = set()
    ms_progress_source = {}
    for ws in doc.get("workstreams") or []:
        for m in ws.get("milestones") or []:
            if m.get("id"):
                ms_progress_source[m["id"]] = m.get("progress_source")
    # ── Schema-Prüfung der JSON-Stores (R4) ──
    for lvl, where, msg in pruefe_stores(ROOT):
        (err if lvl == 'FEHLER' else warn if lvl == 'WARNUNG' else gap)(where, msg)

    for t in tasks:
        n_tasks += 1
        tid = t.get("id") or "tasks/?"
        if not t.get("id"):
            err("tasks.json", "Task ohne id")
        elif t["id"] in tids:
            err(tid, "doppelte Task-ID")
        else:
            tids.add(t["id"])
        nr = t.get("nr")
        if not isinstance(nr, int) or nr < 1:
            err(tid, "nr fehlt/ungültig (laufende Referenz-Nummer, Pflicht seit 13.07.)")
        elif nr in tnrs:
            err(tid, f"nr {nr} doppelt vergeben")
        else:
            tnrs.add(nr)
        if not t.get("text"):
            err(tid, "Task ohne text")
        if not t.get("ms_id"):
            # Commitments aus Sitzungen dürfen ungekoppelt sein (Schnitt 2) —
            # Zerlegungs-Handlungen sollten IMMER gekoppelt sein.
            (gap if t.get("source") in ("sitzung", "gemini", "nachlauf") else err)(tid, "ms_id fehlt (nicht milestone-gekoppelt)")
        elif t["ms_id"] not in ids:
            err(tid, f"ms_id verweist auf unbekannten Milestone «{t['ms_id']}»")
        if t.get("status") not in ("offen", "erledigt"):
            err(tid, f"status «{t.get('status')}» ungültig (offen|erledigt)")
        if t.get("status") == "erledigt" and not t.get("erledigt_am"):
            err(tid, "erledigt ohne erledigt_am")
        if t.get("status") == "offen" and t.get("erledigt_am"):
            err(tid, "offen mit erledigt_am (inkonsistent)")
        if t.get("due") and not parse_date(str(t["due"])):
            err(tid, f"due «{t['due']}» kein gültiges Datum")
        elif not t.get("due"):
            gap(tid, "due fehlt (null — bewusst nicht geraten)")
        if not t.get("owner"):
            gap(tid, "owner fehlt")
        elif owners and str(t["owner"]) not in owners:
            warn(tid, f"unbekannter Owner «{t['owner']}»")
    # Roll-up-Parität je task-getriebenem Milestone
    for ws in doc.get("workstreams") or []:
        for m in ws.get("milestones") or []:
            if m.get("progress_source") != "tasks":
                continue
            mid = m.get("id") or "?"
            mts = [t for t in tasks if t.get("ms_id") == mid]
            if not mts:
                err(mid, "progress_source:'tasks' aber KEINE Handlungen in tasks.json")
                continue
            done = sum(1 for t in mts if t.get("status") == "erledigt")
            expect = math.floor(100 * done / len(mts) + 0.5)   # half-up, parity mit rollupMs
            if m.get("progress") != expect:
                err(mid, f"Roll-up-Drift: progress {m.get('progress')} ≠ {expect} ({done}/{len(mts)} Handlungen erledigt)")

    n_in = 0
    for inp in doc.get("inputs") or []:
        n_in += 1
        iid = inp.get("id") or "inputs/?"
        if not inp.get("id"):
            err("inputs", "Input ohne id")
        if not inp.get("due"):
            err(iid, "Input ohne due")
        elif not parse_date(str(inp["due"])):
            err(iid, f"Input-due «{inp['due']}» ungültig")
        if not inp.get("owner"):
            gap(iid, "Input ohne owner")
        if inp.get("status") not in ("offen", "geliefert"):
            err(iid, f"Input-status «{inp.get('status')}» ungültig (offen|geliefert)")
        # Task-Kopplung (13.07.): liefer_tasks müssen existieren; Status ist ABGELEITET —
        # geliefert ⇔ alle gekoppelten Handlungen erledigt (Drift = FEHLER, analog Roll-up)
        lt = inp.get("liefer_tasks")
        if lt is not None:
            if not isinstance(lt, list) or not lt:
                err(iid, "liefer_tasks muss nicht-leere Liste sein (oder Feld weglassen)")
            else:
                tstat = {t.get("id"): t.get("status") for t in tasks}
                for ref in lt:
                    if ref not in tstat:
                        err(iid, f"liefer_tasks verweist auf unbekannten Task «{ref}»")
                if all(ref in tstat for ref in lt):
                    soll = "geliefert" if all(tstat[ref] == "erledigt" for ref in lt) else "offen"
                    if inp.get("status") != soll:
                        err(iid, f"Input-Status-Drift: status={inp.get('status')} aber gekoppelte Tasks ⇒ {soll}")

    # ── Entscheids-Register (16.07., Säule 3 INS-001 Anhang B): entscheide.json —
    # E-Nummern + keys eindeutig, Status im 5-Stufen-Modell, kommuniziert ⇒ Stempel,
    # Task-Verweise müssen existieren. Revisionssicherheit ist API-seitig (kein Delete).
    ENT_FLOW = ("beantragt", "entscheidungsreif", "entschieden", "kommuniziert", "umgesetzt")
    ents_path = ROOT / "src" / "data" / "entscheide.json"
    n_ents = 0
    if ents_path.exists():
        try:
            estore = json.loads(ents_path.read_text())
        except Exception as ex:
            estore = {"entscheide": []}
            err("entscheide.json", f"kein gültiges JSON: {ex}")
        ents = estore.get("entscheide") or []
        n_ents = len(ents)
        seen_eid, seen_ekey = set(), set()
        task_ids = {t.get("id") for t in tasks}
        for e in ents:
            eid = e.get("id") or "?"
            if not e.get("id") or not e.get("key"):
                err("entscheide.json", f"Entscheid ohne id/key ({eid})")
            if eid in seen_eid:
                err(eid, "doppelte Register-ID")
            seen_eid.add(eid)
            if e.get("key") in seen_ekey:
                err(eid, f"doppelter key «{e.get('key')}»")
            seen_ekey.add(e.get("key"))
            if e.get("status") not in ENT_FLOW:
                err(eid, f"Status «{e.get('status')}» ungültig ({'|'.join(ENT_FLOW)})")
            if e.get("status") in ("kommuniziert", "umgesetzt") and not (e.get("kommunikation") or {}).get("am"):
                err(eid, "Status kommuniziert/umgesetzt ohne Kommunikations-Stempel {an, am}")
            if e.get("status") in ("entschieden", "kommuniziert", "umgesetzt") and not e.get("datum"):
                gap(eid, "entschieden ohne Entscheid-Datum")
            if not e.get("begruendung") and e.get("status") in ("entschieden", "kommuniziert", "umgesetzt"):
                gap(eid, "Entscheid ohne Begründung (Register-Pflichtfeld)")
            for ref in e.get("tasks") or []:
                if ref not in task_ids:
                    err(eid, f"tasks verweist auf unbekannte Handlung «{ref}»")

    # ── Zielbild-Register (04.08., «AXS-Datengehirn»): zielbild.json — ms_refs müssen
    # existieren; «vorhanden»/«gelebt» ohne Evidenz = Datenlücke (Datenehrlichkeit);
    # Erfüllungsgrad wird deterministisch aus domain.json-Scores gerechnet.
    zb_path = ROOT / "src" / "data" / "zielbild.json"
    zb_line = ""
    link_urls = []   # (where, url) — Archiv-Pointer für den Drive-Link-Check
    if zb_path.exists():
        try:
            zstore = json.loads(zb_path.read_text())
        except Exception as ex:
            zstore = {"zielbild": []}
            err("zielbild.json", f"kein gültiges JSON: {ex}")
        zs = zstore.get("zielbild") or []
        try:
            zdom = json.loads((ROOT / "src" / "data" / "domain.json").read_text()).get("zielbild") or {}
        except Exception:
            zdom = {}
        zmeta = zdom.get("meta") or {}
        # Evidenz-Format (Härtung 04.08.): Muster-SSOT aus domain.json — Evidenz muss einen
        # Drive-/Docs-Link ODER eine Register-Referenz enthalten (Pointer ins Archiv).
        zfmt = zdom.get("evidenz_formate") or {}
        re_url = re.compile(zfmt.get("url", r"https?://(docs|drive)\.google\.com/"))
        re_reg = re.compile(zfmt.get("register", r"$^"))
        pointer_ok = lambda s: bool(re_url.search(s or "") or re_reg.search(s or ""))
        all_ms_ids = {m.get("id") for w in (doc.get("workstreams") or []) for m in (w.get("milestones") or [])}
        n_freitext = 0
        for z in zs:
            zid = z.get("id") or "?"
            for ref in z.get("ms_refs") or []:
                if ref not in all_ms_ids:
                    err(zid, f"ms_refs verweist auf unbekannten Milestone «{ref}»")
            ev = (z.get("evidenz") or "").strip()
            if z.get("status") in ("vorhanden", "gelebt"):
                if not ev:
                    gap(zid, f"Status «{z.get('status')}» ohne Evidenz (Datenehrlichkeit)")
                elif not pointer_ok(ev):
                    n_freitext += 1
                    gap(zid, "Evidenz ist Freitext ohne Archiv-Pointer (Drive-Link/Register-ID nachpflegen)")
            for u in re.findall(r"https?://(?:docs|drive)\.google\.com/\S+", ev):
                link_urls.append((zid, u))
        if zs:
            zb_line = f"   Zielbild: {len(zs)} Kriterien · {round(sum((zmeta.get(z.get('status')) or {}).get('score') or 0 for z in zs) / len(zs))}% erfüllt"
            if n_freitext:
                zb_line += f" · {n_freitext} Evidenzen ohne Pointer"

    # Artefakt-Pflicht (04.08., Baustein 2 «Datengehirn»): ab Stichtag erledigte
    # Handlungen sollen ihr Arbeitsprodukt verlinken (Drive «Datenlieferungen»/Doc/
    # Register) — sonst Datenlücke. Alt-Bestand (vor Stichtag) bleibt unbeanstandet.
    ARTEFAKT_STICHTAG = "2026-08-04"
    for t in tasks:
        if t.get("status") == "erledigt" and (t.get("erledigt_am") or "") >= ARTEFAKT_STICHTAG and not (t.get("artefakt") or "").strip():
            gap(t.get("id") or "?", "erledigt ohne Artefakt-Link (Ablage-Pflicht ab 04.08.)")
        for u in re.findall(r"https?://(?:docs|drive)\.google\.com/\S+", t.get("artefakt") or ""):
            link_urls.append((t.get("id") or "?", u))

    # ── Drive-Link-Check (Härtung 04.08.): jeder Archiv-Pointer muss real auflösbar sein —
    # toter/gelöschter Link = Datenlücke. Non-fatal & optional: läuft nur, wenn Google-Creds
    # verfügbar sind (Portabilität — der Tower-Kern braucht kein Google, MIGRATION §7);
    # Skip via RUBICON_SKIP_LINKCHECK=1.
    if link_urls and os.environ.get("RUBICON_SKIP_LINKCHECK") != "1":
        def _file_id(u):
            m = re.search(r"/(?:d|folders|file/d)/([A-Za-z0-9_-]{10,})", u) or re.search(r"[?&]id=([A-Za-z0-9_-]{10,})", u)
            return m.group(1) if m else None
        try:
            _ga = Path("/Users/dieterstreuli/Chief/Tools")
            sys.path.insert(0, str(_ga if (_ga / "_google_auth.py").exists() else ROOT / "scripts" / "_tools"))
            from _google_auth import load_credentials            # noqa: E402
            from googleapiclient.discovery import build          # noqa: E402
            _svc = build("drive", "v3", credentials=load_credentials("d.streuli@axs.aero"), cache_discovery=False)
            seen_ids = {}
            for where, u in link_urls:
                fid = _file_id(u)
                if not fid:
                    gap(where, f"Archiv-Link ohne erkennbare Datei-ID: {u[:60]}")
                    continue
                if fid not in seen_ids:
                    try:
                        f = _svc.files().get(fileId=fid, fields="id,trashed", supportsAllDrives=True).execute()
                        seen_ids[fid] = "papierkorb" if f.get("trashed") else "ok"
                    except Exception:
                        seen_ids[fid] = "tot"
                if seen_ids[fid] != "ok":
                    gap(where, f"Archiv-Link {seen_ids[fid]} (nicht auflösbar): …{fid[-8:]}")
        except Exception as ex:
            warn("link-check", f"übersprungen ({type(ex).__name__}) — {len(link_urls)} Archiv-Links ungeprüft")

    print("── RUBICON Control Tower · Datenintegrität " + "─" * 30)
    print(f"  Meilensteine: {n_ms}   Ströme: {len(doc.get('workstreams') or [])}   Inputs: {n_in}   Handlungen: {n_tasks}   Entscheide: {n_ents}{zb_line}")
    for line in errors + warnings + gaps:
        print(line)
    print(f"  Summe: {len(errors)} Fehler · {len(warnings)} Warnungen · {len(gaps)} Datenlücken")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
