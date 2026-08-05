// data.js — injizierte Wahrheitsquellen + abgeleitete Programmdaten (Block A, 05.08.2026).
//
// Bis Block A wurden die Stores zur BUILD-Zeit importiert — in Produktion sah der
// Client die Laufzeit-Writes deshalb nie (das GCS-Volume überschattet src/data erst
// NACH dem Image-Build). Jetzt injiziert main.jsx die GET-/api/state-Nutzlast via
// initData(state); alle Exporte sind ES-Live-Bindings (export let) — Consumer
// importieren dieselben Namen wie bisher und sehen die initialisierten Werte.
// TRAGENDE REGEL: App.jsx wird in main.jsx erst NACH initData dynamisch importiert,
// damit Modul-Top-Level-Berechnungen (z. B. AGENDA_BY_ID) initialisierte Daten sehen.
import { loadProject } from './loader.js'
import { parseDate } from './status.js'

// ── Roh-Stores (Namen = die bisherigen Import-Namen in App/Views) ──
export let DOMAIN_JSON = null                    // domain.json → lib/domain.js + lib/theme.js
export let BRIEFINGS = {}                        // briefings.json
export let FR = { gruppen: [] }                  // fuehrungsrhythmus.json
export let TRAKT_DOCS = {}                       // traktanden_docs.json
export let PROTO = { protokolle: [] }            // protokolle.json
export let AGENDAS = { agendas: [] }             // traktanden.json
export let REPORTS = { reports: [] }             // reports_index.json
export let ENTS = { seq: 0, entscheide: [] }     // entscheide.json
export let REMLOG = { reminders: [] }            // reminder_log.json
export let ZBSTORE = { zielbild: [] }            // zielbild.json

// ── Abgeleitete Werte (in initData berechnet) ──
export let BASE = { meta: {}, workstreams: [], inputs: [] }
export let ISSUES = []
export let NOW = null
export let ALL_TASKS = []
export let MS_META = {}
export let TASK_STATS = { total: 0, offen: 0, erledigt: 0, ueberfaellig: 0 }
export let RADAR = []

/** Injektion der /api/state-Nutzlast — MUSS vor dem (dynamischen) App-Import laufen. */
export function initData(state) {
  DOMAIN_JSON = state.domain || {}
  BRIEFINGS = state.briefings || {}
  FR = state.fuehrungsrhythmus || { gruppen: [] }
  TRAKT_DOCS = state.traktanden_docs || {}
  PROTO = state.protokolle || { protokolle: [] }
  AGENDAS = state.traktanden || { agendas: [] }
  REPORTS = state.reports_index || { reports: [] }
  ENTS = state.entscheide || { seq: 0, entscheide: [] }
  REMLOG = state.reminder_log || { reminders: [] }
  ZBSTORE = state.zielbild || { zielbild: [] }

  const res = loadProject(state.projekt_yaml || '')
  BASE = res.data
  ISSUES = res.issues
  NOW = parseDate(BASE.meta.today)
  ALL_TASKS = (state.tasks && state.tasks.tasks) || []
  MS_META = Object.fromEntries(BASE.workstreams.flatMap(w =>
    (w.milestones || []).map(m => [m.id, { ws: w.code, phase: m.phase, name: m.name, due: m.due, programm: w.programm || null }])))
  TASK_STATS = {
    total: ALL_TASKS.length,
    offen: ALL_TASKS.filter(t => t.status === 'offen').length,
    erledigt: ALL_TASKS.filter(t => t.status === 'erledigt').length,
    ueberfaellig: ALL_TASKS.filter(taskOverdue).length,
  }
  RADAR = computeRadar()
}

// A1 (01.08.): Datei-Writes lösen einen Reload aus — Scroll-Position vorher merken,
// damit die Ansicht nach dem Reload nicht an den Seitenanfang springt. Der Reload
// löst seit Block A den Bootstrap-Fetch erneut aus → frischer Stand. (Semantik
// unverändert — Constraint 7.)
export function reloadKeepScroll() {
  sessionStorage.setItem('rubicon_scroll', String(window.scrollY || 0))
  window.location.reload()
}

// ---------- Handlungen (Tasks, «treibend» 13.07.) ----------
// Lesen die Live-Bindings zur AUFRUFZEIT — funktionieren daher nach initData unverändert.
export const tasksFor = (msId) => ALL_TASKS.filter(t => t.ms_id === msId)
export const tnr = (t) => 'T-' + String(t.nr || 0).padStart(3, '0')   // kurze Referenz-Nummer (dauerhaft, nie neu vergeben)
export const taskOverdue = (t) => t.status === 'offen' && !!t.due && !!NOW && parseDate(t.due) < NOW

// ── K6 (01.08.): Plausibilitäts-Radar — rein regelbasierte Muster-Checks über
// Milestones + Handlungen (kein KI-Raten). Logik unverändert; seit Block A als
// Funktion, die initData nach der Injektion aufruft (vorher Modul-IIFE).
function computeRadar() {
  const out = []
  const byId = Object.fromEntries(BASE.workstreams.flatMap(w => (w.milestones || []).map(m => [m.id, m])))
  // 1) Abhängigkeits-Terminlogik: Nachfolger fällig VOR einem Vorgänger
  for (const m of Object.values(byId)) {
    for (const dep of (m.depends_on || [])) {
      const d = byId[dep]
      if (d && m.due && d.due && m.due < d.due)
        out.push({ level: 'RADAR', where: m.id, msg: `fällig ${m.due}, hängt aber von ${dep} ab (fällig erst ${d.due}) — Terminlogik prüfen` })
    }
  }
  // 2) Owner-Wochenlast: >8 offene Handlungen desselben Owners in derselben ISO-Woche fällig
  const week = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const t = new Date(d); t.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-KW${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}` }
  const load = {}
  for (const t of ALL_TASKS) {
    if (t.status !== 'offen' || !t.due || !t.owner) continue
    const k = `${t.owner}|${week(t.due)}`
    load[k] = (load[k] || 0) + 1
  }
  for (const [k, n] of Object.entries(load).sort((a, b) => b[1] - a[1])) {
    if (n > 8) { const [o, w] = k.split('|'); out.push({ level: 'RADAR', where: o, msg: `${n} offene Handlungen fällig in ${w} — Überlast/Priorisierung prüfen` }) }
  }
  // 3) Fristen-Cluster: >15 offene Handlungen am selben Tag fällig
  const perDay = {}
  for (const t of ALL_TASKS) if (t.status === 'offen' && t.due) perDay[t.due] = (perDay[t.due] || 0) + 1
  for (const [d, n] of Object.entries(perDay).sort()) {
    if (n > 15) out.push({ level: 'RADAR', where: d, msg: `${n} offene Handlungen am selben Tag fällig — Fristen-Cluster entzerren?` })
  }
  return out
}
