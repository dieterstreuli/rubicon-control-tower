// App.jsx — RUBICON Control Tower. Liest AUSSCHLIESSLICH aus dem Loader
// (einzige Wahrheitsquelle projekt.yaml). Session-Eingaben (Aktions-Log,
// gemeldeter Fortschritt, Input-Status, Reminder) sind flüchtige Overlays und
// klar als «Session — nicht persistiert» markiert; sie duplizieren keinen Zustand.
import React, { useEffect, useMemo, useState } from 'react'
import {
  Radar, Layers, ListChecks, ShieldCheck, Diamond, AlertTriangle,
  Clock, Send, CalendarClock, Siren, CheckCircle2, Filter, Lock, FileText, X, Compass,
  ClipboardList, Plus, Trash2, Save, Sun, Moon, BarChart3, Circle, Scale,
} from 'lucide-react'
import { T, STATUS_META, ROLES, applyTheme, initialTheme } from './lib/theme.js'
import { can, canAny } from './lib/permissions.js'   // Q4: EINE Rechte-Matrix (identisch auf dem Server)
import {
  PHASE_ORDER, phaseToken, ENT_FLOW, ENT_TYPEN, ENT_GREMIEN, ENT_COLOR,
  TYP_LABEL, TYP_ICON, LVL_LABEL, LVL_AUSWAHL, LVL_COLOR, PROGRESS_STEPS, roleInfo,
} from './lib/domain.js'
import { loadProject } from './lib/loader.js'
import BRIEFINGS from './data/briefings.json'
import FR from './data/fuehrungsrhythmus.json'
import TRAKT_DOCS from './data/traktanden_docs.json'
import PROTO from './data/protokolle.json'
import AGENDAS from './data/traktanden.json'
import REPORTS from './data/reports_index.json'
import TASKS from './data/tasks.json'
import ENTS from './data/entscheide.json'
import REMLOG from './data/reminder_log.json'
import {
  statusOf, slipDays, projectedEnd, counts, overallStatus, allMilestones,
  parseDate, fmtDate, daysBetween, hardEdgeBreaches,
} from './lib/status.js'

const { data: BASE, issues: ISSUES } = loadProject()
const NOW = parseDate(BASE.meta.today)

// A1 (01.08.): Datei-Writes lösen einen Vite-HMR-Reload aus — Scroll-Position vorher
// merken, damit die Ansicht nach dem Reload nicht an den Seitenanfang springt.
function reloadKeepScroll() {
  sessionStorage.setItem('rubicon_scroll', String(window.scrollY || 0))
  window.location.reload()
}

// ---------- Handlungen (Tasks, «treibend» 13.07.) ----------
// tasks.json = aus Milestones abgeleitete, binär abhakbare Handlungen. Bei
// progress_source:'tasks' wird der Milestone-Fortschritt daraus VERDIENT
// (Roll-up serverseitig in rubicon-api.js — hier nur Anzeige + Abhak-Aktion).
// Überfällig ist ABGELEITET: due < meta.today UND offen (nie manuell gesetzt).
const ALL_TASKS = TASKS.tasks || []
// Milestone-Metadaten für die Aufgabenliste (Phase/WS/Fälligkeit je ms_id)
const MS_META = Object.fromEntries(BASE.workstreams.flatMap(w =>
  (w.milestones || []).map(m => [m.id, { ws: w.code, phase: m.phase, name: m.name, due: m.due, programm: w.programm || null }])))
const tasksFor = (msId) => ALL_TASKS.filter(t => t.ms_id === msId)
const tnr = (t) => 'T-' + String(t.nr || 0).padStart(3, '0')   // kurze Referenz-Nummer (dauerhaft, nie neu vergeben)
const taskOverdue = (t) => t.status === 'offen' && !!t.due && !!NOW && parseDate(t.due) < NOW
const TASK_STATS = {
  total: ALL_TASKS.length,
  offen: ALL_TASKS.filter(t => t.status === 'offen').length,
  erledigt: ALL_TASKS.filter(t => t.status === 'erledigt').length,
  ueberfaellig: ALL_TASKS.filter(taskOverdue).length,
}

// ── K6 (01.08.): Plausibilitäts-Radar — rein regelbasierte Muster-Checks über
// Milestones + Handlungen (kein KI-Raten). Befunde erscheinen im Integritäts-
// Panel als eigene Stufe «RADAR» (informativ — kein Gate, kein Abbruch).
const RADAR = (() => {
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

// ---------- kleine Bausteine ----------
const Pill = ({ st }) => {
  const m = STATUS_META[st] || STATUS_META.unknown
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.color + '22', color: m.color, border: `1px solid ${m.color}55`, fontFamily: T.mono }}>
      {m.label}
    </span>
  )
}

const Bar = ({ v }) => (
  <div className="w-full h-2 rounded" style={{ background: T.line }}>
    {typeof v === 'number'
      ? <div className="h-2 rounded" style={{ width: Math.min(100, v) + '%', background: v >= 100 ? T.blue : T.green }} />
      : <div className="h-2 rounded w-full flex items-center justify-center text-[9px]" style={{ color: T.grey }}>·· unbekannt ··</div>}
  </div>
)

const Kpi = ({ label, value, color, sub }) => (
  <div className="rounded-xl p-4 border" style={{ background: T.panel, borderColor: T.line }}>
    <div className="text-[11px] uppercase tracking-wider" style={{ color: T.inkDim }}>{label}</div>
    <div className="text-3xl font-bold mt-1" style={{ color, fontFamily: T.mono }}>{value}</div>
    {sub && <div className="text-[11px] mt-1" style={{ color: T.inkFaint }}>{sub}</div>}
  </div>
)

// Phasen — kanonische Reihenfolge, Farbe (analog Intro) und Kurzlabel.
const phaseColor = (p) => {
  if (!p) return T.grey
  if (p.startsWith('Masterplan')) return T.inkFaint
  const tok = phaseToken(p)
  return tok ? T[tok] : T.inkDim
}
const phaseShort = (p) => !p ? '—' : p.startsWith('Masterplan') ? p.replace('Masterplan · ', 'MP · ') : p
const FR_COL = { grey: '#64748b', green: '#34d399', blue: '#60a5fa', brass: '#d4a95c' }
const PhaseTag = ({ p }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap"
    style={{ color: phaseColor(p), background: phaseColor(p) + '1e', border: `1px solid ${phaseColor(p)}44`, fontFamily: T.mono }}>
    {phaseShort(p)}
  </span>
)

// ---------- App ----------
export default function App() {
  const [role, setRole] = useState('CoS')
  const [me, setMe] = useState('Andreas Fritthum') // aktive Identität in Rolle «Owner» (volle Namen, 13.07.)
  const [theme, setTheme] = useState(() => { const m = initialTheme(); applyTheme(m); return m })
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; applyTheme(next); setTheme(next) }
  // IA-Konsolidierung 01.08. (B0): 5 Tabs. Alte Tab-IDs (inputs/intro/streams/
  // erfassen/protokolle/log/cos) werden auf die neuen Heimaten gemappt.
  const LEGACY_TAB = { inputs: 'tower', intro: 'tower', streams: 'tower', erfassen: 'sitzungen', protokolle: 'sitzungen', log: 'tower', cos: 'tower' }
  const [tab, setTab] = useState(() => { const t = sessionStorage.getItem('rubicon_tab'); return LEGACY_TAB[t] || t || 'tower' })
  const [showIntro, setShowIntro] = useState(false)   // Intro lebt als ⓘ-Overlay (B0)
  // Kontrollturm-Darstellung: Abflugtafel (Tabelle) ⇄ Arbeitsströme (Karten) — ehem. eigener Tab
  const [towerView, setTowerView] = useState(() => sessionStorage.getItem('rubicon_view') || 'tafel')
  useEffect(() => { sessionStorage.setItem('rubicon_view', towerView) }, [towerView])
  // Bestätigung nach Speichern (überlebt den HMR-Reload via sessionStorage)
  const [savedInfo] = useState(() => {
    const s = sessionStorage.getItem('rubicon_saved')
    if (s) { sessionStorage.removeItem('rubicon_saved'); sessionStorage.removeItem('rubicon_tab'); try { return JSON.parse(s) } catch { return null } }
    return null
  })
  // A1 (01.08.): Filter + Suche überleben den HMR-Reload (sessionStorage)
  const [wsFilter, setWsFilter] = useState(() => sessionStorage.getItem('rubicon_f_ws') || 'alle')
  const [phaseFilter, setPhaseFilter] = useState(() => sessionStorage.getItem('rubicon_f_phase') || 'alle')
  const [ownerFilter, setOwnerFilter] = useState(() => sessionStorage.getItem('rubicon_f_owner') || 'alle')
  const [msSearch, setMsSearch] = useState(() => sessionStorage.getItem('rubicon_f_search') || '')
  useEffect(() => {
    sessionStorage.setItem('rubicon_f_ws', wsFilter)
    sessionStorage.setItem('rubicon_f_phase', phaseFilter)
    sessionStorage.setItem('rubicon_f_owner', ownerFilter)
    sessionStorage.setItem('rubicon_f_search', msSearch)
  }, [wsFilter, phaseFilter, ownerFilter, msSearch])
  const [clock, setClock] = useState(new Date())
  const [showIntegrity, setShowIntegrity] = useState(false)

  // Session-Overlays (flüchtig, nicht persistiert — Wahrheit bleibt projekt.yaml)
  const [overlay, setOverlay] = useState({})       // id -> {progress?, slip?} (What-if im Modal)
  const [inputState, setInputState] = useState({}) // id -> {status?, last_reminder?}
  const [autoLog, setAutoLog] = useState([])       // CoS-Automations-Log (simuliert)
  const [remBusy, setRemBusy] = useState(false)    // K2: Gmail-Entwurf läuft
  const [selMs, setSelMs] = useState(null)         // Milestone-Detail-Modal

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { setSelMs(null); setShowIntro(false) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A1 (01.08.): Scroll-Position nach HMR-Reload wiederherstellen
  useEffect(() => {
    const y = sessionStorage.getItem('rubicon_scroll')
    if (y) { sessionStorage.removeItem('rubicon_scroll'); window.scrollTo(0, +y) }
  }, [])

  // Tab überlebt den Reload (HMR nach Daten-Writes) — konsistent mit Erfassen/Export.
  useEffect(() => { sessionStorage.setItem('rubicon_tab', tab) }, [tab])
  // Nach Task-Abhaken (Reload) das Milestone-Modal wieder öffnen — nahtloses Weiterarbeiten.
  useEffect(() => {
    const id = sessionStorage.getItem('rubicon_selms')
    if (id) {
      sessionStorage.removeItem('rubicon_selms')
      const found = ms.find(x => x.id === id)
      if (found) setSelMs(found)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t) }, [])

  // Programm-Dimension (16.07., Plattform-Zielbild): alle Sichten gelten je Programm.
  // Solange nur EIN Programm registriert ist, bleibt der Umschalter unsichtbar und
  // die Filterung ist Identität — Programm #2 wird reines Daten-Onboarding.
  const [prog, setProg] = useState(() => sessionStorage.getItem('rubicon_prog') || BASE.meta.default_programm || null)
  useEffect(() => { if (prog) sessionStorage.setItem('rubicon_prog', prog) }, [prog])

  // effektive Daten = YAML + Session-Overlay, gefiltert aufs aktive Programm.
  // Nicht-Default-Programme steuern gegen ihr EIGENES Ende (meta-Override) —
  // Kern-Ende/Hard-Edge der Transformation gelten dort nicht (Test-Fund 17.07.).
  const progEntry = (BASE.meta.programme || []).find(p => p.id === prog)
  const progIsDefault = !prog || prog === BASE.meta.default_programm
  const data = useMemo(() => ({
    ...BASE,
    meta: progIsDefault ? BASE.meta : {
      ...BASE.meta,
      projekt: `${progEntry?.name || prog} — auf der RUBICON-Plattform`,
      baseline_end: progEntry?.ende || BASE.meta.baseline_end,
      nachlauf_end: progEntry?.ende || BASE.meta.nachlauf_end,
      hard_edge: progEntry?.ende || BASE.meta.hard_edge,
    },
    workstreams: BASE.workstreams.filter(ws => !prog || !ws.programm || ws.programm === prog).map(ws => ({
      ...ws,
      milestones: ws.milestones.map(m => {
        const o = overlay[m.id]
        return o ? { ...m, progress: o.progress ?? m.progress, reported_slip_days: o.slip ?? m.reported_slip_days } : m
      }),
    })),
    inputs: BASE.inputs.map(i => ({ ...i, ...(inputState[i.id] || {}) })),
  }), [overlay, inputState, prog])

  const ms = useMemo(() => allMilestones(data), [data])
  const cnt = useMemo(() => counts(data), [data])
  const proj = useMemo(() => projectedEnd(data), [data])
  const overall = useMemo(() => overallStatus(data), [data])
  const breaches = useMemo(() => hardEdgeBreaches(data), [data])
  const canEdit = canAny(role, 'sitzung.erfassen')
  const canEditMs = (m) => can(role, me, 'ms.melden', m)
  const ALL_ISSUES = [...ISSUES, ...RADAR]
  const nErr = ISSUES.filter(i => i.level === 'FEHLER').length
  const nGap = ISSUES.filter(i => i.level === 'LÜCKE').length

  function remind(input, kind) {
    const stamp = fmtDate(BASE.meta.today) + ' ' + clock.toTimeString().slice(0, 5)
    setInputState(s => ({ ...s, [input.id]: { ...(s[input.id] || {}), last_reminder: stamp } }))
    setAutoLog(l => [{
      ts: new Date(),
      msg: `[SIMULIERT] ${kind} an ${input.owner} — «${input.item}» (fällig ${fmtDate(input.due)})`,
    }, ...l])
  }

  // K2 Stufe 1 (01.08.): echte Gmail-ENTWÜRFE aus der Durchsetzungs-Queue — je Owner
  // gebündelt, 7-Tage-Bremse, persistentes Log. Versand bleibt IMMER bei DRS.
  // Eskalation/Kalender bleiben simuliert (Führungssignale — nie automatisch).
  async function reminderDrafts(scope) {
    if (remBusy) return
    setRemBusy(true)
    try {
      const r = await fetch('/api/reminder/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, scope }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) {
        const n = (j.drafts || []).length
        alert(n
          ? `${n} Gmail-Entwurf/Entwürfe erstellt (je Owner gebündelt):\n`
            + j.drafts.map(d => `· ${d.owner}${d.email ? '' : ' — OHNE Empfänger (E-Mail unbekannt)'} (${d.items.length} Item(s))`).join('\n')
            + '\n\nDie Entwürfe liegen in Gmail — DRS sendet.'
            + (j.hinweise?.length ? '\n\n' + j.hinweise.join('\n') : '')
          : 'Keine Entwürfe erstellt'
            + (j.uebersprungen?.length ? ` — ${j.uebersprungen.length} Item(s) übersprungen (7-Tage-Bremse / Owner fehlt / DRS selbst).` : ' — nichts fällig.'))
        sessionStorage.setItem('rubicon_tab', 'tower')
        reloadKeepScroll()
      } else { alert('Entwurf fehlgeschlagen: ' + (j.error || 'unbekannt')); setRemBusy(false) }
    } catch (err) { alert('Entwurf fehlgeschlagen: ' + err); setRemBusy(false) }
  }

  // B0 (01.08.): 5 Tabs. Intro = ⓘ-Overlay · Arbeitsströme = Umschalter im Kontrollturm ·
  // CoS-Steuerung = CoS-Sektion im Kontrollturm · Erfassen+Protokolle = «Sitzungen» ·
  // Aktions-Log entfällt (What-if lebt im Milestone-Modal).
  const tabs = [
    { id: 'tower', label: 'Kontrollturm', icon: Radar },
    { id: 'aufgaben', label: 'Aufgaben', icon: CheckCircle2 },
    { id: 'sitzungen', label: 'Sitzungen', icon: ClipboardList },
    { id: 'entscheide', label: 'Entscheide', icon: Scale },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
  ]

  // A3 (01.08.): Drift zwischen manuellem Steuerungsdatum (meta.today) und realem
  // Datum sichtbar machen — meta.today bleibt bewusst manuell (reproduzierbare Sichten).
  const driftDays = (() => {
    if (!NOW) return 0
    const r = clock
    const realUTC = Date.UTC(r.getFullYear(), r.getMonth(), r.getDate())
    return Math.round((realUTC - NOW.getTime()) / 86400000)
  })()

  // Programm-eigene Phasen (17.07.): andere Programme bringen eigene Phasen-Labels mit
  // (z.B. Vorbereitung/Ansprache/Abschluss) — kanonische RUBICON-Phasen zuerst, dann
  // die im aktiven Programm vorkommenden Zusatz-Phasen in Datenreihenfolge.
  const customPhases = [...new Set(ms.map(m => m.phase)
    .filter(p => p && !PHASE_ORDER.includes(p) && !p.startsWith('Masterplan')))]
  const rubPhases = [...PHASE_ORDER.filter(ph => ms.some(m => m.phase === ph)), ...customPhases]
  const mpPhases = [...new Set(ms.filter(m => (m.phase || '').startsWith('Masterplan')).map(m => m.phase))].sort()
  const matchPhase = (m) => phaseFilter === 'alle'
    || (phaseFilter === 'MP-ALL' ? (m.phase || '').startsWith('Masterplan') : m.phase === phaseFilter)
  const owners = [...new Set(ms.map(m => m.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
  // A2 (01.08.): Textsuche über Code / Name / Owner (case-insensitiv)
  const q = msSearch.trim().toLowerCase()
  const msMatch = (m) => !q || [m.id, m.name, m.owner].some(v => (v || '').toLowerCase().includes(q))
  const filtered = ms.filter(m => (wsFilter === 'alle' || m._ws === wsFilter) && matchPhase(m)
    && (ownerFilter === 'alle' || m.owner === ownerFilter) && msMatch(m))
  const sorted = [...filtered].sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1)

  // A6 (01.08.): Vor/Zurück im Milestone-Modal — navigiert durch die aktuell
  // gefilterte/sortierte Tafel-Liste (Fallback: alle MS); Pfeiltasten ← →.
  const navMs = (m, dir) => {
    const list = sorted.some(x => x.id === m.id) ? sorted : ms
    const i = list.findIndex(x => x.id === m.id)
    const n = list[i + dir]
    if (n) setSelMs(n)
  }
  useEffect(() => {
    if (!selMs) return undefined
    const onKey = e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName)) return
      if (e.key === 'ArrowRight') navMs(selMs, 1)
      if (e.key === 'ArrowLeft') navMs(selMs, -1)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMs, sorted])

  // Erfüllungsgrad je Phase (erledigt = progress ≥ 100). Deckt alle 131 MS ab:
  // 5 RUBICON-Phasen + Commercial-Masterplan (aggregiert alle «Masterplan · …»).
  const PHASE_TILES = [
    ...PHASE_ORDER.map(ph => ({ key: ph, label: ph, match: m => m.phase === ph })),
    ...customPhases.map(ph => ({ key: ph, label: ph, match: m => m.phase === ph })),
  ].map(p => {
    const list = ms.filter(p.match)
    const done = list.filter(m => typeof m.progress === 'number' && m.progress >= 100).length
    return { key: p.key, label: p.label, total: list.length, done, pct: list.length ? Math.round(done / list.length * 100) : 0 }
  }).filter(p => p.total > 0)
  const alarms = ms.filter(m => ['delayed', 'atRisk'].includes(statusOf(m, NOW)))
    .sort((a, b) => slipDays(b, NOW) - slipDays(a, NOW))
  const overdueInputs = data.inputs.filter(i => i.status === 'offen' && parseDate(i.due) && daysBetween(parseDate(i.due), NOW) > 0)

  return (
    <div className="min-h-screen" style={{ background: T.bg, color: T.ink, fontFamily: T.sans }}>
      {/* ── Header ── */}
      <header className="border-b px-4 md:px-6 py-3" style={{ borderColor: T.line, background: T.panel }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-lg font-bold tracking-wide" style={{ fontFamily: T.mono }}>
              RUBICON <span style={{ color: T.brass }}>CONTROL TOWER</span>
            </div>
            <div className="text-[11px] italic" style={{ color: T.inkFaint }}>« Alea iacta est. » · {data.meta.projekt}</div>
          </div>
          <div className="flex items-center gap-2 text-[12px]" style={{ fontFamily: T.mono, color: T.inkDim }}>
            <Clock size={14} /> Steuerungsdatum <b style={{ color: T.ink }}>{fmtDate(BASE.meta.today)}</b>
            <span style={{ color: T.inkFaint }}>· Uhr {clock.toLocaleTimeString('de-CH')}</span>
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span style={{ color: T.inkDim }}>Gesamtstatus</span> <Pill st={overall} />
          </div>
          <div className="text-[12px]" style={{ fontFamily: T.mono }}>
            <span style={{ color: T.inkDim }}>Kern-Ende </span>
            <b>{fmtDate(proj.base)}</b>
            {proj.slip > 0 && <b style={{ color: T.red }}> → {fmtDate(proj.projected)} (+{proj.slip} T)</b>}
            {proj.slip === 0 && <span style={{ color: T.green }}> · auf Basislinie</span>}
            <span style={{ color: breaches.length ? T.red : T.brass }}> · HARD EDGE {fmtDate(data.meta.hard_edge)}{breaches.length ? ` — ${breaches.length} VERLETZUNG(EN)!` : ' ✓'}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowIntro(true)} aria-label="Programm-Übersicht (Intro)" title="Programm-Übersicht: Sinn & Zweck · Ströme · Phasen · Zeitachse · Führungsrhythmus"
              className="p-1.5 rounded border" style={{ borderColor: T.line, color: T.brass }}>
              <Compass size={14} />
            </button>
            <button onClick={toggleTheme} aria-label="Hell/Dunkel umschalten" title={theme === 'dark' ? 'Hell-Modus' : 'Dunkel-Modus'}
              className="p-1.5 rounded border" style={{ borderColor: T.line, color: T.brass }}>
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={() => setShowIntegrity(v => !v)}
              className="text-[11px] px-2 py-1 rounded border"
              style={{ borderColor: nErr ? T.red : T.line, color: nErr ? T.red : T.inkDim, fontFamily: T.mono }}>
              Integrität: {nErr} Fehler · {nGap} Lücken{RADAR.length ? ` · ${RADAR.length} Radar` : ''}
            </button>
            {(BASE.meta.programme || []).length > 1 && (
              <select value={prog || ''} onChange={e => setProg(e.target.value)}
                className="text-[12px] rounded px-2 py-1 border bg-transparent"
                style={{ borderColor: T.brass + '88', color: T.brass, background: T.panelSoft }}
                title="Aktives Programm — alle Sichten gelten je Programm">
                {BASE.meta.programme.map(p => <option key={p.id} value={p.id} style={{ color: '#111' }}>Programm: {p.name}</option>)}
              </select>
            )}
            <select value={role} onChange={e => setRole(e.target.value)}
              className="text-[12px] rounded px-2 py-1 border bg-transparent"
              style={{ borderColor: T.line, color: T.ink, background: T.panelSoft }}>
              {ROLES.map(r => <option key={r} value={r} style={{ color: '#111' }}>Rolle: {r}</option>)}
            </select>
            {role === 'Owner' && (
              <select value={me} onChange={e => setMe(e.target.value)}
                className="text-[12px] rounded px-2 py-1 border bg-transparent"
                style={{ borderColor: T.line, color: T.ink, background: T.panelSoft }}>
                {(BASE.meta.owners || []).map(o => <option key={o} value={o} style={{ color: '#111' }}>{o}</option>)}
              </select>
            )}
          </div>
        </div>
        {showIntegrity && (
          <div className="mt-2 max-h-40 overflow-auto rounded border p-2 text-[11px]"
            style={{ borderColor: T.line, background: T.bg, fontFamily: T.mono, color: T.inkDim }}>
            {ALL_ISSUES.length === 0 ? 'Keine Befunde.' : ALL_ISSUES.map((i, k) => (
              <div key={k} style={{ color: i.level === 'FEHLER' ? T.red : i.level === 'WARNUNG' ? T.amber : i.level === 'RADAR' ? T.brass : T.grey }}>
                [{i.level}] {i.where}: {i.msg}
              </div>
            ))}
          </div>
        )}
        <nav className="flex gap-1 mt-3 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[13px] whitespace-nowrap"
              style={tab === t.id
                ? { background: T.bg, color: T.brass, borderBottom: `2px solid ${T.brass}` }
                : { color: T.inkDim }}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Rollen-Kontextband — macht den Rollenwechsel sofort sichtbar (welche
          Perspektive aktiv ist + was sie darf). */}
      {(() => {
        const ri = roleInfo(role)
        const info = { c: ri.color, t: role === 'Owner' ? `${ri.titel} — ${me}` : ri.titel, d: ri.beschreibung }
        return (
          <div className="px-4 md:px-6 py-1.5 flex items-center gap-2 text-[11.5px] border-b"
            style={{ background: info.c + '14', borderColor: info.c + '44', color: T.ink }}>
            {canAny(role, 'reminder.entwerfen') ? <ShieldCheck size={13} style={{ color: info.c }} />
              : role === 'Owner' ? <ListChecks size={13} style={{ color: info.c }} />
              : <Lock size={13} style={{ color: info.c }} />}
            <b style={{ color: info.c }}>Aktive Rolle: {info.t}</b>
            <span style={{ color: T.inkDim }}>· {info.d}</span>
          </div>
        )
      })()}

      <main className="p-4 md:p-6 space-y-5">
        {driftDays > 2 && (
          <div className="rounded-lg border px-4 py-2 text-[12px] flex items-center gap-2"
            style={{ borderColor: T.amber + '88', background: T.amber + '14', color: T.amber }}>
            <AlertTriangle size={14} /> Steuerungsdatum <b style={{ fontFamily: T.mono }}>{fmtDate(BASE.meta.today)}</b> ist {driftDays} Tage alt —
            Ampeln &amp; «überfällig» rechnen damit. Bei der nächsten Steuerungssitzung <span style={{ fontFamily: T.mono }}>meta.today</span> in projekt.yaml aktualisieren.
          </div>
        )}
        {savedInfo && (
          <div className="rounded-lg border px-4 py-2 text-[12px] flex items-center gap-2"
            style={{ borderColor: T.green + '88', background: T.green + '14', color: T.green }}>
            <CheckCircle2 size={14} /> Sitzung erfasst ({savedInfo.id}).
            {savedInfo.applied?.length ? ` Übernommen: ${savedInfo.applied.join(' · ')}.` : ' Keine Milestone-Änderung.'}
            {' '}Ampel &amp; Erfüllungsgrad sind aktualisiert.
          </div>
        )}
        {/* ══ AUFGABEN ══ */}
        {tab === 'aufgaben' && <AufgabenView role={role} me={me} prog={prog} onOpenMs={(id) => { const m = ms.find(x => x.id === id); if (m) setSelMs(m) }} />}

        {/* ══ SITZUNGEN — Gemini-Import (Primärweg) + Erfassen (Fallback) + Archiv ══ */}
        {tab === 'sitzungen' && (
          <div className="space-y-5">
            {canEdit && <GeminiImport role={role} me={me} />}
            {canEdit && <ErfassungView ms={ms} today={BASE.meta.today} role={role} me={me} />}
            <ProtokolleView role={role} me={me} />
          </div>
        )}

        {/* ══ ENTSCHEIDS-REGISTER ══ */}
        {tab === 'entscheide' && <EntscheideView role={role} me={me} today={BASE.meta.today} />}

        {/* ══ REPORTS ══ */}
        {tab === 'reports' && <ReportsView canEdit={canEdit} today={BASE.meta.today} />}

        {/* ══ 1 · KONTROLLTURM ══ */}
        {tab === 'tower' && (<>
          {(() => {
            // Handlungen-KPI je Programm (Test-Fund 17.07.): Tasks folgen via ms_id→WS
            // dem Programm; ungekoppelte zählen überall (konzernweit, z.B. Nachlauf).
            const progTasks = ALL_TASKS.filter(t => !prog || !t.ms_id || !MS_META[t.ms_id]?.programm || MS_META[t.ms_id].programm === prog)
            const ts = {
              total: progTasks.length,
              offen: progTasks.filter(t => t.status === 'offen').length,
              erledigt: progTasks.filter(t => t.status === 'erledigt').length,
              ueberfaellig: progTasks.filter(taskOverdue).length,
            }
            return (
          <div className={ts.total > 0 ? 'grid grid-cols-2 md:grid-cols-5 gap-3' : 'grid grid-cols-2 md:grid-cols-4 gap-3'}>
            <Kpi label="Gesamtstatus" value={STATUS_META[overall].label} color={STATUS_META[overall].color}
              sub={`${cnt.total} Meilensteine · ${cnt.done} erledigt · ${cnt.unknown} unbekannt`} />
            <Kpi label="Auf Kurs" value={cnt.onTrack} color={T.green} />
            <Kpi label="Gefährdet" value={cnt.atRisk} color={T.amber} />
            <Kpi label="Verzug" value={cnt.delayed} color={T.red}
              sub={proj.drivers.length ? `Treiber: ${proj.drivers.map(d => d.id).join(', ')}` : 'kein kritischer Verzug'} />
            {ts.total > 0 && (
              <Kpi label="Handlungen offen" value={ts.offen}
                color={ts.ueberfaellig > 0 ? T.red : ts.offen > 0 ? T.amber : T.green}
                sub={`${ts.ueberfaellig} überfällig · ${ts.erledigt} erledigt · treiben den Fortschritt`} />
            )}
          </div>
            )
          })()}

          {/* Erfüllungsgrad je Phase */}
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.inkFaint, fontFamily: T.mono }}>
              Erfüllungsgrad je Phase (erledigt = 100 %{progEntry?.start ? ` · Programmstart ${fmtDate(progEntry.start)}` : ''})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {PHASE_TILES.map(p => {
                const col = phaseColor(p.key)
                return (
                  <div key={p.key} className="rounded-xl p-3 border" style={{ background: T.panel, borderColor: T.line, borderTop: `2.5px solid ${col}` }}>
                    <div className="text-[10px] font-semibold truncate" style={{ color: col }}>{p.key === 'Masterplan' ? 'Masterplan' : p.label}</div>
                    <div className="text-2xl font-bold mt-0.5" style={{ fontFamily: T.mono, color: T.ink }}>{p.pct}<span className="text-[13px]" style={{ color: T.inkDim }}> %</span></div>
                    <div className="w-full h-1.5 rounded mt-1" style={{ background: T.line }}>
                      <div className="h-1.5 rounded" style={{ width: p.pct + '%', background: col }} />
                    </div>
                    <div className="text-[10px] mt-1.5" style={{ fontFamily: T.mono, color: T.inkFaint }}>
                      <b style={{ color: T.ink }}>{p.done}</b> / {p.total} erledigt
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Δ Woche (B2, 01.08.): Was hat sich seit letzter Woche geändert — deterministisch
              aus git-Historie (projekt.yaml) + erledigt_am/Protokollen/Entscheiden. */}
          <DeltaWoche />

          {/* Frag die Daten (K7, 01.08.): read-only NL-Abfrage, quellengebunden */}
          <FragDieDaten />

          {/* Offene Datenlieferungen — ersetzt den eigenständigen Tab «Input-Pflichten»
              (16.07., DRS: 14/16 sind task-getriggert → keine Vollansicht mehr nötig).
              Zeigt NUR offene Bring-Pflichten (überfällige zuerst); gelieferte verschwinden
              (Historie steckt in den gekoppelten Handlungen). Datenmodell unverändert:
              inputs in projekt.yaml — Reminder-Queue (CoS-Steuerung) + Validierung laufen weiter. */}
          {(() => {
            const openInputs = data.inputs
              .filter(i => i.status === 'offen')
              .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
            if (!openInputs.length) return null
            return (
              <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
                <div className="px-4 py-2 text-[12px] font-semibold border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: T.line }}>
                  <span style={{ fontFamily: T.mono, color: T.brass }}>── OFFENE DATENLIEFERUNGEN ({openInputs.length}{overdueInputs.length ? ` · ${overdueInputs.length} überfällig ⚠` : ''}) ──</span>
                  {BASE.meta.datenlieferungen_url && (
                    <a href={BASE.meta.datenlieferungen_url} target="_blank" rel="noreferrer"
                      className="text-[11px] px-2 py-0.5 rounded border font-normal"
                      style={{ borderColor: T.brass, color: T.brass }}
                      title="Ablage-Konvention: Daten-Artefakte hierhin liefern (WS-Unterordner; Baseline-Pakete → _Baseline-Datenpakete G2)">
                      📁 Ablage: RUBICON — Datenlieferungen ↗
                    </a>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: T.line }}>
                  {openInputs.map(i => {
                    const overdue = parseDate(i.due) && daysBetween(parseDate(i.due), NOW) > 0
                    return (
                      <div key={i.id} className="px-4 py-1.5 flex flex-wrap items-center gap-2 text-[12px]"
                        style={{ borderTop: `1px solid ${T.line}`, background: overdue ? T.red + '0d' : 'transparent' }}>
                        <b className="w-40 truncate" style={{ fontFamily: T.mono }} title={i.owner}>{i.owner || '—'}</b>
                        <span className="flex-1 min-w-[220px]">{i.item}</span>
                        <span style={{ fontFamily: T.mono, color: overdue ? T.red : T.inkDim }}>
                          {fmtDate(i.due)}{overdue ? ` (+${daysBetween(parseDate(i.due), NOW)} T) ⚠` : ''}
                        </span>
                        {(i.liefer_tasks || []).length > 0
                          ? <span className="text-[10.5px]" style={{ fontFamily: T.mono, color: T.brass }}
                              title={`auto-geliefert, sobald erledigt: ${i.liefer_tasks.join(' + ')}`}>
                              ⚙ auto ← {i.liefer_tasks.map(id2 => { const tk = ALL_TASKS.find(x => x.id === id2); return tk ? tnr(tk) : id2 }).join(' + ')}
                            </span>
                          : (canEdit &&
                            <button onClick={() => setInputState(s => ({ ...s, [i.id]: { ...(s[i.id] || {}), status: 'geliefert' } }))}
                              className="text-[10.5px] px-2 py-0.5 rounded border"
                              style={{ borderColor: T.green + '88', color: T.green }}>
                              Als geliefert markieren
                            </button>)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Hard-Edge-Verletzungen */}
          {breaches.length > 0 && (
            <div className="rounded-xl border p-4" style={{ background: T.red + '10', borderColor: T.red }}>
              <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold" style={{ color: T.red }}>
                <Siren size={15} /> HARD-EDGE-VERLETZUNG — Termin über 30.06.2027 (alles muss bis dahin abgeschlossen sein)
              </div>
              <div className="space-y-1 text-[12px]">
                {breaches.map(b => (
                  <div key={b.id} className="flex flex-wrap items-center gap-2">
                    <span style={{ fontFamily: T.mono, color: T.red }}>{b.id}</span>
                    <span className="flex-1 min-w-[200px]">{b.name}</span>
                    <span style={{ fontFamily: T.mono }}>{b.owner}</span>
                    <b style={{ fontFamily: T.mono, color: T.red }}>+{b.days} T über der Kante</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Frühwarn-/Verzugsliste */}
          {alarms.length > 0 && (
            <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
              <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold" style={{ color: T.amber }}>
                <AlertTriangle size={15} /> Frühwarn- &amp; Verzugsliste
              </div>
              <div className="space-y-1 text-[12px]">
                {alarms.slice(0, 8).map(m => {
                  const st = statusOf(m, NOW); const s = slipDays(m, NOW)
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-2">
                      {m.critical && <Diamond size={11} style={{ color: T.brass }} fill={T.brass} />}
                      <span style={{ fontFamily: T.mono, color: T.inkDim }}>{m.id}</span>
                      <span className="flex-1 min-w-[200px]">{m.name}</span>
                      <Pill st={st} />
                      <span style={{ fontFamily: T.mono, color: st === 'delayed' ? T.red : T.amber }}>
                        {st === 'delayed'
                          ? (m.critical && !m.nachlauf ? `kritischer Pfad: Kern-Ende +${s} T` : `+${s} T (nicht endterminwirksam)`)
                          : `fällig ${fmtDate(m.due)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Darstellungs-Umschalter (B0): Abflugtafel ⇄ Arbeitsströme — gleiche Daten */}
          <div className="flex items-center gap-1.5">
            {[['tafel', 'Abflugtafel', Radar], ['stroeme', 'Arbeitsströme', Layers]].map(([id, lbl, Ic]) => (
              <button key={id} onClick={() => setTowerView(id)}
                className="flex items-center gap-1.5 px-3 py-1 rounded border text-[12px]"
                style={towerView === id
                  ? { borderColor: T.brass, color: T.brass, background: T.brass + '14' }
                  : { borderColor: T.line, color: T.inkDim }}>
                <Ic size={13} /> {lbl}
              </button>
            ))}
          </div>

          {/* Abflugtafel */}
          {towerView === 'tafel' && (
          <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: T.line }}>
              <div className="text-[13px] font-semibold tracking-widest" style={{ fontFamily: T.mono, color: T.brass }}>
                ── ABFLUGTAFEL · MEILENSTEINE ──
              </div>
              <div className="flex items-center gap-1.5 text-[12px] flex-wrap justify-end" style={{ color: T.inkDim }}>
                <input value={msSearch} onChange={e => setMsSearch(e.target.value)}
                  placeholder="Suchen: Code / Name / Owner…" aria-label="Meilensteine durchsuchen"
                  className="bg-transparent border rounded px-2 py-0.5 w-48"
                  style={{ borderColor: msSearch ? T.brass : T.line, background: T.panelSoft, color: T.ink }} />
                <Filter size={13} />
                <select value={wsFilter} onChange={e => setWsFilter(e.target.value)}
                  className="bg-transparent border rounded px-1.5 py-0.5"
                  style={{ borderColor: T.line, background: T.panelSoft, color: T.ink }}>
                  <option value="alle" style={{ color: '#111' }}>alle Ströme</option>
                  {BASE.workstreams.map(w => <option key={w.code} value={w.code} style={{ color: '#111' }}>{w.code} — {w.name?.slice(0, 40)}</option>)}
                </select>
                <select value={phaseFilter} onChange={e => setPhaseFilter(e.target.value)}
                  className="bg-transparent border rounded px-1.5 py-0.5"
                  style={{ borderColor: T.line, background: T.panelSoft, color: T.ink }}>
                  <option value="alle" style={{ color: '#111' }}>alle Phasen</option>
                  {rubPhases.map(ph => <option key={ph} value={ph} style={{ color: '#111' }}>{ph}</option>)}
                  {mpPhases.length > 0 && <option value="MP-ALL" style={{ color: '#111' }}>Masterplan (alle)</option>}
                  {mpPhases.map(ph => <option key={ph} value={ph} style={{ color: '#111' }}>{'  ' + phaseShort(ph)}</option>)}
                </select>
                <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
                  className="bg-transparent border rounded px-1.5 py-0.5"
                  style={{ borderColor: T.line, background: T.panelSoft, color: T.ink }}>
                  <option value="alle" style={{ color: '#111' }}>alle Verantwortlichen</option>
                  {owners.map(o => <option key={o} value={o} style={{ color: '#111' }}>{o.length > 34 ? o.slice(0, 34) + '…' : o}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
                    <th className="px-3 py-1.5 w-6"></th><th className="px-2 py-1.5">CODE</th>
                    <th className="px-2 py-1.5">MEILENSTEIN</th><th className="px-2 py-1.5">PHASE</th><th className="px-2 py-1.5">OWNER</th>
                    <th className="px-2 py-1.5">FÄLLIG</th><th className="px-2 py-1.5 w-36">FORTSCHRITT</th>
                    <th className="px-2 py-1.5">HANDLUNGEN</th>
                    <th className="px-2 py-1.5">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(m => {
                    const st = statusOf(m, NOW)
                    return (
                      <tr key={m.id} className={(st === 'delayed' ? 'row-delayed ' : '') + 'cursor-pointer hover:opacity-80'}
                        onClick={() => setSelMs(m)} title="Öffnen für Aufgaben-Definition (Briefing)"
                        tabIndex={0} role="button" aria-label={`${m.id} ${m.name} — Briefing öffnen`}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelMs(m) } }}
                        style={{ borderTop: `1px solid ${T.line}` }}>
                        <td className="px-3 py-1.5">{m.critical && <Diamond size={11} style={{ color: T.brass }} fill={T.brass} />}</td>
                        <td className="px-2 py-1.5" style={{ fontFamily: T.mono, color: T.inkDim }}>
                          {m.id}{m.nachlauf && <span title="gesetzlicher Nachlauf Q2/27" style={{ color: T.brass }}> ⏳</span>}
                          {m.gate && <span className="ml-1 text-[10px]" style={{ color: T.brass }}>{m.gate}</span>}
                        </td>
                        <td className="px-2 py-1.5">{m.name}{m.date_assumed && <span title="Termin = Monatsende (Annahme)" style={{ color: T.inkFaint }}> *</span>}</td>
                        <td className="px-2 py-1.5"><PhaseTag p={m.phase} /></td>
                        <td className="px-2 py-1.5" style={{ fontFamily: T.mono }}>{m.owner || <span style={{ color: T.grey }}>—</span>}</td>
                        <td className="px-2 py-1.5" style={{ fontFamily: T.mono }}>{fmtDate(m.due)}</td>
                        <td className="px-2 py-1.5" title={m.progress_source === 'tasks' ? 'Fortschritt VERDIENT — Roll-up aus Handlungen' : undefined}><Bar v={m.progress} /></td>
                        <td className="px-2 py-1.5" style={{ fontFamily: T.mono }}>{(() => {
                          const ts = tasksFor(m.id)
                          if (!ts.length) return <span style={{ color: T.grey }}>—</span>
                          const d = ts.filter(t => t.status === 'erledigt').length
                          const ov = ts.filter(taskOverdue).length
                          return (
                            <span title={`${d} von ${ts.length} Handlungen erledigt${ov ? ` · ${ov} überfällig` : ''}${m.progress_source === 'tasks' ? ' — treiben den Fortschritt' : ''}`}
                              style={{ color: ov ? T.red : d === ts.length ? T.blue : T.inkDim }}>
                              ☑ {d}/{ts.length}{ov ? ' ⚠' : ''}
                            </span>
                          )
                        })()}</td>
                        <td className="px-2 py-1.5"><Pill st={st} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-1.5 text-[10px] border-t" style={{ borderColor: T.line, color: T.inkFaint }}>
              ◆ = kritischer Pfad · ⏳ = gesetzlicher Nachlauf Q2/27 (zählt nicht gegen Kern-Ende) · * = Termin Monatsende (Annahme) · G1–G7 = Sequenz-Gates · ☑ x/y = Handlungen erledigt (bei aktiviertem Roll-up treiben sie den Fortschritt) · Suche + Filter oben: Strom × Phase × Owner
            </div>
          </div>
          )}

          {/* Arbeitsströme-Sicht (B0: ehem. eigener Tab — gleiche Meilensteine als WS-Karten) */}
          {towerView === 'stroeme' && (
          <div className="grid md:grid-cols-2 gap-4">
            {data.workstreams.map(ws => {
              const list = ws.milestones
              const withP = list.filter(m => typeof m.progress === 'number')
              const agg = withP.length ? Math.round(withP.reduce((a, m) => a + m.progress, 0) / withP.length) : null
              const phases = [...new Set(list.map(m => m.phase))]
              return (
                <div key={ws.code} className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold" style={{ fontFamily: T.mono, color: T.brass }}>{ws.code}</div>
                      <div className="text-[13px] font-medium">{ws.name}</div>
                      <div className="text-[11px]" style={{ color: T.inkDim }}>Owner: <b>{ws.owner}</b>{ws.support && ` · ${ws.support.slice(0, 70)}`}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold" style={{ fontFamily: T.mono, color: agg === null ? T.grey : T.green }}>
                        {agg === null ? '—' : agg + '%'}
                      </div>
                      <div className="text-[10px]" style={{ color: T.inkFaint }}>{list.length} MS{withP.length < list.length && ` · ${list.length - withP.length}× Lücke`}</div>
                      <a href={`/pakete/${ws.code}.pdf`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[10px] px-2 py-0.5 rounded border"
                        style={{ borderColor: T.brass, color: T.brass }}>
                        <FileText size={11} /> Owner-Paket (PDF)
                      </a>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 max-h-72 overflow-auto pr-1">
                    {phases.map(ph => (
                      <div key={ph || 'ohne'}>
                        {ph && <div className="text-[10px] uppercase tracking-wider mt-1 mb-0.5 sticky top-0 py-0.5"
                          style={{ color: T.brass, background: T.panel }}>{ph}</div>}
                        {list.filter(m => m.phase === ph).map(m => {
                          const st = statusOf(m, NOW)
                          return (
                            <div key={m.id} onClick={() => setSelMs({ ...m, _ws: ws.code, _wsName: ws.name })}
                              title="Klicken für Aufgaben-Definition (Briefing)"
                              className={`flex items-center gap-2 text-[11.5px] rounded px-1.5 py-1 cursor-pointer hover:opacity-80 ${st === 'delayed' ? 'row-delayed' : ''}`}>
                              {m.critical ? <Diamond size={10} style={{ color: T.brass }} fill={T.brass} /> : <span className="w-[10px]" />}
                              <span style={{ fontFamily: T.mono, color: T.inkFaint }}>{m.id}</span>
                              <span className="flex-1 truncate" title={m.name}>{m.name}</span>
                              <span style={{ fontFamily: T.mono, color: T.inkDim }}>{fmtDate(m.due)}</span>
                              <Pill st={st} />
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          )}

          {/* CoS-Steuerung (B0: ehem. eigener Tab — Durchsetzung gehört zu den Datenlieferungen) */}
          {canAny(role, 'reminder.entwerfen') && (<>
            <div className="rounded-lg border px-4 py-2 text-[12px] flex items-center gap-2"
              style={{ borderColor: T.amber + '88', background: T.amber + '14', color: T.amber }}>
              <Siren size={14} /> <b>Reminder = echte Gmail-ENTWÜRFE</b> (je Owner gebündelt · 7-Tage-Bremse · Versand bleibt bei DRS — K2 Stufe 1, 01.08.).
              Kalender &amp; Eskalation bleiben <b>SIMULIERT</b> — Führungssignale gehen nie automatisch raus (Spez mcp/calendar_bridge.md).
            </div>
            <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold">Durchsetzungs-Queue — überfällige Inputs ({overdueInputs.length})</div>
                <button onClick={() => reminderDrafts('alle')}
                  disabled={remBusy}
                  title="Alle überfälligen Datenlieferungen + Handlungen — ein Gmail-Entwurf je Owner; DRS sendet"
                  className="text-[12px] px-3 py-1 rounded border flex items-center gap-1.5"
                  style={{ borderColor: T.brass, color: T.brass, opacity: remBusy ? .4 : 1 }}>
                  <Send size={13} /> {remBusy ? 'erzeugt…' : 'Alle Reminder als Gmail-Entwürfe'}
                </button>
              </div>
              {overdueInputs.length === 0 && <div className="text-[12px]" style={{ color: T.green }}>Keine überfälligen Inputs. ✓</div>}
              <div className="space-y-2">
                {overdueInputs.map(i => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 text-[12px] rounded border p-2"
                    style={{ borderColor: T.red + '55', background: T.red + '0d' }}>
                    <b style={{ fontFamily: T.mono }}>{i.owner}</b>
                    <span className="flex-1 min-w-[220px]">{i.item}</span>
                    <span style={{ fontFamily: T.mono, color: T.red }}>{fmtDate(i.due)} (+{daysBetween(parseDate(i.due), NOW)} T)</span>
                    <button onClick={() => reminderDrafts({ ids: [i.id] })} disabled={remBusy} className="px-2 py-0.5 rounded border text-[11px]"
                      title="Gmail-Entwurf für diesen Owner erzeugen — DRS sendet"
                      style={{ borderColor: T.brass + '88', color: T.brass }}><Send size={11} className="inline mr-1" />Gmail-Entwurf</button>
                    <button onClick={() => remind(i, 'Kalender-Koordination')} className="px-2 py-0.5 rounded border text-[11px]"
                      style={{ borderColor: T.line, color: T.ink }}><CalendarClock size={11} className="inline mr-1" />Kalender</button>
                    <button onClick={() => remind(i, 'ESKALATION (Stufe +1)')} className="px-2 py-0.5 rounded border text-[11px]"
                      style={{ borderColor: T.red + '88', color: T.red }}><Siren size={11} className="inline mr-1" />Eskalieren</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
                <div className="text-[13px] font-semibold mb-2">Reminder-Protokoll <span className="text-[10px]" style={{ color: T.inkFaint }}>(persistent — reminder_log.json)</span></div>
                {!(REMLOG.reminders || []).length && <div className="text-[12px]" style={{ color: T.inkFaint }}>Noch keine Reminder-Entwürfe erzeugt.</div>}
                <div className="space-y-1 text-[12px]">
                  {(REMLOG.reminders || []).slice(0, 15).map((r, k) => (
                    <div key={k} style={{ color: T.inkDim }}>
                      <span style={{ fontFamily: T.mono, color: T.inkFaint }}>{(r.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                      {' · '}<b style={{ color: T.ink }}>{r.owner}</b>{r.email ? '' : ' (ohne Empfänger)'}
                      {' · '}<span style={{ fontFamily: T.mono }}>{(r.items || []).join(', ')}</span>
                      {' · '}<span style={{ color: T.brass, fontFamily: T.mono }}>{r.mode}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
                <div className="text-[13px] font-semibold mb-2">Automations-Log <span className="text-[10px]" style={{ color: T.inkFaint }}>(Session)</span></div>
                {autoLog.length === 0 && <div className="text-[12px]" style={{ color: T.inkFaint }}>Noch keine Automationen ausgelöst.</div>}
                <div className="space-y-1 text-[12px]" style={{ fontFamily: T.mono }}>
                  {autoLog.map((l, k) => (
                    <div key={k} style={{ color: T.inkDim }}>
                      {l.ts.toLocaleTimeString('de-CH')} · {l.msg}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>)}
        </>)}

      </main>

      {selMs && <BriefingModal m={selMs} role={role} me={me} onClose={() => setSelMs(null)} onNav={(d) => navMs(selMs, d)} />}

      {/* Intro als ⓘ-Overlay (B0, 01.08. — ehem. eigener Tab) */}
      {showIntro && (
        <div className="fixed inset-0 z-50 overflow-auto p-3 md:p-8" style={{ background: '#000c' }} onClick={() => setShowIntro(false)}>
          <div className="max-w-6xl mx-auto rounded-xl border p-4 md:p-5" style={{ background: T.bg, borderColor: T.brass + '66' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] font-semibold tracking-widest" style={{ fontFamily: T.mono, color: T.brass }}>── PROGRAMM-ÜBERSICHT ──</div>
              <button onClick={() => setShowIntro(false)} aria-label="Schliessen"
                className="p-1.5 rounded border" style={{ borderColor: T.line, color: T.inkDim }}><X size={15} /></button>
            </div>
            <IntroView data={data} goStreams={() => { setShowIntro(false); setTab('tower'); setTowerView('stroeme') }} />
          </div>
        </div>
      )}

      <footer className="px-6 py-3 text-[10px] border-t" style={{ borderColor: T.line, color: T.inkFaint, fontFamily: T.mono }}>
        RUBICON Control Tower · Wahrheitsquelle: src/data/projekt.yaml · Statuslogik deterministisch (status.js) ·
        Erfasste Sitzungen/Reports werden persistiert · Reminder = Gmail-Entwürfe (DRS sendet) · Kalender/Eskalation simuliert · Vertraulich ExBoD/VR
      </footer>
    </div>
  )
}

// ── Δ WOCHE (B2, 01.08.) — Führungs-Delta: erledigte Handlungen, Fortschritts-/
// Ampel-Änderungen (git-Vergleich), neue Protokolle/Entscheide. Reine Fakten.
function DeltaWoche() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch('/api/delta?days=7')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(j => (j.ok ? setD(j) : setErr(j.error || 'Fehler')))
      .catch(e => setErr(String(e)))
  }, [])
  if (err) return null   // Delta ist Komfort — bei Fehlern still weglassen (Log hat den Fehler)
  if (!d) return <div className="text-[11px]" style={{ color: T.inkFaint, fontFamily: T.mono }}>Δ Woche wird berechnet…</div>
  const s = d.summe || {}
  const none = !s.erledigt && !s.fortschritt && !s.ampel && !s.protokolle && !s.entscheide
  const cap = (arr, n = 8) => ({ show: arr.slice(0, n), rest: Math.max(0, arr.length - n) })
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
      <div className="px-4 py-2 text-[12px] font-semibold border-b flex flex-wrap items-center gap-2" style={{ borderColor: T.line }}>
        <span style={{ fontFamily: T.mono, color: T.brass }}>── Δ WOCHE ({fmtDate(d.fenster.von)} – {fmtDate(d.fenster.bis)}) ──</span>
        <span className="font-normal text-[11px]" style={{ color: T.inkDim }}>
          {s.erledigt} erledigt · {s.fortschritt} Fortschritts-Änderungen · {s.ampel} Ampel-Wechsel · {s.protokolle} Protokolle · {s.entscheide} Entscheide
        </span>
        {d.basis && <span className="font-normal text-[10px] ml-auto" style={{ color: T.inkFaint, fontFamily: T.mono }}>Basis: {d.basis}</span>}
      </div>
      {none
        ? <div className="px-4 py-3 text-[12px]" style={{ color: T.inkFaint }}>Keine Veränderungen im Fenster.</div>
        : (
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-[12px]">
            {s.ampel > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T.amber, fontFamily: T.mono }}>Ampel-Wechsel</div>
                {cap(d.ampel).show.map((x, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <span style={{ fontFamily: T.mono, color: T.inkDim }}>{x.id}</span>
                    <span className="flex-1 truncate" title={x.name}>{x.name}</span>
                    <Pill st={x.von} /> <span style={{ color: T.inkFaint }}>→</span> <Pill st={x.zu} />
                  </div>
                ))}
                {cap(d.ampel).rest > 0 && <div className="text-[10px]" style={{ color: T.inkFaint }}>+ {cap(d.ampel).rest} weitere</div>}
              </div>
            )}
            {s.fortschritt > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T.green, fontFamily: T.mono }}>Fortschritt</div>
                {cap(d.fortschritt).show.map((x, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <span style={{ fontFamily: T.mono, color: T.inkDim }}>{x.id}</span>
                    <span className="flex-1 truncate" title={x.name}>{x.name}</span>
                    <b style={{ fontFamily: T.mono, color: T.green }}>{x.von ?? '—'}% → {x.zu ?? '—'}%</b>
                  </div>
                ))}
                {cap(d.fortschritt).rest > 0 && <div className="text-[10px]" style={{ color: T.inkFaint }}>+ {cap(d.fortschritt).rest} weitere</div>}
              </div>
            )}
            {s.erledigt > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T.blue, fontFamily: T.mono }}>Erledigte Handlungen</div>
                {cap(d.erledigt).show.map((x, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <span style={{ fontFamily: T.mono, color: T.brass }}>{x.nr}</span>
                    <span className="flex-1 truncate" title={x.text}>{x.text}</span>
                    <span style={{ fontFamily: T.mono, color: T.inkFaint }}>{x.owner || ''} · {fmtDate(x.am)}</span>
                  </div>
                ))}
                {cap(d.erledigt).rest > 0 && <div className="text-[10px]" style={{ color: T.inkFaint }}>+ {cap(d.erledigt).rest} weitere</div>}
              </div>
            )}
            {(s.protokolle > 0 || s.entscheide > 0) && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: T.brass, fontFamily: T.mono }}>Protokolle & Entscheide</div>
                {d.protokolle.map((p, i) => (
                  <div key={'p' + i} className="py-0.5" style={{ color: T.inkDim }}>
                    <span style={{ fontFamily: T.mono, color: T.inkFaint }}>{fmtDate(p.datum)}</span> {p.meeting} <span style={{ color: T.inkFaint }}>({p.eintraege} Einträge)</span>
                  </div>
                ))}
                {d.entscheide.map((x, i) => (
                  <div key={'e' + i} className="py-0.5" style={{ color: T.inkDim }}>
                    <span style={{ fontFamily: T.mono, color: T.brass }}>{x.id}</span> {x.titel} <span style={{ fontFamily: T.mono, color: T.inkFaint }}>[{x.status}]</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  )
}

// ── FRAG DIE DATEN (K7, 01.08.) — read-only NL-Abfrage über die Plattform-Stores.
// Harte Quellenbindung (IDs zitieren, «nicht in den Daten» statt raten); alle Rollen.
function FragDieDaten() {
  const [frage, setFrage] = useState('')
  const [busy, setBusy] = useState(false)
  const [antwort, setAntwort] = useState(null)
  const [err, setErr] = useState(null)
  const ask = async () => {
    const f = frage.trim()
    if (!f || busy) return
    setBusy(true); setErr(null); setAntwort(null)
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frage: f }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) setAntwort(j.antwort)
      else setErr(j.error || 'unbekannt')
    } catch (e2) { setErr(String(e2)) }
    setBusy(false)
  }
  return (
    <div className="rounded-xl border p-3" style={{ background: T.panel, borderColor: T.line }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wide" style={{ fontFamily: T.mono, color: T.brass }}>🤖 FRAG DIE DATEN</span>
        <input value={frage} onChange={e => setFrage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }}
          placeholder="z.B. «Welche kritischen Meilensteine von Stephanie Rohde sind vor dem 31.10. fällig?»"
          aria-label="Frage an die Plattform-Daten" maxLength={500}
          className="flex-1 min-w-[280px] rounded border px-3 py-1.5 text-[12px]"
          style={{ background: T.panelSoft, borderColor: T.line, color: T.ink }} />
        <button onClick={ask} disabled={busy || !frage.trim()} className="px-3 py-1.5 rounded border text-[12px]"
          style={{ borderColor: T.brass, color: T.brass, opacity: busy || !frage.trim() ? .5 : 1 }}>
          {busy ? 'liest… (~20-40s)' : 'Fragen'}
        </button>
        <span className="text-[10px]" style={{ color: T.inkFaint }}>read-only · antwortet NUR aus projekt.yaml/Handlungen/Entscheiden, mit IDs belegt</span>
      </div>
      {err && <div className="mt-2 text-[11.5px]" style={{ color: T.red }}>Abfrage fehlgeschlagen: {err}</div>}
      {antwort && (
        <div className="mt-2 rounded border p-3 text-[12px] whitespace-pre-wrap" style={{ borderColor: T.brass + '44', background: T.panelSoft + '55', color: T.ink }}>
          {antwort}
          <div className="mt-2 pt-1.5 border-t text-[10px]" style={{ borderColor: T.line, color: T.inkFaint }}>
            KI-Antwort (Sonnet) auf Basis des Plattform-Stands — bei Entscheidungsrelevanz im Tower/Register gegenprüfen.
          </div>
        </div>
      )}
    </div>
  )
}

// ── INTRO-PAGE: Sinn & Zweck · WS-Übersicht (grafisch, Live-Ampeln) · Zeitachse ──
// Inhalte aus RUBICON-Doc v2 (Sektionen 1–3, 7); Ströme/Status live aus projekt.yaml.
function IntroView({ data, goStreams }) {
  const now = parseDate(data.meta.today)
  const ZIELE = [
    { v: "≥12'372", l: 'EBITDA-Run-Rate CHF k (Ambition 15’000) — heute FY25A +323' },
    { v: '−30%', l: 'Zentralkosten auf ≤ ~2’800 TEUR (Ratio ~1.4% → ~1.0%)' },
    { v: '−50%', l: 'Run-Rate Top-3-Verlustquellen (FY25A ≈ −10’302 TEUR)' },
    { v: '≥90%', l: 'Execution-Rate Commitments (heute ≤50%)' },
  ]
  const MERKMALE = [
    ['Eine Gruppe, eine Wahrheit', 'Art.-963-Konzernkonsolidierung; eine Finance-Linie, eine Plattform, eine Mail-Domain'],
    ['Kostenführerschaft', 'Zentralkosten −30%; Cost-per-Turn transparent; Verlustquellen entschieden & halbiert'],
    ['Klare Accountability', 'Ein P&L-Owner je Einheit; GL = 6; JD-Kaskade aus dem Chairman-2-Pager'],
    ['Execution-Disziplin', 'Tracking auf dem Gruppen-Tracker; Entscheids-Queue; Konsequenz-Mechanik'],
    ['Guter, stabiler Ground Handler', 'Ops-Excellence-Scorecard je Station; SLA-Schutzschirm; Kundennähe gesichert'],
  ]
  // Zeitachse Jul 26 – Jun 27 (12 Monate); Position = Monatsanteil in %
  const MONTHS = ['Jul 26', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez', 'Jan 27', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun 27']
  const pos = (m, frac = 0) => ((m + frac) / 12 * 100).toFixed(1) + '%'
  const MS = [
    { p: pos(1, .4), lbl: '15.08. Zielsystem-Entscheide', top: 6 },
    { p: pos(1, .9), lbl: '28.08. Gates AAST/BER', top: 24 },
    { p: pos(2, .03), lbl: '01.09. Kickoff (M1)', top: 6, brass: true },
    { p: pos(3, .5), lbl: '15.10. Diagnose-Review G2', top: 13 },
    { p: pos(3, .97), lbl: '31.10. Closing (G6)', top: 6, red: true },
    { p: pos(5, .5), lbl: 'Dez · Q4-VR: TOM', top: 13 },
    { p: pos(6, .97), lbl: '31.01. Eurowings DUS', top: 6, red: true },
    { p: pos(8, .5), lbl: 'Mär · §111/§17 eingeleitet', top: 13 },
    { p: pos(9, .95), lbl: 'Ende Apr · Zielnachweis + Übergabe', top: 6, brass: true },
    { p: pos(11, .97), lbl: '30.06. HARD EDGE — alles abgeschlossen', top: 24, red: true, right: true },
  ]
  // Phasen mit Ziel je Phase (aus RUBICON-Doc §5.2–5.5.1). matchPhase = welche
  // projekt.yaml-Phasenwerte zu dieser Karte gehören (für den Live-MS-Zähler).
  const PHASEN = [
    { nr: '0', c: T.brass, name: 'Diagnose & Baseline', span: 'Sep–Okt 26 · M1–M2',
      ziel: 'Ehrliche Ausgangsbasis schaffen — alles cash-neutral. Datenlücken schliessen, GL = 6 bereinigen, Führungsrhythmus scharfstellen. Kein Zielwert vor validierter Baseline (Gate G2, 15.10.).',
      match: ['Phase 0'] },
    { nr: '1', c: T.green, name: 'Design', span: 'Okt–Dez 26 · M2–M4',
      ziel: 'Verbindliche Zielstruktur beschliessen: TOM-Blueprint (Elysium 2.0) VR-genehmigt, Organigramm v2 + JD-Kaskade, P&L-Owner-Matrix, Commitment-Tracker live. Finanzierungs-Closing (G6) = ab hier cash-wirksame Schritte.',
      match: ['Phase 1'] },
    { nr: '2', c: T.blue, name: 'Implementierung', span: 'Jan–Mär 27 · M5–M7',
      ziel: 'Struktur wird real, Kosten sinken: eine Finance-Linie operativ, DE-GF-Entflechtung, Zentralkosten −30% entschieden, Execution-Rate ≥ 80 %. Restrukturierungs-Verfahren (§111/§17) eingeleitet; Eurowings verlängert.',
      match: ['Phase 2'] },
    { nr: '3', c: T.brass, name: 'Zielnachweis & Verankerung', span: 'Apr 27 · M8',
      ziel: 'Programm liefert und geht in den Linienbetrieb: Zielbild-Nachweis (Kosten −30 %, Execution ≥ 90 %), MOS-Audit (Chairman-Unabhängigkeit), Übergabe in die Linie, Schlussbericht an GL/VR.',
      match: ['Phase 3'] },
    { nr: '⏳', c: T.red, name: 'Gesetzlicher Nachlauf', span: 'bis 30.06.27 · HARD EDGE',
      ziel: 'Alles komplett abgeschlossen: arbeitsrechtlich gebundene Effekte werden wirksam (BER-/AAS-Technics-Restrukturierung, Entity-Bereinigung, voller EBITDA-Run-Rate) — bis Apr 27 eingeleitet, gesetzlich nicht früher realisierbar.',
      match: ['Nachlauf Q2/27'] },
  ]
  const allMs = data.workstreams.flatMap(w => w.milestones)
  const phaseCount = (match) => allMs.filter(m => match.some(x => (m.phase || '').includes(x))).length
  const heute = pos(0, .2)
  return (
    <div className="space-y-5 max-w-6xl">
      {/* ── 1 · Sinn & Zweck ── */}
      <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.brass + '55' }}>
        <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Sinn &amp; Zweck · «Alea iacta est.»
        </div>
        <div className="text-[15px] leading-relaxed" style={{ color: T.ink }}>
          Projekt RUBICON macht AXS in <b>8 Monaten</b> (01.09.2026 → 30.04.2027, alles abgeschlossen bis
          <b style={{ color: T.red }}> HARD EDGE 30.06.2027</b>) zu einer <b>integriert geführten, kostenschlanken
          Gruppe mit einer klaren Organisation und eindeutiger Accountability</b> — aus eigener Kraft, unabhängig
          vom Finanzierungsprozess (Projekt #98 = Parallel-Achse). Es konsolidiert <b>alle</b> bisherigen Pläne
          und Tools — Transformationsagenda, Chairman-Tracker, Commercial-Masterplan — in <b>einem Programm auf
          dieser einen Plattform</b>. Voraussetzung für die Gruppenstrategie Top-3 EU 2030 (&gt;EUR 600 Mio).
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {ZIELE.map((z, i) => (
            <div key={i} className="rounded-lg border p-3" style={{ background: T.panelSoft, borderColor: T.line, borderTop: `2.5px solid ${T.brass}` }}>
              <div className="text-2xl font-bold" style={{ fontFamily: T.mono, color: T.brass }}>{z.v}</div>
              <div className="text-[10.5px] mt-1" style={{ color: T.inkDim }}>{z.l}</div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-5 gap-2 mt-3">
          {MERKMALE.map(([t, d], i) => (
            <div key={i} className="rounded border p-2" style={{ borderColor: T.line }}>
              <div className="text-[11px] font-bold" style={{ color: T.ink }}><span style={{ color: T.brass, fontFamily: T.mono }}>{i + 1}</span> · {t}</div>
              <div className="text-[10px] mt-0.5" style={{ color: T.inkFaint }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2 · Arbeitsströme (grafisch, Live-Status) ── */}
      <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.line }}>
        <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Programmarchitektur — DRS steuert &amp; kontrolliert · AFR + CGO treiben · GL-6 liefert
        </div>
        <div className="rounded-lg border px-4 py-2 text-center text-[12px] mb-2" style={{ borderColor: T.brass, color: T.ink, background: T.panelSoft }}>
          <b style={{ color: T.brass }}>DRS — Eigentümer &amp; Chairman:</b> steuert + kontrolliert (Cockpit + VR) — über dem Maschinenraum
        </div>
        <div className="text-center text-[10px]" style={{ color: T.inkFaint }}>▼</div>
        <div className="rounded-lg px-4 py-2 text-center text-[12px] mb-2" style={{ background: T.brass, color: '#0b1220' }}>
          <b>AFR + CGO — treiben die Umsetzung</b> · CGO = Ops-Energie + öffentliches Gesicht · AFR = Struktur / Disziplin / Finanz / Verhandlung
        </div>
        <div className="text-center text-[10px] mb-2" style={{ color: T.inkFaint }}>▼ GL-6-Funktions-Owner liefern ▼</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {data.workstreams.map(ws => {
            const sts = ws.milestones.map(m => statusOf(m, now))
            const worst = ['delayed', 'atRisk', 'unknown', 'onTrack', 'done'].find(s => sts.includes(s)) || 'unknown'
            const done = sts.filter(s => s === 'done').length
            return (
              <button key={ws.code} onClick={goStreams}
                className="rounded-lg border p-2.5 text-left hover:opacity-85"
                style={{ background: T.panelSoft, borderColor: STATUS_META[worst].color + '66', borderTop: `3px solid ${STATUS_META[worst].color}` }}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[12px]" style={{ fontFamily: T.mono, color: T.brass }}>{ws.code}</span>
                  <Pill st={worst} />
                </div>
                <div className="text-[10.5px] mt-1 leading-tight" style={{ color: T.ink }}>{ws.name.split('(')[0].trim()}</div>
                <div className="text-[10px] mt-1" style={{ fontFamily: T.mono, color: T.inkDim }}>{ws.owner} · {ws.milestones.length} MS · {done} ✓</div>
              </button>
            )
          })}
        </div>
        <div className="text-[9.5px] mt-2" style={{ color: T.inkFaint }}>
          Ampel je Strom = schlechtester Milestone-Status (live aus projekt.yaml) · Klick öffnet die Strom-Detailsicht
        </div>
      </div>

      {/* ── 3 · Phasen (Ziel je Phase) ── */}
      <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.line }}>
        <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Die 4 Phasen + Nachlauf — Ziel je Phase
        </div>
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">
          {PHASEN.map(ph => (
            <div key={ph.nr} className="rounded-lg border p-3 flex flex-col" style={{ background: T.panelSoft, borderColor: ph.c + '55', borderTop: `3px solid ${ph.c}` }}>
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center rounded-full text-[13px] font-bold"
                  style={{ width: 24, height: 24, background: ph.c + '22', color: ph.c, fontFamily: T.mono }}>{ph.nr}</span>
                <div>
                  <div className="text-[12px] font-bold" style={{ color: T.ink }}>{ph.nr === '⏳' ? '' : 'Phase '}{ph.name}</div>
                  <div className="text-[9.5px]" style={{ fontFamily: T.mono, color: ph.c }}>{ph.span}</div>
                </div>
              </div>
              <div className="text-[10.5px] mt-2 leading-snug flex-1" style={{ color: T.inkDim }}>{ph.ziel}</div>
              <div className="text-[9px] mt-2 pt-1.5 border-t" style={{ borderColor: T.line, fontFamily: T.mono, color: T.inkFaint }}>{phaseCount(ph.match)} Meilensteine</div>
            </div>
          ))}
        </div>
        <div className="text-[9.5px] mt-2" style={{ color: T.inkFaint }}>
          Führungslogik quer über alle Phasen: <b style={{ color: T.brass }}>DRS steuert &amp; kontrolliert</b> · AFR + CGO treiben · GL-6 liefert.
        </div>
      </div>

      {/* ── 4 · Zeitachse ── */}
      <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.line }}>
        <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Zeitachse — 8-Monats-Kernumsetzung + Nachlauf bis Hard Edge
        </div>
        <div className="grid text-[9px]" style={{ gridTemplateColumns: 'repeat(12,1fr)', color: T.inkFaint, fontFamily: T.mono }}>
          {MONTHS.map(mo => <div key={mo} className="text-center border-l" style={{ borderColor: T.line + '88' }}>{mo}</div>)}
        </div>
        <div className="relative mt-1" style={{ height: '12px' }}>
          {[['Vorlauf', 0, 16.7, T.grey], ['Phase 0', 16.7, 12.5, T.brass], ['Phase 1', 29.2, 20.8, T.green],
            ['Phase 2', 50, 25, T.blue], ['Phase 3 · Zielnachweis', 75, 8.3, T.brass], ['Nachlauf', 83.3, 16.7, T.red]]
            .map(([l, x, w, c]) => (
              <div key={l} className="absolute h-3 rounded-sm flex items-center justify-center overflow-visible"
                style={{ left: x + '%', width: w + '%', background: c + '33', border: `1px solid ${c}`, fontSize: 8, color: c, whiteSpace: 'nowrap' }}>
                {l}
              </div>
            ))}
        </div>
        <div className="relative mt-1" style={{ height: '64px' }}>
          {/* Heute-Marker */}
          <div className="absolute" style={{ left: heute, top: 0, bottom: 0, width: 1.5, background: T.green }} />
          <div className="absolute text-[8.5px]" style={{ left: heute, top: 46, color: T.green, fontFamily: T.mono }}>▲ heute ({fmtDate(data.meta.today)})</div>
          {MS.map((m, i) => (
            <React.Fragment key={i}>
              <div className="absolute w-2 h-2" style={{ left: m.p, top: 2, transform: 'rotate(45deg)', background: m.red ? T.red : m.brass ? T.brass : T.inkDim }} />
              <div className="absolute text-[8.5px] leading-tight" style={{ left: m.p, top: m.top + 6, width: '9%', minWidth: 64, color: m.red ? T.red : T.inkDim, ...(m.right ? { transform: 'translateX(-92%)', textAlign: 'right' } : {}) }}>{m.lbl}</div>
            </React.Fragment>
          ))}
        </div>
        <div className="text-[9.5px]" style={{ color: T.inkFaint }}>
          Rot = harte externe Kanten · Basislinie Kern-Ende {fmtDate(data.meta.baseline_end)} · <b style={{ color: T.red }}>HARD EDGE {fmtDate(data.meta.hard_edge)} — alles komplett abgeschlossen (DRS)</b>
        </div>
      </div>

      {/* ── 5 · Führungsrhythmus ── */}
      <FuehrungsrhythmusCard />
    </div>
  )
}

// Führungsrhythmus-One-Pager auf der Frontseite (welche Meetings · mit wem · wann ·
// Output-Erwartung). Native Tabelle + druckbare PDF-Fassung. Quelle: fuehrungsrhythmus.json.
function FuehrungsrhythmusCard() {
  return (
    <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.brass + '55' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest" style={{ color: T.inkFaint, fontFamily: T.mono }}>
            Führungsrhythmus (MOS) — welche Meetings · mit wem · wann · welcher Output
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: T.inkDim }}>{FR.untertitel}</div>
        </div>
        <a href="/fuehrungsrhythmus.pdf" target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap"
          style={{ borderColor: T.brass, color: T.brass }}>
          <FileText size={13} /> One-Pager als PDF
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ minWidth: 820 }}>
          <thead>
            <tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
              <th className="px-2 py-1.5">MEETING</th><th className="px-2 py-1.5">WANN</th>
              <th className="px-2 py-1.5">MIT WEM</th><th className="px-2 py-1.5">ZWECK</th>
              <th className="px-2 py-1.5">OUTPUT-ERWARTUNG → WOHIN</th>
              <th className="px-2 py-1.5">TRAKTANDENLISTE</th>
            </tr>
          </thead>
          <tbody>
            {FR.gruppen.map(g => (
              <React.Fragment key={g.kadenz}>
                <tr>
                  <td colSpan={5} className="px-2 py-1" style={{ background: T.panelSoft }}>
                    <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: FR_COL[g.farbe] }} />
                    <b style={{ color: FR_COL[g.farbe], fontFamily: T.mono, fontSize: 10 }}>{g.kadenz.toUpperCase()}</b>
                  </td>
                </tr>
                {g.meetings.map((m, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td className="px-2 py-1.5" style={{ color: T.ink, fontWeight: 600 }}>{m.name}</td>
                    <td className="px-2 py-1.5" style={{ fontFamily: T.mono, color: T.inkDim }}>{m.wann}</td>
                    <td className="px-2 py-1.5" style={{ color: T.inkDim }}>{m.teilnehmer}</td>
                    <td className="px-2 py-1.5" style={{ color: T.inkDim }}>{m.zweck}</td>
                    <td className="px-2 py-1.5" style={{ color: T.brass }}>{m.output}</td>
                    <td className="px-2 py-1.5">
                      {AGENDA_BY_ID[m.id] ? (
                        <div className="flex flex-col gap-1" style={{ minWidth: 58 }}>
                          <a href={`/traktanden/${m.id}.pdf`} target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded border text-[10px]"
                            style={{ borderColor: T.brass, color: T.brass }}>
                            <FileText size={10} /> PDF
                          </a>
                          {TRAKT_DOCS[m.id] && (
                            <a href={`https://docs.google.com/document/d/${TRAKT_DOCS[m.id]}/edit`} target="_blank" rel="noreferrer"
                              className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded border text-[10px]"
                              style={{ borderColor: T.blue, color: T.blue }}>
                              <FileText size={10} /> Doc
                            </a>
                          )}
                        </div>
                      ) : <span style={{ color: T.inkFaint }}>—</span>}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded p-2.5 text-[10.5px]" style={{ background: T.panelSoft, borderLeft: `2.5px solid ${T.brass}` }}>
        <b style={{ color: T.brass }}>Grundsätze:</b>
        <ul className="mt-1 space-y-0.5" style={{ color: T.inkDim }}>
          {FR.grundsaetze.map((p, i) => <li key={i}>· {p}</li>)}
        </ul>
      </div>
    </div>
  )
}

// ── SITZUNG ERFASSEN — Sitzungs-Output strukturiert erfassen (5 Typen),
// schreibt via /api/sitzung in projekt.yaml (Fortschritt/Blocker) + protokolle.json.
const AGENDA_BY_ID = Object.fromEntries((AGENDAS.agendas || []).map(a => [a.meeting_id, a]))
// Erfassbar sind NUR echte Tower-Sitzungen (typ 'sitzung') — Reports/Backbone sind keine
// Meetings, Ops-Ebene bleibt ausserhalb, VR läuft in Sherpany (typ 'extern'). (01.08.)
const FR_MEETINGS = FR.gruppen.flatMap(g => g.meetings.filter(m => (m.typ || 'sitzung') === 'sitzung').map(m => ({ id: m.id, name: m.name })))

// K1 (01.08.): Meet-Notiz (Gemini) → Vorschau → Übernahme. PRIMÄRWEG für
// Sitzungsprotokolle; das manuelle Formular darunter bleibt Fallback (Meetings
// ohne Gemini-Notiz, Ad-hoc-Gespräche). Immer Mensch im Loop: «Suchen & Vorschau»
// = Dry-Run (nichts geschrieben) → «Übernehmen» = regulärer /api/sitzung-Pfad.
function GeminiImport({ role, me }) {
  const realToday = new Date().toISOString().slice(0, 10)
  const [meetingId, setMeetingId] = useState(FR_MEETINGS[0]?.id || '')
  const [on, setOn] = useState(realToday)
  const [days, setDays] = useState(1)
  const [sensitiv, setSensitiv] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }

  async function call(post, docId) {
    setBusy(true)
    if (!post) setRes(null)
    try {
      const r = await fetch('/api/gemini/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, meeting_id: meetingId, on, days, sensitiv, doc_id: docId || undefined, post }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (post && j.ok && j.posted?.ok) {
        alert(`Sitzung übernommen (${j.posted.id}).`
          + ((j.posted.mirrored || []).length ? ` ${j.posted.mirrored.length} Commitment(s) als Handlungen gespiegelt.` : '')
          + (j.posted.sensitiv ? ' 🔒 sensitiv (nur lokal).' : ''))
        sessionStorage.setItem('rubicon_tab', 'sitzungen')
        reloadKeepScroll()
        return
      }
      setRes(j)
    } catch (err) { setRes({ ok: false, error: String(err) }) }
    setBusy(false)
  }

  const p = res?.ok ? res.payload : null
  return (
    <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.brass + '55' }}>
      <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: T.inkFaint, fontFamily: T.mono }}>
        Aus Meet-Notiz importieren (Gemini) — Primärweg: Vorschau, dann Übernahme
      </div>
      <div className="text-[11px] mb-3" style={{ color: T.inkDim }}>
        Sucht die «Notizen von Gemini»-Doc zum Meeting, zeigt ALLE erkannten Einträge zur Prüfung — geschrieben wird erst nach «Übernehmen». Erzeugt nie Fortschritt/Verzug aus Prosa.
      </div>
      <div className="flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Meeting</span>
          <select value={meetingId} onChange={e => setMeetingId(e.target.value)} className="rounded border px-2 py-1" style={inp}>
            {FR_MEETINGS.map(m => <option key={m.id} value={m.id} style={{ color: '#111' }}>{m.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Meeting-Tag</span>
          <input type="date" value={on} onChange={e => setOn(e.target.value)} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} /></label>
        <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Suchfenster</span>
          <select value={days} onChange={e => setDays(+e.target.value)} className="rounded border px-2 py-1" style={inp}>
            <option value={1} style={{ color: '#111' }}>nur dieser Tag</option>
            <option value={3} style={{ color: '#111' }}>3 Tage rückwärts</option>
            <option value={7} style={{ color: '#111' }}>7 Tage rückwärts</option>
          </select></label>
        <label className="flex items-center gap-1.5 pb-1 cursor-pointer" style={{ color: sensitiv ? T.red : T.inkDim }}>
          <input type="checkbox" checked={sensitiv} onChange={e => setSensitiv(e.target.checked)} /> 🔒 Sensitiv
        </label>
        <button onClick={() => call(false)} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border font-semibold text-[12px]"
          style={{ borderColor: T.brass, color: T.brass, opacity: busy ? .5 : 1 }}>
          {busy ? 'sucht…' : 'Notiz suchen & Vorschau'}
        </button>
      </div>

      {res && !res.ok && res.error === 'not_found' && (
        <div className="mt-3 text-[12px] rounded border p-2" style={{ borderColor: T.amber + '88', color: T.amber }}>
          Keine Gemini-Notiz für dieses Meeting im Fenster {res.fenster} gefunden — Fenster erweitern, Meeting-Tag prüfen oder unten manuell erfassen.
        </div>
      )}
      {res && !res.ok && res.error === 'ambiguous' && (
        <div className="mt-3 text-[12px] rounded border p-2 space-y-1" style={{ borderColor: T.amber + '88', color: T.inkDim }}>
          <b style={{ color: T.amber }}>Mehrdeutig — {res.kandidaten.length} Notizen im Fenster {res.fenster}. Welche?</b>
          {res.kandidaten.map(k => (
            <div key={k.id} className="flex items-center gap-2">
              <span style={{ fontFamily: T.mono, color: T.inkFaint }}>{k.datum}</span>
              <span className="flex-1 truncate">{k.name}</span>
              <button onClick={() => call(false, k.id)} disabled={busy} className="px-2 py-0.5 rounded border text-[11px]"
                style={{ borderColor: T.brass, color: T.brass }}>diese verwenden</button>
            </div>
          ))}
        </div>
      )}
      {res && !res.ok && !['not_found', 'ambiguous'].includes(res.error) && (
        <div className="mt-3 text-[12px] rounded border p-2" style={{ borderColor: T.red + '88', color: T.red }}>
          Import fehlgeschlagen: {res.error}
        </div>
      )}

      {p && (
        <div className="mt-3 rounded-xl border overflow-hidden" style={{ borderColor: T.brass + '66' }}>
          <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-[12px] border-b" style={{ borderColor: T.line, background: T.panelSoft }}>
            <b style={{ color: T.brass }}>VORSCHAU — nichts geschrieben</b>
            <span>{p.meeting_name}</span>
            <span style={{ fontFamily: T.mono, color: T.inkDim }}>{fmtDate(p.datum)}</span>
            {p.sensitiv && <span style={{ color: T.red }}>🔒 sensitiv</span>}
            <a href={p.gemini_doc_url} target="_blank" rel="noreferrer" className="text-[11px]" style={{ color: T.blue }}>Quelle: Gemini-Doc ↗</a>
            <span className="flex-1" />
            <span className="text-[11px]" style={{ color: T.green }}>projekt.yaml-Wirkung: KEINE</span>
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
              <th className="px-3 py-1.5 w-24">TYP</th><th className="px-2 py-1.5">TEXT</th>
              <th className="px-2 py-1.5">OWNER</th><th className="px-2 py-1.5 w-24">BIS</th>
            </tr></thead>
            <tbody>
              {p.eintraege.map((e, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td className="px-3 py-1.5" style={{ fontFamily: T.mono, color: T.brass }}>{e.typ}</td>
                  <td className="px-2 py-1.5">{e.text}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono }}>{e.owner || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono, color: e.bis ? T.amber : T.grey }}>{e.bis ? fmtDate(e.bis) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 flex items-center gap-3 border-t" style={{ borderColor: T.line }}>
            <button onClick={() => call(true, res.doc.id)} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded font-semibold text-[12px]"
              style={{ background: T.brass, color: '#0b1220', opacity: busy ? .6 : 1 }}>
              <Save size={13} /> {busy ? 'übernimmt…' : 'Übernehmen → Tower'}
            </button>
            <button onClick={() => setRes(null)} disabled={busy} className="px-3 py-1.5 rounded border text-[12px]" style={{ borderColor: T.line, color: T.inkDim }}>Verwerfen</button>
            <span className="text-[10.5px]" style={{ color: T.inkFaint }}>Commitments werden als Handlungen gespiegelt (De-Dup über die Doc-ID — Re-Import dupliziert nicht).</span>
          </div>
        </div>
      )}
    </div>
  )
}

// A2 (01.08.): MS-Auswahl mit Textfilter — 167 Meilensteine sind per nativem
// Select nicht mehr greifbar. Tippen filtert die Optionsliste live.
function MsPicker({ ms, value, onChange, optional, style: inp }) {
  const [q, setQ] = useState('')
  const qq = q.trim().toLowerCase()
  const hits = qq ? ms.filter(m => (m.id + ' ' + (m.name || '') + ' ' + (m.owner || '')).toLowerCase().includes(qq)) : ms
  // gewählter MS bleibt sichtbar, auch wenn der Filter ihn gerade ausblendet
  const opts = value && !hits.some(m => m.id === value) ? [...ms.filter(m => m.id === value), ...hits] : hits
  return (
    <span className="inline-flex items-center gap-1">
      <input value={q} onChange={ev => setQ(ev.target.value)} placeholder="filtern…"
        aria-label="Milestone filtern" className="w-24 rounded border px-2 py-1 text-[11px]" style={inp} />
      <select value={value || ''} onChange={ev => onChange(ev.target.value)}
        className="rounded border px-2 py-1 text-[11px]" style={inp}
        title={optional ? 'Optional: an Milestone koppeln — wird dann als treibende Handlung gespiegelt' : undefined}>
        <option value="" style={{ color: '#111' }}>{optional ? '— optional: Milestone —' : `— Milestone (${hits.length}) —`}</option>
        {opts.map(m => <option key={m.id} value={m.id} style={{ color: '#111' }}>{m.id} · {m.name.slice(0, 44)}</option>)}
      </select>
    </span>
  )
}

async function saveSitzung(payload) {
  const r = await fetch('/api/sitzung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
  if (j.ok) {
    sessionStorage.setItem('rubicon_saved', JSON.stringify({ id: j.id, applied: j.applied }))
    sessionStorage.setItem('rubicon_tab', 'sitzungen')
    reloadKeepScroll()
  } else {
    alert('Speichern fehlgeschlagen: ' + (j.error || 'unbekannt'))
  }
}

function ErfassungView({ ms, today, role, me }) {
  const [meetingId, setMeetingId] = useState(FR_MEETINGS[0]?.id || '')
  const [datum, setDatum] = useState(today)
  const agenda = AGENDA_BY_ID[meetingId]
  const [vorsitz, setVorsitz] = useState(agenda?.vorsitz || '')
  const [erfasstVon, setErfasstVon] = useState('CoS')
  const [eintraege, setEintraege] = useState([])
  const [sensitiv, setSensitiv] = useState(false)
  const [busy, setBusy] = useState(false)

  // Vorsitz nachziehen, wenn Meeting wechselt
  useEffect(() => { setVorsitz(AGENDA_BY_ID[meetingId]?.vorsitz || '') }, [meetingId])

  const addEintrag = (typ) => setEintraege(e => [...e, { typ, text: '', ...(typ === 'fortschritt' ? { ms_id: '', wert: 50 } : typ === 'blocker' ? { ms_id: '', slip: 7 } : typ === 'commitment' ? { owner: '', bis: '', ms_id: '' } : typ === 'entscheid' ? { status: 'getroffen', ebene: 'GL' } : {}) }])
  const upd = (i, patch) => setEintraege(e => e.map((x, k) => k === i ? { ...x, ...patch } : x))
  const del = (i) => setEintraege(e => e.filter((_, k) => k !== i))

  const submit = async () => {
    setBusy(true)
    await saveSitzung({
      meeting_id: meetingId, meeting_name: FR_MEETINGS.find(m => m.id === meetingId)?.name || meetingId,
      datum, vorsitz, erfasst_von: erfasstVon, eintraege, role, me, sensitiv,
    })
    setBusy(false)
  }

  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.brass + '55' }}>
        <div className="text-[11px] uppercase tracking-widest mb-3" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Sitzung erfassen — Output entlang der Traktandenliste → schreibt in den Tower
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
          <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Meeting</span>
            <select value={meetingId} onChange={e => setMeetingId(e.target.value)} className="rounded border px-2 py-1" style={inp}>
              {FR_MEETINGS.map(m => <option key={m.id} value={m.id} style={{ color: '#111' }}>{m.name}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Datum</span>
            <input type="date" value={datum} onChange={e => setDatum(e.target.value)} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} /></label>
          <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Vorsitz</span>
            <input value={vorsitz} onChange={e => setVorsitz(e.target.value)} className="rounded border px-2 py-1" style={inp} /></label>
          <label className="flex flex-col gap-1"><span style={{ color: T.inkDim }}>Erfasst von</span>
            <input value={erfasstVon} onChange={e => setErfasstVon(e.target.value)} className="rounded border px-2 py-1" style={inp} /></label>
        </div>
      </div>

      {/* Agenda als Leitfaden */}
      {agenda && (
        <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: T.inkFaint, fontFamily: T.mono }}>Traktanden dieser Sitzung (Leitfaden)</div>
            <a href={`/traktanden/${meetingId}.pdf`} target="_blank" rel="noreferrer" className="text-[11px]" style={{ color: T.brass }}><FileText size={11} className="inline mr-1" />Agenda-PDF</a>
          </div>
          <ol className="list-decimal pl-5 text-[11.5px] space-y-0.5" style={{ color: T.inkDim }}>
            {(agenda.traktanden || []).map((t, i) => <li key={i}>{t.titel} <span style={{ color: T.inkFaint }}>— {t.output}</span></li>)}
          </ol>
        </div>
      )}

      {/* Ergebnisse erfassen */}
      <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
        <div className="flex items-center flex-wrap gap-2 mb-3">
          <span className="text-[12px] font-semibold" style={{ color: T.ink }}>Ergebnisse</span>
          {Object.entries(TYP_LABEL).map(([typ, lbl]) => (
            <button key={typ} onClick={() => addEintrag(typ)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border"
              style={{ borderColor: T.line, color: T.brass }}><Plus size={11} /> {lbl}</button>
          ))}
        </div>
        {eintraege.length === 0 && <div className="text-[12px]" style={{ color: T.inkFaint }}>Noch nichts erfasst — oben einen Ergebnistyp hinzufügen.</div>}
        <div className="space-y-2">
          {eintraege.map((e, i) => (
            <div key={i} className="rounded border p-2.5 flex flex-wrap items-start gap-2" style={{ borderColor: T.line, background: T.panelSoft }}>
              <span className="text-[10px] px-2 py-1 rounded" style={{ background: T.brass + '22', color: T.brass, fontFamily: T.mono }}>{TYP_LABEL[e.typ]}</span>
              {(e.typ === 'fortschritt' || e.typ === 'blocker') && (
                <MsPicker ms={ms} value={e.ms_id} onChange={v => upd(i, { ms_id: v })} style={inp} />
              )}
              {e.typ === 'fortschritt' && (
                <select value={e.wert} onChange={ev => upd(i, { wert: +ev.target.value })}
                  className="rounded border px-2 py-1 text-[11px]" style={{ ...inp, fontFamily: T.mono }} title="Fortschritt in 25%-Stufen (DRS 01.08.)">
                  {PROGRESS_STEPS.map(p => <option key={p} value={p} style={{ color: '#111' }}>{p}%</option>)}
                </select>
              )}
              {e.typ === 'blocker' && (
                <input type="number" min={0} max={365} value={e.slip} onChange={ev => upd(i, { slip: +ev.target.value })}
                  className="w-24 rounded border px-2 py-1 text-[11px]" style={{ ...inp, fontFamily: T.mono }} title="Verzug in Tagen" />
              )}
              {e.typ === 'commitment' && (<>
                <input placeholder="Owner" value={e.owner} onChange={ev => upd(i, { owner: ev.target.value })} className="w-28 rounded border px-2 py-1 text-[11px]" style={inp} />
                <input type="date" value={e.bis} onChange={ev => upd(i, { bis: ev.target.value })} className="rounded border px-2 py-1 text-[11px]" style={{ ...inp, fontFamily: T.mono }} title="bis wann" />
                <MsPicker ms={ms} value={e.ms_id} onChange={v => upd(i, { ms_id: v })} style={inp} optional />
              </>)}
              {e.typ === 'entscheid' && (<>
                <select value={e.status} onChange={ev => upd(i, { status: ev.target.value })} className="rounded border px-2 py-1 text-[11px]" style={inp}>
                  <option value="getroffen" style={{ color: '#111' }}>getroffen</option>
                  <option value="offen" style={{ color: '#111' }}>offen (Entscheids-Queue)</option>
                </select>
                <select value={e.ebene} onChange={ev => upd(i, { ebene: ev.target.value })} className="rounded border px-2 py-1 text-[11px]" style={inp} title="Eskalationsebene — VR erscheint im VR-Report">
                  <option value="GL" style={{ color: '#111' }}>Ebene GL</option>
                  <option value="VR" style={{ color: '#111' }}>Ebene VR</option>
                </select>
              </>)}
              <input placeholder={e.typ === 'notiz' ? 'Notiz …' : 'Beschreibung …'} value={e.text} onChange={ev => upd(i, { text: ev.target.value })}
                className="flex-1 min-w-[180px] rounded border px-2 py-1 text-[11px]" style={inp} />
              <button onClick={() => del(i)} className="p-1 rounded" style={{ color: T.red }} title="entfernen"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 mt-3 text-[12px] cursor-pointer" style={{ color: sensitiv ? T.red : T.inkDim }}>
          <input type="checkbox" checked={sensitiv} onChange={e => setSensitiv(e.target.checked)} />
          🔒 Sensitiv (HR/Personal) — Protokoll bleibt NUR lokal einsehbar (nicht via Netz/Tailnet), keine Task-/Register-Spiegel, kein Export
        </label>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={submit} disabled={busy || !eintraege.length}
            className="flex items-center gap-1.5 px-4 py-2 rounded font-semibold text-[13px]"
            style={{ background: eintraege.length ? T.brass : T.line, color: '#0b1220', opacity: busy ? 0.6 : 1 }}>
            <Save size={15} /> {busy ? 'Speichert…' : 'Sitzung speichern → Tower'}
          </button>
          <span className="text-[11px]" style={{ color: T.inkFaint }}>Fortschritt/Blocker aktualisieren Milestones (Ampel folgt automatisch); alles landet im Protokoll.</span>
        </div>
      </div>
    </div>
  )
}

// ── ENTSCHEIDS-REGISTER — Säule 3 der Entscheidungsordnung (INS-001 Anhang B):
// jeder Entscheid zentral, mit dauerhafter E-Nummer, Begründung, Datengrundlage,
// 5-Stufen-Status (beantragt→entscheidungsreif→entschieden→kommuniziert→umgesetzt)
// und Kommunikations-Stempel. Revisionssicher: kein Löschen. Gespeist aus der
// Sitzungserfassung (Spiegel in /api/sitzung) + manueller Erfassung hier.

// A4 (01.08.): Begründung/Datengrundlage direkt im Register-Detail nachpflegen —
// nötig, weil der Server «entschieden» ohne Begründung jetzt hart ablehnt.
// Upsert über denselben key erhält Lifecycle (Status/Kommunikation/E-Nummer).
function EntEdit({ e, role, me, today }) {
  const [beg, setBeg] = useState(e.begruendung || '')
  const [dat, setDat] = useState(e.datengrundlage || '')
  const [anh, setAnh] = useState((e.anhaenge || []).join(', '))
  const [busy, setBusy] = useState(false)
  const dirty = beg !== (e.begruendung || '') || dat !== (e.datengrundlage || '') || anh !== (e.anhaenge || []).join(', ')
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    try {
      const r = await fetch('/api/entscheid/upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, datum: today, entscheide: [{ key: e.key, titel: e.titel, entscheid: e.entscheid, begruendung: beg.trim() || null, datengrundlage: dat.trim() || null, anhaenge: anh.split(',').map(x => x.trim()).filter(Boolean) }] }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) reloadKeepScroll()
      else { alert('Speichern fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(false) }
    } catch (err) { alert('Speichern fehlgeschlagen: ' + err); setBusy(false) }
  }
  return (
    <div className="mt-2 pt-2 border-t flex flex-wrap items-center gap-2 text-[11.5px]" style={{ borderColor: T.line }}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: T.inkFaint, fontFamily: T.mono }}>Pflege</span>
      <input placeholder="Begründung (Pflicht vor «entschieden»)" value={beg} onChange={ev => setBeg(ev.target.value)}
        className="flex-1 min-w-[220px] rounded border px-2 py-1" style={inp} />
      <input placeholder="Datengrundlage (Unterlagen/Links)" value={dat} onChange={ev => setDat(ev.target.value)}
        className="flex-1 min-w-[220px] rounded border px-2 py-1" style={inp} />
      <input placeholder="Anhänge: Drive-Links, kommagetrennt — gehen bei «kommuniziert» als PDF mit" value={anh} onChange={ev => setAnh(ev.target.value)}
        title="z.B. Kompetenzordnung — Google-Docs werden als PDF exportiert und dem Gmail-Entwurf angehängt"
        className="flex-1 min-w-[260px] rounded border px-2 py-1" style={inp} />
      <button onClick={save} disabled={busy || !dirty} className="px-2.5 py-1 rounded border text-[11px]"
        style={{ borderColor: dirty ? T.brass : T.line, color: dirty ? T.brass : T.inkFaint, opacity: busy ? .5 : 1 }}>
        <Save size={11} className="inline mr-1" />{busy ? 'speichert…' : 'Speichern'}
      </button>
    </div>
  )
}

function EntscheideView({ role, me, today }) {
  const all = ENTS.entscheide || []
  // A1 (01.08.): Filter überleben den Reload nach Status-Übergängen
  const [fStatus, setFStatus] = useState(() => sessionStorage.getItem('rubicon_e_status') || 'alle')
  const [fGremium, setFGremium] = useState(() => sessionStorage.getItem('rubicon_e_gremium') || 'alle')
  useEffect(() => {
    sessionStorage.setItem('rubicon_e_status', fStatus)
    sessionStorage.setItem('rubicon_e_gremium', fGremium)
  }, [fStatus, fGremium])
  const [open, setOpen] = useState(null)          // aufgeklappte Register-Zeile
  const [confirm, setConfirm] = useState(null)    // A4: {id, next, an} — Bestätigung vor Status-Übergang
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ titel: '', typ: ENT_TYPEN[0], gremium: 'ExBoD', antragsteller: '', entscheid: '', begruendung: '', datengrundlage: '', frist: '' })
  const [busy, setBusy] = useState(false)
  const canWrite = canAny(role, 'entscheid.erfassen')
  const mayAdvance = (e) => can(role, me, 'entscheid.fortschreiben', e)

  const gremien = [...new Set(all.map(e => e.gremium).filter(Boolean))]
  const filtered = all.filter(e =>
    (fStatus === 'alle' || e.status === fStatus) && (fGremium === 'alle' || e.gremium === fGremium)
  ).sort((a, b) => b.id.localeCompare(a.id))       // neueste E-Nummer zuerst
  const nOffen = all.filter(e => !['kommuniziert', 'umgesetzt'].includes(e.status)).length

  // A4 (01.08.): Übergang läuft IMMER über die Bestätigungs-Zeile (kein Direkt-Klick,
  // kein window.prompt mehr) — der Server erzwingt zusätzlich Begründung vor «entschieden».
  async function setStatus(e, status, an = null) {
    if (busy || !mayAdvance(e)) return
    setBusy(true)
    try {
      const r = await fetch('/api/entscheid/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: e.id, status, an, datum: today }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) {
        // Kommunikations-Paket (16.07.): PDF + Gmail-ENTWURF — Versand bleibt bei DRS
        if (j.mail) {
          alert(j.mail.ok
            ? `Kommunikations-Paket erstellt:\n· Entscheid-PDF (Registerauszug)\n· Gmail-ENTWURF mit PDF im Anhang${j.mail.draft_id ? '' : j.mail.draft_error ? `\n⚠ Entwurf fehlgeschlagen: ${j.mail.draft_error}` : ''}\n\nDer Entwurf liegt in Gmail — DRS sendet.`
            : `Status gesetzt, aber Paket-Build fehlgeschlagen: ${j.mail.error || 'unbekannt'}`)
        }
        reloadKeepScroll()
      }
      else { alert('Status-Übergang fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(false) }
    } catch (err) { alert('Status-Übergang fehlgeschlagen: ' + err); setBusy(false) }
  }

  async function submitNew() {
    if (busy || !form.titel.trim() || !form.entscheid.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/entscheid/upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role, me, datum: today,
          entscheide: [{ key: `MAN-${Date.now()}`, ...form, frist: form.frist || null, antragsteller: form.antragsteller || (role === 'Owner' ? me : null), status: 'beantragt' }],
        }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) reloadKeepScroll()
      else { alert('Erfassen fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(false) }
    } catch (err) { alert('Erfassen fehlgeschlagen: ' + err); setBusy(false) }
  }

  const sel = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 border-b" style={{ borderColor: T.line }}>
          <div className="text-[13px] font-semibold tracking-widest" style={{ fontFamily: T.mono, color: T.brass }}>
            ── ENTSCHEIDS-REGISTER ──
            <span className="ml-2 text-[11px] font-normal" style={{ color: T.inkDim }}>{all.length} Entscheide · {nOffen} nicht abgeschlossen · {filtered.length} angezeigt</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] flex-wrap justify-end" style={{ color: T.inkDim }}>
            <Filter size={13} />
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="alle" style={{ color: '#111' }}>alle Status</option>
              {ENT_FLOW.map(s => <option key={s} value={s} style={{ color: '#111' }}>{s}</option>)}
            </select>
            <select value={fGremium} onChange={e => setFGremium(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="alle" style={{ color: '#111' }}>alle Gremien</option>
              {gremien.map(g => <option key={g} value={g} style={{ color: '#111' }}>{g}</option>)}
            </select>
            {canWrite && (
              <button onClick={() => setShowForm(f => !f)} className="flex items-center gap-1 px-2 py-0.5 rounded border text-[11.5px]"
                style={{ borderColor: T.brass + '88', color: T.brass }}>
                <Plus size={12} /> Entscheid erfassen
              </button>
            )}
          </div>
        </div>

        {/* Status-Legende — das 5-Stufen-Modell der Entscheidungsordnung */}
        <div className="px-4 py-1.5 flex items-center gap-2 flex-wrap text-[10.5px] border-b" style={{ borderColor: T.line, color: T.inkFaint, fontFamily: T.mono }}>
          {ENT_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span>→</span>}
              <span style={{ color: ENT_COLOR(s) }}>{s}</span>
            </React.Fragment>
          ))}
          <span className="ml-2" style={{ color: T.inkFaint }}>· revisionssicher (kein Löschen) · VR-Entscheide erscheinen im VR-Board-Pack</span>
        </div>

        {showForm && canWrite && (
          <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: T.line, background: T.panelSoft + '66' }}>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: T.inkDim, fontFamily: T.mono }}>Neuer Entscheid (Status: beantragt — Pflichtfelder gemäss Beschlussvorlage-Standard folgen in der Vorlage)</div>
            <div className="flex gap-2 flex-wrap">
              <input placeholder="Titel *" value={form.titel} onChange={e => setForm(f => ({ ...f, titel: e.target.value }))} className="flex-1 min-w-[220px] rounded border px-2 py-1 text-[12px]" style={inp} />
              <select value={form.typ} onChange={e => setForm(f => ({ ...f, typ: e.target.value }))} className="rounded border px-2 py-1 text-[12px]" style={inp}>
                {ENT_TYPEN.map(t => <option key={t} value={t} style={{ color: '#111' }}>{t}</option>)}
              </select>
              <select value={form.gremium} onChange={e => setForm(f => ({ ...f, gremium: e.target.value }))} className="rounded border px-2 py-1 text-[12px]" style={inp} title="zuständiges Gremium (aus Kompetenzmatrix)">
                {ENT_GREMIEN.map(g => <option key={g} value={g} style={{ color: '#111' }}>{g}</option>)}
              </select>
              <input placeholder="Antragsteller" value={form.antragsteller} onChange={e => setForm(f => ({ ...f, antragsteller: e.target.value }))} className="w-40 rounded border px-2 py-1 text-[12px]" style={inp} />
              <input type="date" value={form.frist} onChange={e => setForm(f => ({ ...f, frist: e.target.value }))} className="rounded border px-2 py-1 text-[12px]" style={{ ...inp, fontFamily: T.mono }} title="Frist — bis wann entschieden sein muss" />
            </div>
            <textarea placeholder="Entscheid-Frage / beantragter Entscheid *" value={form.entscheid} onChange={e => setForm(f => ({ ...f, entscheid: e.target.value }))} rows={2} className="w-full rounded border px-2 py-1 text-[12px]" style={inp} />
            <div className="flex gap-2 flex-wrap">
              <input placeholder="Begründung" value={form.begruendung} onChange={e => setForm(f => ({ ...f, begruendung: e.target.value }))} className="flex-1 min-w-[220px] rounded border px-2 py-1 text-[12px]" style={inp} />
              <input placeholder="Datengrundlage (Unterlagen/Links)" value={form.datengrundlage} onChange={e => setForm(f => ({ ...f, datengrundlage: e.target.value }))} className="flex-1 min-w-[220px] rounded border px-2 py-1 text-[12px]" style={inp} />
              <button onClick={submitNew} disabled={busy || !form.titel.trim() || !form.entscheid.trim()}
                className="flex items-center gap-1.5 px-3 py-1 rounded font-semibold text-[12px]"
                style={{ background: form.titel.trim() && form.entscheid.trim() ? T.brass : T.line, color: '#0b1220', opacity: busy ? 0.6 : 1 }}>
                <Save size={13} /> ins Register
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
                <th className="px-3 py-1.5 w-24">ID</th>
                <th className="px-2 py-1.5">TITEL</th>
                <th className="px-2 py-1.5">TYP</th>
                <th className="px-2 py-1.5">GREMIUM</th>
                <th className="px-2 py-1.5">ANTRAGSTELLER</th>
                <th className="px-2 py-1.5">FRIST / DATUM</th>
                <th className="px-2 py-1.5">STATUS</th>
                {canWrite && <th className="px-2 py-1.5 w-28"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-[12px]" style={{ color: T.inkFaint }}>Keine Entscheide für diese Filter.</td></tr>
              )}
              {filtered.map(e => {
                const nextSt = ENT_FLOW[ENT_FLOW.indexOf(e.status) + 1] || null
                const isOpen = open === e.id
                return (
                  <React.Fragment key={e.id}>
                    <tr onClick={() => setOpen(isOpen ? null : e.id)}
                      tabIndex={0} role="button" aria-label={`${e.id} ${e.titel} — Details ${isOpen ? 'schliessen' : 'öffnen'}`}
                      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(isOpen ? null : e.id) } }}
                      style={{ borderTop: `1px solid ${T.line}`, cursor: 'pointer', background: isOpen ? T.panelSoft + '55' : 'transparent' }}>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono, color: T.brass }}>{e.id}</td>
                      <td className="px-2 py-1.5">{e.titel}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[11px]" style={{ color: T.inkDim }}>{e.typ || '—'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono, color: e.gremium === 'VR' ? T.red : e.gremium === 'ExBoD' ? T.brass : T.ink }}>{e.gremium || '—'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[11px]">{e.antragsteller || '—'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono, color: T.inkDim }}>
                        {e.datum ? fmtDate(e.datum) : e.frist ? `bis ${fmtDate(e.frist)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                          style={{ background: ENT_COLOR(e.status) + '22', color: ENT_COLOR(e.status), border: `1px solid ${ENT_COLOR(e.status)}55`, fontFamily: T.mono }}>
                          {e.status}
                        </span>
                      </td>
                      {canWrite && (
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {nextSt && mayAdvance(e) && (
                            <button onClick={ev => { ev.stopPropagation(); setConfirm(confirm?.id === e.id ? null : { id: e.id, next: nextSt, an: e.gremium === 'VR' ? 'VR-Board-Pack + GL' : 'GL' }) }} disabled={busy}
                              className="px-2 py-0.5 rounded border text-[10.5px]"
                              style={{ borderColor: ENT_COLOR(nextSt) + '88', color: ENT_COLOR(nextSt), fontFamily: T.mono }}
                              title={`Status-Übergang → ${nextSt} (mit Bestätigung)`}>
                              → {nextSt}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {confirm?.id === e.id && (
                      <tr style={{ background: ENT_COLOR(confirm.next) + '0d' }}>
                        <td colSpan={canWrite ? 8 : 7} className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <b style={{ color: ENT_COLOR(confirm.next) }}>Übergang bestätigen: {e.status} → {confirm.next}</b>
                            {confirm.next === 'entschieden' && !(e.begruendung || '').trim() && (
                              <span style={{ color: T.red }}>⚠ Begründung fehlt — zuerst in der Detail-Zeile ergänzen (Pflicht, Server lehnt sonst ab).</span>
                            )}
                            {confirm.next === 'kommuniziert' && (
                              <label className="flex items-center gap-1.5"><span style={{ color: T.inkDim }}>an</span>
                                <input value={confirm.an} onChange={ev => setConfirm(c => ({ ...c, an: ev.target.value }))}
                                  className="w-64 rounded border px-2 py-1 text-[11px]" style={inp} />
                              </label>
                            )}
                            <button onClick={() => { const c = confirm; setConfirm(null); setStatus(e, c.next, c.an) }}
                              disabled={busy || (confirm.next === 'entschieden' && !(e.begruendung || '').trim())}
                              className="px-3 py-1 rounded font-semibold text-[11.5px]"
                              style={{ background: ENT_COLOR(confirm.next), color: '#0b1220', opacity: (busy || (confirm.next === 'entschieden' && !(e.begruendung || '').trim())) ? .4 : 1 }}>
                              Bestätigen
                            </button>
                            <button onClick={() => setConfirm(null)} className="px-3 py-1 rounded border text-[11.5px]" style={{ borderColor: T.line, color: T.inkDim }}>Abbrechen</button>
                            {confirm.next === 'kommuniziert' && <span className="text-[10.5px]" style={{ color: T.inkFaint }}>erzeugt Entscheid-PDF + Gmail-Entwurf — DRS sendet</span>}
                            <span className="text-[10.5px]" style={{ color: T.inkFaint }}>Register ist revisionssicher — Übergänge sind nicht rückgängig zu machen.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {isOpen && (
                      <tr style={{ background: T.panelSoft + '33' }}>
                        <td colSpan={canWrite ? 8 : 7} className="px-4 py-3">
                          <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-[11.5px]" style={{ color: T.ink }}>
                            <div><b style={{ color: T.inkDim }}>Entscheid:</b> {e.entscheid || '—'}</div>
                            <div><b style={{ color: T.inkDim }}>Begründung:</b> {e.begruendung || <span style={{ color: T.amber }}>— fehlt (Pflicht vor «entschieden»)</span>}</div>
                            <div><b style={{ color: T.inkDim }}>Datengrundlage:</b> {e.datengrundlage || '—'}</div>
                            <div><b style={{ color: T.inkDim }}>Anhänge:</b>{' '}
                              {(e.anhaenge || []).length
                                ? e.anhaenge.map((a, i) => (
                                  <a key={i} href={a.startsWith('http') ? a : `https://drive.google.com/open?id=${a}`}
                                    target="_blank" rel="noreferrer" className="mr-2" style={{ color: T.blue }}>Dokument {i + 1} ↗</a>
                                ))
                                : <span style={{ color: T.inkFaint }}>— (gehen bei «kommuniziert» als PDF mit, unten pflegbar)</span>}
                            </div>
                            <div>
                              <b style={{ color: T.inkDim }}>Kommunikation:</b>{' '}
                              {e.kommunikation ? `an ${e.kommunikation.an || '?'} am ${fmtDate(e.kommunikation.am)}` : '— noch nicht kommuniziert'}
                            </div>
                            <div><b style={{ color: T.inkDim }}>Umsetzungs-Handlungen:</b>{' '}
                              {(e.tasks && e.tasks.length)
                                ? e.tasks.map(tid => { const t = ALL_TASKS.find(x => x.id === tid); return t ? `${tnr(t)}${t.status === 'erledigt' ? ' ✓' : ''}` : tid }).join(' · ')
                                : '—'}
                            </div>
                            <div style={{ color: T.inkFaint, fontFamily: T.mono }}>
                              {e.quelle ? `Quelle: Protokoll ${e.quelle} · ` : ''}erfasst {fmtDate(e.created_at)}
                              {e.export?.pdf && <> · <a href={e.export.pdf} target="_blank" rel="noreferrer" style={{ color: T.brass }}>Entscheid-PDF ↗</a></>}
                              {e.export?.draft_id && <> · <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer" style={{ color: T.brass }} title="Gmail-Entwurf mit PDF-Anhang — DRS sendet">Gmail-Entwurf ↗</a></>}
                            </div>
                          </div>
                          {mayAdvance(e) && <EntEdit e={e} role={role} me={me} today={today} />}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-1.5 text-[10px] border-t" style={{ borderColor: T.line, color: T.inkFaint }}>
          Quelle entscheide.json · Säule 3 der Entscheidungsordnung (INS-001 Anhang B) · gespeist aus «Sitzung erfassen» (Typ Entscheid) + manueller Erfassung · E-Nummern dauerhaft, Register revisionssicher · Zeile klicken = Details
        </div>
      </div>
    </div>
  )
}

// ── AUFGABEN — flache, filterbare Liste ALLER Handlungen (Phase × WS × Person ×
// Status), sortiert nach Fälligkeit. Beantwortet «was muss ICH bis wann tun?» —
// das Gegenstück zur Milestone-Sicht des Kontrollturms. Abhaken wie überall:
// /api/task/status, CoS alles / Owner nur eigene, Ampel bleibt abgeleitet.
function AufgabenView({ role, me, prog, onOpenMs }) {
  // A1 (01.08.): Filter + Suche überleben den HMR-Reload nach jedem Abhaken
  const [fPhase, setFPhase] = useState(() => sessionStorage.getItem('rubicon_t_phase') || 'alle')
  const [fWs, setFWs] = useState(() => sessionStorage.getItem('rubicon_t_ws') || 'alle')
  const [fOwner, setFOwner] = useState(() => sessionStorage.getItem('rubicon_t_owner') || (role === 'Owner' ? me : 'alle'))
  const [fStatus, setFStatus] = useState(() => sessionStorage.getItem('rubicon_t_status') || 'offen')
  const [search, setSearch] = useState(() => sessionStorage.getItem('rubicon_t_search') || '')
  useEffect(() => {
    sessionStorage.setItem('rubicon_t_phase', fPhase)
    sessionStorage.setItem('rubicon_t_ws', fWs)
    sessionStorage.setItem('rubicon_t_owner', fOwner)
    sessionStorage.setItem('rubicon_t_status', fStatus)
    sessionStorage.setItem('rubicon_t_search', search)
  }, [fPhase, fWs, fOwner, fStatus, search])
  const [busy, setBusy] = useState(null)

  // Programm-Filter: milestone-gekoppelte Handlungen folgen dem Programm ihres WS;
  // ungekoppelte (ms_id null, z.B. Nachlauf-Reviews) bleiben in jedem Programm sichtbar.
  const rows = ALL_TASKS.map(t => ({ ...t, _m: t.ms_id ? MS_META[t.ms_id] : null }))
    .filter(t => !prog || !t._m || !t._m.programm || t._m.programm === prog)
  const owners = [...new Set(rows.map(t => t.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
  const wss = [...new Set(rows.map(t => t._m?.ws).filter(Boolean))].sort()
  const phases = PHASE_ORDER.filter(p => rows.some(t => t._m?.phase === p))

  // A2 (01.08.): Textsuche über Handlung / Verantwortlich / T-Nr / Milestone
  const q = search.trim().toLowerCase()
  const tMatch = (t) => !q || [t.text, t.owner, tnr(t), t.id, t.ms_id].some(v => (v || '').toLowerCase().includes(q))
  const filtered = rows.filter(t =>
    (fPhase === 'alle' || (fPhase === 'ohne' ? !t._m : t._m?.phase === fPhase))
    && (fWs === 'alle' || (fWs === 'ohne' ? !t._m : t._m?.ws === fWs))
    && (fOwner === 'alle' || t.owner === fOwner)
    && (fStatus === 'alle' || (fStatus === 'ueberfaellig' ? taskOverdue(t) : t.status === fStatus))
    && tMatch(t)
  ).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'offen' ? -1 : 1
    if (!a.due && !b.due) return a.id.localeCompare(b.id)
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due.localeCompare(b.due)
  })
  const nOffen = filtered.filter(t => t.status === 'offen').length
  const nOver = filtered.filter(taskOverdue).length
  const mayToggle = (t) => can(role, me, 'task.abhaken', t)
  const toggle = async (t) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: t.status === 'erledigt' ? 'offen' : 'erledigt' }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) { reloadKeepScroll() }
      else { alert('Abhaken fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(null) }
    } catch (e) { alert('Abhaken fehlgeschlagen: ' + e); setBusy(null) }
  }
  const sel = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 border-b" style={{ borderColor: T.line }}>
          <div className="text-[13px] font-semibold tracking-widest" style={{ fontFamily: T.mono, color: T.brass }}>
            ── AUFGABEN · ALLE HANDLUNGEN ──
            <span className="ml-2 text-[11px] font-normal" style={{ color: T.inkDim }}>{nOffen} offen{nOver ? ` · ${nOver} überfällig ⚠` : ''} · {filtered.length} angezeigt / {rows.length} gesamt</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] flex-wrap justify-end" style={{ color: T.inkDim }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Suchen: Handlung / Person / T-Nr…" aria-label="Handlungen durchsuchen"
              className="bg-transparent border rounded px-2 py-0.5 w-52"
              style={{ borderColor: search ? T.brass : T.line, background: T.panelSoft, color: T.ink }} />
            <Filter size={13} />
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="offen" style={{ color: '#111' }}>offen</option>
              <option value="ueberfaellig" style={{ color: '#111' }}>überfällig ⚠</option>
              <option value="erledigt" style={{ color: '#111' }}>erledigt</option>
              <option value="alle" style={{ color: '#111' }}>alle Status</option>
            </select>
            <select value={fPhase} onChange={e => setFPhase(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="alle" style={{ color: '#111' }}>alle Phasen</option>
              {phases.map(p => <option key={p} value={p} style={{ color: '#111' }}>{p}</option>)}
              <option value="ohne" style={{ color: '#111' }}>ohne Milestone</option>
            </select>
            <select value={fWs} onChange={e => setFWs(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="alle" style={{ color: '#111' }}>alle Ströme</option>
              {wss.map(w => <option key={w} value={w} style={{ color: '#111' }}>{w}</option>)}
            </select>
            <select value={fOwner} onChange={e => setFOwner(e.target.value)} className="bg-transparent border rounded px-1.5 py-0.5" style={sel}>
              <option value="alle" style={{ color: '#111' }}>alle Verantwortlichen</option>
              {owners.map(o => <option key={o} value={o} style={{ color: '#111' }}>{o.length > 30 ? o.slice(0, 30) + '…' : o}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
                <th className="px-3 py-1.5 w-8"></th>
                <th className="px-2 py-1.5 w-16">NR</th>
                <th className="px-2 py-1.5">HANDLUNG</th>
                <th className="px-2 py-1.5">VERANTWORTLICH</th>
                <th className="px-2 py-1.5">FÄLLIG</th>
                <th className="px-2 py-1.5">MILESTONE</th>
                <th className="px-2 py-1.5">PHASE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-[12px]" style={{ color: T.inkFaint }}>Keine Handlungen für diese Filter.</td></tr>
              )}
              {filtered.map(t => {
                const ov = taskOverdue(t)
                const can = mayToggle(t)
                return (
                  <tr key={t.id} style={{ borderTop: `1px solid ${T.line}`, opacity: t.status === 'erledigt' ? 0.55 : 1 }}>
                    <td className="px-3 py-1.5">
                      <button onClick={() => toggle(t)} disabled={!can || !!busy}
                        title={can ? (t.status === 'erledigt' ? 'wieder öffnen' : 'abhaken') : 'Rolle darf diese Handlung nicht abhaken'}
                        style={{ cursor: can ? 'pointer' : 'not-allowed', opacity: busy === t.id ? 0.4 : 1 }}>
                        {t.status === 'erledigt'
                          ? <CheckCircle2 size={15} style={{ color: T.green }} />
                          : <Circle size={15} style={{ color: can ? T.brass : T.grey }} />}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" title={t.id} style={{ fontFamily: T.mono, color: T.brass }}>{tnr(t)}</td>
                    <td className="px-2 py-1.5" style={{ textDecoration: t.status === 'erledigt' ? 'line-through' : 'none' }}>{t.text}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono }}>{t.owner || '—'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono, color: ov ? T.red : T.ink }}>
                      {t.due ? fmtDate(t.due) : '—'}{ov ? ' ⚠' : ''}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ fontFamily: T.mono }}>
                      {t.ms_id
                        ? <button onClick={() => onOpenMs(t.ms_id)} title={t._m?.name || t.ms_id} style={{ color: T.brass }}>{t.ms_id}</button>
                        : <span style={{ color: T.grey }}>—</span>}
                    </td>
                    <td className="px-2 py-1.5">{t._m ? <PhaseTag p={t._m.phase} /> : <span style={{ color: T.grey, fontSize: 10 }}>—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-1.5 text-[10px] border-t" style={{ borderColor: T.line, color: T.inkFaint }}>
          Quelle tasks.json · Abhaken = persistent, gekoppelte Handlungen treiben den Milestone-Fortschritt (Ampel bleibt abgeleitet) · überfällig = fällig &lt; Steuerungsdatum {fmtDate(BASE.meta.today)} · Milestone-Klick öffnet das Briefing
        </div>
      </div>
    </div>
  )
}

// ── PROTOKOLLE — erfasste Sitzungen + aggregierte offene Commitments/Entscheide.
function ProtokolleView({ role, me }) {
  const [busy, setBusy] = useState(null)
  // Sensitiv-Filter (#6): sensitive Protokolle sind NICHT im Bundle — sie kommen nur
  // via Loopback-gated API (403 für Netz-/Tailnet-Clients → dann einfach unsichtbar).
  const [sensProtos, setSensProtos] = useState([])
  const [sensBlocked, setSensBlocked] = useState(false)
  useEffect(() => {
    fetch('/api/protokoll/sensitiv')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(j => setSensProtos(j.protokolle || []))
      .catch(() => setSensBlocked(true))
  }, [])
  const protos = [...sensProtos, ...(PROTO.protokolle || [])]
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
  const exportP = async (id) => {
    setBusy(id)
    try {
      const r = await fetch('/api/protokoll/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) { sessionStorage.setItem('rubicon_tab', 'protokolle'); reloadKeepScroll() }
      else { alert('Export fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(null) }
    } catch (e) { alert('Export fehlgeschlagen: ' + e); setBusy(null) }
  }
  // Commitments = gespiegelte Tasks (Schnitt 2) — status-bewusst: erledigte fallen raus.
  const commitmentTasks = ALL_TASKS.filter(t => t.source === 'sitzung' || t.source === 'gemini')
  const offeneCommitments = commitmentTasks.filter(t => t.status === 'offen')
  const nErledigt = commitmentTasks.length - offeneCommitments.length
  const mayToggle = (t) => can(role, me, 'task.abhaken', t)
  const erledige = async (t) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: 'erledigt' }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) { reloadKeepScroll() }
      else { alert('Erledigen fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(null) }
    } catch (e) { alert('Erledigen fehlgeschlagen: ' + e); setBusy(null) }
  }
  const offeneEntscheide = protos.flatMap(p => (p.eintraege || []).filter(e => e.typ === 'entscheid' && e.status === 'offen').map(e => ({ ...e, _m: p.meeting_name, _d: p.datum })))
  return (
    <div className="max-w-5xl space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: T.inkFaint, fontFamily: T.mono }}>
            Offene Commitments ({offeneCommitments.length}){nErledigt > 0 && <span style={{ color: T.green }}> · {nErledigt} erledigt ✓</span>}
          </div>
          {offeneCommitments.length === 0 && <div className="text-[12px]" style={{ color: T.inkFaint }}>{commitmentTasks.length ? 'alle erledigt ✓' : 'keine erfasst'}</div>}
          {offeneCommitments.map((c, i) => {
            const ov = taskOverdue(c)
            const can = mayToggle(c)
            return (
              <div key={c.id} className="text-[12px] py-1 flex items-start gap-2" style={{ borderTop: i ? `1px solid ${T.line}` : 'none' }}>
                <button onClick={() => erledige(c)} disabled={!can || !!busy} className="mt-0.5 shrink-0"
                  title={can ? 'als erledigt abhaken' : 'Rolle darf dieses Commitment nicht abhaken'}
                  style={{ cursor: can ? 'pointer' : 'not-allowed', opacity: busy === c.id ? 0.4 : 1 }}>
                  <Circle size={14} style={{ color: can ? T.brass : T.grey }} />
                </button>
                <div className="flex-1 min-w-0">
                  <span title={c.id} style={{ fontFamily: T.mono, color: T.brass, fontSize: 11 }}>{tnr(c)} </span>
                  <b style={{ color: T.ink }}>{c.owner || '—'}</b> <span style={{ color: T.inkDim }}>{c.text}</span>
                  {c.due && <span style={{ fontFamily: T.mono, color: ov ? T.red : T.amber }}> · bis {fmtDate(c.due)}{ov ? ' ⚠' : ''}</span>}
                  {c.ms_id && <span style={{ fontFamily: T.mono, color: T.brass }} title="an Milestone gekoppelt — treibt dessen Fortschritt"> · ▸ {c.ms_id}</span>}
                  <span style={{ color: T.inkFaint }}> · {c.origin || ''}</span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.line }}>
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: T.inkFaint, fontFamily: T.mono }}>Offene Entscheide ({offeneEntscheide.length})</div>
          {offeneEntscheide.length === 0 && <div className="text-[12px]" style={{ color: T.inkFaint }}>keine offen</div>}
          {offeneEntscheide.map((c, i) => (
            <div key={i} className="text-[12px] py-1" style={{ borderTop: i ? `1px solid ${T.line}` : 'none', color: T.inkDim }}>
              {c.text} <span style={{ color: T.inkFaint }}>· {c._m} ({fmtDate(c._d)})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
        <div className="px-4 py-2 text-[13px] font-semibold border-b" style={{ borderColor: T.line }}>
          Sitzungsprotokolle <span className="text-[10px]" style={{ color: T.inkFaint }}>({protos.length} — neueste zuerst; Quelle protokolle.json{sensProtos.length ? ` + ${sensProtos.length} sensitiv (nur lokal)` : ''}{sensBlocked ? ' · 🔒 sensitive Protokolle nur direkt am Gerät einsehbar' : ''})</span>
        </div>
        {protos.length === 0 && <div className="px-4 py-6 text-[12px]" style={{ color: T.inkFaint }}>Noch keine Sitzung erfasst — oben im Formular erfassen (Rolle CoS/Owner).</div>}
        <div className="divide-y" style={{ borderColor: T.line }}>
          {protos.map(p => (
            <div key={p.id} className="px-4 py-3" style={{ borderTop: `1px solid ${T.line}` }}>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <b style={{ color: T.brass }}>{p.meeting_name}</b>
                {p.sensitiv && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: T.red + '22', color: T.red, border: `1px solid ${T.red}55` }} title="nur lokal einsehbar — keine Spiegel, kein Export">🔒 sensitiv</span>}
                <span style={{ fontFamily: T.mono, color: T.inkDim }}>{fmtDate(p.datum)}</span>
                {p.vorsitz && <span style={{ color: T.inkFaint }}>· Vorsitz {p.vorsitz}</span>}
                {p.erfasst_von && <span style={{ color: T.inkFaint }}>· erfasst: {p.erfasst_von}</span>}
                <span style={{ fontFamily: T.mono, color: T.inkFaint }}>· {p.id}</span>
                <span className="flex-1" />
                {p.sensitiv ? (
                  <span className="text-[10px]" style={{ color: T.inkFaint }}>kein Export (sensitiv)</span>
                ) : p.export?.pdf ? (
                  <span className="flex items-center gap-1.5">
                    <a href={p.export.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.brass, color: T.brass }}><FileText size={10} /> PDF</a>
                    {p.export.doc_url && <a href={p.export.doc_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.blue, color: T.blue }}><FileText size={10} /> Doc</a>}
                    <button onClick={() => exportP(p.id)} disabled={busy === p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.line, color: T.inkFaint }} title="neu erzeugen">{busy === p.id ? '…' : '↻'}</button>
                  </span>
                ) : (
                  <button onClick={() => exportP(p.id)} disabled={busy === p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px]" style={{ borderColor: T.brass, color: T.brass }}>
                    <FileText size={10} /> {busy === p.id ? 'erzeugt… (~15s)' : 'Protokoll erzeugen (PDF + Doc)'}
                  </button>
                )}
              </div>
              <div className="mt-1.5 space-y-1">
                {(p.eintraege || []).map((e, i) => (
                  <div key={i} className="text-[11.5px] flex gap-2">
                    <span style={{ color: T.brass, width: 14 }}>{TYP_ICON[e.typ] || '·'}</span>
                    <span style={{ color: T.inkDim }}>
                      <b style={{ color: T.ink }}>{TYP_LABEL[e.typ]}:</b>{' '}
                      {e.ms_id && <span style={{ fontFamily: T.mono }}>{e.ms_id} </span>}
                      {e.typ === 'fortschritt' && <b style={{ color: T.green }}>{e.wert}% </b>}
                      {e.typ === 'blocker' && <b style={{ color: T.red }}>+{e.slip} T </b>}
                      {e.text}
                      {e.owner && <span> — {e.owner}</span>}
                      {e.bis && <span style={{ fontFamily: T.mono, color: T.amber }}> (bis {fmtDate(e.bis)})</span>}
                      {e.typ === 'entscheid' && <span style={{ color: e.status === 'offen' ? T.amber : T.green }}> [{e.status}]</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── REPORTS — verdichtete Standard-Reports (Woche/Monat/Quartal), auto-generiert
// aus projekt.yaml + protokolle.json via /api/report/generate. Kein Neu-Erfassen.
function ReportsView({ canEdit, today }) {
  const reports = REPORTS.reports || []
  const qOf = (d) => `${d.slice(0, 4)}-Q${Math.ceil(parseInt(d.slice(5, 7), 10) / 3)}`
  const defP = (lvl) => lvl === 'woche' ? today : lvl === 'monat' ? today.slice(0, 7) : qOf(today)
  const [level, setLevel] = useState('vr')
  const [period, setPeriod] = useState(defP('vr'))
  const [comment, setComment] = useState('')
  const [ki, setKi] = useState(false)   // K5 (01.08.): KI-Entwurf mitgenerieren
  const [busy, setBusy] = useState(false)
  const changeLevel = (l) => { setLevel(l); setPeriod(defP(l)); setComment('') }
  const gen = async () => {
    setBusy(true)
    try {
      if (comment.trim()) await fetch('/api/report/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: `${level}:${period}:programm`, text: comment.trim() }) })
      const r = await fetch('/api/report/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, period, ki }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) { sessionStorage.setItem('rubicon_tab', 'reports'); reloadKeepScroll() }
      else { alert('Report fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(false) }
    } catch (err) { alert('Report fehlgeschlagen: ' + err); setBusy(false) }
  }
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-xl border p-4" style={{ background: T.panel, borderColor: T.brass + '55' }}>
        <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Verdichtete Reports — Woche → Monat → Quartal aus einer Datenbasis
        </div>
        <div className="text-[11px] mb-3" style={{ color: T.inkDim }}>
          Kein Zusammentragen: jeder Report wird aus den erfassten Sitzungen + dem Milestone-Stand berechnet. VR-getaggte Entscheide wandern automatisch ins VR-Pack.
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px]"><span style={{ color: T.inkDim }}>Ebene</span>
            <select value={level} onChange={e => changeLevel(e.target.value)} className="rounded border px-2 py-1" style={inp}>
              {Object.entries(LVL_AUSWAHL).map(([k, lbl]) => <option key={k} value={k} style={{ color: '#111' }}>{lbl}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]"><span style={{ color: T.inkDim }}>Periode</span>
            {level === 'woche' && <input type="date" value={period} onChange={e => setPeriod(e.target.value)} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} />}
            {level === 'monat' && <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} />}
            {level === 'vr' && (
              <select value={period} onChange={e => setPeriod(e.target.value)} className="rounded border px-2 py-1" style={inp}>
                {['2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2'].map(q => <option key={q} value={q} style={{ color: '#111' }}>{q}</option>)}
              </select>
            )}
          </label>
          <label className="flex flex-col gap-1 text-[12px] flex-1 min-w-[240px]"><span style={{ color: T.inkDim }}>{level === 'vr' ? 'Chairman-Statement (optional)' : 'Programm-Kommentar (optional)'}</span>
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="das Urteil, das die Daten nicht liefern …" className="rounded border px-2 py-1" style={inp} />
          </label>
          {canEdit && (
            <label className="flex items-center gap-1.5 pb-2 text-[11.5px] cursor-pointer" style={{ color: ki ? T.brass : T.inkDim }}
              title="Ergänzt den Report um einen klar markierten KI-ENTWURF: Wochen-Narrativ + 2-Satz-Begründung je gefährdetem/verzögertem Meilenstein. Ampel & Zahlen bleiben deterministisch; du gibst vor Verteilung frei.">
              <input type="checkbox" checked={ki} onChange={e => setKi(e.target.checked)} /> 🤖 KI-Entwurf (Narrativ + Ampel-Begründungen)
            </label>
          )}
          {canEdit
            ? <button onClick={gen} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded font-semibold text-[13px]" style={{ background: T.brass, color: '#0b1220', opacity: busy ? 0.6 : 1 }}><BarChart3 size={15} /> {busy ? (ki ? 'erzeugt… (~1-2 Min mit KI)' : 'erzeugt… (~15s)') : `${LVL_LABEL[level]} erzeugen`}</button>
            : <span className="text-[11px]" style={{ color: T.inkFaint }}><Lock size={12} className="inline mr-1" />nur Lesen</span>}
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
        <div className="px-4 py-2 text-[13px] font-semibold border-b" style={{ borderColor: T.line }}>
          Erzeugte Reports <span className="text-[10px]" style={{ color: T.inkFaint }}>({reports.length} — neueste zuerst; Quelle reports_index.json)</span>
        </div>
        {reports.length === 0 && <div className="px-4 py-6 text-[12px]" style={{ color: T.inkFaint }}>Noch kein Report erzeugt.</div>}
        <div className="divide-y" style={{ borderColor: T.line }}>
          {reports.map(r => (
            <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[12px]" style={{ borderTop: `1px solid ${T.line}` }}>
              <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: LVL_COLOR(r.level) + '22', color: LVL_COLOR(r.level), fontFamily: T.mono }}>{LVL_LABEL[r.level] || r.level}</span>
              <b style={{ color: T.ink }}>{r.label}</b>
              <span className="muted" style={{ color: T.inkFaint, fontFamily: T.mono }}>Stand {r.stand}</span>
              <span className="flex-1" />
              <a href={r.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.brass, color: T.brass }}><FileText size={10} /> PDF</a>
              {r.doc_url && <a href={r.doc_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.blue, color: T.blue }}><FileText size={10} /> Doc</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Handlungen im Milestone-Modal — abhakbar (CoS alles, Owner nur eigene; sonst lesend).
// Abhaken schreibt via POST /api/task/status (atomar, serverseitiges Owner-Scoping);
// der Roll-up VERDIENT den Fortschritt, HMR lädt neu, Modal öffnet sich wieder.
function TaskSection({ m, role, me }) {
  const ts = tasksFor(m.id)
  const [busy, setBusy] = useState(null)
  // Leerer Zustand statt Ausblenden (DRS 01.08.): sonst wirkt es, als gäbe es
  // die Handlungs-Ebene bei neuen MS (WS7/FIN/Kickoff) gar nicht.
  if (!ts.length) return (
    <div className="mx-5 mt-3 rounded-xl border px-3 py-2 text-[11.5px] flex items-center gap-1.5"
      style={{ borderColor: T.line, color: T.inkFaint }}>
      <ListChecks size={13} style={{ color: T.brass }} />
      Noch keine Handlungen hinterlegt — unten per «Zerlegung (KI-Entwurf)» vorschlagen lassen (CoS) oder über Sitzungs-Commitments koppeln.
    </div>
  )
  const done = ts.filter(t => t.status === 'erledigt').length
  const driving = m.progress_source === 'tasks'
  const mayToggle = (t) => can(role, me, 'task.abhaken', t)
  const anyToggle = ts.some(mayToggle)
  const toggle = async (t) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    // Modal-Wiederöffnung VOR dem Write vormerken — der HMR-Reload nach dem
    // Datei-Write kann schneller sein als die Fetch-Antwort.
    sessionStorage.setItem('rubicon_selms', m.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: t.status === 'erledigt' ? 'offen' : 'erledigt' }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) { reloadKeepScroll() }
      else { sessionStorage.removeItem('rubicon_selms'); alert('Abhaken fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(null) }
    } catch (e) { sessionStorage.removeItem('rubicon_selms'); alert('Abhaken fehlgeschlagen: ' + e); setBusy(null) }
  }
  return (
    <div className="mx-5 mt-3 rounded-xl border overflow-hidden" style={{ borderColor: T.brass + '55' }}>
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-wide"
        style={{ background: T.panelSoft, color: T.brass, fontFamily: T.mono }}>
        <ListChecks size={13} />
        HANDLUNGEN — {done}/{ts.length} ERLEDIGT
        {driving
          ? <span className="px-1.5 py-0.5 rounded" style={{ background: T.brass + '22', border: `1px solid ${T.brass}55` }}>treiben den Fortschritt: {m.progress}% verdient</span>
          : <span style={{ color: T.inkFaint, fontWeight: 'normal' }}>(informativ — Fortschritt manuell)</span>}
      </div>
      <div className="divide-y" style={{ borderColor: T.line }}>
        {ts.map(t => {
          const ov = taskOverdue(t)
          const can = mayToggle(t)
          return (
            <div key={t.id} className="px-3 py-2 flex items-start gap-2.5 text-[12px]">
              <button onClick={() => toggle(t)} disabled={!can || !!busy}
                title={can ? (t.status === 'erledigt' ? 'wieder öffnen' : 'als erledigt abhaken') : 'Rolle darf diese Handlung nicht abhaken'}
                className="mt-0.5 shrink-0" style={{ cursor: can ? 'pointer' : 'not-allowed', opacity: busy === t.id ? 0.4 : 1 }}>
                {t.status === 'erledigt'
                  ? <CheckCircle2 size={17} style={{ color: T.green }} />
                  : <Circle size={17} style={{ color: can ? T.brass : T.grey }} />}
              </button>
              <div className="flex-1 min-w-0">
                <span style={{ color: t.status === 'erledigt' ? T.inkFaint : T.ink, textDecoration: t.status === 'erledigt' ? 'line-through' : 'none' }}>
                  {t.text}
                </span>
                <div className="flex flex-wrap gap-x-3 text-[10.5px] mt-0.5" style={{ fontFamily: T.mono, color: T.inkFaint }}>
                  <span title={t.id} style={{ color: T.brass }}>{tnr(t)}</span>
                  {t.owner && <span>{t.owner}</span>}
                  {t.due
                    ? <span style={{ color: ov ? T.red : T.inkFaint }}>fällig {fmtDate(t.due)}{ov ? ' ⚠ überfällig' : ''}</span>
                    : <span>fällig — (Datenlücke)</span>}
                  {t.erledigt_am && <span style={{ color: T.green }}>erledigt {fmtDate(t.erledigt_am)}{t.erledigt_von ? ` · ${t.erledigt_von}` : ''}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-3 py-1.5 text-[10px] border-t flex items-center gap-1.5" style={{ borderColor: T.line, color: T.inkFaint }}>
        {anyToggle
          ? <>Abhaken schreibt persistent (tasks.json{driving ? ' + verdienter Fortschritt in projekt.yaml' : ''}) · Ampel bleibt abgeleitet</>
          : <><Lock size={11} /> Rolle «{role}» ist hier nur lesend{role === 'Owner' ? ' (keine eigene Handlung)' : ''}</>}
      </div>
    </div>
  )
}

// K4 (01.08.): KI-Zerlegungsvorschlag — Agent entwirft 5-10 Handlungen aus dem
// Briefing, CoS prüft/editiert/übernimmt (Grad 2: Agent entwirft, Mensch bestätigt).
// due-Vorschläge sind Annahmen; Übernahme läuft über den regulären /api/task/upsert.
// Roll-up-Aktivierung («treibend») bleibt ein separater, bewusster Haken.
function ZerlegungKI({ m, role }) {
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState(null)   // [{text, owner, due, use}]
  const [activate, setActivate] = useState(false)
  const [err, setErr] = useState(null)
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }

  const suggest = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/task/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, ms_id: m.id }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) setDrafts(j.vorschlaege.map(v => ({ ...v, use: true })))
      else setErr(j.error || 'unbekannt')
    } catch (e2) { setErr(String(e2)) }
    setBusy(false)
  }
  const upd = (i, patch) => setDrafts(d => d.map((x, k) => k === i ? { ...x, ...patch } : x))
  const take = async () => {
    const chosen = (drafts || []).filter(d => d.use && d.text.trim())
    if (busy || !chosen.length) return
    setBusy(true)
    sessionStorage.setItem('rubicon_selms', m.id)
    try {
      const ts = Date.now()
      const r = await fetch('/api/task/upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role, tasks: chosen.map((d, i) => ({ id: `${m.id}-KI${ts}-${i}`, ms_id: m.id, text: d.text.trim(), owner: d.owner || null, due: d.due || null, source: 'zerlegung', origin: 'KI-Vorschlag (CoS freigegeben)' })),
          ...(activate ? { activate_ms: m.id } : {}),
        }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) reloadKeepScroll()
      else { sessionStorage.removeItem('rubicon_selms'); setErr(j.error || 'unbekannt'); setBusy(false) }
    } catch (e2) { sessionStorage.removeItem('rubicon_selms'); setErr(String(e2)); setBusy(false) }
  }

  return (
    <div className="mx-5 mt-3 rounded-xl border p-3" style={{ borderColor: T.line, background: T.panelSoft + '33' }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <b className="text-[11px] tracking-wide" style={{ color: T.brass, fontFamily: T.mono }}>🤖 ZERLEGUNG (KI-ENTWURF)</b>
        {!drafts && (
          <button onClick={suggest} disabled={busy} className="px-3 py-1 rounded border text-[11.5px]"
            style={{ borderColor: T.brass + '88', color: T.brass, opacity: busy ? .5 : 1 }}>
            {busy ? 'entwirft… (~30-60s)' : 'Handlungen vorschlagen lassen'}
          </button>
        )}
        <span className="text-[10.5px]" style={{ color: T.inkFaint }}>Agent entwirft aus dem Briefing — nichts wird ohne deine Übernahme gespeichert; due-Vorschläge sind Annahmen.</span>
      </div>
      {err && <div className="mt-2 text-[11.5px]" style={{ color: T.red }}>Fehlgeschlagen: {err}</div>}
      {drafts && (
        <div className="mt-2 space-y-1.5">
          {drafts.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <input type="checkbox" checked={d.use} onChange={e2 => upd(i, { use: e2.target.checked })} aria-label="Vorschlag übernehmen" />
              <input value={d.text} onChange={e2 => upd(i, { text: e2.target.value })} className="flex-1 min-w-[260px] rounded border px-2 py-1" style={inp} />
              <input value={d.owner || ''} onChange={e2 => upd(i, { owner: e2.target.value })} placeholder="Owner" className="w-36 rounded border px-2 py-1" style={inp} />
              <input type="date" value={d.due || ''} onChange={e2 => upd(i, { due: e2.target.value })} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} title="Vorschlag — prüfen!" />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1.5">
            <button onClick={take} disabled={busy || !drafts.some(d => d.use)} className="px-3 py-1.5 rounded font-semibold text-[11.5px]"
              style={{ background: T.brass, color: '#0b1220', opacity: busy ? .5 : 1 }}>
              {busy ? 'übernimmt…' : `Übernehmen (${drafts.filter(d => d.use).length})`}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: activate ? T.brass : T.inkDim }}
              title="progress_source: tasks — der Milestone-Fortschritt wird ab dann aus den Handlungen VERDIENT (bewusster Akt)">
              <input type="checkbox" checked={activate} onChange={e2 => setActivate(e2.target.checked)} /> Roll-up aktivieren («treibend»)
            </label>
            <button onClick={() => { setDrafts(null); setErr(null) }} className="px-2.5 py-1 rounded border text-[11px]" style={{ borderColor: T.line, color: T.inkDim }}>Verwerfen</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Fortschritt melden + Was-wäre-wenn (B0/DRS 01.08.): 25%-Stufen, Live-Vorschau
// der Wirkung (Ampel/Projektende, deterministisch) und «Speichern» — schreibt via
// /api/ms/progress in projekt.yaml (CoS alles, Owner nur eigene; task-getriebene
// MS gesperrt: dort wird Fortschritt aus Handlungen VERDIENT). Git = Journal.
function WhatIf({ m, role, me }) {
  const [kind, setKind] = useState('progress')
  const [val, setVal] = useState(typeof m.progress === 'number' ? m.progress : 50)
  const [busy, setBusy] = useState(false)
  const driving = m.progress_source === 'tasks'
  const maySave = can(role, me, 'ms.melden', m)
  const current = kind === 'progress' ? (typeof m.progress === 'number' ? m.progress : null) : (m.reported_slip_days || 0)
  const dirty = val !== current
  const save = async () => {
    if (busy || !dirty || !maySave) return
    setBusy(true)
    sessionStorage.setItem('rubicon_selms', m.id)
    try {
      const r = await fetch('/api/ms/progress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, ms_id: m.id, ...(kind === 'progress' ? { progress: val } : { slip: val }) }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (j.ok) reloadKeepScroll()
      else { sessionStorage.removeItem('rubicon_selms'); alert('Speichern fehlgeschlagen: ' + (j.error || 'unbekannt')); setBusy(false) }
    } catch (err) { sessionStorage.removeItem('rubicon_selms'); alert('Speichern fehlgeschlagen: ' + err); setBusy(false) }
  }
  const dataAfter = useMemo(() => ({
    ...BASE,
    workstreams: BASE.workstreams.map(ws => ({
      ...ws,
      milestones: ws.milestones.map(x => x.id === m.id
        ? { ...x, ...(kind === 'progress' ? { progress: val } : { reported_slip_days: val }) }
        : x),
    })),
  }), [kind, val, m.id])
  const stNow = statusOf(m, NOW)
  const mAfter = allMilestones(dataAfter).find(x => x.id === m.id)
  const stAfter = mAfter ? statusOf(mAfter, NOW) : stNow
  const pNow = projectedEnd(BASE).projected
  const pAfter = projectedEnd(dataAfter).projected
  const shift = pNow && pAfter ? daysBetween(pNow, pAfter) : 0
  const inp = { background: T.panelSoft, borderColor: T.line, color: T.ink }
  return (
    <div className="mx-5 mt-3 rounded-xl border p-3" style={{ borderColor: T.line, background: T.panelSoft + '55' }}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <b className="text-[11px] tracking-wide" style={{ color: T.brass, fontFamily: T.mono }}>FORTSCHRITT MELDEN</b>
        <select value={kind} onChange={e => { setKind(e.target.value); setVal(e.target.value === 'progress' ? (typeof m.progress === 'number' ? m.progress : 50) : (m.reported_slip_days || 7)) }}
          className="rounded border px-2 py-1 text-[11px]" style={inp}>
          <option value="progress" style={{ color: '#111' }}>Fortschritt (%)</option>
          <option value="blocker" style={{ color: '#111' }}>Blocker (+Tage Verzug)</option>
        </select>
        {kind === 'progress'
          ? (
            <span className="inline-flex rounded border overflow-hidden" style={{ borderColor: T.line }}>
              {PROGRESS_STEPS.map(p => (
                <button key={p} onClick={() => setVal(p)}
                  className="px-2.5 py-1 text-[11px] font-semibold"
                  style={val === p
                    ? { background: T.brass, color: '#0b1220', fontFamily: T.mono }
                    : { color: current === p ? T.brass : T.inkDim, fontFamily: T.mono, background: 'transparent' }}
                  title={current === p && val !== p ? 'aktueller Stand' : undefined}>
                  {p}%
                </button>
              ))}
            </span>
          )
          : (
            <input type="number" min={0} max={365} step={7} value={val} onChange={e => setVal(+e.target.value)}
              className="w-20 rounded border px-2 py-1 text-[11px]" style={{ ...inp, fontFamily: T.mono }} />
          )}
        <span style={{ color: T.inkDim }}>Ampel</span> <Pill st={stNow} /> <span style={{ color: T.inkDim }}>→</span> <Pill st={stAfter} />
        <span style={{ fontFamily: T.mono, color: shift > 0 ? T.red : shift < 0 ? T.green : T.inkDim }}>
          · Projektende {shift !== 0 ? `${shift > 0 ? '+' : ''}${shift} T` : 'unverändert'}
        </span>
        {maySave && !(driving && kind === 'progress') && (
          <button onClick={save} disabled={busy || !dirty}
            className="px-3 py-1 rounded font-semibold text-[11.5px]"
            style={{ background: dirty ? T.brass : T.line, color: '#0b1220', opacity: busy ? .5 : 1 }}>
            <Save size={12} className="inline mr-1" />{busy ? 'speichert…' : dirty ? 'Speichern' : 'gespeichert'}
          </button>
        )}
      </div>
      <div className="text-[10px] mt-1.5" style={{ color: T.inkFaint }}>
        {driving && kind === 'progress'
          ? '⚙ Dieser Milestone ist task-getrieben — Fortschritt wird aus den Handlungen VERDIENT (oben abhaken statt Prozent tippen). Die %-Leiste dient hier nur der Was-wäre-wenn-Vorschau.'
          : maySave
            ? 'Vorschau ist deterministisch (Ampel/Projektende) · Speichern schreibt nach projekt.yaml — die Änderung erscheint in «Δ Woche».'
            : 'Vorschau (Was-wäre-wenn) — Rolle «' + role + '» ist nur lesend; melden via CoS/Owner.'}
      </div>
    </div>
  )
}

// Milestone-Detail-Modal — ausführliche Aufgaben-Definition (Briefing),
// Struktur analog Commercial-Masterplan (KONTEXT/LEISTUNG/VORGEHEN/KPI/RISIKEN)
// + eingebettetes Briefing-PDF (public/briefings/<id>.pdf).
function BriefingModal({ m, role, me, onClose, onNav }) {
  const b = BRIEFINGS[m.id] || {}
  const st = statusOf(m, NOW)
  const Sect = ({ title, children }) => (
    <div className="mt-3">
      <div className="text-[11px] font-bold tracking-wide" style={{ color: T.brass }}>{title}</div>
      <div className="text-[12px] mt-0.5" style={{ color: T.ink }}>{children}</div>
    </div>
  )
  const pdfUrl = `/briefings/${m.id}.pdf`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-8"
      style={{ background: '#000a' }} onClick={onClose}>
      <div className="w-full max-w-3xl max-h-full overflow-auto rounded-xl border shadow-2xl"
        style={{ background: T.panel, borderColor: T.brass + '66' }} onClick={e => e.stopPropagation()}>
        {/* Kopf */}
        <div className="sticky top-0 px-5 py-3 border-b flex items-start gap-3"
          style={{ background: T.panel, borderColor: T.line }}>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ fontFamily: T.mono, color: T.inkDim }}>
              <b style={{ color: T.brass }}>{m.id}</b>
              <span>{m._wsName || m._ws}</span>
              {m.prio && <b style={{ color: T.red }}>Priorität {m.prio}</b>}
              <Pill st={st} />
              <span>{m.quarter || m.phase || ''}</span>
              {m.critical && <span style={{ color: T.brass }}>◆ kritischer Pfad</span>}
              {m.nachlauf && <span style={{ color: T.brass }}>⏳ Nachlauf Q2/27</span>}
              {m.gate && <span style={{ color: T.brass }}>Gate {m.gate}</span>}
            </div>
            <div className="text-[16px] font-bold mt-1" style={{ color: T.ink }}>{m.name}</div>
          </div>
          {onNav && (
            <span className="flex items-center gap-1">
              <button onClick={() => onNav(-1)} aria-label="Vorheriger Meilenstein" title="Vorheriger Meilenstein (←)"
                className="px-2 py-1 rounded border text-[13px]" style={{ borderColor: T.line, color: T.inkDim }}>‹</button>
              <button onClick={() => onNav(1)} aria-label="Nächster Meilenstein" title="Nächster Meilenstein (→)"
                className="px-2 py-1 rounded border text-[13px]" style={{ borderColor: T.line, color: T.inkDim }}>›</button>
            </span>
          )}
          <a href={pdfUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap"
            style={{ borderColor: T.brass, color: T.brass }}>
            <FileText size={13} /> PDF öffnen
          </a>
          <button onClick={onClose} aria-label="Schliessen"
            className="p-1.5 rounded border" style={{ borderColor: T.line, color: T.inkDim }}>
            <X size={15} />
          </button>
        </div>
        {/* Meta */}
        <div className="px-5 pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11.5px] rounded p-3"
            style={{ background: T.panelSoft }}>
            <div><span style={{ color: T.inkFaint }}>Owner</span><br /><b style={{ fontFamily: T.mono }}>{m.owner || 'zu klären'}</b></div>
            <div><span style={{ color: T.inkFaint }}>Fällig bis</span><br /><b style={{ fontFamily: T.mono }}>{fmtDate(m.due)}{m.date_assumed ? ' *' : ''}</b></div>
            <div><span style={{ color: T.inkFaint }}>Start</span><br /><b style={{ fontFamily: T.mono }}>{m.start ? fmtDate(m.start) : '—'}</b></div>
            <div><span style={{ color: T.inkFaint }}>Abhängig von</span><br /><b style={{ fontFamily: T.mono }}>{(m.depends_on || []).join(', ') || '—'}</b></div>
          </div>
          {b.beteiligte && <div className="text-[11.5px] mt-2" style={{ color: T.inkDim }}><b style={{ color: T.brass }}>Beteiligte:</b> {b.beteiligte}</div>}
          {b.ziel_klartext && (
            <div className="mt-3 rounded p-3 text-[12px]" style={{ background: T.panelSoft, borderLeft: `2.5px solid ${T.brass}`, color: T.ink }}>
              <b style={{ color: T.brass }}>ZIEL IM KLARTEXT:</b> {b.ziel_klartext}
            </div>
          )}
        </div>
        {/* Handlungen (abhakbar — treiben bei aktiviertem Roll-up den Fortschritt) */}
        <TaskSection m={m} role={role} me={me} />
        {/* Zerlegungs-Vorschlag (K4, 01.08.): KI entwirft Handlungen — CoS prüft & übernimmt */}
        {canAny(role, 'ki.nutzen') && <ZerlegungKI m={m} role={role} />}
        {/* Fortschritt melden (25%-Stufen) + Was-wäre-wenn-Vorschau (DRS 01.08.) */}
        <WhatIf m={m} role={role} me={me} />
        {/* Briefing-Sektionen */}
        <div className="px-5 pb-4">
          {Object.keys(b).length === 0 && (
            <div className="mt-3 text-[12px] rounded border p-2"
              style={{ borderColor: T.amber + '88', color: T.amber }}>
              Für diesen Meilenstein liegt noch kein Briefing vor — er wurde NACH der ursprünglichen
              Programm-Assemblierung eingebucht (WS7/FIN/Kickoff-Ergänzungen). Termine, Ampel und
              Handlungen sind vollständig; es fehlt nur die ausführliche Aufgaben-Definition
              (Kontext/Leistung/Vorgehen/KPI/Risiken). Nachziehen: Briefing-Text erfassen → PDFs regenerieren.
            </div>
          )}
          {b.kontext && <Sect title="KONTEXT — WARUM DIESER MILESTONE">{b.kontext}</Sect>}
          {(b.leistung || []).length > 0 && <Sect title="ERWARTETE LEISTUNG (DELIVERABLES)">
            <ul className="list-disc pl-4">{b.leistung.map((x, i) => <li key={i}>{x}</li>)}</ul></Sect>}
          {(b.vorgehen || []).length > 0 && <Sect title="VORGEHEN">
            <ol className="list-decimal pl-4">{b.vorgehen.map((x, i) => <li key={i}>{x}</li>)}</ol></Sect>}
          {(b.erfolgsmessung || m.kpi) && <Sect title="ERFOLGSMESSUNG (KPI)">{b.erfolgsmessung || m.kpi}</Sect>}
          {(b.risiken || []).length > 0 && <Sect title="RISIKEN & ABHÄNGIGKEITEN">
            <ul className="list-disc pl-4">{b.risiken.map((x, i) => <li key={i}>{x}</li>)}</ul></Sect>}
          {b.grounding && <Sect title="DATENGRUNDLAGE"><span style={{ color: T.inkDim }}>{b.grounding}</span></Sect>}
          {/* Eingebettetes Briefing-PDF: klickbare Seiten-1-Vorschau (PNG lädt überall
              zuverlässig; Klick öffnet die vollständige PDF). */}
          <div className="mt-4 rounded border overflow-hidden" style={{ borderColor: T.line }}>
            <div className="px-3 py-1.5 text-[10px] flex items-center justify-between"
              style={{ background: T.panelSoft, color: T.inkDim, fontFamily: T.mono }}>
              <span className="flex items-center gap-1.5"><FileText size={11} /> Briefing-PDF — {m.id}.pdf (automatisch generiert, aktueller Stand)</span>
              <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: T.brass }}>vollständig öffnen →</a>
            </div>
            <a href={pdfUrl} target="_blank" rel="noreferrer" title="Vollständige PDF öffnen"
              className="block" style={{ maxHeight: '58vh', overflow: 'auto', background: '#fff' }}>
              <img src={`/briefings/${m.id}.png`} alt={`Briefing ${m.id} — Seite 1`}
                className="w-full" style={{ display: 'block' }} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
