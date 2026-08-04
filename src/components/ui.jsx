// ui.jsx — wiederverwendbare UI-Bausteine (R1, 01.08.2026).
// Aus App.jsx herausgelöst; kennen nur Theme + Domänen-SSOT, keine Views.
import React, { useState } from 'react'
import { T, STATUS_META } from '../lib/theme.js'
import { phaseToken, artefaktGueltig, ARTEFAKT_HINWEIS } from '../lib/domain.js'

// ── ARTEFAKT-ZEILE (Stufe 2, 04.08. «AXS-Datengehirn») — erscheint beim Abhaken und
// fragt den Ablage-Pointer des Arbeitsprodukts ab. Bewusst KEIN Hard-Block: «ohne
// Artefakt» bleibt möglich (sonst wird Schrott eingetippt), validate.py meldet den
// Fall dann als Datenlücke. Format wird clientseitig geprüft, der Server nochmals.
export function ArtefaktZeile({ onOk, onSkip, onCancel, busy }) {
  const [v, setV] = useState('')
  const ok = artefaktGueltig(v)
  const btn = { padding: '2px 8px', borderRadius: 4, border: `1px solid ${T.line}` }
  return (
    <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-[11.5px]"
      style={{ background: T.panelSoft, borderTop: `1px solid ${T.brass}44` }}>
      <span style={{ color: T.brass, fontFamily: T.mono, fontSize: 10 }}>ARTEFAKT</span>
      <input value={v} autoFocus onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && ok) onOk(v); if (e.key === 'Escape') onCancel() }}
        placeholder={ARTEFAKT_HINWEIS} aria-label="Ablage-Link des Arbeitsprodukts"
        className="flex-1 min-w-[220px] rounded border px-2 py-1"
        style={{ background: T.panel, borderColor: v && !ok ? T.red : T.line, color: T.ink }} />
      <button onClick={() => onOk(v)} disabled={!ok || !!busy} style={{ ...btn, borderColor: ok ? T.brass : T.line, color: ok ? T.brass : T.inkFaint, opacity: ok ? 1 : .5 }}>
        abhaken
      </button>
      <button onClick={onSkip} disabled={!!busy} style={{ ...btn, color: T.inkFaint }} title="Handlung ohne Ablage-Nachweis schliessen — validate meldet das als Datenlücke">
        ohne Artefakt
      </button>
      <button onClick={onCancel} disabled={!!busy} style={{ color: T.inkFaint }} aria-label="abbrechen">✕</button>
      {v && !ok && <span style={{ color: T.red }}>kein gültiger Archiv-Pointer</span>}
    </div>
  )
}

// ---------- kleine Bausteine ----------
export const Pill = ({ st }) => {
  const m = STATUS_META[st] || STATUS_META.unknown
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.color + '22', color: m.color, border: `1px solid ${m.color}55`, fontFamily: T.mono }}>
      {m.label}
    </span>
  )
}

export const Bar = ({ v }) => (
  <div className="w-full h-2 rounded" style={{ background: T.line }}>
    {typeof v === 'number'
      ? <div className="h-2 rounded" style={{ width: Math.min(100, v) + '%', background: v >= 100 ? T.blue : T.green }} />
      : <div className="h-2 rounded w-full flex items-center justify-center text-[9px]" style={{ color: T.grey }}>·· unbekannt ··</div>}
  </div>
)

export const Kpi = ({ label, value, color, sub }) => (
  <div className="rounded-xl p-4 border" style={{ background: T.panel, borderColor: T.line }}>
    <div className="text-[11px] uppercase tracking-wider" style={{ color: T.inkDim }}>{label}</div>
    <div className="text-3xl font-bold mt-1" style={{ color, fontFamily: T.mono }}>{value}</div>
    {sub && <div className="text-[11px] mt-1" style={{ color: T.inkFaint }}>{sub}</div>}
  </div>
)

// Phasen — kanonische Reihenfolge, Farbe (analog Intro) und Kurzlabel.
export const phaseColor = (p) => {
  if (!p) return T.grey
  if (p.startsWith('Masterplan')) return T.inkFaint
  const tok = phaseToken(p)
  return tok ? T[tok] : T.inkDim
}
export const phaseShort = (p) => !p ? '—' : p.startsWith('Masterplan') ? p.replace('Masterplan · ', 'MP · ') : p
export const FR_COL = { grey: '#64748b', green: '#34d399', blue: '#60a5fa', brass: '#d4a95c' }
export const PhaseTag = ({ p }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap"
    style={{ color: phaseColor(p), background: phaseColor(p) + '1e', border: `1px solid ${phaseColor(p)}44`, fontFamily: T.mono }}>
    {phaseShort(p)}
  </span>
)


// A2 (01.08.): MS-Auswahl mit Textfilter — 167 Meilensteine sind per nativem
// Select nicht mehr greifbar. Tippen filtert die Optionsliste live.
export function MsPicker({ ms, value, onChange, optional, style: inp }) {
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

