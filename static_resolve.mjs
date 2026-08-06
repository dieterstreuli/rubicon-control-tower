import fs from 'node:fs'
import path from 'node:path'

// Sicherer Join innerhalb base; blockiert Path-Traversal. null bei Ausbruch.
function safeJoin(base, urlPath) {
  const clean = decodeURIComponent(String(urlPath)).replace(/^\/+/, '')
  const full = path.resolve(base, clean)
  const root = path.resolve(base)
  return (full === root || full.startsWith(root + path.sep)) ? full : null
}

// static-Request aufloesen: DOCS-Volume zuerst, dann PUBLIC-Baseline.
// Gibt existierenden Dateipfad zurueck oder null.
export function resolveStaticPath(urlPath, docsDir, pubDir) {
  for (const base of [docsDir, pubDir]) {
    if (!base) continue
    const p = safeJoin(base, urlPath)
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}
