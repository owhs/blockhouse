// Menu studio — structure tree on the left, a LIVE preview of the real site on
// the right (rendered from a draft buffer, so nothing goes live until Save),
// and an inline inspector for whatever is selected. No dialogs, no guessing:
// every edit repaints the actual header within half a second.

import { get, put, del } from './api.js'
import { h, debounce, dialog, makeSortable, toast, emptyState, fitPreviewFrame, confirmDialog, unsavedDialog, undoToast } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, registerGuard } from './state.js'
import { helpButton } from './help.js'
import { icon, iconEl } from './icons.js'

const uid = () => 'mi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Plain names for the five kinds of dropdown, with one sentence each. The
// internal keys ("mega", "catalogue") never reach the screen.
const PANEL_MODES = [
  ['none', 'No dropdown', 'A plain link. Clicking it goes straight to the page.'],
  ['dropdown', 'Simple dropdown', 'Simple dropdown (a list of links) that opens under this item.'],
  ['columns', 'Columns', 'Columns (several lists side by side), each with its own small heading.'],
  ['showcase', 'Showcase', 'Showcase (pictures with a short line) — good for a handful of highlights.'],
  ['catalogue', 'Catalogue', 'Catalogue (categories across the top, list on the left, detail on the right — best for products).'],
]
const panelName = key => PANEL_MODES.find(m => m[0] === key)?.[1] || 'Dropdown'

// “The newest {type}” names the content type the item is pointed at, so the
// option says what it will actually list rather than a generic word.
const basicFields = vals => {
  const c = (state.meta.concepts || []).find(x => x.name === vals.concept)
  const newest = `The newest ${(c?.labelPlural || c?.label || 'pages').toLowerCase()} (updates itself)`
  return [
    { key: 'label', type: 'text', label: 'Label', required: true },
    {
      key: 'type', type: 'select', label: 'Links to', required: true, width: 'half', options: [
        { value: 'doc', label: 'A page on this site' },
        { value: 'link', label: 'Another website or address' },
        { value: 'auto', label: newest },
        { value: 'heading', label: 'Heading (not a link)' },
        { value: 'divider', label: 'Divider line' },
      ],
    },
    { key: 'visibility', type: 'select', label: 'Visible to', options: [{ value: 'all', label: 'Everyone' }, { value: 'auth', label: 'Signed-in' }, { value: 'guest', label: 'Signed-out' }], width: 'half' },
  ]
}

const CARD_FIELDS = [
  { key: 'sublabel', type: 'text', label: 'Category / price line', help: '“Car Parking / Stacking Lift” · “From £55,460”', width: 'half' },
  { key: 'note', type: 'text', label: 'Button label / note', help: 'Catalogue: overrides the Explore button text', width: 'half' },
  { key: 'description', type: 'textarea', label: 'Description', rows: 2, help: 'Shown in the detail pane' },
  { key: 'image', type: 'image', label: 'Image' },
]

registerView('menus', async (root, [menuKey]) => {
  let { menus } = await get('/menus')
  if (!menus.length) {
    for (const key of ['main', 'footer']) {
      await put(`/menus/${key}`, { menu: { key, label: key === 'main' ? 'Main menu' : 'Footer', items: [] } }).catch(() => {})
    }
    ;({ menus } = await get('/menus'))
  }
  let active = menus.find(m => m.key === (menuKey || 'main')) || menus[0]
  let sel = null            // { kind: 'item'|'tab'|'column', ref, siblings, topId }
  let dirty = false
  let previewDevice = 'desktop'
  let previewSeq = 0

  // ---------- draft → live preview ----------

  const iframe = h('iframe.menu-preview-frame', { title: 'Menu preview' })
  const pushDraft = debounce(async () => {
    try {
      await put(`/menus/${active.key}/draft`, { menu: active })
      const openId = sel?.topId || active.items.find(i => i.mega || i.children?.length)?.id || ''
      iframe.src = `/?__menudraft=${encodeURIComponent(active.key)}${openId ? `&__open=${encodeURIComponent(openId)}` : ''}&__ts=${++previewSeq}`
    } catch {}
  }, 450)
  const refreshPreview = () => pushDraft()

  // ---------- dirty / save ----------

  const saveBtn = h('button.btn.primary', {
    onclick: async () => {
      await put(`/menus/${active.key}`, { menu: active })
      dirty = false
      saveBtn.textContent = 'Saved ✓'
      setTimeout(() => (saveBtn.textContent = 'Save menu'), 1400)
      toast('Menu is live', 'ok')
    },
  }, 'Save menu')
  const markDirty = () => {
    dirty = true
    saveBtn.textContent = 'Save menu •'
    refreshPreview()
  }

  // ---------- tree ----------

  const treeHolder = h('div.menu-tree', { role: 'tree', 'aria-label': 'Menu structure' })

  /** Every visible row, in the order they are painted (= the order they read). */
  const treeRows = () => [...treeHolder.querySelectorAll('.mrow')]

  /** Put keyboard focus back on the row the tree now shows as selected. */
  const focusSelectedRow = () =>
    setTimeout(() => (treeHolder.querySelector('.mrow.active') || treeRows()[0])?.focus({ preventScroll: true }), 0)

  // A row used to be a plain <div> with a click handler: Tab reached the three
  // icon buttons inside it but never the row, so selecting a link — the whole
  // point of this page — needed a mouse. It is a div[role=treeitem] with a
  // roving tabindex now, the same pattern the editor outline uses.
  function rowKeys(e, onActivate) {
    const rows = treeRows()
    const i = rows.indexOf(e.currentTarget)
    const focusAt = j => {
      const r = rows[Math.max(0, Math.min(j, rows.length - 1))]
      if (r) { rows.forEach(x => (x.tabIndex = -1)); r.tabIndex = 0; r.focus() }
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0) }
    else if (e.key === 'End') { e.preventDefault(); focusAt(rows.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') {
      // A row is a div, so it has to re-create a button's activation keys.
      e.preventDefault(); onActivate?.(e); focusSelectedRow()
    }
  }

  const rowShell = (depth, opts, ...kids) => h('div.mrow', {
    class: [opts.active ? 'active' : '', opts.muted ? 'muted' : ''].filter(Boolean).join(' '),
    style: { paddingLeft: `${0.4 + depth * 0.85}rem` },
    role: 'treeitem',
    'aria-level': String(depth + 1),
    ...(opts.muted ? {} : { 'aria-selected': String(!!opts.active) }),
    // R11 — a parent row has to say whether its children are showing. This
    // tree always paints them, so every parent is expanded; rows with nothing
    // under them carry no state at all.
    ...(opts.expanded === undefined ? {} : { 'aria-expanded': String(opts.expanded) }),
    tabindex: opts.active ? '0' : '-1',
    onclick: opts.onclick,
    onkeydown: e => rowKeys(e, opts.onclick),
    draggable: opts.draggable ? 'true' : undefined,
  }, ...kids)

  const kindIcon = it =>
    it.mega ? (it.mega.layout === 'catalogue' || it.mega.tabs?.length ? 'tabs' : it.mega.layout === 'showcase' ? 'layout' : 'columns')
      : it.type === 'heading' ? 'heading'
        : it.type === 'divider' ? 'minus'
          : it.type === 'auto' ? 'refresh'
            : it.type === 'doc' ? 'page'
              : it.children?.length ? 'chevD' : 'link'

  function paintTree() {
    treeHolder.replaceChildren()
    const level = (items, depth, topOf) => {
      // Each nested level is a group inside the tree, or its rows are orphaned
      // from the tree in the accessibility tree ("1 of 1" instead of the real
      // position).
      const wrap = h('div.mlevel', { role: 'group' })
      items.forEach(item => {
        const topId = topOf || item.id
        const isSel = sel?.ref === item
        const hasKids = !!(item.mega || item.children?.length || item._showKids)
        wrap.appendChild(rowShell(depth, {
          active: isSel, draggable: true, ...(hasKids ? { expanded: true } : {}),
          onclick: e => { e.stopPropagation(); select({ kind: 'item', ref: item, siblings: items, topId }) },
        },
          iconEl(kindIcon(item), 14),
          h('span.mrow-label', {}, item.label || item.type),
          item.mega ? h('span.mrow-tag', {}, panelName(item.mega.layout === 'catalogue' || item.mega.tabs?.length ? 'catalogue' : item.mega.layout || 'columns')) : '',
          item.visibility && item.visibility !== 'all' ? h('span.mrow-tag', {}, item.visibility) : '',
          h('span.mrow-tools', {},
            h('button.icon-btn', { title: 'Move up', 'aria-label': `Move “${item.label || item.type || 'link'}” up`, onclick: e => { e.stopPropagation(); const i = items.indexOf(item); if (i > 0) { items.splice(i - 1, 0, items.splice(i, 1)[0]); markDirty(); paintTree() } }, html: icon('up', 13) }),
            h('button.icon-btn', { title: 'Move down', 'aria-label': `Move “${item.label || item.type || 'link'}” down`, onclick: e => { e.stopPropagation(); const i = items.indexOf(item); if (i < items.length - 1) { items.splice(i + 1, 0, items.splice(i, 1)[0]); markDirty(); paintTree() } }, html: icon('down', 13) }),
            h('button.icon-btn', { title: 'Remove', 'aria-label': `Remove “${item.label || item.type || 'link'}”`, onclick: e => { e.stopPropagation(); const at = items.indexOf(item); items.splice(at, 1); if (sel?.ref === item) sel = null; markDirty(); paintTree(); paintInspector(); undoToast(`Removed “${item.label || 'link'}”`, () => { items.splice(at, 0, item); markDirty(); paintTree(); paintInspector() }) }, html: icon('trash', 12) }))))

        // nested structure
        if (item.mega) {
          const mega = item.mega
          const layout = mega.layout || (mega.tabs?.length ? 'catalogue' : mega.items?.length ? 'showcase' : 'columns')
          if (layout === 'catalogue') {
            mega.tabs ??= []
            for (const tab of mega.tabs) {
              const tabSel = sel?.ref === tab
              wrap.appendChild(rowShell(depth + 1, {
                active: tabSel, expanded: true,
                onclick: e => { e.stopPropagation(); select({ kind: 'tab', ref: tab, siblings: mega.tabs, topId, parent: item }) },
              },
                iconEl('folder', 13),
                h('span.mrow-label', {}, tab.label || 'Tab'),
                h('span.mrow-tag', {}, `${(tab.items || []).length}`),
                h('span.mrow-tools', {},
                  h('button.icon-btn', { title: 'Add entry', 'aria-label': `Add an entry to “${tab.label || 'tab'}”`, onclick: e => { e.stopPropagation(); (tab.items ??= []).push(newCard()); markDirty(); paintTree() }, html: icon('plus', 12) }),
                  h('button.icon-btn', { title: 'Remove tab', 'aria-label': `Remove tab “${tab.label || 'tab'}”`, onclick: e => { e.stopPropagation(); const at = mega.tabs.indexOf(tab); mega.tabs.splice(at, 1); markDirty(); paintTree(); paintInspector(); undoToast(`Removed tab “${tab.label || 'tab'}”`, () => { mega.tabs.splice(at, 0, tab); markDirty(); paintTree(); paintInspector() }) }, html: icon('trash', 12) }))))
              tab.items ??= []
              wrap.appendChild(level(tab.items, depth + 2, topId))
            }
            wrap.appendChild(rowShell(depth + 1, { muted: true, onclick: e => { e.stopPropagation(); mega.tabs.push({ id: uid(), label: 'New tab', items: [] }); markDirty(); paintTree() } },
              iconEl('plus', 12), h('span.mrow-label', {}, 'Add tab')))
          } else if (layout === 'showcase') {
            mega.items ??= []
            wrap.appendChild(level(mega.items, depth + 1, topId))
            wrap.appendChild(rowShell(depth + 1, { muted: true, onclick: e => { e.stopPropagation(); mega.items.push(newCard()); markDirty(); paintTree() } },
              iconEl('plus', 12), h('span.mrow-label', {}, 'Add card')))
          } else {
            mega.columns ??= []
            for (const col of mega.columns) {
              const colSel = sel?.ref === col
              wrap.appendChild(rowShell(depth + 1, {
                active: colSel, expanded: true,
                onclick: e => { e.stopPropagation(); select({ kind: 'column', ref: col, siblings: mega.columns, topId, parent: item }) },
              },
                iconEl('columns', 13),
                h('span.mrow-label', {}, col.title || 'Column'),
                h('span.mrow-tools', {},
                  h('button.icon-btn', { title: 'Add link', 'aria-label': `Add a link to “${col.title || 'column'}”`, onclick: e => { e.stopPropagation(); (col.items ??= []).push({ id: uid(), label: 'New link', type: 'link', href: '/' }); markDirty(); paintTree() }, html: icon('plus', 12) }),
                  h('button.icon-btn', { title: 'Remove column', 'aria-label': `Remove column “${col.title || 'column'}”`, onclick: e => { e.stopPropagation(); const at = mega.columns.indexOf(col); mega.columns.splice(at, 1); markDirty(); paintTree(); paintInspector(); undoToast('Removed a column', () => { mega.columns.splice(at, 0, col); markDirty(); paintTree(); paintInspector() }) }, html: icon('trash', 12) }))))
              col.items ??= []
              wrap.appendChild(level(col.items, depth + 2, topId))
            }
            wrap.appendChild(rowShell(depth + 1, { muted: true, onclick: e => { e.stopPropagation(); mega.columns.push({ title: 'New column', items: [] }); markDirty(); paintTree() } },
              iconEl('plus', 12), h('span.mrow-label', {}, 'Add column')))
          }
        } else if (item.children?.length || item._showKids) {
          item.children ??= []
          wrap.appendChild(level(item.children, depth + 1, topId))
          wrap.appendChild(rowShell(depth + 1, { muted: true, onclick: e => { e.stopPropagation(); item.children.push({ id: uid(), label: 'New item', type: 'link', href: '/' }); markDirty(); paintTree() } },
            iconEl('plus', 12), h('span.mrow-label', {}, 'Add child')))
        }
      })
      return wrap
    }
    treeHolder.appendChild(level(active.items, 0, null))
    if (!active.items.length) {
      treeHolder.appendChild(emptyState(icon('menu', 24), 'Empty menu', 'Add the first item below.'))
    }
    // Roving tabindex: with nothing selected yet, Tab must still land on the
    // first row rather than skipping the tree entirely.
    if (!treeHolder.querySelector('.mrow.active')) {
      const first = treeRows()[0]
      if (first) first.tabIndex = 0
    }
    treeHolder.appendChild(h('button.tree-add', {
      onclick: () => {
        const item = { id: uid(), label: 'New item', type: 'link', href: '/' }
        active.items.push(item)
        select({ kind: 'item', ref: item, siblings: active.items, topId: item.id })
        markDirty(); paintTree()
      },
    }, '＋ Add menu item'))
  }

  const newCard = () => ({ id: uid(), label: 'New entry', type: 'link', href: '/', sublabel: '' })

  function select(next, opts = {}) {
    sel = next
    paintTree()
    paintInspector()
    if (!opts.quiet) refreshPreview()
  }

  /**
   * Find a menu entry by the id the rendered page carries, wherever it sits —
   * a child list, a column, a tab. Returns what select() needs.
   */
  function locate(id, items = active.items, topOf = null) {
    for (const item of items) {
      const topId = topOf || item.id
      if (item.id === id) return { kind: 'item', ref: item, siblings: items, topId }
      const nested = [
        item.children,
        item.mega?.items,
        ...(item.mega?.tabs || []).map(t => t.items),
        ...(item.mega?.columns || []).map(c => c.items),
      ].filter(Boolean)
      for (const list of nested) {
        const hit = locate(id, list, topId)
        if (hit) return hit
      }
    }
    return null
  }

  // The preview never navigates (see src/assets/blockhouse/runtime.js). A click
  // on a menu entry in the frame means "I want to change this one", so it
  // selects that entry in the tree instead.
  const onPreviewMessage = e => {
    if (e.source !== iframe.contentWindow) return
    const m = e.data || {}
    if (m.blockhouse !== 'menuselect' || !m.id) return
    const hit = locate(String(m.id))
    if (!hit) return
    // reloading the frame just to re-open the panel it is already showing is
    // only a flicker, so keep it still when the open panel has not changed
    select(hit, { quiet: hit.topId === (sel?.topId || null) })
  }
  addEventListener('message', onPreviewMessage)

  // ---------- inspector ----------

  const inspEl = h('div.menu-insp')

  const section = (title, ...kids) => h('div.minsp-sec', {},
    h('div.insp-section-title', {}, title), ...kids)

  function paintInspector() {
    if (!sel) {
      inspEl.replaceChildren(h('div.menu-insp-empty', {},
        iconEl('menu', 22),
        h('p', {}, 'Choose an item on the left to change it.'),
        h('ul.menu-insp-bullets', {},
          h('li', {}, 'Rename it — the words visitors read.'),
          h('li', {}, 'Point it somewhere else — a page on this site or another address.'),
          h('li', {}, 'Give it a dropdown — a simple list, columns, pictures or a full catalogue.'))))
      return
    }
    const { kind, ref } = sel

    if (kind === 'tab') {
      inspEl.replaceChildren(
        section('Catalogue tab',
          renderFields([{ key: 'label', type: 'text', label: 'Tab label', required: true }], ref, () => { markDirty(); paintTree() }),
          h('p.fnt.text-s', {}, 'Entries under this tab fill the left list; each entry’s image, category line and description build its detail pane.'),
          h('button.btn.ghost.small', { onclick: () => { (ref.items ??= []).push(newCard()); markDirty(); paintTree() } }, iconEl('plus', 13), 'Add entry')))
      return
    }
    if (kind === 'column') {
      inspEl.replaceChildren(
        section('Panel column',
          renderFields([
            { key: 'title', type: 'text', label: 'Column title' },
            { key: 'span', type: 'number', label: 'Width (columns spanned)', width: 'half' },
          ], ref, () => { markDirty(); paintTree() }),
          h('button.btn.ghost.small', { onclick: () => { (ref.items ??= []).push({ id: uid(), label: 'New link', type: 'link', href: '/' }); markDirty(); paintTree() } }, iconEl('plus', 13), 'Add link')))
      return
    }

    // ---- item ----
    const item = ref
    const vals = { visibility: 'all', ...item, docId: item.docId ? { docId: item.docId, docTitle: item.docTitle } : undefined }
    const basicsForm = renderFields([
      ...basicFields(vals),
      ...(vals.type === 'link' || !vals.type ? [{ key: 'href', type: 'text', label: 'URL', help: '/path, https://…, #anchor' }] : []),
      ...(vals.type === 'doc' ? [{ key: 'docId', type: 'link', label: 'Page' }] : []),
      ...(vals.type === 'auto' ? [
        { key: 'concept', type: 'select', label: 'Content type', options: state.meta.concepts.map(c => ({ value: c.name, label: c.labelPlural || c.label })), width: 'half' },
        { key: 'limit', type: 'number', label: 'How many', width: 'half' },
      ] : []),
    ], vals, (k, v) => {
      if (k === 'docId') { if (v?.docId) { item.docId = v.docId; item.docTitle = v.docTitle } else delete item.docId }
      else if (v === '' || v == null) delete item[k]
      else item[k] = v
      if (k === 'type') paintInspector()
      markDirty(); paintTree()
    })

    const isTop = active.items.includes(item)
    const groups = state.meta.memberGroups || []
    const audiencePart = groups.length ? h('div.mt-1', {},
      h('span.fnt.text-xs.d-block.mb-1', {}, 'Only show to member groups (blank = everyone allowed by the rule above):'),
      h('div.d-flex.gap-2.wrap', {},
        ...groups.map(g => h('label.field-check.p-0-0', {},
          h('input', {
            type: 'checkbox', checked: (item.memberGroups || []).includes(g.id),
            onchange: e => {
              const set = new Set(item.memberGroups || [])
              e.target.checked ? set.add(g.id) : set.delete(g.id)
              item.memberGroups = [...set]
              if (!item.memberGroups.length) delete item.memberGroups
              markDirty()
            },
          }), h('span', {}, g.label))))) : ''
    const parts = [section(isTop ? 'Menu item' : 'Entry', basicsForm, audiencePart)]

    // panel management only for top-level items
    if (isTop && item.type !== 'heading' && item.type !== 'divider') {
      const mode = item.mega ? (item.mega.layout || (item.mega.tabs?.length ? 'catalogue' : item.mega.items?.length ? 'showcase' : 'columns'))
        : (item.children?.length || item._showKids) ? 'dropdown' : 'none'
      const seg = h('div.seg.menu-panel-seg', {}, ...PANEL_MODES.map(([k, l]) => h('button', {
        class: mode === k ? 'active' : '',
        onclick: () => {
          if (k === 'none') { delete item.mega; delete item.children; delete item._showKids }
          else if (k === 'dropdown') { delete item.mega; item.children ??= []; item._showKids = true }
          else {
            delete item.children; delete item._showKids
            item.mega ??= {}
            item.mega.layout = k
            if (k === 'columns') item.mega.columns ??= [{ title: 'Column', items: [] }]
            if (k === 'showcase') item.mega.items ??= [newCard()]
            if (k === 'catalogue') item.mega.tabs ??= [{ id: uid(), label: 'First category', items: [newCard()] }]
          }
          markDirty(); paintTree(); paintInspector()
        },
      }, l)))
      const panelBits = [seg,
        h('p.fnt.menu-panel-help', {}, PANEL_MODES.find(m => m[0] === mode)?.[2] || '')]
      if (item.mega) {
        panelBits.push(renderFields([
          ...(mode === 'catalogue' ? [{ key: 'ctaLabel', type: 'text', label: 'Detail button label', help: 'Default “Explore” — per-entry override via the entry’s Note field', width: 'half' }] : []),
          { key: 'wide', type: 'boolean', label: 'Extra wide panel (columns/showcase)' },
        ], item.mega, () => markDirty()))
        panelBits.push(tilesEditor(item.mega), footerEditor(item.mega))
      }
      parts.push(section('Dropdown', ...panelBits))
    }

    // rich card fields for entries inside panels
    if (!isTop) {
      parts.push(section('Card & detail pane',
        renderFields(CARD_FIELDS, item, (k, v) => {
          if (v === '' || v == null) delete item[k]; else item[k] = v
          markDirty(); paintTree()
        }),
        h('p.row.fnt.text-xs.wrap', {}, 'Icon:', iconChips(item))))
    }

    inspEl.replaceChildren(...parts)
  }

  function iconChips(item) {
    const NAMES = ['compare', 'bespoke', 'classic', 'electric', 'tag', 'bolt', 'mail', 'globe', 'star', 'doc', 'building', 'phone', 'calendar', 'key']
    return h('span.menu-chip-row', {},
      ...NAMES.map(n => h('button.icon-btn', {
        title: n, 'aria-label': `Use the ${n} icon`, style: item.icon === n ? { background: 'var(--acc-soft)' } : {},
        onclick: () => { item.icon = item.icon === n ? undefined : n; markDirty(); paintInspector() },
        html: icon(n, 14),
      })))
  }

  function tilesEditor(mega) {
    mega.tiles ??= []
    const holder = h('div.stack-1.mt-3', {})
    const paint = () => holder.replaceChildren(
      h('strong.text-s', {}, 'Utility tiles ', h('span.fnt.fw-regular', {}, '— icon shortcuts under the panel')),
      ...mega.tiles.map((t, ti) => h('div.d-flex.gap-1', {},
        h('input.input.mw-7.text-s', { value: t.icon || '', placeholder: 'icon', oninput: e => { t.icon = e.target.value; markDirty() } }),
        h('input.input.text-s', { value: t.label || '', placeholder: 'Label', oninput: e => { t.label = e.target.value; markDirty() } }),
        h('input.input.text-s', { value: t.href || '', placeholder: '/link', oninput: e => { t.href = e.target.value; markDirty() } }),
        h('button.icon-btn', { title: 'Remove tile', 'aria-label': `Remove tile “${t.label || 'tile'}”`, onclick: () => { mega.tiles.splice(ti, 1); markDirty(); paint() }, html: icon('x', 12) }))),
      h('button.tree-add', { onclick: () => { mega.tiles.push({ icon: 'compare', label: 'New tile', href: '/' }); markDirty(); paint() } }, '＋ tile'))
    paint()
    return holder
  }

  function footerEditor(mega) {
    mega.footer ??= []
    const holder = h('div.stack-1.mt-3', {})
    const paint = () => holder.replaceChildren(
      h('strong.text-s', {}, 'Footer brand bar'),
      h('input.input.text-s', { value: mega.footerTitle || '', placeholder: 'Bar title (e.g. OUR OTHER BRANDS:)', oninput: e => { mega.footerTitle = e.target.value; markDirty() } }),
      ...mega.footer.map((f2, fi) => h('div.d-flex.gap-1', {},
        h('input.input.text-s', { value: f2.label || '', placeholder: 'LABEL', oninput: e => { f2.label = e.target.value; markDirty() } }),
        h('input.input.text-s', { value: f2.href || '', placeholder: 'https://… or /path', oninput: e => { f2.href = e.target.value; markDirty() } }),
        h('button.icon-btn', { title: 'Remove link', 'aria-label': `Remove footer link “${f2.label || 'link'}”`, onclick: () => { mega.footer.splice(fi, 1); markDirty(); paint() }, html: icon('x', 12) }))),
      h('button.tree-add', { onclick: () => { mega.footer.push({ label: 'BRAND', href: '/' }); markDirty(); paint() } }, '＋ footer link'))
    paint()
    return holder
  }

  // ---------- layout ----------

  const menuSelect = h('select.input.text-m.fw-semi', { onchange: e => (location.hash = `#/menus/${e.target.value}`) }, ...menus.map(m => h('option', { value: m.key, selected: m.key === active.key }, m.label || m.key)))

  const frameHolder = h('div.menu-preview', {}, iframe)
  let unfit = null
  const applyDevice = () => {
    unfit?.(); unfit = null
    iframe.style.cssText = ''
    if (previewDevice === 'desktop') unfit = fitPreviewFrame(frameHolder, iframe, 1280)
  }
  requestAnimationFrame(applyDevice)

  const deviceSeg = h('div.seg', {}, ...[['desktop', 'desktop', 'Desktop'], ['phone', 'phone', 'Mobile']].map(([k, ic, l]) =>
    h('button', {
      class: previewDevice === k ? 'active' : '', title: l,
      onclick: e => {
        previewDevice = k
        deviceSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
        e.currentTarget.classList.add('active')
        frameHolder.classList.toggle('device-phone', k === 'phone')
        applyDevice()
      },
    }, iconEl(ic, 14))))

  root.replaceChildren(h('div.menu-studio', {},
    h('div.menu-left', {},
      h('div.menu-left-title', {},
        h('div', {}, h('h1', {}, 'Navigation'),
          h('p.sub', {}, 'The menus visitors use to get around. Changes go live when you press Save.')),
        helpButton('menus', 'Navigation')),
      h('div.menu-left-head', {},
        menuSelect,
        h('button.btn.ghost.small.menu-add-item', {
          onclick: () => {
            const item = { id: uid(), label: 'New item', type: 'link', href: '/' }
            active.items.push(item)
            select({ kind: 'item', ref: item, siblings: active.items, topId: item.id })
            markDirty(); paintTree()
          },
        }, iconEl('plus', 13), 'Add item'),
        h('button.btn.ghost.small', {
          title: 'Start another menu, for example a set of legal links', onclick: () => {
            const key = h('input.input', { placeholder: 'e.g. legal' })
            const label = h('input.input', { placeholder: 'Legal links' })
            dialog({
              title: 'Start another menu',
              body: h('div', {},
                h('div.field', {}, h('label', {}, 'Short name (letters and dashes, used by the template)'), key),
                h('div.field', {}, h('label', {}, 'Name you will see'), label)),
              actions: [{
                label: 'Create', kind: 'primary', onClick: async () => {
                  const k = key.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
                  if (!k) return false
                  await put(`/menus/${k}`, { menu: { key: k, label: label.value || k, items: [] } })
                  location.hash = `#/menus/${k}`
                  return true
                },
              }],
            })
          },
        }, 'New menu')),
      h('p.fnt.menu-hint', {}, 'Click an item to change it · drag to reorder · everything previews live before you save.'),
      treeHolder,
      h('div.menu-left-foot', {}, saveBtn)),
    h('div.menu-right', {},
      h('div.menu-preview-bar', {},
        h('span.fnt.text-s.d-iflex.gap-2.items-center', {}, iconEl('eye', 13), 'Live preview — draft only; the site changes when you save'),
        deviceSeg),
      frameHolder,
      inspEl)))

  paintTree()
  paintInspector()
  // The view promises "the site changes when you save". Publishing silently on
  // the way out broke that promise with the site's live navigation.
  // Three honest outcomes. The /draft endpoint backs the live preview and is
  // held in memory on the server, so it cannot be offered as a place to keep
  // work — saying "kept as a draft" and then dropping it would be worse than
  // saying nothing.
  const disposeGuard = registerGuard('menus', async () => {
    if (!dirty) return true
    // This was the one guard of six written correctly. It now shares the same
    // implementation as the rest so the pattern cannot drift apart again.
    const leave = await unsavedDialog({
      title: 'Unsaved menu changes',
      body: `“${active.label || active.key}” has changes that are not live yet. Publishing puts them on the site straight away.`,
      saveLabel: 'Publish now',
      onSave: async () => {
        await put(`/menus/${active.key}`, { menu: active })
        toast('Menu is live', 'ok')
      },
    })
    if (leave) dirty = false
    return leave
  })
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)

  refreshPreview()

  return () => {
    unfit?.()
    del(`/menus/${active.key}/draft`).catch(() => {})
    disposeGuard()
    removeEventListener('message', onPreviewMessage)
    removeEventListener('beforeunload', beforeUnload)
  }
})
