// The studio's search contract.
//
// Every addressable thing in the studio is declared here as a row: views,
// settings FIELDS (not just settings groups), and actions. The command palette
// and the topbar search read from this — so nobody has to know which screen
// owns a control in order to reach it.
//
// RULE: settings rows are derived from settings.js, never typed out here.
// `assertCatalogue()` runs in dev and complains if one points at a settings
// group that does not exist.

import { settingsIndex } from './settings.js'

const GROUP_LABELS = {
  site: 'Site', content: 'Content', email: 'Email',
  apps: 'Apps', advanced: 'Advanced', security: 'Security & access',
}
export function settingsGroupLabel(k) { return GROUP_LABELS[k] || k }

// hash is #/settings/<group>?f=<label> - the settings view scrolls to and
// flashes the control whose label matches, so a search hit lands ON the
// control rather than at the top of the page it lives on.
//
// The rows are BUILT from the settings page's own field definitions
// (settings.js exports settingsIndex()). Nobody maintains a second list, so a
// new setting is searchable the moment it exists.
const toRow = f => ({
  kind: 'setting', group: 'Settings', label: f.label, sub: settingsGroupLabel(f.group),
  hash: `#/settings/${f.group}?f=${encodeURIComponent(f.label)}`, icon: 'gear',
  keywords: [f.keywords, f.help].filter(Boolean).join(' ').toLowerCase(),
  perm: 'settings',
})

// Built on first use, not at import time: settings.js imports this module too,
// and asking it for its fields while it is still being evaluated would read a
// half-built module. Search only ever looks at these once somebody types.
let built = null
/**
 * Developer-only settings stay out of search. On the Settings page they sit
 * under "Technical security (for developers)" with that warning around them;
 * a bare "Send HSTS" row in ⌘K has no such frame, so a site owner meets a
 * header directive with no idea what it is. Every one of them is tagged
 * `technical` in its own keyword list, which is where the flag comes from.
 */
const isDeveloperOnly = f => f.developer === true || /(^| )technical( |$)/.test(String(f.keywords || ''))
const rows = () => (built ??= settingsIndex().filter(f => !isDeveloperOnly(f)).map(toRow))

export const SETTINGS_ROWS = new Proxy([], {
  get: (_t, prop) => Reflect.get(rows(), prop),
  has: (_t, prop) => Reflect.has(rows(), prop),
  ownKeys: () => Reflect.ownKeys(rows()),
  getOwnPropertyDescriptor: (_t, prop) => Reflect.getOwnPropertyDescriptor(rows(), prop),
})

// Things that happen, rather than places you go. `run` is resolved by main.js.
export const ACTION_ROWS = [
  { kind: 'action', run: 'export', label: 'Export static site', sub: 'Save a plain copy of the whole website to a folder', icon: 'rocket', keywords: 'build static dist publish flat', perm: 'settings' },
  { kind: 'action', run: 'viewSite', label: 'View the live site', sub: 'Opens in a new tab', icon: 'external', keywords: 'visit open public preview' },
  { kind: 'action', run: 'switchSite', label: 'Switch site', sub: 'Other projects on this machine', icon: 'globe', keywords: 'project change another' },
  { kind: 'action', run: 'personalize', label: 'Personalise the studio', sub: 'Accent, layout, density', icon: 'palette', keywords: 'customise accent colour layout density theme' },
  { kind: 'action', run: 'toggleTheme', label: 'Toggle studio light / dark', sub: 'The studio only, never the site', icon: 'contrast', keywords: 'dark light night mode' },
  { kind: 'action', run: 'shortcuts', label: 'Keyboard shortcuts', sub: 'Every binding in the studio', icon: 'help', keywords: 'keys bindings hotkeys cheatsheet help' },
  { kind: 'action', run: 'signOut', label: 'Sign out', sub: '', icon: 'power', keywords: 'logout log off leave' },
]

// What people call things, mapped onto what the studio calls them.
export const ALIASES = {
  colour: 'palette design accent', color: 'palette design accent',
  nav: 'menus navigation', navigation: 'menus',
  media: 'assets images files uploads', picture: 'assets images',
  footer: 'header footer chrome', header: 'header footer chrome',
  theme: 'design template', style: 'design',
  blog: 'posts', article: 'post', news: 'posts',
  permalink: 'urls addresses', slug: 'urls addresses',
  people: 'users members', account: 'users',
  backup: 'ops deploy', git: 'ops',
}

/** Dev-only: catch catalogue rows that point at settings groups which vanished. */
export function assertCatalogue(realGroupKeys) {
  const known = new Set(realGroupKeys)
  const bad = [...new Set(SETTINGS_ROWS
    .map(r => r.hash.split('/')[2].split('?')[0])
    .filter(g => !known.has(g)))]
  if (bad.length) console.warn('[studio] catalog.js points at missing settings groups:', bad)
}
