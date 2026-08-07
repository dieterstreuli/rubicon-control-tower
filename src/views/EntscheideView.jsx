import React, { useState, useEffect } from 'react'
import { T } from '../lib/theme.js'
import { ALL_TASKS, reloadKeepScroll, tnr, ENTS } from '../lib/data.js'
import { fmtDate } from '../lib/status.js'
import { ENT_COLOR, ENT_FLOW, ENT_GREMIEN, ENT_TYPEN } from '../lib/domain.js'
import { can, canAny } from '../lib/permissions.js'
import { Filter, Plus, Save } from 'lucide-react'

// ── ENTSCHEIDS-REGISTER — Säule 3 der Entscheidungsordnung (INS-001 Anhang B):
// jeder Entscheid zentral, mit dauerhafter E-Nummer, Begründung, Datengrundlage,
// 5-Stufen-Status (beantragt→entscheidungsreif→entschieden→kommuniziert→umgesetzt)
// und Kommunikations-Stempel. Revisionssicher: kein Löschen. Gespeist aus der
// Sitzungserfassung (Spiegel in /api/sitzung) + manueller Erfassung hier.

// A4 (01.08.): Begründung/Datengrundlage direkt im Register-Detail nachpflegen —
// nötig, weil der Server «entschieden» ohne Begründung jetzt hart ablehnt.
// Upsert über denselben key erhält Lifecycle (Status/Kommunikation/E-Nummer).
export function EntEdit({ e, role, me, today }) {
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

export function EntscheideView({ role, me, today }) {
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
                              {e.export?.server_doc_url && <> · <a href={e.export.server_doc_url} target="_blank" rel="noopener noreferrer" style={{ color: T.blue }}>Doc ↗</a></>}
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

