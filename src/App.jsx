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
import { BASE, ISSUES, NOW, ALL_TASKS, MS_META, tasksFor, tnr, taskOverdue, RADAR, reloadKeepScroll, BRIEFINGS, FR, TRAKT_DOCS, PROTO, AGENDAS, REPORTS, ENTS, REMLOG } from './lib/data.js'
import { Pill, Bar, Kpi, PhaseTag, phaseColor, phaseShort, FR_COL, MsPicker } from './components/ui.jsx'
import { DeltaWoche, FragDieDaten, ZielbildCard } from './views/TowerWidgets.jsx'
import { FuehrungsrhythmusCard, IntroView } from './views/IntroView.jsx'
import { AGENDA_BY_ID, ErfassungView, FR_MEETINGS, GeminiImport, ProtokolleView } from './views/SitzungenView.jsx'
import { EntEdit, EntscheideView } from './views/EntscheideView.jsx'
import { AufgabenView } from './views/AufgabenView.jsx'
import { ReportsView } from './views/ReportsView.jsx'
import { BriefingModal, TaskSection, WhatIf, ZerlegungKI } from './views/MilestoneModal.jsx'
import { can, canAny } from './lib/permissions.js'   // Q4: EINE Rechte-Matrix (identisch auf dem Server)
import {
  PHASE_ORDER, phaseToken, ENT_FLOW, ENT_TYPEN, ENT_GREMIEN, ENT_COLOR,
  TYP_LABEL, TYP_ICON, LVL_LABEL, LVL_AUSWAHL, LVL_COLOR, PROGRESS_STEPS, roleInfo,
} from './lib/domain.js'
import {
  statusOf, slipDays, projectedEnd, counts, overallStatus, allMilestones,
  parseDate, fmtDate, daysBetween, hardEdgeBreaches,
} from './lib/status.js'

// ---------- App ----------
// Input→Programm (DRS 03.08.): Datenlieferungen haben kein programm-Feld, aber liefer_tasks
// (Handlung «<MS>-H##») → Milestone → WS → Programm. Ungekoppelte Inputs = nur in AXS-Gesamt.
const _taskById = new Map(ALL_TASKS.map(t => [t.id, t]))
const inputProgramme = (i) => [...new Set((i.liefer_tasks || []).map(tid => {
  const mid = _taskById.get(tid)?.ms_id || tid.replace(/-H\d+$/, '')
  return MS_META[mid]?.programm || null
}).filter(Boolean))]

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
  // Default = AXS-Gesamt ('' = alle Programme/Projekte); Programm/Projekt ist nur ein Filter (DRS 03.08.).
  const [prog, setProg] = useState(() => sessionStorage.getItem('rubicon_prog') || '')
  useEffect(() => { if (prog) sessionStorage.setItem('rubicon_prog', prog); else sessionStorage.removeItem('rubicon_prog') }, [prog])

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
    inputs: BASE.inputs.map(i => ({ ...i, ...(inputState[i.id] || {}) }))
      .filter(i => !prog || inputProgramme(i).includes(prog)),
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
            {prog && (
              <button onClick={() => setProg('')}
                className="text-[11px] px-2 py-1 rounded border"
                style={{ borderColor: T.brass + '88', color: T.brass, background: T.panelSoft, fontFamily: T.mono }}
                title="Filter aufheben — zurück zur AXS-Gesamtübersicht">
                Fokus: {(BASE.meta.programme || []).find(p => p.id === prog)?.name || prog} ✕
              </button>
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
          {/* Scope-Kacheln (DRS 03.08.): AXS-Gesamt = Default, je Programm/Projekt zum Reinfokussieren */}
          {(() => {
            const SCOPES = [{ id: '', name: 'AXS-Gesamt', all: true }, ...(BASE.meta.programme || [])]
            const statOf = (pid) => {
              const wss = BASE.workstreams.filter(w => !pid || w.programm === pid)
              const msAll = wss.flatMap(w => w.milestones || [])
              const done = msAll.filter(m => m.progress === 100).length
              const offen = ALL_TASKS.filter(t => t.status === 'offen'
                && (!pid || (t.ms_id && MS_META[t.ms_id]?.programm === pid))).length
              return { ws: wss.length, ms: msAll.length, done, offen }
            }
            const ACCENTS = [T.blue, T.green, T.amber, T.red, T.grey]
            return (
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.inkFaint, fontFamily: T.mono }}>
                  Portfolio · Fokus wählen
                </div>
                <div className="flex flex-wrap gap-2">
                  {SCOPES.map((sc, i) => {
                    const active = (sc.id || '') === (prog || '')
                    const s = statOf(sc.id)
                    const accent = sc.all ? T.brass : ACCENTS[(i - 1) % ACCENTS.length]
                    return (
                      <button key={sc.id || 'all'} onClick={() => setProg(sc.id || '')}
                        className="text-left rounded-lg px-3 py-2 transition"
                        style={{ minWidth: 158,
                          borderTop: `1px solid ${active ? T.brass : T.line}`,
                          borderRight: `1px solid ${active ? T.brass : T.line}`,
                          borderBottom: `1px solid ${active ? T.brass : T.line}`,
                          borderLeft: `4px solid ${accent}`,
                          background: active ? accent + '22' : 'transparent',
                          boxShadow: active ? `inset 0 0 0 1px ${T.brass}` : 'none' }}>
                        <div className="text-[12px] font-semibold leading-tight" style={{ color: active ? T.brass : accent }}>
                          {sc.all ? '★ ' : ''}{sc.name}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: T.inkDim, fontFamily: T.mono }}>
                          {s.ws} WS · {s.ms} MS · {s.done} ✓
                        </div>
                        <div className="text-[10px]" style={{ color: s.offen ? T.amber : T.inkFaint, fontFamily: T.mono }}>
                          {s.offen} Handlungen offen
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
          {(() => {
            // Handlungen-KPI (DRS 03.08.): im Projekt-Fokus STRIKT nur die Handlungen des Projekts
            // (konsistent mit Kacheln + Aufgaben-Liste); ungekoppelte nur in AXS-Gesamt.
            const progTasks = ALL_TASKS.filter(t => !prog || (t.ms_id && MS_META[t.ms_id]?.programm === prog))
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
          {/* AXS-Zielbild (04.08., «Datengehirn»): Konzern-Messlatte — nur in der Gesamt-Sicht */}
          {!prog && <ZielbildCard role={role} />}

          <DeltaWoche prog={prog} />

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
                  {data.workstreams.map(w => <option key={w.code} value={w.code} style={{ color: '#111' }}>{w.code} — {w.name?.slice(0, 40)}</option>)}
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
            {/* Ziel des gefilterten Stroms (Rohde-Feedback 06.08.) — sonst sieht man in der
                Standardansicht nur Aufgaben und nie das Wozu. */}
            {wsFilter !== 'alle' && (() => {
              const zws = data.workstreams.find(w => w.code === wsFilter)
              return zws?.ziel ? (
                <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-[11.5px]"
                  style={{ background: T.brass + '14', borderLeft: `3px solid ${T.brass}`, color: T.ink }}>
                  <span style={{ fontFamily: T.mono, color: T.brass, fontSize: 10 }}>ZIEL {zws.code} </span>
                  {zws.ziel}
                </div>
              ) : null
            })()}
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
                  {/* Ziel-Ebene (Rohde-Feedback 06.08.): Ohne Ziel sind Milestones eine
                      Aufgabenliste ohne Sinn. Steht bewusst ÜBER den Meilensteinen. */}
                  {ws.ziel && (
                    <div className="mt-3 rounded-lg px-3 py-2 text-[11.5px]"
                      style={{ background: T.brass + '14', borderLeft: `3px solid ${T.brass}`, color: T.ink }}>
                      <span style={{ fontFamily: T.mono, color: T.brass, fontSize: 10 }}>ZIEL </span>
                      {ws.ziel}
                    </div>
                  )}
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
        {' · '}
        <span title={`Build ${__BUILD_SHA__}`} className="cursor-help" style={{ borderBottom: `1px dotted ${T.inkFaint}` }}>
          Stand {__BUILD_TIME__}
        </span>
      </footer>
    </div>
  )
}


