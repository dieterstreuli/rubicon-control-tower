// rubicon-api.js — Vite-Plugin-Hülle um den API-Kern (R3, 01.08.2026).
//
// Die Endpoint-Logik liegt seit R3 in plugins/api-core.js und wird von ZWEI
// Betriebsarten genutzt:
//   · Entwicklung:  dieses Vite-Plugin (HMR, `npm run dev`)
//   · Betrieb:      server.mjs — eigenständiger Node-Server, liefert dist/
//                   statisch aus und mountet denselben Kern (`npm start`)
//
// Damit hängt die API nicht mehr am Vite-DEV-Server: ein Build-Deployment
// (Cloud Run / Gateway) verliert die 15 Endpoints nicht mehr still.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from './api-core.js'

export function rubiconApi() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const handle = createApi(root)
  return {
    name: 'rubicon-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (await handle(req, res)) return
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
        }
        next()
      })
    },
  }
}
