#!/usr/bin/env python3
"""build_projekt_yaml.py — assembliert src/data/projekt.yaml aus zwei Quellen:

1. Commercial-Masterplan (43 MS) aus ~/Chief/crm/cockpit/masterplan.json — 1:1,
   NICHT umformuliert. Deterministische Feld-Mappings (s. MAPPING unten).
2. RUBICON-Programm-Ströme (7 WS) aus der Workflow-Extraktion (tower_daten.json).

Gibt die Mapping-Tabelle + alle Datenlücken aus. Idempotent.
"""
import json
import os
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, __file__.rsplit('/', 1)[0])                  # _lib (Q6)
from _lib import atomic_write as _atomic_write  # noqa: E402


# Quellen sind self-contained im Repo (scripts/_sources/, rekonstruiert 13.07.2026 aus
# projekt.yaml+briefings.json; Round-Trip-verifiziert). CUTOVER 07.07.: Tracking der CMP-MS
# lebt in projekt.yaml; der Rebuild liest den EINGEFRORENEN Masterplan-Snapshot und erhält
# gepflegte Tracking-Felder (Progress-Preserve unten).
SC = Path(__file__).resolve().parent / '_sources'
MP_PATH = SC / 'masterplan.FROZEN.json'
EXTRACT_PATH = SC / 'tower_daten.json'
OUT = ROOT / 'src' / 'data' / 'projekt.yaml'

ISO_FULL = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ISO_MONTH = re.compile(r'^(\d{4})-(\d{2})$')

gaps = []


def clean(o):
    if isinstance(o, str):
        return (o.replace('&amp;', '&').replace('&gt;', '>').replace('&lt;', '<'))
    if isinstance(o, list):
        return [clean(x) for x in o]
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    return o


def norm_start(s, mid):
    """'YYYY-MM-DD' 1:1; 'YYYY-MM' -> Monatserster (dokumentiert); sonst null."""
    if not s:
        return None
    s = str(s).strip()
    if ISO_FULL.match(s):
        return s
    m = ISO_MONTH.match(s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-01"
    gaps.append(f"{mid}: start «{s}» nicht ISO → null")
    return None


def build_masterplan_stream(mp):
    """MAPPING (Quellfeld -> Zielfeld), 1:1 ohne Umformulierung:
      id->id | title->name | owner->owner | start->start (Norm) | due->due |
      workstream->phase | depends_on(TITEL)->depends_on(IDs via Titel-Lookup) |
      quarter->quarter | prio->prio | kpi->kpi |
      status: 'erledigt'->progress 100, 'offen'->progress null (LÜCKE — Quelle
              trackt keinen numerischen Fortschritt) |
      critical: nicht vorhanden in Quelle -> false |
      action/grounding/briefing: nicht übernommen (Detailtiefe; Quelle bleibt
              masterplan.json — hier nur Referenz) | seq: nicht übernommen (== id-Ordnung)
    """
    ms_src = mp['milestones']
    title2id = {}
    for m in ms_src:
        title2id.setdefault(m['title'].strip(), m['id'])
    out = []
    for m in ms_src:
        mid = m['id']
        # depends_on: Titel -> ID
        deps = []
        raw_dep = m.get('depends_on') or ''
        dep_titles = [raw_dep] if isinstance(raw_dep, str) else list(raw_dep)
        for t in dep_titles:
            t = (t or '').strip()
            if not t:
                continue
            if t in title2id:
                if title2id[t] == mid:
                    gaps.append(f"{mid}: depends_on verweist auf sich selbst (Quell-Eigenheit) → ignoriert")
                else:
                    deps.append(title2id[t])
            else:
                gaps.append(f"{mid}: depends_on-Titel «{t[:50]}…» nicht auflösbar → ignoriert")
        status = (m.get('status') or '').strip()
        if status == 'erledigt':
            progress = 100
        else:
            progress = None
            gaps.append(f"{mid}: progress unbekannt (Quelle status={status or '—'}) → null")
        out.append({
            'id': mid,
            'name': m['title'],
            'owner': m.get('owner') or None,
            'start': norm_start(m.get('start'), mid),
            'due': m.get('due') or None,
            'progress': progress,
            'critical': False,
            'phase': m.get('workstream') or None,
            'gate': None,
            'nachlauf': False,
            'quarter': m.get('quarter') or None,
            'prio': m.get('prio') or None,
            'kpi': (m.get('kpi') or None),
            'depends_on': deps,
        })
    return {
        'code': 'CMP',
        'name': 'Commercial-Masterplan (Stabilisierung) — 1:1 aus masterplan.json',
        'owner': 'Haeffner',
        'support': 'Petric (Cockpit/Daten); Quelle: crm/cockpit/masterplan.json (43 MS, Endstate E1–E10)',
        'milestones': out,
    }


def main():
    mp = json.loads(MP_PATH.read_text())
    extract = clean(json.loads(EXTRACT_PATH.read_text()))

    cmp_stream = build_masterplan_stream(mp)
    n_src = len(mp['milestones'])
    n_out = len(cmp_stream['milestones'])
    assert n_src == n_out, f"Zähler-Mismatch Quelle {n_src} != Ziel {n_out}"

    # ── MERGE WS4 + CMP (DRS 07.07.: «gleiches Thema / Überlappungen») ──
    # CMP-MS bleiben 1:1 (Regel), werden aber VOLL in die RUBICON-Phasen 0–3/Nachlauf
    # integriert (DRS 07.07.: kein separater «Masterplan»-Bucket) — Phase termin-
    # getrieben aus dem due-Datum, konsistent mit den RUBICON-Phasenfenstern.
    # RUBICON-WS4-Deliverables bleiben als Programm-Gates darüber.
    # Redundanz (dokumentiert): WS4-03 «Renewal-Pipeline 100%» ist durch
    #   M03 (OPEN-Register) + M09 (Cliff-Datenlücken) + M10 (OPEN→0) detaillierter
    #   abgedeckt → entfernt; Referenzen zeigen auf M10.
    # Kopplungen (Programm-Gate hängt an Masterplan-Detail):
    MERGE_DROP = {'WS4-03': 'M10'}  # entfernte RUBICON-ID -> Ersatz-Referenz
    MERGE_LINKS = {                  # RUBICON-Gate -> zusätzliche depends_on
        'WS4-01': ['M03'],           # Kunden-Schutzschirm <- OPEN-Register
        'WS4-05': ['M06'],           # Beziehungspflege-Matrix <- Top-30-Sponsoren
        'WS4-08': ['M10'],           # 2026-OPEN >=90% <- OPEN->0 klassifiziert
        'WS4-11': ['M21'],           # Zielnachweis Cliff >=40% <- 30%-Sicherung Q4/26
    }
    streams = extract['streams_a'] + extract['streams_b']
    ws4 = next(w for w in streams if w['code'] == 'WS4')
    ws4_ms = []
    for m in ws4['milestones']:
        if m['id'] in MERGE_DROP:
            gaps.append(f"MERGE: {m['id']} entfernt (redundant zu Masterplan; Ersatz {MERGE_DROP[m['id']]})")
            continue
        if m['id'] in MERGE_LINKS:
            m = {**m, 'depends_on': sorted(set((m.get('depends_on') or []) + MERGE_LINKS[m['id']]))}
        ws4_ms.append(m)
    def rubicon_phase(due):
        # Phasenfenster analog RUBICON-Roadmap (§5); > 30.04.27 = gesetzlicher Nachlauf.
        if not due:
            return None
        if due <= '2026-10-15':
            return 'Phase 0'
        if due <= '2026-12-31':
            return 'Phase 1'
        if due <= '2027-03-31':
            return 'Phase 2'
        if due <= '2027-04-30':
            return 'Phase 3'
        return 'Nachlauf Q2/27'
    for m in cmp_stream['milestones']:
        ph = rubicon_phase(m.get('due'))
        m['phase'] = ph
        if ph == 'Nachlauf Q2/27':
            m['nachlauf'] = True   # zählt nicht gegen Kern-Ende, ⏳-Markierung
    ws4['name'] = 'Commercial & Kundennähe (inkl. Commercial-Masterplan 1:1)'
    ws4['support'] = (ws4.get('support') or '') + ' · Masterplan-Quelle: crm/cockpit/masterplan.json (43 MS, nie von Hand editieren)'
    ws4['milestones'] = ws4_ms + cmp_stream['milestones']
    # Redirects auf entfernte IDs auflösen
    for w in streams:
        for m in w['milestones']:
            m['depends_on'] = [MERGE_DROP.get(d, d) for d in (m.get('depends_on') or [])]

    workstreams = streams

    # Owner-Liste: extrahierte + alle tatsächlich verwendeten
    owners = set(extract.get('owners') or [])
    for ws in workstreams:
        if ws.get('owner'):
            owners.add(ws['owner'])
        for m in ws['milestones']:
            if m.get('owner'):
                owners.add(m['owner'])

    # ── Programm-Dimension (17.07., Plattform-Systematik): weitere Programme + deren
    # Workstreams kommen QUELLENGETRIEBEN aus _sources/programme.json — damit überlebt
    # Programm #2 (Finanzierung 2026) jeden Rebuild. Transformation bleibt Programm #1.
    prog_src = SC / 'programme.json'
    extra = json.loads(prog_src.read_text()) if prog_src.exists() else {}
    for w in workstreams:
        w['programm'] = 'transformation'
    extra_ws = extra.get('workstreams') or []
    for w in extra_ws:
        if not w.get('programm'):
            raise SystemExit(f"programme.json: Workstream {w.get('code')} ohne programm-Zuordnung")
        for m in w.get('milestones') or []:
            if m.get('owner'):
                owners.add(m['owner'])
        if w.get('owner'):
            owners.add(w['owner'])

    data = {
        'meta': {
            'projekt': 'Projekt RUBICON — Transformationsplan AXS Group 2026/27',
            'untertitel': 'Alea iacta est.',
            'today': '2026-07-07',
            'baseline_end': '2027-04-30',
            'nachlauf_end': '2027-06-30',
            'hard_edge': '2027-06-30',  # DRS 07.07.: bis 30.06.2027 ist ALLES komplett abgeschlossen
            'owners': sorted(owners),
            'programme': [
                {'id': 'transformation', 'name': 'Transformation 2026/27 (Programm RUBICON)',
                 'status': 'aktiv', 'start': '2026-09-01', 'ende': '2027-04-30'},
                *(extra.get('programme') or []),
            ],
            'default_programm': 'transformation',
        },
        'workstreams': workstreams + extra_ws,
        'inputs': extract.get('inputs') or [],
    }

    # ── Progress-Preserve (Cutover 07.07.2026): projekt.yaml ist die Wahrheit. ──
    # Beim Neuaufbau werden dort gepflegte Tracking-Felder (progress,
    # reported_slip_days, due, owner) je Milestone-ID ERHALTEN — der Rebuild
    # setzt nur Struktur/Neues aus den Snapshots, überschreibt nie Pflege.
    if OUT.exists():
        prev = yaml.safe_load(OUT.read_text()) or {}
        # meta.today = manuell gepflegtes Steuerungsdatum — überlebt den Rebuild
        if (prev.get('meta') or {}).get('today'):
            data['meta']['today'] = prev['meta']['today']
        if (prev.get('meta') or {}).get('datenlieferungen_url'):
            data['meta']['datenlieferungen_url'] = prev['meta']['datenlieferungen_url']
        # Programm-Dimension: Registry + WS-Zuordnung sind seit 17.07. QUELLENGETRIEBEN
        # (programme.json + fixe transformation-Zuordnung oben) — kein Preserve nötig.
        # Inputs: gepflegter Lieferstatus + Task-Kopplung überleben den Rebuild
        prev_in = {i['id']: i for i in (prev.get('inputs') or []) if i.get('id')}
        for inp in data['inputs']:
            pi = prev_in.get(inp.get('id'))
            if pi:
                for f in ('status', 'liefer_tasks'):
                    if pi.get(f) is not None:
                        inp[f] = pi[f]
        prev_ms = {m['id']: m for w in (prev.get('workstreams') or []) for m in (w.get('milestones') or []) if m.get('id')}
        n_pres = 0
        for w in data['workstreams']:
            for m in w['milestones']:
                pm = prev_ms.get(m['id'])
                if not pm:
                    continue
                for f in ('progress', 'reported_slip_days', 'due', 'owner', 'progress_source', 'start'):
                    if pm.get(f) is not None and pm.get(f) != m.get(f):
                        m[f] = pm[f]
                        n_pres += 1
        if n_pres:
            print(f"  Progress-Preserve: {n_pres} gepflegte Feldwerte aus bestehender projekt.yaml erhalten")

    # ── Owner-Normalisierung (DRS 08.07.): Varianten derselben Person → 1 Kürzel.
    # NACH Progress-Preserve, damit sie das letzte Wort hat (sonst holt Preserve die
    # alten Namen zurück). Team-Owner bleiben als Team-Label erhalten (nicht auf eine
    # Person umgedeutet). Zuordnungen gegen AXS-Org-Chart verifiziert.
    OWNER_NORMALIZE = {
        # Volle Namen (Vorname Nachname), verifiziert am AXS-Org-Chart. Deckt Roh-Namen
        # (Masterplan) UND alte Kürzel ab; DRS-Regeln 13.07.: Commercial→Haeffner,
        # Didit/Tine→Tine Petric, Wüst (nicht GL)→Charisius.
        'AFR': 'Andreas Fritthum', 'Andreas Fritthum': 'Andreas Fritthum',
        'CGO': 'Cüneyt Gökcöl', 'Cüneyt Gökcöl': 'Cüneyt Gökcöl',
        'Matthei': 'Florian Matthei', 'Florian Matthei': 'Florian Matthei',
        'Rohde': 'Stephanie Rohde', 'Stephanie Rohde': 'Stephanie Rohde',
        'Pajor': 'Thomas Pajor', 'Finance (Pajor)': 'Thomas Pajor', 'Thomas Pajor': 'Thomas Pajor',
        'Haeffner': 'Michael Haeffner', 'Michael Haeffner': 'Michael Haeffner',
        'Commercial-Team': 'Michael Haeffner', 'Commercial (Cüneyt/Himm/Eslava)': 'Michael Haeffner',
        'Charisius': 'Amélie Charisius', 'Amélie Charisius (Legal)': 'Amélie Charisius',
        'Amélie Charisius': 'Amélie Charisius', 'Wüst': 'Amélie Charisius',
        'Petric': 'Tine Petric', 'Didit/Tine': 'Tine Petric', 'Tine Petric': 'Tine Petric',
        'DRS': 'Dieter Streuli', 'Dieter Streuli': 'Dieter Streuli',
    }
    used_owners = set()
    for w in data['workstreams']:
        if w.get('owner'):
            w['owner'] = OWNER_NORMALIZE.get(w['owner'], w['owner'])
            used_owners.add(w['owner'])
        for m in w['milestones']:
            if m.get('owner'):
                m['owner'] = OWNER_NORMALIZE.get(m['owner'], m['owner'])
                used_owners.add(m['owner'])
    for inp in data['inputs']:
        if inp.get('owner'):
            inp['owner'] = OWNER_NORMALIZE.get(inp['owner'], inp['owner'])
    data['meta']['owners'] = sorted(used_owners)
    print(f"  Owner-Normalisierung: {len(used_owners)} distinkte Verantwortliche (inkl. Inputs)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(OUT, yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=200))

    # ── briefings.json (Detail-Definitionen je MS; eigener Datentyp, eine Quelle) ──
    # CMP: briefing 1:1 aus masterplan.json (kontext/leistung/vorgehen/beteiligte/
    #      risiken/erfolgsmessung) + grounding.
    # RUBICON: aus Agent-Extrakt rubicon_briefings.json (gleiche Struktur,
    #      gegroundet auf RUBICON-Doc + WS-Pakete) — fehlt die Datei, bleibt der
    #      RUBICON-Teil leer und wird als Lücke gemeldet.
    briefings = {}
    for m in mp['milestones']:
        b = dict(m.get('briefing') or {})
        if b:
            b['grounding'] = m.get('grounding') or b.get('grounding')
            briefings[m['id']] = b
        else:
            gaps.append(f"{m['id']}: kein briefing in masterplan.json")
    rb_path = SC / 'rubicon_briefings.json'
    n_rb = 0
    if rb_path.exists():
        for b in clean(json.loads(rb_path.read_text())):
            bid = b.pop('id')
            briefings[bid] = b
            n_rb += 1
    else:
        gaps.append('rubicon_briefings.json fehlt — RUBICON-MS ohne Briefing (Lücke)')
    # Klartext-Ziel je Milestone (14.07. Klarheits-Audit): ausführliche, abkürzungs-
    # freie Zielzustand-/Erledigt-Definition — rebuild-fest aus Quelldatei injiziert.
    zk_path = SC / 'ziel_klartext.json'
    n_zk = 0
    if zk_path.exists():
        for mid, txt in json.loads(zk_path.read_text()).items():
            if mid in briefings:
                briefings[mid]['ziel_klartext'] = txt
                n_zk += 1
        print(f"  Klartext-Ziele injiziert: {n_zk}")
    BRIEF_OUT = ROOT / 'src' / 'data' / 'briefings.json'
    _atomic_write(BRIEF_OUT, json.dumps(briefings, ensure_ascii=False, indent=1))
    print(f"  Briefings: {len(briefings)} gesamt ({n_rb} RUBICON + {len(briefings)-n_rb} Masterplan) → {BRIEF_OUT.name}")

    n_rub = sum(len(w['milestones']) for w in workstreams) - n_out
    print("── Assembly-Report " + "─" * 50)
    print(f"  Commercial-Masterplan: Quelle {n_src} == Ziel {n_out} MS — GEMERGT in WS4 (phase «Masterplan · …»)")
    print(f"  Programm: {len(workstreams)} Ströme, {n_rub} RUBICON-MS + {n_out} Masterplan-MS")
    print(f"  Inputs: {len(data['inputs'])} · Owner: {len(owners)}")
    print(f"  Datenlücken/Mapping-Hinweise: {len(gaps)}")
    for g in gaps[:12]:
        print("   ·", g)
    if len(gaps) > 12:
        print(f"   · … +{len(gaps)-12} weitere (gleichartig: progress null)")
    print(f"  → {OUT}")


if __name__ == '__main__':
    main()
