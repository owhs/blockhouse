// Data & apps studio — grid · record editor (relations, line-items, computed) ·
// workflow kanban · gantt · dashboard. Registered as the custom section for the
// data plugin panel (main.js imports this; views.js looks it up).

import { get, post, put, del } from './api.js'
import { h, dialog, confirmDialog, toast, emptyState, fmtDate, makeSortable, contextMenu, skeleton } from './ui.js'
import { icon, iconEl } from './icons.js'
import { renderField } from './fields.js'
import { tryEval } from './expr.js'
import { registerDataSection } from './state.js'

const money = (v, sym = '£') => `${sym}${(Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

registerDataSection(async () => {
  const wrap = h('div')
  const { items: tables } = await get('/res/data/tables').catch(() => ({ items: [] }))
  if (!tables.length) return h('div.card', {}, emptyState(icon('db', 26), 'No tables yet', 'Create a table above to build a data app — a quote calculator, inventory or tracker.'))

  const tabBar = h('div.seg', { style: { marginBottom: '0.9rem', flexWrap: 'wrap' } })
  const viewBar = h('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.9rem', flexWrap: 'wrap', alignItems: 'center' } })
  const body = h('div')
  wrap.append(tabBar, viewBar, body)

  let current = tables[0]
  let view = 'grid'
  let q = ''
  let sortState = null      // { key, dir: 1 | -1 }
  let allItems = []

  const renderTabs = () => tabBar.replaceChildren(...tables.map(t =>
    h('button', { class: t.id === current.id ? 'active' : '', onclick: () => { current = t; view = 'grid'; q = ''; sortState = null; load() } }, t.label)))

  async function load() {
    renderTabs()
    body.replaceChildren(skeleton('rows', 6))
    const { table, items } = await get(`/x/data/rows/${current.id}`)
    current = table
    allItems = items

    const views = [['grid', 'table', 'Grid']]
    if (table.workflow?.states?.length) views.push(['board', 'kanban', 'Board'])
    if (table.dateField) views.push(['gantt', 'gantt', 'Timeline'])
    views.push(['dash', 'chart', 'Dashboard'])

    const search = h('input.input', {
      type: 'search', placeholder: `Search ${items.length} records…`, value: q,
      style: { width: '13rem', padding: '0.35rem 0.6rem', fontSize: '0.82rem' },
      oninput: e => { q = e.target.value; render() },
    })

    viewBar.replaceChildren(
      h('div.seg', {}, ...views.map(([k, ico, label]) =>
        h('button', { class: view === k ? 'active' : '', onclick: e => {
          view = k
          for (const b of e.currentTarget.parentElement.children) b.classList.toggle('active', b === e.currentTarget)
          render()
        } }, iconEl(ico, 14), label))),
      search,
      h('div', { style: { flex: 1 } }),
      h('button.btn.ghost.small', { onclick: () => importCsv(table, load) }, iconEl('upload', 14), 'Import'),
      h('button.btn.ghost.small', { onclick: () => keysDialog() }, iconEl('key', 14), 'API keys'),
      h('a.btn.ghost.small', { href: `/api/x/data/rows/${table.id}/export.csv`, download: `${table.id}.csv` }, iconEl('download', 13), 'CSV'),
      h('button.btn.primary.small', { onclick: () => editRow(table, null, load) }, iconEl('plus', 14), 'New record'))

    render()
  }

  function visibleItems() {
    let items = allItems
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      items = items.filter(r => Object.values(r).some(v =>
        (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(needle)))
    }
    if (sortState) {
      const { key, dir } = sortState
      items = [...items].sort((a, b) => {
        const av = a[`${key}__label`] ?? a[key], bv = b[`${key}__label`] ?? b[key]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })) * dir
      })
    }
    return items
  }

  function render() {
    const items = visibleItems()
    const setSort = key => {
      sortState = sortState?.key === key ? (sortState.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }
      render()
    }
    if (view === 'grid') body.replaceChildren(gridView(current, items, load, { sortState, setSort }))
    else if (view === 'board') body.replaceChildren(boardView(current, items, load))
    else if (view === 'gantt') body.replaceChildren(ganttView(current, items))
    else if (view === 'dash') body.replaceChildren(dashView(current, items))
  }

  await load()
  return h('div.card', { style: { padding: '1rem' } }, wrap)
})

// ---------- grid ----------

function displayCols(table) {
  return table.fields.filter(f => f.type !== 'lineitems' && f.type !== 'textarea').slice(0, 7)
}
function cellValue(f, row) {
  const v = f.type === 'relation' ? row[`${f.key}__label`] ?? row[f.key] : row[f.key]
  if (v == null || v === '') return h('span.fnt', {}, '—')
  if (f.type === 'currency') return money(v, f.currency || '£')
  if (f.type === 'boolean') return v ? iconEl('check', 14) : h('span.fnt', {}, '—')
  if (f.type === 'multiselect' && Array.isArray(v)) return h('span', {}, ...v.map(x => h('span.multi-tag', { style: { marginRight: '0.2rem' } }, x)))
  if (f.type === 'number') return String(Math.round(v * 100) / 100)
  return String(v).slice(0, 60)
}

function gridView(table, items, reload, sorting = {}) {
  if (!items.length) return emptyState(icon('db', 26), 'No records', 'Nothing here yet — add a record, or clear the search.')
  const cols = displayCols(table)
  const stateField = table.workflow?.states?.length
  const { sortState, setSort } = sorting
  const th = f => h('th', {
    style: setSort ? { cursor: 'pointer', userSelect: 'none' } : {},
    title: setSort ? 'Sort' : '',
    onclick: setSort ? () => setSort(f.key) : null,
  }, f.label || f.key, sortState?.key === f.key ? ` ${sortState.dir === 1 ? '↑' : '↓'}` : '')
  return h('div.table-wrap', {}, h('table.data-table', {},
    h('thead', {}, h('tr', {},
      ...cols.map(th),
      stateField ? h('th', {}, 'Status') : '',
      h('th'))),
    h('tbody', {}, ...items.map(row => h('tr', { onclick: () => editRow(table, row, reload) },
      ...cols.map(f => h('td', { class: f.type === 'currency' || f.type === 'number' ? 'num' : '' }, cellValue(f, row))),
      stateField ? h('td', {}, stateChip(table, row._state)) : '',
      h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        table.report ? h('button.icon-btn', { title: 'Open report', onclick: e => { e.stopPropagation(); window.open(`/x/data/report/${table.id}/${row.id}`) } }, iconEl('doc', 14)) : '',
        h('button.icon-btn', { title: 'Clone', onclick: async e => { e.stopPropagation(); await post(`/x/data/rows/${table.id}/${row.id}/clone`); toast('Cloned', 'ok'); reload() } }, iconEl('copy', 14)),
        h('button.icon-btn', { title: 'Delete', onclick: async e => { e.stopPropagation(); if (await confirmDialog('Delete record', 'Delete this record?')) { await del(`/x/data/rows/${table.id}/${row.id}`); reload() } } }, iconEl('trash', 14))))))))
}

function stateChip(table, key) {
  const st = table.workflow?.states?.find(s => s.key === key) || { label: key || '—' }
  return h('span.chip', { style: st.color ? { background: `color-mix(in oklch, ${st.color} 18%, transparent)`, color: st.color } : {}, class: st.color ? '' : 'draft' }, st.label)
}

// ---------- record editor ----------

async function editRow(table, row, reload) {
  const vals = row ? JSON.parse(JSON.stringify(row)) : {}
  for (const f of table.fields) if (vals[f.key] === undefined && f.default !== undefined) vals[f.key] = f.default

  const formHolder = h('div')
  const totalsBar = h('div', { style: { position: 'sticky', bottom: 0, background: 'var(--bg-panel)', borderTop: '1px solid var(--line)', margin: '0.5rem -1.1rem -0.6rem', padding: '0.6rem 1.1rem', display: 'flex', gap: '1.2rem', flexWrap: 'wrap' } })

  const rerender = () => {
    // group fields, honor showIf
    const groups = {}
    for (const f of table.fields) {
      if (f.showIf && !tryEval(f.showIf, vals, 1)) continue
      const g = f.group || ''
      ;(groups[g] ??= []).push(f)
    }
    const parts = []
    for (const [g, fields] of Object.entries(groups)) {
      const inner = h('div.fields-grid')
      for (const f of fields) inner.appendChild(fieldControl(table, f, vals, () => { recompute(); rerender2() }))
      parts.push(g ? h('div.field-group', {}, h('div.fg-title', {}, g), inner) : inner)
    }
    formHolder.replaceChildren(...parts)
    updateTotals()
  }
  // rerender2 only refreshes computed displays + totals without rebuilding inputs (keeps focus)
  const rerender2 = () => { updateTotals(); refreshComputed() }

  function recompute() {
    for (const f of table.fields) {
      if (f.type === 'lineitems' && Array.isArray(vals[f.key])) {
        vals[f.key] = vals[f.key].map(li => {
          const r = { ...li }
          for (const col of f.item || []) if (col.computed) r[col.key] = tryEval(col.computed, r, 0)
          return r
        })
      }
    }
    for (const f of table.fields) if (f.type === 'computed' && f.computed) vals[f.key] = tryEval(f.computed, vals, 0)
  }
  function refreshComputed() {
    formHolder.querySelectorAll('[data-computed]').forEach(el => {
      const f = table.fields.find(x => x.key === el.dataset.computed)
      if (f) el.textContent = f.type === 'currency' ? money(vals[f.key], f.currency || '£') : String(vals[f.key] ?? 0)
    })
  }
  function updateTotals() {
    recompute()
    const computedCurrency = table.fields.filter(f => f.type === 'computed' && /currency|total|vat|grand/i.test(f.key + f.label))
    totalsBar.replaceChildren(...table.fields.filter(f => f.type === 'computed').map(f =>
      h('div', {}, h('span.fnt', { style: { fontSize: '0.72rem', display: 'block' } }, f.label || f.key),
        h('strong', { style: { fontSize: '1.05rem' } }, /currenc|total|price|vat|grand|amount/i.test(f.key + (f.label || '')) ? money(vals[f.key], f.currency || '£') : String(vals[f.key] ?? 0)))))
  }
  recompute(); rerender()

  const workflowBar = row && table.workflow?.states?.length ? h('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.7rem', flexWrap: 'wrap' } },
    h('span.fnt', { style: { fontSize: '0.78rem' } }, 'Status:'), stateChip(table, vals._state),
    ...nextStates(table, vals._state).map(to => h('button.btn.soft.small', {
      onclick: async () => { try { await post(`/x/data/rows/${table.id}/${row.id}/state`, { to: to.key }); vals._state = to.key; toast(`Moved to ${to.label}`, 'ok'); reload() } catch {} },
    }, `→ ${to.label}`))) : ''

  dialog({
    title: row ? `Edit ${table.labelSingular || 'record'}` : `New ${table.labelSingular || 'record'}`,
    width: 'min(46rem, 96vw)',
    body: h('div', {}, workflowBar, formHolder, totalsBar),
    actions: [
      row && table.report ? { label: 'Open report', onClick: () => { window.open(`/x/data/report/${table.id}/${row.id}`); return false } } : null,
      {
        label: 'Save', kind: 'primary', onClick: async () => {
          try {
            if (row) await put(`/x/data/rows/${table.id}/${row.id}`, vals)
            else await post(`/x/data/rows/${table.id}`, vals)
            reload(); return true
          } catch (e) { return false }
        },
      },
    ].filter(Boolean),
  })
}

function nextStates(table, from) {
  const wf = table.workflow
  if (!wf) return []
  const cur = from || wf.states[0]?.key
  if ((wf.transitions || []).length) return wf.transitions.filter(t => t.from === cur).map(t => wf.states.find(s => s.key === t.to)).filter(Boolean)
  return wf.states.filter(s => s.key !== cur)
}

function fieldControl(table, f, vals, onChange) {
  // computed → read-only display
  if (f.type === 'computed') {
    return h('div.field', {}, h('label', {}, f.label || f.key, h('span.help', {}, 'computed')),
      h('div', { class: 'input', 'data-computed': f.key, style: { background: 'var(--bg)', fontWeight: 600 } },
        f.type === 'currency' ? money(vals[f.key], f.currency || '£') : String(vals[f.key] ?? 0)))
  }
  if (f.type === 'lineitems') return lineItemsField(f, vals, onChange)
  if (f.type === 'relation') {
    const wrap = h('div.field', {}, h('label', {}, f.label || f.key))
    const sel = h('select.input', {}, h('option', { value: '' }, '—'))
    get(`/x/data/options/${f.relation}`).then(({ options }) => {
      sel.replaceChildren(h('option', { value: '' }, '—'), ...options.map(o => h('option', { value: o.value, selected: vals[f.key] === o.value }, o.label)))
    }).catch(() => {})
    sel.addEventListener('change', () => { vals[f.key] = sel.value; onChange(f.key) })
    wrap.appendChild(sel)
    return wrap
  }
  if (f.type === 'multiselect') return multiField(f, vals, onChange)
  if (f.type === 'currency') {
    const wrap = h('div.field', { class: f.group ? '' : 'half' }, h('label', {}, f.label || f.key))
    const input = h('input', { type: 'number', step: '0.01', value: vals[f.key] ?? '', oninput: e => { vals[f.key] = e.target.value === '' ? null : Number(e.target.value); onChange(f.key) } })
    wrap.append(h('div', { style: { position: 'relative' } }, h('span', { style: { position: 'absolute', left: '0.6rem', top: '50%', translate: '0 -50%', color: 'var(--fnt)' } }, f.currency || '£'), input))
    input.style.paddingLeft = '1.4rem'
    return wrap
  }
  // fall through to the generic renderer (data-table dates are day-precision)
  return renderField({ ...f, type: mapType(f.type), ...(f.type === 'date' ? { time: false } : {}) }, vals, (k, v) => { vals[k] = v; onChange(k) })
}
function mapType(t) { return ['text', 'textarea', 'number', 'boolean', 'date', 'select'].includes(t) ? t : 'text' }

function multiField(f, vals, onChange) {
  const opts = String(f.options || '').split('|').map(s => s.trim()).filter(Boolean)
  vals[f.key] = Array.isArray(vals[f.key]) ? vals[f.key] : []
  const tags = h('div.multi-tags')
  const render = () => tags.replaceChildren(...vals[f.key].map(v => h('span.multi-tag', {}, v,
    h('button', { onclick: () => { vals[f.key] = vals[f.key].filter(x => x !== v); render(); onChange(f.key) }, html: icon('x', 11) }))))
  render()
  const sel = h('select.input', {}, h('option', { value: '' }, '+ add…'), ...opts.filter(o => !vals[f.key].includes(o)).map(o => h('option', { value: o }, o)))
  sel.addEventListener('change', () => { if (sel.value) { vals[f.key].push(sel.value); render(); onChange(f.key); sel.value = '' } })
  return h('div.field', {}, h('label', {}, f.label || f.key), tags, sel)
}

function lineItemsField(f, vals, onChange) {
  vals[f.key] = Array.isArray(vals[f.key]) ? vals[f.key] : []
  const cols = f.item || []
  const table = h('table.data-table', { style: { fontSize: '0.8rem' } })
  const render = () => {
    table.replaceChildren(
      h('thead', {}, h('tr', {}, ...cols.map(c => h('th', { class: /number|currency|computed/.test(c.type) ? 'num' : '' }, c.label || c.key)), h('th'))),
      h('tbody', {}, ...vals[f.key].map((li, i) => h('tr', { style: { cursor: 'default' } },
        ...cols.map(c => h('td', { class: /number|currency|computed/.test(c.type) ? 'num' : '', style: { padding: 0 } },
          c.computed
            ? h('div', { style: { padding: '0.4rem 0.6rem', color: 'var(--mut)' } }, c.type === 'currency' ? money(li[c.key]) : String(li[c.key] ?? 0))
            : c.type === 'select'
              ? h('select', { style: { border: 0, background: 'none', width: '100%', padding: '0.35rem 0.5rem' }, onchange: e => { li[c.key] = e.target.value; onChange(f.key) } },
                ...String(c.options || '').split('|').map(o => h('option', { value: o.trim(), selected: li[c.key] === o.trim() }, o.trim())))
              : h('input', {
                type: /number|currency/.test(c.type) ? 'number' : 'text', step: '0.01',
                value: li[c.key] ?? '', style: { border: 0, background: 'none', width: '100%', padding: '0.35rem 0.5rem' },
                oninput: e => { li[c.key] = /number|currency/.test(c.type) ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value; onChange(f.key); render() },
              }))),
        h('td', { style: { textAlign: 'right', padding: 0 } }, h('button.icon-btn', { onclick: () => { vals[f.key].splice(i, 1); onChange(f.key); render() }, html: icon('trash', 13) }))))))
  }
  render()
  const add = h('button.tree-add', { onclick: () => { const li = {}; for (const c of cols) li[c.key] = /number|currency/.test(c.type) ? 0 : ''; vals[f.key].push(li); onChange(f.key); render() } }, '＋ line')
  return h('div.field', {}, h('label', {}, f.label || f.key), h('div.table-wrap', {}, table), add)
}

// ---------- board (kanban) ----------

function boardView(table, items, reload) {
  const states = table.workflow.states
  const board = h('div.kb-board')
  for (const st of states) {
    const inState = items.filter(r => (r._state || states[0].key) === st.key)
    const cards = h('div.kb-cards', { dataset: { state: st.key } })
    for (const row of inState) {
      const card = h('div.kb-card', { draggable: 'true', dataset: { id: row.id } },
        h('div.kc-title', {}, row[table.titleField || 'id'] || row.id),
        h('div.kc-sub', {}, ...table.fields.filter(f => f.type === 'currency' || f.type === 'computed').slice(0, 1).map(f => money(row[f.key], f.currency || '£'))))
      card.addEventListener('click', () => editRow(table, row, reload))
      card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', row.id); card.classList.add('dragging') })
      card.addEventListener('dragend', () => card.classList.remove('dragging'))
      cards.appendChild(card)
    }
    const col = h('div.kb-col', { dataset: { state: st.key } },
      h('div.kb-col-head', { style: st.color ? { color: st.color } : {} }, st.label, h('span.n', {}, String(inState.length))), cards)
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over') })
    col.addEventListener('dragleave', () => col.classList.remove('over'))
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('over')
      const id = e.dataTransfer.getData('text/plain')
      // Move the card now and reconcile after. Waiting for the server meant the
      // card snapped back to its old column and the whole board then redrew.
      const card = board.querySelector(`.kb-card[data-id="${CSS.escape(id)}"]`)
      const home = card?.parentElement
      const target = col.querySelector('.kb-cards') || col
      if (card) target.appendChild(card)
      try { await post(`/x/data/rows/${table.id}/${id}/state`, { to: st.key }) }
      catch (err) {
        if (card && home) home.appendChild(card)
        toast(`Could not move that card: ${err.message || err}`, 'err')
      }
      reload()
    })
    board.appendChild(col)
  }
  return board
}

// ---------- gantt ----------

function ganttView(table, items) {
  const df = table.dateField, ef = table.endDateField
  const dated = items.filter(r => r[df]).map(r => ({ row: r, start: new Date(r[df]), end: new Date(r[ef] || r[df]) }))
  if (!dated.length) return emptyState(icon('gantt', 26), 'No dated records', `Set a date on records to see them on the timeline (field: ${df}).`)
  let min = Math.min(...dated.map(d => d.start.getTime()))
  let max = Math.max(...dated.map(d => Math.max(d.end.getTime(), d.start.getTime() + 864e5)))
  const span = Math.max(max - min, 864e5)
  const fmt = t => new Date(t).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  return h('div.gantt', {},
    h('div.gantt-row', {}, h('div', {}), h('div.gantt-scale', {}, h('span', {}, fmt(min)), h('span', {}, fmt(min + span / 2)), h('span', {}, fmt(max)))),
    ...dated.sort((a, b) => a.start - b.start).map(d => {
      const left = ((d.start.getTime() - min) / span) * 100
      const width = Math.max(((d.end.getTime() - d.start.getTime()) / span) * 100, 1.5)
      return h('div.gantt-row', {},
        h('div.gantt-label', {}, d.row[table.titleField || 'id'] || d.row.id),
        h('div.gantt-track', {}, h('div.gantt-bar', { style: { left: left + '%', width: width + '%' }, title: `${fmt(d.start)} → ${fmt(d.end)}` })))
    }))
}

// ---------- dashboard ----------

function dashView(table, items) {
  const widgets = []
  widgets.push(widget('Records', String(items.length)))

  // sum of first currency/computed-currency field
  const moneyField = table.fields.find(f => (f.type === 'currency') || (f.type === 'computed' && /total|amount|price|grand/i.test(f.key + (f.label || ''))))
  if (moneyField) {
    const total = items.reduce((t, r) => t + (Number(r[moneyField.key]) || 0), 0)
    widgets.push(widget(`Total ${moneyField.label || moneyField.key}`, money(total, moneyField.currency || '£')))
  }

  // workflow breakdown → bar chart
  if (table.workflow?.states?.length) {
    const counts = table.workflow.states.map(s => ({ label: s.label, color: s.color, n: items.filter(r => (r._state || table.workflow.states[0].key) === s.key).length }))
    widgets.push(h('div.widget.span2', {}, h('div.w-label', {}, 'By status'), barChart(counts)))
  }

  // group by first select field → donut-ish bars
  const selField = table.fields.find(f => f.type === 'select')
  if (selField) {
    const byVal = {}
    for (const r of items) { const k = r[selField.key] || '—'; byVal[k] = (byVal[k] || 0) + 1 }
    widgets.push(h('div.widget.span2', {}, h('div.w-label', {}, `By ${selField.label || selField.key}`),
      barChart(Object.entries(byVal).map(([label, n]) => ({ label, n })))))
  }

  return h('div.widget-grid', {}, ...widgets)
}

function widget(label, value, sub) {
  return h('div.widget', {}, h('div.w-label', {}, label), h('div.w-value', {}, value), sub ? h('div.w-sub', {}, sub) : '')
}

function barChart(data) {
  const max = Math.max(1, ...data.map(d => d.n))
  const rowH = 26, gap = 8, w = 320, labelW = 110, barW = w - labelW - 44
  const height = data.length * (rowH + gap)
  const bars = data.map((d, i) => {
    const y = i * (rowH + gap)
    const bw = (d.n / max) * barW
    const color = d.color || 'var(--acc)'
    return `<text x="0" y="${y + rowH / 2 + 4}" font-size="12" fill="var(--mut)">${escapeSvg(d.label).slice(0, 16)}</text>` +
      `<rect x="${labelW}" y="${y}" width="${Math.max(bw, 2)}" height="${rowH}" rx="4" fill="${color}" opacity="0.85"/>` +
      `<text x="${labelW + Math.max(bw, 2) + 6}" y="${y + rowH / 2 + 4}" font-size="12" font-weight="700" fill="var(--ink)">${d.n}</text>`
  }).join('')
  const div = h('div', {})
  div.innerHTML = `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" role="img">${bars}</svg>`
  return div
}
function escapeSvg(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }

// ---------- import / keys ----------

function importCsv(table, reload) {
  const ta = h('textarea.input.mono', { rows: 8, placeholder: 'Paste CSV or TSV (first row = headers matching field keys)…', style: { width: '100%' } })
  dialog({
    title: `Import into ${table.label}`,
    width: 'min(40rem, 94vw)',
    body: h('div', {}, h('p.dlg-text', {}, 'First row must be headers matching field keys: ', h('code', {}, table.fields.filter(f => f.type !== 'lineitems' && f.type !== 'computed').map(f => f.key).join(', '))), ta),
    actions: [{
      label: 'Import', kind: 'primary', onClick: async () => {
        const rows = parseDelimited(ta.value)
        if (!rows.length) { toast('Nothing to import', 'err'); return false }
        const r = await post(`/x/data/import/${table.id}`, { rows })
        toast(`Imported ${r.imported} records`, 'ok'); reload(); return true
      },
    }],
  })
}
function parseDelimited(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const delim = lines[0].includes('\t') ? '\t' : ','
  const headers = splitRow(lines[0], delim)
  return lines.slice(1).map(l => { const cells = splitRow(l, delim); const o = {}; headers.forEach((h2, i) => (o[h2.trim()] = cells[i])); return o })
}
function splitRow(line, delim) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === delim) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}

async function keysDialog() {
  const out = h('div')
  const list = h('div')
  const refresh = async () => {
    const { keys } = await get('/x/data/keys')
    list.replaceChildren(...(keys.length ? keys.map(k => h('div.seo-check', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
      h('span', { style: { flex: 1 } }, `${k.name} — `, h('code.pill-perm', {}, (k.scopes || []).join(', '))),
      h('button.icon-btn', { title: 'Revoke', onclick: async () => { if (await confirmDialog('Revoke key', `Revoke “${k.name}”? Integrations using it stop working immediately.`, 'Revoke')) { await del(`/x/data/keys/${k.id}`); refresh() } } }, iconEl('trash', 13))))
      : [h('p.mut', {}, 'No keys yet.')]))
  }
  await refresh()
  const nameIn = h('input.input', { placeholder: 'Key name (e.g. Zapier)', style: { flex: 1 } })
  const scopeIn = h('input.input', { placeholder: 'data:quotes:read, data:quotes:write', style: { flex: 1.4 } })
  dialog({
    title: 'Scoped API keys',
    width: 'min(34rem, 94vw)',
    body: h('div', {},
      h('p.dlg-text', {}, 'Keys authorize external integrations. Scopes look like ', h('code', {}, 'data:<table>:read'), ' / ', h('code', {}, ':write'), '.'),
      list, out,
      h('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.7rem' } }, nameIn, scopeIn,
        h('button.btn.soft.small', { onclick: async () => {
          if (!nameIn.value.trim()) { toast('Name the key first', 'err'); return }
          const r = await post('/x/data/keys', { name: nameIn.value.trim(), scopes: scopeIn.value.split(',').map(x => x.trim()).filter(Boolean) })
          out.replaceChildren(h('p.dlg-text', { style: { marginTop: '0.6rem' } }, 'Copy now — shown once:'), h('div.code-out', {}, r.key))
          nameIn.value = ''; refresh()
        } }, iconEl('plus', 14), 'Create'))),
  })
}
