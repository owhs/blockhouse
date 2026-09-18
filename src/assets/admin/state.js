// Shared studio state + view registry (its own module to avoid import cycles).
//
// NOTE: nothing outside the shell may import './main.js'. The shell script tag
// loads main.js with a ?v= cache-buster, so an unversioned relative import of
// main.js would evaluate the module a SECOND time (two boots, two routers,
// every view mounting twice). Shared helpers live here instead; main.js wires
// its shell hooks into `hooks` below.

export const state = { meta: null, user: null }

export const VIEWS = {}   // name -> async (viewEl, params, query) => cleanup?
export function registerView(name, fn) { VIEWS[name] = fn }

// shell hooks (assigned by main.js at boot) — lets shared helpers reach the
// shell without importing main.js
export const hooks = { paintNav: null, refreshCounts: null, openPalette: null, invalidateSearch: null, addBlockByType: null }

// ---------- unsaved-work guards ----------
// "Dirty" used to mean five different things: guarded in the editor, silently
// auto-published in menus and chrome, silently discarded in design and
// settings. A view registers one guard; the router asks every guard before it
// tears anything down, so the contract is the same everywhere.

export const guards = new Map()
/** registerGuard('menus', async () => true|false) → dispose */
export function registerGuard(key, fn) {
  guards.set(key, fn)
  return () => guards.delete(key)
}

// ---------- return stack ----------
// "Back" should mean where you actually came from — the SEO audit, the
// dashboard, a search result — not a hard-coded parent.

const returns = []
export function pushReturn(label, hash) { returns.push({ label, hash }) }
export function popReturn() { return returns.pop() || null }
export function peekReturn() { return returns[returns.length - 1] || null }

const CONCEPT_ICONS = { page: 'page', post: 'pen', product: 'tag', project: 'folder', doc: 'book' }
export function conceptIcon(c) { return (c.icon && /^[a-zA-Z-]+$/.test(c.icon) ? c.icon : null) || CONCEPT_ICONS[c.name] || 'page' }

/** Re-fetch site metadata and repaint the nav — call after anything that changes concepts/plugins/site. */
export async function refreshMeta() {
  const { get } = await import('./api.js')
  state.meta = await get('/meta')
  hooks.paintNav?.()
  hooks.invalidateSearch?.()
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

/** Per-person disclosure state, so "I always want this open" sticks. */
export function disclosure(key, dflt = false) {
  const d = prefs().disclosure || {}
  return key in d ? d[key] : dflt
}
export function setDisclosure(key, open) {
  const d = { ...(prefs().disclosure || {}) }
  d[key] = open
  setPref('disclosure', d)
}

// ---------- wide mode ----------
// Wide is a shell state, not an editor one: the same key and the same button
// clear the chrome on every view. Owned here so no view keeps its own copy.
export const wideMode = () => !!prefs().wideMode
export function setWide(on) {
  const app = document.querySelector('.app')
  if (!app) return
  app.classList.toggle('wide', on)
  setPref('wideMode', on)
  document.querySelectorAll('.wide-btn').forEach(b => b.setAttribute('aria-pressed', String(on)))
  // views that scale something to fit need to re-measure once the panels have gone
  dispatchEvent(new CustomEvent('bh:wide', { detail: { on } }))
}
export const toggleWide = force => setWide(force ?? !document.querySelector('.app')?.classList.contains('wide'))
