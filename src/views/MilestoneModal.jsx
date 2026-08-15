import React, { useState, useMemo } from 'react'
import { T } from '../lib/theme.js'
import { BASE, NOW, reloadKeepScroll, taskOverdue, tasksFor, tnr, BRIEFINGS, BRIEFINGS_DOCS } from '../lib/data.js'
import { allMilestones, daysBetween, fmtDate, projectedEnd, statusOf } from '../lib/status.js'
import { PROGRESS_STEPS } from '../lib/domain.js'
import { can, canAny } from '../lib/permissions.js'
import { ArtefaktZeile, Pill } from '../components/ui.jsx'
import { CheckCircle2, Circle, FileText, ListChecks, Lock, Save, X } from 'lucide-react'
import { useT } from '../lib/i18n.js'

// Handlungen im Milestone-Modal — abhakbar (CoS alles, Owner nur eigene; sonst lesend).
// Abhaken schreibt via POST /api/task/status (atomar, serverseitiges Owner-Scoping);
// der Roll-up VERDIENT den Fortschritt, HMR lädt neu, Modal öffnet sich wieder.
export function TaskSection({ m, role, me }) {
  const { t: tx } = useT()
  const ts = tasksFor(m.id)
  const [busy, setBusy] = useState(null)
  const [artefaktFuer, setArtefaktFuer] = useState(null)   // Task-ID, für die die Artefakt-Zeile offen ist
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
  // Artefakt-Pflicht Stufe 2 (04.08.): Abhaken öffnet zuerst die Artefakt-Zeile;
  // Wiederöffnen läuft weiterhin direkt durch (kein Nachweis nötig).
  const klick = (t) => {
    if (busy || !mayToggle(t)) return
    if (t.status === 'erledigt') toggle(t)
    else setArtefaktFuer(t.id)
  }
  const toggle = async (t, artefakt) => {
    if (busy || !mayToggle(t)) return
    setBusy(t.id)
    // Modal-Wiederöffnung VOR dem Write vormerken — der HMR-Reload nach dem
    // Datei-Write kann schneller sein als die Fetch-Antwort.
    sessionStorage.setItem('rubicon_selms', m.id)
    try {
      const r = await fetch('/api/task/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, me, id: t.id, status: t.status === 'erledigt' ? 'offen' : 'erledigt',
          ...(artefakt ? { artefakt } : {}) }),
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
            <div key={t.id}>
            <div className="px-3 py-2 flex items-start gap-2.5 text-[12px]">
              <button onClick={() => klick(t)} disabled={!can || !!busy}
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
                    : <span>{tx('ms.faelligLuecke')}</span>}
                  {t.erledigt_am && <span style={{ color: T.green }}>erledigt {fmtDate(t.erledigt_am)}{t.erledigt_von ? ` · ${t.erledigt_von}` : ''}</span>}
                  {t.artefakt && <span title={t.artefakt} style={{ color: T.brass }}>📎 Artefakt</span>}
                </div>
              </div>
            </div>
            {artefaktFuer === t.id && (
              <ArtefaktZeile busy={busy}
                onOk={(v) => { setArtefaktFuer(null); toggle(t, v) }}
                onSkip={() => { setArtefaktFuer(null); toggle(t) }}
                onCancel={() => setArtefaktFuer(null)} />
            )}
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
export function ZerlegungKI({ m, role }) {
  const { t: tx } = useT()
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
              <input type="checkbox" checked={d.use} onChange={e2 => upd(i, { use: e2.target.checked })} aria-label={tx('ms.vorschlagUebernehmen')} />
              <input value={d.text} onChange={e2 => upd(i, { text: e2.target.value })} className="flex-1 min-w-[260px] rounded border px-2 py-1" style={inp} />
              <input value={d.owner || ''} onChange={e2 => upd(i, { owner: e2.target.value })} placeholder={tx('ms.owner')} className="w-36 rounded border px-2 py-1" style={inp} />
              <input type="date" value={d.due || ''} onChange={e2 => upd(i, { due: e2.target.value })} className="rounded border px-2 py-1" style={{ ...inp, fontFamily: T.mono }} title={tx('ms.vorschlagPruefen')} />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1.5">
            <button onClick={take} disabled={busy || !drafts.some(d => d.use)} className="px-3 py-1.5 rounded font-semibold text-[11.5px]"
              style={{ background: T.brass, color: '#0b1220', opacity: busy ? .5 : 1 }}>
              {busy ? 'übernimmt…' : `Übernehmen (${drafts.filter(d => d.use).length})`}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: activate ? T.brass : T.inkDim }}
              title={tx('ms.progressSource')}>
              <input type="checkbox" checked={activate} onChange={e2 => setActivate(e2.target.checked)} /> Roll-up aktivieren («treibend»)
            </label>
            <button onClick={() => { setDrafts(null); setErr(null) }} className="px-2.5 py-1 rounded border text-[11px]" style={{ borderColor: T.line, color: T.inkDim }}>{tx('ms.verwerfen')}</button>
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
export function WhatIf({ m, role, me }) {
  const { t: tx } = useT()
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
        <b className="text-[11px] tracking-wide" style={{ color: T.brass, fontFamily: T.mono }}>{tx('ms.fortschrittMelden')}</b>
        <select value={kind} onChange={e => { setKind(e.target.value); setVal(e.target.value === 'progress' ? (typeof m.progress === 'number' ? m.progress : 50) : (m.reported_slip_days || 7)) }}
          className="rounded border px-2 py-1 text-[11px]" style={inp}>
          <option value="progress" style={{ color: '#111' }}>{tx('ms.fortschrittProzent')}</option>
          <option value="blocker" style={{ color: '#111' }}>{tx('ms.blocker')}</option>
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
        <span style={{ color: T.inkDim }}>{tx('ms.ampel')}</span> <Pill st={stNow} /> <span style={{ color: T.inkDim }}>→</span> <Pill st={stAfter} />
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
export function BriefingModal({ m, role, me, onClose, onNav }) {
  const { t: tx } = useT()
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
              <button onClick={() => onNav(-1)} aria-label={tx('ms.vorheriger')} title={tx('ms.vorherigerTitle')}
                className="px-2 py-1 rounded border text-[13px]" style={{ borderColor: T.line, color: T.inkDim }}>‹</button>
              <button onClick={() => onNav(1)} aria-label={tx('ms.naechster')} title={tx('ms.naechsterTitle')}
                className="px-2 py-1 rounded border text-[13px]" style={{ borderColor: T.line, color: T.inkDim }}>›</button>
            </span>
          )}
          <a href={pdfUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap"
            style={{ borderColor: T.brass, color: T.brass }}>
            <FileText size={13} /> PDF öffnen
          </a>
          <button onClick={onClose} aria-label={tx('ms.schliessen')}
            className="p-1.5 rounded border" style={{ borderColor: T.line, color: T.inkDim }}>
            <X size={15} />
          </button>
        </div>
        {/* Meta */}
        <div className="px-5 pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11.5px] rounded p-3"
            style={{ background: T.panelSoft }}>
            <div><span style={{ color: T.inkFaint }}>{tx('ms.owner')}</span><br /><b style={{ fontFamily: T.mono }}>{m.owner || 'zu klären'}</b></div>
            <div><span style={{ color: T.inkFaint }}>{tx('ms.faelligBis')}</span><br /><b style={{ fontFamily: T.mono }}>{fmtDate(m.due)}{m.date_assumed ? ' *' : ''}</b></div>
            <div><span style={{ color: T.inkFaint }}>{tx('ms.start')}</span><br /><b style={{ fontFamily: T.mono }}>{m.start ? fmtDate(m.start) : '—'}</b></div>
            <div><span style={{ color: T.inkFaint }}>{tx('ms.abhaengigVon')}</span><br /><b style={{ fontFamily: T.mono }}>{(m.depends_on || []).join(', ') || '—'}</b></div>
          </div>
          {b.beteiligte && <div className="text-[11.5px] mt-2" style={{ color: T.inkDim }}><b style={{ color: T.brass }}>{tx('ms.beteiligte')}</b> {b.beteiligte}</div>}
          {b.ziel_klartext && (
            <div className="mt-3 rounded p-3 text-[12px]" style={{ background: T.panelSoft, borderLeft: `2.5px solid ${T.brass}`, color: T.ink }}>
              <b style={{ color: T.brass }}>{tx('ms.zielKlartext')}</b> {b.ziel_klartext}
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
          {b.kontext && <Sect title={tx('ms.kontext')}>{b.kontext}</Sect>}
          {(b.leistung || []).length > 0 && <Sect title={tx('ms.deliverables')}>
            <ul className="list-disc pl-4">{b.leistung.map((x, i) => <li key={i}>{x}</li>)}</ul></Sect>}
          {(b.vorgehen || []).length > 0 && <Sect title={tx('ms.vorgehen')}>
            <ol className="list-decimal pl-4">{b.vorgehen.map((x, i) => <li key={i}>{x}</li>)}</ol></Sect>}
          {(b.erfolgsmessung || m.kpi) && <Sect title={tx('ms.kpi')}>{b.erfolgsmessung || m.kpi}</Sect>}
          {(b.risiken || []).length > 0 && <Sect title={tx('ms.risiken')}>
            <ul className="list-disc pl-4">{b.risiken.map((x, i) => <li key={i}>{x}</li>)}</ul></Sect>}
          {b.grounding && <Sect title={tx('ms.datengrundlage')}><span style={{ color: T.inkDim }}>{b.grounding}</span></Sect>}
          {/* Eingebettetes Briefing-PDF: klickbare Seiten-1-Vorschau (PNG lädt überall
              zuverlässig; Klick öffnet die vollständige PDF). */}
          <div className="mt-4 rounded border overflow-hidden" style={{ borderColor: T.line }}>
            <div className="px-3 py-1.5 text-[10px] flex items-center justify-between"
              style={{ background: T.panelSoft, color: T.inkDim, fontFamily: T.mono }}>
              <span className="flex items-center gap-1.5"><FileText size={11} /> Briefing-PDF — {m.id}.pdf (automatisch generiert, aktueller Stand)</span>
              <span className="flex items-center gap-2">
                <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: T.brass }}>{tx('ms.vollstaendig')}</a>
                {BRIEFINGS_DOCS[m.id]?.server_doc_url && (
                  <a href={BRIEFINGS_DOCS[m.id].server_doc_url} target="_blank" rel="noopener noreferrer" style={{ color: T.blue }}>{tx('ms.doc')}</a>
                )}
              </span>
            </div>
            <a href={pdfUrl} target="_blank" rel="noreferrer" title={tx('ms.pdfOeffnen')}
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
