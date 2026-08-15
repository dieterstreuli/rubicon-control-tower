import React from 'react'
import { STATUS_META, T } from '../lib/theme.js'
import { fmtDate, parseDate, statusOf } from '../lib/status.js'
import { FR_COL, Pill } from '../components/ui.jsx'
import { FileText } from 'lucide-react'
import { FR, FR_DOC, traktDocUrl } from '../lib/data.js'
import { useT } from '../lib/i18n.js'

// ── INTRO-PAGE: Sinn & Zweck · WS-Übersicht (grafisch, Live-Ampeln) · Zeitachse ──
// Inhalte aus RUBICON-Doc v2 (Sektionen 1–3, 7); Ströme/Status live aus projekt.yaml.
export function IntroView({ data, goStreams }) {
  const { t: tx } = useT()
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
          vom Finanzierungsprozess (Projekt #98 = Parallel-Achse). Es konsolidiert <b>{tx('intro.alle')}</b> bisherigen Pläne
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
          <b style={{ color: T.brass }}>{tx('intro.drsEigentuemer')}</b> steuert + kontrolliert (Cockpit + VR) — über dem Maschinenraum
        </div>
        <div className="text-center text-[10px]" style={{ color: T.inkFaint }}>▼</div>
        <div className="rounded-lg px-4 py-2 text-center text-[12px] mb-2" style={{ background: T.brass, color: '#0b1220' }}>
          <b>{tx('intro.afrCgo')}</b> · CGO = Ops-Energie + öffentliches Gesicht · AFR = Struktur / Disziplin / Finanz / Verhandlung
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
          Führungslogik quer über alle Phasen: <b style={{ color: T.brass }}>{tx('intro.drsSteuert')}</b> · AFR + CGO treiben · GL-6 liefert.
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
export function FuehrungsrhythmusCard() {
  const { t: tx } = useT()
  return (
    <div className="rounded-xl border p-5" style={{ background: T.panel, borderColor: T.brass + '55' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest" style={{ color: T.inkFaint, fontFamily: T.mono }}>
            Führungsrhythmus (MOS) — welche Meetings · mit wem · wann · welcher Output
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: T.inkDim }}>{FR.untertitel}</div>
        </div>
        <span className="flex items-center gap-2">
          <a href="/fuehrungsrhythmus.pdf" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap"
            style={{ borderColor: T.brass, color: T.brass }}>
            <FileText size={13} /> One-Pager als PDF
          </a>
          {FR_DOC?.server_doc_url && (
            <a href={FR_DOC.server_doc_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap"
              style={{ borderColor: T.blue, color: T.blue }}>
              <FileText size={13} /> Doc ↗
            </a>
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ minWidth: 820 }}>
          <thead>
            <tr className="text-left" style={{ color: T.inkFaint, fontFamily: T.mono }}>
              <th className="px-2 py-1.5">{tx('intro.meeting')}</th><th className="px-2 py-1.5">{tx('intro.wann')}</th>
              <th className="px-2 py-1.5">{tx('intro.mitWem')}</th><th className="px-2 py-1.5">{tx('intro.zweck')}</th>
              <th className="px-2 py-1.5">{tx('intro.output')}</th>
              <th className="px-2 py-1.5">{tx('intro.traktandenliste')}</th>
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
                          {traktDocUrl(m.id) && (
                            <a href={traktDocUrl(m.id)} target="_blank" rel="noreferrer"
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
        <b style={{ color: T.brass }}>{tx('intro.grundsaetze')}</b>
        <ul className="mt-1 space-y-0.5" style={{ color: T.inkDim }}>
          {FR.grundsaetze.map((p, i) => <li key={i}>· {p}</li>)}
        </ul>
      </div>
    </div>
  )
}

