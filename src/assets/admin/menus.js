// Menu studio — structure tree on the left, a LIVE preview of the real site on
// the right (rendered from a draft buffer, so nothing goes live until Save),
// and an inline inspector for whatever is selected. No dialogs, no guessing:
// every edit repaints the actual header within half a second.

import { get, put, del } from './api.js'
import { h, debounce, dialog, makeSortable, toast, emptyState, fitPreviewFrame, confirmDialog } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, registerGuard } from './state.js'
import { icon, iconEl } from './icons.js'

const uid = () => 'mi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const BASIC_FIELDS = [
  { key: 'label', type: 'text', label: 'Label', required: true },
  {
    key: 'type', type: 'select', label: 'Links to', required: true, width: 'half', options: [
      { value: 'link', label: 'URL' },
      { value: 'doc', label: 'A page' },
      { value: 'auto', label: 'Latest documents' },
      { value: 'heading', label: '— heading —' },
      { value: 'divider', label: '— divider —' },
    ],
  },
  { key: 'visibility', type: 'select', label: 'Visible to', options: [{ value: 'all', label: 'Everyone' }, { value: 'auth', label: 'Signed-in' }, { value: 'guest', label: 'Signed-out' }], width: 'half' },
]

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

  const treeHolder = h('div.menu-tree')

  const rowShell = (depth, opts, ...kids) => h('div.mrow', {
    class: [opts.active ? 'active' : '', opts.muted ? 'muted' : ''].filter(Boolean).join(' '),
    style: { paddingLeft: `${0.4 + depth * 0.85}rem` },
    onclick: opts.onclick,
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
      const wrap = h('div.mlevel')
      items.forEach(item => {
        const topId = topOf || item.id
        const isSel = sel?.ref === item
        wrap.appendChild(rowShell(depth, {
          active: isSel, draggable: true,
          onclick: e => { e.stopPropagation(); select({ kind: 'item', ref: item, siblings: items, topId }) },
        },
          iconEl(kindIcon(item), 14),
          h('span.mrow-label', {}, item.label || item.type),
          item.mega ? h('span.mrow-tag', {}, item.mega.layout === 'catalogue' || item.mega.tabs?.length ? 'catalogue' : item.mega.layout || 'mega') : '',
          item.visibility && item.visibility !== 'all' ? h('span.mrow-tag', {}, item.visibility) : '',
          h('span.mrow-tools', {},
            h('button.icon-btn', { title: 'Move up', onclick: e => { e.stopPropagation(); const i = items.indexOf(item); if (i > 0) { items.splice(i - 1, 0, items.splice(i, 1)[0]); markDirty(); paintTree() } }, html: icon('up', 13) }),
            h('button.icon-btn', { title: 'Move down', onclick: e => { e.stopPropagation(); const i = items.indexOf(item); if (i < items.length - 1) { items.splice(i + 1, 0, items.splice(i, 1)[0]); markDirty(); paintTree() } }, html: icon('down', 13) }),
            h('button.icon-btn', { title: 'Remove', onclick: e => { e.stopPropagation(); items.splice(items.indexOf(item), 1); if (sel?.ref === item) sel = null; markDirty(); paintTree(); paintInspector() }, html: icon('trash', 12) }))))

        // nested structure
        if (item.mega) {
          const mega = item.mega
          const layout = mega.layout || (mega.tabs?.length ? 'catalogue' : mega.items?.length ? 'showcase' : 'columns')
          if (layout === 'catalogue') {
            mega.tabs ??= []
            for (const tab of mega.tabs) {
              const tabSel = sel?.ref === tab
              wrap.appendChild(rowShell(depth + 1, {
                active: tabSel,
                onclick: e => { e.stopPropagation(); select({ kind: 'tab', ref: tab, siblings: mega.tabs, topId, parent: item }) },
              },
                iconEl('folder', 13),
                h('span.mrow-label', {}, tab.label || 'Tab'),
                h('span.mrow-tag', {}, `${(tab.items || []).length}`),
                h('span.mrow-tools', {},
                  h('button.icon-btn', { title: 'Add entry', onclick: e => { e.stopPropagation(); (tab.items ??= []).push(newCard()); markDirty(); paintTree() }, html: icon('plus', 12) }),
                  h('button.icon-btn', { title: 'Remove tab', onclick: e => { e.stopPropagation(); mega.tabs.splice(mega.tabs.indexOf(tab), 1); markDirty(); paintTree(); paintInspector() }, html: icon('trash', 12) }))))
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
                active: colSel,
                onclick: e => { e.stopPropagation(); select({ kind: 'column', ref: col, siblings: mega.columns, topId, parent: item }) },
              },
                iconEl('columns', 13),
                h('span.mrow-label', {}, col.title || 'Column'),
                h('span.mrow-tools', {},
                  h('button.icon-btn', { title: 'Add link', onclick: e => { e.stopPropagation(); (col.items ??= []).push({ id: uid(), label: 'New link', type: 'link', href: '/' }); markDirty(); paintTree() }, html: icon('plus', 12) }),
                  h('button.icon-btn', { title: 'Remove column', onclick: e => { e.stopPropagation(); mega.columns.splice(mega.columns.indexOf(col), 1); markDirty(); paintTree(); paintInspector() }, html: icon('trash', 12) }))))
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

  function select(next) {
    sel = next
    paintTree()
    paintInspector()
    refreshPreview()
  }

  // ---------- inspector ----------

  const inspEl = h('div.menu-insp')

  const section = (title, ...kids) => h('div.minsp-sec', {},
    h('div.insp-section-title', {}, title), ...kids)

  function paintInspector() {
    if (!sel) {
      inspEl.replaceChildren(h('div.menu-insp-empty', {},
        iconEl('menu', 22),
        h('p', {}, 'Select something in the structure to edit it here.'),
        h('p.fnt', { style: { fontSize: '0.76rem' } }, 'For the full-screen tabbed menu: select an item, then Panel → Catalogue.')))
      return
    }
    const { kind, ref } = sel

    if (kind === 'tab') {
      inspEl.replaceChildren(
        section('Catalogue tab',
          renderFields([{ key: 'label', type: 'text', label: 'Tab label', required: true }], ref, () => { markDirty(); paintTree() }),
          h('p.fnt', { style: { fontSize: '0.76rem' } }, 'Entries under this tab fill the left list; each entry’s image, category line and description build its detail pane.'),
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
      ...BASIC_FIELDS,
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
    const audiencePart = groups.length ? h('div', { style: { marginTop: '0.3rem' } },
      h('span.fnt', { style: { fontSize: '0.74rem', display: 'block', marginBottom: '0.25rem' } }, 'Only show to member groups (blank = everyone allowed by the rule above):'),
      h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
        ...groups.map(g => h('label.field-check', { style: { padding: '0.1rem 0' } },
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
      const seg = h('div.seg', { style: { flexWrap: 'wrap' } }, ...[
        ['none', 'None'], ['dropdown', 'Dropdown'], ['columns', 'Link columns'], ['showcase', 'Showcase'], ['catalogue', 'Catalogue'],
      ].map(([k, l]) => h('button', {
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
        h('p.fnt', { style: { fontSize: '0.75rem', margin: '0.4rem 0 0' } },
          mode === 'catalogue' ? 'Full-screen: category tabs → item list → detail pane. Built for big product ranges.'
            : mode === 'showcase' ? 'Card rail with a hover-synced detail pane.'
              : mode === 'columns' ? 'Classic columns of grouped links, with optional icons and descriptions.'
                : mode === 'dropdown' ? 'Simple list of links under this item.'
                  : 'Plain link — no panel.')]
      if (item.mega) {
        panelBits.push(renderFields([
          ...(mode === 'catalogue' ? [{ key: 'ctaLabel', type: 'text', label: 'Detail button label', help: 'Default “Explore” — per-entry override via the entry’s Note field', width: 'half' }] : []),
          { key: 'wide', type: 'boolean', label: 'Extra wide panel (columns/showcase)' },
        ], item.mega, () => markDirty()))
        panelBits.push(tilesEditor(item.mega), footerEditor(item.mega))
      }
      parts.push(section('Panel', ...panelBits))
    }

    // rich card fields for entries inside panels
    if (!isTop) {
      parts.push(section('Card & detail pane',
        renderFields(CARD_FIELDS, item, (k, v) => {
          if (v === '' || v == null) delete item[k]; else item[k] = v
          markDirty(); paintTree()
        }),
        h('p.fnt', { style: { fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' } }, 'Icon:', iconChips(item))))
    }

    inspEl.replaceChildren(...parts)
  }

  function iconChips(item) {
    const NAMES = ['compare', 'bespoke', 'classic', 'electric', 'tag', 'bolt', 'mail', 'globe', 'star', 'doc', 'building', 'phone', 'calendar', 'key']
    return h('span', { style: { display: 'inline-flex', gap: '0.2rem', flexWrap: 'wrap', verticalAlign: 'middle' } },
      ...NAMES.map(n => h('button.icon-btn', {
        title: n, style: item.icon === n ? { background: 'var(--acc-soft)' } : {},
        onclick: () => { item.icon = item.icon === n ? undefined : n; markDirty(); paintInspector() },
        html: icon(n, 14),
      })))
  }

  function tilesEditor(mega) {
    mega.tiles ??= []
    const holder = h('div', { style: { display: 'grid', gap: '0.3rem', marginTop: '0.6rem' } })
    const paint = () => holder.replaceChildren(
      h('strong', { style: { fontSize: '0.76rem' } }, 'Utility tiles ', h('span.fnt', { style: { fontWeight: 400 } }, '— icon shortcuts under the panel')),
      ...mega.tiles.map((t, ti) => h('div', { style: { display: 'flex', gap: '0.3rem' } },
        h('input.input', { value: t.icon || '', placeholder: 'icon', style: { maxWidth: '7rem', fontSize: '0.78rem' }, oninput: e => { t.icon = e.target.value; markDirty() } }),
        h('input.input', { value: t.label || '', placeholder: 'Label', style: { fontSize: '0.78rem' }, oninput: e => { t.label = e.target.value; markDirty() } }),
        h('input.input', { value: t.href || '', placeholder: '/link', style: { fontSize: '0.78rem' }, oninput: e => { t.href = e.target.value; markDirty() } }),
        h('button.icon-btn', { onclick: () => { mega.tiles.splice(ti, 1); markDirty(); paint() }, html: icon('x', 12) }))),
      h('button.tree-add', { onclick: () => { mega.tiles.push({ icon: 'compare', label: 'New tile', href: '/' }); markDirty(); paint() } }, '＋ tile'))
    paint()
    return holder
  }

  function footerEditor(mega) {
    mega.footer ??= []
    const holder = h('div', { style: { display: 'grid', gap: '0.3rem', marginTop: '0.6rem' } })
    const paint = () => holder.replaceChildren(
      h('strong', { style: { fontSize: '0.76rem' } }, 'Footer brand bar'),
      h('input.input', { value: mega.footerTitle || '', placeholder: 'Bar title (e.g. OUR OTHER BRANDS:)', style: { fontSize: '0.78rem' }, oninput: e => { mega.footerTitle = e.target.value; markDirty() } }),
      ...mega.footer.map((f2, fi) => h('div', { style: { display: 'flex', gap: '0.3rem' } },
        h('input.input', { value: f2.label || '', placeholder: 'LABEL', style: { fontSize: '0.78rem' }, oninput: e => { f2.label = e.target.value; markDirty() } }),
        h('input.input', { value: f2.href || '', placeholder: 'https://… or /path', style: { fontSize: '0.78rem' }, oninput: e => { f2.href = e.target.value; markDirty() } }),
        h('button.icon-btn', { onclick: () => { mega.footer.splice(fi, 1); markDirty(); paint() }, html: icon('x', 12) }))),
      h('button.tree-add', { onclick: () => { mega.footer.push({ label: 'BRAND', href: '/' }); markDirty(); paint() } }, '＋ footer link'))
    paint()
    return holder
  }

  // ---------- layout ----------

  const menuSelect = h('select.input', {
    style: { fontSize: '0.85rem', fontWeight: 600 },
    onchange: e => (location.hash = `#/menus/${e.target.value}`),
  }, ...menus.map(m => h('option', { value: m.key, selected: m.key === active.key }, m.label || m.key)))

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
      h('div.menu-left-head', {},
        menuSelect,
        h('button.icon-btn', {
          title: 'New menu', onclick: () => {
            const key = h('input.input', { placeholder: 'e.g. legal' })
            const label = h('input.input', { placeholder: 'Legal links' })
            dialog({
              title: 'New menu', body: h('div', {}, h('div.field', {}, h('label', {}, 'Key'), key), h('div.field', {}, h('label', {}, 'Label'), label)),
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
          html: icon('plus', 15),
        })),
      h('p.fnt.menu-hint', {}, 'Click to select · drag to reorder · everything previews live before you save.'),
      treeHolder,
      h('div.menu-left-foot', {}, saveBtn)),
    h('div.menu-right', {},
      h('div.menu-preview-bar', {},
        h('span.fnt', { style: { fontSize: '0.76rem', display: 'inline-flex', gap: '0.4rem', alignItems: 'center' } }, iconEl('eye', 13), 'Live preview — draft only; the site changes when you save'),
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
    return await new Promise(resolve => {
      dialog({
        title: 'Unsaved menu changes',
        body: h('p.dlg-text', {},
          `“${active.label || active.key}” has changes that are not live yet. Publishing puts them on the site straight away.`),
        actions: [
          { label: 'Keep editing', onClick: () => { resolve(false); return true } },
          { label: 'Discard changes', kind: 'danger', onClick: () => { dirty = false; resolve(true); return true } },
          {
            label: 'Publish now', kind: 'primary', onClick: async () => {
              await put(`/menus/${active.key}`, { menu: active }).catch(() => {})
              dirty = false
              toast('Menu is live', 'ok')
              resolve(true)
              return true
            },
          },
        ],
        onClose: v => { if (v === undefined) resolve(false) },
      })
    })
  })
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)

  refreshPreview()

  return () => {
    unfit?.()
    del(`/menus/${active.key}/draft`).catch(() => {})
    disposeGuard()
    removeEventListener('beforeunload', beforeUnload)
  }
})
