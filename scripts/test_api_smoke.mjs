#!/usr/bin/env node
/**
 * test_api_smoke.mjs — Smoke-Netz für die 15 /api-Endpoints (Q1, 01.08.2026).
 *
 * WARUM: Unterhalb der Statuslogik (test_status_parity.py) und der Datenintegrität
 * (validate.py) gab es kein Netz. Refactorings an Plugin/Endpoints waren damit
 * blind. Diese Suite prüft die SICHERHEITS- und VALIDIERUNGS-Pfade — und ist
 * bewusst MUTATIONSFREI: kein Write, kein Mail-Entwurf, kein KI-Aufruf.
 *
 * Geprüft wird je Endpoint mindestens:
 *   · Guard (Content-Type-Zwang 415, fremder Origin 403)
 *   · Rollen-Gate (403 für lesende Rollen bzw. Nicht-CoS)
 *   · Pflichtfeld-Validierung (400)
 *   · fachliche Sperren (404 unbekannt, 409 task-getrieben, 400 Begründung fehlt)
 *   · read-only-Endpoints (200)
 *   · Auslieferungs-Sperre des Sensitiv-Stores (403 auf jedem Pfad)
 *
 * Aufruf:  node scripts/test_api_smoke.mjs [--base http://127.0.0.1:8621] [-v]
 * Exit:    0 = alle grün · 1 = mindestens ein Fehlschlag · 2 = Server nicht erreichbar
 */
import yaml from 'js-yaml'

const BASE = (() => {
  const i = process.argv.indexOf('--base')
  return i > -1 ? process.argv[i + 1] : 'http://127.0.0.1:8621'
})()
const VERBOSE = process.argv.includes('-v')
const ORIGIN = BASE.replace('127.0.0.1', 'localhost')

let pass = 0
const fails = []

async function call(path, { method = 'POST', body, headers = {}, raw = false } = {}) {
  const h = { Origin: ORIGIN, ...headers }
  if (!raw && method === 'POST') h['Content-Type'] = h['Content-Type'] ?? 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    ...(method === 'POST' ? { body: raw ? body : JSON.stringify(body ?? {}) } : {}),
  })
  let json = null
  try { json = await res.json() } catch { /* nicht immer JSON */ }
  return { status: res.status, json }
}

/** Ein Testfall: erwarteter HTTP-Status, optional Textfragment in der Fehlermeldung. */
async function expect(name, path, opts, wantStatus, wantErrFragment) {
  try {
    const { status, json } = await call(path, opts)
    const okStatus = Array.isArray(wantStatus) ? wantStatus.includes(status) : status === wantStatus
    const err = String(json?.error ?? '')
    const okErr = !wantErrFragment || err.toLowerCase().includes(wantErrFragment.toLowerCase())
    if (okStatus && okErr) {
      pass++
      if (VERBOSE) console.log(`  ✓ ${name} → ${status}`)
    } else {
      fails.push(`${name}: erwartet ${wantStatus}${wantErrFragment ? ` + «${wantErrFragment}»` : ''}, erhalten ${status}${err ? ` («${err.slice(0, 70)}»)` : ''}`)
    }
  } catch (e) {
    fails.push(`${name}: Aufruf fehlgeschlagen — ${e.message}`)
  }
}

const CoS = { role: 'CoS', me: 'Dieter Streuli' }
const LESEND = { role: 'Chairman', me: 'Dieter Streuli' }

/** Aktuellen Fortschritt eines Milestones aus der ausgelieferten SSOT lesen (read-only).
 *  Dient dazu, Schreib-Tests idempotent zu halten (No-Op-Wert senden). */
async function currentProgress(msId) {
  const res = await fetch(`${BASE}/src/data/projekt.yaml`, { headers: { Origin: ORIGIN } })
  const yaml = await res.text()
  const i = yaml.indexOf(`id: ${msId}\n`)
  if (i < 0) return 0
  const m = /^\s*progress:\s*(\d+)/m.exec(yaml.slice(i, i + 1200))
  return m ? Number(m[1]) : 0
}

async function main() {
  // Erreichbarkeit
  try {
    const r = await fetch(BASE + '/api/delta?days=1')
    if (!r.ok) throw new Error('HTTP ' + r.status)
  } catch (e) {
    console.error(`FEHLER: Tower unter ${BASE} nicht erreichbar (${e.message}).`)
    console.error('Server starten: launchctl start ch.streuli.chief.rubicon-tower  bzw.  npm run dev')
    process.exit(2)
  }

  console.log(`RUBICON API-Smoke gegen ${BASE}\n`)

  // ── 1 · Guard: Content-Type + Origin (stellvertretend an /api/sitzung) ──
  await expect('guard: ohne JSON-Content-Type → 415', '/api/sitzung',
    { raw: true, body: 'x=1', headers: { 'Content-Type': 'text/plain' } }, 415)
  await expect('guard: fremder Origin → 403', '/api/sitzung',
    { body: { ...CoS, meeting_id: 'gl-weekly', datum: '2026-08-01' }, headers: { Origin: 'http://evil.example' } }, 403, 'origin')

  // ── 2 · Sitzung ──
  await expect('sitzung: lesende Rolle → 403', '/api/sitzung', { body: { ...LESEND, meeting_id: 'gl-weekly', datum: '2026-08-01' } }, 403)
  await expect('sitzung: Pflichtfelder fehlen → 400', '/api/sitzung', { body: { ...CoS } }, 400, 'pflicht')

  // ── 3 · Milestone-Fortschritt (inkl. fachlicher Sperren) ──
  await expect('ms/progress: lesende Rolle → 403', '/api/ms/progress', { body: { ...LESEND, ms_id: 'WS2-16', progress: 50 } }, 403)
  await expect('ms/progress: ms_id fehlt → 400', '/api/ms/progress', { body: { ...CoS, progress: 50 } }, 400)
  await expect('ms/progress: weder progress noch slip → 400', '/api/ms/progress', { body: { ...CoS, ms_id: 'WS2-16' } }, 400)
  await expect('ms/progress: unbekannter Milestone → 404', '/api/ms/progress', { body: { ...CoS, ms_id: 'GIBT-ES-NICHT', progress: 50 } }, 404)
  // WICHTIG (Lehre aus dem Mutationstest 01.08.): Dieser Fall ist der EINZIGE, der bei
  // gebrochenem Gate schreiben würde. Deshalb wird der AKTUELLE Fortschritt gesendet —
  // der Server schreibt nur bei echter Änderung (`changes.length`), der Test bleibt also
  // auch dann mutationsfrei, wenn das 409-Gate ausfällt.
  const noop = await currentProgress('WS1-01')
  await expect('ms/progress: task-getriebener MS gesperrt → 409', '/api/ms/progress',
    { body: { ...CoS, ms_id: 'WS1-01', progress: noop } }, 409, 'verdient')

  // ── 4 · Handlungen ──
  await expect('task/upsert: nur CoS → 403', '/api/task/upsert', { body: { role: 'Owner', me: 'Andreas Fritthum', tasks: [] } }, 403)
  await expect('task/upsert: Task ohne id/text → 400', '/api/task/upsert', { body: { ...CoS, tasks: [{ ms_id: 'WS2-16' }] } }, 400)
  await expect('task/status: id/status fehlen → 400', '/api/task/status', { body: { ...CoS } }, 400)
  await expect('task/status: unbekannte id → 404', '/api/task/status', { body: { ...CoS, id: 'GIBT-ES-NICHT', status: 'erledigt' } }, 404)
  await expect('task/status: Owner fremde Handlung → 403', '/api/task/status',
    { body: { role: 'Owner', me: 'Niemand Sonst', id: 'WS2-16-T198', status: 'erledigt' } }, [403, 404])

  // ── 5 · Entscheids-Register (Governance-Kern) ──
  await expect('entscheid/upsert: lesende Rolle → 403', '/api/entscheid/upsert', { body: { ...LESEND, entscheide: [] } }, 403)
  await expect('entscheid/upsert: ohne key/titel → 400', '/api/entscheid/upsert', { body: { ...CoS, entscheide: [{ titel: '' }] } }, 400)
  await expect('entscheid/status: ungültiger Status → 400', '/api/entscheid/status', { body: { ...CoS, id: 'E-2026-001', status: 'quatsch' } }, 400)
  await expect('entscheid/status: unbekannte E-Nummer → 404', '/api/entscheid/status', { body: { ...CoS, id: 'E-9999-999', status: 'entschieden' } }, 404)

  // ── 6 · Reminder / Gemini / KI (Gates only — kein Entwurf, kein KI-Aufruf) ──
  await expect('reminder/draft: nur CoS → 403', '/api/reminder/draft', { body: { role: 'Owner', me: 'Andreas Fritthum', scope: 'alle' } }, 403)
  await expect('reminder/draft: scope fehlt → 400', '/api/reminder/draft', { body: { ...CoS } }, 400, 'scope')
  await expect('gemini/import: lesende Rolle → 403', '/api/gemini/import', { body: { ...LESEND, meeting_id: 'gl-weekly' } }, 403)
  await expect('gemini/import: meeting_id fehlt → 400', '/api/gemini/import', { body: { ...CoS } }, 400)
  await expect('task/suggest: nur CoS → 403', '/api/task/suggest', { body: { role: 'Owner', me: 'Andreas Fritthum', ms_id: 'WS2-16' } }, 403)
  await expect('task/suggest: ms_id fehlt → 400', '/api/task/suggest', { body: { ...CoS } }, 400)
  await expect('ask: leere Frage → 400', '/api/ask', { body: { frage: '   ' } }, 400)
  await expect('ask: Frage zu lang → 400', '/api/ask', { body: { frage: 'x'.repeat(501) } }, 400)

  // ── 7 · Reports & Protokoll-Export ──
  await expect('report/generate: level/period fehlen → 400', '/api/report/generate', { body: {} }, 400)
  await expect('report/comment: key fehlt → 400', '/api/report/comment', { body: { text: 'x' } }, 400)
  await expect('protokoll/export: id fehlt → 400', '/api/protokoll/export', { body: {} }, 400)

  // ── 8 · Read-only + Sensitiv-Sperre ──
  await expect('delta: GET liefert Daten → 200', '/api/delta?days=7', { method: 'GET' }, 200)
  await expect('protokoll/sensitiv: Loopback erlaubt → 200', '/api/protokoll/sensitiv', { method: 'GET' }, 200)
  await expect('sensitiv-Store: /src-Pfad gesperrt → 403', '/src/data/protokolle_sensitiv.json', { method: 'GET' }, 403)
  await expect('sensitiv-Store: /@fs-Pfad gesperrt → 403', '/@fs/tmp/protokolle_sensitiv.json', { method: 'GET' }, 403)

  // ── 9 · Runtime-State (Block A, 05.08.): /api/state = Client-Bootstrap-Nutzlast ──
  {
    const STATE_KEYS = ['projekt_yaml', 'tasks', 'domain', 'briefings', 'fuehrungsrhythmus',
      'traktanden_docs', 'briefings_docs', 'fuehrungsrhythmus_doc', 'protokolle', 'traktanden',
      'reports_index', 'entscheide', 'reminder_log', 'zielbild', 'server']
    const { status, json } = await call('/api/state', { method: 'GET' })
    const keys = Object.keys(json || {}).filter(k => k !== 'ok').sort()
    const keysOk = JSON.stringify(keys) === JSON.stringify([...STATE_KEYS].sort())
    let yamlOk = false
    try { yamlOk = !!yaml.load(json?.projekt_yaml)?.meta?.projekt } catch { yamlOk = false }
    const sensFrei = !('protokolle_sensitiv' in (json || {}))
      && !JSON.stringify(json ?? {}).includes('protokolle_sensitiv')
    const checks = [
      ['state: GET → 200 + ok:true', status === 200 && json?.ok === true],
      ['state: genau die 15 Client-Stores (nicht mehr, nicht weniger)', keysOk],
      ['state: projekt_yaml ist roher, js-yaml-parsebarer String', typeof json?.projekt_yaml === 'string' && yamlOk],
      ['state: protokolle_sensitiv in keiner Form enthalten', sensFrei],
    ]
    for (const [name, ok] of checks) {
      if (ok) { pass++; if (VERBOSE) console.log(`  ✓ ${name}`) }
      else fails.push(`${name}: fehlgeschlagen`)
    }
  }

  // ── Ergebnis ──
  const total = pass + fails.length
  console.log(`\n${pass}/${total} Prüfungen grün`)
  if (fails.length) {
    console.log('\nFEHLSCHLÄGE:')
    for (const f of fails) console.log('  ✗ ' + f)
    process.exit(1)
  }
  console.log('Alle Gates halten. (Mutationsfrei — es wurde nichts geschrieben.)')
}

main()
