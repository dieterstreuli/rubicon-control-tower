#!/usr/bin/env node
/**
 * test_runtime_state.mjs — Node-Tests der Runtime-Datenschicht (Block A, 05.08.2026).
 *
 * Prüft OHNE Browser/Vite:
 *   · loadProject(rawYaml) — Parameter statt ?raw-Import; Fehler-Report bei kaputtem YAML
 *   · initData(state)      — Live-Bindings (BASE/NOW/ALL_TASKS/…) aus der /api/state-Nutzlast
 *   · domain.js/theme.js   — Domänen-SSOT kommt POST-init aus data.js (Sektion 3, ab Task 3)
 *
 * Dass diese Module in Node ÜBERHAUPT importierbar sind, ist selbst Teil des Tests:
 * kehrt ein ?raw-/JSON-Build-Import in den Modulgraphen zurück, bricht der Import.
 *
 * Aufruf: node scripts/test_runtime_state.mjs   ·   Exit 0 = alle grün
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'src', 'data')
const lib = (f) => pathToFileURL(path.join(ROOT, 'src', 'lib', f)).href

let pass = 0
const fails = []
const check = (name, ok) => { if (ok) pass++; else fails.push(name) }

// Nutzlast, wie GET /api/state sie liefert — direkt aus den Repo-Baseline-Dateien gebaut
const j = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'))
const state = {
  ok: true,
  projekt_yaml: fs.readFileSync(path.join(DATA, 'projekt.yaml'), 'utf8'),
  tasks: j('tasks.json'),
  domain: j('domain.json'),
  briefings: j('briefings.json'),
  fuehrungsrhythmus: j('fuehrungsrhythmus.json'),
  traktanden_docs: j('traktanden_docs.json'),
  protokolle: j('protokolle.json'),
  traktanden: j('traktanden.json'),
  reports_index: j('reports_index.json'),
  entscheide: j('entscheide.json'),
  reminder_log: j('reminder_log.json'),
  zielbild: j('zielbild.json'),
}

// ── 1 · loadProject(rawYaml) ──
const { loadProject } = await import(lib('loader.js'))
const ok1 = loadProject(state.projekt_yaml)
check('loadProject: meta.projekt aus rohem YAML', typeof ok1.data.meta.projekt === 'string' && ok1.data.meta.projekt.length > 0)
check('loadProject: Workstreams geparst', Array.isArray(ok1.data.workstreams) && ok1.data.workstreams.length > 0)
check('loadProject: issues ist Array', Array.isArray(ok1.issues))
const bad = loadProject('{')
check('loadProject: kaputtes YAML → FEHLER-Issue statt Crash',
  bad.issues.length === 1 && bad.issues[0].level === 'FEHLER' && bad.data.workstreams.length === 0)

// ── 2 · initData(state) — Live-Bindings ──
const d = await import(lib('data.js'))
d.initData(state)
check('initData: BASE aus projekt_yaml', d.BASE.meta.projekt === ok1.data.meta.projekt)
check('initData: NOW = parseDate(meta.today)', d.NOW instanceof Date)
check('initData: ALL_TASKS aus tasks-Store', d.ALL_TASKS.length === state.tasks.tasks.length && d.ALL_TASKS.length > 0)
check('initData: MS_META enthält jeden Milestone',
  d.BASE.workstreams.every(w => (w.milestones || []).every(m => m.id in d.MS_META)))
check('initData: TASK_STATS konsistent',
  d.TASK_STATS.total === d.ALL_TASKS.length && d.TASK_STATS.offen + d.TASK_STATS.erledigt === d.TASK_STATS.total)
check('initData: RADAR ist Array', Array.isArray(d.RADAR))
check('initData: Roh-Stores injiziert (Identität)',
  d.ENTS === state.entscheide && d.FR === state.fuehrungsrhythmus && d.PROTO === state.protokolle
  && d.AGENDAS === state.traktanden && d.REPORTS === state.reports_index && d.BRIEFINGS === state.briefings
  && d.TRAKT_DOCS === state.traktanden_docs && d.REMLOG === state.reminder_log && d.ZBSTORE === state.zielbild
  && d.DOMAIN_JSON === state.domain)
check('initData: tasksFor liest das Live-Binding', d.tasksFor(d.ALL_TASKS[0]?.ms_id).length > 0)

// ── 3 · domain.js / theme.js — Domänen-SSOT POST-init aus data.js ──
// Import bewusst erst NACH initData (oben) — exakt wie im Browser, wo App.jsx
// (und damit domain/theme) erst nach dem Bootstrap dynamisch geladen wird.
const dom = await import(lib('domain.js'))
check('domain: DOMAIN === injizierte domain.json', dom.DOMAIN === state.domain)
check('domain: ENT_FLOW aus der Nutzlast', JSON.stringify(dom.ENT_FLOW) === JSON.stringify(state.domain.entscheide.flow))
check('domain: statusLabel liest Nutzlast-Meta', dom.statusLabel('unknown') === state.domain.status.meta.unknown.label)
const th = await import(lib('theme.js'))
check('theme: STATUS_META-Schlüssel = domain.status.meta',
  JSON.stringify(Object.keys(th.STATUS_META).sort()) === JSON.stringify(Object.keys(state.domain.status.meta).sort()))
check('theme: ROLES aus der Nutzlast', th.ROLES === state.domain.rollen)

// ── Ergebnis ──
const total = pass + fails.length
console.log(`${pass}/${total} Prüfungen grün`)
if (fails.length) { console.log('FEHLSCHLÄGE:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
