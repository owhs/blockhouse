// The navigation model.
//
// Three fixed sections named for jobs — Content (the pages and things you
// write), Site (how the site looks and what visitors see), Manage (people,
// apps, settings and publishing) — plus a personal Pinned section.
// Plugin panels are dispersed into the section matching their job rather than
// dumped in a group named after how they load.
//
// Arrangement (pin, collapse, order) is personal and lives in prefs();
// availability stays site-wide in site.json. That split is deliberate:
// an owner deciding what exists is a different decision from a person deciding
// what they want in front of them.

import { state, prefs, setPref, conceptIcon } from './state.js'

const PLUGIN_ICONS = {
  forms: 'form', files: 'download', newsletter: 'mail', automations: 'bolt', data: 'db',
  ai: 'sparkle', search: 'search', analytics: 'chart', integrations: 'plug', members: 'users',
  commerce: 'cart', ops: 'server', backups: 'cloud',
}

// Where each app's panel goes when it does not say for itself. An app that
// keeps its own records — form entries, subscribers, members, orders, files —
// is something you work on daily, so it sits with Content. Search and analytics
// are part of what visitors get, so they sit with Site. Everything else is part
// of running the place. A panel may carry its own `section` and that wins, so
// this table is only the default.
const PLUGIN_SECTION = {
  forms: 'content', newsletter: 'content', members: 'content', commerce: 'content',
  data: 'content', drive: 'content', files: 'content',
  search: 'site', analytics: 'site', seo: 'site',
}
const PLUGIN_FALLBACK_SECTION = 'manage'
const SECTION_KEYS = new Set(['content', 'site', 'manage'])

export const SECTIONS = [
  { key: 'content', title: 'Content', hint: 'The pages and things you write' },
  { key: 'site', title: 'Site', hint: 'How the site looks and what visitors see' },
  { key: 'manage', title: 'Manage', hint: 'People, apps, settings and publishing' },
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

  if (m.perms.settings) out.push({ key: 'design', section: 'site', icon: 'palette', label: 'Design', hash: '#/design', tip: 'Colours, fonts and the look of every page' })
  if (m.perms.menus) out.push({ key: 'menus', section: 'site', icon: 'menu', label: 'Navigation', hash: '#/menus', tip: 'The menus visitors use to get around' })
  if (m.perms.settings) out.push({ key: 'chrome', section: 'site', icon: 'layout', label: 'Header & footer', hash: '#/chrome', tip: 'The content that appears around every page' })
  if (m.perms.seo) out.push({ key: 'seo', section: 'site', icon: 'compass', label: 'SEO', hash: '#/seo', tip: 'How the site appears in search results, plus redirects' })

  for (const p of m.panels || []) {
    // A panel that is only settings belongs under Settings → Apps, not in the
    // rail: nobody wants a whole page for one card of options (WP-9).
    if (p.settingsOnly) continue
    // the app may file itself; the table is only what we do when it does not
    const section = (SECTION_KEYS.has(p.section) && p.section) || PLUGIN_SECTION[p.plugin] || PLUGIN_FALLBACK_SECTION
    out.push({
      key: `p/${p.key}`, section,
      icon: PLUGIN_ICONS[p.plugin] || p.icon || 'plug', label: p.label, hash: `#/p/${p.key}`,
      tip: `From the ${p.plugin} app`,
      plugin: p.plugin,
    })
  }

  if (m.perms.users) out.push({ key: 'users', section: 'manage', icon: 'users', label: 'People', hash: '#/users', tip: 'Who can sign in, and what they may do' })
  if (m.perms.plugins) out.push({ key: 'plugins', section: 'manage', icon: 'plug', label: 'Apps', hash: '#/plugins', tip: 'Extras you can switch on, and who may use them' })
  if (m.perms.settings) out.push({ key: 'settings', section: 'manage', icon: 'gear', label: 'Settings', hash: '#/settings', tip: 'Site name, address, content types and everything else' })
  out.push({ key: 'deploy', section: 'manage', icon: 'rocket', label: 'Deploy', hash: '#/deploy', tip: 'Put your changes on the live website' })
  if (m.perms.audit) out.push({ key: 'audit', section: 'manage', icon: 'table', label: 'Activity', hash: '#/audit', tip: 'Who changed what, and when' })
  if (m.perms.settings) out.push({ key: 'tpl', section: 'manage', icon: 'code', label: 'Template code', hash: '#/tpl', tip: 'For developers — the site’s page templates' })
  out.push({ key: 'help', section: 'manage', icon: 'book', label: 'Help', hash: '#/help', tip: 'How to do things in the studio' })

  return out.filter(it => !hidden.has(it.key) && !hidden.has(it.key.split('/')[1] || ''))
}

/**
 * Places that are real but do not deserve a permanent rail row. They still have
 * to be findable, so search offers them. Content types lives under Settings.
 */
export function searchOnlyItems() {
  if (!state.meta?.perms?.settings) return []
  return [{
    key: 'types', section: 'manage', icon: 'layout', label: 'Content types',
    hash: '#/types', tip: 'The kinds of thing your site holds — in Settings',
  }]
}

// ---------- personal arrangement ----------

export const pinned = () => prefs().pinned || []
export function togglePin(key) {
  const p = pinned()
  setPref('pinned', p.includes(key) ? p.filter(k => k !== key) : [...p, key])
}
export const isPinned = key => pinned().includes(key)

// Three sections, all open. A closed section hides the thing you were looking
// for and says nothing about what is behind it, so shutting one is a choice a
// person makes, never the state they are handed. An explicit choice wins and is
// remembered forever after.
export const collapsed = () => ({ ...(prefs().navCollapsed || {}) })
export function toggleSection(key) {
  const c = { ...collapsed() }
  c[key] = !c[key]
  setPref('navCollapsed', c)
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
  if (pins.length) groups.push({ key: 'pinned', title: 'Pinned', hint: 'Yours — right-click any item to change', items: pins })

  for (const s of SECTIONS) {
    const list = rest.filter(i => i.section === s.key)
    if (list.length) groups.push({ ...s, items: list, collapsible: true })
  }
  return groups.filter(g => g.items.length)
}
