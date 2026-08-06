import React, { useState } from 'react'
import { T } from '../lib/theme.js'
import { reloadKeepScroll, REPORTS, SERVER } from '../lib/data.js'
import { LVL_AUSWAHL, LVL_COLOR, LVL_LABEL } from '../lib/domain.js'
import { BarChart3, FileText, Lock } from 'lucide-react'

// ── REPORTS — verdichtete Standard-Reports (Woche/Monat/Quartal), auto-generiert
// aus projekt.yaml + protokolle.json via /api/report/generate. Kein Neu-Erfassen.
export function ReportsView({ canEdit, today }) {
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
          {reports.map(r => {
            // Modusabhängig: auf dem Server zeigen die Links auf die Server-Artefakte
            // (server_doc_url + volume-PDF, das der Job erzeugt hat), lokal auf Dieters
            // eigene doc_url/PDF. KEIN Fallback auf die jeweils andere Umgebung (sonst 403
            // für Server-Nutzer auf Dieters privatem Doc). Ältere Reports ohne Server-
            // Artefakte (nie serverseitig erzeugt) erscheinen ohne tote Links.
            const docUrl = SERVER ? r.server_doc_url : r.doc_url
            const pdfShown = SERVER ? !!r.server_pdf_id : true
            const localOnly = SERVER && !r.server_doc_id && !r.server_pdf_id
            return (
              <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-[12px]" style={{ borderTop: `1px solid ${T.line}` }}>
                <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: LVL_COLOR(r.level) + '22', color: LVL_COLOR(r.level), fontFamily: T.mono }}>{LVL_LABEL[r.level] || r.level}</span>
                <b style={{ color: T.ink }}>{r.label}</b>
                <span className="muted" style={{ color: T.inkFaint, fontFamily: T.mono }}>Stand {r.stand}</span>
                <span className="flex-1" />
                {localOnly && <span className="text-[10px]" style={{ color: T.inkFaint, fontFamily: T.mono }}>nur lokal</span>}
                {pdfShown && <a href={r.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.brass, color: T.brass }}><FileText size={10} /> PDF</a>}
                {docUrl && <a href={docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]" style={{ borderColor: T.blue, color: T.blue }}><FileText size={10} /> Doc</a>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

