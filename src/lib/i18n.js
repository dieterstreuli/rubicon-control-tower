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
