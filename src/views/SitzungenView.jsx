import React, { useState, useEffect } from 'react'
import { T } from '../lib/theme.js'
import { ALL_TASKS, reloadKeepScroll, taskOverdue, tnr, FR, PROTO, AGENDAS, traktDocUrl } from '../lib/data.js'
import { fmtDate } from '../lib/status.js'
import { PROGRESS_STEPS, TYP_ICON, TYP_LABEL } from '../lib/domain.js'
import { can } from '../lib/permissions.js'
import { MsPicker, ArtefaktZeile } from '../components/ui.jsx'
import { Circle, FileText, Plus, Save, Trash2 } from 'lucide-react'

// ── SITZUNG ERFASSEN — Sitzungs-Output strukturiert erfassen (5 Typen),
// schreibt via /api/sitzung in projekt.yaml (Fortschritt/Blocker) + protokolle.json.
export const AGENDA_BY_ID = Object.fromEntries((AGENDAS.agendas || []).map(a => [a.meeting_id, a]))
// Erfassbar sind NUR echte Tower-Sitzungen (typ 'sitzung') — Reports/Backbone sind keine
// Meetings, Ops-Ebene bleibt ausserhalb, VR läuft in Sherpany (typ 'extern'). (01.08.)
export const FR_MEETINGS = FR.gruppen.flatMap(g => g.meetings.filter(m => (m.typ || 'sitzung') === 'sitzung').map(m => ({ id: m.id, name: m.name })))

// K1 (01.08.): Meet-Notiz (Gemini) → Vorschau → Übernahme. PRIMÄRWEG für
// Sitzungsprotokolle; das manuelle Formular darunter bleibt Fallback (Meetings
// ohne Gemini-Notiz, Ad-hoc-Gespräche). Immer Mensch im Loop: «Suchen & Vorschau»
// = Dry-Run (nichts geschrieben) → «Übernehmen» = regulärer /api/sitzung-Pfad.
export function GeminiImport({ role, me }) {
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

export function ErfassungView({ ms, today, role, me }) {
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
            <div className="flex items-center gap-2">
              <a href={`/traktanden/${meetingId}.pdf`} target="_blank" rel="noreferrer" className="text-[11px]" style={{ color: T.brass }}><FileText size={11} className="inline mr-1" />Agenda-PDF</a>
              {traktDocUrl(meetingId) && (
                <a href={traktDocUrl(meetingId)} target="_blank" rel="noreferrer" className="text-[11px]" style={{ color: T.blue }}><FileText size={11} className="inline mr-1" />Doc ↗</a>
              )}
            </div>
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

// ── PROTOKOLLE — erfasste Sitzungen + aggregierte offene Commitments/Entscheide.
export function ProtokolleView({ role, me }) {
  const [busy, setBusy] = useState(null)
  const [artefaktFuer, setArtefaktFuer] = useState(null)   // Commitment-ID mit offener Artefakt-Zeile
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
  // Artefakt-Pflicht Stufe 2 (04.08.): Erledigen fragt zuerst den Ablage-Pointer ab.
  const erledige = async (t, artefakt) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: 'erledigt', ...(artefakt ? { artefakt } : {}) }),
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
              <div key={c.id} style={{ borderTop: i ? `1px solid ${T.line}` : 'none' }}>
                <div className="text-[12px] py-1 flex items-start gap-2">
                <button onClick={() => setArtefaktFuer(c.id)} disabled={!can || !!busy} className="mt-0.5 shrink-0"
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
                {artefaktFuer === c.id && (
                  <ArtefaktZeile busy={busy}
                    onOk={(v) => { setArtefaktFuer(null); erledige(c, v) }}
                    onSkip={() => { setArtefaktFuer(null); erledige(c) }}
                    onCancel={() => setArtefaktFuer(null)} />
                )}
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

