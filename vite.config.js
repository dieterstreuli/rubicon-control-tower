import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rubiconApi } from './plugins/rubicon-api.js'

// Build-Stamp: CI (GitHub Action) setzt RUBICON_BUILD_SHA + RUBICON_BUILD_ISO;
// lokal Fallback = aktuelle Zeit. Anzeige "TT.MM.JJJJ HH:MM" in Europe/Zurich.
const buildDate = process.env.RUBICON_BUILD_ISO ? new Date(process.env.RUBICON_BUILD_ISO) : new Date()
const _p = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(buildDate)
const _g = (t) => (_p.find((x) => x.type === t) || {}).value
const BUILD_TIME = `${_g('day')}.${_g('month')}.${_g('year')} ${_g('hour')}:${_g('minute')}`
const BUILD_SHA = process.env.RUBICON_BUILD_SHA || 'dev'

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [react(), tailwindcss(), rubiconApi()],
  server: {
    host: '127.0.0.1',            // explizit IPv4-Loopback (nicht LAN); Tailscale-Serve proxyt hierauf
    port: 8621,
    allowedHosts: ['.tail018620.ts.net'],  // Tailnet-Host für Serve-Zugriff (Andreas etc.) erlauben
  },
})
