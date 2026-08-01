// theme.js — Design-Tokens des RUBICON Control Towers, umschaltbar Hell/Dunkel.
// T ist ein MUTABLES Objekt: applyTheme() überschreibt die Tokens in place; da
// alle Styles T.* zur Render-Zeit lesen, greift ein Re-Render sofort. STATUS_META
// liefert die Signalfarben über Getter → zieht bei Theme-Wechsel automatisch mit.

import DOMAIN from '../data/domain.json'

const FONTS = {
  mono: "'SF Mono','JetBrains Mono','Roboto Mono',ui-monospace,monospace",
  sans: "-apple-system,'Segoe UI',system-ui,sans-serif",
}

// Dunkel — Ops-Center (Default). inkFaint aufgehellt (B4/A11y 01.08.):
// #5d6a85 auf #0b1220 lag bei ~3.4:1 — Legenden/Fusszeilen waren unter WCAG-AA.
const DARK = {
  bg: '#0b1220', panel: '#111a2c', panelSoft: '#16213a', line: '#24304a',
  ink: '#f3efe6', inkDim: '#9aa5bc', inkFaint: '#7c89a4',
  green: '#34d399', amber: '#fbbf24', red: '#f43f5e', grey: '#64748b', blue: '#60a5fa',
  brass: '#d4a95c',
}

// Hell — heller Kontroll-Look; Signalfarben leicht abgedunkelt für Kontrast auf Weiss.
// inkFaint abgedunkelt (B4/A11y 01.08.) — #8794a8 auf Weiss war unter AA.
const LIGHT = {
  bg: '#f4f6f9', panel: '#ffffff', panelSoft: '#eef1f5', line: '#d6dde4',
  ink: '#1a2436', inkDim: '#556077', inkFaint: '#68758c',
  green: '#0f9d63', amber: '#b45309', red: '#e11d48', grey: '#64748b', blue: '#2563eb',
  brass: '#a9791f',
}

// Mutables Live-Token-Objekt (Start: Dunkel)
export const T = { ...FONTS, ...DARK }

export function applyTheme(mode) {
  const p = mode === 'light' ? LIGHT : DARK
  Object.assign(T, p)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = mode
    document.body.style.background = T.bg
    document.body.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    try { localStorage.setItem('rubicon_theme', mode) } catch (e) { /* ignore */ }
  }
  return mode
}

export function initialTheme() {
  try { return localStorage.getItem('rubicon_theme') === 'light' ? 'light' : 'dark' } catch (e) { return 'dark' }
}

// Signalfarben via Getter → immer die aktuellen Token-Werte (Theme-sicher).
// Labels/Token kommen aus der Domänen-SSOT (src/data/domain.json, Q2 01.08.2026).
// Bewusst die JSON direkt (nicht lib/domain.js) — sonst entstünde ein Import-Zyklus
// theme ↔ domain; domain.js liegt eine Ebene darüber und darf T verwenden.
export const STATUS_META = Object.fromEntries(
  Object.entries(DOMAIN.status.meta).map(([st, m]) => [
    st, { label: m.label, get color() { return T[m.token] } },
  ]))

export const ROLES = DOMAIN.rollen
