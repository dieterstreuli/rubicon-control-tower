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
  // Aufgaben
  'auf.suchen': 'Suchen: Handlung / Person / T-Nr…',
  'auf.suchenAria': 'Handlungen durchsuchen',
  'auf.offen': 'offen',
  'auf.ueberfaellig': 'überfällig ⚠',
  'auf.erledigt': 'erledigt',
  'auf.alleStatus': 'alle Status',
  'auf.allePhasen': 'alle Phasen',
  'auf.ohneMilestone': 'ohne Milestone',
  'auf.alleStroeme': 'alle Ströme',
  'auf.alleVerantwortlichen': 'alle Verantwortlichen',
  'auf.handlung': 'HANDLUNG',
  'auf.verantwortlich': 'VERANTWORTLICH',
  'auf.faellig': 'FÄLLIG',
  'auf.milestone': 'MILESTONE',
  'auf.phase': 'PHASE',
  'auf.keine': 'Keine Handlungen für diese Filter.',
  'auf.keinRecht': 'Rolle darf diese Handlung nicht abhaken',
  'auf.titel': 'AUFGABEN · ALLE HANDLUNGEN',
  'auf.angezeigt': 'angezeigt',
  'auf.gesamt': 'gesamt',
  'rep.ebene': 'Ebene',
  'rep.periode': 'Periode',
  'rep.nurLesen': 'nur Lesen',
  'rep.keinReport': 'Noch kein Report erzeugt.',
  'rep.nurLokal': 'nur lokal',
  'ui.artefakt': 'ARTEFAKT',
  'ui.ablageLink': 'Ablage-Link des Arbeitsprodukts',
  'ui.keinPointer': 'kein gültiger Archiv-Pointer',
  'ui.msFiltern': 'Milestone filtern',
  'wp.ausblenden': 'Ausblenden',
  'wp.webKontext': 'In deinem Web-Kontext:',
  'ent.pflege': 'Pflege',
  'ent.begruendungPflicht': 'Begründung (Pflicht vor «entschieden»)',
  'ent.datengrundlage': 'Datengrundlage (Unterlagen/Links)',
  'ent.anhaenge': 'Anhänge: Drive-Links, kommagetrennt — gehen bei «kommuniziert» als PDF mit',
  'ent.anhaengeTitle': 'z.B. Kompetenzordnung — Google-Docs werden als PDF exportiert und dem Gmail-Entwurf angehängt',
  'ent.alleStatus': 'alle Status',
  'ent.alleGremien': 'alle Gremien',
  'ent.titelPflicht': 'Titel *',
  'ent.gremiumTitle': 'zuständiges Gremium (aus Kompetenzmatrix)',
  'ent.antragsteller': 'Antragsteller',
  'ent.fristTitle': 'Frist — bis wann entschieden sein muss',
  'ent.frage': 'Entscheid-Frage / beantragter Entscheid *',
  'ent.begruendung': 'Begründung',
  'ent.thTitel': 'TITEL',
  'ent.thTyp': 'TYP',
  'ent.thGremium': 'GREMIUM',
  'ent.thAntragsteller': 'ANTRAGSTELLER',
  'ent.thFrist': 'FRIST / DATUM',
  'ent.thStatus': 'STATUS',
  'ent.keine': 'Keine Entscheide für diese Filter.',
  'ent.abbrechen': 'Abbrechen',
  'ent.erzeugtPdf': 'erzeugt Entscheid-PDF + Gmail-Entwurf — DRS sendet',
  'ent.lblEntscheid': 'Entscheid:',
  'ent.lblBegruendung': 'Begründung:',
  'ent.lblDatengrundlage': 'Datengrundlage:',
  'ent.lblAnhaenge': 'Anhänge:',
  'ent.lblKommunikation': 'Kommunikation:',
  'ent.lblUmsetzung': 'Umsetzungs-Handlungen:',
  'ent.pdfLink': 'Entscheid-PDF ↗',
  'ent.docLink': 'Doc ↗',
  'ent.gmailTitle': 'Gmail-Entwurf mit PDF-Anhang — DRS sendet',
  'ent.gmailLink': 'Gmail-Entwurf ↗',
  'ms.faelligLuecke': 'fällig — (Datenlücke)',
  'ms.vorschlagUebernehmen': 'Vorschlag übernehmen',
  'ms.owner': 'Owner',
  'ms.vorschlagPruefen': 'Vorschlag — prüfen!',
  'ms.progressSource': 'progress_source: tasks — der Milestone-Fortschritt wird ab dann aus den Handlungen VERDIENT (bewusster Akt)',
  'ms.verwerfen': 'Verwerfen',
  'ms.fortschrittMelden': 'FORTSCHRITT MELDEN',
  'ms.fortschrittProzent': 'Fortschritt (%)',
  'ms.blocker': 'Blocker (+Tage Verzug)',
  'ms.ampel': 'Ampel',
  'ms.vorheriger': 'Vorheriger Meilenstein',
  'ms.vorherigerTitle': 'Vorheriger Meilenstein (←)',
  'ms.naechster': 'Nächster Meilenstein',
  'ms.naechsterTitle': 'Nächster Meilenstein (→)',
  'ms.schliessen': 'Schliessen',
  'ms.faelligBis': 'Fällig bis',
  'ms.start': 'Start',
  'ms.abhaengigVon': 'Abhängig von',
  'ms.beteiligte': 'Beteiligte:',
  'ms.zielKlartext': 'ZIEL IM KLARTEXT:',
  'ms.kontext': 'KONTEXT — WARUM DIESER MILESTONE',
  'ms.deliverables': 'ERWARTETE LEISTUNG (DELIVERABLES)',
  'ms.vorgehen': 'VORGEHEN',
  'ms.kpi': 'ERFOLGSMESSUNG (KPI)',
  'ms.risiken': 'RISIKEN & ABHÄNGIGKEITEN',
  'ms.datengrundlage': 'DATENGRUNDLAGE',
  'ms.vollstaendig': 'vollständig öffnen →',
  'ms.doc': 'Doc ↗',
  'ms.pdfOeffnen': 'Vollständige PDF öffnen',
  'sit.meeting': 'Meeting',
  'sit.meetingTag': 'Meeting-Tag',
  'sit.suchfenster': 'Suchfenster',
  'sit.nurDieserTag': 'nur dieser Tag',
  'sit.dieseVerwenden': 'diese verwenden',
  'sit.vorschau': 'VORSCHAU — nichts geschrieben',
  'sit.quelleGemini': 'Quelle: Gemini-Doc ↗',
  'sit.keineWirkung': 'projekt.yaml-Wirkung: KEINE',
  'sit.thTyp': 'TYP',
  'sit.thText': 'TEXT',
  'sit.thOwner': 'OWNER',
  'sit.thBis': 'BIS',
  'sit.verwerfen': 'Verwerfen',
  'sit.datum': 'Datum',
  'sit.vorsitz': 'Vorsitz',
  'sit.erfasstVon': 'Erfasst von',
  'sit.traktanden': 'Traktanden dieser Sitzung (Leitfaden)',
  'sit.agendaPdf': 'Agenda-PDF',
  'sit.doc': 'Doc ↗',
  'sit.ergebnisse': 'Ergebnisse',
  'sit.nichtsErfasst': 'Noch nichts erfasst — oben einen Ergebnistyp hinzufügen.',
  'sit.fortschrittStufen': 'Fortschritt in 25%-Stufen (DRS 01.08.)',
  'sit.verzugTage': 'Verzug in Tagen',
  'sit.owner': 'Owner',
  'sit.bisWann': 'bis wann',
  'sit.getroffen': 'getroffen',
  'sit.offenQueue': 'offen (Entscheids-Queue)',
  'sit.eskalationsebene': 'Eskalationsebene — VR erscheint im VR-Report',
  'sit.ebeneGL': 'Ebene GL',
  'sit.ebeneVR': 'Ebene VR',
  'sit.entfernen': 'entfernen',
  'sit.gekoppelt': 'an Milestone gekoppelt — treibt dessen Fortschritt',
  'sit.keineOffen': 'keine offen',
  'sit.nurLokal': 'nur lokal einsehbar — keine Spiegel, kein Export',
  'sit.keinExportSens': 'kein Export (sensitiv)',
  'sit.neuErzeugen': 'neu erzeugen',
  'sit.nochKeinExport': 'noch kein Export',
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
  // Actions
  'auf.suchen': 'Search: action / person / T-no…',
  'auf.suchenAria': 'Search actions',
  'auf.offen': 'open',
  'auf.ueberfaellig': 'overdue ⚠',
  'auf.erledigt': 'done',
  'auf.alleStatus': 'all statuses',
  'auf.allePhasen': 'all phases',
  'auf.ohneMilestone': 'without milestone',
  'auf.alleStroeme': 'all workstreams',
  'auf.alleVerantwortlichen': 'all owners',
  'auf.handlung': 'ACTION',
  'auf.verantwortlich': 'OWNER',
  'auf.faellig': 'DUE',
  'auf.milestone': 'MILESTONE',
  'auf.phase': 'PHASE',
  'auf.keine': 'No actions match these filters.',
  'auf.keinRecht': 'Your role may not tick off this action',
  'auf.titel': 'ACTIONS · ALL ITEMS',
  'auf.angezeigt': 'shown',
  'auf.gesamt': 'total',
  'rep.ebene': 'Level',
  'rep.periode': 'Period',
  'rep.nurLesen': 'read-only',
  'rep.keinReport': 'No report generated yet.',
  'rep.nurLokal': 'local only',
  'ui.artefakt': 'ARTEFACT',
  'ui.ablageLink': 'Storage link of the work product',
  'ui.keinPointer': 'not a valid archive pointer',
  'ui.msFiltern': 'Filter milestone',
  'wp.ausblenden': 'Hide',
  'wp.webKontext': 'In your web context:',
  'ent.pflege': 'Edit',
  'ent.begruendungPflicht': 'Rationale (required before «decided»)',
  'ent.datengrundlage': 'Evidence base (documents/links)',
  'ent.anhaenge': 'Attachments: Drive links, comma-separated — sent as PDF on «communicated»',
  'ent.anhaengeTitle': 'e.g. authority matrix — Google Docs are exported as PDF and attached to the Gmail draft',
  'ent.alleStatus': 'all statuses',
  'ent.alleGremien': 'all bodies',
  'ent.titelPflicht': 'Title *',
  'ent.gremiumTitle': 'responsible body (per authority matrix)',
  'ent.antragsteller': 'Requested by',
  'ent.fristTitle': 'Deadline — by when the decision must be taken',
  'ent.frage': 'Decision question / requested decision *',
  'ent.begruendung': 'Rationale',
  'ent.thTitel': 'TITLE',
  'ent.thTyp': 'TYPE',
  'ent.thGremium': 'BODY',
  'ent.thAntragsteller': 'REQUESTED BY',
  'ent.thFrist': 'DEADLINE / DATE',
  'ent.thStatus': 'STATUS',
  'ent.keine': 'No decisions match these filters.',
  'ent.abbrechen': 'Cancel',
  'ent.erzeugtPdf': 'creates decision PDF + Gmail draft — DRS sends',
  'ent.lblEntscheid': 'Decision:',
  'ent.lblBegruendung': 'Rationale:',
  'ent.lblDatengrundlage': 'Evidence base:',
  'ent.lblAnhaenge': 'Attachments:',
  'ent.lblKommunikation': 'Communication:',
  'ent.lblUmsetzung': 'Implementation actions:',
  'ent.pdfLink': 'Decision PDF ↗',
  'ent.docLink': 'Doc ↗',
  'ent.gmailTitle': 'Gmail draft with PDF attachment — DRS sends',
  'ent.gmailLink': 'Gmail draft ↗',
  'ms.faelligLuecke': 'due — (data gap)',
  'ms.vorschlagUebernehmen': 'Accept suggestion',
  'ms.owner': 'Owner',
  'ms.vorschlagPruefen': 'Suggestion — please check!',
  'ms.progressSource': 'progress_source: tasks — milestone progress is then EARNED from the actions (deliberate step)',
  'ms.verwerfen': 'Discard',
  'ms.fortschrittMelden': 'REPORT PROGRESS',
  'ms.fortschrittProzent': 'Progress (%)',
  'ms.blocker': 'Blocker (+days delay)',
  'ms.ampel': 'Status light',
  'ms.vorheriger': 'Previous milestone',
  'ms.vorherigerTitle': 'Previous milestone (←)',
  'ms.naechster': 'Next milestone',
  'ms.naechsterTitle': 'Next milestone (→)',
  'ms.schliessen': 'Close',
  'ms.faelligBis': 'Due by',
  'ms.start': 'Start',
  'ms.abhaengigVon': 'Depends on',
  'ms.beteiligte': 'Involved:',
  'ms.zielKlartext': 'OBJECTIVE IN PLAIN WORDS:',
  'ms.kontext': 'CONTEXT — WHY THIS MILESTONE',
  'ms.deliverables': 'EXPECTED DELIVERABLES',
  'ms.vorgehen': 'APPROACH',
  'ms.kpi': 'SUCCESS MEASURE (KPI)',
  'ms.risiken': 'RISKS & DEPENDENCIES',
  'ms.datengrundlage': 'EVIDENCE BASE',
  'ms.vollstaendig': 'open in full →',
  'ms.doc': 'Doc ↗',
  'ms.pdfOeffnen': 'Open full PDF',
  'sit.meeting': 'Meeting',
  'sit.meetingTag': 'Meeting day',
  'sit.suchfenster': 'Search window',
  'sit.nurDieserTag': 'this day only',
  'sit.dieseVerwenden': 'use this one',
  'sit.vorschau': 'PREVIEW — nothing written',
  'sit.quelleGemini': 'Source: Gemini doc ↗',
  'sit.keineWirkung': 'projekt.yaml effect: NONE',
  'sit.thTyp': 'TYPE',
  'sit.thText': 'TEXT',
  'sit.thOwner': 'OWNER',
  'sit.thBis': 'BY',
  'sit.verwerfen': 'Discard',
  'sit.datum': 'Date',
  'sit.vorsitz': 'Chair',
  'sit.erfasstVon': 'Recorded by',
  'sit.traktanden': 'Agenda for this meeting (guide)',
  'sit.agendaPdf': 'Agenda PDF',
  'sit.doc': 'Doc ↗',
  'sit.ergebnisse': 'Results',
  'sit.nichtsErfasst': 'Nothing recorded yet — add a result type above.',
  'sit.fortschrittStufen': 'Progress in 25% steps (DRS 01.08.)',
  'sit.verzugTage': 'Delay in days',
  'sit.owner': 'Owner',
  'sit.bisWann': 'by when',
  'sit.getroffen': 'taken',
  'sit.offenQueue': 'open (decision queue)',
  'sit.eskalationsebene': 'Escalation level — board items appear in the board report',
  'sit.ebeneGL': 'Level ExB',
  'sit.ebeneVR': 'Level Board',
  'sit.entfernen': 'remove',
  'sit.gekoppelt': 'linked to milestone — drives its progress',
  'sit.keineOffen': 'none open',
  'sit.nurLokal': 'local view only — no mirrors, no export',
  'sit.keinExportSens': 'no export (sensitive)',
  'sit.neuErzeugen': 'regenerate',
  'sit.nochKeinExport': 'no export yet',
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
