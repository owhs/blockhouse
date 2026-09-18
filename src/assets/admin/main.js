// Blockhouse Studio shell: auth, the navigation workspace, the router, and the
// one search that reaches everything.

import { get, post } from './api.js'
import { h, toast, dialog, spinner, contextMenu } from './ui.js'
import { icon, iconEl } from './icons.js'
import { state, VIEWS, prefs, setPref, hooks, guards, pushReturn, popReturn } from './state.js'
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
import { navGroups, allItems, togglePin, isPinned, toggleSection, collapsed, groupBy, setGroupBy, noteVisit } from './nav.js'
import { openSearch, invalidateSearch } from './search.js'
import { closeSheet } from './sheet.js'

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
  const resetToken = /^#\/reset\//.test(location.hash) ? location.hash.slice('#/reset/'.length) : null
  if (resetToken) return renderReset(resetToken)

  const isBoot = kind === 'bootstrap'
  const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' })
  const name = h('input', { type: 'text', placeholder: 'Your name' })
  const pass = h('input', { type: 'password', placeholder: isBoot ? 'Choose a password (8+ chars)' : 'Password', autocomplete: isBoot ? 'new-password' : 'current-password' })
  const btn = h('button.btn.primary', { type: 'submit', style: { justifyContent: 'center' } }, isBoot ? 'Create owner account' : 'Sign in')
  const note = h('p.sub', { role: 'status', 'aria-live': 'polite', style: { minHeight: '1em' } })
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
    h('div.login-mark', {}, 'B'),
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
  const note = h('p.sub', { role: 'status', 'aria-live': 'polite', style: { minHeight: '1em' } })
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
    h('div.login-mark', {}, 'B'),
    h('h1', {}, 'Choose a new password'),
    h('p.sub', {}, 'The reset link works once, then you are signed straight in.'),
    fieldWrap('New password', pass), btn, note)
  app.replaceChildren(h('div.login-wrap', {}, form))
  pass.focus()
}
function fieldWrap(label, input) { return h('div.field', {}, h('label', {}, label), input) }

// ---------- shell ----------

let currentCleanup = null
let viewEl = null
let paintNav = null
let shellEl = null

/** Counts that make the rail informative rather than decorative. */
let counts = {}
async function refreshCounts() {
  try {
    const { docs } = await get('/content')
    const next = {}
    for (const d of docs) {
      if (d.stale) next[`c/${d.concept}`] = (next[`c/${d.concept}`] || 0) + 1
    }
    counts = next
    paintNav?.()
  } catch {}
}

function renderShell() {
  const m = state.meta

  const side = h('nav.side', { 'aria-label': 'Primary' })
  const ribbon = h('nav.ribbon', { 'aria-label': 'Primary (ribbon)' })

  const isActive = it => {
    const hash = (location.hash || '#/').split('?')[0]
    if (it.hash === '#/') return hash === '#/' || hash === ''
    const base = it.hash.split('?')[0]
    return hash === base || hash.startsWith(base + '/')
  }

  const collapsedSide = () => shellEl?.classList.contains('side-collapsed')
  const setCollapsed = (on, persist = true) => {
    shellEl?.classList.toggle('side-collapsed', on)
    if (persist) setPref('sideCollapsed', on)
    paintNav()
  }

  const itemMenu = (e, it) => {
    e.preventDefault()
    contextMenu(e.clientX, e.clientY, [
      { icon: icon(isPinned(it.key) ? 'unpin' : 'pin', 14), label: isPinned(it.key) ? 'Unpin from top' : 'Pin to top', onClick: () => { togglePin(it.key); paintNav() } },
      { icon: icon('external', 14), label: 'Open in a new tab', onClick: () => window.open(location.pathname + it.hash, '_blank') },
    ])
  }

  paintNav = () => {
    const groups = navGroups()
    const sectionEls = groups.map(g => {
      const isClosed = !!collapsed()[g.key]
      const items = h('div.side-sec-items', {},
        ...g.items.map(it => {
          const active = isActive(it)
          const n = counts[it.key]
          return h('button.side-item', {
            class: [active ? 'active' : '', it.ghost ? 'ghost' : ''].filter(Boolean).join(' '),
            'aria-current': active ? 'page' : null,
            title: it.tip || it.label,
            onclick: () => { closeNavOnMobile(); location.hash = it.hash },
            oncontextmenu: e => itemMenu(e, it),
          },
            iconEl(it.icon, 17),
            h('span.side-label', {}, it.label),
            n ? h('span.count', { title: `${n} with unpublished edits` }, String(n)) : '',
            h('span.tip', {}, it.tip || it.label))
        }))
      return h('div.side-sec', { class: isClosed ? 'closed' : '' },
        g.collapsible
          ? h('button.side-title', {
            'aria-expanded': String(!isClosed),
            onclick: () => { toggleSection(g.key); paintNav() },
          }, h('span', {}, g.title), iconEl('chevD', 11))
          : h('div.side-title', {}, h('span', {}, g.title)),
        items)
    })

    side.replaceChildren(
      ...sectionEls,
      h('div.side-foot', {},
        h('div.nav-tools', {},
          h('button.icon-btn', {
            title: 'How the rail is grouped', 'aria-label': 'Change how navigation is grouped',
            onclick: e => contextMenu(e.clientX, e.clientY, [
              { icon: icon(groupBy() === 'section' ? 'check' : 'layout', 14), label: 'Group by section', onClick: () => { setGroupBy('section'); paintNav() } },
              { icon: icon(groupBy() === 'recent' ? 'check' : 'clock', 14), label: 'Most recently used', onClick: () => { setGroupBy('recent'); paintNav() } },
              { icon: icon(groupBy() === 'az' ? 'check' : 'list', 14), label: 'A to Z', onClick: () => { setGroupBy('az'); paintNav() } },
            ]),
          }, iconEl('filter', 15))),
        h('button.side-item', { onclick: () => setCollapsed(!collapsedSide()), title: 'Toggle sidebar  ⌘B' },
          iconEl(collapsedSide() ? 'panel-open' : 'panel-close', 17),
          h('span.side-label', {}, 'Collapse'),
          h('span.tip', {}, 'Expand sidebar  ⌘B'))))

    // ribbon: one dropdown per group
    ribbon.replaceChildren(...groups.map(g => {
      const open = h('div.mbar-drop', { role: 'menu' },
        ...g.items.map(it => h('button.mbar-item', {
          role: 'menuitem', class: isActive(it) ? 'active' : '',
          'aria-current': isActive(it) ? 'page' : null,
          onclick: () => (location.hash = it.hash),
        }, iconEl(it.icon, 15), it.label)))
      const grp = h('div.mbar-group', { class: g.items.some(isActive) ? 'active' : '' },
        h('button.mbar-btn', {
          'aria-haspopup': 'menu', 'aria-expanded': 'false',
          onclick: e => {
            const on = grp.classList.toggle('open')
            e.currentTarget.setAttribute('aria-expanded', String(on))
          },
        }, g.title, iconEl('chevD', 11)),
        open)
      return grp
    }))
  }

  const closeNavOnMobile = () => shellEl?.classList.remove('nav-open')

  viewEl = h('main.view', { id: 'view', tabindex: '-1' })

  shellEl = h('div.app', {
    class: [prefs().layout === 'ribbon' ? 'layout-ribbon' : '', prefs().sideCollapsed ? 'side-collapsed' : ''].filter(Boolean).join(' '),
  },
    h('a.skip-link', { href: '#view' }, 'Skip to content'),
    h('header.topbar', {},
      h('button.icon-btn.nav-toggle', {
        'aria-label': 'Menu', title: 'Menu',
        onclick: () => shellEl.classList.toggle('nav-open'),
      }, iconEl('menu', 17)),
      h('div.top-brand', {}, h('span.mark', {}, 'B'), 'Studio',
        h('button.top-site.site-switch', { title: 'Switch site', onclick: openSiteSwitcher }, '· ', m.site.name, iconEl('chevD', 10))),
      h('div.top-mid', {},
        h('button.searchish', { onclick: openPalette },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem' } },
            iconEl('search', 14), h('span.searchish-label', {}, 'Search everything')),
          h('span.kbd', {}, '⌘K'))),
      h('div.top-end', {},
        h('a.btn.ghost.small', { href: '/', target: '_blank', rel: 'noopener', style: { display: 'inline-flex', gap: '0.4rem' } }, 'View site', iconEl('external', 13)),
        h('button.icon-btn', { title: 'Keyboard shortcuts  ?', 'aria-label': 'Keyboard shortcuts', onclick: showShortcuts }, iconEl('help', 16)),
        h('button.icon-btn', { title: 'Personalize studio', 'aria-label': 'Personalize studio', onclick: personalize }, iconEl('palette', 16)),
        h('button.icon-btn', { title: 'Toggle studio theme', 'aria-label': 'Toggle studio light or dark', onclick: toggleTheme }, iconEl('contrast', 16)),
        h('button.icon-btn', { title: `Signed in as ${state.user.email} — sign out`, 'aria-label': 'Sign out', onclick: signOut }, iconEl('power', 16)))),
    side, ribbon, viewEl)

  app.replaceChildren(shellEl)
  hooks.paintNav = paintNav
  hooks.refreshCounts = refreshCounts
  addEventListener('hashchange', onHashChange)
  paintNav()
  refreshCounts()

  addEventListener('keydown', e => {
    const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette() }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setCollapsed(!collapsedSide()) }
    else if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); showShortcuts() }
    else if (e.key === 'Escape') closeSheet()
  })
}

async function signOut() {
  if (!(await confirmLeave())) return
  await post('/auth/logout')
  location.reload()
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const next = cur === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('blockhouse-studio-theme', next) } catch {}
  toast(`Studio is now ${next} — the site is unchanged`, 'info')
}

// ---------- shortcuts ----------

const SHORTCUTS = [
  ['Everywhere', [
    ['⌘K / Ctrl K', 'Search everything — documents, settings, blocks, commands'],
    ['⌘B / Ctrl B', 'Collapse or expand the sidebar'],
    ['?', 'This list'],
    ['Esc', 'Close a panel or dialog'],
  ]],
  ['In the editor', [
    ['⌘S', 'Save and create a restore point'],
    ['⌘Z / ⇧⌘Z', 'Undo / redo'],
    ['⌘D', 'Duplicate the selected block'],
    ['⌘C / ⌘X / ⌘V', 'Copy, cut and paste blocks — across documents too'],
    ['⌘⏎', 'Add a block after the selected one'],
    ['↑ / ↓', 'Move the selection through the outline'],
    ['⌥↑ / ⌥↓', 'Move the selected block up or down'],
    ['← / →', 'Collapse or expand a container'],
    ['Esc', 'Select the parent block'],
    ['Delete / Backspace', 'Delete the selected block (undoable)'],
  ]],
  ['In lists', [
    ['⌥↑ / ⌥↓', 'Reorder the focused row without a mouse'],
    ['Space', 'Select a row for a bulk action'],
  ]],
]

function showShortcuts() {
  dialog({
    title: 'Keyboard shortcuts',
    width: 'min(34rem, 94vw)',
    body: h('div', {}, ...SHORTCUTS.map(([group, rows]) => h('div', { style: { marginBottom: '1rem' } },
      h('div.insp-section-title', {}, group),
      ...rows.map(([k, what]) => h('div', {
        style: { display: 'grid', gridTemplateColumns: 'minmax(7rem, 9rem) 1fr', gap: '0.8rem', padding: '0.35rem 0', alignItems: 'baseline' },
      }, h('span.kbd', {}, k), h('span', { style: { fontSize: '0.85rem', color: 'var(--mut)' } }, what)))))),
  })
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
  const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Studio accent' }, ...PALETTES.map(p =>
    h('button.swatch', {
      class: cur() === p.key ? 'active' : '', title: p.label, 'aria-label': p.label,
      role: 'radio', 'aria-checked': String(cur() === p.key), style: { background: p.color },
      onclick: e => {
        document.documentElement.dataset.palette = p.key
        setPref('palette', p.key)
        swatches.querySelectorAll('.swatch').forEach(s => { s.classList.remove('active'); s.setAttribute('aria-checked', 'false') })
        e.currentTarget.classList.add('active')
        e.currentTarget.setAttribute('aria-checked', 'true')
      },
    }, cur() === p.key ? '✓' : '')))

  const segOf = (label, options, get2, set2) => {
    const seg = h('div.seg', { role: 'radiogroup', 'aria-label': label }, ...options.map(([k, l]) =>
      h('button', {
        role: 'radio', 'aria-checked': String(get2() === k), class: get2() === k ? 'active' : '',
        onclick: e => {
          set2(k)
          seg.querySelectorAll('button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false') })
          e.currentTarget.classList.add('active'); e.currentTarget.setAttribute('aria-checked', 'true')
        },
      }, l)))
    return h('div.field', {}, h('label', {}, label), seg)
  }
  dialog({
    title: 'Personalize the studio',
    body: h('div', {},
      h('div.field', {}, h('label', {}, 'Studio accent'),
        h('span.help', {}, 'The studio chrome only — your site’s colours live in Design.'), swatches),
      segOf('Navigation layout', [['side', 'Sidebar'], ['ribbon', 'Top ribbon']],
        () => (prefs().layout === 'ribbon' ? 'ribbon' : 'side'),
        k => { setPref('layout', k); shellEl?.classList.toggle('layout-ribbon', k === 'ribbon') }),
      segOf('Density', [['comfortable', 'Comfortable'], ['compact', 'Compact']],
        () => prefs().density || 'comfortable',
        k => { setPref('density', k); if (k === 'compact') document.documentElement.dataset.density = 'compact'; else delete document.documentElement.dataset.density }),
      h('div.field', {}, h('label', {}, 'Rail arrangement'),
        h('button.btn.ghost.small', {
          onclick: () => { setPref('pinned', []); setPref('navCollapsed', {}); setGroupBy('section'); paintNav(); toast('Navigation reset', 'ok') },
        }, 'Reset pins and groups')),
      h('p.dlg-text', { style: { marginTop: '0.4rem' } },
        'These are yours alone — per browser, per person, never the site. Right-click any rail item to pin it. ⌘B collapses the rail.')),
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
//
// The hash carries view state (settings group, editor tab, list filter) so a
// detour and a bookmark both come back to where you were. Leaving a view with
// unsaved work asks first — once, in one place, for every view.

async function confirmLeave() {
  for (const [, g] of guards) {
    const res = await g()
    if (res === false) return false
  }
  return true
}

let lastHash = location.hash
// A navigation while a guard dialog is still open used to start a SECOND
// confirmLeave; whichever resolved last would route, painting a view the
// address bar no longer pointed at. One token settles it: only the newest
// navigation is allowed to finish.
let navSeq = 0

function onHashChange() {
  const target = location.hash
  const my = ++navSeq
  if (guards.size) {
    // put the old hash back while we ask, so cancelling really cancels
    confirmLeave().then(ok => {
      if (my !== navSeq) return          // a newer navigation has taken over
      if (!ok) { history.replaceState(null, '', lastHash || '#/'); return }
      lastHash = target
      paintNav(); route(my)
    })
    return
  }
  lastHash = target
  paintNav(); route(my)
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const [, name, ...rest] = path.split('/')
  return { name, rest: rest.map(decodeURIComponent), query: new URLSearchParams(qs || '') }
}

const ROUTES = {
  '': 'dashboard', c: 'contentList', e: 'editor', media: 'media', assets: 'media', menus: 'menus',
  seo: 'seo', users: 'users', settings: 'settings', plugins: 'plugins', p: 'pluginPanel',
  help: 'help', deploy: 'deploy', audit: 'audit', types: 'concepts', design: 'design',
  tpl: 'templates', chrome: 'chrome',
}

async function route(token) {
  const my = token ?? ++navSeq
  closeSheet()
  guards.clear()
  const { name, rest, query } = parseHash()
  currentCleanup?.()
  currentCleanup = null
  noteVisit(name === '' ? 'dash' : name === 'c' ? `c/${rest[0]}` : name === 'p' ? `p/${rest[0]}` : name)

  const viewName = ROUTES[name]
  if (viewName === undefined) return render404(name)

  // A spinner that appears after 180ms never flashes on a view that was ready.
  const t = setTimeout(() => viewEl.replaceChildren(spinner()), 180)
  try {
    const view = VIEWS[viewName] || VIEWS.dashboard
    const cleanup = (await view(viewEl, rest, query)) || null
    // A slow view (the editor waits on /content/:id) could resolve after a
    // later navigation had already mounted: assigning here would orphan the
    // newer view's cleanup and leak its listeners forever.
    if (my !== navSeq) { cleanup?.(); return }
    currentCleanup = cleanup
  } catch (e) {
    if (my !== navSeq) return
    console.error(e)
    viewEl.replaceChildren(h('div.empty', {},
      h('div.empty-ico', {}, iconEl('warn', 28)),
      h('h3', {}, 'This view failed to load'),
      h('p', {}, String(e.message || e)),
      h('button.btn.ghost.small', { onclick: () => route() }, 'Try again')))
  } finally {
    clearTimeout(t)
  }
}

function render404(name) {
  const items = allItems()
  const guessOf = q => items
    .map(i => ({ i, s: i.label.toLowerCase().startsWith(q.slice(0, 3)) ? 2 : i.key.includes(q) ? 1 : 0 }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.i)
  const guesses = guessOf(String(name || '').toLowerCase())
  viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.empty', {},
      h('div.empty-ico', {}, iconEl('compass', 28)),
      h('h3', {}, `Nothing lives at #/${name}`),
      h('p', {}, guesses.length ? 'Did you mean one of these?' : 'That address does not match a view in this studio.'),
      h('div', { style: { display: 'grid', gap: '0.25rem', marginTop: '0.6rem', minWidth: 'min(22rem, 80vw)' } },
        ...guesses.map(g => h('button.row-item', { onclick: () => (location.hash = g.hash) },
          h('span.row-ico', { html: icon(g.icon, 15) }), h('span.row-label', {}, g.label))),
        h('button.btn.ghost.small', { style: { marginTop: '0.4rem' }, onclick: openPalette }, 'Search everything  ⌘K'))))))
}

// ---------- search ----------

function openPalette() {
  openSearch({ navGroups, runAction })
}

async function runAction(what, arg) {
  switch (what) {
    case 'export': {
      const t = toast('Exporting…', 'info', { ms: 0 })
      try {
        const r = await post('/export')
        t.close()
        toast(`Exported ${r.pages} pages → ${r.outDir}`, 'ok', 5000)
      } catch { t.close() }
      break
    }
    case 'viewSite': window.open('/', '_blank', 'noopener'); break
    case 'switchSite': openSiteSwitcher(); break
    case 'personalize': personalize(); break
    case 'toggleTheme': toggleTheme(); break
    case 'shortcuts': showShortcuts(); break
    case 'signOut': signOut(); break
    case 'addBlock': hooks.addBlockByType?.(arg); break
    default: break
  }
}

hooks.openPalette = openPalette
hooks.invalidateSearch = invalidateSearch
hooks.pushReturn = pushReturn
hooks.popReturn = popReturn

boot()
