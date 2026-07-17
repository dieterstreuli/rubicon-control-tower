// loader.js — parst projekt.yaml, normalisiert, markiert Datenlücken.
// EINZIGE Wahrheitsquelle: src/data/projekt.yaml. Das UI liest NUR aus diesem Loader.
// NIE RATEN: fehlende Werte bleiben null und landen im gaps-Report.

import yaml from 'js-yaml'
import raw from '../data/projekt.yaml?raw'
import { parseDate } from './status.js'

function push(arr, level, where, msg) { arr.push({ level, where, msg }) }

export function loadProject() {
  const issues = [] // {level: 'FEHLER'|'WARNUNG'|'LÜCKE', where, msg}
  let doc
  try {
    doc = yaml.load(raw)
  } catch (e) {
    return { data: { meta: {}, workstreams: [], inputs: [] }, issues: [{ level: 'FEHLER', where: 'projekt.yaml', msg: 'YAML nicht parsebar: ' + e.message }] }
  }
  const data = { meta: doc?.meta || {}, workstreams: [], inputs: [] }

  // --- meta ---
  for (const k of ['projekt', 'today', 'baseline_end']) {
    if (!data.meta[k]) push(issues, 'FEHLER', 'meta', `meta.${k} fehlt`)
  }
  if (data.meta.today && !parseDate(data.meta.today)) push(issues, 'FEHLER', 'meta', 'meta.today ist kein gültiges Datum (YYYY-MM-DD)')
  const owners = new Set((data.meta.owners || []).map(String))
  if (!owners.size) push(issues, 'WARNUNG', 'meta', 'meta.owners ist leer — Owner-Prüfung eingeschränkt')

  // --- Programm-Dimension (16.07., Plattform-Zielbild): meta.programme = Registry,
  // jeder Workstream trägt sein Programm (Fallback default_programm). Solange nur
  // ein Programm aktiv ist, ändert sich im UI nichts — Programm #2 wird damit
  // reines Daten-Onboarding statt Umbau.
  data.meta.programme = Array.isArray(data.meta.programme) ? data.meta.programme : []
  if (!data.meta.programme.length) push(issues, 'LÜCKE', 'meta', 'meta.programme fehlt (Programm-Registry)')
  const progIds = new Set(data.meta.programme.map(p => p.id))
  if (data.meta.default_programm && !progIds.has(data.meta.default_programm))
    push(issues, 'FEHLER', 'meta', `default_programm «${data.meta.default_programm}» nicht in programme registriert`)

  // --- workstreams / milestones ---
  const ids = new Set()
  for (const ws of doc?.workstreams || []) {
    const w = { code: ws.code ?? null, name: ws.name ?? null, owner: ws.owner ?? null, support: ws.support ?? null,
                programm: ws.programm ?? data.meta.default_programm ?? null, milestones: [] }
    if (!w.code) push(issues, 'FEHLER', 'workstream', 'workstream ohne code')
    if (w.programm && progIds.size && !progIds.has(w.programm))
      push(issues, 'FEHLER', `WS ${w.code}`, `programm «${w.programm}» nicht in meta.programme registriert`)
    if (!w.owner) push(issues, 'LÜCKE', `WS ${w.code}`, 'owner fehlt')
    else if (owners.size && !owners.has(w.owner)) push(issues, 'WARNUNG', `WS ${w.code}`, `unbekannter Owner «${w.owner}»`)

    for (const ms of ws.milestones || []) {
      const m = {
        id: ms.id ?? null, name: ms.name ?? null, owner: ms.owner ?? w.owner ?? null,
        start: ms.start ?? null, due: ms.due ?? null,
        progress: (typeof ms.progress === 'number') ? ms.progress : null,
        critical: !!ms.critical, phase: ms.phase ?? null,
        gate: ms.gate ?? null, nachlauf: !!ms.nachlauf,
        date_assumed: !!ms.date_assumed,
        reported_slip_days: (typeof ms.reported_slip_days === 'number') ? ms.reported_slip_days : 0,
        kpi: ms.kpi ?? null, quarter: ms.quarter ?? null, prio: ms.prio ?? null,
        // 'tasks' = Fortschritt wird VERDIENT (Roll-up aus Handlungen, rubicon-api.js);
        // sonst null = manueller Modus. Nur der bekannte Wert wird durchgereicht.
        progress_source: ms.progress_source === 'tasks' ? 'tasks' : null,
        depends_on: Array.isArray(ms.depends_on) ? ms.depends_on : [],
      }
      // Pflichtfelder
      if (!m.id) push(issues, 'FEHLER', `WS ${w.code}`, 'Milestone ohne id')
      else if (ids.has(m.id)) push(issues, 'FEHLER', m.id, 'doppelte Milestone-ID')
      else ids.add(m.id)
      if (!m.due) push(issues, 'FEHLER', m.id || '?', 'due fehlt (Pflichtfeld)')
      else if (!parseDate(m.due)) push(issues, 'FEHLER', m.id, `due «${m.due}» kein gültiges Datum`)
      // Lücken (kein Raten)
      if (m.progress === null) push(issues, 'LÜCKE', m.id || '?', 'progress unbekannt (null)')
      if (!m.owner) push(issues, 'LÜCKE', m.id || '?', 'owner fehlt')
      else if (owners.size && !owners.has(m.owner)) push(issues, 'WARNUNG', m.id, `unbekannter Owner «${m.owner}»`)
      if (m.start && m.due && parseDate(m.start) && parseDate(m.due) && parseDate(m.start) > parseDate(m.due))
        push(issues, 'FEHLER', m.id, 'start liegt nach due')
      if (m.phase === null) push(issues, 'LÜCKE', m.id || '?', 'phase fehlt (null)')
      w.milestones.push(m)
    }
    data.workstreams.push(w)
  }

  // Abhängigkeiten: tote Referenzen + Zyklen (DFS)
  const adj = new Map()
  for (const ws of data.workstreams) for (const m of ws.milestones) adj.set(m.id, m.depends_on)
  for (const [id, deps] of adj) for (const d of deps)
    if (!ids.has(d)) push(issues, 'FEHLER', id, `depends_on verweist auf unbekannte ID «${d}»`)
  const state = new Map() // 0=weiss 1=grau 2=schwarz
  const dfs = (id, stack) => {
    state.set(id, 1); stack.push(id)
    for (const d of adj.get(id) || []) {
      if (!ids.has(d)) continue
      if (state.get(d) === 1) { push(issues, 'FEHLER', id, `Abhängigkeits-Zyklus: ${[...stack, d].join(' → ')}`); continue }
      if (!state.get(d)) dfs(d, stack)
    }
    stack.pop(); state.set(id, 2)
  }
  for (const id of adj.keys()) if (!state.get(id)) dfs(id, [])

  // --- inputs ---
  for (const inp of doc?.inputs || []) {
    const i = { id: inp.id ?? null, owner: inp.owner ?? null, item: inp.item ?? null, due: inp.due ?? null,
                status: inp.status === 'geliefert' ? 'geliefert' : 'offen', last_reminder: inp.last_reminder ?? null,
                // Task-Kopplung (13.07.): geliefert wird ABGELEITET, sobald alle
                // gekoppelten Handlungen erledigt sind (Sync in rubicon-api.js)
                liefer_tasks: Array.isArray(inp.liefer_tasks) ? inp.liefer_tasks : [] }
    if (!i.id) push(issues, 'FEHLER', 'inputs', 'Input ohne id')
    if (!i.due) push(issues, 'FEHLER', i.id || 'inputs', 'Input ohne due')
    if (!i.owner) push(issues, 'LÜCKE', i.id || 'inputs', 'Input ohne owner')
    data.inputs.push(i)
  }

  return { data, issues }
}
