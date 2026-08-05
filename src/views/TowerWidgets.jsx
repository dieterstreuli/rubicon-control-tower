import React, { useState, useEffect } from 'react'
import { T } from '../lib/theme.js'
import { fmtDate } from '../lib/status.js'
import { Pill } from '../components/ui.jsx'
import { MS_META, reloadKeepScroll, ZBSTORE } from '../lib/data.js'
import { ZB_FLOW, ZB_META, ZB_DOMAENEN, ZB_COLOR, ZB_SCORE, ZB_EVIDENZ_AB } from '../lib/domain.js'
import { canAny } from '../lib/permissions.js'

// ── Δ WOCHE (B2, 01.08.) — Führungs-Delta: erledigte Handlungen, Fortschritts-/
// Ampel-Änderungen (git-Vergleich), neue Protokolle/Entscheide. Reine Fakten.
export function DeltaWoche({ prog }) {
  const [d0, setD0] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch('/api/delta?days=7')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(j => (j.ok ? setD0(j) : setErr(j.error || 'Fehler')))
      .catch(e => setErr(String(e)))
  }, [])
  if (err) return null   // Delta ist Komfort — bei Fehlern still weglassen (Log hat den Fehler)
  if (!d0) return <div className="text-[11px]" style={{ color: T.inkFaint, fontFamily: T.mono }}>Δ Woche wird berechnet…</div>
  // Scope-Filter (DRS 03.08.): im Projekt-Fokus nur attribuierbare Δ — ampel/fortschritt via
  // Milestone-Programm, erledigt via ms_id; Protokolle/Entscheide querschnittlich → ausgeblendet.
  const d = !prog ? d0 : (() => {
    const inP = (mid) => MS_META[mid]?.programm === prog
    const ampel = (d0.ampel || []).filter(x => inP(x.id))
    const fortschritt = (d0.fortschritt || []).filter(x => inP(x.id))
    const erledigt = (d0.erledigt || []).filter(x => x.ms_id && inP(x.ms_id))
    return { ...d0, ampel, fortschritt, erledigt, protokolle: [], entscheide: [],
      summe: { erledigt: erledigt.length, fortschritt: fortschritt.length, ampel: ampel.length, protokolle: 0, entscheide: 0 } }
  })()
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

// ── AXS-ZIELBILD (04.08., «Datengehirn») — SOLL-Katalog prüfbarer Kriterien je Domäne.
// Erfüllungsgrad deterministisch aus domain.json-Scores; Reifegrad-Upgrade auf
// «vorhanden»/«gelebt» NUR mit Evidenz (Server erzwingt). Konzern-Messlatte —
// wird nur in der AXS-Gesamt-Sicht gezeigt (App.jsx: !prog).
export function ZielbildCard({ role }) {
  const [openDom, setOpenDom] = useState(null)
  const [edit, setEdit] = useState(null)          // {id, status, evidenz}
  const [err, setErr] = useState(null)
  const zs = ZBSTORE.zielbild || []
  if (!zs.length) return null
  const darf = canAny(role, 'zielbild.fortschreiben')
  const byDom = {}
  zs.forEach(z => { (byDom[z.domaene] = byDom[z.domaene] || []).push(z) })
  const pct = (arr) => Math.round(arr.reduce((n, z) => n + ZB_SCORE(z.status), 0) / arr.length)
  const gesamt = pct(zs)
  const speichern = async () => {
    if (!edit) return
    setErr(null)
    try {
      const r = await fetch('/api/zielbild/status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: edit.id, status: edit.status, evidenz: edit.evidenz, role, me: role }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'ungültige Antwort' }))
      if (!j.ok) { setErr(`${edit.id}: ${j.error || 'Fehler'}`); return }
      reloadKeepScroll()
    } catch (e2) { setErr(String(e2)) }
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: T.panel, borderColor: T.line }}>
      <div className="px-4 py-2 text-[12px] font-semibold border-b flex flex-wrap items-center gap-2" style={{ borderColor: T.line }}>
        <span style={{ fontFamily: T.mono, color: T.brass }}>── AXS-ZIELBILD · SOLL-ERFÜLLUNG {gesamt}% ──</span>
        <span className="font-normal text-[11px]" style={{ color: T.inkDim }}>
          {zs.length} Kriterien · {ZB_FLOW.map(st => `${zs.filter(z => z.status === st).length} ${ZB_META[st].label}`).join(' · ')}
        </span>
        <span className="font-normal text-[10px] ml-auto" style={{ color: T.inkFaint, fontFamily: T.mono }}>
          Upgrade ab «{ZB_META[ZB_EVIDENZ_AB].label}» nur mit Evidenz
        </span>
      </div>
      <div className="px-4 py-3 grid gap-1.5">
        {Object.entries(ZB_DOMAENEN).filter(([k]) => byDom[k]).map(([k, name]) => {
          const arr = byDom[k]; const p = pct(arr); const open = openDom === k
          return (
            <div key={k}>
              <button onClick={() => setOpenDom(open ? null : k)} className="w-full flex items-center gap-2 text-[12px] py-0.5 text-left">
                <span style={{ fontFamily: T.mono, color: T.inkDim, width: 34 }}>{k}</span>
                <span className="w-56 truncate" style={{ color: T.ink }}>{name}</span>
                <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
                  <span className="block h-full rounded-full" style={{ width: `${p}%`, background: p >= 67 ? T.green : p >= 40 ? T.amber : T.red }} />
                </span>
                <b style={{ fontFamily: T.mono, color: T.ink, width: 40, textAlign: 'right' }}>{p}%</b>
                <span style={{ color: T.inkFaint }}>{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="ml-9 mt-1 mb-2 grid gap-1">
                  {arr.map(z => (
                    <div key={z.id} className="text-[11.5px] flex items-start gap-2 py-0.5" title={`Messbar an: ${z.messbar_an}${z.naechster_schritt ? `\nNächster Schritt: ${z.naechster_schritt}` : ''}`}>
                      <span style={{ fontFamily: T.mono, color: T.inkFaint, width: 76, flexShrink: 0 }}>{z.id}</span>
                      <span className="text-[10px] px-1.5 rounded-full flex-shrink-0" style={{ background: ZB_COLOR(z.status) + '22', color: ZB_COLOR(z.status), fontFamily: T.mono }}>{ZB_META[z.status].label}</span>
                      <span className="flex-1" style={{ color: T.inkDim }}>{z.kriterium}</span>
                      {darf && (edit?.id === z.id
                        ? <span className="flex items-center gap-1 flex-shrink-0">
                            <select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}
                              className="text-[10.5px] border rounded px-1" style={{ background: T.panelSoft, borderColor: T.line, color: T.ink }}>
                              {ZB_FLOW.map(st => <option key={st} value={st} style={{ color: '#111' }}>{ZB_META[st].label}</option>)}
                            </select>
                            <input value={edit.evidenz} onChange={e => setEdit({ ...edit, evidenz: e.target.value })} placeholder="Evidenz (Link/Quelle)"
                              className="text-[10.5px] border rounded px-1 w-40" style={{ background: T.panelSoft, borderColor: T.line, color: T.ink }} />
                            <button onClick={speichern} className="text-[10.5px] px-1.5 rounded border" style={{ borderColor: T.brass, color: T.brass }}>OK</button>
                            <button onClick={() => setEdit(null)} className="text-[10.5px] px-1 rounded" style={{ color: T.inkFaint }}>✕</button>
                          </span>
                        : <button onClick={() => setEdit({ id: z.id, status: z.status, evidenz: z.evidenz || '' })}
                            className="text-[10.5px] px-1.5 rounded border flex-shrink-0" style={{ borderColor: T.line, color: T.inkFaint }}>fortschreiben</button>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {err && <div className="text-[11px]" style={{ color: T.red }}>{err}</div>}
      </div>
    </div>
  )
}

// ── FRAG DIE DATEN (K7, 01.08.) — read-only NL-Abfrage über die Plattform-Stores.
// Harte Quellenbindung (IDs zitieren, «nicht in den Daten» statt raten); alle Rollen.
export function FragDieDaten() {
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

