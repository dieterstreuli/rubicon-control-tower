#!/usr/bin/env node
/**
 * server.mjs — eigenständiger App-Server für den RUBICON Control Tower (R3, 01.08.2026).
 *
 * WARUM: Bis heute war der Vite-DEV-Server der Produktionsserver — inklusive HMR
 * als Update-Mechanik. Ein Build-Deployment (Cloud Run hinter dem Gateway) hätte
 * die 15 API-Endpoints still verloren, weil sie nur als Dev-Middleware existierten.
 *
 * Dieser Server nutzt EXAKT denselben API-Kern (plugins/api-core.js) und liefert
 * zusätzlich den gebauten Client (dist/) sowie die generierten Artefakte (public/:
 * Briefings, Reports, Protokolle, Traktanden) statisch aus.
 *
 * Betrieb:   npm run build && npm start        (Port via PORT, Default 8621)
 * Entwicklung bleibt unverändert: npm run dev  (Vite + dasselbe api-core)
 *
 * Bewusst ohne Framework-Abhängigkeit (node:http) — nichts Neues im Dependency-Baum.
 * Auth bleibt vorgelagert (Google IAP / Gateway #99); der Server vertraut wie bisher
 * dem lokalen bzw. gateway-geschützten Zugang.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from './plugins/api-core.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const PUBLIC = path.join(ROOT, 'public')
const PORT = Number(process.env.PORT || 8621)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const handleApi = createApi(ROOT)

/** Pfad sicher auflösen — verhindert Ausbruch aus dem Wurzelverzeichnis (..%2f etc.). */
function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)))
  return p.startsWith(base) ? p : null
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  // Generierte Artefakte dürfen nicht hart gecacht werden (PDFs werden neu erzeugt)
  res.setHeader('Cache-Control', ext === '.pdf' || ext === '.png' ? 'no-cache' : 'public, max-age=300')
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    // 1) API (identischer Kern wie im Dev-Server, inkl. Sensitiv-Sperre)
    if (await handleApi(req, res)) return

    const urlPath = (req.url || '/').split('?')[0]

    // 2) statische Artefakte aus public/ (Briefings, Reports, Protokolle, Traktanden)
    const pub = safeJoin(PUBLIC, urlPath)
    if (pub && fs.existsSync(pub) && fs.statSync(pub).isFile()) return sendFile(res, pub)

    // 3) gebauter Client aus dist/
    const dist = safeJoin(DIST, urlPath)
    if (dist && fs.existsSync(dist) && fs.statSync(dist).isFile()) return sendFile(res, dist)

    // 4) SPA-Fallback
    const index = path.join(DIST, 'index.html')
    if (fs.existsSync(index)) return sendFile(res, index)

    res.statusCode = 404
    res.end('dist/ fehlt — zuerst «npm run build» ausführen.')
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
  }
})

server.listen(PORT, HOST, () => {
  const gebaut = fs.existsSync(path.join(DIST, 'index.html'))
  console.log(`RUBICON Control Tower — App-Server auf http://${HOST}:${PORT}`)
  console.log(`  API: plugins/api-core.js (identisch zum Dev-Server)`)
  console.log(`  Client: ${gebaut ? 'dist/ (gebaut)' : '⚠ dist/ fehlt — npm run build'}`)
})
