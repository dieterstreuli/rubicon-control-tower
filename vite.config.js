import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rubiconApi } from './plugins/rubicon-api.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), rubiconApi()],
  server: {
    host: '127.0.0.1',            // explizit IPv4-Loopback (nicht LAN); Tailscale-Serve proxyt hierauf
    port: 8621,
    allowedHosts: ['.tail018620.ts.net'],  // Tailnet-Host für Serve-Zugriff (Andreas etc.) erlauben
  },
})
