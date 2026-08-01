// data.js — geladene Wahrheitsquellen + abgeleitete Programmdaten (R1, 01.08.2026).
//
// Aus App.jsx herausgelöst: Loader-Ergebnis, Task-Index/Helfer, Plausibilitäts-Radar
// und der Scroll-erhaltende Reload. Views importieren von hier statt aus App.jsx —
// damit hängt keine View mehr am Monolithen.
import { loadProject } from './loader.js'
import TASKS from '../data/tasks.json'
import { parseDate } from './status.js'

export const { data: BASE, issues: ISSUES } = loadProject()
export const NOW = parseDate(BASE.meta.today)

// A1 (01.08.): Datei-Writes lösen einen Vite-HMR-Reload aus — Scroll-Position vorher
// merken, damit die Ansicht nach dem Reload nicht an den Seitenanfang springt.
export function reloadKeepScroll() {
  sessionStorage.setItem('rubicon_scroll', String(window.scrollY || 0))
  window.location.reload()
}

// ---------- Handlungen (Tasks, «treibend» 13.07.) ----------
// tasks.json = aus Milestones abgeleitete, binär abhakbare Handlungen. Bei
// progress_source:'tasks' wird der Milestone-Fortschritt daraus VERDIENT
// (Roll-up serverseitig in rubicon-api.js — hier nur Anzeige + Abhak-Aktion).
// Überfällig ist ABGELEITET: due < meta.today UND offen (nie manuell gesetzt).
export const ALL_TASKS = TASKS.tasks || []
// Milestone-Metadaten für die Aufgabenliste (Phase/WS/Fälligkeit je ms_id)
export const MS_META = Object.fromEntries(BASE.workstreams.flatMap(w =>
  (w.milestones || []).map(m => [m.id, { ws: w.code, phase: m.phase, name: m.name, due: m.due, programm: w.programm || null }])))
export const tasksFor = (msId) => ALL_TASKS.filter(t => t.ms_id === msId)
export const tnr = (t) => 'T-' + String(t.nr || 0).padStart(3, '0')   // kurze Referenz-Nummer (dauerhaft, nie neu vergeben)
export const taskOverdue = (t) => t.status === 'offen' && !!t.due && !!NOW && parseDate(t.due) < NOW
export const TASK_STATS = {
  total: ALL_TASKS.length,
  offen: ALL_TASKS.filter(t => t.status === 'offen').length,
  erledigt: ALL_TASKS.filter(t => t.status === 'erledigt').length,
  ueberfaellig: ALL_TASKS.filter(taskOverdue).length,
}

// ── K6 (01.08.): Plausibilitäts-Radar — rein regelbasierte Muster-Checks über
// Milestones + Handlungen (kein KI-Raten). Befunde erscheinen im Integritäts-
// Panel als eigene Stufe «RADAR» (informativ — kein Gate, kein Abbruch).
export const RADAR = (() => {
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
})()

