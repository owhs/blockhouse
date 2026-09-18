// Blockhouse Studio shell: auth flow, grouped sidebar navigation (labels visible,
// collapsible to an icon rail with ⌘B), command palette, personalization.

import { get, post } from './api.js'
import { h, palette, toast, dialog } from './ui.js'
import { icon, iconEl } from './icons.js'
import { state, VIEWS, prefs, setPref, hooks, conceptIcon } from './state.js'
// view modules register themselves into VIEWS as a side effect
import './views.js'
import './editor.js'
import './menus.js'
import './data.js'
import './assets.js'
import './seo.js'
import './help.js'
import './deploy.js'
import './audit.js'
import './concepts.js'
import './design.js'
import './templates.js'
import './chrome.js'

export { state, prefs, setPref } from './state.js'

const app = document.getElementById('app')

// apply saved personalization before first paint
const P = prefs()
if (P.palette) document.documentElement.dataset.palette = P.palette
if (P.density) document.documentElement.dataset.density = P.density
try {
  const savedTheme = localStorage.getItem('blockhouse-studio-theme')
  if (savedTheme) document.documentElement.dataset.theme = savedTheme
} catch {}

const PLUGIN_ICONS = { forms: 'form', files: 'download', newsletter: 'mail', automations: 'bolt', data: 'db', ai: 'sparkle', search: 'search', analytics: 'chart', integrations: 'plug', members: 'users' }

// ---------- boot ----------

async function boot() {
  const me = await get('/auth/me').catch(() => ({ user: null, needsBootstrap: false }))
  if (me.needsBootstrap) return renderAuth('bootstrap')
  if (!me.user) return renderAuth('login')
  state.user = me.user
  state.meta = await get('/meta')
  renderShell()
  route()
}

function renderAuth(kind) {
  // reset link from a "forgot password" email → #/reset/<token>
  const resetToken = /^#\/reset\//.test(location.hash) ? location.hash.slice('#/reset/'.length) : null
  if (resetToken) return renderReset(resetToken)

  const isBoot = kind === 'bootstrap'
  const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' })
  const name = h('input', { type: 'text', placeholder: 'Your name' })
  const pass = h('input', { type: 'password', placeholder: isBoot ? 'Choose a password (8+ chars)' : 'Password', autocomplete: isBoot ? 'new-password' : 'current-password' })
  const btn = h('button.btn.primary', { type: 'submit', style: { justifyContent: 'center' } }, isBoot ? 'Create owner account' : 'Sign in')
  const note = h('p.sub', { style: { minHeight: '1em' } })
  const form = h('form.login-card', {
    onsubmit: async e => {
      e.preventDefault()
      btn.disabled = true
      try {
        await post(isBoot ? '/auth/bootstrap' : '/auth/login',
          isBoot ? { email: email.value, name: name.value, password: pass.value } : { email: email.value, password: pass.value })
        location.reload()
      } catch { btn.disabled = false }
    },
  },
    h('div.login-mark', {}, 'W'),
    h('h1', {}, isBoot ? 'Welcome to Blockhouse' : 'Blockhouse Studio'),
    h('p.sub', {}, isBoot ? 'Set up the owner account for this site.' : 'Sign in to continue.'),
    fieldWrap('Email', email), isBoot ? fieldWrap('Name', name) : '', fieldWrap('Password', pass), btn,
    isBoot ? '' : h('button', {
      type: 'button',
      style: { fontSize: '0.78rem', color: 'var(--mut)', justifySelf: 'center' },
      onclick: async () => {
        if (!email.value) { note.textContent = 'Type your email above first.'; return }
        const r = await post('/auth/forgot', { email: email.value }).catch(() => ({}))
        note.textContent = r.message || 'If that address has an account, a reset link is on its way.'
      },
    }, 'Forgot password?'),
    note)
  app.replaceChildren(h('div.login-wrap', {}, form))
  email.focus()
}

function renderReset(token) {
  const pass = h('input', { type: 'password', placeholder: 'New password (8+ chars)', autocomplete: 'new-password' })
  const btn = h('button.btn.primary', { type: 'submit', style: { justifyContent: 'center' } }, 'Set new password')
  const note = h('p.sub', { style: { minHeight: '1em' } })
  const form = h('form.login-card', {
    onsubmit: async e => {
      e.preventDefault()
      btn.disabled = true
      try {
        await post('/auth/reset', { token, password: pass.value })
        location.hash = '#/'
        location.reload()
      } catch (err) { note.textContent = err.message || 'That link did not work.'; btn.disabled = false }
    },
  },
    h('div.login-mark', {}, 'W'),
    h('h1', {}, 'Choose a new password'),
    h('p.sub', {}, 'The reset link works once, then you are signed straight in.'),
    fieldWrap('New password', pass), btn, note)
  app.replaceChildren(h('div.login-wrap', {}, form))
  pass.focus()
}
function fieldWrap(label, input) { return h('div.field', {}, h('label', {}, label), input) }

// ---------- navigation model ----------

function navGroups() {
  const m = state.meta
  const hidden = new Set(m.modules?.hidden || [])
  for (const k of (m.modules?.hiddenForRole?.[state.user?.role] || [])) hidden.add(k)
  const show = it => !hidden.has(it.key) && !hidden.has(it.key.split('/')[1] || '')

  const content = [
    { key: 'dash', icon: 'home', label: 'Dashboard', hash: '#/' },
    ...m.concepts.map(c => ({ key: `c/${c.name}`, icon: conceptIcon(c), label: c.labelPlural || c.label, hash: `#/c/${c.name}` })),
    ...(m.perms.settings ? [{ key: 'types', icon: 'plus', label: 'New content type', hash: '#/types', ghost: true, tip: 'Define your own types — products, projects, docs, anything' }] : []),
    { key: 'media', icon: 'image', label: 'Assets', hash: '#/media' },
  ]
  const site = []
  if (m.perms.menus) site.push({ key: 'menus', icon: 'menu', label: 'Menus', hash: '#/menus' })
  if (m.perms.settings) site.push({ key: 'chrome', icon: 'layout', label: 'Header & footer', hash: '#/chrome', tip: 'The content around every page — announcement bar, footer rows' })
  if (m.perms.settings) site.push({ key: 'design', icon: 'palette', label: 'Design', hash: '#/design' })
  if (m.perms.settings) site.push({ key: 'tpl', icon: 'code', label: 'Templates', hash: '#/tpl' })
  if (m.perms.seo) site.push({ key: 'seo', icon: 'compass', label: 'SEO', hash: '#/seo' })
  const plugins = m.panels.map(p => ({ key: `p/${p.key}`, icon: PLUGIN_ICONS[p.plugin] || p.icon || 'plug', label: p.label, hash: `#/p/${p.key}` }))
  const admin = []
  if (m.perms.users) admin.push({ key: 'users', icon: 'users', label: 'Users', hash: '#/users' })
  if (m.perms.audit) admin.push({ key: 'audit', icon: 'table', label: 'Audit log', hash: '#/audit' })
  if (m.perms.plugins) admin.push({ key: 'plugins', icon: 'plug', label: 'Plugins', hash: '#/plugins' })
  admin.push({ key: 'deploy', icon: 'rocket', label: 'Deploy', hash: '#/deploy' })
  if (m.perms.settings) admin.push({ key: 'settings', icon: 'gear', label: 'Settings', hash: '#/settings' })
  admin.push({ key: 'help', icon: 'book', label: 'Help', hash: '#/help' })

  return [
    { title: 'Content', items: content.filter(show) },
    { title: 'Site', items: site.filter(show) },
    { title: 'Plugins', items: plugins.filter(show) },
    { title: 'Admin', items: admin.filter(show) },
  ].filter(g => g.items.length)
}

// ---------- shell ----------

let currentCleanup = null
let viewEl = null
let paintNav = null

function renderShell() {
  const m = state.meta
  const side = h('nav.side', { 'aria-label': 'Studio' })
  const ribbon = h('nav.ribbon', { 'aria-label': 'Studio' })

  const isActive = it => {
    const hash = location.hash || '#/'
    if (it.hash === '#/') return hash === '#/' || hash === ''
    return hash === it.hash || hash.startsWith(it.hash + '/')
  }

  const collapsed = () => document.querySelector('.app')?.classList.contains('side-collapsed')
  const setCollapsed = (on, persist = true) => {
    document.querySelector('.app')?.classList.toggle('side-collapsed', on)
    if (persist) setPref('sideCollapsed', on)
    paintNav()
  }

  paintNav = () => {
    const groups = navGroups()
    side.replaceChildren(
      ...groups.flatMap(g => [
        h('div.side-title', {}, h('span', {}, g.title)),
        ...g.items.map(it => h('button.side-item', {
          class: [isActive(it) ? 'active' : '', it.ghost ? 'ghost' : ''].filter(Boolean).join(' '),
          onclick: () => (location.hash = it.hash),
        },
          iconEl(it.icon, 17),
          h('span.side-label', {}, it.label),
          h('span.tip', {}, it.tip || it.label))),
      ]),
      h('div.side-foot', {},
        h('button.side-item', { onclick: () => setCollapsed(!collapsed()), title: 'Toggle sidebar  ⌘B' },
          iconEl(collapsed() ? 'panel-open' : 'panel-close', 17),
          h('span.side-label', {}, 'Collapse'),
          h('span.tip', {}, 'Expand sidebar  ⌘B'))))

    // ribbon layout: a compact menubar — one dropdown per group, no scrolling
    ribbon.replaceChildren(...groups.map(g => {
      const open = h('div.mbar-drop', {},
        ...g.items.map(it => h('button.mbar-item', {
          class: isActive(it) ? 'active' : '',
          onclick: () => (location.hash = it.hash),
        }, iconEl(it.icon, 15), it.label)))
      const activeInGroup = g.items.some(isActive)
      return h('div.mbar-group', { class: activeInGroup ? 'active' : '' },
        h('button.mbar-btn', {}, g.title, iconEl('chevD', 11)),
        open)
    }))
  }

  viewEl = h('div.view')
  const shell = h('div.app', {
    class: [prefs().layout === 'ribbon' ? 'layout-ribbon' : '', prefs().sideCollapsed ? 'side-collapsed' : ''].filter(Boolean).join(' '),
  },
    h('header.topbar', {},
      h('div.top-brand', {}, h('span.mark', {}, 'W'), 'Studio',
        h('button.top-site.site-switch', { title: 'Switch site', onclick: openSiteSwitcher }, '· ', m.site.name, iconEl('chevD', 10))),
      h('div.top-mid', {},
        h('button.searchish', { onclick: openPalette }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem' } }, iconEl('search', 14), 'Search & commands'), h('span.kbd', {}, '⌘K'))),
      h('div.top-end', {},
        h('a.btn.ghost.small', { href: '/', target: '_blank', style: { display: 'inline-flex', gap: '0.4rem' } }, 'View site', iconEl('external', 13)),
        h('button.icon-btn', { title: 'Personalize studio', onclick: personalize }, iconEl('palette', 16)),
        h('button.icon-btn', { title: 'Toggle studio theme', onclick: toggleTheme }, iconEl('contrast', 16)),
        h('button.icon-btn', { title: `Signed in as ${state.user.email} — sign out`, onclick: async () => { await post('/auth/logout'); location.reload() } }, iconEl('power', 16)))),
    side, ribbon, viewEl)

  app.replaceChildren(shell)
  hooks.paintNav = paintNav
  addEventListener('hashchange', () => { paintNav(); route() })
  paintNav()

  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette() }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setCollapsed(!collapsed()) }
  })
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const next = cur === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('blockhouse-studio-theme', next) } catch {}
}

function personalize() {
  const PALETTES = [
    { key: 'evergreen', label: 'Evergreen', color: 'oklch(50% 0.085 162)' },
    { key: 'graphite', label: 'Graphite', color: 'oklch(38% 0.01 260)' },
    { key: 'copper', label: 'Copper', color: 'oklch(56% 0.11 55)' },
    { key: 'claret', label: 'Claret', color: 'oklch(50% 0.13 15)' },
    { key: 'indigo', label: 'Indigo', color: 'oklch(56% 0.17 280)' },
  ]
  const cur = () => document.documentElement.dataset.palette || 'evergreen'
  const swatches = h('div.swatches', {}, ...PALETTES.map(p =>
    h('button.swatch', {
      class: cur() === p.key ? 'active' : '', title: p.label, style: { background: p.color },
      onclick: e => {
        document.documentElement.dataset.palette = p.key
        setPref('palette', p.key)
        swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'))
        e.currentTarget.classList.add('active')
      },
    }, cur() === p.key ? '✓' : '')))

  const segOf = (label, options, get2, set2) => {
    const seg = h('div.seg', {}, ...options.map(([k, l]) =>
      h('button', { class: get2() === k ? 'active' : '', onclick: e => { set2(k); seg.querySelectorAll('button').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active') } }, l)))
    return h('div.field', {}, h('label', {}, label), seg)
  }
  dialog({
    title: 'Personalize the studio',
    body: h('div', {},
      h('div.field', {}, h('label', {}, 'Accent palette'), swatches),
      segOf('Navigation layout', [['side', 'Sidebar'], ['ribbon', 'Top ribbon']],
        () => (prefs().layout === 'ribbon' ? 'ribbon' : 'side'),
        k => { setPref('layout', k); document.querySelector('.app')?.classList.toggle('layout-ribbon', k === 'ribbon') }),
      segOf('Density', [['comfortable', 'Comfortable'], ['compact', 'Compact']],
        () => prefs().density || 'comfortable',
        k => { setPref('density', k); if (k === 'compact') document.documentElement.dataset.density = 'compact'; else delete document.documentElement.dataset.density }),
      h('p.dlg-text', { style: { marginTop: '0.4rem' } }, 'These preferences are per-browser, per-person — they never affect the site itself. ⌘B collapses the sidebar to icons.')),
  })
}

async function openSiteSwitcher() {
  const { projects } = await get('/projects').catch(() => ({ projects: [] }))
  const body = h('div', {},
    projects.length
      ? h('div', { style: { display: 'grid', gap: '0.25rem' } }, ...projects.map(p =>
        h('a.row-item', { href: p.current ? '#/' : p.url + '/admin/', style: { textDecoration: 'none' } },
          h('span.row-ico', { html: icon(p.current ? 'check' : 'globe', 15) }),
          h('span.row-label', {}, p.label),
          h('span.fnt', { style: { fontSize: '0.72rem', marginLeft: 'auto' } }, p.current ? 'current' : p.url))))
      : h('p.dlg-text', {}, 'No other sites registered on this machine yet.'),
    h('p.fnt', { style: { fontSize: '0.76rem', marginTop: '0.8rem' } },
      'Register each project once: ', h('code.pill-perm', {}, 'blockhouse sites add --dir <site> --port <port>'),
      ' — every studio then lists them all here.'))
  dialog({ title: 'Your sites', body })
}

// ---------- router ----------

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/'
  const [, name, ...rest] = hash.split('/')
  currentCleanup?.()
  currentCleanup = null
  viewEl.replaceChildren(h('div.spin'))
  const table = {
    '': 'dashboard', c: 'contentList', e: 'editor', media: 'media', menus: 'menus', seo: 'seo',
    users: 'users', settings: 'settings', plugins: 'plugins', p: 'pluginPanel', help: 'help', deploy: 'deploy', audit: 'audit',
    types: 'concepts', design: 'design', tpl: 'templates', chrome: 'chrome',
  }
  const view = VIEWS[table[name] ?? 'dashboard'] || VIEWS.dashboard
  try {
    currentCleanup = (await view(viewEl, rest.map(decodeURIComponent))) || null
  } catch (e) {
    console.error(e)
    viewEl.replaceChildren(h('div.empty', {}, h('div.empty-ico', {}, iconEl('warn', 28)), h('h3', {}, 'This view failed to load'), h('p', {}, String(e.message || e))))
  }
}

// ---------- command palette ----------

function openPalette() {
  const m = state.meta
  palette(() => [
    { icon: icon('home', 15), label: 'Go to dashboard', onRun: () => (location.hash = '#/') },
    ...m.concepts.flatMap(c => [
      { icon: icon(conceptIcon(c), 15), label: `Browse ${c.labelPlural || c.label}`, onRun: () => (location.hash = `#/c/${c.name}`) },
      { icon: icon('plus', 15), label: `New ${c.label}`, onRun: () => VIEWS.newDoc?.(viewEl, [c.name]) },
    ]),
    ...(m.perms.settings ? [{ icon: icon('layout', 15), label: 'Content types — create or edit', onRun: () => (location.hash = '#/types') }] : []),
    { icon: icon('image', 15), label: 'Open asset library', onRun: () => (location.hash = '#/media') },
    ...(m.perms.menus ? [{ icon: icon('menu', 15), label: 'Edit menus (live preview)', onRun: () => (location.hash = '#/menus') }] : []),
    ...(m.perms.settings ? [{ icon: icon('palette', 15), label: 'Design — template, palette, fonts', onRun: () => (location.hash = '#/design') }] : []),
    ...(m.perms.settings ? [{ icon: icon('code', 15), label: 'Edit template files (safe overrides)', onRun: () => (location.hash = '#/tpl') }] : []),
    ...(m.perms.seo ? [{ icon: icon('compass', 15), label: 'SEO audit & redirects', onRun: () => (location.hash = '#/seo') }] : []),
    ...m.panels.map(p => ({ icon: icon(PLUGIN_ICONS[p.plugin] || 'plug', 15), label: `Open ${p.label}`, onRun: () => (location.hash = `#/p/${p.key}`) })),
    ...(m.perms.users ? [{ icon: icon('users', 15), label: 'Manage users', onRun: () => (location.hash = '#/users') }] : []),
    ...(m.perms.settings ? [{ icon: icon('gear', 15), label: 'Site settings', onRun: () => (location.hash = '#/settings') }] : []),
    ...(m.perms.plugins ? [{ icon: icon('plug', 15), label: 'Plugins & permissions', onRun: () => (location.hash = '#/plugins') }] : []),
    { icon: icon('book', 15), label: 'Open help for this site', onRun: () => (location.hash = '#/help') },
    { icon: icon('rocket', 15), label: 'Deploy — health checks and page weight', onRun: () => (location.hash = '#/deploy') },
    { icon: icon('palette', 15), label: 'Personalize studio (palette, layout, density)', onRun: personalize },
    { icon: icon('contrast', 15), label: 'Toggle studio theme', onRun: toggleTheme },
    { icon: icon('external', 15), label: 'View live site', onRun: () => window.open('/', '_blank') },
    ...(m.perms.settings ? [{
      icon: icon('rocket', 15), label: 'Export static site', onRun: async () => {
        toast('Exporting…')
        const r = await post('/export')
        toast(`Exported ${r.pages} pages → ${r.outDir}`, 'ok', 5000)
      },
    }] : []),
  ])
}

boot()
