#!/usr/bin/env node
/**
 * test_identity.mjs — Node-Tests der IAP-Identitäts-Erkennung (Stufe 1, 10.08.2026).
 *
 * Prüft plugins/identity.js (rein, kein I/O) gegen die echte src/data/identity_map.json —
 * damit ist dieser Test zugleich ein Schema-Wächter der Map.
 *
 * Aufruf: node scripts/test_identity.mjs   ·   Exit 0 = alle grün
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = (f) => pathToFileURL(path.join(ROOT, 'plugins', f)).href

let pass = 0
const fails = []
const check = (name, ok) => { if (ok) pass++; else fails.push(name) }
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const { iapEmail, resolveIdentity, identityRoleDenied } = await import(lib('identity.js'))

// Map wird aus der echten Datei geladen (JSON.parse) — Schema-Wächter der Map.
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'identity_map.json'), 'utf8'))

// ── 1 · bekannter IAP-Header + aktives Flag (RUBICON_IAP_ACTIVE) → Dieter Streuli ──
{
  const headers = { 'x-goog-authenticated-user-email': 'accounts.google.com:d.streuli@axs.aero' }
  const id = resolveIdentity(headers, MAP, undefined, true)
  check('bekannter Header: email = d.streuli@axs.aero', id.email === 'd.streuli@axs.aero')
  check('bekannter Header: isKnown === true', id.isKnown === true)
  check('bekannter Header: person = Dieter Streuli', id.person === 'Dieter Streuli')
  check('bekannter Header: rollen enthält CoS', Array.isArray(id.rollen) && id.rollen.includes('CoS'))
  check('bekannter Header: viaIap === true', id.viaIap === true)
}

// ── 2 · Grossschreibung im Header wird auf lowercase normalisiert ──
{
  const headers = { 'x-goog-authenticated-user-email': 'accounts.google.com:D.Streuli@AXS.aero' }
  check('Grossschreibung: iapEmail normalisiert auf lowercase', iapEmail(headers) === 'd.streuli@axs.aero')
}

// ── 3 · kein Header + kein Env → Dev-Fallback ──
{
  const id = resolveIdentity({}, MAP)
  check('kein Header/Env: Fallback d.streuli@axs.aero', id.email === 'd.streuli@axs.aero')
  check('kein Header/Env: isKnown === true', id.isKnown === true)
  // Härtung 10.08.2026 (Tailnet-Privilege-Escalation): kein Header ⇒ viaIap MUSS false sein,
  // AUCH WENN isKnown für den Dev-Fallback true ist — sonst würde jeder Tailnet-Nutzer ohne
  // echten IAP-Login als Dieter Streuli [CoS,Owner] durchgesetzt.
  check('kein Header/Env: viaIap === false (trotz isKnown === true)', id.viaIap === false)
}

// ── 4 · expliziter devFallback (kein Header) ──
{
  const id = resolveIdentity({}, MAP, 'g.suchomski@did-it.ch')
  check('devFallback: isKnown === true', id.isKnown === true)
  check('devFallback: rollen enthält CoS', Array.isArray(id.rollen) && id.rollen.includes('CoS'))
  check('devFallback: person enthält "Test"', typeof id.person === 'string' && id.person.includes('Test'))
  // devFallback ersetzt nur die E-Mail des Fallbacks — bleibt ohne echten IAP-Header ein
  // Fallback, kein IAP-Login.
  check('devFallback: viaIap === false', id.viaIap === false)
}

// ── 5 · unbekannte E-Mail + aktives Flag → nur lesend (Teilnehmer) ──
{
  const headers = { 'x-goog-authenticated-user-email': 'accounts.google.com:fremd@axs.aero' }
  const id = resolveIdentity(headers, MAP, undefined, true)
  check('unbekannt: isKnown === false', id.isKnown === false)
  check('unbekannt: rollen deep-equals [Teilnehmer]', deepEq(id.rollen, ['Teilnehmer']))
  check('unbekannt: person = email selbst', id.person === 'fremd@axs.aero')
}

// ── 6 · Write-Gate-Voraussetzung (10.08.2026): der Dev-Fallback (d.streuli, lokaler Betrieb
// ohne IAP-Header) trägt genau CoS+Owner — NICHT Chairman/Teilnehmer. plugins/api-core.js
// requireIdentityRole() prüft exakt gegen diese Menge; ändert sich die Map, muss dieser Test
// mitreissen (Schema-Wächter für den Write-Gate-Bypass).
{
  const id = resolveIdentity({}, MAP)
  check('Dev-Fallback: rollen enthält CoS', id.rollen.includes('CoS'))
  check('Dev-Fallback: rollen enthält Owner', id.rollen.includes('Owner'))
  check('Dev-Fallback: rollen enthält NICHT Chairman', !id.rollen.includes('Chairman'))
  check('Dev-Fallback: rollen enthält NICHT Teilnehmer', !id.rollen.includes('Teilnehmer'))
}

// ── 7 · iapActive-Flag (I1, 10.08.2026): viaIap verlangt Flag UND Header ──
{
  const headers = { 'x-goog-authenticated-user-email': 'accounts.google.com:d.streuli@axs.aero' }
  // (a) iapActive=true + gültiger Header → viaIap true
  const a = resolveIdentity(headers, MAP, undefined, true)
  check('iapActive=true + Header: viaIap === true', a.viaIap === true)

  // (b) iapActive=false + gültiger (gespoofter) Header → wirkungslos: viaIap false, email
  // bleibt der Dev-Fallback, NICHT die im Header behauptete Identität (lokal/Tailnet-Spoof).
  const spoofed = { 'x-goog-authenticated-user-email': 'accounts.google.com:angreifer@axs.aero' }
  const b = resolveIdentity(spoofed, MAP, undefined, false)
  check('iapActive=false + Header: viaIap === false (Spoof wirkungslos)', b.viaIap === false)
  check('iapActive=false + Header: email = Dev-Fallback statt Spoof', b.email === 'd.streuli@axs.aero')

  // (c) iapActive=true ohne Header → viaIap false
  const c = resolveIdentity({}, MAP, undefined, true)
  check('iapActive=true ohne Header: viaIap === false', c.viaIap === false)
}

// ── 8 · identityRoleDenied (I3, 10.08.2026): reines Write-Gate-Prädikat ──
{
  check('viaIap + Rolle nicht erlaubt → denied',
    identityRoleDenied({ viaIap: true, rollen: ['CoS'] }, 'Chairman') === true)
  check('viaIap + Rolle erlaubt → nicht denied',
    identityRoleDenied({ viaIap: true, rollen: ['CoS'] }, 'CoS') === false)
  check('nicht viaIap → nie denied (altes freies Verhalten)',
    identityRoleDenied({ viaIap: false, rollen: ['CoS'] }, 'Chairman') === false)
}

// ── Ergebnis ──
const total = pass + fails.length
console.log(`identity: ${pass}/${total} gruen`)
if (fails.length) { console.log('FEHLSCHLÄGE:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
