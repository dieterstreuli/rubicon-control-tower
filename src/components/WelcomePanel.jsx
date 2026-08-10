import React, { useState } from 'react'
import { T } from '../lib/theme.js'
import { IDENTITY } from '../lib/data.js'
import { X } from 'lucide-react'

// Stufe 1: einmalige Begrüßung pro Session. Die Funktionsliste ist datengetrieben —
// spätere Stufen (Drive/Gmail/Kalender in Dieters Konto) flippen ⏳ → ✓.
const FUNKTIONEN = [
  { ok: true, t: 'Erkennung & rollenrichtige Ansicht — jetzt aktiv' },
  { ok: true, t: 'Sitzung erfassen → Tower · Reports · KI-Narrativ — serverseitig' },
  { ok: false, t: 'Notiz-Suche & Dokumente in deinem Konto — folgt' },
  { ok: false, t: 'Gmail-Reminder & Kalender in deinem Konto — folgt' },
]

// Ohne IDENTITY (alter /api/state-Payload, kein IAP-Feld) ODER ohne echten IAP-Login
// (Dieters lokaler Betrieb, via Tailnet geteilt) rendert die Komponente null — sonst würde
// z.B. Andreas im Tailnet-Zugang fälschlich als «Dieter Streuli» begrüßt (Härtung 10.08.2026).
export function WelcomePanel() {
  const [seen, setSeen] = useState(() => sessionStorage.getItem('rubicon_welcome_seen') === '1')
  if (seen || !IDENTITY || !IDENTITY.viaIap) return null
  const dismiss = () => { sessionStorage.setItem('rubicon_welcome_seen', '1'); setSeen(true) }
  const rollen = (IDENTITY.rollen || []).join(' / ')
  return (
    <div className="mx-4 md:mx-6 mt-3 rounded-lg border p-3.5 relative"
      style={{ background: T.panelSoft, borderColor: T.brass + '55', borderLeft: `3px solid ${T.brass}` }}>
      <button onClick={dismiss} title="Ausblenden"
        className="absolute top-2 right-2 p-1 rounded" style={{ color: T.inkFaint }}>
        <X size={15} />
      </button>
      <div className="text-[13px] font-bold" style={{ color: T.ink }}>
        Willkommen, {IDENTITY.person}.
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: T.inkDim, fontFamily: T.mono }}>
        Angemeldet als {IDENTITY.email} · Rolle {rollen}{!IDENTITY.isKnown && ' — unbekannt (nur lesend)'}
      </div>
      <div className="text-[11px] mt-2 mb-1" style={{ color: T.inkFaint }}>In deinem Web-Kontext:</div>
      <ul className="space-y-0.5">
        {FUNKTIONEN.map((f, i) => (
          <li key={i} className="text-[11.5px]" style={{ color: f.ok ? T.ink : T.inkFaint }}>
            <span style={{ color: f.ok ? T.green : T.brass, fontFamily: T.mono }}>{f.ok ? '✓' : '⏳'}</span> {f.t}
          </li>
        ))}
      </ul>
    </div>
  )
}
