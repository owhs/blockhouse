// Auto-form renderer: FieldDef[] + values → live form. Powers the block
// inspector, doc fields, plugin resources, menus and settings.

import { get, post } from './api.js'
import { h, debounce, dialog, makeSortable, toast } from './ui.js'
import { mountRichtext } from './richtext.js'

export function renderFields(defs, values, onChange, opts = {}) {
  const grid = h('div.fields-grid')
  for (const def of defs || []) grid.appendChild(renderField(def, values, onChange, opts))
  return grid
}

function labelRow(def) {
  return h('label', {}, h('span', {}, def.label || def.key), def.help ? h('span.help', {}, def.help) : '')
}

export function renderField(def, values, onChange, opts = {}) {
  const wrap = h('div.field', { class: def.width === 'half' ? 'half' : '' })
  const val = values[def.key] ?? def.default ?? ''
  const set = v => { values[def.key] = v; onChange(def.key, v) }
  const deb = debounce(set, 350)

  switch (def.type) {
    case 'boolean': {
      const input = h('input', { type: 'checkbox', checked: !!values[def.key] || (values[def.key] === undefined && !!def.default) })
      input.addEventListener('change', () => set(input.checked))
      wrap.appendChild(h('label.field-check', {}, input, h('span', {}, def.label || def.key)))
      return wrap
    }
    case 'select': {
      const sel = h('select')
      const fill = options => {
        // accept both [{value,label}] and the 'a|b|c' shorthand data tables use
        const opts = Array.isArray(options)
          ? options
          : String(options || '').split('|').map(s => s.trim()).filter(Boolean).map(v => ({ value: v }))
        sel.replaceChildren(
          ...(def.required ? [] : [h('option', { value: '' }, '—')]),
          ...opts.map(o => h('option', { value: o.value, selected: String(o.value) === String(val) }, o.label || o.value)))
      }
      fill(def.options || [])
      if (def.optionsSource?.startsWith('res:')) {
        get(`/res/${def.optionsSource.slice(4)}`).then(r =>
          fill((r.items || []).map(i => ({ value: i.id, label: i.label || i.id })))).catch(() => {})
      }
      sel.addEventListener('change', () => set(sel.value))
      wrap.append(labelRow(def), sel)
      return wrap
    }
    case 'textarea': {
      const ta = h('textarea', { rows: def.rows || 3 }, String(val ?? ''))
      ta.addEventListener('input', () => deb(ta.value))
      ta.addEventListener('blur', () => deb.now(ta.value))
      wrap.append(labelRow(def), ta)
      return wrap
    }
    case 'code': case 'markdown': case 'svg': {
      // A real editor ships in ide.js — highlighting, completion, colour
      // swatches. The code field was a plain textarea, so per-page CSS was
      // written in Notepad-with-extra-steps while the good editor sat unused.
      if (def.type === 'code' && def.lang) {
        const holder = h('div.field-code')
        wrap.append(labelRow(def), holder)
        import('./ide.js').then(({ codeEditor }) => {
          const ed = codeEditor({ rel: `x.${def.lang}`, value: String(val ?? ''), onChange: v => deb(v), rows: def.rows || 8 })
          holder.replaceChildren(ed.el || ed)
        }).catch(() => {
          const ta2 = h('textarea.mono', { rows: def.rows || 8, spellcheck: 'false' }, String(val ?? ''))
          ta2.addEventListener('input', () => deb(ta2.value))
          holder.replaceChildren(ta2)
        })
        return wrap
      }
      const ta = h('textarea.mono', { rows: def.rows || (def.type === 'svg' ? 6 : 8), spellcheck: 'false' }, String(val ?? ''))
      ta.addEventListener('keydown', e => {
        if (e.key === 'Tab') { e.preventDefault(); insertAt(ta, '  ') }
      })
      ta.addEventListener('input', () => { deb(ta.value); if (def.type === 'svg') updatePrev(ta.value) })
      let prev = null
      const updatePrev = v => {
        if (!prev) return
        prev.innerHTML = /^\s*<svg[\s>]/.test(v || '') ? v : ''
        prev.style.display = prev.innerHTML ? '' : 'none'
      }
      wrap.append(labelRow(def), ta)
      if (def.type === 'svg') {
        prev = h('div', { style: { padding: '0.6rem', border: '1px dashed var(--line)', borderRadius: 'var(--r-s)', display: 'none', maxHeight: '9rem', overflow: 'hidden', color: 'var(--acc)' } })
        wrap.appendChild(prev)
        updatePrev(val)
      }
      return wrap
    }
    case 'richtext': {
      wrap.append(labelRow(def), mountRichtext(String(val ?? ''), deb, opts))
      return wrap
    }
    case 'number': {
      const input = h('input', { type: 'number', value: val === '' ? '' : String(val), ...(def.min != null ? { min: def.min } : {}), ...(def.max != null ? { max: def.max } : {}) })
      input.addEventListener('input', () => deb(input.value === '' ? '' : Number(input.value)))
      wrap.append(labelRow(def), input)
      return wrap
    }
    case 'color': {
      const input = h('input', { type: 'color', value: val || '#888888', style: { height: '2.1rem', padding: '0.15rem' } })
      input.addEventListener('input', () => deb(input.value))
      wrap.append(labelRow(def), input)
      return wrap
    }
    case 'date': {
      // 'YYYY-MM-DD' values render in a plain date input (a bare date is not a
      // valid datetime-local value and would show as empty); anything with a
      // time keeps the datetime picker.
      const plain = val && /^\d{4}-\d{2}-\d{2}$/.test(String(val))
      const wantTime = !plain && (def.time !== false)
      const input = wantTime
        ? h('input', { type: 'datetime-local', value: val ? String(val).slice(0, 16) : '' })
        : h('input', { type: 'date', value: val ? String(val).slice(0, 10) : '' })
      input.addEventListener('change', () => set(!input.value ? ''
        : wantTime ? new Date(input.value).toISOString() : input.value))
      wrap.append(labelRow(def), input)
      return wrap
    }
    case 'json': {
      const ta = h('textarea.mono', { rows: def.rows || 3, spellcheck: 'false' },
        typeof val === 'string' ? val : (val && Object.keys(val).length ? JSON.stringify(val, null, 2) : ''))
      const jsonErr = h('span.help', { role: 'status', style: { color: 'var(--err-ink)' } })
      ta.addEventListener('input', () => {
        const raw = ta.value.trim()
        if (!raw) { jsonErr.textContent = ''; ta.style.borderColor = ''; deb(null); return }
        try {
          const parsed = JSON.parse(raw)
          jsonErr.textContent = ''
          ta.style.borderColor = ''
          deb(parsed)
        } catch (e) {
          // say what is wrong and warn that nothing is being saved meanwhile
          jsonErr.textContent = `Not valid JSON yet — ${String(e.message).replace(/^JSON\.parse: /, '')}. Nothing is saved until it parses.`
          ta.style.borderColor = 'var(--err)'
        }
      })
      wrap.append(labelRow(def), ta, jsonErr)
      return wrap
    }
    case 'image': {
      const preview = h('div.media-thumb', { style: { aspectRatio: '16/7', borderRadius: 'var(--r-s)', border: '1px solid var(--line)', cursor: 'pointer', overflow: 'hidden' } })
      const refresh = async () => {
        preview.replaceChildren()
        preview.style.backgroundImage = ''
        if (values[def.key]) {
          const { media } = await get('/media').then(r => ({ media: r.media.find(m => m.id === values[def.key]) })).catch(() => ({}))
          if (media) { preview.appendChild(h('img', { src: `/media/${media.file}`, alt: '' })); return }
        }
        preview.append('＋ choose image')
      }
      preview.addEventListener('click', async () => {
        const picked = await pickMedia()
        if (picked !== undefined) { set(picked); refresh() }
      })
      refresh()
      const clear = h('button.btn.ghost.small', { onclick: () => { set(''); refresh() } }, 'Clear')
      wrap.append(labelRow(def), preview, values[def.key] ? clear : '')
      return wrap
    }
    case 'link': {
      const display = h('input', { readonly: true, value: linkLabel(val), style: { cursor: 'pointer' } })
      display.addEventListener('click', async () => {
        const link = await pickLink(values[def.key])
        if (link !== undefined) { set(link); display.value = linkLabel(link) }
      })
      wrap.append(labelRow(def), display)
      return wrap
    }
    case 'table': {
      wrap.append(labelRow(def), tableEditor(Array.isArray(val) ? val : [['', ''], ['', '']], deb, values, def))
      return wrap
    }
    case 'list': {
      wrap.append(labelRow(def), listEditor(def, values, onChange, opts))
      return wrap
    }
    default: { // text
      const input = h('input', { type: 'text', value: String(val ?? '') })
      // autocomplete: preset "a|b|c" or a live source (concept:/table:/title:)
      if (def.suggest) {
        const listId = 'dl-' + def.key + '-' + Math.random().toString(36).slice(2, 7)
        const dl = h('datalist', { id: listId })
        input.setAttribute('list', listId)
        wrap.appendChild(dl)
        const src = String(def.suggest)
        if (src.includes('|') && !src.includes(':')) {
          dl.replaceChildren(...src.split('|').map(v => h('option', { value: v.trim() })))
        } else {
          get(`/suggest?src=${encodeURIComponent(src)}`)
            .then(r => dl.replaceChildren(...(r.values || []).map(v => h('option', { value: v }))))
            .catch(() => {})
        }
      }
      input.addEventListener('input', () => deb(input.value))
      input.addEventListener('blur', () => deb.now(input.value))
      wrap.append(labelRow(def), input)
      return wrap
    }
  }
}

function iconGrip() {
  return '<svg class="ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/></svg>'
}

function insertAt(ta, text) {
  const s = ta.selectionStart, e = ta.selectionEnd
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e)
  ta.selectionStart = ta.selectionEnd = s + text.length
  ta.dispatchEvent(new Event('input'))
}

function linkLabel(v) {
  if (!v) return 'Set link…'
  if (typeof v === 'string') return v
  if (v.docId) return v.docTitle ? `→ ${v.docTitle}` : `→ document`
  return v.href || 'Set link…'
}

// ---------- list (repeatable group) ----------

function listEditor(def, values, onChange, opts) {
  const rows = Array.isArray(values[def.key]) ? values[def.key] : (values[def.key] = [])
  const holder = h('div.list-rows')
  const commit = () => onChange(def.key, rows)

  const rowEl = item => {
    const body = h('div.list-row-body', { style: { display: 'none' } })
    const label = h('span.lr-label', {}, itemLabel(def, item))
    const head = h('div.list-row-head', {},
      h('span.t-grip', { html: iconGrip(), 'aria-hidden': 'true' }), label,
      h('button.icon-btn', {
        onclick: e => { e.stopPropagation(); rows.splice(rows.indexOf(item), 1); el.remove(); commit() },
        title: 'Remove', 'aria-label': `Remove ${itemLabel(def, item)}`,
      }, '✕'))
    head.addEventListener('click', () => {
      const open = body.style.display === 'none'
      body.style.display = open ? '' : 'none'
      if (open && !body.childElementCount) {
        body.appendChild(renderFields(def.item || [], item, () => { label.textContent = itemLabel(def, item); commit() }, opts))
      }
    })
    const el = h('div.list-row', { draggable: 'true' }, head, body)
    return el
  }

  for (const item of rows) holder.appendChild(rowEl(item))
  makeSortable(holder, {
    handle: '.t-grip',
    onMove: (from, to) => { const [m] = rows.splice(from, 1); rows.splice(to, 0, m); commit() },
  })

  const add = h('button.tree-add', {
    onclick: () => {
      const item = {}
      for (const f of def.item || []) if (f.default !== undefined) item[f.key] = f.default
      rows.push(item)
      const el = rowEl(item)
      holder.appendChild(el)
      el.querySelector('.list-row-head').click()
      commit()
    },
  }, '＋ Add item')
  return h('div', {}, holder, add)
}

function itemLabel(def, item) {
  const first = (def.item || []).find(f => f.type === 'text' || f.type === 'select')
  return String(item[first?.key] || item.label || item.title || item.name || 'Item')
}

// ---------- table editor ----------

function tableEditor(data, onChange, values, def) {
  let rows = data.map(r => [...r])
  const table = h('table')
  const commit = () => { values[def.key] = rows.map(r => [...r]); onChange.now ? onChange.now(values[def.key]) : onChange(values[def.key]) }
  const render = () => {
    table.replaceChildren(...rows.map((row, ri) =>
      h('tr', { class: ri === 0 ? 'hdr' : '' }, ...row.map((cell, ci) => {
        const input = h('input', { value: String(cell ?? '') })
        input.addEventListener('input', () => { rows[ri][ci] = input.value; values[def.key] = rows })
        input.addEventListener('blur', commit)
        return h('td', {}, input)
      }))))
  }
  render()
  const btn = (label, fn) => h('button.btn.ghost.small', { onclick: () => { fn(); render(); commit() } }, label)
  return h('div.tbl-edit', {},
    h('div.tbl-grid', {}, table),
    h('div.tbl-actions', {},
      btn('＋ Row', () => rows.push(new Array(rows[0]?.length || 2).fill(''))),
      btn('＋ Col', () => rows.forEach(r => r.push(''))),
      btn('− Row', () => rows.length > 1 && rows.pop()),
      btn('− Col', () => rows[0]?.length > 1 && rows.forEach(r => r.pop()))))
}

// ---------- media picker ----------

export function pickMedia() {
  return new Promise(resolve => {
    let resolved = false
    const done = v => { if (!resolved) { resolved = true; resolve(v) } }
    const grid = h('div.media-grid')
    const load = async () => {
      const { media } = await get('/media')
      grid.replaceChildren(...media.filter(m => m.type.startsWith('image/')).map(m =>
        h('button.media-card', { onclick: () => { done(m.id); dlg.closeWith() } },
          h('div.media-thumb', {}, h('img', { src: `/media/${m.file}`, loading: 'lazy', alt: '' })),
          h('div.media-meta', {}, h('div.media-name', {}, m.name), h('div.media-dims', {}, m.width ? `${m.width}×${m.height}` : m.type)))))
      if (!media.length) grid.replaceChildren(h('p.mut', {}, 'No media yet — upload something.'))
    }
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } })
    file.addEventListener('change', async () => {
      if (!file.files[0]) return
      const fd = new FormData()
      fd.append('file', file.files[0])
      toast('Uploading…')
      const r = await post('/media', fd)
      toast('Uploaded', 'ok')
      done(r.media.id)
      dlg.closeWith()
    })
    const dlg = dialog({
      title: 'Choose an image',
      width: 'min(46rem, 94vw)',
      body: [h('div', { style: { marginBottom: '0.8rem' } }, h('button.btn.ghost.small', { onclick: () => file.click() }, '⇧ Upload new'), file), grid],
      onClose: () => done(undefined),
    })
    load()
  })
}

// ---------- link picker ----------

export function pickLink(current) {
  return new Promise(resolve => {
    let resolved = false
    const done = v => { if (!resolved) { resolved = true; resolve(v) } }
    const url = h('input', { placeholder: 'https://… or /path or #anchor', value: typeof current === 'object' ? (current?.href || '') : (current || '') })
    const search = h('input', { placeholder: 'Search documents…' })
    const list = h('div', { style: { display: 'grid', gap: '1px', maxHeight: '13rem', overflowY: 'auto' } })
    let docs = []
    get('/content').then(r => { docs = r.docs; renderList() })
    const renderList = () => {
      const q = search.value.toLowerCase()
      list.replaceChildren(...docs.filter(d => d.title.toLowerCase().includes(q)).slice(0, 40).map(d =>
        h('button.row-item', { onclick: () => { done({ docId: d.id, docTitle: d.title }); dlg.closeWith() } },
          h('span.row-ico', {}, '▢'), h('span.row-label', {}, d.title, h('div.row-sub', {}, d.path)))))
    }
    search.addEventListener('input', renderList)
    const dlg = dialog({
      title: 'Link to…',
      body: [
        h('div.field', {}, h('label', {}, 'External / manual URL'), url),
        h('div.field', {}, h('label', {}, 'Or pick a document'), search), list,
      ],
      actions: [{ label: 'Use URL', kind: 'primary', onClick: () => { done({ href: url.value }); return true } }],
      onClose: () => done(undefined),
    })
  })
}

// expose for lazily-loaded panels (asset wizard, plugin sections)
try { window.__blockhouseFields = { renderFields, renderField, pickMedia, pickLink } } catch {}
