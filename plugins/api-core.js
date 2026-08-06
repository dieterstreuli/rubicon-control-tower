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
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import yaml from 'js-yaml'
import { can, requireCan } from '../src/lib/permissions.js'   // Q4: EINE Rechte-Matrix für UI + Server

const PY_BIN = process.env.RUBICON_PY || '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3'  // Portabilität: env-Override (MIGRATION.md)
const CLAUDE_BIN = process.env.RUBICON_CLAUDE || '/Users/dieterstreuli/.local/bin/claude'  // K4/K7: KI-Aufrufe (headless, Sonnet)
// Server-Modus = DWD-Env gesetzt (identisch zu gen_report._is_server): steuert im UI,
// ob Report-Links auf die Server-Google-Docs (server_doc_url) oder auf Dieters lokale
// doc_url zeigen. /api/state reicht das Flag an die SPA (src/lib/data.js SERVER).
const IS_SERVER = !!(process.env.RUBICON_WORKSPACE_SA && process.env.RUBICON_IMPERSONATE_SUBJECT)

// K4/K7 (01.08.): headless-Claude-Aufruf — Prompt via stdin (Grössen-sicher),
// Sonnet, hartes Timeout. Reine Text-Antwort; JSON extrahiert der Aufrufer.
// Auth-Härtung 01.08.: «OAuth session expired» entsteht, wenn parallel eine
// interaktive Claude-Session das Token rotiert — einmalige Wiederholung nach
// kurzer Pause behebt das fast immer (frisches Token liegt dann im Keychain).
function runClaudeOnce(prompt, cb, timeoutMs) {
  let done = false
  const fin = (err, out, errS) => { if (!done) { done = true; cb(err, out, errS) } }
  const p = spawn(CLAUDE_BIN, ['-p', '--model', 'claude-sonnet-4-6'],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: process.env.HOME || '/Users/dieterstreuli' } })
  let out = '', errS = ''
  const to = setTimeout(() => { p.kill('SIGKILL'); fin(new Error(`Timeout nach ${timeoutMs / 1000}s`), out, errS) }, timeoutMs)
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { errS += d })
  p.on('error', e2 => { clearTimeout(to); fin(e2, out, errS) })
  p.on('close', code => { clearTimeout(to); fin(code === 0 ? null : new Error((errS || `exit ${code}`).slice(-300)), out, errS) })
  p.stdin.write(prompt); p.stdin.end()
}

function runClaude(prompt, cb, timeoutMs = 240000) {
  // ACHTUNG: der Auth-Fehler kommt teils mit Exit 0 über STDOUT — deshalb Text
  // in stdout UND stderr prüfen, sonst landet er als «Antwort» im UI (Fund 01.08.).
  const AUTH_RE = /oauth session expired|failed to authenticate|could not be refreshed|please run \/login/i
  runClaudeOnce(prompt, (err, out, errS) => {
    if (AUTH_RE.test((out || '') + (errS || '') + String(err?.message || ''))) {
      // 1× Retry (deckt Token-Rotations-Rennen ab), dann klare Handlungsanweisung
      return setTimeout(() => runClaudeOnce(prompt, (e2, o2, s2) => {
        if (AUTH_RE.test((o2 || '') + (s2 || '') + String(e2?.message || '')))
          return cb(new Error('Claude-Anmeldung auf diesem Mac abgelaufen (betrifft ALLE Headless-Jobs inkl. Morning-Scan). Fix: Terminal öffnen → `claude` → `/login` durchlaufen — danach hier einfach erneut klicken.'), '')
        cb(e2, o2)
      }, timeoutMs), 3000)
    }
    cb(err, out)
  }, timeoutMs)
}

// erstes JSON-Objekt/-Array aus einer Modell-Antwort ziehen (Code-Fences tolerant)
function extractJson(s) {
  const t = (s || '').replace(/```json|```/g, '')
  for (const re of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) {
    const m = t.match(re)
    if (m) { try { return JSON.parse(m[0]) } catch { /* weiter */ } }
  }
  return null
}
const OK_ORIGINS = [
  'http://localhost:8621', 'http://127.0.0.1:8621',
  'https://macbook-air-von-dieter.tail018620.ts.net:8621', // Tailnet-Zugang (Andreas etc.)
  'https://macbook-air-von-dieter.tail018620.ts.net',      // portlose URL (serve 443, 14.07.)
  'https://rubicon.axs.aero',                              // Gateway-Deployment hinter Google IAP (01.08.)
  // R3 (01.08.): zusätzliche Origins per Env — nötig, sobald der App-Server unter
  // einem anderen Host/Port läuft (Cloud Run, Test-Instanz). Komma-getrennt.
  ...(process.env.RUBICON_OK_ORIGINS || process.env.RUBICON_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
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

export function createApi(rootDir) {
  // Root aus dem Modulpfad, NICHT process.cwd() — cwd hängt vom Startort ab
  // (launchd vs. npx vs. systemd) und zeigte im Preview-Fall auf das falsche
  // Verzeichnis (Bug 17.07.). Der Plugin-Ordner liegt fix unter <root>/plugins.
  const root = rootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  const dumpYaml = (doc) => yaml.dump(doc, { noRefs: true, lineWidth: 200, sortKeys: false, quotingType: "'", forceQuotes: false })

  // ── Datenzugriffs-Schicht (R2, 01.08.2026) ────────────────────────────────
  // Vorher lagen 13 direkte fs-Zugriffe verstreut in den Endpoints; ein Wechsel
  // des Speichers (JSON → DB) oder ein echter App-Server hätte jede einzelne
  // Stelle getroffen. Jetzt gibt es EINEN Ort für Pfade, Lesen, Schreiben und
  // Atomik — Endpoints kennen nur noch db.<name>.read()/write().
  // A3 (Block A, 05.08.2026): Laufzeit-Datenordner per Env entkoppelbar — gebraucht
  // in Block C für den neutralen Mount-Pfad. Ohne Env unverändert src/data; in
  // Block A KEIN Prod-Verhaltenswechsel (Mount bleibt /app/src/data).
  const DATA = process.env.RUBICON_DATA_DIR || path.join(root, 'src', 'data')
  const jsonStore = (file, leer) => {
    const f = path.join(DATA, file)
    return {
      path: f,
      read: () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : structuredClone(leer)),
      write: (obj) => writeAtomic(f, JSON.stringify(obj, null, 2)),
    }
  }
  const db = {
    projekt: {
      path: path.join(DATA, 'projekt.yaml'),
      read: () => yaml.load(fs.readFileSync(path.join(DATA, 'projekt.yaml'), 'utf8')),
      write: (doc) => writeAtomic(path.join(DATA, 'projekt.yaml'), dumpYaml(doc)),
    },
    tasks: jsonStore('tasks.json', { tasks: [] }),
    entscheide: jsonStore('entscheide.json', { seq: 0, entscheide: [] }),
    protokolle: jsonStore('protokolle.json', { protokolle: [] }),
    sensitiv: jsonStore('protokolle_sensitiv.json', { protokolle: [] }),
    kommentare: jsonStore('report_comments.json', {}),
    briefings: jsonStore('briefings.json', {}),
    domain: jsonStore('domain.json', {}),
    zielbild: jsonStore('zielbild.json', { zielbild: [] }),
    // Nur-Lese-Stores für GET /api/state (Block A, 05.08.): gleiche jsonStore-Mechanik,
    // Leer-Defaults = das, was der Client heute bei Leerstand erwartet.
    fuehrungsrhythmus: jsonStore('fuehrungsrhythmus.json', { gruppen: [] }),
    traktandenDocs: jsonStore('traktanden_docs.json', {}),
    traktanden: jsonStore('traktanden.json', { agendas: [] }),
    reportsIndex: jsonStore('reports_index.json', { reports: [] }),
    reminderLog: jsonStore('reminder_log.json', { reminders: [] }),
  }
  // ── Entscheids-Register (16.07., Säule 3 der Entscheidungsordnung INS-001 Anhang B) ──
  // Jeder Entscheid trägt eine dauerhafte Register-ID «E-<Jahr>-###» (monoton via seq,
  // NIE neu vergeben) + einen technischen De-Dup-key (analog Tasks: Gemini-Quelle bzw.
  // Protokoll-ID → Re-Import aktualisiert statt dupliziert). Status-Modell fix:
  // beantragt → entscheidungsreif → entschieden → kommuniziert → umgesetzt.
  // Revisionssicher: es gibt KEINEN Lösch-Endpoint — Entscheide bleiben im Register.
  // Domänen-SSOT (Q2, 01.08.): identische Liste wie im UI — src/data/domain.json
  const DOMAIN = db.domain.read()
  const ENT_FLOW = DOMAIN.entscheide.flow
  const ENT_BEGRUENDUNG_AB = DOMAIN.entscheide.begruendung_pflicht_ab
  // Evidenz-Format-Gate (Härtung 04.08., «Datengehirn»): gültige Evidenz/Artefakte müssen
  // einen Drive-/Docs-Link ODER eine Register-Referenz enthalten — Muster-SSOT domain.json.
  const ZB_FMT = (DOMAIN.zielbild || {}).evidenz_formate || {}
  const evidenzGueltig = (s) => {
    const txt = String(s || '')
    return Boolean((ZB_FMT.url && new RegExp(ZB_FMT.url).test(txt)) ||
                   (ZB_FMT.register && new RegExp(ZB_FMT.register).test(txt)))
  }
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
        anhaenge: e.anhaenge ?? prev?.anhaenge ?? [],           // Drive-Links/IDs — gehen bei «kommuniziert» als PDF mit (DRS 01.08.)
        programm: e.programm ?? prev?.programm ?? null,         // null = konzernweit (z.B. Governance)
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
  function rollupMs(msId, tstore) {
    const doc = db.projekt.read()
    let target = null
    for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === msId) target = m
    if (!target) return { rolled: false, reason: `Milestone ${msId} unbekannt` }
    if (target.progress_source !== 'tasks') return { rolled: false, reason: 'progress_source nicht «tasks» (manueller Modus)' }
    const ts = (tstore.tasks || []).filter(t => t.ms_id === msId)
    if (!ts.length) return { rolled: false, reason: 'keine Handlungen hinterlegt' }
    const done = ts.filter(t => t.status === 'erledigt').length
    const prog = Math.floor((100 * done) / ts.length + 0.5)   // half-up, parity mit validate.py
    const changed = target.progress !== prog
    if (changed) { target.progress = prog; db.projekt.write(doc) }
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

  // ── Endpoint-Factory (Q3, 01.08.2026) ──────────────────────────────────────
  // Vorher stand in JEDEM der 15 Endpoints derselbe Vorspann: Methoden-Check,
  // json-Helper, guard(), readBody+JSON.parse, try/catch. Querschnitts-Änderungen
  // (Audit-Log, Auth-Header für IAP) hätten 15 Einzel-Edits gebraucht — jetzt eine.
  //
  // handler({ body, req, res, json, fail }):
  //   · json(code, obj) antwortet selbst (bestehendes Muster, unverändert)
  //   · fail(code, msg)  wirft einen Fehler mit HTTP-Status (kurze Validierungen)
  //   · ein zurückgegebenes Objekt wird als 200 gesendet; undefined = hat selbst geantwortet
  const ROUTES = new Map()
  const ep = (routePath, opts, handler) => ROUTES.set(routePath, { method: opts.method || 'POST', opts, handler })

  // ── Sensitiv-Filter (16.07., Plattform-Roadmap #6): HR-/Personal-sensible Protokolle
  // leben in einem GETRENNTEN Store (protokolle_sensitiv.json), der NIE über den
  // Server ausgeliefert wird — weder als Datei noch im Vite-Bundle (kein Import im UI).
  // Einsehbar ausschliesslich via Loopback-gated API (= nur direkt auf dem Gerät, nicht
  // via Tailnet/Netz). Das ist ECHTE Trennung, nicht clientseitiges Ausblenden.
  // ACHTUNG Proxy-Falle (Härtetest 17.07.): Tailscale-Serve proxied Tailnet-Traffic
  // von 127.0.0.1 — die remoteAddress allein reicht NICHT. Deshalb zusätzlich:
  // Host-Header muss localhost/127.0.0.1 sein UND keine Forwarded-Header vorhanden
  // (Tailscale/Reverse-Proxies setzen Host=ts.net-Name bzw. X-Forwarded-*).
  const isLoopback = (req) => {
    const a = req.socket?.remoteAddress || ''
    const ipOk = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
    const host = (req.headers.host || '').split(':')[0]
    const hostOk = host === 'localhost' || host === '127.0.0.1'
    const fwd = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['forwarded'])
    return ipOk && hostOk && !fwd
  }

      // GET /api/protokoll/sensitiv — Liste der sensitiven Protokolle, NUR Loopback
      // (DRS direkt am Gerät; Tailnet-/Netz-Clients erhalten 403).
      ep('/api/protokoll/sensitiv', { method: 'GET', guard: false }, ({ req, json }) => {
        if (!isLoopback(req)) return json(403, { ok: false, error: 'nur lokal einsehbar' })
        return json(200, { ok: true, protokolle: db.sensitiv.read().protokolle })
      })
      // GET /api/state — Runtime-Nutzlast des Client-Bootstraps (Block A, 05.08.2026).
      // Liest zur REQUEST-Zeit aus DATA (= GCS-Volume in Prod): Server-Writes sind
      // damit nach einem Client-Reload sichtbar. projekt_yaml bewusst ROH — loader.js
      // parst selbst (js-yaml) und erzeugt den Lücken-/Fehler-Report.
      // NIEMALS protokolle_sensitiv (bleibt loopback-only via /api/protokoll/sensitiv).
      // guard:false wie /api/delta: same-origin-GET hinter IAP; IAP ist das Zugangstor.
      // Naht für Block B: hier wird die Nutzlast später rollen-gescopt.
      ep('/api/state', { method: 'GET', guard: false }, ({ json, res }) => {
        res.setHeader('Cache-Control', 'no-store')
        return json(200, {
          ok: true,
          server: IS_SERVER,
          projekt_yaml: fs.existsSync(db.projekt.path) ? fs.readFileSync(db.projekt.path, 'utf8') : '',
          tasks: db.tasks.read(),
          domain: db.domain.read(),
          briefings: db.briefings.read(),
          fuehrungsrhythmus: db.fuehrungsrhythmus.read(),
          traktanden_docs: db.traktandenDocs.read(),
          protokolle: db.protokolle.read(),
          traktanden: db.traktanden.read(),
          reports_index: db.reportsIndex.read(),
          entscheide: db.entscheide.read(),
          reminder_log: db.reminderLog.read(),
          zielbild: db.zielbild.read(),
        })
      })
      // POST /api/sitzung — eine erfasste Sitzung speichern + Milestones aktualisieren
      ep('/api/sitzung', {}, async ({ body, json, fail }) => {
          if (!body.meeting_id || !body.datum) return json(400, { ok: false, error: 'meeting_id und datum sind Pflicht' })

          // Rollen-Gate (Audit #3): nur CoS/Owner dürfen schreiben
          const role = body.role, me = body.me
          requireCan(fail, role, me, 'sitzung.erfassen')

          // 1) Protokoll-Datensatz anhängen (neueste zuerst) — kollisionssichere ID (Audit #22).
          // Sensitiv-Filter (#6): sensitive Sitzungen landen im GETRENNTEN, nie
          // ausgelieferten Store; ID-Zählung über BEIDE Stores (kollisionssicher).
          const sensitiv = body.sensitiv === true
          const pstore = db.protokolle.read()
          const sstore = db.sensitiv.read()
          const sameDay = [...pstore.protokolle, ...sstore.protokolle]
            .filter(p => p.meeting_id === body.meeting_id && p.datum === body.datum).length
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
            ...(sensitiv ? { sensitiv: true } : {}),
            eintraege: Array.isArray(body.eintraege) ? body.eintraege : [],
          }
          if (sensitiv) {
            sstore.protokolle.unshift(rec)
            db.sensitiv.write(sstore)
          } else {
            pstore.protokolle.unshift(rec)
            db.protokolle.write(pstore)
          }

          // 2) projekt.yaml: Fortschritt/Blocker anwenden — Owner nur eigene MS (Audit #3)
          const doc = db.projekt.read()
          const idx = {}
          for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) idx[m.id] = { m, wsOwner: ws.owner }
          const applied = [], skipped = []
          const mayEdit = (msId) => {
            const rec2 = idx[msId]
            return !!rec2 && can(role, me, 'ms.melden', { ...rec2.m, _wsOwner: rec2.wsOwner })
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
            db.projekt.write(doc)
          }

          // 3) Commitment→Handlung-Spiegel (Schnitt 2, 13.07.): jedes Commitment wird
          // automatisch als Task gespiegelt — Lifecycle (offen→erledigt), optionale
          // Milestone-Kopplung (e.ms_id → treibt bei progress_source:'tasks' den
          // Fortschritt). ID-Stabilität = De-Dup: Gemini-Importe über das Quell-Doc
          // (Re-Import aktualisiert statt dupliziert), manuelle über die Protokoll-ID.
          // Index = Position im eintraege-Array (bleibt bei Re-Import identisch).
          // Sensitiv (#6): KEINE Spiegel in geteilte Stores (tasks.json/entscheide.json
          // sind für alle sichtbar) — Wortlaute sensibler Sitzungen bleiben im
          // Sensitiv-Store. Nur Fortschritt/Blocker (aggregierte Zahlen) wirken oben.
          let mirrored = []
          const commitments = sensitiv ? [] : rec.eintraege.map((e2, i) => ({ e: e2, i })).filter(x => x.e.typ === 'commitment' && (x.e.text || '').trim())
          if (commitments.length) {
            const tstore = db.tasks.read()
            const incoming = commitments.map(({ e: e2, i }) => ({
              id: body.gemini_doc_id ? `G-${body.gemini_doc_id}-C${i}` : `${id}-C${i}`,
              ms_id: e2.ms_id || null,
              text: e2.text, owner: e2.owner || null, due: e2.bis || null,
              source: body.source === 'gemini' ? 'gemini' : 'sitzung',
              origin: id,
            }))
            mirrored = mergeTasks(tstore, incoming, body.datum)
            db.tasks.write(tstore)
            for (const msId of [...new Set(incoming.map(t => t.ms_id).filter(Boolean))]) rollupMs(msId, tstore)
          }

          // 4) Entscheid→Register-Spiegel (16.07., Säule 3): jeder erfasste Entscheid
          // landet automatisch im Entscheids-Register (entscheide.json) mit dauerhafter
          // E-Nummer. De-Dup analog Commitments: Gemini über das Quell-Doc, manuell über
          // die Protokoll-ID. Status: «getroffen» → entschieden · «offen» → beantragt.
          let registered = []
          const entsIn = sensitiv ? [] : rec.eintraege.map((e2, i) => ({ e: e2, i })).filter(x => x.e.typ === 'entscheid' && (x.e.text || '').trim())
          if (entsIn.length) {
            const estore = db.entscheide.read()
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
            db.entscheide.write(estore)
          }

          return json(200, { ok: true, id, applied, skipped, mirrored, registered, sensitiv,
            ...(sensitiv ? { hint: 'Sensitiv: Protokoll nur lokal einsehbar; keine Task-/Register-Spiegel' } : {}) })
      })

      // POST /api/ms/progress — Fortschritt/Verzug DIREKT melden (Modal-Speichern,
      // DRS 01.08.). Gleiche Gates wie /api/sitzung: CoS alles, Owner nur eigene
      // (MS-Owner oder WS-Owner); task-getriebene MS sind GESPERRT (Fortschritt
      // wird verdient). Journal = git-Historie (Δ-Woche zeigt die Änderung).
      ep('/api/ms/progress', {}, async ({ body, json, fail }) => {
          const { role, me } = body
          requireCan(fail, role, me, 'ms.melden')
          if (!body.ms_id) return json(400, { ok: false, error: 'ms_id fehlt' })
          const hasProg = typeof body.progress === 'number'
          const hasSlip = typeof body.slip === 'number'
          if (!hasProg && !hasSlip) return json(400, { ok: false, error: 'progress oder slip nötig' })
          const doc = db.projekt.read()
          let target = null, wsOwner = null
          for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === body.ms_id) { target = m; wsOwner = ws.owner }
          if (!target) return json(404, { ok: false, error: `Milestone ${body.ms_id} unbekannt` })
          if (!can(role, me, 'ms.melden', { ...target, _wsOwner: wsOwner })) return json(403, { ok: false, error: 'Owner darf nur eigene Meilensteine melden' })
          if (hasProg && target.progress_source === 'tasks')
            return json(409, { ok: false, error: 'Fortschritt wird bei diesem Milestone aus den Handlungen VERDIENT — bitte Handlungen abhaken statt Prozent tippen.' })
          const changes = []
          if (hasProg) {
            const p = Math.max(0, Math.min(100, Math.round(body.progress)))
            if (target.progress !== p) { target.progress = p; changes.push(`progress → ${p}%`) }
          }
          if (hasSlip) {
            const s = Math.max(0, Math.min(365, Math.round(body.slip)))
            if ((target.reported_slip_days || 0) !== s) { target.reported_slip_days = s; changes.push(`Verzug → +${s} T`) }
          }
          if (changes.length) db.projekt.write(doc)
          return json(200, { ok: true, ms_id: body.ms_id, changed: changes, unveraendert: !changes.length })
      })

      // POST /api/task/upsert — Handlungen (Tasks) anlegen/aktualisieren (nur CoS).
      // Optional body.activate_ms: schaltet den Milestone auf progress_source:'tasks'
      // («treibend») — bewusst expliziter Akt NACH menschlicher Freigabe der Zerlegung.
      ep('/api/task/upsert', {}, async ({ body, json, fail }) => {
          requireCan(fail, body.role, body.me, 'task.anlegen')
          const incoming = Array.isArray(body.tasks) ? body.tasks : []
          for (const t of incoming) {
            if (!t.id || !t.text) return json(400, { ok: false, error: 'Task braucht id und text (ms_id optional = ungekoppelt)' })
          }
          const tstore = db.tasks.read()
          const upserted = mergeTasks(tstore, incoming, body.datum)
          db.tasks.write(tstore)
          // Aktivierung + Roll-up (in dieser Reihenfolge: erst Flag, dann rechnen)
          let activation = null, roll = null
          if (body.activate_ms) {
            const doc = db.projekt.read()
            let target = null
            for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === body.activate_ms) target = m
            if (!target) return json(400, { ok: false, error: `activate_ms: Milestone ${body.activate_ms} unbekannt` })
            if (target.progress_source !== 'tasks') { target.progress_source = 'tasks'; db.projekt.write(doc) }
            activation = body.activate_ms
          }
          // Roll-up für alle berührten MS — auch bei reiner Aktivierung ohne neue Tasks
          const affected = [...new Set([...incoming.map(t => t.ms_id).filter(Boolean), ...(body.activate_ms ? [body.activate_ms] : [])])]
          for (const msId of affected) { const r = rollupMs(msId, store); if (r.rolled) roll = { ms_id: msId, ...r } }
          return json(200, { ok: true, upserted, activation, rollup: roll })
      })

      // POST /api/task/status — Handlung abhaken/wiedereröffnen {id, status} → Roll-up.
      // CoS immer; Owner nur eigene Handlungen (analog Audit #3 in /api/sitzung).
      ep('/api/task/status', {}, async ({ body, json, fail }) => {
          if (!body.id || !['offen', 'erledigt'].includes(body.status)) return json(400, { ok: false, error: 'id und status (offen|erledigt) sind Pflicht' })
          const role = body.role, me = body.me
          requireCan(fail, role, me, 'task.abhaken')
          const tstore = db.tasks.read()
          const t = tstore.tasks.find(x => x.id === body.id)
          if (!t) return json(404, { ok: false, error: `Task ${body.id} nicht gefunden` })
          if (!can(role, me, 'task.abhaken', t)) return json(403, { ok: false, error: 'Owner darf nur eigene Handlungen abhaken' })
          t.status = body.status
          t.erledigt_am = body.status === 'erledigt' ? (body.datum || new Date().toISOString().slice(0, 10)) : null
          // A5 (01.08.): Audit-Spur — WER hat abgehakt (Rolle bzw. Owner-Name)
          t.erledigt_von = body.status === 'erledigt' ? (role === 'Owner' ? me : 'CoS') : null
          // Artefakt-Pflicht (04.08., «Datengehirn»): Ablage-Link des Arbeitsprodukts —
          // optional beim Abhaken; validate meldet erledigt-ohne-Artefakt als Lücke.
          // Format-Gate (Härtung 04.08.): wenn gesetzt, muss es ein Archiv-Pointer sein.
          if (body.artefakt !== undefined && String(body.artefakt || '').trim() && !evidenzGueltig(String(body.artefakt)))
            return json(400, { ok: false, error: 'Artefakt muss ein Drive-/Docs-Link oder eine Register-Referenz sein — Freitext ist kein Ablage-Pointer.' })
          if (body.artefakt !== undefined) t.artefakt = String(body.artefakt || '').trim() || null
          db.tasks.write(tstore)
          const roll = rollupMs(t.ms_id, tstore)
          // Input-Kopplung (13.07., DRS «auto-geliefert»): Inputs mit liefer_tasks werden
          // ABGELEITET — geliefert, sobald ALLE gekoppelten Handlungen erledigt sind;
          // Wiederöffnen einer Handlung setzt den Input deterministisch zurück auf offen.
          let inputSync = null
          const doc2 = db.projekt.read()
          const byTaskId = new Map(tstore.tasks.map(x => [x.id, x]))
          let changed2 = false
          for (const inp of doc2.inputs || []) {
            const lt = inp.liefer_tasks
            if (!Array.isArray(lt) || !lt.includes(t.id)) continue
            const soll = lt.every(id2 => byTaskId.get(id2)?.status === 'erledigt') ? 'geliefert' : 'offen'
            if (inp.status !== soll) { inp.status = soll; changed2 = true; inputSync = { input: inp.id, status: soll } }
          }
          if (changed2) db.projekt.write(doc2)
          return json(200, { ok: true, task: t, rollup: roll, input_sync: inputSync })
      })

      // POST /api/reminder/draft — K2 Stufe 1 (01.08.): Reminder als Gmail-ENTWÜRFE
      // aus der Durchsetzungs-Queue (je Owner gebündelt, 7-Tage-Bremse, persistentes
      // Log in reminder_log.json). NIE Versand — DRS sendet. Nur CoS.
      // Eskalation/Kalender bleiben bewusst simuliert (Führungssignale, nie automatisch).
      ep('/api/reminder/draft', {}, async ({ body, json, fail }) => {
          requireCan(fail, body.role, body.me, 'reminder.entwerfen')
          const args = [path.join(root, 'scripts', 'gen_reminder_mail.py')]
          if (body.scope === 'alle') args.push('--alle')
          else if (body.scope && Array.isArray(body.scope.ids) && body.scope.ids.length) args.push('--ids', body.scope.ids.join(','))
          else return json(400, { ok: false, error: 'scope fehlt («alle» oder {ids:[...]})' })
          if (body.force) args.push('--force')
          execFile(PY_BIN, args, { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
      })

      // GET /api/delta?days=7 — B2 (01.08.): deterministischer Wochen-Delta aus
      // git-Historie (projekt.yaml) + Stores. Read-only, keine Guards nötig.
      ep('/api/delta', { method: 'GET', guard: false }, ({ req, json }) => {
        const days = Math.max(1, Math.min(90, parseInt(new URL(req.url, 'http://x').searchParams.get('days') || '7', 10) || 7))
        execFile(PY_BIN, [path.join(root, 'scripts', 'gen_delta.py'), '--days', String(days)], { cwd: root, timeout: 60000 }, (err, stdout, stderr) => {
          if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
          const last = (stdout || '').trim().split('\n').pop()
          try { return json(200, JSON.parse(last)) }
          catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
        })
      })

      // POST /api/gemini/import — K1 (01.08.): Meet-Notiz (Gemini) → Vorschau/Übernahme
      // via import_gemini_doc.py --api. post:false = Dry-Run-VORSCHAU (nichts geschrieben);
      // post:true = Übernahme über den regulären /api/sitzung-Pfad. Menschliche Freigabe =
      // der Übernehmen-Klick NACH der Vorschau (gleiches Gate wie CLI --post). CoS/Owner.
      ep('/api/gemini/import', {}, async ({ body, json, fail }) => {
          requireCan(fail, body.role, body.me, 'sitzung.erfassen')
          if (!body.meeting_id) return json(400, { ok: false, error: 'meeting_id fehlt' })
          const args = [path.join(root, 'scripts', 'import_gemini_doc.py')]
          if (body.doc_id) args.push(body.doc_id)
          args.push('--meeting-id', body.meeting_id, '--api', '--role', body.role)
          if (body.me) args.push('--me', body.me)
          if (body.on) args.push('--on', body.on)
          if (body.days) args.push('--days', String(body.days))
          if (body.datum) args.push('--datum', body.datum)
          if (body.sensitiv) args.push('--sensitiv')
          if (body.post) args.push('--post')
          execFile(PY_BIN, args, { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
      })

      // POST /api/task/suggest — K4 (01.08.): KI-Zerlegungsvorschlag für einen Milestone.
      // Liefert NUR Entwürfe (nichts wird gespeichert) — Übernahme läuft über den
      // bestehenden /api/task/upsert nach menschlicher Prüfung im UI. Nur CoS.
      ep('/api/task/suggest', {}, async ({ body, json, fail }) => {
          requireCan(fail, body.role, body.me, 'ki.nutzen')
          if (!body.ms_id) return json(400, { ok: false, error: 'ms_id fehlt' })
          const doc = db.projekt.read()
          let target = null, wsCode = null
          for (const ws of doc.workstreams || []) for (const m of ws.milestones || []) if (m.id === body.ms_id) { target = m; wsCode = ws.code }
          if (!target) return json(404, { ok: false, error: `Milestone ${body.ms_id} unbekannt` })
          const briefing = db.briefings.read()[body.ms_id] || {}
          const existing = db.tasks.read().tasks.filter(t => t.ms_id === body.ms_id).map(t => t.text)
          const owners = doc.meta?.owners || []
          const prompt = 'Du zerlegst einen Meilenstein des AXS-Transformationsprogramms RUBICON in 5-10 binär abhakbare Handlungen.\n'
            + 'Antworte NUR mit einem JSON-Array: [{"text": "<Handlung, beginnt mit Verb, konkret prüfbar>", "owner": "<voller Name aus der Owner-Liste oder null>", "due": "YYYY-MM-DD oder null"}]\n'
            + 'HARTE REGELN: due NUR setzen, wenn aus Briefing/Fälligkeit klar ableitbar — sonst null (nie raten; alle due ≤ Milestone-Fälligkeit). '
            + 'Owner nur aus der Liste oder null. Keine Handlung, die es unten schon gibt. Deutsch, nüchtern, keine Deko.\n'
            + `MILESTONE: ${JSON.stringify({ id: target.id, name: target.name, ws: wsCode, owner: target.owner, start: target.start, due: target.due, phase: target.phase, kpi: target.kpi })}\n`
            + `OWNER-LISTE: ${JSON.stringify(owners)}\n`
            + `BRIEFING: ${JSON.stringify(briefing)}\n`
            + `BESTEHENDE HANDLUNGEN: ${JSON.stringify(existing)}`
          runClaude(prompt, (err, out) => {
            if (err && !out) return json(500, { ok: false, error: String(err.message || err) })
            const arr = extractJson(out)
            if (!Array.isArray(arr)) return json(500, { ok: false, error: 'KI-Antwort nicht parsebar: ' + (out || '').slice(0, 200) })
            const clean = arr.filter(x => x && x.text).slice(0, 12).map(x => ({
              text: String(x.text).slice(0, 300),
              owner: owners.includes(x.owner) ? x.owner : null,
              due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') ? x.due : null,
            }))
            return json(200, { ok: true, ms_id: body.ms_id, vorschlaege: clean })
          })
      })

      // POST /api/ask — K7 (01.08.): «Frag die Daten» — read-only NL-Abfrage über die
      // Plattform-Stores mit harter Quellenbindung (IDs zitieren, nie raten). Alle Rollen
      // (rein lesend); Daten verlassen den Rechner nicht ausser an die Anthropic-API.
      ep('/api/ask', {}, async ({ body, json, fail }) => {
          const frage = (body.frage || '').trim()
          if (!frage) return json(400, { ok: false, error: 'frage fehlt' })
          if (frage.length > 500) return json(400, { ok: false, error: 'Frage zu lang (max 500 Zeichen)' })
          const doc = db.projekt.read()
          const tasksC = db.tasks.read().tasks.map(t => ({ nr: 'T-' + String(t.nr || 0).padStart(3, '0'), text: (t.text || '').slice(0, 140), owner: t.owner, due: t.due, status: t.status, ms: t.ms_id }))
          const ents = db.entscheide.read().entscheide.map(e2 => ({ id: e2.id, titel: e2.titel, status: e2.status, gremium: e2.gremium, frist: e2.frist, datum: e2.datum }))
          const prompt = 'Du beantwortest Fragen zum AXS-Transformationsprogramm RUBICON — AUSSCHLIESSLICH aus den folgenden Plattform-Daten.\n'
            + 'HARTE REGELN: (1) Jede Aussage mit IDs belegen (MS-IDs, T-Nummern, E-Nummern, IN-IDs). (2) Steht etwas nicht in den Daten: '
            + 'sag genau das («nicht in den Plattform-Daten») — NIE raten oder Weltwissen einmischen. (3) Deutsch, kompakt, '
            + 'bei Aufzählungen ≥3 als Markdown-Tabelle. (4) Stichtag der Daten nennen, wenn Zeitbezug relevant.\n\n'
            + `FRAGE: ${frage}\n\n`
            + `PROJEKT (meta+workstreams+milestones+inputs):\n${JSON.stringify(doc)}\n\n`
            + `HANDLUNGEN:\n${JSON.stringify(tasksC)}\n\n`
            + `ENTSCHEIDE:\n${JSON.stringify(ents)}`
          runClaude(prompt, (err, out) => {
            if (err && !out) return json(500, { ok: false, error: String(err.message || err) })
            return json(200, { ok: true, antwort: (out || '').trim() })
          })
      })

      // POST /api/entscheid/upsert — Entscheid im Register anlegen/aktualisieren.
      // CoS immer; Owner darf als Antragsteller eigene Entscheide erfassen (analog Audit #3).
      // Lifecycle (status/kommunikation) wird hier NICHT verändert — nur via /api/entscheid/status.
      ep('/api/entscheid/upsert', {}, async ({ body, json, fail }) => {
          const role = body.role, me = body.me
          requireCan(fail, role, me, 'entscheid.erfassen')
          const incoming = Array.isArray(body.entscheide) ? body.entscheide : []
          for (const e of incoming) {
            if (!e.key || !(e.titel || e.entscheid)) return json(400, { ok: false, error: 'Entscheid braucht key und titel/entscheid' })
            if (role === 'Owner') e.antragsteller = me   // Owner erfasst nur im eigenen Namen
          }
          const estore = db.entscheide.read()
          const upserted = mergeEntscheide(estore, incoming, body.datum)
          db.entscheide.write(estore)
          return json(200, { ok: true, upserted })
      })

      // POST /api/entscheid/status — Status-Übergang im 5-Stufen-Modell {id, status, an?}.
      // CoS immer; Owner nur eigene (antragsteller === me). Übergang zu «kommuniziert»
      // setzt den Kommunikations-Stempel {an, am}; «entschieden» stempelt das Entscheid-Datum.
      ep('/api/entscheid/status', {}, async ({ body, json, fail }) => {
          if (!body.id || !ENT_FLOW.includes(body.status)) return json(400, { ok: false, error: `id und status (${ENT_FLOW.join('|')}) sind Pflicht` })
          const role = body.role, me = body.me
          requireCan(fail, role, me, 'entscheid.fortschreiben')
          const estore = db.entscheide.read()
          const e = estore.entscheide.find(x => x.id === body.id)
          if (!e) return json(404, { ok: false, error: `Entscheid ${body.id} nicht gefunden` })
          if (!can(role, me, 'entscheid.fortschreiben', e)) return json(403, { ok: false, error: 'Owner darf nur eigene Entscheide fortschreiben' })
          // A4 (01.08.): Beschluss-Qualität hart — ohne Begründung kein «entschieden»
          // (Pflichtfeld der Beschlussvorlage; bisher nur UI-Warnung, jetzt Server-Gate).
          if (body.status === ENT_BEGRUENDUNG_AB && !(e.begruendung || '').trim())
            return json(400, { ok: false, error: 'Begründung ist Pflicht vor «entschieden» — im Register-Detail ergänzen.' })
          const today = body.datum || new Date().toISOString().slice(0, 10)
          e.status = body.status
          if (body.status === 'entschieden' && !e.datum) e.datum = today
          if (body.status === 'kommuniziert') e.kommunikation = { an: body.an || null, am: today }
          db.entscheide.write(estore)
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
      })

      // POST /api/zielbild/status — Reifegrad eines Zielbild-Kriteriums fortschreiben
      // (04.08., «AXS-Datengehirn»). Datenehrlichkeit hart: Upgrade auf «vorhanden»/
      // «gelebt» NUR mit Evidenz (Artefakt-/Quellen-Link) — sonst 400. Jede Änderung
      // wird in status_historie protokolliert (revisionssicher, kein Lösch-Endpoint).
      ep('/api/zielbild/status', {}, async ({ body, json, fail }) => {
          const ZB = DOMAIN.zielbild || {}
          const FLOW = ZB.reihenfolge || []
          if (!body.id || !FLOW.includes(body.status))
            return json(400, { ok: false, error: `id und status (${FLOW.join('|')}) sind Pflicht` })
          requireCan(fail, body.role, body.me, 'zielbild.fortschreiben')
          const store = db.zielbild.read()
          const z = store.zielbild.find(x => x.id === body.id)
          if (!z) return json(404, { ok: false, error: `Zielbild-Kriterium ${body.id} nicht gefunden` })
          const rang = (s) => FLOW.indexOf(s)
          const pflichtAb = rang(ZB.evidenz_pflicht_ab || 'vorhanden')
          // Upgrade-Gate: eine ERHÖHUNG auf «vorhanden»/«gelebt» braucht FRISCHE Evidenz im
          // Request — die Seed-Evidenz beschreibt den Ist-Zustand und belegt kein Upgrade.
          if (rang(body.status) > rang(z.status) && rang(body.status) >= pflichtAb && !(body.evidenz || '').trim())
            return json(400, { ok: false, error: `Upgrade auf «${body.status}» erfordert frische Evidenz (Artefakt-/Quellen-Link) — Datenehrlichkeit.` })
          // Format-Gate (Härtung 04.08.): Evidenz ist ein POINTER ins Archiv — sie muss einen
          // Drive-/Docs-Link oder eine Register-Referenz enthalten; Freitext-Behauptung reicht nicht.
          if (body.evidenz && String(body.evidenz).trim() && !evidenzGueltig(String(body.evidenz)))
            return json(400, { ok: false, error: 'Evidenz muss einen Drive-/Docs-Link oder eine Register-Referenz enthalten (E-JJJJ-### · T-### · IN-## · Z-XXX-## · Milestone-ID) — Freitext ist kein Beleg.' })
          if (body.evidenz && String(body.evidenz).trim()) z.evidenz = String(body.evidenz).trim()
          if (rang(body.status) >= pflichtAb && !(z.evidenz || '').trim())
            return json(400, { ok: false, error: `Evidenz ist Pflicht für «${body.status}» — Artefakt-/Quellen-Link angeben (Datenehrlichkeit).` })
          const today = new Date().toISOString().slice(0, 10)
          z.status = body.status
          if (body.naechster_schritt !== undefined) z.naechster_schritt = body.naechster_schritt || null
          z.status_historie = z.status_historie || []
          z.status_historie.push({ am: today, status: body.status, quelle: body.quelle || `manuell (${body.role})` })
          db.zielbild.write(store)
          return json(200, { ok: true, kriterium: z })
      })

      // POST /api/protokoll/export — Protokoll als PDF + Google Doc rendern (shellt Python)
      ep('/api/protokoll/export', {}, async ({ body, json, fail }) => {
          if (!body.id) return json(400, { ok: false, error: 'id fehlt' })
          // Sensitiv (#6): kein Export — PDF läge im servierten public/, das Doc im
          // geteilten Drive. Sensitive Protokolle bleiben ausschliesslich im lokalen Store.
          if (db.sensitiv.read().protokolle.some(p => p.id === body.id))
            return json(403, { ok: false, error: 'sensitives Protokoll — Export bewusst gesperrt (bleibt nur lokal einsehbar)' })
          execFile(PY_BIN, [path.join(root, 'scripts', 'gen_protokoll.py'), body.id], { cwd: root, timeout: 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
      })

      // POST /api/report/generate — verdichteten Report rendern (shellt gen_report.py)
      ep('/api/report/generate', {}, async ({ body, json, fail }) => {
          if (!body.level || !body.period) return json(400, { ok: false, error: 'level und period sind Pflicht' })
          const rargs = [path.join(root, 'scripts', 'gen_report.py'), body.level, body.period]
          if (body.ki) rargs.push('--ki')   // K5: KI-Entwurf (Narrativ + Ampel-Begründungen) — dauert länger
          execFile(PY_BIN, rargs, { cwd: root, timeout: body.ki ? 300000 : 120000 }, (err, stdout, stderr) => {
            if (err && !stdout) return json(500, { ok: false, error: String(stderr || err).slice(-300) })
            const last = (stdout || '').trim().split('\n').pop()
            try { return json(200, JSON.parse(last)) }
            catch { return json(500, { ok: false, error: 'Parse: ' + (stderr || last || '').slice(-200) }) }
          })
      })

      // POST /api/report/comment — optionalen Freitext-Kommentar speichern {key, text}
      ep('/api/report/comment', {}, async ({ body, json, fail }) => {
          if (!body.key) return json(400, { ok: false, error: 'key fehlt' })
          const kstore = db.kommentare.read()
          if (body.text) kstore[body.key] = body.text; else delete kstore[body.key]
          db.kommentare.write(kstore)
          return json(200, { ok: true })
      })

  // ── Dispatcher (R3, 01.08.2026) ───────────────────────────────────────────
  // Ein Einstieg für BEIDE Betriebsarten: Vite-Dev-Middleware und der
  // eigenständige App-Server (server.mjs). Gibt true zurück, wenn die Anfrage
  // beantwortet wurde; sonst false → der Aufrufer liefert statisch aus.
  return async function handle(req, res) {
    const url = (req.url || '').split('?')[0]

    // Auslieferungs-Sperre: der Sensitiv-Store ist über KEINEN Pfad abrufbar
    // (auch nicht /src/… oder /@fs/… des Dev-Servers) — hart 403, vor allem anderen.
    if ((req.url || '').includes('protokolle_sensitiv')) {
      res.statusCode = 403; res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'sensitiver Store wird nicht ausgeliefert' }))
      return true
    }

    const route = ROUTES.get(url)
    if (!route) return false
    if (req.method !== route.method) return false

    const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
    if (route.opts.guard !== false && !guard(req, res)) return true
    try {
      const body = route.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {}
      const fail = (code, msg) => { const e = new Error(msg); e.status = code; throw e }
      const out = await route.handler({ body, req, res, json, fail })
      if (out !== undefined) json(200, out)
    } catch (err) {
      json(err && err.status ? err.status : 500, { ok: false, error: String((err && err.message) || err) })
    }
    return true
  }
}
