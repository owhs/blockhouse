// Studio views: dashboard, content lists, media library, users, settings,
// plugins (permission approval) and generic plugin panels.

import { api, get, post, put, patch, del } from './api.js'
import { h, dialog, confirmDialog, promptDialog, contextMenu, toast, fmtDate, emptyState, spinner, skeleton } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, DATA_SECTIONS, prefs, setPref, hooks, refreshMeta } from './state.js'
import { icon, iconEl } from './icons.js'
import { helpButton } from './help.js'

// ---------- new doc wizard ----------
// One question — what is it called — plus anything the type genuinely cannot
// do without. Everything else is a job for the editor.

async function newDocWizard(conceptName) {
  const meta = state.meta
  const concept = meta.concepts.find(c => c.name === conceptName) || meta.concepts[0]
  const label = concept?.label || 'document'
  const title = h('input', { placeholder: `${label} title…`, autofocus: true })
  const required = (concept?.fields || []).filter(f => f.required)
  const vals = {}
  dialog({
    title: `New ${label.toLowerCase()}`,
    body: h('div', {},
      h('div.field', {}, h('label', {}, h('span', {}, 'Title'), h('span.help', {}, 'You can change this later.')), title),
      required.length ? renderFields(required, vals, () => {}) : ''),
    actions: [{
      label: 'Create and open', kind: 'primary', onClick: async () => {
        if (!title.value.trim()) { title.focus(); return false }
        const missing = required.find(f => vals[f.key] === undefined || vals[f.key] === '' || vals[f.key] === null)
        if (missing) { toast(`${missing.label || missing.key} is needed before this can be created`, 'err'); return false }
        const r = await post('/content', { concept: concept?.name, title: title.value.trim(), fields: vals })
        location.hash = `#/e/${r.doc.id}`
        return true
      },
    }],
  })
  title.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('dialog').querySelector('.btn.primary').click() })
}
registerView('newDoc', async (_root, [concept]) => { newDocWizard(concept) })

/** "New ˅" — every content type, in the order the site defines them. */
function newMenu(e) {
  const meta = state.meta
  contextMenu(e.clientX, e.clientY, meta.concepts.map(c => ({
    label: `New ${(c.label || c.name).toLowerCase()}`,
    icon: icon('plus', 13),
    onClick: () => newDocWizard(c.name),
  })))
}

// ---------- shared list helpers ----------

const isScheduled = d => !!d.publishAt && new Date(d.publishAt) > new Date() && d.status !== 'published'
const conceptOf = name => state.meta.concepts.find(c => c.name === name)
const conceptLabel = name => conceptOf(name)?.label || name
const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const plural = (n, one, many) => (n === 1 ? one : many.replace('{n}', String(n)))

/**
 * "1 page and 1 lift", "3 systems" — real type words, so the dashboard never
 * calls a lift a page. Falls back to "item/items" for a type we don't know.
 */
const typeCounts = docs => {
  const by = new Map()
  for (const d of docs) by.set(d.concept, (by.get(d.concept) || 0) + 1)
  const parts = [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => {
      const c = conceptOf(name)
      const word = n === 1
        ? (c?.label || name || 'item')
        : (c?.labelPlural || `${c?.label || name || 'item'}s`)
      return `${n} ${String(word).toLowerCase()}`
    })
  if (parts.length <= 1) return parts[0] || ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** One phrase, one colour — never two chips fighting for the same meaning. */
function statusChip(d) {
  if (isScheduled(d)) return h('span.chip.sched', {}, `Scheduled · ${shortDate(d.publishAt)}`)
  if (d.stale) return h('span.chip.stale', {}, 'Published · edited')
  if (d.status === 'published') return h('span.chip.published', {}, 'Published')
  if (d.status === 'review') return h('span.chip.review', {}, 'In review')
  return h('span.chip.draft', {}, 'Draft')
}

const STATUS_RANK = { draft: 0, review: 1, published: 2 }

/**
 * Up to three of the type's own fields, so a list of lifts looks like lifts and
 * not like a list of anything else. `listColumn: true` in the concept wins;
 * otherwise the short, sortable kinds (a choice, a yes/no, a tag list) come
 * before free text.
 */
function listColumns(concept) {
  const fields = concept?.fields || []
  const usable = f => f.type === 'text' || f.type === 'select' || f.type === 'boolean'
    || (f.type === 'list' && (f.item || []).length === 1)
  const flagged = fields.filter(f => f.listColumn && usable(f))
  if (flagged.length) return flagged.slice(0, 3)
  const rank = f => (f.type === 'text' ? 1 : 0)
  return fields.filter(usable).sort((a, b) => rank(a) - rank(b)).slice(0, 3)
}

function optionLabel(def, value) {
  const hit = (def?.options || []).find(o => o.value === value)
  return hit ? (hit.label || hit.value) : (value == null ? '' : String(value))
}

/** Text form of a type-specific cell — also what the search box matches on. */
function cellText(d, f) {
  const v = d.fields?.[f.key]
  if (v == null || v === '') return ''
  if (f.type === 'boolean') return v ? 'Yes' : ''
  if (f.type === 'select') return optionLabel(f, v)
  if (f.type === 'list') {
    const inner = (f.item || [])[0]
    return (Array.isArray(v) ? v : []).map(row => {
      const raw = row && typeof row === 'object' ? row[inner?.key ?? 'value'] : row
      return inner?.type === 'select' ? optionLabel(inner, raw) : (raw == null ? '' : String(raw))
    }).filter(Boolean).join(', ')
  }
  return String(v)
}

function cellNode(d, f) {
  if (f.type === 'boolean') return d.fields?.[f.key] ? h('span.col-tick', { html: icon('check', 13), 'aria-label': 'Yes' }) : h('span.col-empty', {}, '—')
  const t = cellText(d, f)
  return t ? h('span', {}, t) : h('span.col-empty', {}, '—')
}

// ---------- dashboard ----------
// Not a wall of numbers: what needs doing, what you were doing, then the size
// of the site.

registerView('dashboard', async root => {
  const meta = state.meta
  const [content, mediaRes] = await Promise.all([
    get('/content'),
    get('/media').catch(() => ({ media: [] })),
  ])
  const docs = content.docs
  const media = mediaRes.media || []
  const published = docs.filter(d => d.status === 'published')
  const inReview = docs.filter(d => d.status === 'review')
  const stale = docs.filter(d => d.stale)
  const scheduled = docs.filter(isScheduled)
  const noAlt = media.filter(m => String(m.type || '').startsWith('image') && !String(m.alt || '').trim())
  const seoBad = docs.filter(d => (d.seoErrors || 0) > 0)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const go = hash => () => { hooks.pushReturn?.('Dashboard', location.hash); location.hash = hash }

  const attnRow = (ico, text, hash, btn) => h('div.attn-row', {},
    h('span.attn-ico', { html: icon(ico, 16) }),
    h('span.attn-text', {}, text),
    h('button.btn.ghost.small', { onclick: go(hash) }, btn))

  const attn = []
  if (stale.length) attn.push(attnRow('pen',
    `${typeCounts(stale)} ${stale.length === 1 ? 'has' : 'have'} changes that are not on the website yet`,
    '#/c/all?filter=stale', 'Review'))
  if (inReview.length && meta.perms.publish) attn.push(attnRow('clock',
    `${typeCounts(inReview)} ${inReview.length === 1 ? 'is' : 'are'} waiting for review`,
    '#/c/all?filter=review', 'Review'))
  if (scheduled.length) attn.push(attnRow('calendar',
    `${typeCounts(scheduled)} ${scheduled.length === 1 ? 'is' : 'are'} scheduled to go live`,
    '#/c/all?filter=scheduled', 'See them'))
  if (noAlt.length) attn.push(attnRow('image',
    plural(noAlt.length, '1 image has no description for screen readers', '{n} images have no description for screen readers'),
    '#/media', 'Add descriptions'))
  if (seoBad.length) attn.push(attnRow('search',
    `${typeCounts(seoBad)} ${seoBad.length === 1 ? 'has' : 'have'} search-engine problems`,
    '#/seo', 'Fix them'))
  if (!attn.length) attn.push(h('div.attn-row.attn-clear', {},
    h('span.attn-ico', { html: icon('check', 16) }),
    h('span.attn-text', {}, 'Everything is published and up to date.')))

  const mine = docs.filter(d => d.author && d.author === state.user.id)
  const recent = [...(mine.length ? mine : docs)]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5)

  const stat = (n, label, hash, hint) => h('button.card.stat.link', { onclick: go(hash), title: hint },
    h('span.n', {}, String(n)), h('span.l', {}, label, ' ', h('span', { html: icon('chevR', 11) })))

  root.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.page-head', {},
      h('div', {}, h('h1', {}, `${greeting}, ${state.user.name.split(' ')[0]}`),
        h('p.sub', {}, meta.site.name, ' · ', h('a', { href: meta.site.url, target: '_blank', rel: 'noopener' }, meta.site.url))),
      h('div.head-actions', {},
        h('button.btn.primary', { onclick: newMenu, 'aria-haspopup': 'menu' }, iconEl('plus', 13), 'New', h('span', { html: icon('chevD', 12) })),
        helpButton('dashboard', 'the dashboard'))),

    !docs.length
      ? h('div.card.start-card', {},
        h('strong', {}, 'Getting started'),
        h('p', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); newDocWizard(meta.concepts[0]?.name) } }, '→ Create your first page')),
        h('p', {}, 'Then press Publish in the editor to put it on the website.'))
      : h('div', {},
        h('h2.sec-title', {}, 'Needs attention'),
        h('div.card.attn-card', {}, ...attn),

        recent.length ? h('div', {},
          h('h2.sec-title', {}, 'Continue editing'),
          h('div.card.attn-card', {}, ...recent.map(d => h('button.row-item', {
            onclick: go(`#/e/${d.id}`),
          },
            h('span.row-ico', { html: icon(STATUS_ICON[d.status] || 'page', 15) }),
            h('span.row-label', {}, d.title,
              h('div.row-sub', {}, `${conceptLabel(d.concept)} · edited ${fmtDate(d.updatedAt)}`)),
            statusChip(d)))) ) : '',

        h('h2.sec-title', {}, 'Your site'),
        h('div.stat-row', {},
          stat(docs.length, 'Documents', '#/c/all', 'Browse everything, of every type'),
          stat(published.length, 'Published', '#/c/all?filter=published', 'Live on the site'),
          stat(inReview.length, 'Awaiting review', '#/c/all?filter=review', 'Submitted and waiting for you'),
          stat(stale.length, 'Published · edited', '#/c/all?filter=stale', 'Published, but edited since — visitors still see the old version'))),
  )))
})

const STATUS_ICON = { published: 'check', draft: 'pen', review: 'clock' }

// ---------- content list ----------
// One list, not two. The left rail filters; the main pane is a table with the
// type's own columns, because a list of lifts should look like lifts.

registerView('contentList', async (root, [conceptName], query) => {
  const meta = state.meta
  // `all` is a real destination, not a concept: the dashboard counts every
  // type, so the list it links to has to show every type too.
  const isAll = conceptName === 'all'
  const concept = isAll
    ? { name: 'all', label: 'Document', labelPlural: 'All content', urlPattern: '', fields: [] }
    : meta.concepts.find(c => c.name === conceptName)
  if (!concept) { location.hash = '#/'; return }
  const plural_ = concept.labelPlural || concept.label
  if (query?.get('new')) { newDocWizard(isAll ? meta.concepts[0]?.name : conceptName); history.replaceState(null, '', `#/c/${conceptName}`) }

  let docs = (await get(isAll ? '/content' : `/content?concept=${conceptName}`)).docs
  let filter = query?.get('filter') || 'all'
  const types = new Set((query?.get('type') || '').split(',').filter(Boolean))
  let sort = prefs().listSort || 'updated'
  let dir = prefs().listSortDir || (sort === 'updated' ? 'desc' : 'asc')
  let q = ''
  const selected = new Set()
  const cols = listColumns(concept)

  const FILTERS = [
    ['all', 'All', () => true],
    ['draft', 'Drafts', d => d.status === 'draft'],
    ['review', 'Waiting for review', d => d.status === 'review'],
    ['published', 'Published', d => d.status === 'published'],
    ['stale', 'With unpublished changes', d => d.stale],
    ['scheduled', 'Scheduled', isScheduled],
  ]

  const sortVal = (d, key) => {
    if (key === 'title') return d.title.toLowerCase()
    if (key === 'updated') return new Date(d.updatedAt).getTime()
    if (key === 'status') return STATUS_RANK[d.status] ?? 0
    if (key === 'type') return conceptLabel(d.concept).toLowerCase()
    const f = cols.find(c => `f:${c.key}` === key)
    return f ? cellText(d, f).toLowerCase() : ''
  }

  const visible = () => {
    const pred = (FILTERS.find(f => f[0] === filter) || FILTERS[0])[2]
    const ql = q.toLowerCase()
    const matches = d => !ql || d.title.toLowerCase().includes(ql) || (d.slug || '').includes(ql)
      || (d.path || '').includes(ql) || cols.some(f => cellText(d, f).toLowerCase().includes(ql))
    const out = docs.filter(pred).filter(d => !types.size || types.has(d.concept)).filter(matches)
    const sign = dir === 'desc' ? -1 : 1
    return out.sort((a, b) => {
      const va = sortVal(a, sort), vb = sortVal(b, sort)
      if (va < vb) return -1 * sign
      if (va > vb) return 1 * sign
      return a.title.localeCompare(b.title)
    })
  }

  const listEl = h('div')
  const bulkEl = h('div')
  const countEl = h('p.sub')

  const writeUrl = () => {
    const parts = []
    if (filter !== 'all') parts.push(`filter=${filter}`)
    if (types.size) parts.push(`type=${[...types].join(',')}`)
    history.replaceState(null, '', `#/c/${conceptName}${parts.length ? '?' + parts.join('&') : ''}`)
  }

  const setFilter = k => {
    filter = k
    selected.clear()
    writeUrl()
    paintRail(); paintList()
  }

  const setSort = key => {
    if (sort === key) dir = dir === 'asc' ? 'desc' : 'asc'
    else { sort = key; dir = key === 'updated' ? 'desc' : 'asc' }
    setPref('listSort', sort); setPref('listSortDir', dir)
    paintList()
  }

  const railEl = h('div.panel-body')
  function paintRail() {
    const rows = FILTERS.map(([k, label, pred]) => {
      const n = docs.filter(pred).length
      return h('button.row-item', {
        class: k === filter ? 'active' : '', 'aria-current': k === filter ? 'true' : null,
        onclick: () => setFilter(k),
      },
        h('span.row-ico', { html: icon(k === 'stale' ? 'pen' : k === 'published' ? 'check' : k === 'review' ? 'clock' : k === 'scheduled' ? 'calendar' : 'list', 14) }),
        h('span.row-label', {}, label),
        h('span.count', {}, String(n)))
    })
    const typeRows = isAll
      ? [h('div.rail-group', {}, 'Type'), ...meta.concepts.map(c => h('button.row-item', {
        class: types.has(c.name) ? 'active' : '', 'aria-pressed': types.has(c.name) ? 'true' : 'false',
        onclick: () => {
          types.has(c.name) ? types.delete(c.name) : types.add(c.name)
          selected.clear(); writeUrl(); paintRail(); paintList()
        },
      },
        h('span.row-ico', { html: icon(types.has(c.name) ? 'check' : 'page', 14) }),
        h('span.row-label', {}, c.labelPlural || c.label),
        h('span.count', {}, String(docs.filter(d => d.concept === c.name).length))))]
      : []
    railEl.replaceChildren(...rows, ...typeRows)
  }

  function paintList() {
    const items = visible()
    countEl.textContent = isAll
      ? `${items.length} item${items.length === 1 ? '' : 's'} across every type. Click one to edit it.`
      : `${items.length} ${plural_.toLowerCase()}. Click one to edit it.`

    const allChecked = items.length > 0 && items.every(d => selected.has(d.id))
    const arrow = key => sort === key ? h('span.sort-arrow', { html: icon(dir === 'asc' ? 'up' : 'down', 11) }) : ''
    const th = (key, label, cls = '') => h(`th.sortable${cls ? '.' + cls : ''}`, {
      onclick: () => setSort(key), 'aria-sort': sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none',
    }, label, arrow(key))

    const table = h('table.data-table',
      {},
      h('thead', {}, h('tr', {},
        h('th.col-check', {}, h('input', {
          type: 'checkbox', checked: allChecked, 'aria-label': 'Select all shown',
          onchange: e => { items.forEach(d => e.target.checked ? selected.add(d.id) : selected.delete(d.id)); paintList() },
        })),
        th('title', 'Title'),
        isAll ? th('type', 'Type', 'col-extra') : '',
        ...cols.map(f => th(`f:${f.key}`, f.label || f.key, 'col-extra')),
        th('updated', 'Updated', 'col-when'),
        th('status', 'Status'))),
      h('tbody', {}, ...items.map(d => h('tr', {
        onclick: () => { hooks.pushReturn?.(plural_, location.hash); location.hash = `#/e/${d.id}` },
      },
        h('td.col-check', { onclick: e => e.stopPropagation() }, h('input', {
          type: 'checkbox', checked: selected.has(d.id), 'aria-label': `Select ${d.title}`,
          onchange: e => { e.target.checked ? selected.add(d.id) : selected.delete(d.id); paintBulk() },
        })),
        // A real link, so the row can be ⌘-clicked into a new tab or copied as
        // a link — the thing you do when sending a page to a colleague. The row
        // click still works; the anchor is the row's accessible name.
        h('td', {}, h('a.cell-title', {
          href: `#/e/${d.id}`,
          onclick: e => { e.stopPropagation(); hooks.pushReturn?.(plural_, location.hash) },
        }, d.title), h('span.cell-path', {}, d.path || '')),
        isAll ? h('td.col-extra', {}, conceptLabel(d.concept)) : '',
        ...cols.map(f => h('td.col-extra', {}, cellNode(d, f))),
        h('td.col-when', {}, fmtDate(d.updatedAt)),
        h('td', {}, statusChip(d))))))

    listEl.replaceChildren(
      items.length ? h('div.table-wrap', {}, table) : '',
      !items.length
        ? emptyState(icon('page', 26),
          q ? 'No matches' : filter === 'stale' ? 'Everything is published' : `No ${plural_} yet`,
          q ? `Nothing in ${plural_} matches “${q}”.`
            : filter === 'stale' ? 'Nothing is waiting to go live.'
              : 'Create the first one and it will show up here.',
          q ? h('button.btn.ghost.small', { onclick: () => { q = ''; search.value = ''; paintList() } }, 'Clear the filter')
            : h('button.btn.primary', { onclick: () => newDocWizard(isAll ? meta.concepts[0]?.name : conceptName) }, iconEl('plus', 13), `New ${concept.label}`))
        : '')
    paintBulk()
  }

  const reload = async () => {
    docs = (await get(isAll ? '/content' : `/content?concept=${conceptName}`)).docs
    selected.clear(); paintRail(); paintList()
  }

  function paintBulk() {
    if (!selected.size) { bulkEl.replaceChildren(); return }
    const ids = [...selected]
    const picked = ids.map(id => docs.find(d => d.id === id)).filter(Boolean)
    const staleSel = picked.filter(d => d.stale || d.status !== 'published')
    const allPublished = picked.length > 0 && picked.every(d => d.status === 'published')

    const run = (verb, path, done) => async e => {
      const btn = e.currentTarget; btn.classList.add('busy'); btn.disabled = true
      const failed = []
      for (const id of ids) {
        try { await post(`/content/${id}/${path}`) }
        catch { failed.push(docs.find(d => d.id === id)?.title || id) }
      }
      const n = ids.length - failed.length
      toast(failed.length
        ? `${done} ${n} of ${ids.length}. Could not ${verb}: ${failed.join(', ')}`
        : `${done} ${n} document${n === 1 ? '' : 's'}`, failed.length ? 'err' : 'ok')
      await reload()
      hooks.refreshCounts?.()
    }

    bulkEl.replaceChildren(h('div.bulk-bar', {},
      h('strong', {}, `${ids.length} selected`),
      meta.perms.publish ? h('button.btn.primary.small', { onclick: run('publish', 'publish', 'Published') },
        `Publish ${staleSel.length || ids.length}`) : '',
      meta.perms.publish && allPublished
        ? h('button.btn.ghost.small', { onclick: run('unpublish', 'unpublish', 'Took down') }, 'Unpublish')
        : '',
      h('button.btn.ghost.small', { onclick: () => { selected.clear(); paintList() } }, 'Clear selection')))
  }

  const search = h('input.input.list-search', {
    placeholder: `Search ${plural_.toLowerCase()}…`,
    'aria-label': `Search ${plural_}`,
    oninput: e => { q = e.target.value; paintList() },
  })

  const moreMenu = e => contextMenu(e.clientX, e.clientY, [
    { label: 'Export as spreadsheet (CSV)', icon: icon('download', 13), onClick: () => exportCsv(concept, docs) },
    { label: 'Import from a spreadsheet', icon: icon('upload', 13), onClick: () => importCsv(concept) },
  ])

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Show')),
      railEl),
    h('div.main', {}, h('div.main-pad', {},
      h('div.page-head', {},
        h('div', {},
          h('h1', {}, plural_),
          countEl),
        h('div.head-actions', {},
          h('button.btn.ghost.small.panel-toggle', {
            'aria-label': 'Show', onclick: () => root.querySelector('.split').classList.toggle('panel-open'),
          }, iconEl('filter', 12), 'Show'),
          isAll
            ? h('button.btn.primary', { onclick: newMenu, 'aria-haspopup': 'menu' }, iconEl('plus', 13), 'New', h('span', { html: icon('chevD', 12) }))
            : h('button.btn.primary', { onclick: () => newDocWizard(conceptName) }, iconEl('plus', 13), `New ${concept.label.toLowerCase()}`),
          isAll ? '' : h('button.icon-btn', { onclick: moreMenu, title: 'More actions', 'aria-label': 'More actions', 'aria-haspopup': 'menu', html: icon('more', 15) }),
          helpButton(isAll ? 'content' : `content:${conceptName}`, plural_))),
      h('div.list-search-row', {}, search),
      listEl,
      bulkEl))))

  hooks.reloadList = reload

  paintRail()
  paintList()
  return () => { hooks.reloadList = null }
})

// ---------- media ----------

// (media/assets view lives in assets.js)

/** Minimal CSV codec — quotes, commas, newlines handled; no dependencies. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

async function exportCsv(concept, docs) {
  // full docs for field values
  const full = []
  for (const d of docs) full.push((await get(`/content/${d.id}`)).doc)
  const fieldKeys = (concept.fields || []).map(f => f.key)
  const esc = v => { const s2 = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2 }
  const lines = [['title', 'slug', 'status', ...fieldKeys].join(',')]
  for (const d of full) lines.push([esc(d.title), esc(d.slug), d.status, ...fieldKeys.map(k => esc(d.fields?.[k]))].join(','))
  const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `${concept.name}.csv` })
  a.click()
}

function importCsv(concept) {
  const file = h('input', { type: 'file', accept: '.csv,text/csv' })
  const preview = h('div')
  let rows = null, headers = null, mapping = {}
  file.addEventListener('change', async () => {
    const text = await file.files[0].text()
    const all = parseCsv(text)
    headers = all[0].map(x => x.trim())
    rows = all.slice(1)
    const fieldKeys = ['title', 'slug', ...(concept.fields || []).map(f => f.key)]
    mapping = {}
    for (const fk of fieldKeys) {
      const hit = headers.findIndex(h2 => h2.toLowerCase() === fk.toLowerCase())
      if (hit >= 0) mapping[fk] = hit
    }
    preview.replaceChildren(
      h('p.dlg-text', {}, `${rows.length} row(s). Map columns:`),
      ...fieldKeys.map(fk => h('div.kv-row', {},
        h('code.pill-perm', {}, fk),
        h('select.input', {
          onchange: e => { const v = e.target.value; if (v === '') delete mapping[fk]; else mapping[fk] = +v },
        },
          h('option', { value: '' }, '— skip —'),
          ...headers.map((h2, i) => h('option', { value: i, selected: mapping[fk] === i }, h2))))))
  })
  dialog({
    title: `Import ${concept.labelPlural || concept.label} from CSV`,
    width: 'min(32rem, 94vw)',
    body: h('div', {},
      h('p.dlg-text', {}, 'First row = headers. Rows become drafts — nothing publishes automatically.'),
      h('div.field', {}, h('label', {}, 'CSV file'), file),
      preview),
    actions: [{
      label: 'Import as drafts', kind: 'primary', onClick: async () => {
        if (!rows?.length || mapping.title === undefined) { toast('Choose a file and map the title column', 'err'); return false }
        const docs = rows.map(r => ({
          title: r[mapping.title],
          slug: mapping.slug !== undefined ? r[mapping.slug] : undefined,
          fields: Object.fromEntries((concept.fields || []).map(f => [f.key, mapping[f.key] !== undefined ? r[mapping[f.key]] : undefined]).filter(([, v]) => v !== undefined && v !== '')),
        })).filter(d => d.title)
        const res = await post('/content/bulk', { concept: concept.name, docs })
        // repaint the list we are already looking at, rather than rebooting the
        // studio and dumping the user back on the dashboard
        hooks.invalidateSearch?.()
        hooks.refreshCounts?.()
        hooks.reloadList?.()
        toast(`Imported ${res.created} draft${res.created === 1 ? '' : 's'} — they are in Drafts, nothing is live yet`, 'ok', 6000)
        return true
      },
    }],
  })
}

function humanSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

// ---------- users ----------

registerView('users', async root => {
  const me = state.user
  const ROLES = [
    ['viewer', 'Read-only', 'Can browse content and media in the studio. Cannot change anything.'],
    ['author', 'Author', 'Writes and edits their own drafts, uploads media, submits for review. Cannot publish.'],
    ['editor', 'Editor', 'Edits and publishes any content, manages menus, assets and SEO, uses every app.'],
    ['admin', 'Admin', 'Everything — settings, people, apps and publishing the site.'],
    ['owner', 'Owner', 'Same as admin, and only owners can create or modify other owners.'],
  ]
  const GRANTABLE = [
    ['content.publish', 'Publish content'], ['content.write', 'Edit anyone’s content'],
    ['content.delete', 'Delete content'], ['menus.write', 'Edit menus'],
    ['seo.tools', 'SEO tools'], ['media.manage', 'Manage the asset library'],
    ['plugin:*', 'Use every app'], ['users.manage', 'Manage users'],
    ['settings.write', 'Change site settings'], ['plugins.manage', 'Approve apps'],
    ['deploy.export', 'Run diagnostics & export'], ['audit.read', 'See the activity history'],
    ['plugin:ops.manage', 'Back up the site and sync changes'],
  ]
  const genPass = () => 'blockhouse-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 8)
  const initials = n => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const canTouch = u => !(u.role === 'owner' && me.role !== 'owner')

  const holder = h('div')
  const refresh = async () => {
    const { users } = await get('/users')
    // cards-sm: on a phone this table becomes one card per person, so Status
    // and the sign-in switch are not two-thirds of a screen off to the right.
    holder.replaceChildren(h('div.table-wrap', {}, h('table.data-table.cards-sm', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Role'), h('th', {}, 'Last sign-in'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, ...users.map(u => {
        const roleSel = h('select.input.text-s.w-auto.p-1-2', { 'aria-label': `Role for ${u.name}`, disabled: !canTouch(u) || u.id === me.id, onchange: async e => {
            if (e.target.value === 'owner' && me.role !== 'owner') { toast('Only owners can promote to owner', 'err'); e.target.value = u.role; return }
            await patch(`/users/${u.id}`, { role: e.target.value })
            toast(`${u.name} is now ${e.target.value} — their other sessions were signed out`, 'ok', 4000)
            refresh()
          } }, ...ROLES.map(([r, label]) => h('option', { value: r, selected: u.role === r, disabled: r === 'owner' && me.role !== 'owner' }, label)))

        return h('tr', {},
          h('td', { 'data-label': '' }, h('div.d-flex.gap-3.items-center', {},
            h('span.avatar', {}, initials(u.name)),
            h('div', {}, h('strong.text-m', {}, u.name, u.id === me.id ? h('span.fnt.fw-regular', {}, '  (you)') : ''),
              h('div.mut.text-s', {}, u.email)))),
          // Your own role cannot be changed here either, and a greyed select
          // reading "Owner" explained none of that (R17-5). Plain words, the
          // same way the Status cell beside it does it.
          h('td', { 'data-label': 'Role' }, u.id === me.id
            ? h('span.user-self-state', {}, `${(ROLES.find(([r]) => r === u.role) || [, u.role])[1]} — this is you`)
            : roleSel),
          h('td.fnt.text-s', { 'data-label': 'Last sign-in' }, u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'never'),
          h('td', { 'data-label': 'Status' }, u.id === me.id
            // Your own switch can never move — you must not be able to lock
            // yourself out — so it rendered greyed, looking switched off, with
            // nothing on screen saying why (R16-4). Say it in words instead.
            ? h('span.user-self-state', {}, 'Can sign in — this is you')
            : h('div.d-flex.items-center.gap-2', {},
            h('label.switch', {
              title: !canTouch(u)
                ? (u.active ? 'Can sign in — your role cannot change this' : 'Cannot sign in — your role cannot change this')
                : u.active ? 'Can sign in — click to stop them signing in' : 'Cannot sign in — click to let them sign in again',
            },
              // The name belongs on the input itself: a name given through the
              // wrapping label's aria-label is the one path assistive tech
              // implements inconsistently, and this label has no text of its own.
              h('input', {
                type: 'checkbox', checked: !!u.active, disabled: !canTouch(u),
                role: 'switch', 'aria-checked': String(!!u.active),
                'aria-label': `Sign-in for ${u.name}`,
                onchange: async e => { e.target.setAttribute('aria-checked', String(e.target.checked)); await patch(`/users/${u.id}`, { active: e.target.checked }); toast(e.target.checked ? `${u.name} can sign in again` : `${u.name} can no longer sign in — they were signed out of the studio`, 'ok', 5000); refresh() },
              }), h('span.switch-track')),
            h('span.switch-word', { 'aria-hidden': 'true' }, u.active ? 'Can sign in' : 'Cannot sign in'))),
          h('td.ta-r.nowrap', { 'data-label': '' },
            h('button.btn.ghost.small', { disabled: !canTouch(u), onclick: () => resetPassword(u) }, iconEl('key', 12), 'Reset password'),
            ' ',
            h('button.btn.ghost.small', { disabled: !canTouch(u), onclick: () => editGrants(u) }, iconEl('shield', 12), 'Extra access')))
      })))))
  }

  const credentialsCard = (email, password) => {
    const text = `Sign-in address: ${location.origin}/admin/\nEmail: ${email}\nPassword: ${password}`
    return h('div', {},
      h('p.dlg-text', {}, 'Share these once, over a channel you trust. The password is not stored anywhere readable — this is the only time it is shown.'),
      h('pre.code-out.select-all', {}, text),
      h('button.btn.ghost.small', { onclick: () => { navigator.clipboard?.writeText(text); toast('Copied', 'ok') } }, iconEl('copy', 13), 'Copy credentials'))
  }

  const resetPassword = u => {
    const pw = genPass()
    dialog({
      title: `Reset password — ${u.name}`,
      body: h('div', {},
        h('p.dlg-text', {}, 'A new password is generated below. Saving signs them out everywhere.'),
        credentialsCard(u.email, pw)),
      actions: [{
        label: 'Set this password', kind: 'primary', onClick: async () => {
          await patch(`/users/${u.id}`, { password: pw })
          toast('Password reset — their sessions were signed out', 'ok')
          return true
        },
      }],
    })
  }

  const editGrants = u => {
    const set = new Set(u.grants || [])
    // Access to an app does nothing while the app itself is switched off on
    // this site — someone was given "Back up the site and sync changes" and
    // still could not find it anywhere. Say so on the line itself.
    const appOff = perm => {
      const m = /^plugin:([a-z0-9-]+)\./.exec(perm)
      return !!m && !(state.meta?.panels || []).some(p => p.plugin === m[1])
    }
    // The permission code beside every line made the list read like
    // configuration. It is still here for whoever needs it, behind a switch
    // that starts off.
    const list = h('div.stack-0.grant-list', {},
      ...GRANTABLE.map(([perm, label]) => h('label.field-check', {},
        h('input', { type: 'checkbox', checked: set.has(perm), onchange: e => e.target.checked ? set.add(perm) : set.delete(perm) }),
        h('span', {}, label,
          appOff(perm) ? h('span.fnt.text-xs', {}, ' — this app is switched off on this site. Turn it on under Apps first.') : '',
          ' ', h('code.pill-perm.grant-code', {}, perm)))))
    const allowsAll = u.role === 'admin' || u.role === 'owner'
    dialog({
      title: `Extra access — ${u.name}`,
      width: 'min(30rem, 94vw)',
      body: h('div', {},
        h('p.dlg-text', {}, allowsAll
          ? `As ${u.role === 'owner' ? 'an owner' : 'an admin'}, ${u.name} can already do everything below — ticking these changes nothing. If something is missing for them, the app is probably switched off (see Apps).`
          : `On top of what “${u.role}” already allows. Useful for one-off needs — an author who can publish, a viewer who can run SEO audits.`),
        h('label.field-check.grant-codes-toggle', {},
          h('input', { type: 'checkbox', onchange: e => list.classList.toggle('show-codes', e.target.checked) }),
          h('span', {}, 'Show codes')),
        list),
      actions: [{
        label: 'Save access', kind: 'primary', onClick: async () => {
          await patch(`/users/${u.id}`, { grants: [...set] })
          toast('Access updated — their other sessions were signed out', 'ok')
          refresh(); return true
        },
      }],
    })
  }

  const invite = () => {
    const vals = { email: '', name: '', role: 'author' }
    let pw = genPass()
    const pwInput = h('input.input', { id: 'inv-pw', value: pw, oninput: e => (pw = e.target.value) })
    const roleCards = h('div.stack-1', {
      role: 'radiogroup', 'aria-labelledby': 'inv-role-label',
    },
      ...ROLES.filter(([r]) => r !== 'owner' || me.role === 'owner').map(([r, label, blurb]) =>
        h('label.role-card', { class: vals.role === r ? 'active' : '' },
          h('input', { type: 'radio', name: 'inv-role', checked: vals.role === r, onchange: () => { vals.role = r; roleCards.querySelectorAll('.role-card').forEach(x => x.classList.remove('active')); event.target.closest('.role-card').classList.add('active') } }),
          h('div', {}, h('strong.text-m', {}, label), h('p', {}, blurb)))))
    dialog({
      title: 'Invite someone',
      width: 'min(32rem, 94vw)',
      body: h('div', {},
        renderFields([
          { key: 'email', type: 'text', label: 'Email', required: true, width: 'half' },
          { key: 'name', type: 'text', label: 'Name', width: 'half' },
        ], vals, () => {}),
        h('div.field', {}, h('span.field-label', { id: 'inv-role-label' }, 'Role'), roleCards),
        h('div.field', {}, h('label', { for: 'inv-pw' }, h('span', {}, 'Temporary password'), h('span.help', {}, 'Generated — edit if you prefer')), pwInput)),
      actions: [{
        label: 'Create account', kind: 'primary', onClick: async () => {
          if (!vals.email) { toast('Email required', 'err'); return false }
          await post('/users', { ...vals, password: pw })
          refresh()
          dialog({ title: 'Account created', body: credentialsCard(vals.email, pw), actions: [{ label: 'Done', kind: 'primary', onClick: () => true }] })
          return true
        },
      }],
    })
  }

  root.replaceChildren(h('div.main', {}, h('div.main-pad.mw-62', {},
    h('div.page-head', {},
      h('div', {}, h('h1', {}, 'People'), h('p.sub', {}, 'Studio accounts — people who edit this site. Site visitors live under Members.')),
      h('div.row', {},
        h('button.btn.primary', { onclick: invite }, '＋ Invite'),
        helpButton('users', 'People'))),
    h('details.card.mb-4.p-3-4', {},
      h('summary.clickable.text-m.fw-semi.mut', {}, 'What can each role do?'),
      h('div.stack-2.mt-3', {},
        ...ROLES.map(([r, label, blurb]) => h('div.role-row', {},
          h('strong', {}, label), h('span.mut', {}, blurb))))),
    holder)))
  refresh()
})

// ---------- plugins (permission approval) ----------

/** What a role may not do, said out loud rather than left as an absence. */
export function permissionNote(what) {
  return h('p.fnt.text-s.mt-2', {},
    `Your account (${state.user.role}) cannot ${what}. An owner or admin can change that under Apps.`)
}

// Plain sentences for permission codes, so the first thing you read is what the
// app may do rather than a dotted identifier. The server sends
// `permissionInfo`; this is the fallback when it has nothing to say.
const PERM_SUBJECT = {
  content: 'your pages and posts', media: 'your pictures and files', settings: 'the site settings',
  users: 'the people who can sign in', mail: 'email', net: 'other services over the internet',
  members: 'your members', audit: 'the record of what happened', deploy: 'publishing',
  menus: 'your menus', seo: 'the search-listing tools', plugins: 'other apps',
  store: 'its own records', json: 'its own saved files', routes: 'pages on your website',
  events: 'things that happen on the site', blocks: 'the blocks you can put on a page',
  actions: 'the steps automations can use', files: 'files that are not public',
  secure: 'its own private records',
}
const PERM_VERB = {
  read: 'Read', list: 'See', write: 'Change', save: 'Change', create: 'Add to', delete: 'Delete',
  manage: 'Look after', publish: 'Publish', send: 'Send', fetch: 'Use', own: 'Keep',
  listen: 'Watch', emit: 'Announce', register: 'Add to',
}
// Plain sentences beat a dotted code every time, and the few that read oddly
// when built word-by-word are written out in full.
const PERM_WHOLE = {
  'settings.own': 'Keep its own settings',
  'net.fetch': 'Talk to other services over the internet',
  'events.listen': 'Run things when something happens on the site',
  'events.emit': 'Tell other apps when something happens',
  'routes.public': 'Add pages to your website',
  'routes.root': 'Add short web addresses, like a download link',
  'routes.api': 'Add its own screens to this studio',
  'secure.tables': 'Store its own records, kept private',
  'mail.send': 'Send emails on your behalf',
  'files.private': 'Look after files that are not public',
  'blocks.register': 'Offer extra blocks you can put on a page',
  'actions.register': 'Offer extra steps for automations',
}
export function permSentence(code, info) {
  if (info && info !== code) return info
  const whole = PERM_WHOLE[code]
  if (whole) return whole
  const [head, tail = ''] = String(code).split('.')
  const verb = PERM_VERB[tail] || 'Use'
  const subject = PERM_SUBJECT[head] || head.replace(/[-_]/g, ' ')
  return `${verb} ${subject}`
}

// An app is "waiting for a restart" only when the switch disagrees with what
// the running site actually loaded (`running`, from /plugins). Switching one on
// and straight back off leaves nothing pending — so no badge, no banner, and no
// need for a button where someone claims a restart happened. (R15-2)
const isPending = p => !!p.state.enabled !== !!p.running

registerView('plugins', async root => {
  const holder = h('div.card.p-0', {})
  const banner = h('div', {})
  let all = []
  let q = ''

  const paintBanner = () => {
    const waiting = all.filter(isPending)
    banner.replaceChildren(waiting.length
      ? h('div.banner-warn', {},
        h('span', { html: icon('warn', 16) }),
        h('div.grow', {},
          h('strong', {}, 'Waiting for a restart: ', waiting.map(p => p.name).join(', '), '.'),
          ' Apps are loaded when the site starts, so what you switched on or off here starts working the next time it is restarted — ask whoever hosts your site. This message goes away on its own once that happens.'))
      : '')
  }

  // One PATCH, immediately — a switch that needs a Save button afterwards is
  // two decisions where the person made one.
  const save = async (p, enabled, approved) => {
    await patch(`/plugins/${p.id}`, { enabled, approved })
    paintBanner()
    if (!isPending(p)) {
      toast(enabled
        ? 'Switched on — it is already running, so there is nothing else to do.'
        : 'Switched off. It was not running anyway, so there is nothing else to do.', 'ok', 5000)
    } else {
      toast(enabled
        ? 'Switched on. It starts working after the site is next restarted — ask whoever hosts your site.'
        : 'Switched off. It stops after the site is next restarted — ask whoever hosts your site.',
        'ok', 7000)
    }
  }

  const appRow = p => {
    const approved = new Set(p.state.approved.includes('*') ? p.permissions : p.state.approved)
    const sw = h('input', {
      type: 'checkbox', checked: p.state.enabled,
      role: 'switch', 'aria-checked': String(!!p.state.enabled),
      'aria-label': `Switch ${p.name} ${p.state.enabled ? 'off' : 'on'}`,
      onchange: async e => {
        const on = e.target.checked
        e.target.setAttribute('aria-checked', String(on))
        e.target.setAttribute('aria-label', `Switch ${p.name} ${on ? 'off' : 'on'}`)
        // switching on approves everything it declares; the disclosure below is
        // where someone can take a capability back again
        if (on) for (const perm of p.permissions) approved.add(perm)
        checks.forEach(c => (c.cb.checked = approved.has(c.perm)))
        p.state.enabled = on
        p.state.approved = [...approved]
        await save(p, on, [...approved])
        paintPending()
      },
    })
    // Until the site restarts the switch is a promise, not a fact — say so on
    // the row itself, so a reload does not make the pending state disappear.
    const pendingBadge = h('span.badge-pending')
    const paintPending = () => pendingBadge.replaceChildren(
      isPending(p) ? (p.state.enabled ? 'Starts after restart' : 'Stops after restart') : '')
    const checks = p.permissions.map(perm => {
      const cb = h('input', {
        type: 'checkbox', checked: approved.has(perm),
        onchange: async e => {
          if (e.target.checked) approved.add(perm)
          else approved.delete(perm)
          p.state.approved = [...approved]
          await save(p, sw.checked, [...approved])
        },
      })
      // The dotted key is a developer's word. It is kept, because it is the
      // only way to be certain which capability a tick belongs to, but it is
      // hidden until asked for — the same "Show technical details" toggle
      // Activity uses for its machine detail.
      const code = h('code.pill-perm.perm-key', { hidden: true }, perm)
      return { perm, cb, code }
    })
    paintPending()

    return h('div.app-row', {},
      h('span.row-ico', { html: icon(p.state.enabled ? 'plug' : 'lock', 17) }),
      h('div.app-main', {},
        h('div.app-name', {}, p.name, pendingBadge),
        h('p.app-desc', {}, p.description || 'No description given.'),
        h('details.app-disclose', {},
          h('summary', {}, 'What it can do'),
          h('div.app-disclose-body', {},
            checks.length
              ? h('div', {}, ...checks.map(c => h('p.app-perm-sentence.m-0', {}, permSentence(c.perm, p.permissionInfo[c.perm]))))
              : h('p.app-perm-sentence.m-0', {}, 'It does not ask to touch anything of yours.'),
            checks.length
              ? h('details.app-limit', {},
                h('summary', {}, 'Limit what it may do (advanced)'),
                h('div.app-limit-body', {},
                  h('p.fnt.m-0', {}, 'Untick anything you would rather it could not do. The app may stop working properly.'),
                  h('label.field-check.perm-tech', {},
                    h('input', {
                      type: 'checkbox',
                      onchange: e => checks.forEach(c => (c.code.hidden = !e.target.checked)),
                    }),
                    h('span', {}, 'Show technical details')),
                  ...checks.map(c => h('label.field-check', {},
                    c.cb, h('span', {}, permSentence(c.perm, p.permissionInfo[c.perm]), ' ', c.code)))))
              : '',
            h('p.app-version', {}, `Version ${p.version}`)))),
      h('label.switch', {
        title: p.state.enabled ? 'On — click to switch off' : 'Off — click to switch on',
      }, sw, h('span.switch-track')))
  }

  const paint = () => {
    const needle = q.trim().toLowerCase()
    const list = all.filter(p => !needle || `${p.id} ${p.name} ${p.description}`.toLowerCase().includes(needle))
    holder.replaceChildren(...list.map(appRow),
      list.length ? '' : emptyState(icon('plug', 24), 'No apps match', 'Clear the search, or install one below.'))
  }
  const refresh = async () => { ;({ plugins: all } = await get('/plugins')); paint(); paintBanner() }

  const search = h('input.input.w-15', { type: 'search', 'aria-label': 'Search apps', placeholder: 'Search apps…', oninput: e => { q = e.target.value; paint() } })
  const installBtn = h('button.btn.ghost.small', {
    onclick: () => {
      const file = h('input', { type: 'file', accept: '.zip' })
      const lic = h('input.input', { placeholder: 'Licence key (if the seller gave you one)' })
      dialog({
        title: 'Install an app package',
        width: 'min(30rem, 94vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'An app package is a .zip a developer gives you. It is checked against the checksum it came with before anything is installed.'),
          h('div.field', {}, h('label', {}, 'Package (.zip)'), file),
          h('div.field', {}, h('label', {}, 'Licence key'), lic)),
        actions: [{
          label: 'Install', kind: 'primary', onClick: async () => {
            if (!file.files[0]) { toast('Choose a package zip', 'err'); return false }
            const fd = new FormData()
            fd.append('file', file.files[0])
            if (lic.value) fd.append('licenseKey', lic.value)
            const r = await post('/pluginpkgs/install', fd)
            toast(r.problems?.length ? `Installed with warnings: ${r.problems[0]}` : 'Installed. It appears in this list the next time the site is restarted.', r.problems?.length ? 'err' : 'ok', 7000)
            return true
          },
        }],
      })
    },
  }, iconEl('upload', 13), 'Install an app from a file')

  root.replaceChildren(h('div.main', {}, h('div.main-pad.mw-62', {},
    h('div.page-head', {},
      h('div', {}, h('h1', {}, 'Apps'), h('p.sub', {}, 'Extra features you can switch on. Each one says what it does and what it needs to touch.')),
      h('div.row', {}, search, helpButton('plugins', 'Apps'))),
    banner,
    holder,
    h('div.app-foot', {}, installBtn, h('span.help', {}, 'Only if a developer gave you a .zip.')))))
  paintBanner()
  refresh()
})

// ---------- generic plugin panel (resources + custom sections) ----------

registerView('pluginPanel', async (root, [panelKey]) => {
  const meta = state.meta
  const panel = meta.panels.find(p => p.key === panelKey)
  // A bookmarked or shared #/p/<app> link for an app this site does not run
  // used to bounce you to the dashboard with no explanation. Say so instead.
  if (!panel) {
    root.replaceChildren(h('div.main', {}, h('div.main-pad', {},
      emptyState(icon('plug', 26), 'This app isn’t switched on for this site',
        'Apps add extra pages to the studio. Switch this one on under Apps to use it here.',
        h('button.btn.primary.small', { onclick: () => (location.hash = '#/plugins') }, 'Go to Apps')))))
    return
  }
  const main = h('div.main-pad.mw-72', {})

  main.appendChild(h('div.page-head', {},
    h('div', {}, h('h1', {}, panel.label)),
    helpButton(panel.plugin, panel.label)))

  main.appendChild(await renderPluginPanel(panel))

  root.replaceChildren(h('div.main', {}, main))
})

/**
 * The body of an app's panel — its records and whatever bespoke screen it
 * brings. Settings-only panels are rendered by Settings → Apps through this
 * same function, so an app looks the same wherever it is shown.
 */
export async function renderPluginPanel(panel) {
  const wrap = h('div')
  const custom = CUSTOM_SECTIONS[panel.plugin]
  if (!custom?.replaces) {
    for (const res of panel.resources || []) wrap.appendChild(await resourceSection(panel, res))
  }
  if (custom) wrap.appendChild(await custom())
  return wrap
}

async function resourceSection(panel, res) {
  const base = `/res/${panel.plugin}/${res.key}`
  const singular = res.labelSingular || (res.label || 'item').replace(/s$/, '')
  const titleField = res.titleField || 'label'
  // The columns are the record's own first three fields, so the table says
  // what the thing is instead of "Item / ID".
  const fields = (res.fields || []).filter(f => f.type !== 'json' && f.type !== 'textarea')
  const cols = [
    ...(fields.some(f => f.key === titleField) ? [] : [{ key: titleField, label: singular }]),
    ...fields,
  ].slice(0, 3)
  const cellText = (item, f) => {
    const v = item[f.key]
    if (v === undefined || v === null || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return Array.isArray(v) ? v.join(', ') : String(v)
  }
  const titleOf = item => String(item[titleField] || item.title || item.name || item.id)

  const holder = h('div')
  const refresh = async () => {
    const { items } = await get(base)
    holder.replaceChildren(items.length ? h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, ...cols.map(f => h('th', {}, f.label || f.key)), h('th', {}, ''))),
      h('tbody', {}, ...items.map(item => h('tr', { onclick: () => editItem(item) },
        ...cols.map((f, i) => h('td', {}, i === 0
          ? h('strong', {}, cellText(item, f))
          : cellText(item, f))),
        h('td.ta-r', {}, h('button.icon-btn', {
          title: `Delete ${titleOf(item)}`,
          onclick: async e => {
            e.stopPropagation()
            if (await confirmDialog('Delete', `Delete ${titleOf(item)}? This can’t be undone.`)) { await del(`${base}/${item.id}`); refresh() }
          },
        }, iconEl('trash', 14))))))))
      : emptyState(icon('folder', 26), `No ${(res.label || 'records').toLowerCase()} yet`, `Press “New ${singular.toLowerCase()}” to add the first one.`))
  }
  const editItem = (item = null) => {
    const vals = item ? JSON.parse(JSON.stringify(item)) : {}
    dialog({
      title: item ? `Edit ${titleOf(item)}` : `New ${singular.toLowerCase()}`,
      width: 'min(38rem, 94vw)',
      body: renderFields(res.fields, vals, () => {}),
      actions: [{
        label: 'Save', kind: 'primary', onClick: async () => {
          if (item) await put(`${base}/${item.id}`, vals)
          else await post(base, vals)
          refresh(); return true
        },
      }],
    })
  }
  refresh()
  return h('div.card.mb-4', {},
    h('div.card-head.mb-3', {},
      h('div', {}, h('strong', {}, res.label)),
      h('button.btn.primary.small', { onclick: () => editItem(null) }, `＋ New ${singular.toLowerCase()}`)),
    holder)
}

// custom per-plugin sections that go beyond generic CRUD
const CUSTOM_SECTIONS = {
  // Ahrefs brings its own tabbed screen; loaded only when opened.
  ahrefs: Object.assign(async () => (await import('./ahrefs.js')).ahrefsPanel(), { replaces: true }),

  drive: Object.assign(async () => {
    const wrap = h('div')
    const draw = async () => {
      const [{ areas }, { requests }, { recent, top }] = await Promise.all([
        get('/x/drive/areas'), get('/x/drive/requests'), get('/x/drive/activity')])
      const pending = requests.filter(r => r.status === 'pending')
      const groups = state.meta.memberGroups || []
      const editArea = (a = null) => {
        const vals = a ? { ...a, groups: (a.groups || []).join(', ') } : { id: '', label: '', description: '', groups: '', requestable: true }
        dialog({
          title: a ? `Edit ${a.label}` : 'New document area',
          body: renderFields([
            { key: 'id', type: 'text', label: 'Id (slug)', width: 'half', help: a ? 'Cannot change' : 'e.g. technical' },
            { key: 'label', type: 'text', label: 'Label', width: 'half' },
            { key: 'description', type: 'textarea', label: 'Description', rows: 2 },
            { key: 'groups', type: 'text', label: 'Member groups with access', help: groups.length ? `Blank = any signed-in member. Available: ${groups.map(g => g.id || g).join(', ')}` : 'Blank = any signed-in member' },
            { key: 'requestable', type: 'boolean', label: 'Visitors may request access' },
          ], vals, () => {}),
          actions: [{ label: 'Save', kind: 'primary', onClick: async () => {
            const id = (a?.id || vals.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!id) { toast('Give the area an id', 'err'); return false }
            await put(`/x/drive/areas/${id}`, { ...vals, groups: String(vals.groups).split(',').map(s => s.trim()).filter(Boolean) })
            draw(); return true
          } }],
        })
      }
      wrap.replaceChildren(
        pending.length ? h('div.card.mb-4.card-warn', {},
          h('strong', {}, `Access requests (${pending.length})`),
          ...pending.map(r => h('div.d-flex.gap-3.items-center.p-2-0.bb-soft.text-m', {},
            h('div.grow', {}, h('strong', {}, r.email), ` · ${r.role || '—'}${r.company ? ` @ ${r.company}` : ''} → ${r.areaLabel}`,
              r.note ? h('div.fnt.text-s', {}, `“${r.note}”`) : ''),
            h('button.btn.primary.small', { onclick: async () => { await post(`/x/drive/requests/${r.id}/approve`, {}); toast('Approved — they can sign in now', 'ok'); draw() } }, 'Approve'),
            h('button.btn.ghost.small', { onclick: async () => { await post(`/x/drive/requests/${r.id}/decline`, {}); draw() } }, 'Decline')))) : '',
        h('div.card.mb-4', {},
          h('div.card-head.mb-2', {}, h('strong', {}, 'Document areas'),
            h('button.btn.ghost.small', { onclick: () => editArea() }, iconEl('plus', 13), 'New area')),
          ...areas.map(a => h('div.d-flex.gap-3.items-center.p-2-0.bb-soft.text-m', {},
            h('span.row-ico', { html: icon('folder', 15) }),
            h('div.grow', {}, h('strong', {}, a.label),
              h('div.fnt.text-s', {}, `${a.fileCount} files · ${a.groups.length ? `groups: ${a.groups.join(', ')}` : 'any signed-in member'} · upload under Assets → private/drive/${a.id}`)),
            h('button.btn.ghost.small', { onclick: () => editArea(a) }, 'Edit'),
            h('button.icon-btn', { onclick: async () => { if (await confirmDialog('Delete area', `Remove “${a.label}”? Files stay on disk.`)) { await del(`/x/drive/areas/${a.id}`); draw() } } }, iconEl('trash', 13)))),
          h('p.fnt.text-s.mt-2', {}, 'Put a “Document portal” block on a page (e.g. /downloads) — visitors request access there, members see their files.')),
        h('div.cards', {},
          h('div.card', {}, h('strong', {}, 'Most downloaded'),
            top.length ? h('div.mt-2', {}, ...top.map(t => h('div.d-flex.justify-between.text-s.p-0-0', {}, h('span', {}, t.file), h('strong', {}, String(t.n))))) : h('p.mut', {}, 'No downloads yet.')),
          h('div.card', {}, h('strong', {}, 'Recent activity'),
            recent.length ? h('div.mt-2', {}, ...recent.slice(0, 8).map(r => h('div.text-s.p-0-0', {}, `${r.email} ↓ ${r.file}`))) : h('p.mut', {}, 'Quiet so far.'))))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  commerce: Object.assign(async () => {
    const wrap = h('div')
    const CHIP = { new: 'draft', 'awaiting-payment': 'review', paid: 'published', fulfilled: 'published', cancelled: 'draft', refunded: 'draft' }
    const draw = async () => {
      const [{ orders }, sum] = await Promise.all([get('/x/commerce/orders'), get('/x/commerce/summary')])
      wrap.replaceChildren(
        h('div.cards.mb-4', {},
          h('div.card.stat', {}, h('span.n', {}, String(sum.orders)), h('span.l', {}, 'Orders')),
          h('div.card.stat', {}, h('span.n', {}, String(sum.paid)), h('span.l', {}, 'Paid')),
          h('div.card.stat', {}, h('span.n', {}, `${sum.currency === 'GBP' ? '£' : sum.currency === 'EUR' ? '€' : '$'}${sum.revenue.toLocaleString()}`), h('span.l', {}, 'Revenue'))),
        h('div.card', {},
          h('div.card-head.mb-2', {}, h('strong', {}, 'Orders'),
            h('a.btn.ghost.small', { href: '#/settings/pluginsx' }, 'Commerce settings')),
          orders.length ? h('div.table-wrap', {}, h('table.data-table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Customer'), h('th', {}, 'Items'), h('th.num', {}, 'Total'), h('th', {}, 'Status'), h('th'))),
            h('tbody', {}, ...orders.map(o => h('tr', {},
              h('td.mono.text-xs', {}, o.id.slice(-6)),
              h('td', {}, o.email, o.company ? h('div.fnt.text-xs', {}, o.company) : ''),
              h('td', {}, (o.lines || []).map(l => `${l.qty}× ${l.title}`).join(', ').slice(0, 60)),
              h('td.num', {}, `${o.currency === 'GBP' ? '£' : ''}${o.total}`),
              h('td', {}, h('span.chip', { class: CHIP[o.status] || 'draft' }, o.status)),
              h('td.ta-r.nowrap', {},
                ...['paid', 'fulfilled', 'cancelled'].filter(s2 => s2 !== o.status).map(s2 =>
                  h('button.btn.ghost.small.ml-1', { onclick: async () => { await post(`/x/commerce/orders/${o.id}/status`, { to: s2 }); draw() } }, s2))))))))
            : emptyState(icon('cart', 24), 'No orders yet', 'Put “Add to cart” blocks on product pages and a “Cart & checkout” block on /cart.')),
        h('p.fnt.text-s.mt-3', {},
          'Orders fire commerce.order.created / .paid / .fulfilled — point Automations at them for receipts, CRM sync or fulfilment. Stripe webhook endpoint: /x/commerce/stripe.'))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  mdsync: Object.assign(async () => {
    const wrap = h('div')
    const draw = async () => {
      const { last, tracked } = await get('/x/mdsync/status')
      const file = h('input', { type: 'file', accept: '.zip' })
      const out = h('pre.code-out', { hidden: true })
      const runSync = async fd => {
        out.hidden = false; out.textContent = 'Syncing…'
        try {
          const r = await post('/x/mdsync/sync', fd || {})
          if (r.error) { out.textContent = `✗ ${r.error}`; return }
          out.textContent = ['created', 'updated', 'unchanged', 'pruned', 'skipped']
            .map(k => `${k}: ${r.report[k].length}${r.report[k].length && k !== 'unchanged' ? ' — ' + r.report[k].slice(0, 5).join(', ') : ''}`).join('\n')
          toast('Sync finished', 'ok'); draw()
        } catch (e) { out.textContent = `✗ ${e.message}` }
      }
      wrap.replaceChildren(
        h('div.card', {},
          h('strong', {}, 'Markdown → site'),
          h('p.fnt.text-s.m-1-0-3', {},
            `Tracking ${tracked} file(s). ${last ? `Last sync ${fmtDate(last.at)} — ${Object.entries(last.report).map(([k, v]) => `${v} ${k}`).join(', ')}.` : 'Never synced.'} Frontmatter (title, slug, category…) becomes fields; the body becomes the page. Configure the folder + content type under Settings → Plugin settings.`),
          h('div.row.wrap', {},
            h('button.btn.primary.small', { onclick: () => runSync() }, iconEl('refresh', 13), 'Sync configured folder'),
            h('span.fnt', {}, 'or'),
            file,
            h('button.btn.ghost.small', { onclick: () => {
              if (!file.files[0]) { toast('Choose a zip of .md files', 'err'); return }
              const fd = new FormData(); fd.append('file', file.files[0]); runSync(fd)
            } }, iconEl('upload', 13), 'Sync from zip')),
          out))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  automations: Object.assign(async () => {
    const EVENTS = [
      ['form.submitted', 'A form was submitted', '{"formId":"contact","data":{"email":"jane@example.com","message":"Hello"}}'],
      ['content.published', 'Content was published', '{"docId":"d-home","concept":"page"}'],
      ['content.created', 'Content was created', '{"docId":"d-new","concept":"post","user":"u1"}'],
      ['member.registered', 'A member signed up', '{"memberId":"m1","email":"new@example.com"}'],
      ['newsletter.subscribed', 'Newsletter signup', '{"email":"reader@example.com","listId":"default"}'],
      ['commerce.order.created', 'An order was placed', '{"orderId":"o1","email":"buyer@example.com","total":890,"currency":"GBP"}'],
      ['commerce.order.paid', 'An order was paid', '{"orderId":"o1","email":"buyer@example.com","total":890,"currency":"GBP"}'],
      ['drive.access.requested', 'Drive access requested', '{"email":"arch@firm.example","area":"technical","role":"Architect"}'],
      ['drive.download', 'A portal file was downloaded', '{"email":"arch@firm.example","area":"technical","file":"spec.pdf"}'],
      ['data.row.created', 'A data row was added', '{"table":"quotes","id":"r1"}'],
      ['data.state.changed', 'A workflow moved', '{"table":"quotes","id":"r1","from":"review","to":"approved"}'],
      ['file.downloaded', 'A delivery link was used', '{"file":"welcome-pack.md"}'],
      ['webhook.received', 'An inbound webhook fired', '{"key":"crm","body":{"lead":"Jane"}}'],
      ['media.uploaded', 'An asset was uploaded', '{"mediaId":"m1","name":"hero.jpg"}'],
      ['user.created', 'A studio user was created', '{"userId":"u2","role":"author"}'],
    ]
    const { actions } = await get('/x/automations/actions').catch(() => ({ actions: [] }))
    const wrap = h('div')

    const listHolder = h('div', {}, skeleton('rows', 5))
    const runsHolder = h('div', {}, skeleton('rows', 4))

    const refreshList = async () => {
      const { items } = await get('/res/automations/recipes')
      listHolder.replaceChildren(
        items.length ? h('div.stack-2', {}, ...items.map(r => h('div.card.p-3-4.d-flex.items-center.gap-4', {},
          h('label.switch', { title: r.enabled ? 'On' : 'Off' },
            h('input', {
              type: 'checkbox', checked: !!r.enabled,
              role: 'switch', 'aria-checked': String(!!r.enabled),
              'aria-label': `Switch ${r.label || r.id} ${r.enabled ? 'off' : 'on'}`,
              onchange: async e => { e.target.setAttribute('aria-checked', String(e.target.checked)); e.target.setAttribute('aria-label', `Switch ${r.label || r.id} ${e.target.checked ? 'off' : 'on'}`); await post('/res/automations/recipes', { ...r, enabled: e.target.checked }); toast(e.target.checked ? 'Recipe on' : 'Recipe off', 'ok') },
            }),
            h('span.switch-track')),
          h('div.grow.minw-0', {},
            h('strong.text-m', {}, r.label || r.id),
            h('div.fnt.text-s', {}, 'when ', h('code.pill-perm', {}, r.on || '—'), ` → ${(r.actions || []).length} step(s): `, (r.actions || []).map(a => a.type).join(' → ') || 'none')),
          h('button.btn.ghost.small', { onclick: () => openBuilder(r) }, 'Edit'),
          h('button.icon-btn', { title: 'Delete', onclick: async () => { if (await confirmDialog('Delete recipe?', `“${r.label}” stops running immediately.`)) { await del(`/res/automations/recipes/${r.id}`); refreshList() } }, html: icon('trash', 13) }))))
          : emptyState(icon('bolt', 26), 'No recipes yet', 'When something happens on the site, do something about it — automatically.'))
    }

    const refreshRuns = async () => {
      const { items } = await get('/x/automations/runs').catch(() => ({ items: [] }))
      runsHolder.replaceChildren(items.length
        ? h('div.stack-1', {}, ...items.slice(0, 30).map(row => {
          const run = row.data || row
          const failed = (run.steps || []).some(st => st.error)
          return h('details.card.p-2-4', {},
            h('summary.clickable.d-flex.gap-3.items-center.text-s', {},
              h('span', { style: { color: failed ? 'var(--err-ink)' : 'var(--ok-ink)', display: 'inline-flex' }, html: icon(failed ? 'x' : 'check', 13) }),
              h('strong', {}, run.label || run.recipe || 'run'),
              run.test ? h('span.mrow-tag', {}, 'test') : '',
              h('code.pill-perm', {}, run.event || ''),
              h('span.fnt.ml-auto.text-xs', {}, `${run.ms ?? '—'}ms · ${fmtDate(row.createdAt)}`)),
            h('div.stack-1.mt-2', {},
              ...(run.steps || []).map(st => h('div.text-s.d-flex.gap-2.items-baseline', {},
                h('code.pill-perm', {}, st.type),
                st.error ? h('span.txt-err', {}, st.error)
                  : h('span.mut', {}, st.result ? JSON.stringify(st.result).slice(0, 160) : 'ok')))))
        }))
        : h('p.fnt.text-s', {}, 'No runs yet — they appear here the moment a recipe fires (test runs included).'))
    }

    function openBuilder(existing) {
      const r = existing ? JSON.parse(JSON.stringify(existing)) : { label: '', on: 'form.submitted', filter: '', actions: [], enabled: true }
      r.actions ??= []
      let payloadText = (EVENTS.find(ev => ev[0] === r.on)?.[2]) || '{}'
      const stepsHolder = h('div.stack-2', {})
      const testOut = h('div')

      const paintSteps = () => {
        stepsHolder.replaceChildren(
          ...r.actions.map((a, i) => {
            const def = actions.find(x => x.type === a.type)
            const opts = typeof a.options === 'string' ? (JSON.parse(a.options || '{}') || {}) : (a.options ??= {})
            a.options = opts
            return h('div.card.p-3-4', {},
              h('div.row.mb-2', {},
                h('span.step-n', {}, String(i + 1)),
                h('select.input.grow.text-m', { onchange: e => { a.type = e.target.value; a.options = {}; paintSteps() } }, ...actions.map(x => h('option', { value: x.type, selected: a.type === x.type }, x.label))),
                h('button.icon-btn', { title: 'Move up', onclick: () => { if (i > 0) { r.actions.splice(i - 1, 0, r.actions.splice(i, 1)[0]); paintSteps() } }, html: icon('back', 12, 'rot90') }),
                h('button.icon-btn', { title: 'Remove step', onclick: () => { r.actions.splice(i, 1); paintSteps() }, html: icon('trash', 13) })),
              def?.fields?.length
                ? renderFields(def.fields.map(f => ({ ...f, type: f.type === 'json' ? 'json' : f.type || 'text' })), opts, () => {})
                : renderFields([{ key: '__json', type: 'json', label: 'Options (JSON)' }], { __json: opts }, (k, v) => { if (v && typeof v === 'object') a.options = v }))
          }),
          h('button.tree-add', { onclick: () => { r.actions.push({ type: actions[0]?.type || 'log', options: {} }); paintSteps() } }, '＋ Add step'))
      }

      // variable chips — click to drop {{event.x}} into the last-focused input.
      // The whole point: nobody should have to guess what the payload holds.
      let lastInput = null
      stepsHolder.addEventListener('focusin', e => {
        if (e.target.matches('input[type=text], input:not([type]), textarea')) lastInput = e.target
      })
      const varChips = h('div.d-flex.gap-1.wrap.mt-2', {})
      const paintVars = () => {
        let payload = {}
        try { payload = JSON.parse(payloadText || '{}') } catch {}
        const paths = []
        const walk = (obj, prefix) => {
          for (const [k, v] of Object.entries(obj || {})) {
            const p2 = prefix ? `${prefix}.${k}` : k
            if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p2)
            else paths.push(p2)
          }
        }
        walk(payload, '')
        varChips.replaceChildren(
          h('span.fnt.text-xs', {}, 'Insert into a step: '),
          ...paths.slice(0, 12).map(p2 => h('button.pill-perm.clickable', { title: `Insert {{event.${p2}}} into the focused field`, onclick: () => {
              const token = `{{event.${p2}}}`
              if (lastInput) {
                const st = lastInput.selectionStart ?? lastInput.value.length
                lastInput.value = lastInput.value.slice(0, st) + token + lastInput.value.slice(lastInput.selectionEnd ?? st)
                lastInput.dispatchEvent(new Event('input', { bubbles: true }))
                lastInput.focus()
              } else { navigator.clipboard?.writeText(token); toast(`Copied ${token}`, 'ok', 1500) }
            } }, `{{event.${p2}}}`)))
      }

      const payloadArea = h('textarea.input.mono', { rows: 5, value: payloadText, oninput: e => { payloadText = e.target.value; paintVars() } })
      const evSelect = h('select.input.text-m', { onchange: e => {
          r.on = e.target.value
          const sample = EVENTS.find(ev => ev[0] === r.on)?.[2]
          if (sample) { payloadText = sample; payloadArea.value = sample }
          paintVars()
        } },
        ...EVENTS.map(([ev, label]) => h('option', { value: ev, selected: r.on === ev }, `${label}  (${ev})`)),
        h('option', { value: r.on, selected: !EVENTS.some(ev => ev[0] === r.on), hidden: EVENTS.some(ev => ev[0] === r.on) }, r.on))

      const doDry = async () => {
        let payload
        try { payload = JSON.parse(payloadText || '{}') } catch { toast('Sample payload is not valid JSON', 'err'); return }
        const res = await post('/x/automations/dryrun', { recipe: r, payload })
        testOut.replaceChildren(
          h('p.text-s.m-2-0-1', {},
            'Condition: ', res.condition ? h('strong.txt-ok', {}, 'matches — recipe would run') : h('strong.txt-warn', {}, 'does not match — recipe would be skipped')),
          ...res.steps.map((st, i) => h('div.card.p-2-3.mb-1', {},
            h('div.text-s.fw-semi.mb-0', {}, `${i + 1}. ${st.label}`, st.known ? '' : h('span.txt-err', {}, '  (unknown action!)')),
            h('pre.code-out.text-xs.m-0.pre-wrap', {}, JSON.stringify(st.resolved, null, 1)))))
      }
      const doTest = async () => {
        let payload
        try { payload = JSON.parse(payloadText || '{}') } catch { toast('Sample payload is not valid JSON', 'err'); return }
        testOut.replaceChildren(h('div.spin'))
        const { run } = await post('/x/automations/testrun', { recipe: r, payload })
        const failed = (run.steps || []).some(st => st.error)
        testOut.replaceChildren(
          h('p.runout-line', { style: { color: failed ? 'var(--err-ink)' : 'var(--ok-ink)' } },
            failed ? 'Ran with errors' : `Ran clean in ${run.ms}ms`),
          ...(run.steps || []).map(st => h('div.text-s.d-flex.gap-2', {},
            h('code.pill-perm', {}, st.type),
            st.error ? h('span.txt-err', {}, st.error) : h('span.mut', {}, st.result ? JSON.stringify(st.result).slice(0, 140) : 'ok'))))
        refreshRuns()
      }

      paintVars()
      dialog({
        title: existing ? 'Edit recipe' : 'New recipe',
        width: 'min(46rem, 96vw)',
        body: h('div', {},
          renderFields([{ key: 'label', type: 'text', label: 'Name', required: true }], r, () => {}),
          h('div.field', {}, h('label', {}, h('span', {}, 'When this happens'), h('span.help', {}, 'The trigger event')), evSelect, varChips),
          renderFields([{ key: 'filter', type: 'json', label: 'Only if (filter)', help: 'Payload must match, e.g. {"formId":"contact"} — blank runs always' }], r, () => {}),
          h('div.insp-section-title.mt-4', {}, 'Do these steps'),
          stepsHolder,
          h('details.mt-4', {},
            h('summary.clickable.text-m.fw-semi.mut', {}, 'Test before saving'),
            h('div.field.mt-2', {}, h('label', {}, h('span', {}, 'Sample payload'), h('span.help', {}, 'What the event would deliver')), payloadArea),
            h('div.d-flex.gap-2', {},
              h('button.btn.ghost.small', { onclick: doDry }, iconEl('eye', 13), 'Preview steps (no side effects)'),
              h('button.btn.soft.small', { onclick: doTest }, iconEl('play', 13), 'Run for real')),
            testOut)),
        actions: [{
          label: 'Save recipe', kind: 'primary', onClick: async () => {
            if (!r.label) { toast('Give the recipe a name', 'err'); return false }
            await post('/res/automations/recipes', r)
            refreshList(); return true
          },
        }],
      })
      paintSteps()
    }

    const hooksHolder = h('div')
    const refreshHooks = async () => {
      const { hooks } = await get('/x/automations/hooks').catch(() => ({ hooks: {} }))
      const entries = Object.entries(hooks || {})
      hooksHolder.replaceChildren(
        h('p.fnt.text-s.mb-2', {}, 'Inbound URLs — POST JSON at them from anywhere (Zapier, CRMs, CI) to fire ', h('code.pill-perm', {}, 'webhook.received'), ' recipes.'),
        ...entries.map(([k, secret]) => h('div.row.text-s.mb-1', {},
          h('code.pill-perm', {}, k),
          h('code.text-xs.ovh.tov-ellipsis.nowrap.grow', {}, `${state.meta.site.url}/x/automations/hook/${k}?s=${secret}`),
          h('button.icon-btn', { title: 'Copy URL', onclick: () => { navigator.clipboard?.writeText(`${state.meta.site.url}/x/automations/hook/${k}?s=${secret}`); toast('Copied', 'ok') }, html: icon('copy', 13) }))),
        h('button.btn.ghost.small', {
          onclick: async () => {
            const key = prompt('Hook key (a-z, 0-9, dashes):', 'crm')
            if (!key) return
            await post('/x/automations/hooks', { key })
            refreshHooks()
          },
        }, '＋ New inbound hook'))
    }

    wrap.replaceChildren(
      h('div.page-head.mb-3', {},
        h('div', {}, h('p.sub', {}, 'When something happens on the site, do something about it. Preview any recipe against a sample payload before it ever runs for real.')),
        h('button.btn.primary', { onclick: () => openBuilder(null) }, '＋ New recipe')),
      listHolder,
      h('h2.text-l.m-5-0-2', {}, 'Inbound webhooks'),
      h('div.card.p-4-4', {}, hooksHolder),
      h('h2.text-l.m-5-0-2', {}, 'Recent runs'),
      runsHolder)
    refreshList(); refreshRuns(); refreshHooks()
    return wrap
  }, { replaces: true }),

  forms: async () => {
    const holder = h('div')
    const { items } = await get('/x/forms/submissions').catch(() => ({ items: [] }))
    holder.replaceChildren(items.length ? h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Form'), h('th', {}, 'Data'), h('th', {}, 'When'))),
      h('tbody', {}, ...items.slice(0, 100).map(sItem => h('tr', {},
        h('td', {}, sItem.form), h('td.mono.text-s.pre-wrap', {}, JSON.stringify(sItem.data)),
        h('td.fnt', {}, fmtDate(sItem.createdAt)))))))
      : emptyState(icon('form', 26), 'No submissions yet', ''))
    return h('div.card', {}, h('strong', {}, 'Submissions'), h('div.mt-3', {}, holder))
  },

  files: async () => {
    const list = h('div')
    const linkOut = h('div')
    const refresh = async () => {
      const [{ files }, { links }] = await Promise.all([get('/x/files/files'), get('/x/files/links')])
      list.replaceChildren(
        h('p.sub.mb-2', {}, 'Files in the private area (upload via Media with “private”, or drop into media/private/):'),
        files.length ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Size'), h('th', {}, ''))),
          h('tbody', {}, ...files.map(f => h('tr', {},
            h('td.mono.text-s', {}, f.key), h('td.mut', {}, humanSize(f.size)),
            h('td.ta-r', {}, h('button.btn.soft.small', { onclick: () => issue(f.key) }, 'Create link')))))))
          : emptyState(icon('download', 26), 'No private files yet', 'Upload to media/private/ to deliver files securely.'),
        links.length ? h('div.mt-4', {}, h('strong', {}, 'Active links'),
          h('div.table-wrap.mt-2', {}, h('table.data-table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Label'), h('th', {}, 'Uses'), h('th', {}, 'Signatures'), h('th', {}, ''))),
            h('tbody', {}, ...links.map(l => h('tr', {},
              h('td', {}, l.label, h('div.row-sub', {}, l.file)),
              h('td', {}, `${l.uses}${l.maxUses ? `/${l.maxUses}` : ''}`),
              h('td.mut', {}, (l.signatures || []).map(sg => sg.name).join(', ') || '—'),
              h('td.ta-r', {}, h('button.icon-btn', {
                title: 'Revoke this link', 'aria-label': `Revoke the link for ${l.label}`,
                // Revoking kills a signed URL that may already be in someone's
                // inbox, and cannot be undone — every other delete in this file
                // confirms; this one used to fire on a single click.
                onclick: async () => {
                  const ok = await confirmDialog('Revoke this link?',
                    `Anyone holding the link to “${l.label}” stops being able to download it, including people you have already sent it to. This cannot be undone.`,
                    'Revoke link')
                  if (!ok) return
                  await del(`/x/files/links/${l.id}`)
                  toast('Link revoked', 'ok')
                  refresh()
                },
              }, iconEl('trash', 14))))))))) : '')
    }
    const issue = file => {
      const vals = { file, label: file, oneTime: false, expiresDays: 7, requireSignature: false, email: '' }
      dialog({
        title: 'Create delivery link',
        body: [renderFields([
          { key: 'label', type: 'text', label: 'Label' },
          { key: 'expiresDays', type: 'number', label: 'Expires (days)', width: 'half' },
          { key: 'oneTime', type: 'boolean', label: 'One-time link', width: 'half' },
          { key: 'requireSignature', type: 'boolean', label: 'Require name + signature before download' },
          { key: 'email', type: 'text', label: 'Email it to (optional)' },
        ], vals, () => {}), linkOut],
        actions: [{
          label: 'Create link', kind: 'primary', onClick: async () => {
            const r = await post('/x/files/links', vals)
            linkOut.replaceChildren(h('p.dlg-text', {}, 'Share this URL:'), h('div.code-out', {}, r.url))
            refresh()
            return false // keep dialog open so the URL can be copied
          },
        }],
      })
    }
    refresh()
    return h('div.card', {}, h('strong', {}, 'Private files & delivery links'), h('div.mt-3', {}, list))
  },

  newsletter: async () => {
    const listSel = h('select.input.mw-14', {})
    const out = h('div')
    const { items: lists } = await get('/res/newsletter/lists').catch(() => ({ items: [] }))
    listSel.replaceChildren(...lists.map(l => h('option', { value: l.id }, l.label)))
    const refresh = async () => {
      if (!listSel.value) { out.replaceChildren(emptyState(icon('mail', 26), 'Create a list above first', '')); return }
      const { items } = await get(`/x/newsletter/subscribers?list=${listSel.value}`)
      out.replaceChildren(h('div.table-wrap', {}, h('table.data-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Status'), h('th', {}, 'Since'))),
        h('tbody', {}, ...items.map(sub => h('tr', {},
          h('td', {}, sub.email), h('td', {}, h('span.chip', { class: sub.status === 'confirmed' ? 'published' : 'draft' }, sub.status)),
          h('td.fnt', {}, fmtDate(sub.createdAt))))))))
    }
    listSel.addEventListener('change', refresh)
    refresh()
    const campaign = () => {
      const vals = { subject: '', md: '', test: '' }
      dialog({
        title: 'Send campaign',
        width: 'min(38rem, 94vw)',
        body: renderFields([
          { key: 'subject', type: 'text', label: 'Subject', required: true },
          { key: 'md', type: 'markdown', label: 'Body (markdown)', rows: 8 },
          { key: 'test', type: 'text', label: 'Send test to (optional)', help: 'If set, only this address receives it' },
        ], vals, () => {}),
        actions: [{
          label: 'Send', kind: 'primary', onClick: async () => {
            const r = await post('/x/newsletter/campaign', { listId: listSel.value, ...vals })
            toast(`Sent to ${r.sent}/${r.of}`, 'ok'); return true
          },
        }],
      })
    }
    return h('div.card', {},
      h('div.card-head.mb-2', {}, h('strong', {}, 'Subscribers'),
        h('div.d-flex.gap-2', {}, listSel, h('button.btn.primary.small', { onclick: campaign }, 'Send campaign…'))),
      out)
  },

  data: async () => (DATA_SECTIONS.data ? DATA_SECTIONS.data() : h('div.card', {}, emptyState(icon('db', 26), 'Data module loading…', ''))),

  ai: async () => {
    const cfg = await get('/x/ai/config').catch(() => ({}))
    const vals = { endpoint: cfg.endpoint || '', model: cfg.model || '', apiKey: '' }
    const test = h('div')
    return h('div.card', {},
      h('strong', {}, 'Endpoint'),
      h('p.sub.m-0-0-3', {}, 'Any OpenAI-compatible API (OpenAI, Anthropic gateways, Ollama, LM Studio, your own agent). Powers ✦ buttons in the editor and the ai.generate automation action.'),
      renderFields([
        { key: 'endpoint', type: 'text', label: 'Base URL', help: 'e.g. https://api.openai.com/v1 or http://localhost:11434/v1' },
        { key: 'model', type: 'text', label: 'Model', width: 'half' },
        { key: 'apiKey', type: 'text', label: cfg.hasKey ? 'API key (set — enter to replace)' : 'API key', width: 'half' },
      ], vals, () => {}),
      h('div.d-flex.gap-2', {},
        h('button.btn.primary.small', { onclick: async () => { await put('/x/ai/config', vals); toast('Saved', 'ok') } }, 'Save'),
        h('button.btn.ghost.small', {
          onclick: async () => {
            test.replaceChildren(spinner())
            try { const r = await post('/x/ai/assist', { task: 'improve', text: 'blockhouse is site builder which am good' }); test.replaceChildren(h('p.dlg-text', {}, '✓ ', r.result)) }
            catch (e) { test.replaceChildren(h('p.dlg-text.txt-err', {}, String(e.message))) }
          },
        }, 'Test')),
      test)
  },

  search: async () => {
    const out = h('div')
    const refresh = async () => {
      const s = await get('/x/search/stats').catch(() => ({ entries: 0 }))
      out.replaceChildren(h('div.stat', {}, h('span.n', {}, String(s.entries)), h('span.l', {}, 'Indexed pages')))
    }
    refresh()
    return h('div.card', {},
      h('div.card-head.mb-2', {},
        h('div', {}, h('strong', {}, 'Search index'), h('p.sub', {}, 'Rebuilds automatically on publish. Drop a Search block on any page, or export a static index.json for flat builds.')),
        h('button.btn.ghost.small', { onclick: async () => { const r = await post('/x/search/reindex'); toast(`Reindexed ${r.entries} pages`, 'ok'); refresh() } }, iconEl('refresh', 14), 'Reindex')),
      out)
  },

  integrations: async () => {
    const holder = h('div', {}, skeleton('rows', 5))
    const refresh = async () => {
      const { connectors } = await get('/x/integrations/connectors')
      holder.replaceChildren(...connectors.map(cn => {
        const vals = {}
        for (const st of cn.settings) vals[st.key] = st.value
        const status = h('span.chip', { class: cn.connected ? 'published' : 'draft' }, cn.connected ? 'connected' : 'not connected')
        const testOut = h('div.fnt.text-s.mt-2', {})

        const runAction = a => {
          const opts = {}
          const out = h('div')
          dialog({
            title: `Run ${a.label}`,
            width: 'min(34rem, 94vw)',
            body: h('div', {},
              h('p.dlg-text', {}, 'Executes for real against the connected account — a live test bench for this action.'),
              (a.fields || []).length
                ? renderFields(a.fields.map(f => ({ ...f, type: f.type || 'text' })), opts, () => {})
                : h('p.fnt.text-s', {}, 'This action takes no options.'),
              out),
            actions: [{
              label: 'Run now', kind: 'primary', onClick: async () => {
                out.replaceChildren(h('div.spin'))
                const r = await post(`/x/integrations/connectors/${cn.id}/run`, { action: a.key.split('.').pop(), options: opts })
                out.replaceChildren(
                  h('p.runout-line', { style: { color: r.ok ? 'var(--ok-ink)' : 'var(--err-ink)' } },
                    r.ok ? `✓ Succeeded in ${r.ms}ms` : `✗ ${r.error}`),
                  r.result !== undefined ? h('pre.code-out.text-xs.mh-12.ova.pre-wrap', {}, JSON.stringify(r.result, null, 1)) : '')
                return false   // keep the dialog open to read the result
              },
            }],
          })
        }
        const actionsList = cn.actions.length
          ? h('details.mt-3', {},
            h('summary.clickable.text-s.mut', {}, `${cn.actions.length} automation action(s) — click to test any of them`),
            h('div.mt-2', {}, ...cn.actions.map(a =>
              h('div.row.p-1-0.bb-soft', {},
                h('code.pill-perm', {}, a.key),
                h('span.fnt.text-s.grow', {}, a.description || a.label),
                h('button.btn.ghost.small', { onclick: () => runAction(a) }, iconEl('play', 12), 'Run…')))))
          : ''

        return h('div.card.mb-4', {},
          h('div.card-head.mb-2', {},
            h('div.d-flex.gap-3.items-start', {},
              h('span.txt-acc.mt-0', {}, iconEl(cn.icon || 'plug', 20)),
              h('div', {}, h('strong', {}, cn.name, cn.custom ? h('span.mrow-tag.ml-2', {}, 'custom') : ''),
                h('p.sub', {}, cn.description),
                cn.identity ? h('p.fnt.text-s', {}, `Signed in as ${cn.identity}`) : '')),
            h('div.row', {},
              cn.custom ? h('button.icon-btn', { title: 'Edit definition', onclick: () => editCustom(cn.id), html: icon('pen', 14) }) : '',
              cn.custom ? h('button.icon-btn', { title: 'Delete connector', onclick: async () => { if (await confirmDialog('Delete connector?', `“${cn.name}” and its actions are removed.`)) { await del(`/x/integrations/custom/${cn.id}`); refresh() } }, html: icon('trash', 14) }) : '',
              status)),
          cn.docs ? h('p.fnt.text-s.mb-2', {}, cn.docs) : '',
          cn.auth === 'oauth2' ? h('div.mb-2', {},
            h('span.fnt.text-s', {}, 'Redirect URI: '), h('code.pill-perm', {}, cn.redirectUri)) : '',
          renderFields(cn.settings.map(st => ({
            key: st.key, label: st.label, type: st.type === 'select' ? 'text' : 'text', help: st.help,
            width: cn.settings.length > 2 ? 'half' : undefined,
          })), vals, () => {}),
          cn.scopes?.length ? h('p.fnt.text-xs.mb-2', {}, 'Scopes: ', ...cn.scopes.map(sc => h('code.pill-perm', {}, sc.replace('https://www.googleapis.com/auth/', '')))) : '',
          h('div.d-flex.gap-2.wrap', {},
            h('button.btn.ghost.small', { onclick: async () => { await put(`/x/integrations/connectors/${cn.id}`, vals); toast('Saved', 'ok'); refresh() } }, 'Save settings'),
            cn.auth === 'oauth2'
              ? (cn.connected
                ? h('button.btn.ghost.small', { onclick: async () => { await post(`/x/integrations/connectors/${cn.id}/disconnect`); toast('Disconnected', 'ok'); refresh() } }, 'Disconnect')
                : h('button.btn.primary.small', { onclick: async () => {
                  await put(`/x/integrations/connectors/${cn.id}`, vals)
                  try {
                    const r = await post(`/x/integrations/connectors/${cn.id}/connect`)
                    window.open(r.url, '_blank', 'width=560,height=720')
                    toast('Complete the sign-in in the popup, then refresh', 'ok', 6000)
                  } catch {}
                } }, iconEl('link', 13), 'Connect'))
              : '',
            h('button.btn.ghost.small', { onclick: async () => {
              testOut.textContent = 'Testing…'
              const r = await post(`/x/integrations/connectors/${cn.id}/test`).catch(() => ({ ok: false, detail: 'request failed' }))
              testOut.textContent = (r.ok ? '✓ ' : '✗ ') + r.detail
              testOut.style.color = r.ok ? 'var(--ok-ink)' : 'var(--err-ink)'
            } }, 'Test')),
          testOut, actionsList)
      }))
    }
    async function editCustom(id) {
      const { defs } = await get('/x/integrations/custom')
      openCustomBuilder(defs.find(d => d.id === id))
    }

    function openCustomBuilder(existing) {
      const def = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: '', name: '', description: '', icon: 'plug', auth: 'apikey', settings: [], actions: [],
      }
      def.actions ??= []
      const actionsHolder = h('div.stack-2', {})
      const paintActs = () => actionsHolder.replaceChildren(
        ...def.actions.map((a, i) => h('details.card.p-3-4', { open: !a.key },
          h('summary.row.clickable.text-m.fw-semi', {},
            a.label || a.key || 'New action',
            h('span.grow', {}),
            h('button.icon-btn', { onclick: e => { e.preventDefault(); def.actions.splice(i, 1); paintActs() }, html: icon('trash', 12) })),
          renderFields([
            { key: 'key', type: 'text', label: 'Key', required: true, width: 'half', help: 'becomes <id>.<key> in automations' },
            { key: 'label', type: 'text', label: 'Label', width: 'half' },
            { key: 'method', type: 'select', label: 'Method', options: [{ value: 'POST' }, { value: 'GET' }, { value: 'PUT' }, { value: 'PATCH' }, { value: 'DELETE' }], width: 'half' },
            { key: 'url', type: 'text', label: 'URL template', required: true, help: '{opts.x} · {payload.x} · {config.x} interpolate' },
            { key: 'headers', type: 'json', label: 'Headers (JSON)', help: '{"content-type":"application/json"}' },
            { key: 'body', type: 'textarea', label: 'Body template', rows: 3, help: 'Same placeholders. Blank sends no body.' },
            { key: 'fields', type: 'json', label: 'Option fields (JSON)', help: '[{"key":"text","label":"Message","required":true}] — becomes the form in Automations' },
          ], a, () => {}))),
        h('button.tree-add', { onclick: () => { def.actions.push({ key: '', label: '', method: 'POST', url: '' }); paintActs() } }, '＋ Add action'))

      dialog({
        title: existing ? `Edit ${def.name || def.id}` : 'New custom connector',
        width: 'min(44rem, 96vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'Point Blockhouse at any HTTP API. Auth is applied for you; each action becomes an automation step and gets a test bench above.'),
          renderFields([
            { key: 'id', type: 'text', label: 'ID', required: true, width: 'half', help: 'lowercase — cannot change later' },
            { key: 'name', type: 'text', label: 'Name', required: true, width: 'half' },
            { key: 'description', type: 'text', label: 'Description' },
            { key: 'auth', type: 'select', label: 'Authentication', required: true, options: [
              { value: 'apikey', label: 'API key (bearer / header / basic)' },
              { value: 'webhook', label: 'Webhook URL (no auth headers)' },
              { value: 'none', label: 'None (public API)' },
            ], width: 'half' },
            { key: 'testUrl', type: 'text', label: 'Test URL (optional)', width: 'half', help: 'GET this to verify the connection' },
            { key: 'docs', type: 'text', label: 'Setup note shown on the card' },
          ], def, (k, v) => { if (k === 'id' && !existing) def.id = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-') }),
          h('div.insp-section-title.mt-3', {}, 'Actions'),
          actionsHolder),
        actions: [{
          label: 'Save connector', kind: 'primary', onClick: async () => {
            if (!def.id || !def.name) { toast('ID and name are required', 'err'); return false }
            for (const a of def.actions) {
              if (typeof a.headers === 'string') { try { a.headers = JSON.parse(a.headers || '{}') } catch { toast(`Action ${a.key}: headers are not valid JSON`, 'err'); return false } }
              if (typeof a.fields === 'string') { try { a.fields = JSON.parse(a.fields || '[]') } catch { toast(`Action ${a.key}: fields are not valid JSON`, 'err'); return false } }
            }
            await put(`/x/integrations/custom/${def.id}`, { def })
            toast('Connector saved — its actions are live in Automations', 'ok', 4000)
            refresh(); return true
          },
        }],
      })
      paintActs()
    }

    refresh()
    return h('div', {},
      h('div.page-head.mb-3', {},
        h('div', {}, h('p.sub', {}, 'Connect once here; every connector’s actions then appear in Automations recipes as ', h('code.pill-perm', {}, 'connector.action'), ' — and each has a live test bench.')),
        h('button.btn.primary', { onclick: () => openCustomBuilder(null) }, '＋ Custom connector')),
      holder)
  },

  members: async () => {
    const listHolder = h('div', {}, skeleton('rows', 5))
    const refresh = async () => {
      const [{ members }, { items: groups }] = await Promise.all([
        get('/x/members/list'),
        get('/res/members/groups').catch(() => ({ items: [] })),
      ])
      listHolder.replaceChildren(members.length
        ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Member'), h('th', {}, 'Groups'), h('th', {}, 'Status'), h('th', {}, 'Joined'), h('th'))),
          h('tbody', {}, ...members.map(m => h('tr', { onclick: () => editMember(m, groups) },
            h('td', {}, h('strong', {}, m.name || '—'), h('div.row-sub', {}, m.email)),
            h('td', {}, (m.groups || []).map(g => h('span.multi-tag.mr-0', {}, g))),
            h('td', {}, h('span.chip', { class: m.status === 'active' ? 'published' : m.status === 'pending' ? 'review' : 'err' }, m.status)),
            h('td.fnt', {}, fmtDate(m.createdAt)),
            h('td.ta-r', {}, h('button.icon-btn', {
              onclick: async e => { e.stopPropagation(); if (await confirmDialog('Remove member', `Delete ${m.email}?`)) { await del(`/x/members/${m.id}`); refresh() } },
            }, iconEl('trash', 14)))))
          )))
        : emptyState(icon('users', 26), 'No members yet', 'Add a “Sign in / register” block to a page — /account is a good home.'))
    }
    const editMember = (m, groups) => {
      const vals = { name: m.name || '', status: m.status, groups: (m.groups || []).join(', '), password: '' }
      dialog({
        title: m.email,
        body: renderFields([
          { key: 'name', type: 'text', label: 'Name' },
          { key: 'status', type: 'select', label: 'Status', options: [{ value: 'active' }, { value: 'pending' }, { value: 'blocked' }], width: 'half' },
          { key: 'groups', type: 'text', label: 'Groups (comma separated)', help: groups.length ? `Available: ${groups.map(g => g.id).join(', ')}` : 'Create groups above first' },
          { key: 'password', type: 'text', label: 'Set a new password' },
        ], vals, () => {}),
        actions: [{ label: 'Save', kind: 'primary', onClick: async () => {
          await patch(`/x/members/${m.id}`, { name: vals.name, status: vals.status, groups: vals.groups.split(',').map(g => g.trim()).filter(Boolean), ...(vals.password ? { password: vals.password } : {}) })
          refresh(); return true
        } }],
      })
    }
    refresh()

    const settings = await get('/x/members/settings').catch(() => ({}))
    const sVals = { allowSignup: settings.allowSignup !== false, requireApproval: !!settings.requireApproval, loginPath: settings.loginPath || '/account' }
    return h('div', {},
      h('div.card.mb-4', {},
        h('div.card-head.mb-3', {},
          h('div', {}, h('strong', {}, 'Membership settings')),
          h('button.btn.ghost.small', { onclick: async () => { await put('/x/members/settings', sVals); toast('Saved', 'ok') } }, 'Save')),
        renderFields([
          { key: 'allowSignup', type: 'boolean', label: 'Allow public sign-ups' },
          { key: 'requireApproval', type: 'boolean', label: 'New accounts need approval' },
          { key: 'loginPath', type: 'text', label: 'Account page path', help: 'Where gated pages send visitors, and where sign-in lands', width: 'half' },
        ], sVals, () => {}),
        h('p.fnt.text-s', {}, 'Gate a page in the editor: Page tab → Access. Members are separate from studio users — they never see the admin.')),
      h('div.card', {}, h('strong', {}, 'Members'), h('div.mt-3', {}, listHolder)))
  },

  analytics: async () => {
    const holder = h('div', {}, skeleton('rows', 5))
    let days = 30

    const load = () => {
      get(`/x/analytics/summary?days=${days}`).then(data => {
        const maxV = Math.max(1, ...data.series.map(d => d.views))
        const w = 640, chartH = 150, n = data.series.length, bw = w / n
        const bars = data.series.map((d, i) => {
          const bh = (d.views / maxV) * chartH
          const x = i * bw
          return `<rect x="${x + 1}" y="${chartH - bh}" width="${Math.max(bw - 2, 1)}" height="${Math.max(bh, 1)}" rx="2" fill="var(--acc)" opacity="0.85"><title>${d.day}: ${d.views} views</title></rect>`
        }).join('')
        const chart = h('div.mt-2', {})
        chart.innerHTML = `<svg viewBox="0 0 ${w} ${chartH + 18}" width="100%" role="img" aria-label="Views over time"><g>${bars}</g><text x="0" y="${chartH + 14}" font-size="11" fill="var(--fnt)">${data.series[0]?.day || ''}</text><text x="${w}" y="${chartH + 14}" font-size="11" fill="var(--fnt)" text-anchor="end">${data.series[n - 1]?.day || ''}</text></svg>`

        const list = (title, rows, fmt) => h('div.card', {}, h('strong', {}, title),
          rows.length ? h('div.mt-2', {}, ...rows.map(r => h('div.d-flex.justify-between.p-1-0.bb-soft.text-m', {}, h('span.ovh.tov-ellipsis.nowrap', {}, fmt(r.k)), h('strong', {}, String(r.n)))))
            : h('p.mut.mt-2', {}, 'No data yet.'))

        const avg = n ? Math.round(data.totalViews / n) : 0
        const best = data.series.reduce((a, b) => (b.views > (a?.views || 0) ? b : a), null)
        holder.replaceChildren(
          h('div.cards.mb-4', {},
            h('div.card.stat', {}, h('span.n', {}, String(data.totalViews)), h('span.l', {}, `Views (${days}d)`)),
            h('div.card.stat', {}, h('span.n', {}, String(data.totalVisitors)), h('span.l', {}, `Visitors (${days}d)`)),
            h('div.card.stat', {}, h('span.n', {}, String(avg)), h('span.l', {}, 'Avg / day')),
            h('div.card.stat', {}, h('span.n', {}, String(best?.views || 0)), h('span.l', {}, best ? `Best day · ${best.day.slice(5)}` : 'Best day'))),
          h('div.card.mb-4', {}, h('strong', {}, 'Views over time'), chart),
          h('div.cards', {},
            list('Top pages', data.topPages, k => k),
            list('Referrers', data.topReferrers, k => k)))
      }).catch(() => holder.replaceChildren(h('p.mut', {}, 'No analytics yet — the beacon records views on the live site.')))
    }
    load()

    const seg = h('div.seg', {}, ...[7, 30, 90].map(d => h('button', {
      class: d === days ? 'active' : '',
      onclick: e => {
        days = d
        for (const b of seg.children) b.classList.toggle('active', b === e.currentTarget)
        holder.replaceChildren(skeleton('rows', 5)); load()
      },
    }, `${d} days`)))

    return h('div', {},
      h('div.page-head.mb-4', {},
        h('p.sub', {}, 'Cookieless and privacy-first: no cross-site identifiers, no PII — just salted daily counts.'),
        h('div.row', {}, seg,
          h('a.btn.ghost.small', { href: `/api/x/analytics/export.csv?days=90`, download: 'analytics.csv' }, iconEl('download', 13), 'CSV'))),
      holder)
  },

  // Versions & backups, in the words of the person running the site rather
  // than the tools underneath. Git is how it works, never what it says: a
  // commit is "a saved version", a tag is "a named version", and going back
  // to a version is itself a new saved version — one timeline, nothing lost.
  ops: Object.assign(async () => {
    const versionsHolder = h('div', {}, skeleton('rows', 4))
    const backupsHolder = h('div', {}, skeleton('rows', 4))
    const canRestore = state.user.role === 'admin' || state.user.role === 'owner' || (state.user.grants || []).includes('settings.write')
    const when = at => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    const said = m => (/^Saved from the studio/.test(m || '') ? 'saved from the studio' : m)

    /** Server messages are written for developers; say what they mean here. */
    const plain = msg => {
      const m = String(msg || '')
      if (/not a git repository|no filesystem/.test(m)) return 'Saving versions isn’t set up for this site. Whoever looks after the server can turn it on.'
      if (/invalid version name/.test(m)) return 'Use lowercase letters, numbers and dashes for the name.'
      if (/backups are disabled/.test(m)) return 'Backups are turned off — turn them on under Settings → Apps → Backups.'
      if (/permission required/.test(m)) return 'Only an owner or admin can do that.'
      if (/Permission denied|EACCES|unable to (write|create)/i.test(m)) return `The server would not let the studio write to the version history. Tell whoever looks after the server; the exact message was: ${m}`
      return m
    }
    const call = (path, body) => api(path, { method: 'POST', body: body || {}, quiet: true }).catch(e => ({ error: plain(e.data?.error || e.message) }))

    // A failure in a safety control must stay on screen, not flash past in a toast.
    const problem = h('div.notice.notice-err.mb-3', { hidden: true })
    const showProblem = text => { problem.textContent = text; problem.hidden = !text }

    const nameInput = h('input.input.w-full', { placeholder: 'Name it (optional) — e.g. before-price-changes', 'aria-label': 'Version name', maxlength: 40 })

    const refreshVersions = async () => {
      const v = await api('/x/ops/versions', { quiet: true }).catch(e => ({ git: false, why: e.data?.error || e.message }))
      if (!v.git) {
        versionsHolder.replaceChildren(emptyState(icon('warn', 22), 'Saving versions isn’t set up here',
          'This site’s files aren’t being kept in version history. Whoever looks after the server can turn it on — backups below still work.'))
        return
      }
      const save = h('button.btn.primary', { onclick: async e => {
        const b = e.currentTarget; b.disabled = true; showProblem('')
        const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-')
        const res = await call('/x/ops/sync', name ? { name } : {})
        b.disabled = false
        if (res.error) return showProblem(`Could not save: ${res.error}`)
        if (res.synced) toast(res.named ? `Saved as “${res.named}”` : 'Saved — this is now a version you can come back to', 'ok', 4000)
        else if (res.named) toast(`Nothing had changed, so the current version is now called “${res.named}”`, 'ok', 5000)
        else toast('Nothing has changed since the last saved version', undefined, 4000)
        nameInput.value = ''
        refreshVersions()
      } }, iconEl('save', 14), 'Save a version now')

      const goBack = async ver => {
        const label = ver.names[0] ? `“${ver.names[0]}”` : `the version from ${when(ver.at)}`
        const extra = v.dirty ? ' Your unsaved changes are saved as a version first, so they are not lost.' : ''
        if (!(await confirmDialog(`Go back to ${label}?`,
          `Every page, menu, setting and design choice goes back to how it was then.${extra} This is recorded as a new version, so you can return to today at any time.`, 'Go back'))) return
        showProblem('')
        const res = await call(`/x/ops/versions/${ver.hash}/restore`)
        if (res.error) return showProblem(`Could not go back: ${res.error}`)
        toast(`Done — the site is now as it was in ${label}`, 'ok', 6000)
        refreshVersions()
      }

      const rows = v.versions.map((ver, idx) => h('tr.cursor-default', {},
        h('td', { 'data-label': '' },
          ver.names.length ? h('strong', {}, ver.names.join(', ')) : h('span.mut', {}, said(ver.message)),
          idx === 0 ? h('span.badge.badge-ok.ml-2', {}, 'current') : ''),
        h('td.mut.text-s', { 'data-label': 'Saved' }, h('span', { title: when(ver.at) }, ver.date)),
        h('td.ta-r', { 'data-label': '' }, idx === 0 || !canRestore ? '' : h('button.btn.ghost.small', { onclick: () => goBack(ver) }, 'Go back to this'))))

      versionsHolder.replaceChildren(
        h('p.sub.mt-0', {},
          v.versions[0] ? `Last saved ${v.versions[0].date}. ` : 'Nothing has been saved as a version yet. ',
          v.dirty
            ? h('strong', {}, `${v.dirty} ${v.dirty === 1 ? 'change' : 'changes'} since then, not saved yet.`)
            : 'Everything is saved.'),
        h('div.d-flex.gap-2.wrap.mt-2.mb-3', {}, nameInput, save),
        rows.length ? h('div.table-wrap', {}, h('table.data-table.cards-sm', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', {}, 'Saved'), h('th', {}, ''))),
          h('tbody', {}, ...rows))) : '')
    }

    const size = n => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
    const backupLabel = h('input.input.w-full', { placeholder: 'Name it (optional) — e.g. before-redesign', 'aria-label': 'Backup name' })

    const refreshBackups = async () => {
      const { backups, settings } = await api('/x/ops/backups', { quiet: true }).catch(() => ({ backups: [], settings: {} }))
      backupsHolder.replaceChildren(
        settings.enabled === false ? h('p.fnt.text-s.mb-2', {}, 'Backups are turned off — turn them on under ', h('a', { href: '#/settings' }, 'Settings'), ' → Apps → Backups.') : '',
        h('div.mb-3.d-flex.gap-2.wrap', {},
          backupLabel,
          h('button.btn.ghost', { onclick: async e => {
            const btn = e.currentTarget; btn.disabled = true; showProblem('')
            const label = backupLabel.value.trim().toLowerCase().replace(/\s+/g, '-')
            const res = await call('/x/ops/backups/run', label ? { label } : {})
            btn.disabled = false
            if (res.error) showProblem(`Could not back up: ${res.error}`)
            else if (res.skipped) toast('Nothing has changed since the last backup, so no new one was needed', undefined, 5000)
            else { toast('Backup made', 'ok'); backupLabel.value = ''; refreshBackups() }
          } }, iconEl('download', 14), 'Back up now')),
        backups.length ? h('div.table-wrap', {}, h('table.data-table.cards-sm', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Backup'), h('th', {}, 'Made'), h('th', {}, 'Size'), h('th', {}, ''))),
          h('tbody', {}, ...backups.map(b => h('tr.cursor-default', {},
            h('td', { 'data-label': '' }, b.kind === 'prerestore'
              ? h('span', { title: 'Made automatically just before a restore, so the restore itself can be undone' }, h('span.badge.badge-warn', {}, 'safety copy'), ' before a restore')
              : (b.name.replace(/\.tar\.gz$/, '').replace(/^\d{8}-\d{6}-?/, '') || 'Backup')),
            h('td.mut', { 'data-label': 'Made' }, when(b.at)),
            h('td.mut', { 'data-label': 'Size' }, size(b.sizeBytes)),
            h('td.ta-r', { 'data-label': '' },
              canRestore
                ? h('button.btn.soft.small', { onclick: async () => {
                    if (!(await confirmDialog('Restore this backup?',
                      `Pictures, files and studio accounts go back to how they were on ${when(b.at)}. Anyone signed in will need to sign in again. A safety copy of how things are now is made first.`, 'Restore'))) return
                    showProblem('')
                    const res = await call('/x/ops/backups/restore', { name: b.name })
                    if (res.error) showProblem(`Could not restore: ${res.error}`)
                    else { toast('Restored — a safety copy of the previous state is in the list', 'ok', 6000); refreshVersions(); refreshBackups() }
                  } }, 'Restore')
                : ''))))))
          : emptyState(icon('db', 22), 'No backups yet', settings.enabled === false ? 'Backups are turned off.' : 'Press “Back up now” to make the first one.'))
    }

    refreshVersions(); refreshBackups()
    return h('div', {},
      problem,
      h('div.card.mb-4', {},
        h('strong', {}, 'Versions'),
        h('p.sub.mt-0', {}, 'Your pages, menus, settings and design. Save a version after changes you’re happy with; go back to any earlier one at any time. Going back never deletes anything — it is just another saved version.'),
        versionsHolder),
      h('div.card', {},
        h('strong', {}, 'Backups'),
        h('p.sub.mt-0', {}, 'Your uploaded pictures and files, and who can sign in to the studio — the things versions don’t cover.'),
        backupsHolder))
  }, { replaces: true }),
}
