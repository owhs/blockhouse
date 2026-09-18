// The studio's search contract.
//
// Every addressable thing in the studio is declared here as a row: views,
// settings FIELDS (not just settings groups), and actions. The command palette
// and the topbar search read from this — so nobody has to know which screen
// owns a control in order to reach it.
//
// RULE: add a setting in views.js, add its row here. `assertCatalogue()` runs in
// dev and complains about rows pointing at settings groups that do not exist.

const GROUP_LABELS = {
  general: 'General', features: 'What the site does', brand: 'Brand', appearance: 'Appearance',
  urls: 'URLs & addresses', images: 'Images', mail: 'Mail', code: 'Custom code',
  system: 'System pages', pluginsx: 'App settings', build: 'Publishing & export',
  interface: 'Studio interface', security: 'Security',
}
export function settingsGroupLabel(k) { return GROUP_LABELS[k] || k }

// hash is #/settings/<group>?f=<fieldKey> — the settings view scrolls to and
// flashes that field on arrival, so a search hit lands ON the control.
const S = (group, key, label, keywords) => ({
  kind: 'setting', group: 'Settings', label, sub: GROUP_LABELS[group] || group,
  hash: `#/settings/${group}?f=${key}`, icon: 'gear', keywords, perm: 'settings',
})

export const SETTINGS_ROWS = [
  S('general', 'name', 'Site name', 'title brand company business'),
  S('general', 'url', 'Canonical URL', 'domain address https hostname'),
  S('general', 'tagline', 'Tagline', 'strapline slogan subtitle'),
  S('general', 'language', 'Language code', 'locale lang i18n translation'),
  S('general', 'titlePattern', 'Page title pattern', 'seo browser tab suffix template'),
  S('general', 'description', 'Default meta description', 'seo snippet search'),
  S('general', 'twitter', 'X / Twitter handle', 'social account'),
  S('general', 'image', 'Default share image', 'og opengraph social preview thumbnail card'),

  S('features', 'prefetch', 'Speculative prefetch', 'speed performance preload faster'),
  S('features', 'viewTransitions', 'View transitions', 'animation page transition morph fade'),
  S('features', 'themeToggle', 'Visitor light/dark toggle', 'dark mode switch theme visitor'),
  S('features', 'rss', 'RSS feeds', 'feed atom xml subscribe syndication'),
  S('features', 'sitemap', 'sitemap.xml', 'seo google index crawl robots'),
  S('features', 'analyticsBeacon', 'Analytics beacon', 'stats tracking hits visitors counter'),
  S('features', 'searchOpenSearch', 'OpenSearch', 'browser search engine'),

  S('appearance', 'colorScheme', 'Colour scheme (light / dark)', 'dark light auto mode'),
  S('appearance', 'fonts', 'Fonts', 'typeface typography family webfont custom'),

  S('brand', 'vars', 'Brand variables', 'var tokens phone email address reusable values'),

  S('urls', 'style', 'URL style', 'trailing slash pretty extension html'),
  S('urls', 'layout', 'URL layout', 'permalink pattern structure path'),
  S('urls', 'redirects', 'Redirects', 'redirect 301 old url moved forward alias'),

  S('images', 'provider', 'Image provider', 'sharp cloudflare resize cdn'),
  S('images', 'quality', 'Image quality', 'compression jpeg size'),
  S('images', 'sizes', 'Image sizes', 'responsive srcset widths variants breakpoints'),
  S('images', 'stripExif', 'Strip EXIF metadata', 'exif privacy gps location camera'),
  S('images', 'watermarkMedia', 'Watermark', 'logo overlay stamp'),

  S('mail', 'driver', 'Mail provider', 'email smtp resend sendgrid postmark send'),
  S('mail', 'from', 'From address', 'sender reply'),

  S('code', 'css', 'Global custom CSS', 'stylesheet style override'),
  S('code', 'js', 'Global custom JavaScript', 'script tracking snippet analytics tag'),
  S('code', 'head', 'Head snippet', 'meta verification tag'),

  S('system', 'notFound', '404 page', 'not found missing error'),
  S('system', 'search', 'Search results page', 'results'),

  S('build', 'export', 'Static export', 'dist build flat html deploy'),
  S('build', 'budget', 'Page weight budget', 'weight size performance kb limit'),

  S('interface', 'modules', 'Hide studio sections', 'hide module simplify roles show'),

  S('security', 'studioPath', 'Studio URL path', 'admin url login address'),
  S('security', 'csp', 'Content security policy', 'csp headers policy'),
  S('security', 'pbkdf2Iterations', 'Password hashing strength', 'hash iterations pbkdf2'),
  S('security', 'previewLink', 'Staging preview link', 'staging bypass password protect'),
]

// Things that happen, rather than places you go. `run` is resolved by main.js.
export const ACTION_ROWS = [
  { kind: 'action', run: 'export', label: 'Export static site', sub: 'Build a flat site into dist/', icon: 'rocket', keywords: 'build static dist publish flat', perm: 'settings' },
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
