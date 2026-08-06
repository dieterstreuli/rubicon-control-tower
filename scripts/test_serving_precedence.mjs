import { resolveStaticPath } from '../static_resolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const check = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name) } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rub-'))
const docs = path.join(tmp, 'docs'), pub = path.join(tmp, 'pub')
fs.mkdirSync(path.join(docs, 'reports'), { recursive: true })
fs.mkdirSync(path.join(pub, 'reports'), { recursive: true })
fs.writeFileSync(path.join(docs, 'reports', 'a.pdf'), 'DOCS')
fs.writeFileSync(path.join(pub, 'reports', 'b.pdf'), 'PUB')

check('docs-first', resolveStaticPath('reports/a.pdf', docs, pub) === path.join(docs, 'reports', 'a.pdf'))
check('fallback-pub', resolveStaticPath('reports/b.pdf', docs, pub) === path.join(pub, 'reports', 'b.pdf'))
check('missing-null', resolveStaticPath('reports/none.pdf', docs, pub) === null)
check('no-docs-configured', resolveStaticPath('reports/b.pdf', null, pub) === path.join(pub, 'reports', 'b.pdf'))
check('traversal-blocked', resolveStaticPath('../../etc/passwd', docs, pub) === null)

fs.rmSync(tmp, { recursive: true, force: true })
if (fail) { console.error(`serving: ${pass} gruen, ${fail} rot`); process.exit(1) }
console.log(`serving: ${pass}/5 gruen`)
