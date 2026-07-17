// rubicon-api.js — Vite-Middleware: Write-Back der Sitzungs-Erfassung + Report-/
// Protokoll-Export. Läuft IM Tower-Server. Schreibt deterministisch in die eine
// Wahrheitsquelle projekt.yaml (Fortschritt/Blocker) + protokolle.json. Ampel bleibt
// abgeleitet (status.js) — wird hier NICHT gesetzt.
//
// SICHERHEIT (Audit #3/#4): lokaler Single-User-Betrieb, aber gehärtet —
//  · alle Writes atomar (temp + rename), kein truncated File bei Nebenläufigkeit
//  · Guard: Content-Type application/json erzwungen (blockt CSRF-simple-requests),
//    fremder Origin/Referer abgewiesen (blockt Cross-Site-Drive-by aus dem Browser)
//  · /api/sitzung: serverseitige Rollen-/Owner-Durchsetzung (Defense-in-Depth; role/me
//    sind clientseitig, ersetzen keine echte Auth, erzwingen aber das dok. Zugriffsmodell)
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import yaml from 'js-yaml'

const PY_BIN = process.env.RUBICON_PY || '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3'  // Portabilität: env-Override (MIGRATION.md)
const OK_ORIGINS = [
  'http://localhost:8621', 'http://127.0.0.1:8621',
  'https://macbook-air-von-dieter.tail018620.ts.net:8621', // Tailnet-Zugang (Andreas etc.)
  'https://macbook-air-von-dieter.tail018620.ts.net',      // portlose URL (serve 443, 14.07.)
]

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', c => { d += c })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}

let _wseq = 0
function writeAtomic(p, content) {
  const tmp = `${p}.tmp.${process.pid}.${_wseq++}`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, p)
}

export function rubiconApi() {
  const root = process.cwd()
  const yamlPath = path.join(root, 'src', 'data', 'projekt.yaml')
  const protoPath = path.join(root, 'src', 'data', 'protokolle.json')
  const tasksPath = path.join(root, 'src', 'data', 'tasks.json')

  const entsPath = path.join(root, 'src', 'data', 'entscheide.json')

  const dumpYaml = (doc) => yaml.dump(doc, { noRefs: true, lineWidth: 200, sortKeys: false, quotingType: "'", forceQuotes: false })
  const readTasks = () => (fs.existsSync(tasksPath) ? JSON.parse(fs.readFileSync(tasksPath, 'utf8')) : { tasks: [] })
  const readEnts = () => (fs.existsSync(entsPath) ? JSON.parse(fs.readFileSync(entsPath, 'utf8')) : { seq: 0, entscheide: [] })

  // ── Entscheids-Register (16.07., Säule 3 der Entscheidungsordnung INS-001 Anhang B) ──
  // Jeder Entscheid trägt eine dauerhafte Register-ID «E-<Jahr>-###» (monoton via seq,
  // NIE neu vergeben) + einen technischen De-Dup-key (analog Tasks: Gemini-Quelle bzw.
  // Protokoll-ID → Re-Import aktualisiert statt dupliziert). Status-Modell fix:
  // beantragt → entscheidungsreif → entschieden → kommuniziert → umgesetzt.
  // Revisionssicher: es gibt KEINEN Lösch-Endpoint — Entscheide bleiben im Register.
  const ENT_FLOW = ['beantragt', 'entscheidungsreif', 'entschieden', 'kommuniziert', 'umgesetzt']
  function mergeEntscheide(store, incoming, datum) {
    const byKey = new Map(store.entscheide.map(e => [e.key, e]))
    const ids = []
    for (const e of incoming) {
      if (!e.key || !(e.titel || e.entscheid)) continue
      const prev = byKey.get(e.key)
      let id = prev?.id
      if (!id) {
        store.seq = (store.seq || 0) + 1
        const year = (e.datum || datum || new Date().toISOString()).slice(0, 4)
        id = `E-${year}-${String(store.seq).padStart(3, '0')}`
      }
      byKey.set(e.key, {
        key: e.key, id,
        titel: e.titel ?? prev?.titel ?? (e.entscheid || '').slice(0, 90),
        typ: e.typ ?? prev?.typ ?? null,
        gremium: e.gremium ?? prev?.gremium ?? null,
        antragsteller: e.antragsteller ?? prev?.antragsteller ?? null,
        entscheid: e.entscheid ?? prev?.entscheid ?? null,
        begruendung: e.begruendung ?? prev?.begruendung ?? null,
        datengrundlage: e.datengrundlage ?? prev?.datengrundlage ?? null,
        datum: e.datum ?? prev?.datum ?? null,                 // Entscheid-Datum — nie geraten
        frist: e.frist ?? prev?.frist ?? null,
        // Lifecycle nur über /api/entscheid/status — Upsert erhält bestehenden Status
        status: prev ? prev.status : (ENT_FLOW.includes(e.status) ? e.status : 'beantragt'),
        kommunikation: prev?.kommunikation ?? null,             // Stempel {an, am} — nur via Status-Übergang
        tasks: e.tasks ?? prev?.tasks ?? [],                    // Verweis auf Umsetzungs-Handlungen (T-IDs)
        quelle: e.quelle ?? prev?.quelle ?? null,               // Protokoll-ID bei Sitzungs-Herkunft
        created_at: prev?.created_at ?? (datum || new Date().toISOString().slice(0, 10)),
      })
      ids.push(id)
    }
    store.entscheide = [...byKey.values()]
    return ids
  }

  // UPSERT von Handlungen in den Store — erhält NIE-überschreibbare Lifecycle-Felder
  // (status/erledigt_am/created_at) bestehender Tasks; Stammdaten (text/owner/due/ms_id)
  // werden aktualisiert. Gemeinsam genutzt von /api/task/upsert UND dem
  // Commitment-Spiegel in /api/sitzung (Schnitt 2, 13.07.).
  function mergeTasks(store, incoming, datum) {
    const byId = new Map(store.tasks.map(t => [t.id, t]))
    // Laufende Nummer (13.07., DRS): kurze, dauerhafte Referenz «T-###» je Handlung.
    // Monoton steigend, wird NIE neu vergeben (auch nicht nach Löschungen) — Upsert erhält sie.
    let nextNr = Math.max(0, ...store.tasks.map(t => t.nr || 0)) + 1
    const ids = []
    for (const t of incoming) {
      if (!t.id || !t.text) continue
      const prev = byId.get(t.id)
      byId.set(t.id, {
        id: t.id,
        nr: prev?.nr ?? nextNr++,
        ms_id: t.ms_id || null,                              // null = nicht milestone-gekoppelt
        text: t.text, owner: t.owner || null,
        due: t.due || null,                                  // nie geraten — null erlaubt
        status: prev ? prev.status : (t.status === 'erledigt' ? 'erledigt' : 'offen'),
        erledigt_am: prev ? prev.erledigt_am : null,
        source: t.source || 'zerlegung',
        origin: t.origin || null,
        created_at: prev ? prev.created_at : (datum || new Date().toISOString().slice(0, 10)),
      })
      ids.push(t.id)
    }
    store.tasks = [...byId.values()]
    return ids
  }

  // ── Task-Roll-up (13.07., «treibend»): für Milestones mit progress_source:'tasks'
  // wird progress DETERMINISTISCH aus den Handlungen berechnet (erledigt/gesamt,
  // half-up gerundet — identisch in validate.py gespiegelt). Der Prozentwert wird
  // damit VERDIENT, nicht getippt; die Ampel bleibt unverändert aus status.js
  // abgeleitet (Status ← Fortschritt ← erledigte Handlungen).
  function rollupMs(msId, store) {
    const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    let target = null
    for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === msId) target = m
    if (!target) return { rolled: false, reason: `Milestone ${msId} unbekannt` }
    if (target.progress_source !== 'tasks') return { rolled: false, reason: 'progress_source nicht «tasks» (manueller Modus)' }
    const ts = (store.tasks || []).filter(t => t.ms_id === msId)
    if (!ts.length) return { rolled: false, reason: 'keine Handlungen hinterlegt' }
    const done = ts.filter(t => t.status === 'erledigt').length
    const prog = Math.floor((100 * done) / ts.length + 0.5)   // half-up, parity mit validate.py
    const changed = target.progress !== prog
    if (changed) { target.progress = prog; writeAtomic(yamlPath, dumpYaml(doc)) }
    return { rolled: true, changed, progress: prog, done, total: ts.length }
  }

  // Mutations-Guard: nur JSON + eigener Origin. Sendet bei Ablehnung selbst die Antwort.
  function guard(req, res) {
    const send = (code, msg) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: msg })) }
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) { send(415, 'Content-Type application/json erforderlich'); return false }
    const origin = req.headers.origin || req.headers.referer || ''
    if (origin && !OK_ORIGINS.some(o => origin.startsWith(o))) { send(403, 'fremder Origin abgewiesen'); return false }
    return true
  }

  return {
    name: 'rubicon-api',
    configureServer(server) {
      // POST /api/sitzung — eine erfasste Sitzung speichern + Milestones aktualisieren
      server.middlewares.use('/api/sitzung', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.meeting_id || !body.datum) return json(400, { ok: false, error: 'meeting_id und datum sind Pflicht' })

          // Rollen-Gate (Audit #3): nur CoS/Owner dürfen schreiben
          const role = body.role, me = body.me
          if (role !== 'CoS' && role !== 'Owner') return json(403, { ok: false, error: `Rolle «${role || '?'}» darf nicht erfassen` })

          // 1) Protokoll-Datensatz anhängen (neueste zuerst) — kollisionssichere ID (Audit #22)
          const store = JSON.parse(fs.readFileSync(protoPath, 'utf8'))
          const sameDay = store.protokolle.filter(p => p.meeting_id === body.meeting_id && p.datum === body.datum).length
          const id = `P-${body.datum}-${body.meeting_id}-${sameDay + 1}`
          const rec = {
            id,
            meeting_id: body.meeting_id,
            meeting_name: body.meeting_name || '',
            datum: body.datum,
            vorsitz: body.vorsitz || '',
            erfasst_von: body.erfasst_von || '',
            // Quellenbindung: nur bei importierten Sitzungen (z.B. Gemini-Meet-Notiz) gesetzt —
            // manuelle Erfassung bleibt schlank. Beleg-Link fürs Protokoll (Datenehrlichkeit).
            ...(body.source ? { source: body.source, gemini_doc_id: body.gemini_doc_id || null, gemini_doc_url: body.gemini_doc_url || null } : {}),
            eintraege: Array.isArray(body.eintraege) ? body.eintraege : [],
          }
          store.protokolle.unshift(rec)
          writeAtomic(protoPath, JSON.stringify(store, null, 2))

          // 2) projekt.yaml: Fortschritt/Blocker anwenden — Owner nur eigene MS (Audit #3)
          const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
          const idx = {}
          for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) idx[m.id] = { m, wsOwner: ws.owner }
          const applied = [], skipped = []
          const mayEdit = (msId) => {
            if (role === 'CoS') return true
            const rec2 = idx[msId]; return !!rec2 && (rec2.m.owner === me || rec2.wsOwner === me)
          }
          for (const e of rec.eintraege) {
            if (e.typ === 'fortschritt' && e.ms_id && idx[e.ms_id] && typeof e.wert === 'number') {
              if (!mayEdit(e.ms_id)) { skipped.push(`${e.ms_id} (nicht Owner)`); continue }
              idx[e.ms_id].m.progress = Math.max(0, Math.min(100, e.wert)); applied.push(`${e.ms_id} → ${Math.max(0, Math.min(100, e.wert))}%`)
            }
            if (e.typ === 'blocker' && e.ms_id && idx[e.ms_id] && typeof e.slip === 'number' && e.slip > 0) {
              if (!mayEdit(e.ms_id)) { skipped.push(`${e.ms_id} (nicht Owner)`); continue }
              idx[e.ms_id].m.reported_slip_days = e.slip; applied.push(`${e.ms_id} +${e.slip} T Verzug`)
            }
          }
          // projekt.yaml NUR schreiben, wenn wirklich ein Milestone geändert wurde —
          // sonst bleibt die SSOT bytegleich stabil (z.B. Gemini-Importe ohne Prozentwert
          // erzeugen nur Commitments/Notizen und dürfen die Wahrheitsquelle nicht anfassen).
          if (applied.length) {
            writeAtomic(yamlPath, yaml.dump(doc, { noRefs: true, lineWidth: 200, sortKeys: false, quotingType: "'", forceQuotes: false }))
          }

          // 3) Commitment→Handlung-Spiegel (Schnitt 2, 13.07.): jedes Commitment wird
          // automatisch als Task gespiegelt — Lifecycle (offen→erledigt), optionale
          // Milestone-Kopplung (e.ms_id → treibt bei progress_source:'tasks' den
          // Fortschritt). ID-Stabilität = De-Dup: Gemini-Importe über das Quell-Doc
          // (Re-Import aktualisiert statt dupliziert), manuelle über die Protokoll-ID.
          // Index = Position im eintraege-Array (bleibt bei Re-Import identisch).
          let mirrored = []
          const commitments = rec.eintraege.map((e2, i) => ({ e: e2, i })).filter(x => x.e.typ === 'commitment' && (x.e.text || '').trim())
          if (commitments.length) {
            const tstore = readTasks()
            const incoming = commitments.map(({ e: e2, i }) => ({
              id: body.gemini_doc_id ? `G-${body.gemini_doc_id}-C${i}` : `${id}-C${i}`,
              ms_id: e2.ms_id || null,
              text: e2.text, owner: e2.owner || null, due: e2.bis || null,
              source: body.source === 'gemini' ? 'gemini' : 'sitzung',
              origin: id,
            }))
            mirrored = mergeTasks(tstore, incoming, body.datum)
            writeAtomic(tasksPath, JSON.stringify(tstore, null, 2))
            for (const msId of [...new Set(incoming.map(t => t.ms_id).filter(Boolean))]) rollupMs(msId, tstore)
          }

          // 4) Entscheid→Register-Spiegel (16.07., Säule 3): jeder erfasste Entscheid
          // landet automatisch im Entscheids-Register (entscheide.json) mit dauerhafter
          // E-Nummer. De-Dup analog Commitments: Gemini über das Quell-Doc, manuell über
          // die Protokoll-ID. Status: «getroffen» → entschieden · «offen» → beantragt.
          let registered = []
          const entsIn = rec.eintraege.map((e2, i) => ({ e: e2, i })).filter(x => x.e.typ === 'entscheid' && (x.e.text || '').trim())
          if (entsIn.length) {
            const estore = readEnts()
            registered = mergeEntscheide(estore, entsIn.map(({ e: e2, i }) => ({
              key: body.gemini_doc_id ? `G-${body.gemini_doc_id}-E${i}` : `${id}-E${i}`,
              titel: e2.text.slice(0, 90),
              entscheid: e2.text,
              gremium: e2.ebene || null,
              antragsteller: body.erfasst_von || body.vorsitz || null,
              datum: e2.status === 'getroffen' ? body.datum : null,
              status: e2.status === 'getroffen' ? 'entschieden' : 'beantragt',
              quelle: id,
            })), body.datum)
            writeAtomic(entsPath, JSON.stringify(estore, null, 2))
          }

          return json(200, { ok: true, id, applied, skipped, mirrored, registered })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/task/upsert — Handlungen (Tasks) anlegen/aktualisieren (nur CoS).
      // Optional body.activate_ms: schaltet den Milestone auf progress_source:'tasks'
      // («treibend») — bewusst expliziter Akt NACH menschlicher Freigabe der Zerlegung.
      server.middlewares.use('/api/task/upsert', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (body.role !== 'CoS') return json(403, { ok: false, error: 'nur CoS darf Handlungen anlegen/ändern' })
          const incoming = Array.isArray(body.tasks) ? body.tasks : []
          for (const t of incoming) {
            if (!t.id || !t.text) return json(400, { ok: false, error: 'Task braucht id und text (ms_id optional = ungekoppelt)' })
          }
          const store = readTasks()
          const upserted = mergeTasks(store, incoming, body.datum)
          writeAtomic(tasksPath, JSON.stringify(store, null, 2))
          // Aktivierung + Roll-up (in dieser Reihenfolge: erst Flag, dann rechnen)
          let activation = null, roll = null
          if (body.activate_ms) {
            const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
            let target = null
            for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === body.activate_ms) target = m
            if (!target) return json(400, { ok: false, error: `activate_ms: Milestone ${body.activate_ms} unbekannt` })
            if (target.progress_source !== 'tasks') { target.progress_source = 'tasks'; writeAtomic(yamlPath, dumpYaml(doc)) }
            activation = body.activate_ms
          }
          // Roll-up für alle berührten MS — auch bei reiner Aktivierung ohne neue Tasks
          const affected = [...new Set([...incoming.map(t => t.ms_id).filter(Boolean), ...(body.activate_ms ? [body.activate_ms] : [])])]
          for (const msId of affected) { const r = rollupMs(msId, store); if (r.rolled) roll = { ms_id: msId, ...r } }
          return json(200, { ok: true, upserted, activation, rollup: roll })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/task/status — Handlung abhaken/wiedereröffnen {id, status} → Roll-up.
      // CoS immer; Owner nur eigene Handlungen (analog Audit #3 in /api/sitzung).
      server.middlewares.use('/api/task/status', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.id || !['offen', 'erledigt'].includes(body.status)) return json(400, { ok: false, error: 'id und status (offen|erledigt) sind Pflicht' })
          const role = body.role, me = body.me
          if (role !== 'CoS' && role !== 'Owner') return json(403, { ok: false, error: `Rolle «${role || '?'}» darf nicht abhaken` })
          const store = readTasks()
          const t = store.tasks.find(x => x.id === body.id)
          if (!t) return json(404, { ok: false, error: `Task ${body.id} nicht gefunden` })
          if (role === 'Owner' && t.owner !== me) return json(403, { ok: false, error: 'Owner darf nur eigene Handlungen abhaken' })
          t.status = body.status
          t.erledigt_am = body.status === 'erledigt' ? (body.datum || new Date().toISOString().slice(0, 10)) : null
          writeAtomic(tasksPath, JSON.stringify(store, null, 2))
          const roll = rollupMs(t.ms_id, store)
          // Input-Kopplung (13.07., DRS «auto-geliefert»): Inputs mit liefer_tasks werden
          // ABGELEITET — geliefert, sobald ALLE gekoppelten Handlungen erledigt sind;
          // Wiederöffnen einer Handlung setzt den Input deterministisch zurück auf offen.
          let inputSync = null
          const doc2 = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
          const byTaskId = new Map(store.tasks.map(x => [x.id, x]))
          let changed2 = false
          for (const inp of doc2.inputs || []) {
            const lt = inp.liefer_tasks
            if (!Array.isArray(lt) || !lt.includes(t.id)) continue
            const soll = lt.every(id2 => byTaskId.get(id2)?.status === 'erledigt') ? 'geliefert' : 'offen'
            if (inp.status !== soll) { inp.status = soll; changed2 = true; inputSync = { input: inp.id, status: soll } }
          }
          if (changed2) writeAtomic(yamlPath, dumpYaml(doc2))
          return json(200, { ok: true, task: t, rollup: roll, input_sync: inputSync })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/entscheid/upsert — Entscheid im Register anlegen/aktualisieren.
      // CoS immer; Owner darf als Antragsteller eigene Entscheide erfassen (analog Audit #3).
      // Lifecycle (status/kommunikation) wird hier NICHT verändert — nur via /api/entscheid/status.
      server.middlewares.use('/api/entscheid/upsert', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          const role = body.role, me = body.me
          if (role !== 'CoS' && role !== 'Owner') return json(403, { ok: false, error: `Rolle «${role || '?'}» darf keine Entscheide erfassen` })
          const incoming = Array.isArray(body.entscheide) ? body.entscheide : []
          for (const e of incoming) {
            if (!e.key || !(e.titel || e.entscheid)) return json(400, { ok: false, error: 'Entscheid braucht key und titel/entscheid' })
            if (role === 'Owner') e.antragsteller = me   // Owner erfasst nur im eigenen Namen
          }
          const store = readEnts()
          const upserted = mergeEntscheide(store, incoming, body.datum)
          writeAtomic(entsPath, JSON.stringify(store, null, 2))
          return json(200, { ok: true, upserted })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/entscheid/status — Status-Übergang im 5-Stufen-Modell {id, status, an?}.
      // CoS immer; Owner nur eigene (antragsteller === me). Übergang zu «kommuniziert»
      // setzt den Kommunikations-Stempel {an, am}; «entschieden» stempelt das Entscheid-Datum.
      server.middlewares.use('/api/entscheid/status', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.id || !ENT_FLOW.includes(body.status)) return json(400, { ok: false, error: `id und status (${ENT_FLOW.join('|')}) sind Pflicht` })
          const role = body.role, me = body.me
          if (role !== 'CoS' && role !== 'Owner') return json(403, { ok: false, error: `Rolle «${role || '?'}» darf den Status nicht ändern` })
          const store = readEnts()
          const e = store.entscheide.find(x => x.id === body.id)
          if (!e) return json(404, { ok: false, error: `Entscheid ${body.id} nicht gefunden` })
          if (role === 'Owner' && e.antragsteller !== me) return json(403, { ok: false, error: 'Owner darf nur eigene Entscheide fortschreiben' })
          const today = body.datum || new Date().toISOString().slice(0, 10)
          e.status = body.status
          if (body.status === 'entschieden' && !e.datum) e.datum = today
          if (body.status === 'kommuniziert') e.kommunikation = { an: body.an || null, am: today }
          writeAtomic(entsPath, JSON.stringify(store, null, 2))
          // Übergang «kommuniziert» ⇒ Kommunikations-Paket (16.07., DRS): Entscheid-PDF
          // (Registerauszug) + Gmail-ENTWURF mit PDF im Anhang — NIE Versand (DRS sendet).
          // Non-fatal: der Status-Übergang gilt auch, wenn der Paket-Build scheitert.
          if (body.status === 'kommuniziert') {
            const args = [path.join(root, 'scripts', 'gen_entscheid_mail.py'), e.id]
            if (body.an) args.push('--an', body.an)
            execFile(PY_BIN, args, { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
              const last = (stdout || '').trim().split('\n').pop()
              let mail = null
              try { mail = JSON.parse(last) } catch { mail = { ok: false, error: (stderr || String(err || '')).slice(-200) } }
              return json(200, { ok: true, entscheid: e, mail })
            })
            return
          }
          return json(200, { ok: true, entscheid: e })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/protokoll/export — Protokoll als PDF + Google Doc rendern (shellt Python)
      server.middlewares.use('/api/protokoll/export', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.id) return json(400, { ok: false, error: 'id fehlt' })
          execFile(PY_BIN, [path.join(root, 'scripts', 'gen_protokoll.py'), body.id], { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/report/generate — verdichteten Report rendern (shellt gen_report.py)
      server.middlewares.use('/api/report/generate', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.level || !body.period) return json(400, { ok: false, error: 'level und period sind Pflicht' })
          execFile(PY_BIN, [path.join(root, 'scripts', 'gen_report.py'), body.level, body.period], { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })

      // POST /api/report/comment — optionalen Freitext-Kommentar speichern {key, text}
      server.middlewares.use('/api/report/comment', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        if (!guard(req, res)) return
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          if (!body.key) return json(400, { ok: false, error: 'key fehlt' })
          const p = path.join(root, 'src', 'data', 'report_comments.json')
          const store = JSON.parse(fs.readFileSync(p, 'utf8'))
          if (body.text) store[body.key] = body.text; else delete store[body.key]
          writeAtomic(p, JSON.stringify(store, null, 2))
          return json(200, { ok: true })
        } catch (err) {
          return json(500, { ok: false, error: String(err && err.message || err) })
        }
      })
    },
  }
}
