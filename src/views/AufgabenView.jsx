import React, { useState, useEffect } from 'react'
import { T } from '../lib/theme.js'
import { ALL_TASKS, BASE, MS_META, reloadKeepScroll, taskOverdue, tnr } from '../lib/data.js'
import { fmtDate } from '../lib/status.js'
import { PHASE_ORDER } from '../lib/domain.js'
import { can } from '../lib/permissions.js'
import { ArtefaktZeile, PhaseTag } from '../components/ui.jsx'
import { CheckCircle2, Circle, Filter } from 'lucide-react'

// ── AUFGABEN — flache, filterbare Liste ALLER Handlungen (Phase × WS × Person ×
// Status), sortiert nach Fälligkeit. Beantwortet «was muss ICH bis wann tun?» —
// das Gegenstück zur Milestone-Sicht des Kontrollturms. Abhaken wie überall:
// /api/task/status, CoS alles / Owner nur eigene, Ampel bleibt abgeleitet.
export function AufgabenView({ role, me, prog, onOpenMs }) {
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
  const [artefaktFuer, setArtefaktFuer] = useState(null)   // Task-ID mit offener Artefakt-Zeile

  // Scope-Filter (DRS 03.08.): AXS-Gesamt (kein prog) = alle Handlungen inkl. ungekoppelte.
  // Projekt-Fokus (prog gesetzt) = STRIKT nur die Handlungen dieses Projekts (ms_id→WS→Programm);
  // ungekoppelte (ms_id null) sind keinem Projekt zuordenbar → nur in AXS-Gesamt sichtbar.
  const rows = ALL_TASKS.map(t => ({ ...t, _m: t.ms_id ? MS_META[t.ms_id] : null }))
    .filter(t => !prog || (t._m && t._m.programm === prog))
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
  // Artefakt-Pflicht Stufe 2 (04.08.): Abhaken fragt zuerst den Ablage-Pointer ab;
  // Wiederöffnen läuft direkt durch.
  const klick = (t) => {
    if (busy || !mayToggle(t)) return
    if (t.status === 'erledigt') toggle(t)
    else setArtefaktFuer(t.id)
  }
  const toggle = async (t, artefakt) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: t.status === 'erledigt' ? 'offen' : 'erledigt',
          ...(artefakt ? { artefakt } : {}) }),
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
                  <React.Fragment key={t.id}>
                  <tr style={{ borderTop: `1px solid ${T.line}`, opacity: t.status === 'erledigt' ? 0.55 : 1 }}>
                    <td className="px-3 py-1.5">
                      <button onClick={() => klick(t)} disabled={!can || !!busy}
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
                    <td className="px-2 py-1.5">
                      {t._m ? <PhaseTag p={t._m.phase} /> : <span style={{ color: T.grey, fontSize: 10 }}>—</span>}
                      {t.artefakt && <span title={t.artefakt} style={{ color: T.brass, marginLeft: 6 }}>📎</span>}
                    </td>
                  </tr>
                  {artefaktFuer === t.id && (
                    <tr><td colSpan={7} style={{ padding: 0 }}>
                      <ArtefaktZeile busy={busy}
                        onOk={(v) => { setArtefaktFuer(null); toggle(t, v) }}
                        onSkip={() => { setArtefaktFuer(null); toggle(t) }}
                        onCancel={() => setArtefaktFuer(null)} />
                    </td></tr>
                  )}
                  </React.Fragment>
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

