// One search over everything the studio can reach.
//
// Rows come from four places: the navigation model, the settings/action
// catalogue, live content (documents, assets, menus, types, blocks), and
// whatever the current view registered via `registerCommands`. The palette, the
// topbar search and every "where is that?" affordance read from here, so nobody
// needs to know which screen owns a control in order to get to it.

import { get } from './api.js'
import { h, dialog } from './ui.js'
import { icon } from './icons.js'
import { state, prefs, setPref, conceptIcon } from './state.js'
import { SETTINGS_ROWS, ACTION_ROWS, ALIASES } from './catalog.js'

// ---------- scoped commands ----------
// A view registers commands on mount and drops them on unmount, so ⌘K always
// carries the tools of wherever you are standing.

const SCOPES = new Map()
/** registerCommands('editor', () => [{label, icon, keywords, hint, run}]) → dispose */
export function registerCommands(scope, fn) {
  SCOPES.set(scope, fn)
  return () => SCOPES.delete(scope)
}

// ---------- live content, cached for the session ----------

let contentCache = null
let contentAt = 0
async function liveRows() {
  if (contentCache && Date.now() - contentAt < 20000) return contentCache
  const meta = state.meta
  const rows = []
  const [docsR, mediaR] = await Promise.all([
    get('/content').catch(() => ({ docs: [] })),
    get('/media').catch(() => ({ media: [] })),
  ])
  for (const d of docsR.docs || []) {
    rows.push({
      kind: 'doc', group: 'Content', label: d.title, sub: `${d.path} · ${d.status}`,
      icon: 'page', keywords: `${d.slug} ${d.concept} ${d.status}`, hash: `#/e/${d.id}`,
    })
  }
  for (const m of mediaR.media || []) {
    rows.push({
      kind: 'asset', group: 'Assets', label: m.name, sub: m.type,
      icon: 'image', keywords: `${m.file} ${(m.tags || []).join(' ')} ${m.folder || ''}`,
      hash: `#/media?pick=${encodeURIComponent(m.id)}`,
    })
  }
  for (const mu of meta.menus || []) {
    rows.push({ kind: 'menu', group: 'Site', label: `${mu.label} menu`, sub: 'Structure and links',
      icon: 'menu', keywords: `nav navigation links ${mu.key}`, hash: `#/menus/${mu.key}`, perm: 'menus' })
  }
  for (const c of meta.concepts || []) {
    rows.push({ kind: 'type', group: 'Content types', label: c.labelPlural || c.label,
      sub: `Browse · ${c.urlPattern || ''}`, icon: conceptIcon(c), keywords: `${c.name} list browse all`,
      hash: `#/c/${c.name}` })
    rows.push({ kind: 'action', group: 'Content types', label: `New ${c.label}`,
      sub: 'Start a draft', icon: 'plus', keywords: `create add write ${c.name}`,
      hash: `#/c/${c.name}?new=1` })
  }
  for (const b of meta.blocks || []) {
    rows.push({ kind: 'block', group: 'Blocks', label: b.label, sub: b.description || b.group || '',
      icon: b.icon || 'layout', keywords: `${b.type} block ${b.group || ''}`, blockType: b.type })
  }
  contentCache = rows
  contentAt = Date.now()
  return rows
}
/** Drop the cache after anything that creates or renames content. */
export function invalidateSearch() { contentCache = null }

// ---------- static rows ----------

function navRows(navGroups) {
  return navGroups().flatMap(g => g.items.map(it => ({
    kind: 'view', group: 'Go to', label: it.label, sub: it.tip || g.title,
    icon: it.icon, keywords: `${g.title} ${it.key}`, hash: it.hash,
  })))
}

function permitted(row) {
  if (!row.perm) return true
  return !!state.meta?.perms?.[row.perm]
}

// ---------- scoring ----------

function fuzzy(hay, q) {
  if (!hay) return -1
  const s = hay.toLowerCase()
  const i = s.indexOf(q)
  if (i === 0) return 1000
  if (i > 0) return 800 - Math.min(i, 40) * 4
  // Subsequence, rewarding tight runs and word starts — but only when the
  // letters actually land near each other. Without a span limit, "sitemap"
  // matched "Sanitized raw HTML" and buried the real answer.
  let li = -1, first = -1, score = 300
  for (const ch of q) {
    const idx = s.indexOf(ch, li + 1)
    if (idx === -1) return -1
    if (first < 0) first = idx
    const gap = idx - li - 1
    score -= Math.min(gap, 12) * 3
    if (gap === 0 || idx === 0 || /[\s\-/.]/.test(s[idx - 1])) score += 6
    li = idx
  }
  const span = li - first + 1
  if (span > q.length * 2 + 6) return -1
  return Math.max(score, 1)
}

const KIND_WEIGHT = { action: 40, view: 35, doc: 30, setting: 26, type: 24, menu: 20, block: 16, asset: 12, command: 60 }

function scoreRow(row, q) {
  const label = fuzzy(row.label, q)
  const kw = fuzzy(row.keywords || '', q) * 0.72
  const sub = fuzzy(row.sub || '', q) * 0.5
  const best = Math.max(label, kw, sub)
  if (best < 0) return -1
  return best + (KIND_WEIGHT[row.kind] || 0)
}

// expand "colour" → "palette design accent" so the alias matches too
function expand(q) {
  const extra = ALIASES[q]
  return extra ? [q, ...extra.split(' ')] : [q]
}

const PER_GROUP = { Content: 5, Assets: 4, Settings: 6, Blocks: 5, 'Go to': 6, Actions: 5, Site: 4, 'Content types': 4, 'This screen': 8 }

// ---------- recents ----------

function recents() { try { return prefs().recentCmds || [] } catch { return [] } }
function remember(label) {
  const r = [label, ...recents().filter(x => x !== label)].slice(0, 6)
  setPref('recentCmds', r)
}

// ---------- the palette ----------

/**
 * openSearch({ navGroups, runAction })
 * One input, no mode switch: free text searches everything; a leading `>`
 * restricts to commands and actions, `#` to settings, `@` to documents.
 */
export function openSearch({ navGroups, runAction }) {
  const input = h('input.pal-input', {
    placeholder: 'Search documents, settings, blocks — or type a command…',
    'aria-label': 'Search the studio', autocomplete: 'off', spellcheck: 'false',
  })
  const list = h('div.pal-list', { role: 'listbox', 'aria-label': 'Results' })
  const hint = h('div.pal-foot', {},
    h('span', {}, h('kbd.kbd', {}, '↑↓'), ' move'),
    h('span', {}, h('kbd.kbd', {}, '⏎'), ' open'),
    h('span', {}, h('kbd.kbd', {}, '>'), ' commands'),
    h('span', {}, h('kbd.kbd', {}, '#'), ' settings'),
    h('span', {}, h('kbd.kbd', {}, 'esc'), ' close'))

  let flat = [], active = 0, live = []

  // live content loads in the background; static rows are searchable instantly
  liveRows().then(r => { live = r; render() }).catch(() => {})

  const scopeRows = () => [...SCOPES.values()].flatMap(fn => {
    try { return (fn() || []).map(c => ({ ...c, kind: 'command', group: c.group || 'This screen' })) }
    catch { return [] }
  })

  const allRows = () => [
    ...scopeRows(),
    ...navRows(navGroups),
    ...SETTINGS_ROWS,
    ...ACTION_ROWS.map(a => ({ ...a, group: 'Actions' })),
    ...live,
  ].filter(permitted)

  const render = () => {
    let q = input.value.trim().toLowerCase()
    let only = null
    if (q.startsWith('>')) { only = r => r.kind === 'action' || r.kind === 'command'; q = q.slice(1).trim() }
    else if (q.startsWith('#')) { only = r => r.kind === 'setting'; q = q.slice(1).trim() }
    else if (q.startsWith('@')) { only = r => r.kind === 'doc'; q = q.slice(1).trim() }

    let rows = allRows()
    if (only) rows = rows.filter(only)

    let groups
    if (!q) {
      // empty query teaches: what you just used, then where you can go
      const rec = recents()
      const recRows = rec.map(l => rows.find(r => r.label === l)).filter(Boolean)
      groups = [
        ...(recRows.length ? [['Recent', recRows]] : []),
        ...(only ? [] : [['This screen', rows.filter(r => r.kind === 'command').slice(0, 8)]]),
        ['Go to', rows.filter(r => r.kind === 'view').slice(0, 8)],
        ['Actions', rows.filter(r => r.kind === 'action').slice(0, 6)],
      ].filter(([, items]) => items.length)
    } else {
      const terms = expand(q)
      const scored = []
      for (const r of rows) {
        let best = -1
        for (const t of terms) best = Math.max(best, scoreRow(r, t))
        if (best >= 0) scored.push({ r, s: best })
      }
      scored.sort((a, b) => b.s - a.s)
      const byGroup = new Map()
      for (const { r } of scored) {
        const g = r.group || 'Other'
        const arr = byGroup.get(g) || []
        if (arr.length >= (PER_GROUP[g] || 4)) continue
        arr.push(r); byGroup.set(g, arr)
      }
      groups = [...byGroup.entries()]
    }

    flat = groups.flatMap(([, items]) => items)
    active = Math.min(active, Math.max(0, flat.length - 1))

    if (!flat.length) {
      list.replaceChildren(h('div.pal-empty', {},
        h('p', {}, 'Nothing matches ', h('strong', {}, input.value.trim())),
        h('p.fnt', {}, 'Try a page title, a setting like “sitemap”, or press ', h('kbd.kbd', {}, '>'), ' for commands.')))
      return
    }

    let i = -1
    list.replaceChildren(...groups.flatMap(([g, items]) => [
      h('div.pal-group', {}, g),
      ...items.map(r => {
        i++
        const idx = i
        return h('button.pal-item', {
          class: idx === active ? 'active' : '', role: 'option',
          'aria-selected': idx === active ? 'true' : 'false',
          onmousemove: () => { if (active !== idx) { active = idx; paintActive() } },
          onclick: () => run(r),
        },
          h('span.pal-ico', { html: icon(r.icon || 'chevR', 15) }),
          h('span.pal-text', {}, h('span.pal-label', {}, r.label), r.sub ? h('span.pal-sub', {}, r.sub) : ''),
          r.hint ? h('span.kbd.pal-hint', {}, r.hint) : '')
      }),
    ]))
  }

  const paintActive = () => {
    const items = [...list.querySelectorAll('.pal-item')]
    items.forEach((el, i) => {
      el.classList.toggle('active', i === active)
      el.setAttribute('aria-selected', i === active ? 'true' : 'false')
    })
    items[active]?.scrollIntoView({ block: 'nearest' })
  }

  const run = r => {
    remember(r.label)
    dlg.closeWith?.()
    if (r.run && typeof r.run === 'function') r.run()
    else if (r.run) runAction(r.run)
    else if (r.blockType) runAction('addBlock', r.blockType)
    else if (r.hash) location.hash = r.hash
  }

  const dlg = dialog({ title: '', body: [input, list, hint], width: 'min(38rem, 94vw)' })
  dlg.classList.add('pal')
  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, flat.length - 1); paintActive() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paintActive() }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; paintActive() }
    else if (e.key === 'End') { e.preventDefault(); active = flat.length - 1; paintActive() }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); run(flat[active]) }
  })
  render()
  input.focus()
  return dlg
}
