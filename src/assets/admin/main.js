// Blockhouse Studio shell: auth, the navigation workspace, the router, and the
// one search that reaches everything.

import { get, post, clearSignedOut } from './api.js'
import { h, toast, dialog, spinner, contextMenu, sc, closeOpenDialogs } from './ui.js'
import { icon, iconEl } from './icons.js'
import { state, VIEWS, prefs, setPref, hooks, guards, pushReturn, popReturn, wideMode, toggleWide, conceptIcon, nav } from './state.js'
// view modules register themselves into VIEWS as a side effect
import './views.js'
import './editor.js'
import './menus.js'
import './data.js'
import './assets.js'
import './seo.js'
import './help.js'
import './deploy.js'
import './ai-connect.js'
import './audit.js'
import './concepts.js'
import './settings.js'
import './design.js'
import './templates.js'
import './chrome.js'
import { navGroups, allItems, togglePin, isPinned, toggleSection, collapsed } from './nav.js'
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

/**
 * The sign-in card. `opts.onDone` replaces the usual full page reload — the
 * in-place version uses it to re-render the view you were already looking at.
 */
function renderAuth(kind, opts = {}) {
  const resetToken = /^#\/reset\//.test(location.hash) ? location.hash.slice('#/reset/'.length) : null
  if (resetToken && !opts.onDone) return renderReset(resetToken)

  const isBoot = kind === 'bootstrap'
  const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' })
  const name = h('input', { type: 'text', placeholder: 'Your name' })
  const pass = h('input', { type: 'password', placeholder: isBoot ? 'Choose a password (8+ chars)' : 'Password', autocomplete: isBoot ? 'new-password' : 'current-password' })
  const btn = h('button.btn.primary.justify-center', { type: 'submit' }, isBoot ? 'Create owner account' : 'Sign in')
  const note = h('p.sub.minh-1e', { role: 'status', 'aria-live': 'polite' })
  const form = h('form.login-card', {
    onsubmit: async e => {
      e.preventDefault()
      btn.disabled = true
      try {
        await post(isBoot ? '/auth/bootstrap' : '/auth/login',
          isBoot ? { email: email.value, name: name.value, password: pass.value } : { email: email.value, password: pass.value })
        if (opts.onDone) await opts.onDone()
        else location.reload()
      } catch { btn.disabled = false }
    },
  },
    h('div.login-mark', {}, 'B'),
    h('h1', {}, isBoot ? 'Welcome to Blockhouse' : 'Blockhouse Studio'),
    h('p.sub', {}, isBoot ? 'Set up the owner account for this site.' : (opts.subtitle || 'Sign in to continue.')),
    fieldWrap('Email', email), isBoot ? fieldWrap('Name', name) : '', fieldWrap('Password', pass), btn,
    isBoot ? '' : h('button.text-s.mut.justify-self-center', { type: 'button', onclick: async () => {
        if (!email.value) { note.textContent = 'Type your email above first.'; return }
        const r = await post('/auth/forgot', { email: email.value }).catch(() => ({}))
        note.textContent = r.message || 'If that address has an account, a reset link is on its way.'
      } }, 'Forgot password?'),
    note)
  const wrap = h(opts.target ? 'div.login-wrap.login-inline' : 'div.login-wrap', {}, form)
  if (opts.target) opts.target.replaceChildren(h('div.main', {}, h('div.main-pad', {}, wrap)))
  else app.replaceChildren(wrap)
  email.focus()
}

/**
 * Signed out mid-session. The rail and the rest of the studio stay put; only
 * the panel you were looking at is swapped for the sign-in card, and signing
 * back in re-renders that same panel rather than throwing the page away.
 */
let signInShowing = false
function showSignIn() {
  if (!viewEl) return renderAuth('login')
  if (signInShowing) return
  signInShowing = true
  renderAuth('login', {
    target: viewEl,
    subtitle: 'You’ve been signed out. Sign in again to carry on where you were.',
    onDone: async () => {
      signInShowing = false
      clearSignedOut()
      const me = await get('/auth/me').catch(() => ({ user: null }))
      if (me.user) state.user = me.user
      state.meta = await get('/meta').catch(() => state.meta)
      paintNav?.()
      route()
    },
  })
}
addEventListener('bh:signedout', showSignIn)

function renderReset(token) {
  const pass = h('input', { type: 'password', placeholder: 'New password (8+ chars)', autocomplete: 'new-password' })
  const btn = h('button.btn.primary.justify-center', { type: 'submit' }, 'Set new password')
  const note = h('p.sub.minh-1e', { role: 'status', 'aria-live': 'polite' })
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
      // Never hide where you already are: a closed section holding the current
      // page opens itself, so the rail always shows your position.
      const isClosed = !!collapsed()[g.key] && !g.items.some(isActive)
      const items = h('div.side-sec-items', {},
        ...g.items.map(it => {
          const active = isActive(it)
          const n = counts[it.key]
          // A real link, not a button: middle-click and ⌘-click open a section
          // in a new tab, and the address is copyable. The handler only closes
          // the mobile drawer; the href does the navigating.
          return h('a.side-item', {
            href: it.hash,
            class: [active ? 'active' : '', it.ghost ? 'ghost' : ''].filter(Boolean).join(' '),
            'aria-current': active ? 'page' : null,
            // The name is what it is called; the tooltip may describe it. When
            // the rail is narrow the label is still drawn under the icon, so
            // nobody has to hover to find out where they are going.
            'aria-label': it.label,
            title: it.tip || it.label,
            onclick: e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) closeNavOnMobile() },
            oncontextmenu: e => itemMenu(e, it),
          },
            iconEl(it.icon, 17),
            h('span.side-label', {}, it.label),
            // The badge is a needs-publishing count, not a total (R9-7). The
            // pencil the dashboard uses for unpublished work says so on screen,
            // and the hidden words say it to a screen reader.
            n ? h('span.count.count-unpub', { title: `${n} with changes not yet published` },
              h('span.count-pen', { 'aria-hidden': 'true', html: icon('pen', 10) }),
              String(n),
              h('span.sr-only', {}, ' with unpublished changes')) : '',
            // the hover/collapsed tooltip repeats the label, so keep it out of
            // what a screen reader announces for the link
            h('span.tip', { 'aria-hidden': 'true' }, it.tip || it.label))
        }))
      return h('div.side-sec', { class: isClosed ? 'closed' : '' },
        g.collapsible
          ? h('button.side-title', {
            'aria-expanded': String(!isClosed),
            // the section's job in plain words, not a count that reads as an alert
            title: g.hint || g.title,
            onclick: () => { toggleSection(g.key); paintNav() },
          }, h('span', {}, g.title),
            iconEl('chevD', 11))
          : h('div.side-title', {}, h('span', {}, g.title)),
        items)
    })

    side.replaceChildren(
      ...sectionEls,
      h('div.side-foot', {},
        // The word changes with the state: a shrunk rail whose only way back is
        // an unlabelled arrow is a puzzle, and it is shrunk automatically the
        // moment you open a document.
        h('button.side-item', {
          onclick: () => setCollapsed(!collapsedSide()),
          title: sc(collapsedSide() ? 'Widen the sidebar  ⌘B' : 'Shrink the sidebar  ⌘B'),
          'aria-label': collapsedSide() ? 'Expand sidebar' : 'Collapse sidebar',
        },
          iconEl(collapsedSide() ? 'panel-open' : 'panel-close', 17),
          h('span.side-label', {}, collapsedSide() ? 'Expand' : 'Collapse'),
          h('span.tip', { 'aria-hidden': 'true' }, sc(collapsedSide() ? 'Widen the sidebar  ⌘B' : 'Shrink the sidebar  ⌘B')))))

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
            const wasOpen = grp.classList.contains('open')
            closeRibbon()
            if (!wasOpen) {
              grp.classList.add('open')
              e.currentTarget.setAttribute('aria-expanded', 'true')
              open.querySelector('button')?.focus()
            }
          },
          onkeydown: e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.click() }
          },
        }, g.title, iconEl('chevD', 11)),
        open)
      // choosing an item is the end of the menu's job
      open.addEventListener('click', e => { if (e.target.closest('.mbar-item')) closeRibbon() })
      open.addEventListener('keydown', e => {
        const items = [...open.querySelectorAll('.mbar-item')]
        const i = items.indexOf(document.activeElement)
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
        else if (e.key === 'Escape') { e.preventDefault(); closeRibbon(); grp.querySelector('.mbar-btn')?.focus() }
      })
      return grp
    }))
  }

  // The nav drawer below 860px covers the page but was not modal: no scrim, no
  // focus move, and 13 controls behind it stayed tabbable, so Tab walked
  // straight out of the open drawer into the page it was covering.
  const narrow = matchMedia('(max-width: 860px)')
  const drawerWidth = () => narrow.matches
  let navOpener = null
  // R20-2 — the closed drawer stayed in the tab order below 860px: 24 rail
  // links with `tabIndex 0` sitting at `left: -240`, so Tab walked two dozen
  // invisible stops before reaching the page and a screen reader read the rail
  // twice. `inert` + `aria-hidden` take it out of both while it is shut, and
  // widening past 860 gives it straight back.
  function syncNavInert() {
    if (!side) return
    const hidden = narrow.matches && !shellEl?.classList.contains('nav-open')
    side.inert = hidden
    if (hidden) side.setAttribute('aria-hidden', 'true')
    else side.removeAttribute('aria-hidden')
  }
  function setNavOpen(on) {
    if (!shellEl) return
    const wasOpen = shellEl.classList.contains('nav-open')
    // Closing always runs its full body even when the class is already gone:
    // the only way `inert` gets cleared is this branch, and an early return
    // here is what stranded the shell after a resize.
    if (on && wasOpen) return
    shellEl.classList.toggle('nav-open', on)
    // The drawer's state lived only in a CSS class, so a screen-reader user
    // heard "Menu, button" whether it was open or shut (R16-3). Set here, so
    // every route in and out of the drawer keeps it true.
    shellEl.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(!!on))
    // R21-1 — `inert`/`aria-hidden` must come off BEFORE we move focus into the
    // drawer: focus() on an element inside an inert subtree is ignored, so the
    // open drawer was left behind while focus sat on the Menu button and Tab
    // walked the topbar hidden under the scrim. (This also clears `side.inert`
    // in time for the Tab trap below, which returns early while it is set.)
    syncNavInert()
    const modal = on && drawerWidth()
    // Not the whole topbar: the nav toggle lives there and must stay live, or
    // it sits in plain sight doing nothing while the drawer it opened is up.
    const behind = [...shellEl.querySelectorAll('.top-brand, .top-mid, .top-end'), viewEl, ribbon]
    for (const el of behind) if (el) el.inert = modal
    side.setAttribute('aria-modal', String(modal))
    if (modal) side.setAttribute('role', 'dialog'); else side.removeAttribute('role')
    if (on) {
      navOpener = document.activeElement
      scrim.hidden = false
      if (modal) side.querySelector('button, a, [tabindex]')?.focus()
    } else {
      scrim.hidden = true
      // activeElement is <body> when the drawer was opened by a synthetic click,
      // so fall back to the control that owns the drawer rather than dropping
      // focus to the top of the document.
      // Only pull focus back if a drawer was actually open; a no-op close
      // (idempotent call, or a resize while the drawer was already shut) must
      // leave whatever the person was typing in alone.
      if (wasOpen) {
        const back = (navOpener && navOpener.isConnected && navOpener !== document.body)
          ? navOpener : shellEl.querySelector('.nav-toggle')
        back?.focus()
      }
      navOpener = null
    }
    syncNavInert()
  }
  const closeNavOnMobile = () => setNavOpen(false)
  syncNavInert()
  const scrim = h('div.nav-scrim', { hidden: true, onclick: () => setNavOpen(false) })
  // Widening past 860px re-docks the drawer as an ordinary sidebar and CSS
  // hides the scrim — but the `inert` the drawer set on the rest of the shell
  // is JavaScript state, and nothing was clearing it, so every click and every
  // Tab was swallowed with no visible cause and no way out but a reload. The
  // ☰ that would close it is hidden at that width, so this listener is the
  // only escape: when the query stops matching, close the drawer for real.
  narrow.addEventListener('change', e => { if (!e.matches) setNavOpen(false); else syncNavInert() })
  // Some embedded browsers resize without firing the media-query change event;
  // a plain resize check makes sure the drawer never stays modal on a wide window.
  addEventListener('resize', () => { if (!narrow.matches && shellEl?.classList.contains('nav-open')) setNavOpen(false); else syncNavInert() })
  // R21-1 — Escape at document level, in the capture phase: the key press can
  // land anywhere (the Menu button, the drawer, or a control behind the scrim),
  // so a listener bound to the drawer alone never heard it. A dialog or sheet
  // on top owns Escape first and keeps the drawer out of it.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !shellEl?.classList.contains('nav-open')) return
    if (document.querySelector('dialog[open], .sheet.open')) return
    e.preventDefault()
    e.stopPropagation()
    setNavOpen(false)
    shellEl.querySelector('.nav-toggle')?.focus()
  }, true)
  // Tab must not leave an open drawer, and Escape must close it.
  side.addEventListener('keydown', e => {
    // An inert rail fires no events, but keep the trap from running against a
    // drawer that is not on screen if one ever reaches it another way.
    if (side.inert) return
    if (e.key === 'Escape') { e.preventDefault(); setNavOpen(false); return }
    if (e.key !== 'Tab' || !shellEl?.classList.contains('nav-open') || !drawerWidth()) return
    const f = [...side.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null)
    if (!f.length) return
    const [first, last] = [f[0], f[f.length - 1]]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })

  /** Shut every ribbon menu. A menu with no way out but a second precise click
      is a trap, so this runs on outside click, Escape, and route changes too. */
  function closeRibbon() {
    for (const g of document.querySelectorAll('.mbar-group.open')) {
      g.classList.remove('open')
      g.querySelector('.mbar-btn')?.setAttribute('aria-expanded', 'false')
    }
  }
  addEventListener('pointerdown', e => { if (!e.target.closest?.('.mbar-group')) closeRibbon() })
  addEventListener('keydown', e => { if (e.key === 'Escape') closeRibbon() })
  addEventListener('hashchange', closeRibbon)
  // Anything layered over a screen belongs to that screen. Leaving closes it,
  // except the guard dialogs that are themselves deciding whether to leave.
  // Registered before the router's own listener so the new view never paints
  // underneath an old modal.
  // Only a real screen change closes them: the address moving back while the
  // guard question is on screen is not one, and neither is an echo of our own
  // replaceState (which always arrives with the hash we are already showing).
  addEventListener('hashchange', () => {
    if (guardPending || location.hash === nav.current) return
    closeOpenDialogs(); closeSheet()
  })

  // R19 — two sites can carry the same name (a live site and its staging copy),
  // and then two studio tabs are indistinguishable. The site's own web address
  // is the short thing that always differs, so the browser tab title always
  // carries it. On screen it would be noise most of the time, so the topbar
  // adds it only once the switcher's list confirms that another site on this
  // host answers to the same name.
  const siteHint = String(m.site.hint || '')
  document.title = `${m.site.name}${siteHint ? ` (${siteHint})` : ''} · Blockhouse Studio`
  const siteNameEl = h('span.top-site-name', {}, m.site.name)
  // R20 (R19-5) — when two sites share a name their web addresses can differ by
  // a "www." alone, which is not something you can tell apart in a browser tab.
  // The folder each site lives in is the short, plainly different thing, so the
  // topbar and the tab title use that once the switcher confirms a clash. The
  // web address stays in the switcher, where there is room to read it.
  get('/projects').then(({ projects }) => {
    const cur = (projects || []).find(pr => pr.current)
    if (!cur?.ambiguous) return
    const mark = String(cur.folder || '').trim() || siteHint
    if (!mark) return
    siteNameEl.replaceChildren(m.site.name, h('span.top-site-hint', {}, ` · ${mark}`))
    siteNameEl.title = cur.folder
      ? `${m.site.name} — the ${mark} folder${siteHint ? `, at ${siteHint}` : ''}`
      : `${m.site.name} at ${mark}`
    document.title = `${m.site.name} (${mark}) · Blockhouse Studio`
  }).catch(() => {})

  viewEl = h('main.view', { id: 'view', tabindex: '-1' })

  shellEl = h('div.app', {
    class: [prefs().layout === 'ribbon' ? 'layout-ribbon' : '', prefs().sideCollapsed ? 'side-collapsed' : '', wideMode() ? 'wide' : ''].filter(Boolean).join(' '),
  },
    h('a.skip-link', { href: '#view' }, 'Skip to content'),
    h('header.topbar', {},
      h('button.icon-btn.nav-toggle', {
        'aria-label': 'Menu', title: 'Menu', 'aria-expanded': 'false',
        onclick: () => setNavOpen(!shellEl.classList.contains('nav-open')),
      }, iconEl('menu', 17)),
      h('div.top-brand', {}, h('span.mark', {}, 'B'), 'Studio'),
      // The button's purpose used to live only in `title=`, so it was learnable
      // by hover and by nothing else. Say "Switch" on screen and to a reader.
      h('button.top-site.site-switch', {
        title: 'Switch site', 'aria-label': 'Switch site', 'aria-haspopup': 'dialog',
        onclick: openSiteSwitcher,
      },
        siteNameEl,
        h('span.top-site-switch', {}, 'Switch'),
        iconEl('chevD', 11)),
      h('div.top-mid', {},
        h('button.searchish', { onclick: openPalette },
          h('span.d-iflex.items-center.gap-2', {},
            iconEl('search', 14), h('span.searchish-label', {}, 'Search everything')),
          h('span.kbd', {}, sc('⌘K')))),
      h('div.top-end', {},
        h('a.btn.ghost.small.view-site', { href: '/', target: '_blank', rel: 'noopener', 'aria-label': 'View site' }, h('span.view-site-label', {}, 'View site'), iconEl('external', 13)),
        h('button.user-btn', {
          'aria-haspopup': 'menu', title: `Signed in as ${state.user.email}`,
          onclick: e => {
            const r = e.currentTarget.getBoundingClientRect()
            openUserMenu(r.right, r.bottom + 4)
          },
        },
          h('span.user-ava', {}, initialsOf(state.user)),
          h('span.user-name', {}, firstNameOf(state.user)),
          iconEl('chevD', 11)))),
    side, ribbon, viewEl, scrim)

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
    else if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); toggleWide() }
    // Wide hides the navigation, so the usual way out has to work from anywhere.
    else if (e.key === 'Escape' && !typing && shellEl?.classList.contains('wide') && !document.querySelector('dialog[open], .sheet.open')) {
      e.preventDefault(); toggleWide(false)
    }
    else if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); showShortcuts() }
    else if (e.key === 'Escape') closeSheet()
  })
}

// ---------- the person, top right ----------

function firstNameOf(u) { return String(u?.name || u?.email || 'You').trim().split(/[\s@]+/)[0] }
function initialsOf(u) {
  const parts = String(u?.name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return String(u?.email || '?').slice(0, 2).toUpperCase()
}

/** What the studio is actually painted as right now. */
function activeTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

/** Everything a person can do about themselves, in one menu. */
function openUserMenu(x, y) {
  const dark = activeTheme() === 'dark'
  contextMenu(x, y, [
    { icon: icon('palette', 14), label: 'Preferences…', onClick: preferences },
    { icon: icon('help', 14), label: 'Keyboard shortcuts', shortcut: '?', onClick: showShortcuts },
    { icon: icon('contrast', 14), label: dark ? 'Light studio' : 'Dark studio', hint: `Now ${dark ? 'dark' : 'light'}`, onClick: () => toggleTheme() },
    { icon: icon('bolt', 14), label: 'Connect an AI assistant…', onClick: () => { location.hash = '#/ai' } },
    '-',
    { icon: icon('users', 14), label: `Signed in as ${state.user.email}`, disabled: true, onClick: () => {} },
    { icon: icon('power', 14), label: 'Sign out', onClick: signOut },
  ])
}

async function signOut() {
  if (!(await confirmLeave())) return
  await post('/auth/logout')
  location.reload()
}

/** 'system' | 'light' | 'dark'. System means: carry no attribute at all. */
function setThemeMode(mode) {
  if (mode === 'system') {
    delete document.documentElement.dataset.theme
    try { localStorage.removeItem('blockhouse-studio-theme') } catch {}
  } else {
    document.documentElement.dataset.theme = mode
    try { localStorage.setItem('blockhouse-studio-theme', mode) } catch {}
  }
  // R20 (R19-1) — the real fix is in the stylesheet (backgrounds transition as
  // `background-color`, and `color-scheme` is pinned on `:root[data-theme]`).
  // This is the belt and braces: a class on <html> for one frame forces a fresh
  // style resolution, so nothing can be left painted in the old theme.
  const el = document.documentElement
  el.classList.add('theme-swapping')
  requestAnimationFrame(() => {
    void el.offsetWidth
    requestAnimationFrame(() => el.classList.remove('theme-swapping'))
  })
}
function themeMode() {
  try { return localStorage.getItem('blockhouse-studio-theme') || 'system' } catch { return 'system' }
}

function toggleTheme() {
  const next = activeTheme() === 'dark' ? 'light' : 'dark'
  setThemeMode(next)
  toast(`The studio is now ${next}. Your website is unchanged.`, 'info')
}

// ---------- shortcuts ----------

const SHORTCUTS = [
  ['Everywhere', [
    [sc('⌘K'), 'Search everything — documents, settings, blocks, commands'],
    [sc('⌘B'), 'Collapse or expand the sidebar'],
    ['?', 'This list'],
    ['Esc', 'Close a panel or dialog'],
  ]],
  ['In the editor', [
    [sc('⌘.'), 'Wide — give the page the whole window (Esc brings the panels back)'],
    [sc('⌘S'), 'Save and create a restore point'],
    [sc('⌘Z / ⇧⌘Z'), 'Undo / redo'],
    [sc('⌘D'), 'Duplicate the selected block'],
    [sc('⌘C / ⌘X / ⌘V'), 'Copy, cut and paste blocks — across documents too'],
    [sc('⌘⏎'), 'Add a block after the selected one'],
    ['↑ / ↓', 'Move the selection through the outline'],
    [sc('⌥↑ / ⌥↓'), 'Move the selected block up or down'],
    ['← / →', 'Collapse or expand a container'],
    ['Esc', 'Select the parent block'],
    ['Delete / Backspace', 'Delete the selected block (undoable)'],
  ]],
  ['In lists', [
    [sc('⌥↑ / ⌥↓'), 'Reorder the focused row without a mouse'],
    ['Space', 'Select a row for a bulk action'],
  ]],
]

function showShortcuts() {
  dialog({
    title: 'Keyboard shortcuts',
    width: 'min(34rem, 94vw)',
    body: h('div', {}, ...SHORTCUTS.map(([group, rows]) => h('div.mb-4', {},
      h('div.insp-section-title', {}, group),
      ...rows.map(([k, what]) => h('div.shortcut-row', {}, h('span.kbd', {}, k), h('span.text-m.mut', {}, what)))))),
  })
}

function preferences() {
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
    title: 'Your preferences',
    body: h('div', {},
      h('p.dlg-text.pref-intro', {},
        'These only change how the studio looks for you, on this browser. The website is not affected.'),
      h('div.field', {}, h('label', {}, 'Studio colour'),
        h('span.help', {}, 'The studio only — your site’s colours live in Design.'), swatches),
      segOf('Light or dark', [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']],
        themeMode, setThemeMode),
      segOf('Layout', [['side', 'Sidebar'], ['ribbon', 'Top ribbon']],
        () => (prefs().layout === 'ribbon' ? 'ribbon' : 'side'),
        k => { setPref('layout', k); shellEl?.classList.toggle('layout-ribbon', k === 'ribbon') }),
      segOf('Density', [['comfortable', 'Comfortable'], ['compact', 'Compact']],
        () => prefs().density || 'comfortable',
        k => { setPref('density', k); if (k === 'compact') document.documentElement.dataset.density = 'compact'; else delete document.documentElement.dataset.density }),
      h('div.field', {}, h('label', {}, 'Sidebar pins'),
        h('button.btn.ghost.small', {
          onclick: () => { setPref('pinned', []); setPref('navCollapsed', {}); paintNav(); toast('Sidebar pins reset', 'ok') },
        }, 'Reset sidebar pins'))),
  })
}

async function openSiteSwitcher() {
  const { projects } = await get('/projects').catch(() => ({ projects: [] }))
  const pretty = u => String(u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const hostOf = u => { try { return new URL(u).hostname } catch { return '' } }
  // R10-6 — a port number is developer text. What a person can act on is
  // whether the other studio is on this computer or on someone else's.
  const onThisComputer = p => {
    const hn = hostOf(p.foundAt || p.studioUrl)
    return !!hn && hn === location.hostname
  }
  const where = p => p.current ? 'This studio'
    : onThisComputer(p) ? 'the other studio on this computer'
      : `the studio at ${hostOf(p.studioUrl) || pretty(p.studioUrl)}`
  // Two sites can share a name — both of these are called "Strongman Lifts".
  // The web address tells them apart, and when even that is close, the folder
  // each one lives in does, said as a plain label rather than a path.
  const label = p => [
    h('span.site-sw-name', {}, p.label),
    p.ambiguous && p.folder ? h('span.site-sw-url', {}, ` · the ${p.folder} folder`) : '',
    p.url ? h('span.site-sw-url', {}, ' · ' + pretty(p.url)) : '',
  ]
  const body = h('div', {},
    projects.length
      ? h('div.stack-1', {}, ...projects.map(p => p.current
        ? h('div.row-item.site-sw-current', { 'aria-current': 'true' },
          h('span.row-ico', { html: icon('check', 15) }),
          h('span.row-label', {}, ...label(p)),
          h('span.fnt.text-xs.ml-auto', {}, 'You are here'))
        : p.alive === false
          // A link to a studio that is not listening ends in a browser
          // connection error with nothing from us in it. Say it plainly
          // instead, and say where it would have been, so it can be started
          // by hand. The registry can be out of date, and only the person
          // knows where it moved to, so the row stays clickable.
          ? h('a.row-item.site-sw-off.no-underline', { href: (p.studioUrl || '') + '/admin/' },
            h('span.row-ico', { html: icon('globe', 15) }),
            h('span.row-label', {}, ...label(p)),
            h('span.fnt.text-xs.ml-auto', {},
              onThisComputer(p)
                ? 'Its studio is not running on this computer. Start it, then try again.'
                : `Its studio is not answering at ${hostOf(p.studioUrl) || pretty(p.studioUrl)}. Open it from wherever that site's studio is running.`))
          : h('a.row-item.no-underline', { href: (p.studioUrl || '') + '/admin/' },
            h('span.row-ico', { html: icon('globe', 15) }),
            h('span.row-label', {}, ...label(p)),
            h('span.fnt.text-xs.ml-auto', {},
              h('span', {}, 'Open its studio', h('span.site-sw-url.d-block', {}, where(p)))))))
      : h('p.dlg-text', {}, 'This studio only knows about this site.'))
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

// `current` is the address of the view that is actually on screen. It is set
// by `route()` and by nothing else, so it never runs ahead of the DOM. Every
// echo of our own `replaceState` arrives with `location.hash === current`,
// which is exactly the case we ignore — no flags, no counting of events.

/**
 * A view that rewrote its own address (Settings switching group, the editor
 * switching tab) has to say so, or cancelling a guarded navigation puts the
 * address bar back to where that view STARTED instead of where it is.
 */

// A navigation while a guard dialog is still open used to start a SECOND
// confirmLeave; whichever resolved last would route, painting a view the
// address bar no longer pointed at. One token settles it: only the newest
// navigation is allowed to finish. The token is taken AFTER the guard
// resolves, so a slow answer cannot be outrun by its own bookkeeping.
let navSeq = 0
// True while a guard question is on screen: a hashchange we put there
// ourselves must not close the dialog that is asking about it.
let guardPending = false
// Where the last click asked to go. Clicking a second item while the question
// is still on screen moves the destination rather than asking twice.
let pendingTarget = null

function onHashChange() {
  const target = location.hash
  // The view on screen already matches: an echo of our own replaceState, or
  // the same rail item clicked twice. Either way there is nothing to do.
  if (target === nav.current) return
  if (guards.size) {
    // Put the address back *before* asking. While the question is on screen
    // the address bar must point at the screen you are still on — a reload at
    // that moment used to throw the work away without asking.
    pendingTarget = target
    history.replaceState(null, '', nav.current)
    if (guardPending) return           // already asking; the newer target wins
    guardPending = true
    confirmLeave().then(ok => {
      guardPending = false
      const go = pendingTarget
      pendingTarget = null
      // Cancelled: nothing to do, the address already equals `current`.
      if (!ok || !go || go === nav.current) return
      guards.clear()
      history.replaceState(null, '', go)
      paintNav(); route(++navSeq)
    })
    return
  }
  paintNav(); route(++navSeq)
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
  help: 'help', deploy: 'deploy', audit: 'audit', types: 'settingsTypes', design: 'design',
  tpl: 'templates', chrome: 'chrome', ai: 'ai',
}

async function route(token) {
  const my = token ?? ++navSeq
  closeSheet()
  guards.clear()
  // This is the address that is now being painted. Nothing else writes it, so
  // it can never run ahead of the screen and strand a rail item.
  nav.current = location.hash
  const { name, rest, query } = parseHash()
  currentCleanup?.()
  currentCleanup = null

  const viewName = ROUTES[name]
  if (viewName === undefined) return render404(name)

  // A content type that does not exist used to bounce you to the dashboard with
  // no word about why. Say which name failed and offer the types that do exist.
  if (name === 'c' && rest[0] && rest[0] !== 'all' && state.meta
    && !state.meta.concepts.some(c => c.name === rest[0])) return renderNoType(rest[0])

  // #/plugins takes no sub-address, and #/p/<key> only takes a panel this site
  // actually runs. Both used to paint a page that said nothing about the bad
  // address (R11-3). Name the panel that failed, then list the real ones.
  if (name === 'plugins' && rest[0]) return renderNoPanel(rest[0])
  if (name === 'p' && rest[0] && state.meta
    && !(state.meta.panels || []).some(p => p.key === rest[0])) return renderNoPanel(rest[0])

  // A spinner that appears after 180ms never flashes on a view that was ready.
  // But a view that paints first and *then* awaits its data (Assets paints the
  // toolbar, then loads 341 files) had its own DOM thrown away by that timeout
  // and never repainted. Watch the view element: the first thing the view puts
  // there cancels the spinner for good.
  let t = setTimeout(() => { obs.disconnect(); viewEl.replaceChildren(spinner()) }, 180)
  const obs = new MutationObserver(() => { clearTimeout(t); obs.disconnect() })
  obs.observe(viewEl, { childList: true })
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
    if (signInShowing) return              // the 401 handler owns the view area now
    console.error(e)
    const signedOut = e?.status === 401
    // A 404 is not a failure you can retry. Something was deleted, or the
    // bookmark is old: say so and point at the list it used to be in.
    if (e?.status === 404 && !signedOut) return renderGone(name, rest)
    viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
      h('div.empty', {},
        h('div.empty-ico', {}, iconEl('warn', 28)),
        h('h3', {}, signedOut ? 'You’ve been signed out' : 'This view failed to load'),
        h('p', {}, signedOut ? 'Sign in again to carry on where you were.' : String(e.message || e)),
        signedOut
          ? h('button.btn.primary.small', { onclick: showSignIn }, 'Sign in')
          : h('button.btn.ghost.small', { onclick: () => route() }, 'Try again')))))
  } finally {
    clearTimeout(t)
    obs.disconnect()
  }
}

/** The address is a real kind of page, but the thing it names is gone. */
function renderGone(name, rest) {
  const concepts = state.meta?.concepts || []
  // #/c/<type>/... names its type; #/e/<id> does not, so fall back to All content.
  const c = name === 'c' ? concepts.find(x => x.name === rest[0]) : null
  const label = c ? (c.labelPlural || c.label) : (concepts.length > 1 ? 'All content' : (concepts[0]?.labelPlural || concepts[0]?.label || 'All content'))
  const hash = c ? `#/c/${c.name}` : (concepts.length > 1 ? '#/c/all' : `#/c/${concepts[0]?.name || 'all'}`)
  viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.empty', {},
      h('div.empty-ico', {}, iconEl('compass', 28)),
      h('h3', {}, 'That page no longer exists'),
      h('p', {}, 'It may have been deleted. Nothing here is broken — the link is just out of date.'),
      h('a.btn.primary.small.mt-2', { href: hash }, `Go to ${label}`)))))
}

/** #/c/<something-that-is-not-a-type>. */
function renderNoType(bad) {
  const concepts = state.meta?.concepts || []
  viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.empty', {},
      h('div.empty-ico', {}, iconEl('compass', 28)),
      h('h3', {}, `There is no content type called “${bad}”`),
      h('p', {}, 'The address may be from an older version of this site. These are the types you have:'),
      h('div.stack-1.mt-3.guess-list', {},
        ...concepts.map(c => h('a.row-item', { href: `#/c/${c.name}` },
          h('span.row-ico', { html: icon(conceptIcon(c), 15) }),
          h('span.row-label', {}, c.labelPlural || c.label))),
        concepts.length > 1
          ? h('a.row-item', { href: '#/c/all' }, h('span.row-ico', { html: icon('list', 15) }), h('span.row-label', {}, 'All content'))
          : '')))))
}

/** #/plugins/<anything> and #/p/<something-that-is-not-a-panel>. */
function renderNoPanel(bad) {
  const panels = (state.meta?.panels || []).filter(p => !p.settingsOnly)
  viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.empty', {},
      h('div.empty-ico', {}, iconEl('compass', 28)),
      h('h3', {}, `There is no app panel called “${bad}” here`),
      h('p', {}, panels.length
        ? 'An app that adds this page may have been switched off, or the link is from another site. These are the app panels you have:'
        : 'An app that adds this page may have been switched off, or the link is from another site. No app on this site adds a page of its own yet.'),
      h('div.stack-1.mt-3.guess-list', {},
        ...panels.map(p => h('a.row-item', { href: `#/p/${p.key}` },
          h('span.row-ico', { html: icon(p.icon || 'plug', 15) }),
          h('span.row-label', {}, p.label))),
        h('a.row-item', { href: '#/plugins' },
          h('span.row-ico', { html: icon('plug', 15) }),
          h('span.row-label', {}, 'Apps — switch apps on and off')))))))
}

function render404(name) {
  // R19 — the heading used to show only the first segment, so someone who
  // pasted `#/edit/d-bonar` was told "Nothing lives at #/edit", which is not
  // the address they typed. Echo the whole thing back.
  const typed = location.hash.replace(/^#/, '') || '/'
  const items = allItems()
  const guessOf = q => items
    .map(i => ({ i, s: i.label.toLowerCase().startsWith(q.slice(0, 3)) ? 2 : i.key.includes(q) ? 1 : 0 }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.i)
  const guesses = guessOf(String(name || '').toLowerCase())
  viewEl.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.empty', {},
      h('div.empty-ico', {}, iconEl('compass', 28)),
      h('h3', {}, 'Nothing lives at ', h('code.nf-addr', {}, `#${typed.startsWith('/') ? typed : `/${typed}`}`)),
      h('p', {}, guesses.length ? 'Did you mean one of these?' : 'That address does not match a view in this studio.'),
      h('div.stack-1.mt-3.guess-list', {},
        ...guesses.map(g => h('button.row-item', { onclick: () => (location.hash = g.hash) },
          h('span.row-ico', { html: icon(g.icon, 15) }), h('span.row-label', {}, g.label))),
        h('button.btn.ghost.small.mt-2', { onclick: openPalette }, sc('Search everything  ⌘K')))))))
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
    case 'personalize': preferences(); break
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
