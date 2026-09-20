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
import { searchOnlyItems } from './nav.js'

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
/**
 * "Image", "PDF" — what the file IS, in a word. Somebody hunting for a logo
 * should not be answered with `image/svg+xml`.
 */
function kindLabel(mime) {
  const t = String(mime || '')
  if (t.startsWith('image/')) return 'Image'
  if (t.startsWith('video/')) return 'Video'
  if (t.startsWith('audio/')) return 'Audio'
  if (t.includes('pdf')) return 'PDF'
  if (t.startsWith('font/') || t.includes('font')) return 'Font'
  if (t.startsWith('text/') || t.includes('json') || t.includes('xml')) return 'Text file'
  return 'File'
}

/**
 * The same words the lists and the editor use — the palette must never tell the
 * owner a page is live when the live copy is older than the one they edited.
 * Kept in step with `statusChip` in views.js (R17-1).
 */
function statusLabel(d) {
  if (d.publishAt && new Date(d.publishAt) > new Date() && d.status !== 'published')
    return `Scheduled · ${new Date(d.publishAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  if (d.stale) return 'Published · edited'
  if (d.status === 'published') return 'Published'
  if (d.status === 'review') return 'In review'
  return 'Draft'
}

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
      kind: 'doc', group: 'Content', label: d.title, sub: `${d.path} · ${statusLabel(d)}`,
      icon: 'page', keywords: `${d.slug} ${d.concept} ${d.status}`, hash: `#/e/${d.id}`,
    })
  }
  for (const m of mediaR.media || []) {
    rows.push({
      kind: 'asset', group: 'Assets', label: m.name, sub: kindLabel(m.type),
      icon: 'image', keywords: `${m.file} ${(m.tags || []).join(' ')} ${m.folder || ''}`,
      hash: `#/media?pick=${encodeURIComponent(m.id)}`,
    })
  }
  for (const mu of meta.menus || []) {
    rows.push({ kind: 'menu', group: 'Site', label: mu.label, sub: 'Navigation',
      icon: 'menu', keywords: `nav navigation links ${mu.key}`, hash: `#/menus/${mu.key}`, perm: 'menus' })
  }
  for (const c of meta.concepts || []) {
    rows.push({ kind: 'type', group: 'Content types', label: c.labelPlural || c.label,
      sub: `Browse ${String(c.labelPlural || c.label).toLowerCase()}`, icon: conceptIcon(c),
      keywords: `${c.name} list browse all ${c.urlPattern || ''}`,
      hash: `#/c/${c.name}` })
    rows.push({ kind: 'action', group: 'Content types', label: `New ${c.label}`,
      sub: 'Start a draft', icon: 'plus', keywords: `create add write ${c.name}`,
      hash: `#/c/${c.name}?new=1` })
  }
  for (const b of meta.blocks || []) {
    rows.push({ kind: 'block', group: 'Blocks', label: b.label, sub: b.description || b.group || '',
      icon: b.icon || 'layout', keywords: `${b.type} block ${b.group || ''}`, blockType: b.type })
  }
  // Settings contributed by plugins are declared at runtime, so they cannot
  // live in the static catalogue — index them from /meta instead, or they stay
  // the one class of setting search cannot reach.
  for (const sec of meta.settingsSections || []) {
    for (const f of sec.fields || []) {
      rows.push({
        kind: 'setting', group: 'Settings', label: f.label || f.key,
        sub: `${sec.label} · from the ${sec.plugin} app`, icon: 'plug',
        keywords: `${f.key} ${sec.plugin} ${sec.label} ${f.help || ''}`,
        hash: `#/settings/pluginsx?f=${encodeURIComponent(f.key)}`, perm: 'settings',
      })
    }
  }
  // Custom fields on a content type are where a lot of a site's real data lives
  for (const c of meta.concepts || []) {
    for (const f of c.fields || []) {
      rows.push({
        kind: 'setting', group: 'Content types', label: `${f.label || f.key}`,
        sub: `A field on ${c.labelPlural || c.label}`, icon: conceptIcon(c),
        keywords: `${f.key} ${c.name} field ${f.type || ''}`,
        hash: `#/types/${c.name}`, perm: 'settings',
      })
    }
  }
  contentCache = rows
  contentAt = Date.now()
  return rows
}
/** Drop the cache after anything that creates or renames content. */
export function invalidateSearch() { contentCache = null }

// ---------- static rows ----------

function navRows(navGroups) {
  const rows = navGroups().flatMap(g => g.items.map(it => ({
    kind: 'view', group: 'Go to', label: it.label, sub: it.tip || g.title,
    icon: it.icon, keywords: `${g.title} ${it.key}`, hash: it.hash,
  })))
  // Places with no rail row of their own still have to be findable.
  for (const it of searchOnlyItems()) {
    rows.push({
      kind: 'view', group: 'Go to', label: it.label, sub: it.tip,
      icon: it.icon, keywords: `settings schema fields ${it.key}`, hash: it.hash,
    })
  }
  return rows
}

function permitted(row) {
  if (!row.perm) return true
  return !!state.meta?.perms?.[row.perm]
}

// ---------- scoring ----------

/** Where does `q` start a word inside `hay`? -1 if it never does. */
function wordPrefix(s, q) {
  for (let i = s.indexOf(q); i !== -1; i = s.indexOf(q, i + 1)) {
    if (i === 0) return 1000
    if (/[^a-z0-9]/.test(s[i - 1])) return 900 - Math.min(i, 40) * 4
  }
  return -1
}

function fuzzy(hay, q) {
  if (!hay) return -1
  const s = hay.toLowerCase()
  // Two or three letters are not enough evidence for a loose match: as a
  // subsequence, "seo" hit "Messages come from" and "Closed for maintenance"
  // and returned 21 rows for three keystrokes. Short queries have to start a
  // word. Longer ones may still match anywhere, or fuzzily.
  if (q.length <= 3) return wordPrefix(s, q)
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

// Assets sit well below documents: searching "helmsdale" returned four images
// before the lift page the reader was plainly after (R8-7). On an equal-quality
// match a document wins, and a title-prefix hit on a document clears any
// filename hit on an asset.
const KIND_WEIGHT = { action: 40, view: 35, doc: 34, setting: 26, type: 24, menu: 20, block: 16, asset: 12, command: 60 }

function scoreRow(row, q) {
  // A file's extension is not a name. "png" used to return every image on the
  // site, and "seo" reached `sherwoods.png` through it.
  const rawLabel = row.kind === 'asset'
    ? String(row.label || '').replace(/\.[a-z0-9]{1,5}$/i, '')
    : String(row.label || '')
  const lower = rawLabel.toLowerCase()
  // An exact title beats everything: typing "menu" must not rank a block whose
  // description happens to contain the word above the menu itself.
  const exact = lower === q ? 400 : lower.startsWith(q) ? (row.kind === 'asset' ? 120 : 220) : 0
  const label = fuzzy(rawLabel, q)
  // An asset's keywords carry its file name (extension and all) — same rule.
  const kwText = row.kind === 'asset'
    ? String(row.keywords || '').replace(/\.[a-z0-9]{1,5}(\s|$)/gi, '$1')
    : String(row.keywords || '')
  const kw = fuzzy(kwText, q) * 0.72
  const sub = fuzzy(row.sub || '', q) * 0.5
  const best = Math.max(label, kw, sub)
  if (best < 0) return -1
  // Scattered letters are a tie-breaker, never evidence on their own: "menu"
  // reached "Message" and "Residential developments" that way. Keep the row
  // only if the word it typed actually appears somewhere on it.
  const solid = [rawLabel, kwText, String(row.sub || '')]
    .some(f => f.toLowerCase().includes(q))
  if (!solid) return -1
  const total = best + exact + (KIND_WEIGHT[row.kind] || 0)
  // A file name that happens to equal the query is still only a file name, so
  // an asset's whole score is damped: "helmsdale" now puts the lift page above
  // helmsdale.jpg, sm-helmsdale.png and the two drawings.
  return row.kind === 'asset' ? total * 0.55 : total
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
  // ⌘K with something already open (the block picker, say) used to stack the
  // palette on top of it, both visible. The palette replaces what is open.
  for (const open of [...document.querySelectorAll('dialog.dlg[open]')].reverse()) open.closeWith?.()

  const input = h('input.pal-input', {
    placeholder: 'Search documents, settings, blocks — or type a command…',
    'aria-label': 'Search the studio', autocomplete: 'off', spellcheck: 'false',
    // A combobox owning a listbox: without this a screen-reader user arrowing
    // through the results hears nothing at all, because focus never leaves the
    // input and nothing says which row is active.
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'pal-list',
    'aria-autocomplete': 'list', 'aria-haspopup': 'listbox',
  })
  const list = h('div.pal-list', { id: 'pal-list', role: 'listbox', 'aria-label': 'Results' })
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
        // A short query is a guess, not a request for everything: keep each
        // group to five until the person has typed enough to mean it.
        const cap = q.length > 3 ? (PER_GROUP[g] || 4) : Math.min(PER_GROUP[g] || 4, 5)
        if (arr.length >= cap) continue
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
          id: `pal-opt-${idx}`,
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
    // the rows are new elements, so the input's pointer to the active one is
    // stale until it is re-stated
    syncActiveAria()
  }

  const syncActiveAria = () => {
    const items = [...list.querySelectorAll('.pal-item')]
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false')
    if (items[active]) input.setAttribute('aria-activedescendant', items[active].id)
    else input.removeAttribute('aria-activedescendant')
  }

  const paintActive = () => {
    const items = [...list.querySelectorAll('.pal-item')]
    items.forEach((el, i) => {
      el.classList.toggle('active', i === active)
      el.setAttribute('aria-selected', i === active ? 'true' : 'false')
    })
    syncActiveAria()
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
