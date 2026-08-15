// i18n.js — Zweisprachigkeit DE/EN für die OBERFLÄCHE (Etappe 1, 14.08.2026).
//
// Anlass: Tine Petric arbeitet täglich im Tower (17 eigene Milestones) und
// korrespondiert englisch (Sprachregel in kontakte.json). Übersetzt wird die
// HÜLLE — Navigation, Kopfzeile, Spaltentitel, Status-Wörter. Die INHALTE
// (projekt.yaml, tasks, protokolle, entscheide) bleiben in ihrer Originalsprache;
// sie sind lebende Governance-Daten und werden NICHT doppelt gepflegt.
//
// Zwei bewusste Entscheidungen:
//   1. DEUTSCH BLEIBT STANDARD. Englisch ist ein Schalter, den nur wählt, wer ihn
//      braucht. Für alle bisherigen Nutzer (VR, GL) ändert sich nichts — wichtig
//      im Fenster vor der VR-Sitzung 26.08.
//   2. FALLBACK STATT FEHLER. Fehlt ein englischer Eintrag, erscheint der deutsche
//      Text — nie ein Schlüssel wie «nav.tower». So kann Etappe 2 schrittweise
//      nachziehen, ohne dass zwischendurch etwas kaputt aussieht.
//
// Neuen Text übersetzbar machen: Schlüssel in DICT.de UND DICT.en ergänzen,
// im JSX `t('schluessel')` statt des festen Textes verwenden.
import React, { createContext, useContext } from 'react'

export const LANGS = ['de', 'en']
const LANG_KEY = 'rubicon_lang'

export function initialLang() {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored && LANGS.includes(stored)) return stored
  } catch { /* localStorage kann blockiert sein — dann Standard */ }
  return 'de'
}

export function storeLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* egal */ }
}

// Uhrzeit-/Zahlenformat folgt der Sprache, das Datumsformat NICHT:
// fmtDate() liefert bewusst überall dasselbe TT.MM.JJJJ, damit Screenshots und
// PDF-Reports über beide Sprachen hinweg vergleichbar bleiben.
export const CLOCK_LOCALE = { de: 'de-CH', en: 'en-GB' }

const DICT = {
  de: {
    'nav.tower': 'Kontrollturm',
    'nav.aufgaben': 'Aufgaben',
    'nav.sitzungen': 'Sitzungen',
    'nav.entscheide': 'Entscheide',
    'nav.reports': 'Reports',

    'hdr.steuerungsdatum': 'Steuerungsdatum',
    'hdr.uhr': 'Uhr',
    'hdr.gesamtstatus': 'Gesamtstatus',
    'hdr.kernEnde': 'Kern-Ende',
    'hdr.aufBasislinie': 'auf Basislinie',
    'hdr.verletzungen': 'VERLETZUNG(EN)!',
    'hdr.tageKurz': 'T',
    'hdr.integritaet': 'Integrität',
    'hdr.fehler': 'Fehler',
    'hdr.luecken': 'Lücken',
    'hdr.radar': 'Radar',
    'hdr.keineBefunde': 'Keine Befunde.',
    'hdr.fokus': 'Fokus',
    'hdr.rolle': 'Rolle',
    'hdr.waehlen': '— wählen —',

    'hdr.introTitle': 'Programm-Übersicht: Sinn & Zweck · Ströme · Phasen · Zeitachse · Führungsrhythmus',
    'hdr.introAria': 'Programm-Übersicht (Intro)',
    'hdr.themeAria': 'Hell/Dunkel umschalten',
    'hdr.themeLight': 'Hell-Modus',
    'hdr.themeDark': 'Dunkel-Modus',
    'hdr.langAria': 'Sprache umschalten',
    'hdr.langTitle': 'Auf Englisch umschalten',
    'hdr.fokusTitle': 'Filter aufheben — zurück zur AXS-Gesamtübersicht',
  },
  en: {
    'nav.tower': 'Control Tower',
    'nav.aufgaben': 'Actions',
    'nav.sitzungen': 'Meetings',
    'nav.entscheide': 'Decisions',
    'nav.reports': 'Reports',

    'hdr.steuerungsdatum': 'Reporting date',
    'hdr.uhr': 'Time',
    'hdr.gesamtstatus': 'Overall status',
    'hdr.kernEnde': 'Core end date',
    'hdr.aufBasislinie': 'on baseline',
    'hdr.verletzungen': 'BREACH(ES)!',
    'hdr.tageKurz': 'd',
    'hdr.integritaet': 'Integrity',
    'hdr.fehler': 'errors',
    'hdr.luecken': 'gaps',
    'hdr.radar': 'radar',
    'hdr.keineBefunde': 'No findings.',
    'hdr.fokus': 'Focus',
    'hdr.rolle': 'Role',
    'hdr.waehlen': '— select —',

    'hdr.introTitle': 'Programme overview: purpose · workstreams · phases · timeline · governance rhythm',
    'hdr.introAria': 'Programme overview (intro)',
    'hdr.themeAria': 'Toggle light/dark',
    'hdr.themeLight': 'Light mode',
    'hdr.themeDark': 'Dark mode',
    'hdr.langAria': 'Switch language',
    'hdr.langTitle': 'Auf Deutsch umschalten',
    'hdr.fokusTitle': 'Clear filter — back to the AXS overview',
  },
}

// ---------------------------------------------------------------------------
// Etappe 2 — Kontrollturm-Rumpf.
// ---------------------------------------------------------------------------
// WICHTIG: Die Status- und Phasen-Bezeichnungen stehen in src/data/domain.json,
// und die Datei wird von JS UND Python gelesen (gen_report.py, validate.py).
// Ein Umbenennen dort wuerde die Report-Generatoren und den Paritaetstest
// brechen. Deshalb wird hier WERT-basiert uebersetzt: Schluessel ist der
// deutsche Originaltext. Fehlt einer, bleibt das Deutsche stehen — domain.json
// bleibt unangetastet, die SSOT-Regel gilt weiter.
const VALUES_EN = {
  // Status (domain.json → status.meta[].label)
  'Erledigt': 'Done',
  'Auf Kurs': 'On track',
  'Gefährdet': 'At risk',
  'Verzug': 'Delayed',
  'Unbekannt': 'Unknown',
  // Phasen (domain.json → phasen.reihenfolge)
  'Nachlauf Q2/27': 'Follow-up Q2/27',
  'Vorbereitung': 'Preparation',
  'Ansprache': 'Approach',
  'Abschluss': 'Closing',
  'Zielbild': 'Target state',
  // Rollen
  'Teilnehmer': 'Participant',
}

// Uebersetzt einen ANGEZEIGTEN WERT (kein Schluessel). Unbekanntes bleibt, wie
// es ist — bei Inhalten aus projekt.yaml ist genau das gewollt.
export function translateValue(lang, value) {
  if (lang === 'de' || value == null) return value
  return Object.prototype.hasOwnProperty.call(VALUES_EN, value) ? VALUES_EN[value] : value
}

// Rollen-Banner: Titel und Beschreibung stehen in domain.json (rollen_meta) und
// sind ganze Saetze — wert-basiert waere das unleserlich. Darum eigene Schluessel,
// die den domain.json-Text NICHT ersetzen, sondern nur die englische Anzeige liefern.
const ROLE_EN = {
  'CoS': { titel: 'CoS — Programme lead',
           beschreibung: 'Full control: record progress/blockers, tick off inputs, enforcement queue (reminders/calendar/escalation).' },
  'Chairman': { titel: 'Chairman (DRS) — steers & controls', beschreibung: 'Read-only view across all workstreams.' },
  'Owner': { titel: 'Owner — own workstream', beschreibung: 'Records progress and blockers for own milestones and actions.' },
  'Teilnehmer': { titel: 'Participant', beschreibung: 'Read-only.' },
}

// Liefert {titel, beschreibung} in der Zielsprache; im Zweifel das Original aus
// domain.json (Fallback-Prinzip: lieber deutsch als leer).
export function translateRole(lang, rolle, original) {
  if (lang === 'de') return original
  const e = ROLE_EN[rolle]
  if (!e) return original
  return { ...original, titel: e.titel, beschreibung: e.beschreibung }
}

Object.assign(DICT.de, {
  'kpi.gesamtstatus': 'Gesamtstatus',
  'kpi.aufKurs': 'Auf Kurs',
  'kpi.gefaehrdet': 'Gefährdet',
  'kpi.verzug': 'Verzug',
  'kpi.handlungenOffen': 'Handlungen offen',
  'kpi.meilensteine': 'Meilensteine',
  'kpi.erledigt': 'erledigt',
  'kpi.unbekannt': 'unbekannt',
  'kpi.ueberfaellig': 'überfällig',
  'kpi.treibenFortschritt': 'treiben den Fortschritt',
  'kpi.treiber': 'Treiber',
  'kpi.keinKritVerzug': 'kein kritischer Verzug',
  'tower.portfolio': 'Portfolio · Fokus wählen',
  'tower.gesamt': 'AXS-Gesamt',
  'tower.erfuellungPhase': 'Erfüllungsgrad je Phase (erledigt = 100 %',
  'tower.programmstart': 'Programmstart',
  'tower.alleStroeme': 'alle Ströme',
  'tower.ws': 'WS',
  'tower.ms': 'MS',
  'tower.handlungenOffenKurz': 'Handlungen offen',
  'tower.aktiveRolle': 'Aktive Rolle',
  'tower.angemeldetAls': 'Angemeldet als',
  'tower.unbekanntLesend': '— unbekannt, nur lesend',
  'tower.willkommenErneut': 'Willkommen erneut anzeigen',
  'tower.phaseErledigt': 'erledigt',
  'drift.1': 'Steuerungsdatum',
  'drift.2': 'ist',
  'drift.3': 'Tage alt — Ampeln & «überfällig» rechnen damit. Bei der nächsten Steuerungssitzung',
  'drift.4': 'in projekt.yaml aktualisieren.',
  // Abflugtafel
  'tafel.code': 'CODE',
  'tafel.meilenstein': 'MEILENSTEIN',
  'tafel.phase': 'PHASE',
  'tafel.owner': 'OWNER',
  'tafel.faellig': 'FÄLLIG',
  'tafel.fortschritt': 'FORTSCHRITT',
  'tafel.handlungen': 'HANDLUNGEN',
  'tafel.status': 'STATUS',
  // CoS-Steuerung
  'cos.ziel': 'ZIEL',
  'cos.entwuerfe': 'ENTWÜRFE',
  'cos.gmailEntwurf': 'Gmail-Entwurf',
  'cos.kalender': 'Kalender',
  'cos.eskalieren': 'Eskalieren',
  'cos.reminderProtokoll': 'Reminder-Protokoll',
  'cos.keineReminder': 'Noch keine Reminder-Entwürfe erzeugt.',
  'cos.automationsLog': 'Automations-Log',
  'cos.keineAutomationen': 'Noch keine Automationen ausgelöst.',
})

Object.assign(DICT.en, {
  'kpi.gesamtstatus': 'Overall status',
  'kpi.aufKurs': 'On track',
  'kpi.gefaehrdet': 'At risk',
  'kpi.verzug': 'Delayed',
  'kpi.handlungenOffen': 'Open actions',
  'kpi.meilensteine': 'milestones',
  'kpi.erledigt': 'done',
  'kpi.unbekannt': 'unknown',
  'kpi.ueberfaellig': 'overdue',
  'kpi.treibenFortschritt': 'drive progress',
  'kpi.treiber': 'Drivers',
  'kpi.keinKritVerzug': 'no critical delay',
  'tower.portfolio': 'Portfolio · select focus',
  'tower.gesamt': 'AXS total',
  'tower.erfuellungPhase': 'Completion by phase (done = 100 %',
  'tower.programmstart': 'programme start',
  'tower.alleStroeme': 'all workstreams',
  'tower.ws': 'WS',
  'tower.ms': 'MS',
  'tower.handlungenOffenKurz': 'open actions',
  'tower.aktiveRolle': 'Active role',
  'tower.angemeldetAls': 'Signed in as',
  'tower.unbekanntLesend': '— unknown, read-only',
  'tower.willkommenErneut': 'Show welcome again',
  'tower.phaseErledigt': 'done',
  'drift.1': 'Reporting date',
  'drift.2': 'is',
  'drift.3': 'days old — status lights & «overdue» are calculated from it. Update',
  'drift.4': 'in projekt.yaml at the next steering meeting.',
  // Departure board
  'tafel.code': 'CODE',
  'tafel.meilenstein': 'MILESTONE',
  'tafel.phase': 'PHASE',
  'tafel.owner': 'OWNER',
  'tafel.faellig': 'DUE',
  'tafel.fortschritt': 'PROGRESS',
  'tafel.handlungen': 'ACTIONS',
  'tafel.status': 'STATUS',
  // CoS controls
  'cos.ziel': 'TARGET',
  'cos.entwuerfe': 'DRAFTS',
  'cos.gmailEntwurf': 'Gmail draft',
  'cos.kalender': 'Calendar',
  'cos.eskalieren': 'Escalate',
  'cos.reminderProtokoll': 'Reminder log',
  'cos.keineReminder': 'No reminder drafts created yet.',
  'cos.automationsLog': 'Automation log',
  'cos.keineAutomationen': 'No automations triggered yet.',
})

// Übersetzt einen Schlüssel. Fehlt er in der Zielsprache, gewinnt Deutsch;
// fehlt er auch dort, kommt der Schlüssel selbst zurück (sichtbarer Defekt im
// Test, nie eine leere Fläche in der Oberfläche).
export function translate(lang, key) {
  const d = DICT[lang] || DICT.de
  if (Object.prototype.hasOwnProperty.call(d, key)) return d[key]
  if (Object.prototype.hasOwnProperty.call(DICT.de, key)) return DICT.de[key]
  return key
}

export const I18nCtx = createContext({ lang: 'de', t: (k) => translate('de', k), setLang: () => {} })

export function useT() {
  return useContext(I18nCtx)
}
