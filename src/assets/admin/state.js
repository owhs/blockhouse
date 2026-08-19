// Shared studio state + view registry (its own module to avoid import cycles).
//
// NOTE: nothing outside the shell may import './main.js'. The shell script tag
// loads main.js with a ?v= cache-buster, so an unversioned relative import of
// main.js would evaluate the module a SECOND time (two boots, two routers,
// every view mounting twice). Shared helpers live here instead; main.js wires
// its shell hooks into `hooks` below.

export const state = { meta: null, user: null }

export const VIEWS = {}   // name -> async (viewEl, params) => cleanup?
export function registerView(name, fn) { VIEWS[name] = fn }

// shell hooks (assigned by main.js at boot) — lets shared helpers reach the
// shell without importing main.js
export const hooks = { paintNav: null }

const CONCEPT_ICONS = { page: 'page', post: 'pen', product: 'tag', project: 'folder', doc: 'book' }
export function conceptIcon(c) { return (c.icon && /^[a-zA-Z-]+$/.test(c.icon) ? c.icon : null) || CONCEPT_ICONS[c.name] || 'page' }

/** Re-fetch site metadata and repaint the nav — call after anything that changes concepts/plugins/site. */
export async function refreshMeta() {
  const { get } = await import('./api.js')
  state.meta = await get('/meta')
  hooks.paintNav?.()
}

// custom plugin panel sections (data app registers a rich one)
export const DATA_SECTIONS = {}
export function registerDataSection(fn) { DATA_SECTIONS.data = fn }

export function prefs() {
  try { return JSON.parse(localStorage.getItem('blockhouse-studio-prefs') || '{}') } catch { return {} }
}
export function setPref(k, v) {
  const p = prefs(); p[k] = v
  try { localStorage.setItem('blockhouse-studio-prefs', JSON.stringify(p)) } catch {}
}
