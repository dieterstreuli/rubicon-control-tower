// _parity_node.mjs — Hilfsskript für den Paritätstest: läuft die Fixtures durch die
// KANONISCHE JS-Statuslogik (src/lib/status.js) und gibt die Ergebnisse als JSON aus.
// Aufruf: node scripts/_parity_node.mjs <fixtures.json> <nowISO>
import fs from 'node:fs'
import { statusOf, parseDate } from '../src/lib/status.js'

const [fixPath, nowStr] = process.argv.slice(2)
const fixtures = JSON.parse(fs.readFileSync(fixPath, 'utf8'))
const now = parseDate(nowStr)
process.stdout.write(JSON.stringify(fixtures.map(m => statusOf(m, now))))
