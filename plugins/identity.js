// identity.js — Stufe 1 (Identitäts-Fundament, 10.08.2026): IAP-Identität → Person/Rollen.
// Rein (keine I/O), damit unit-testbar. Der Server reicht req.headers + die geladene Map herein.

/** Interner Helfer (M3, 10.08.2026): liest die IAP-E-Mail aus den Request-Headern.
 *  IAP-Format: 'x-goog-authenticated-user-email: accounts.google.com:<email>'.
 *  Von iapEmail() UND resolveIdentity() genutzt, statt die Parse-Logik zu duplizieren. */
const parseHeaderEmail = (headers) =>
  String((headers && headers['x-goog-authenticated-user-email']) || '').split(':').pop().trim().toLowerCase()

/** E-Mail des per IAP verifizierten Nutzers aus den Request-Headern lesen. */
export function iapEmail(headers, devFallback) {
  const email = parseHeaderEmail(headers)
  if (email.includes('@')) return email
  // RUBICON-CUTOVER: Dev-Fallback ohne IAP (Dieters lokaler Betrieb). Beim finalen Web-only-
  // Switch entfällt der Fallback — dann liegt der IAP-Header immer vor.
  return String(devFallback || 'd.streuli@axs.aero').toLowerCase()
}

/** IAP-E-Mail → { email, person, rollen, isKnown, viaIap } anhand der identity_map.
 *  Unbekannt → nur lesend. viaIap unterscheidet echten IAP-Login vom Dev-Fallback (lokal/Tailnet,
 *  s. api-core.js requireIdentityRole + App.jsx/WelcomePanel — Sicherheits-Härtung 10.08.2026).
 *  `iapActive` muss ZUSÄTZLICH zum Header vorliegen (RUBICON_IAP_ACTIVE, nur am Cloud-Run-Service
 *  gesetzt) — ohne das Flag (lokal/Tailnet) ist ein mitgeschickter Header wirkungslos, es greift
 *  immer der freie Modus (kein Header-Spoofing, kein stiller Fail-open). */
export function resolveIdentity(headers, map, devFallback, iapActive) {
  const headerEmail = parseHeaderEmail(headers)
  const viaIap = !!iapActive && headerEmail.includes('@')
  const email = viaIap ? headerEmail : String(devFallback || 'd.streuli@axs.aero').toLowerCase()  // RUBICON-CUTOVER
  const entry = (map && map[email]) || null
  const rollen = (entry && Array.isArray(entry.rollen) && entry.rollen.length) ? entry.rollen : ['Teilnehmer']
  return { email, person: (entry && entry.person) || email, rollen, isKnown: !!entry, viaIap }
}

/** Serverseitiges Write-Gate (I3, 10.08.2026): verweigert, wenn echter IAP-Login vorliegt UND
 *  die gesendete Rolle nicht zu den erlaubten Rollen gehört. Ohne IAP (viaIap false) NIE
 *  verweigern (altes freies Verhalten) — rein, damit unabhängig von api-core.js testbar. */
export function identityRoleDenied(identity, role) {
  return !!(identity && identity.viaIap) && !identity.rollen.includes(role)
}

/** Unter echtem IAP-Login darf ein Owner nur im eigenen Namen (me === identity.person)
 *  handeln. Ohne IAP (viaIap false) oder für andere Rollen: NIE blockieren. me===undefined ⇒ No-op. */
export function ownerMeDenied(identity, role, me) {
  return !!(identity && identity.viaIap) && role === 'Owner' && me !== undefined && me !== identity.person
}
