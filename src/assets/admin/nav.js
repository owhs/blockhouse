// The navigation model.
//
// Three fixed sections named for jobs — Content (things you write), Site (what
// visitors see), Studio (running the place) — plus a personal Pinned section.
// Plugin panels are dispersed into the section matching their job rather than
// dumped in a group named after how they load.
//
// Arrangement (pin, collapse, order, group-by) is personal and lives in
// prefs(); availability stays site-wide in site.json. That split is deliberate:
// an owner deciding what exists is a different decision from a person deciding
// what they want in front of them.

import { state, prefs, setPref, conceptIcon } from './state.js'

const PLUGIN_ICONS = {
  forms: 'form', files: 'download', newsletter: 'mail', automations: 'bolt', data: 'db',
  ai: 'sparkle', search: 'search', analytics: 'chart', integrations: 'plug', members: 'users',
  commerce: 'cart', ops: 'server', backups: 'cloud',
}

// Which job each plugin belongs to. Unknown plugins land in Content, where a
// person is most likely to look for something that holds records.
const PLUGIN_SECTION = {
  search: 'site', analytics: 'site', seo: 'site',
  ops: 'studio', backups: 'studio', integrations: 'studio', automations: 'studio', ai: 'studio',
}

export const SECTIONS = [
  { key: 'content', title: 'Content', hint: 'The things you write and upload' },
  { key: 'site', title: 'Site', hint: 'What visitors see' },
  { key: 'studio', title: 'Studio', hint: 'Running the place' },
]

/** Every nav item the current user may see, already section-tagged. */
export function allItems() {
  const m = state.meta
  if (!m) return []
  const hidden = new Set(m.modules?.hidden || [])
  for (const k of m.modules?.hiddenForRole?.[state.user?.role] || []) hidden.add(k)

  const out = [
    { key: 'dash', section: 'content', icon: 'home', label: 'Dashboard', hash: '#/', tip: 'Everything that needs you today' },
    ...m.concepts.map(c => ({
      key: `c/${c.name}`, section: 'content', icon: conceptIcon(c),
      label: c.labelPlural || c.label, hash: `#/c/${c.name}`,
    })),
    { key: 'media', section: 'content', icon: 'image', label: 'Assets', hash: '#/media', tip: 'Images, files and everything uploaded' },
  ]
  if (m.concepts.length > 1) {
    out.splice(1 + m.concepts.length, 0, {
      key: 'c/all', section: 'content', icon: 'list', label: 'All content',
      hash: '#/c/all', tip: 'Every type in one list — sort, filter and publish in bulk',
    })
  }

  if (m.perms.settings) out.push({ key: 'types', section: 'content', icon: 'layout', label: 'Content types', hash: '#/types', tip: 'Define your own types — products, projects, docs' })
  if (m.perms.menus) out.push({ key: 'menus', section: 'site', icon: 'menu', label: 'Menus', hash: '#/menus', tip: 'Navigation, with a live preview' })
  if (m.perms.settings) out.push({ key: 'chrome', section: 'site', icon: 'layout', label: 'Header & footer', hash: '#/chrome', tip: 'The content around every page' })
  if (m.perms.settings) out.push({ key: 'design', section: 'site', icon: 'palette', label: 'Design', hash: '#/design', tip: 'Template, palette and scheme — previewed live' })
  if (m.perms.settings) out.push({ key: 'tpl', section: 'site', icon: 'code', label: 'Templates', hash: '#/tpl', tip: 'The markup, as safe overrides' })
  if (m.perms.seo) out.push({ key: 'seo', section: 'site', icon: 'compass', label: 'SEO & redirects', hash: '#/seo', tip: 'Audit, feeds and redirects' })

  for (const p of m.panels || []) {
    const section = PLUGIN_SECTION[p.plugin] || 'content'
    out.push({
      key: `p/${p.key}`, section,
      icon: PLUGIN_ICONS[p.plugin] || p.icon || 'plug', label: p.label, hash: `#/p/${p.key}`,
      // say where it came from, so an app sitting in Content is explained
      // rather than merely placed
      tip: `From the ${p.plugin} app · filed under ${SECTIONS.find(x => x.key === section)?.title || section}`,
      plugin: p.plugin,
    })
  }

  if (m.perms.users) out.push({ key: 'users', section: 'studio', icon: 'users', label: 'People', hash: '#/users', tip: 'Who can sign in, and what they may do' })
  if (m.perms.audit) out.push({ key: 'audit', section: 'studio', icon: 'table', label: 'Audit log', hash: '#/audit' })
  if (m.perms.plugins) out.push({ key: 'plugins', section: 'studio', icon: 'plug', label: 'Apps & permissions', hash: '#/plugins' })
  out.push({ key: 'deploy', section: 'studio', icon: 'rocket', label: 'Deploy', hash: '#/deploy' })
  if (m.perms.settings) out.push({ key: 'settings', section: 'studio', icon: 'gear', label: 'Settings', hash: '#/settings' })
  out.push({ key: 'help', section: 'studio', icon: 'book', label: 'Help', hash: '#/help' })

  return out.filter(it => !hidden.has(it.key) && !hidden.has(it.key.split('/')[1] || ''))
}

// ---------- personal arrangement ----------

export const pinned = () => prefs().pinned || []
export function togglePin(key) {
  const p = pinned()
  setPref('pinned', p.includes(key) ? p.filter(k => k !== key) : [...p, key])
}
export const isPinned = key => pinned().includes(key)

// Content is the daily job, so it opens. Site and Studio are mostly settings
// you visit occasionally — they stay shut until asked for. Measured before
// this: 27 rail items, overflowing a 900px-tall window by 230px, which made
// the primary navigation something you had to scroll to read.
// An explicit choice always wins and is remembered forever after.
const DEFAULT_CLOSED = { site: true, studio: true }
export const collapsed = () => ({ ...DEFAULT_CLOSED, ...(prefs().navCollapsed || {}) })
export function toggleSection(key) {
  const c = { ...collapsed() }
  c[key] = !c[key]
  setPref('navCollapsed', c)
}

export const groupBy = () => prefs().navGroupBy || 'section'
export const setGroupBy = v => setPref('navGroupBy', v)

/** Remember what was visited, so "Recent" is real rather than a guess. */
export function noteVisit(key) {
  if (!key) return
  const r = [key, ...(prefs().recentNav || []).filter(k => k !== key)].slice(0, 8)
  setPref('recentNav', r)
}

/**
 * The painted navigation: [{ key, title, hint, items, collapsible }].
 * Pinned always leads and never collapses — it is the section a person built.
 */
export function navGroups() {
  const items = allItems()
  const byKey = Object.fromEntries(items.map(i => [i.key, i]))
  const pins = pinned().map(k => byKey[k]).filter(Boolean)
  const pinSet = new Set(pins.map(i => i.key))
  const rest = items.filter(i => !pinSet.has(i.key))

  const groups = []
  if (pins.length) groups.push({ key: 'pinned', title: 'Pinned', hint: 'Yours — drag or right-click any item to change', items: pins })

  const mode = groupBy()
  if (mode === 'az') {
    groups.push({ key: 'az', title: 'All, A–Z', items: [...rest].sort((a, b) => a.label.localeCompare(b.label)), collapsible: true })
  } else if (mode === 'recent') {
    const order = prefs().recentNav || []
    const seen = new Set(order)
    groups.push({ key: 'recent', title: 'Recently used', items: order.map(k => byKey[k]).filter(Boolean).filter(i => !pinSet.has(i.key)), collapsible: true })
    groups.push({ key: 'rest', title: 'Everything else', items: rest.filter(i => !seen.has(i.key)), collapsible: true })
  } else {
    for (const s of SECTIONS) {
      const list = rest.filter(i => i.section === s.key)
      if (list.length) groups.push({ ...s, items: list, collapsible: true })
    }
  }
  return groups.filter(g => g.items.length)
}
