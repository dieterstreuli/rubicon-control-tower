// status.js — deterministische Statuslogik (reine Funktionen, keine Heuristik).
// Steuerungsdatum NOW kommt ausschliesslich aus meta.today (projekt.yaml).
//
// Reihenfolge (fix): done → delayed → atRisk → unknown → onTrack
// RUBICON-Erweiterung: Meilensteine mit nachlauf=true (gesetzlich gebundene
// Q2/27-Effekte) verschieben NIE das Kern-Projektende (baseline_end).

const DAY = 86400000

export function parseDate(s) {
  if (!s || typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isNaN(d.getTime()) ? null : d
}

export function daysBetween(a, b) {
  // ganze Tage b - a (UTC, deterministisch); null-hart (Audit #2)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / DAY)
}

export function statusOf(m, now) {
  const due = parseDate(m.due)
  const prog = m.progress
  const hasProg = typeof prog === 'number' && !Number.isNaN(prog)
  const reported = typeof m.reported_slip_days === 'number' ? m.reported_slip_days : 0

  // done nur bei echtem Abschluss OHNE gemeldeten Verzug (Audit #5); überfällig-und-fertig
  // bleibt bewusst 'done' — ein gemeldeter reported_slip_days>0 hält den MS dagegen sichtbar.
  if (hasProg && prog >= 100 && reported <= 0) return 'done'
  if ((due && now && daysBetween(due, now) > 0) || reported > 0) return 'delayed'
  // fehlendes Steuerungsdatum (now) → Datenlücke statt Crash (Audit #2)
  if (!hasProg || !due || !now) return 'unknown'
  // Vor dem GEPLANTEN Start ist fehlender Fortschritt kein Risikosignal (13.07.):
  // das Arbeitsfenster hat noch nicht begonnen → planmässig, nicht gefährdet.
  const start = parseDate(m.start)
  if (start && daysBetween(now, start) > 0) return 'onTrack'
  const rest = daysBetween(now, due) // Tage bis fällig
  if ((rest <= 21 && prog < 50) || (rest <= 45 && prog < 15)) return 'atRisk'
  return 'onTrack'
}

export function slipDays(m, now) {
  const due = parseDate(m.due)
  const overdue = due && now ? Math.max(0, daysBetween(due, now)) : 0
  const st = statusOf(m, now)
  if (st === 'done') return 0
  const reported = typeof m.reported_slip_days === 'number' ? m.reported_slip_days : 0
  return Math.max(overdue, reported)
}

export function allMilestones(data) {
  return (data.workstreams || []).flatMap(ws =>
    (ws.milestones || []).map(m => ({ ...m, _ws: ws.code, _wsName: ws.name }))
  )
}

// Projiziertes Kern-Projektende:
//   baseline_end + max(slipDays über alle KRITISCHEN, VERZÖGERTEN Meilensteine
//   der Kernumsetzung — nachlauf=true zählt nicht gegen das Kernende).
export function projectedEnd(data) {
  const now = parseDate(data.meta?.today)
  const base = parseDate(data.meta?.baseline_end)
  if (!base) return { base: null, projected: null, slip: 0, drivers: [] }
  const critDelayed = allMilestones(data).filter(m =>
    m.critical && !m.nachlauf && statusOf(m, now) === 'delayed')
  const slips = critDelayed.map(m => ({ id: m.id, name: m.name, slip: slipDays(m, now) }))
  const maxSlip = slips.reduce((a, s) => Math.max(a, s.slip), 0)
  const projected = new Date(base.getTime() + maxSlip * DAY)
  return { base, projected, slip: maxSlip, drivers: slips.filter(s => s.slip === maxSlip && maxSlip > 0) }
}

export function counts(data) {
  const now = parseDate(data.meta?.today)
  const ms = allMilestones(data)
  const c = { done: 0, onTrack: 0, atRisk: 0, delayed: 0, unknown: 0, total: ms.length }
  for (const m of ms) c[statusOf(m, now)]++
  return c
}

// Gesamtstatus: Verzug auf kritischem Pfad → delayed; sonst schlechtester Status.
export function overallStatus(data) {
  const now = parseDate(data.meta?.today)
  const ms = allMilestones(data)
  if (ms.some(m => m.critical && !m.nachlauf && statusOf(m, now) === 'delayed')) return 'delayed'
  const order = ['delayed', 'atRisk', 'unknown', 'onTrack', 'done']
  for (const st of order) if (ms.some(m => statusOf(m, now) === st)) return st
  return 'unknown'
}

// HARD EDGE (DRS 07.07.2026): bis meta.hard_edge (30.06.2027) ist ALLES komplett
// abgeschlossen. Ein MS verletzt die Kante, wenn due + slip über die Kante rutscht.
export function hardEdgeBreaches(data) {
  const now = parseDate(data.meta?.today)
  const edge = parseDate(data.meta?.hard_edge)
  if (!edge) return []
  return allMilestones(data)
    .filter(m => statusOf(m, now) !== 'done')
    .map(m => {
      const due = parseDate(m.due)
      if (!due) return null
      const eff = new Date(due.getTime() + slipDays(m, now) * 86400000)
      return eff > edge ? { id: m.id, name: m.name, owner: m.owner, days: daysBetween(edge, eff) } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.days - a.days)
}

export function fmtDate(d) {
  if (!d) return '—'
  const dt = typeof d === 'string' ? parseDate(d) : d
  if (!dt) return '—'
  return String(dt.getUTCDate()).padStart(2, '0') + '.' +
         String(dt.getUTCMonth() + 1).padStart(2, '0') + '.' + dt.getUTCFullYear()
}
