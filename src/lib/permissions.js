// permissions.js — EINE Rechte-Matrix für UI und Server (Q4, 01.08.2026).
//
// WARUM: Die Rechte lagen vorher implizit an ~15 Stellen (4 Kopien von
// mayToggle/mayAdvance, 11 role==='CoS'-Checks im UI, plus eigene Checks je
// Endpoint). Eine neue Rolle («PMO») hätte alle davon einzeln getroffen —
// mit hohem Risiko inkonsistenter Rechte zwischen Anzeige und Server.
//
// JETZT: Wer was darf, steht in MATRIX. Das UI fragt can(...), der Server
// (plugins/rubicon-api.js) importiert dieselbe Datei. Eine neue Rolle =
// ein Eintrag hier + ggf. Meta in src/data/domain.json.
//
// WICHTIG: Das UI-Gating bleibt Defense-in-Depth (role/me sind clientseitig).
// Verbindlich ist die Server-Prüfung — sie nutzt exakt diese Matrix.

/**
 * Aktionen (Vokabular des Systems):
 *   sitzung.erfassen      Sitzung/Protokoll schreiben (inkl. Gemini-Import)
 *   ms.melden             Fortschritt/Blocker an einem Milestone melden
 *   task.abhaken          Handlung erledigen/wieder öffnen
 *   task.anlegen          Handlungen anlegen/ändern (Zerlegung)
 *   entscheid.erfassen    Entscheid ins Register aufnehmen/pflegen
 *   entscheid.fortschreiben  Status-Übergang im 5-Stufen-Modell
 *   reminder.entwerfen    Reminder-Gmail-Entwürfe erzeugen
 *   report.erzeugen       Report rendern
 *   ki.nutzen             KI-Vorschläge anfordern (Zerlegung)
 *
 * Wert je Rolle:
 *   true      → immer erlaubt
 *   'eigene'  → nur für eigene Objekte (Owner-Scope; siehe ownerOf)
 *   fehlt     → verboten
 */
export const MATRIX = {
  CoS: {
    'sitzung.erfassen': true,
    'ms.melden': true,
    'task.abhaken': true,
    'task.anlegen': true,
    'entscheid.erfassen': true,
    'entscheid.fortschreiben': true,
    'reminder.entwerfen': true,
    'report.erzeugen': true,
    'ki.nutzen': true,
    'zielbild.fortschreiben': true,
  },
  Owner: {
    'sitzung.erfassen': true,          // Owner-Scope wird pro Milestone beim Anwenden geprüft
    'ms.melden': 'eigene',
    'task.abhaken': 'eigene',
    'entscheid.erfassen': true,        // nur im eigenen Namen (antragsteller wird gesetzt)
    'entscheid.fortschreiben': 'eigene',
    'report.erzeugen': true,
  },
  Chairman: {},                        // steuert & kontrolliert — bewusst nur lesend
  Teilnehmer: {},                      // nur lesend
}

/** Fehlertexte je Aktion (bleiben stabil — Smoke-Suite und UI hängen daran). */
export const DENY_TEXT = {
  'sitzung.erfassen': (r) => `Rolle «${r || '?'}» darf nicht erfassen`,
  'ms.melden': (r) => `Rolle «${r || '?'}» darf nicht melden`,
  'task.abhaken': (r) => `Rolle «${r || '?'}» darf nicht abhaken`,
  'task.anlegen': () => 'nur CoS darf Handlungen anlegen/ändern',
  'entscheid.erfassen': (r) => `Rolle «${r || '?'}» darf keine Entscheide erfassen`,
  'entscheid.fortschreiben': (r) => `Rolle «${r || '?'}» darf den Status nicht ändern`,
  'reminder.entwerfen': () => 'nur CoS darf Reminder-Entwürfe erzeugen',
  'ki.nutzen': () => 'nur CoS darf Zerlegungen vorschlagen lassen',
  'report.erzeugen': (r) => `Rolle «${r || '?'}» darf keine Reports erzeugen`,
  'zielbild.fortschreiben': () => 'nur CoS darf den Zielbild-Reifegrad fortschreiben',
}

/** Owner-Zuordnung eines Objekts (Handlung, Milestone, Entscheid). */
export const ownerOf = (obj) => obj?.owner ?? obj?.antragsteller ?? null

/**
 * Darf `role` (Identität `me`) die Aktion ausführen?
 * @param obj optionales Zielobjekt für 'eigene'-Regeln (owner/antragsteller);
 *            zusätzlich wird bei Milestones `_wsOwner`/wsOwner akzeptiert (Strom-Owner).
 */
export function can(role, me, aktion, obj = null) {
  const regel = MATRIX[role]?.[aktion]
  if (regel === true) return true
  if (regel !== 'eigene') return false
  if (!obj) return true                       // generelle Berechtigung; Scope prüft der Aufrufer objektweise
  const owner = ownerOf(obj)
  const wsOwner = obj?._wsOwner ?? obj?.wsOwner ?? null
  return owner === me || (wsOwner !== null && wsOwner === me)
}

/** Gibt es die Berechtigung grundsätzlich (unabhängig vom Objekt)? — für UI-Sichtbarkeit. */
export const canAny = (role, aktion) => Boolean(MATRIX[role]?.[aktion])

/** Server-Helfer: wirft mit passendem Text/Status, wenn nicht erlaubt. */
export function requireCan(fail, role, me, aktion, obj = null) {
  if (!can(role, me, aktion, obj)) {
    const txt = (DENY_TEXT[aktion] || ((r) => `Rolle «${r || '?'}» darf das nicht`))(role)
    fail(403, txt)
  }
}
