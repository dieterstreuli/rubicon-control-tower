import './index.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { initData } from './lib/data.js'

// Block A (05.08.2026): Die Datenschicht kommt zur LAUFZEIT via GET /api/state —
// nicht mehr als Build-Import. Die Reihenfolge ist TRAGEND: erst fetchen, dann
// initData(state), dann App DYNAMISCH importieren — so läuft sämtlicher
// Modul-Top-Level-Code der App (AGENDA_BY_ID, STATUS_META, domain.js-Konstanten …)
// erst NACH der Injektion. Deshalb hier KEINE statischen Importe von App/theme/domain.
// Lade-/Fehler-Screen bewusst ohne theme.js (das erst nach initData lesbar ist) —
// Farben sind die DARK-Basistöne aus theme.js, hart kodiert.

const root = createRoot(document.getElementById('root'))

const screen = (inner) => root.render(
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0b1220', color: '#9aa5bc', fontFamily: "-apple-system,'Segoe UI',system-ui,sans-serif" }}>
    {inner}
  </div>
)

async function bootstrap() {
  screen(<div>RUBICON — Daten werden geladen…</div>)
  try {
    const res = await fetch('/api/state')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const state = await res.json()
    if (!state.ok) throw new Error(state.error || 'unbekannter Fehler')
    initData(state)
    const { default: App } = await import('./App.jsx')
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  } catch (e) {
    // Kein leerer/halb-gerenderter Zustand, kein Auto-Endlos-Retry (Spec §5) —
    // klare Meldung + manueller Retry.
    screen(
      <div style={{ textAlign: 'center', maxWidth: 480, padding: 16 }}>
        <div style={{ color: '#f43f5e', marginBottom: 12 }}>
          Daten konnten nicht geladen werden: {String((e && e.message) || e)}
        </div>
        <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: 8,
          border: '1px solid #24304a', background: '#16213a', color: '#f3efe6', cursor: 'pointer' }}>
          Erneut versuchen
        </button>
      </div>
    )
  }
}

bootstrap()
