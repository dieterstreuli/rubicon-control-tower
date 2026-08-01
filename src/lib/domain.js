// domain.js — JS-Zugriff auf die Domänen-SSOT (Q2, 01.08.2026).
//
// EINZIGE Quelle der Domänen-Konstanten ist src/data/domain.json; diese Datei
// reicht sie typisiert/bequem durch und löst Theme-Token zu Live-Farben auf.
// Python liest dieselbe JSON über scripts/_domain.py — es gibt keine zweite Liste.
//
// Regel: Neuer Status / neue Phase / neuer Workflow-Schritt ⇒ NUR domain.json ändern.
// (Ausnahme bleibt die Statuslogik selbst — status.js + gen_report.status_of mit
// Paritätstest; das ist eine bewusst gespiegelte Regel, keine Konstante.)

import D from '../data/domain.json'
import { T } from './theme.js'

export const DOMAIN = D

// ── Rollen ──
export const ROLES = D.rollen
export const ROLE_META = D.rollen_meta
export const roleInfo = (role) => {
  const m = D.rollen_meta[role] || { titel: role, token: 'grey', beschreibung: '' }
  return { ...m, get color() { return T[m.token] } }
}

// ── Status (Ampel) ──
export const STATUS_ORDER = D.status.reihenfolge
export const statusLabel = (st) => (D.status.meta[st] || D.status.meta.unknown).label
export const statusColor = (st) => T[(D.status.meta[st] || D.status.meta.unknown).token]

// ── Phasen ──
export const PHASE_ORDER = D.phasen.reihenfolge
export const phaseToken = (p) => D.phasen.token[p] || null

// ── Entscheids-Register ──
export const ENT_FLOW = D.entscheide.flow
export const ENT_TYPEN = D.entscheide.typen
export const ENT_GREMIEN = D.entscheide.gremien
export const ENT_COLOR = (st) => T[D.entscheide.token[st] || 'grey']
/** Ab diesem Status ist die Begründung Pflicht (Server erzwingt es zusätzlich). */
export const ENT_BEGRUENDUNG_AB = D.entscheide.begruendung_pflicht_ab

// ── Sitzungs-Eintragstypen ──
export const TYP_LABEL = Object.fromEntries(Object.entries(D.sitzung_eintragstypen).map(([k, v]) => [k, v.label]))
export const TYP_ICON = Object.fromEntries(Object.entries(D.sitzung_eintragstypen).map(([k, v]) => [k, v.icon]))

// ── Reports ──
export const LVL_LABEL = Object.fromEntries(Object.entries(D.report_ebenen).map(([k, v]) => [k, v.label]))
export const LVL_AUSWAHL = Object.fromEntries(Object.entries(D.report_ebenen).map(([k, v]) => [k, v.auswahl]))
export const LVL_COLOR = (lvl) => T[D.report_ebenen[lvl]?.token || 'grey']

// ── Fortschritts-Stufen (25%-Raster, DRS 01.08.) ──
export const PROGRESS_STEPS = D.fortschritt_stufen
