import React, { useState, useEffect } from 'react'
import { T } from '../lib/theme.js'
import { fmtDate } from '../lib/status.js'
import { Pill } from '../components/ui.jsx'

// ── Δ WOCHE (B2, 01.08.) — Führungs-Delta: erledigte Handlungen, Fortschritts-/
// Ampel-Änderungen (git-Vergleich), neue Protokolle/Entscheide. Reine Fakten.
export function DeltaWoche() {
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

