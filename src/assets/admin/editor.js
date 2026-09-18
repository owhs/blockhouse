// The document editor: outline rail + canvas + inspector.
//
// Three durable surfaces. The outline is always there (it used to live inside
// an inspector tab and vanish whenever you looked at SEO); the canvas is the
// point of the screen; the inspector only ever shows properties of the selected
// thing. Every mutation goes through docops so a shortcut, a drag, a right
// click and a palette entry are the same operation with the same undo entry.

import { get, put, post, del } from './api.js'
import { h, debounce, dialog, confirmDialog, contextMenu, toast, undoToast, fmtDate, fitPreviewFrame, makeTreeSortable, skeleton, sc } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, prefs, setPref, disclosure, setDisclosure, hooks, registerGuard, popReturn, peekReturn, toggleWide } from './state.js'
import { icon, iconEl } from './icons.js'
import { registerCommands } from './search.js'
import { helpButton } from './help.js'
import { quickDesign, quickChrome, quickMenu } from './quick.js'
import { sheetIsOpen } from './sheet.js'
import { makeOps, findNode, flatten, labelOf, uid, reId, copyBlocks, readClipboard, seedProps } from './docops.js'

registerView('editor', async (root, [docId, tabParam], query) => {
  const meta = state.meta
  let { doc, path, href, exportFile, shortlink, seo, stale } = await get(`/content/${docId}`)
  let baseVersion = doc.version
  let selectedId = null
  let dirty = false
  const undoStack = [], redoStack = []
  const catalogue = meta.blocks
  const byType = Object.fromEntries(catalogue.map(b => [b.type, b]))

  const canWrite = meta.perms.publish || meta.perms.settings || !!state.meta.perms.menus
    || ['owner', 'admin', 'editor', 'author'].includes(state.user.role)
  const readOnly = !canWrite

  // ---------- undo ----------

  function stateJson() { return JSON.stringify({ blocks: doc.blocks, fields: doc.fields, seo: doc.seo, title: doc.title, slug: doc.slug, custom: doc.custom, access: doc.access, aliases: doc.aliases }) }
  function snapshot(label = 'Edit') {
    undoStack.push({ json: stateJson(), label })
    if (undoStack.length > 80) undoStack.shift()
    redoStack.length = 0
    renderActions()
  }
  let snapshotArmed = true
  function snapshotOnce(label) {
    if (snapshotArmed) { snapshot(label); snapshotArmed = false; setTimeout(() => (snapshotArmed = true), 1200) }
  }
  function doUndo() {
    if (!undoStack.length) return toast('Nothing to undo', 'info', 1600)
    const entry = undoStack.pop()
    redoStack.push({ json: stateJson(), label: entry.label })
    restore(entry.json)
    toast(`Undid: ${entry.label.toLowerCase()}`, 'info', { ms: 3000, action: { label: 'Redo', onClick: doRedo } })
  }
  function doRedo() {
    if (!redoStack.length) return
    const entry = redoStack.pop()
    undoStack.push({ json: stateJson(), label: entry.label })
    restore(entry.json)
  }
  function restore(json) {
    Object.assign(doc, JSON.parse(json))
    titleInput.value = doc.title
    structuralSinceVersion = true
    renderTree(); renderInspector(); refreshPreview()
    scheduleSave()
    renderActions()
  }

  // ---------- saving ----------
  // One honest indicator. A failed save used to be painted the same amber as a
  // save in progress, and "Autosaved" implied a restore point that autosave
  // never created.

  const saveState = h('span.save-state', { role: 'status', 'aria-live': 'polite' })
  let lastSaveAt = null
  let lastVersionAt = null
  let structuralSinceVersion = false

  function paintSaveState(kind, text, retry) {
    saveState.className = `save-state ${kind}`
    saveState.replaceChildren(
      kind === 'error' ? h('span', { html: icon('warn', 12) }) : '',
      h('span', {}, text))
    saveState.onclick = retry || null
    saveState.title = kind === 'saved' && lastSaveAt
      ? `Saved at ${lastSaveAt.toLocaleTimeString()}${lastVersionAt ? ` · restore point at ${lastVersionAt.toLocaleTimeString()}` : sc(' · press ⌘S to make a restore point')}`
      : ''
  }

  async function save(explicit = false) {
    if (readOnly) return
    paintSaveState('saving', 'Saving…')
    // Autosave writes a restore point whenever the structure changed, so a
    // deleted block always has a floor beneath it.
    const wantVersion = explicit || structuralSinceVersion
    try {
      const r = await put(`/content/${doc.id}`, { doc, baseVersion, snapshot: wantVersion })
      doc.version = r.doc.version; doc.updatedAt = r.doc.updatedAt; doc.slug = r.doc.slug
      baseVersion = r.doc.version
      path = r.path; seo = r.seo; stale = r.stale
      dirty = false
      lastSaveAt = new Date()
      if (wantVersion) structuralSinceVersion = false
      if (wantVersion) lastVersionAt = lastSaveAt
      paintSaveState('saved', 'Saved')
      renderStatus()
      if (inspTab === 'seo') renderInspector()
    } catch (e) {
      if (e.status === 409) return onConflict(e)
      paintSaveState('error', 'Not saved — retry', () => save(explicit))
    }
  }

  async function onConflict(e) {
    paintSaveState('error', 'Someone else saved — resolve', () => onConflict(e))
    const who = e.data?.serverAuthor || e.data?.author
    const when = e.data?.serverUpdatedAt ? fmtDate(e.data.serverUpdatedAt) : 'just now'
    const mine = JSON.parse(stateJson())
    dialog({
      title: 'Edited somewhere else',
      dismissable: false,   // a choice is required; dismissing used to leave the doc permanently un-saveable
      body: h('div', {},
        h('p.dlg-text', {}, who ? `${who} saved a newer version ${when}.` : `A newer version was saved ${when} — from another tab or another person.`),
        h('p.dlg-text', { style: { marginTop: 'var(--s2)' } }, 'Nothing is thrown away either way: keeping yours stores theirs as a restore point first.')),
      actions: [
        {
          label: 'Take theirs', onClick: async () => {
            const fresh = await get(`/content/${doc.id}`)
            Object.assign(doc, fresh.doc)
            baseVersion = fresh.doc.version
            path = fresh.path; seo = fresh.seo; stale = fresh.stale
            dirty = false
            titleInput.value = doc.title
            renderTree(); renderInspector(); renderStatus(); refreshPreview()
            paintSaveState('saved', 'Loaded theirs')
            toast('Loaded the newer version — your copy is in the undo history', 'ok')
            undoStack.push({ json: JSON.stringify(mine), label: 'your version' })
            return true
          },
        },
        {
          label: 'Keep mine', kind: 'primary', onClick: async () => {
            baseVersion = e.data.serverVersion
            await save(true)
            return true
          },
        },
      ],
    })
  }

  const scheduleSave = debounce(() => save(false), 900)
  let suppressPreview = false

  /** One entry point for "something changed". */
  const markDirty = (opts = {}) => {
    if (readOnly) return
    dirty = true
    if (opts.structural) structuralSinceVersion = true
    paintSaveState('', 'Unsaved…')
    scheduleSave()
    if (suppressPreview) return
    if (opts.patch) patchPreview(opts.patch)
    else if (opts.structural !== false) refreshPreviewSoon()
    else refreshPreviewSoon()
  }

  // ---------- preview ----------

  let focusedMode = !!prefs().focusedMode
  const previewSrc = () => `/preview/${doc.id}?editor=1${focusedMode ? '&bare=1' : ''}`
  const iframe = h('iframe', { src: previewSrc(), title: 'Page preview' })
  const scaleBadge = h('button.preview-scale', {
    title: 'Give the canvas more room', 'aria-label': 'Widen the canvas',
    onclick: () => toggleWide(true),
  })
  const frameHolder = h('div.preview-frame-holder', {}, iframe)
  const previewWrap = h('div.preview-wrap', { class: prefs().device ? `w-${prefs().device}` : '' }, frameHolder, scaleBadge)
  let unfitPreview = null
  const fitForDevice = k => {
    unfitPreview?.(); unfitPreview = null
    iframe.style.width = ''; iframe.style.height = ''; iframe.style.transform = ''
    if (!k) unfitPreview = fitPreviewFrame(frameHolder, iframe, 1280, paintScale)
    paintScale()
  }
  function paintScale(pct) {
    const s = pct != null ? String(pct) : frameHolder.dataset.scale
    const tight = s && +s < 96
    scaleBadge.textContent = tight ? `${s}% · widen` : ''
    scaleBadge.hidden = !tight
    scaleBadge.title = tight ? 'The preview is scaled down to fit. Collapse the side panels for a bigger canvas.' : ''
  }

  /** One press reclaims every pixel the chrome was using. */
  function widenCanvas() {
    const appEl = document.querySelector('.app')
    const anyOpen = outlineOpen || !appEl.classList.contains('insp-hidden')
    outlineOpen = !anyOpen
    setDisclosure('outline', outlineOpen)
    outlineEl.classList.toggle('closed', !outlineOpen)
    appEl.classList.toggle('insp-hidden', anyOpen)
    setPref('inspHidden', anyOpen)
    setTimeout(paintScale, 280)
  }
  const onResize = debounce(() => { paintScale(); renderActions() }, 200)
  addEventListener('resize', onResize)

  const refreshPreview = () => { scheduleSave.now?.(); iframe.contentWindow?.location.reload() }
  const refreshPreviewSoon = debounce(() => iframe.contentWindow?.location.reload(), 500)
  /** Send one changed prop instead of reloading the whole page. */
  function patchPreview({ id, prop, value }) {
    refreshPreviewSoon.cancel()
    iframe.contentWindow?.postMessage({ blockhouse: 'patch', id, prop, value }, '*')
  }

  // ---------- block operations ----------

  const ops = makeOps({
    doc, byType, snapshot, markDirty,
    onTreeChange: () => { renderTree(); renderInspector() },
    onSelect: id => selectBlock(id),
  })

  function selectBlock(id, opts = {}) {
    selectedId = id
    renderTree()
    renderInspector()
    if (!opts.fromPreview) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id }, '*')
  }

  function removeWithUndo(id) {
    const name = ops.remove(id)
    if (!name) return
    if (selectedId === id) selectedId = null
    renderInspector()
    undoToast(`Deleted ${name}`, doUndo)
  }

  async function pasteFrom(parentId, index) {
    const blocks = await readClipboard()
    if (!blocks?.length) return toast(sc('Nothing to paste — copy a block first (⌘C)'), 'info')
    let last = null
    blocks.forEach((b, i) => { last = ops.insert(reId(JSON.parse(JSON.stringify(b))), parentId, index + i) })
    if (last) selectBlock(last.id)
    toast(`Pasted ${blocks.length} block${blocks.length > 1 ? 's' : ''}`, 'ok')
  }

  /** One action registry — the toolbar, the menu, the keyboard and the palette all read it. */
  function blockActions(id) {
    const f = ops.find(id)
    if (!f) return []
    const def = byType[f.node.type]
    return [
      { key: 'addAfter', label: 'Add block after', icon: icon('plus', 14), shortcut: sc('⌘⏎'), run: () => { const s = ops.siteFor(id); addBlock(s.parentId, s.index) } },
      ...(def?.container ? [{ key: 'addInside', label: 'Add block inside', icon: icon('layout', 14), run: () => addBlock(id, (f.node.children || []).length, def.childTypes) }] : []),
      { key: 'duplicate', label: 'Duplicate', icon: icon('copy', 14), shortcut: sc('⌘D'), run: () => ops.duplicate(id) },
      '-',
      { key: 'copy', label: 'Copy', icon: icon('copy', 14), shortcut: sc('⌘C'), run: async () => { await copyBlocks([f.node]); toast('Block copied', 'ok', 1800) } },
      { key: 'cut', label: 'Cut', icon: icon('x', 14), shortcut: sc('⌘X'), run: async () => { await copyBlocks([f.node]); removeWithUndo(id) } },
      { key: 'paste', label: 'Paste after', icon: icon('download', 14), shortcut: sc('⌘V'), run: () => { const s = ops.siteFor(id); pasteFrom(s.parentId, s.index) } },
      '-',
      { key: 'up', label: 'Move up', icon: icon('up', 14), shortcut: sc('⌥↑'), run: () => ops.nudge(id, -1) },
      { key: 'down', label: 'Move down', icon: icon('down', 14), shortcut: sc('⌥↓'), run: () => ops.nudge(id, 1) },
      { key: 'moveTo', label: 'Move into…', icon: icon('swap', 14), run: () => moveIntoDialog(id) },
      '-',
      { key: 'delete', label: 'Delete', icon: icon('trash', 14), shortcut: 'Del', danger: true, run: () => removeWithUndo(id) },
    ]
  }

  function blockMenu(e, id) {
    e.preventDefault()
    const acts = blockActions(id)
    contextMenu(e.clientX, e.clientY, acts.map(a => a === '-' ? '-' : ({
      icon: a.icon, label: a.label, shortcut: a.shortcut, danger: a.danger, onClick: a.run,
    })))
  }

  /** Drag is not the only way to restructure a page — especially in a drawer. */
  function moveIntoDialog(id) {
    const targets = [{ id: '', label: 'Top level of the page', depth: 0 }]
    for (const { node, depth } of flatten(doc.blocks)) {
      if (node.id === id) continue
      if (byType[node.type]?.container && !findNode(id, [node])) {
        targets.push({ id: node.id, label: labelOf(node, byType[node.type]), depth: depth + 1 })
      }
    }
    const body = h('div', { style: { display: 'grid', gap: 'var(--s0)' } },
      ...targets.map(t => h('button.row-item', {
        style: { paddingLeft: `${0.65 + t.depth * 0.8}rem` },
        onclick: () => { ops.move(id, t.id, 0); selectBlock(id); dlg.closeWith() },
      }, h('span.row-ico', { html: icon(t.id ? 'layout' : 'page', 15) }), h('span.row-label', {}, t.label))))
    const dlg = dialog({ title: 'Move this block into…', body })
  }

  // ---------- block picker ----------

  function addBlock(parentId, index, restrictTypes) {
    const groups = {}
    for (const b of catalogue) {
      if (restrictTypes && !restrictTypes.includes(b.type)) continue
      ;(groups[b.group || 'Other'] ??= []).push(b)
    }
    const recent = (prefs().recentBlocks || []).map(t => catalogue.find(b => b.type === t)).filter(Boolean)
    const search = h('input.pal-input', { placeholder: 'Search blocks…', 'aria-label': 'Search blocks' })
    const holder = h('div.picker-groups')
    let flat = [], active = 0

    const make = b => {
      setPref('recentBlocks', [b.type, ...(prefs().recentBlocks || []).filter(t => t !== b.type)].slice(0, 8))
      const node = { id: uid(), type: b.type, props: seedProps(b) }
      if (b.container) node.children = []
      if (b.type === 'faq') node.children = [{ id: uid(), type: 'faq-item', props: { question: 'A good question?' }, children: [{ id: uid(), type: 'richtext', props: { md: 'A clear answer.' } }] }]
      if (b.type === 'tabs') node.children = [{ id: uid(), type: 'tab', props: { label: 'Tab 1' }, children: [] }, { id: uid(), type: 'tab', props: { label: 'Tab 2' }, children: [] }]
      ops.insert(node, parentId, index)
      dlg.closeWith()
      selectBlock(node.id)
    }

    const renderPicker = () => {
      const q = search.value.toLowerCase().trim()
      const match = b => !q || b.label.toLowerCase().includes(q) || b.type.includes(q)
        || (b.description || '').toLowerCase().includes(q) || (b.group || '').toLowerCase().includes(q)
      const sections = []
      if (!q && recent.length) sections.push(['Recently used', recent])
      for (const [g, items] of Object.entries(groups)) {
        const vis = items.filter(match)
        if (vis.length) sections.push([g, vis])
      }
      flat = sections.flatMap(([, items]) => items)
      active = Math.min(active, Math.max(0, flat.length - 1))
      let i = -1
      holder.replaceChildren(...(sections.length ? sections : []).map(([g, items]) =>
        h('div', {}, h('div.picker-group-title', {}, g), h('div.picker-grid', {},
          items.map(b => {
            i++
            const idx = i
            return h('button.picker-item', {
              class: idx === active ? 'active' : '',
              onmousemove: () => { if (active !== idx) { active = idx; paintActive() } },
              onclick: () => make(b),
            }, h('span.p-ico', { html: icon(b.icon || 'layout', 17) }), h('span.p-label', {}, b.label),
              b.description ? h('span.p-desc', {}, b.description) : '')
          })))))
      if (!flat.length) holder.replaceChildren(h('div.pal-empty', {}, h('p', {}, 'No block matches that.')))
    }
    const paintActive = () => {
      const items = [...holder.querySelectorAll('.picker-item')]
      items.forEach((el, i2) => el.classList.toggle('active', i2 === active))
      items[active]?.scrollIntoView({ block: 'nearest' })
    }
    search.addEventListener('input', () => { active = 0; renderPicker() })
    search.addEventListener('keydown', e => {
      const cols = 3
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + cols, flat.length - 1); paintActive() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - cols, 0); paintActive() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); active = Math.min(active + 1, flat.length - 1); paintActive() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); active = Math.max(active - 1, 0); paintActive() }
      else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); make(flat[active]) }
    })
    const dlg = dialog({ title: 'Add a block', width: 'min(44rem, 94vw)', body: [search, holder] })
    renderPicker()
    search.focus()
  }
  hooks.addBlockByType = type => {
    const b = catalogue.find(x => x.type === type)
    if (!b) return
    const site = ops.siteFor(selectedId)
    const node = { id: uid(), type: b.type, props: seedProps(b) }
    if (b.container) node.children = []
    ops.insert(node, site.parentId, site.index)
    selectBlock(node.id)
  }

  // ---------- the outline rail ----------

  const outlineBody = h('div.outline-body', {})
  let outlineOpen = disclosure('outline', innerWidth >= 1600)

  const folded = () => prefs().foldedBlocks || {}
  const toggleFold = id => {
    const f = { ...folded() }
    f[id] = !f[id]
    setPref('foldedBlocks', f)
    renderTree()
  }

  function visibleRows() {
    const rows = []
    const walk = (blocks, parentId, depth) => {
      blocks.forEach((node, index) => {
        rows.push({ node, parentId, index, depth })
        const def = byType[node.type]
        if (def?.container && !folded()[node.id]) walk(node.children ??= [], node.id, depth + 1)
      })
    }
    walk(doc.blocks, '', 0)
    return rows
  }

  /** Ids of every container this node sits inside, outermost first. */
  function ancestorsOf(id) {
    const f = ops.find(id)
    return f ? f.parents.map(p => p.id) : []
  }

  function renderTree() {
    const rows = visibleRows()
    const tree = h('div.tree', { role: 'tree', 'aria-label': 'Page outline' })
    for (const { node, parentId, index, depth } of rows) {
      const def = byType[node.type]
      const isContainer = !!def?.container
      const isFolded = !!folded()[node.id]
      const selected = node.id === selectedId
      const row = h('button.tree-item', {
        class: selected ? 'selected' : '',
        role: 'treeitem', 'aria-selected': String(selected), 'aria-level': String(depth + 1),
        ...(isContainer ? { 'aria-expanded': String(!isFolded) } : {}),
        tabindex: selected ? '0' : '-1',
        draggable: 'true',
        dataset: { nodeId: node.id, parentId, index: String(index), container: isContainer ? '1' : '0' },
        style: { paddingLeft: `${0.3 + depth * 0.7}rem` },
        onclick: () => selectBlock(node.id),
        oncontextmenu: e => blockMenu(e, node.id),
        onkeydown: e => treeKeys(e, node.id, rows),
      },
        isContainer
          ? h('span.t-fold', {
            onclick: e => { e.stopPropagation(); toggleFold(node.id) },
            html: icon(isFolded ? 'chevR' : 'chevD', 11),
          })
          : h('span.t-fold'),
        h('span.t-grip', { html: icon('grip', 13) }),
        h('span.t-ico', { html: icon(def?.icon || 'layout', 14) }),
        h('span.t-label', {}, labelOf(node, def), ' ', h('span.t-type', {}, def?.label || node.type)),
        h('span.mrow-tools', {},
          h('button.icon-btn', {
            'aria-label': `Actions for ${labelOf(node, def)}`,
            onclick: e => { e.stopPropagation(); blockMenu(e, node.id) },
          }, iconEl('more', 13))))
      // Every row records its ancestors, so the drop logic can tell a
      // descendant from a cousin. Wrapping only the node's own row (as this
      // did) meant dragging onto your own child looked like a valid drop.
      row.dataset.ancestors = ancestorsOf(node.id).join(' ')
      tree.appendChild(row)
    }
    outlineBody.replaceChildren(
      doc.blocks.length ? tree : h('div', { style: { padding: 'var(--s3) var(--s2)' } },
        h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'This page is empty.')),
      h('button.tree-add', { onclick: () => addBlock('', doc.blocks.length) }, iconEl('plus', 12), ' Add block'))

    makeTreeSortable(tree, {
      canDrop: (id, parentId) => !parentId || !!byType[ops.find(parentId)?.node.type]?.container,
      onMove: (id, parentId, index) => {
        if (ops.move(id, parentId, index)) selectBlock(id)
        else toast('A block cannot be moved inside itself', 'info', 2400)
      },
    })
  }

  function treeKeys(e, id, rows) {
    // The window-level handler below owns the same keys. Without this, a single
    // Alt+Down in the outline nudged the block twice.
    const OWNED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Backspace']
    if (OWNED.includes(e.key) || (e.shiftKey && e.key === 'F10')) e.stopPropagation()
    const i = rows.findIndex(r => r.node.id === id)
    const focusAt = j => {
      const r = rows[Math.max(0, Math.min(j, rows.length - 1))]
      if (r) { selectBlock(r.node.id); setTimeout(() => outlineBody.querySelector('.tree-item.selected')?.focus(), 0) }
    }
    const def = byType[rows[i]?.node.type]
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); ops.nudge(id, e.key === 'ArrowDown' ? 1 : -1)
      setTimeout(() => outlineBody.querySelector('.tree-item.selected')?.focus(), 0)
    } else if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0) }
    else if (e.key === 'End') { e.preventDefault(); focusAt(rows.length - 1) }
    else if (e.key === 'ArrowRight' && def?.container && folded()[id]) { e.preventDefault(); toggleFold(id) }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (def?.container && !folded()[id]) toggleFold(id)
      else if (rows[i]?.parentId) selectBlock(rows[i].parentId)
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeWithUndo(id) }
    else if (e.shiftKey && e.key === 'F10') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); blockMenu({ preventDefault() {}, clientX: r.left + 20, clientY: r.bottom }, id) }
  }

  const outlineEl = h('aside.outline', { class: outlineOpen ? '' : 'closed' },
    h('div.outline-head', {},
      h('span.panel-title', { style: { flex: 1 } }, 'Outline'),
      h('button.icon-btn', { 'aria-label': 'Add block', title: 'Add block', onclick: () => addBlock('', doc.blocks.length) }, iconEl('plus', 14))),
    outlineBody)

  // ---------- inspector ----------

  let inspTab = ['block', 'page', 'seo'].includes(tabParam) ? tabParam : 'block'
  const inspBody = h('div.insp-body', { id: 'insp-body', role: 'tabpanel' })
  const crumbs = h('div.insp-crumbs', { 'aria-label': 'Selected block path' })
  const tabs = h('div.insp-tabs', { role: 'tablist', 'aria-label': 'Inspector' })

  const setTab = k => {
    inspTab = k
    const base = `#/e/${doc.id}/${k}`
    if (location.hash.split('?')[0] !== base) history.replaceState(null, '', base)
    renderInspector()
  }

  function renderInspector() {
    const sel = selectedId ? ops.find(selectedId) : null
    tabs.replaceChildren(...[['block', 'Block'], ['page', 'Page'], ['seo', 'SEO']].map(([k, label]) =>
      h('button', {
        role: 'tab', 'aria-selected': String(inspTab === k), 'aria-controls': 'insp-body',
        tabindex: inspTab === k ? '0' : '-1',
        class: inspTab === k ? 'active' : '',
        onclick: () => setTab(k),
        onkeydown: e => {
          const order = ['block', 'page', 'seo']
          const i = order.indexOf(inspTab)
          if (e.key === 'ArrowRight') { e.preventDefault(); setTab(order[(i + 1) % 3]); tabs.querySelector('[aria-selected="true"]')?.focus() }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(order[(i + 2) % 3]); tabs.querySelector('[aria-selected="true"]')?.focus() }
        },
      }, label, k === 'block' && sel ? h('span.dot-mark') : '')))

    if (inspTab === 'block') return renderBlockTab(sel)
    if (inspTab === 'page') return renderPageTab()
    return renderSeoTab()
  }

  function renderBlockTab(found) {
    crumbs.style.display = ''
    crumbs.replaceChildren(
      h('button', {
        onclick: () => { selectedId = null; renderTree(); renderInspector(); iframe.contentWindow?.postMessage({ blockhouse: 'clear' }, '*') },
      }, 'Page'),
      ...(found ? found.parents.flatMap(p => [h('span.sep', {}, '›'), h('button', { onclick: () => selectBlock(p.id) }, byType[p.type]?.label || p.type)]) : []),
      ...(found ? [h('span.sep', {}, '›'), h('button', { 'aria-current': 'true', style: { color: 'var(--acc-strong)' } }, byType[found.node.type]?.label || found.node.type)] : []))

    if (!found) {
      inspBody.replaceChildren(
        h('div.empty', { style: { padding: 'var(--s7) var(--s4)' } },
          h('div.empty-ico', {}, iconEl('layout', 26)),
          h('h3', {}, doc.blocks.length ? 'Nothing selected' : 'This page is empty'),
          h('p', {}, doc.blocks.length
            ? 'Pick a block in the outline, or click one in the preview.'
            : 'Start with a layout, or add a single block.'),
          h('div', { style: { display: 'grid', gap: 'var(--s1)', marginTop: 'var(--s3)', width: '100%' } },
            ...(doc.blocks.length ? [] : STARTERS.map(s => h('button.btn.ghost.small', { onclick: () => applyStarter(s) }, s.label))),
            h('button.btn.primary.small', { onclick: () => addBlock('', doc.blocks.length) }, 'Add a block'))))
      return
    }

    const def = byType[found.node.type]
    const propsForm = def?.fields?.length
      ? renderFields(def.fields, found.node.props, (key, value) => {
        snapshotOnce(`Edit ${labelOf(found.node, def)}`)
        markDirty({ patch: { id: found.node.id, prop: key, value } })
      })
      : h('div', { style: { padding: 'var(--s0) 0' } },
        h('p.mut', { style: { fontSize: 'var(--t-m)' } }, 'This block’s text is edited straight on the page.'),
        h('button.btn.ghost.small', {
          style: { marginTop: 'var(--s2)' },
          onclick: () => iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id: found.node.id }, '*'),
        }, 'Show it in the preview'))

    inspBody.replaceChildren(
      h('div.insp-section-title', {}, def?.label || found.node.type,
        h('button.icon-btn', {
          'aria-label': 'Block actions', title: 'Block actions',
          onclick: e => blockMenu(e, found.node.id),
        }, iconEl('more', 14))),
      propsForm)
  }

  // `inside` nests the rest within the first type. Pushing them flat, as this
  // did, produced an empty Section with two orphans beside it.
  const STARTERS = [
    { label: 'Heading + paragraph', types: ['section', 'heading', 'richtext'], inside: true },
    { label: 'Two columns', types: ['columns'] },
    { label: 'Full-width image', types: ['image'] },
  ]
  function applyStarter(starter) {
    const defs = starter.types.map(t => catalogue.find(x => x.type === t)).filter(Boolean)
    if (!defs.length) return
    snapshot('Add starter layout')
    const build = def => {
      const node = { id: uid(), type: def.type, props: seedProps(def) }
      if (def.container) node.children = []
      return node
    }
    const first = build(defs[0])
    doc.blocks.push(first)
    for (const def of defs.slice(1)) {
      const node = build(def)
      if (starter.inside && first.children) first.children.push(node)
      else doc.blocks.push(node)
    }
    markDirty({ structural: true })
    renderTree()
    selectBlock((first.children?.[0] || first).id)
  }

  /** Persisted disclosure group. Mara's screen stays clean; Priya's levers stay one click away. */
  function group(key, title, open, ...body) {
    const d = h('details.insp-group', { open: disclosure(`e.${key}`, open) },
      h('summary', {}, title), h('div', { style: { paddingTop: 'var(--s1)' } }, ...body))
    d.addEventListener('toggle', () => setDisclosure(`e.${key}`, d.open))
    return d
  }

  function renderPageTab() {
    crumbs.style.display = 'none'
    const concept = meta.concepts.find(c => c.name === doc.concept)
    const pageVals = { slug: doc.slug, publishAt: doc.publishAt || '', template: doc.template || '' }
    const tplSelect = h('div')
    const drawTpl = tpls => tplSelect.replaceChildren(renderFields([{
      key: 'template', type: 'select', label: 'Page template',
      options: tpls.map(t => ({ value: t, label: t || `Default (${concept?.template || concept?.name || 'page'})` })),
      help: 'Add pages/<name>.liquid under Templates and it appears here.',
    }], pageVals, (k, v) => { if (v) doc.template = v; else delete doc.template; snapshotOnce('Change template'); markDirty() }))
    drawTpl(window.__blockhousePageTpls || [''])
    if (!window.__blockhousePageTpls) {
      // fill the select in place — re-rendering the whole tab used to steal the
      // caret out of whatever field you were typing in
      get('/templates/pages').then(r => { window.__blockhousePageTpls = ['', ...r.pages]; drawTpl(window.__blockhousePageTpls) }).catch(() => {})
    }

    const pubHelp = h('span.help', {}, publishAtHelp())
    inspBody.replaceChildren(
      h('div.insp-section-title', {}, 'Publishing'),
      renderFields([
        { key: 'slug', type: 'text', label: 'Slug', help: 'The last part of the address. Old slugs redirect automatically.' },
        { key: 'publishAt', type: 'date', label: 'Publish at' },
      ], pageVals, (k, v) => {
        snapshotOnce('Edit page settings')
        if (k === 'slug') doc.slug = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
        else if (v) doc[k] = v; else delete doc[k]
        markDirty()
        renderStatus()
        // the help under "Publish at" describes the CURRENT value, so it has to
        // be re-read once that value changes — otherwise a scheduled post still
        // claims it will publish immediately
        if (k === 'publishAt') pubHelp.textContent = publishAtHelp()
      }),
      pubHelp,
      ...(concept?.fields?.length ? [
        h('div.insp-section-title', {}, `${concept.label} fields`),
        renderFields(concept.fields, doc.fields, () => { snapshotOnce('Edit fields'); markDirty() }),
      ] : []),
      h('div.insp-section-title', {}, 'Appearance'),
      tplSelect,
      group('addresses', 'Addresses & redirects', false, routingPanel()),
      group('access', 'Who can see this page', false, accessPanel()),
      group('code', 'Custom code for this page only', false,
        h('p.fnt', { style: { fontSize: 'var(--t-xs)', marginBottom: 'var(--s2)' } },
          'Runs on this page for every visitor. Site-wide code lives in Settings → Custom code.'),
        renderFields([
          { key: 'css', type: 'code', lang: 'css', label: 'CSS', rows: 4 },
          ...(meta.perms.html ? [{ key: 'js', type: 'code', lang: 'js', label: 'JavaScript', rows: 4 }] : []),
        ], (doc.custom ??= {}), () => { snapshotOnce('Edit custom code'); markDirty() })),
      group('versions', 'Restore points', false, versionsPanel()))
  }

  function publishAtHelp() {
    return doc.publishAt
      ? `Scheduled — the page stays hidden until then.${meta.scheduler === false ? ' The scheduler is not running on this server, so it will not publish itself.' : ''}`
      : 'Leave empty to publish immediately when you press Publish.'
  }

  function renderSeoTab() {
    crumbs.style.display = 'none'
    doc.seo ??= {}
    const site = meta.site
    const title = doc.seo.title || doc.title
    inspBody.replaceChildren(
      h('div.serp', {},
        h('div.serp-url', {}, (site.url || '') + path),
        h('div.serp-title', {}, title.length > 60 ? title.slice(0, 57) + '…' : title),
        h('div.serp-desc', {}, (doc.seo.description || 'No meta description set — search engines will improvise one.').slice(0, 160))),
      (() => {
        const ogImg = h('div.og-img', {}, doc.seo.image ? '' : 'no share image set')
        if (doc.seo.image) {
          get('/media').then(r => {
            const mm = r.media.find(x => x.id === doc.seo.image)
            if (mm) ogImg.style.backgroundImage = `url(/media/${mm.file})`
          }).catch(() => {})
        }
        return h('div.og-card', {}, ogImg,
          h('div.og-body', {},
            h('div.og-domain', {}, (site.url || '').replace(/^https?:\/\//, '')),
            h('div.og-title', {}, doc.seo.title || doc.title),
            h('div.og-desc', {}, doc.seo.description || '')))
      })(),
      renderFields([
        { key: 'title', type: 'text', label: 'SEO title', help: 'Defaults to the document title' },
        { key: 'description', type: 'textarea', label: 'Meta description', rows: 3 },
        { key: 'keyword', type: 'text', label: 'Focus keyword', help: 'Enables the keyword checks below' },
        { key: 'image', type: 'image', label: 'Social share image' },
        { key: 'canonical', type: 'text', label: 'Canonical URL override' },
        { key: 'noindex', type: 'boolean', label: 'Hide from search engines (noindex)' },
      ], doc.seo, k => { snapshotOnce('Edit SEO'); markDirty(); if (k === 'keyword' || k === 'image') scheduleSave.now?.() }),
      h('button.btn.ghost.small', {
        onclick: async e => {
          const b = e.currentTarget; b.disabled = true; b.classList.add('busy')
          try {
            const text = JSON.stringify(doc.blocks).slice(0, 8000)
            const r = await post('/x/ai/assist', { task: 'meta', text: `Title: ${doc.title}\n${text}` })
            doc.seo.description = r.result.slice(0, 160)
            snapshotOnce('AI description'); markDirty(); renderInspector()
          } catch (err) {
            toast(err?.status === 404
              ? 'The AI assist plugin is not installed on this site'
              : `Could not draft a description: ${err.message || err}`, 'err')
          }
          b.disabled = false; b.classList.remove('busy')
        },
      }, '✦ Draft description with AI'),
      h('div.insp-section-title', {}, 'Checks'),
      h('div', {}, ...seo.map(chk => h('div.seo-check', { class: chk.level },
        h('span.seo-ico', { html: icon(chk.level === 'error' ? 'warn' : chk.level === 'warn' ? 'info' : 'check', 13), 'aria-hidden': 'true' }),
        h('span', {}, h('span.sr-only', {}, `${chk.level}: `), chk.label, chk.detail ? h('span.detail', {}, chk.detail) : '')))))
  }

  function routingPanel() {
    const row = (label, value, hint) => h('div', { style: { display: 'grid', gap: 'var(--s0)', marginBottom: 'var(--s2)' } },
      h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, label),
      h('code', { style: { fontSize: 'var(--t-s)', wordBreak: 'break-all' } }, value),
      hint ? h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, hint) : '')

    const aliases = h('div', { style: { display: 'grid', gap: 'var(--s1)' } })
    const drawAliases = () => {
      const list = doc.aliases || []
      aliases.replaceChildren(
        ...list.map((a, i) => h('div', { style: { display: 'flex', gap: 'var(--s1)' } },
          h('input.input', {
            value: a, style: { flex: '1' }, placeholder: '/old-url', 'aria-label': `Extra address ${i + 1}`,
            onchange: e => {
              const v = e.target.value.trim()
              snapshotOnce('Edit addresses')
              if (!v) list.splice(i, 1)
              else list[i] = v.startsWith('/') ? v : '/' + v
              doc.aliases = list.filter(Boolean)
              markDirty(); drawAliases()
            },
          }),
          h('button.icon-btn', {
            title: 'Remove address', 'aria-label': `Remove address ${a || i + 1}`,
            onclick: () => { snapshotOnce('Remove address'); list.splice(i, 1); doc.aliases = list; markDirty(); drawAliases() },
          }, iconEl('trash', 13)))),
        h('button.btn.ghost.small', {
          onclick: () => { doc.aliases = [...(doc.aliases || []), '']; markDirty(); drawAliases() },
        }, iconEl('plus', 12), 'Add address'),
        list.length ? h('label.field-check', { style: { marginTop: 'var(--s1)' } },
          h('input', {
            type: 'checkbox', checked: !!doc.mirror,
            onchange: e => { doc.mirror = e.target.checked; if (!doc.mirror) delete doc.mirror; markDirty() },
          }),
          h('span', {}, 'Mirror instead of redirect')) : '',
        list.length ? h('span.fnt', { style: { fontSize: 'var(--t-xs)' } },
          doc.mirror
            ? 'Each address renders this page in place (canonical tag still points here).'
            : 'Each address 301-redirects to the canonical URL.') : '')
    }
    drawAliases()

    return h('div', {},
      row('Canonical URL', (meta.site.url || '') + (href || path), 'Changing the slug adds an automatic redirect from the old one.'),
      row('Static file', exportFile || 'index.html', `URL style: ${meta.urls?.style || 'directory'} · layout: ${meta.urls?.layout || 'pattern'}`),
      h('a.btn.ghost.small', { href: '#/settings/urls', style: { marginBottom: 'var(--s2)' } }, 'Change URL style →'),
      shortlink ? row('Shortlink', (meta.site.url || '') + shortlink, 'Stable even if the slug changes.') : '',
      h('span.fnt', { style: { fontSize: 'var(--t-xs)', display: 'block', margin: 'var(--s3) 0 var(--s1)' } }, 'Extra addresses'),
      aliases)
  }

  function accessPanel() {
    const hasMembers = (meta.panels || []).some(p => p.plugin === 'members')
    doc.access ??= {}
    const wrap = h('div', {})
    const draw = () => {
      const mode = doc.access.mode || 'public'
      const groups = meta.memberGroups || []
      const modeSelect = h('div')
      modeSelect.append(renderFields([{
        key: 'mode', type: 'select', label: 'Visible to', required: true,
        options: [
          { value: 'public', label: 'Everyone' },
          { value: 'members', label: 'Signed-in members' },
          { value: 'groups', label: 'Specific member groups' },
        ],
        help: hasMembers ? '' : 'Install the Members plugin to use member-only pages.',
      }], { mode }, (k, v) => {
        snapshotOnce('Change access')
        if (v === 'public') doc.access = {}
        else doc.access.mode = v
        markDirty(); draw()
      }))
      wrap.replaceChildren(
        modeSelect,
        mode === 'groups'
          ? (groups.length
            ? h('div', { style: { display: 'grid', gap: 'var(--s1)', margin: 'var(--s0) 0 var(--s3)' } },
              ...groups.map(g => h('label.field-check', {},
                h('input', {
                  type: 'checkbox', checked: (doc.access.groups || []).includes(g.id),
                  onchange: e => {
                    const set = new Set(doc.access.groups || [])
                    e.target.checked ? set.add(g.id) : set.delete(g.id)
                    doc.access.groups = [...set]
                    markDirty()
                  },
                }),
                h('span', {}, g.label))))
            : h('p.mut', { style: { fontSize: 'var(--t-s)' } }, 'No member groups yet — add them under Members → Groups.'))
          : '',
        mode !== 'public'
          ? renderFields([{ key: 'redirect', type: 'text', label: 'Send visitors to', help: 'Blank uses the Members login page.' }], doc.access, (k, v) => {
            if (v) doc.access.redirect = v; else delete doc.access.redirect
            markDirty()
          })
          : '',
        mode !== 'public'
          ? h('p.mut', { style: { fontSize: 'var(--t-s)' } }, 'Gated pages are served with no-store and are skipped by static exports and sitemaps.')
          : '')
    }
    draw()
    return wrap
  }

  function versionsPanel() {
    const holder = h('div', {}, skeleton('rows', 3))
    get(`/content/${doc.id}/versions`).then(({ versions }) => {
      holder.replaceChildren(...(versions.length ? versions.slice(0, 10).map(v =>
        h('div', { style: { display: 'flex', gap: 'var(--s1)', alignItems: 'center' } },
          h('button.row-item', {
            style: { flex: 1 },
            onclick: () => window.open(`/preview/${doc.id}?version=${encodeURIComponent(v.key)}`, '_blank', 'noopener'),
            title: 'Preview this version in a new tab',
          }, h('span.row-ico', { html: icon('clock', 14) }),
            h('span.row-label', {}, `v${v.version}`, h('div.row-sub', {}, `${fmtDate(v.savedAt)}${v.author ? ` · ${v.author}` : ''}`))),
          h('button.btn.ghost.small', {
            onclick: async () => {
              if (!(await confirmDialog('Restore this version',
                `Restore v${v.version} from ${fmtDate(v.savedAt)}? Your current version is saved as a restore point first, and you can undo this.`, 'Restore'))) return
              snapshot(`Restore v${v.version}`)
              await post(`/content/${doc.id}/restore`, { key: v.key })
              const fresh = await get(`/content/${doc.id}`)
              Object.assign(doc, fresh.doc)
              baseVersion = fresh.doc.version
              titleInput.value = doc.title
              renderTree(); renderInspector(); renderStatus(); refreshPreview()
              undoToast(`Restored v${v.version}`, doUndo)
            },
          }, 'Restore'))
      ) : [h('p.mut', {}, 'No restore points yet — they are written when you press Save and whenever the page structure changes.')]))
    }).catch(() => holder.replaceChildren(h('p.mut', {}, 'Could not load restore points.')))
    return holder
  }

  // ---------- topbar ----------

  const titleInput = h('input.doc-title-input', { value: doc.title, 'aria-label': 'Document title', readonly: readOnly })
  titleInput.addEventListener('input', () => { doc.title = titleInput.value; snapshotOnce('Rename'); markDirty() })

  const statusHolder = h('span')
  function renderStatus() {
    const scheduled = doc.publishAt && new Date(doc.publishAt) > new Date()
    statusHolder.replaceChildren(
      h('span.chip', { class: scheduled ? 'review' : doc.status },
        scheduled ? `Scheduled · ${new Date(doc.publishAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : doc.status),
      stale ? h('span.chip.stale', { title: 'The published version is older than this draft' }, 'unpublished edits') : '')
  }

  function setDevice(k) {
    setPref('device', k)
    previewWrap.className = 'preview-wrap' + (k ? ` w-${k}` : '')
    fitForDevice(k)
    deviceSeg.querySelectorAll('button').forEach(b => {
      const on = b.dataset.device === k
      b.classList.toggle('active', on)
      b.setAttribute('aria-checked', String(on))
    })
  }
  const deviceSeg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Preview width' },
    ...[['', 'desktop', 'Desktop'], ['tablet', 'tablet', 'Tablet'], ['mobile', 'phone', 'Mobile']].map(([k, icoName, title]) =>
      h('button', {
        title, 'aria-label': `Preview at ${title.toLowerCase()} width`, role: 'radio',
        dataset: { device: k },
        'aria-checked': String((prefs().device || '') === k),
        class: (prefs().device || '') === k ? 'active' : '',
        onclick: () => setDevice(k),
        onkeydown: e => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
          e.preventDefault(); e.stopPropagation()
          const opts = ['', 'tablet', 'mobile']
          const at = opts.indexOf(prefs().device || '')
          const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
          const next = opts[(at + step + opts.length) % opts.length]
          setDevice(next)
          deviceSeg.querySelector(`[data-device="${next}"]`)?.focus()
        },
      }, iconEl(icoName, 14))))

  async function publishFlow() {
    const errors = seo.filter(s => s.level === 'error')
    dialog({
      title: doc.status === 'published' ? 'Republish changes' : 'Publish',
      body: h('div', {},
        h('p.dlg-text', {}, `“${doc.title}” will go live at `, h('code', {}, path), '.'),
        doc.publishAt && new Date(doc.publishAt) > new Date()
          ? h('p.dlg-text', { style: { marginTop: 'var(--s2)' } }, `Scheduled for ${new Date(doc.publishAt).toLocaleString()} — it stays hidden until then.`)
          : '',
        errors.length ? h('div', { style: { marginTop: 'var(--s3)' } },
          h('div.insp-section-title', {}, 'SEO issues'),
          h('p.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s1)' } }, 'Publishing is not blocked — click one to go and fix it.'),
          ...errors.map(chk => h('button.row-item', {
            onclick: () => { document.querySelector('dialog.dlg[open]')?.closeWith?.(); setTab('seo') },
          }, h('span.row-ico', { html: icon('warn', 14) }), h('span.row-label', {}, chk.label)))) : '',
      ),
      actions: [
        { label: 'Cancel', onClick: () => true },
        {
          label: 'Publish now', kind: 'primary', onClick: async () => {
            await save(true)
            const r = await post(`/content/${doc.id}/publish`)
            doc.status = r.doc.status; stale = false
            renderStatus(); renderActions()
            hooks.refreshCounts?.()
            toast('Published — it is live now', 'ok')
            return true
          },
        },
      ],
    })
  }

  const actionsHolder = h('span', { style: { display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center' } })
  function renderActions() {
    if (readOnly) {
      actionsHolder.replaceChildren(h('span.chip', { title: 'Your account can read this but not change it' }, 'Read only'))
      return
    }
    // Below 860px the toolbar sheds the device segment, the status chip and the
    // Save button to fit. They reappear here, so nothing is ever simply gone.
    const narrow = () => innerWidth <= 860
    const more = e => contextMenu(e.clientX, e.clientY, [
      ...(narrow() ? [
        { icon: icon(doc.status === 'published' ? 'check' : 'pen', 14), label: `Status: ${doc.status}${stale ? ' · unpublished edits' : ''}`, disabled: true, onClick: () => {} },
        { icon: icon('save', 14), label: 'Save', shortcut: sc('⌘S'), onClick: () => save(true) },
        { icon: icon('desktop', 14), label: 'Preview at desktop width', onClick: () => setDevice('') },
        { icon: icon('tablet', 14), label: 'Preview at tablet width', onClick: () => setDevice('tablet') },
        { icon: icon('phone', 14), label: 'Preview at phone width', onClick: () => setDevice('mobile') },
        '-',
      ] : []),
      { icon: icon('undo', 14), label: 'Undo', shortcut: sc('⌘Z'), disabled: !undoStack.length, onClick: doUndo },
      { icon: icon('redo', 14), label: 'Redo', shortcut: sc('⇧⌘Z'), disabled: !redoStack.length, onClick: doRedo },
      '-',
      { icon: icon(focusedMode ? 'eye' : 'eyeOff', 14), label: focusedMode ? 'Show header & footer' : 'Hide header & footer', onClick: toggleFocused },
      { icon: icon('external', 14), label: 'Open preview in a new tab', onClick: () => window.open(`/preview/${doc.id}`, '_blank', 'noopener') },
      { icon: icon('swap', 14), label: 'Swap inspector side', onClick: () => { const on = document.querySelector('.app').classList.toggle('insp-left'); setPref('inspLeft', on) } },
      '-',
      ...(doc.status === 'published' && meta.perms.publish
        ? [{ icon: icon('clock', 14), label: 'Unpublish', onClick: async () => { await post(`/content/${doc.id}/unpublish`); doc.status = 'draft'; renderStatus(); renderActions(); toast('Unpublished — the page now 404s for visitors', 'ok') } }]
        : []),
      { icon: icon('home', 14), label: 'Make this the homepage', onClick: makeHome },
      ...(meta.perms.delete ? [{ icon: icon('trash', 14), label: 'Delete document', danger: true, onClick: deleteDoc }] : []),
    ])
    actionsHolder.replaceChildren(
      h('button.btn.ghost.small', { onclick: () => save(true), title: sc('Save and create a restore point  ⌘S') }, 'Save'),
      meta.perms.publish
        ? h('button.btn.primary.small', { onclick: publishFlow }, doc.status === 'published' ? (stale ? 'Republish' : 'Published') : 'Publish…')
        : h('button.btn.soft.small', {
          onclick: async () => { await save(true); await post(`/content/${doc.id}/submit`); doc.status = 'review'; renderStatus(); toast('Submitted for review', 'ok') },
        }, 'Submit for review'),
      h('button.icon-btn', { title: 'More', 'aria-label': 'More document actions', onclick: more }, iconEl('more', 15)))
  }

  function toggleFocused() {
    focusedMode = !focusedMode
    setPref('focusedMode', focusedMode)
    iframe.src = previewSrc()
    toast(focusedMode ? 'Header and footer hidden while editing' : 'Showing the whole page', 'info', 2000)
  }

  async function makeHome() {
    const current = meta.site.homeDocId
    const currentTitle = current && current !== doc.id ? ` This replaces the current homepage.` : ''
    if (!(await confirmDialog('Make this the homepage', `“${doc.title}” will be served at /.${currentTitle} You can set a different one at any time.`, 'Make homepage'))) return
    await post(`/content/${doc.id}/make-home`)
    toast('This is now the homepage', 'ok')
  }

  async function deleteDoc() {
    const live = doc.status === 'published'
    if (!(await confirmDialog('Delete document',
      `Delete “${doc.title}”?${live ? ` The live page at ${path} will start returning “not found” immediately.` : ''} A copy is kept in the site’s trash folder.`))) return
    await del(`/content/${doc.id}`)
    dirty = false
    hooks.refreshCounts?.()
    location.hash = `#/c/${doc.concept}`
  }

  // ---------- layout ----------

  const inspector = h('aside.inspector', { 'aria-label': 'Inspector' },
    h('div.insp-resize', {
      role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize inspector', tabindex: '0',
      onkeydown: e => {
        const step = e.shiftKey ? 64 : 16
        const cur = parseInt(getComputedStyle(inspector).width, 10)
        if (e.key === 'ArrowLeft') { e.preventDefault(); setInspW(cur + step) }
        if (e.key === 'ArrowRight') { e.preventDefault(); setInspW(cur - step) }
        if (e.key === 'Home') { e.preventDefault(); setInspW(336) }
      },
      onpointerdown: e => {
        e.preventDefault()
        const target = e.currentTarget
        target.classList.add('on')
        const startX = e.clientX
        const startW = inspector.getBoundingClientRect().width
        const left = document.querySelector('.app')?.classList.contains('insp-left')
        const move = ev => setInspW(startW + (left ? ev.clientX - startX : startX - ev.clientX))
        const up = () => { target.classList.remove('on'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); setPref('inspW', root.style.getPropertyValue('--insp-w')) }
        addEventListener('pointermove', move); addEventListener('pointerup', up)
      },
    }),
    tabs, crumbs, inspBody)

  function setInspW(px) {
    const w = Math.min(560, Math.max(240, px))
    root.style.setProperty('--insp-w', w + 'px')
    setPref('inspW', w + 'px')
    setTimeout(paintScale, 60)
  }

  // Wide lives in state.js — the same state on every view. The editor only
  // needs to re-measure the preview once the panels have gone.
  const onWide = () => setTimeout(paintScale, 280)
  addEventListener('bh:wide', onWide)

  const backTo = peekReturn()
  const editorEl = h('div.editor', {},
    outlineEl,
    h('div.editor-mid', {},
      h('div.editor-top', {},
        h('span.editor-top-group', {},
          h('button.icon-btn', {
            title: backTo ? `Back to ${backTo.label}` : 'Back', 'aria-label': backTo ? `Back to ${backTo.label}` : 'Back',
            onclick: () => { const r = popReturn(); location.hash = r ? r.hash : `#/c/${doc.concept}` },
          }, iconEl('back', 16)),
          h('button.icon-btn.outline-toggle', {
            title: 'Outline', 'aria-label': 'Open the page outline',
            onclick: () => outlineEl.classList.toggle('open'),
          }, iconEl('sidebar', 15)),
          h('button.icon-btn', {
            title: 'Collapse the outline for a bigger canvas', 'aria-label': 'Collapse outline',
            class: outlineOpen ? '' : 'on',
            onclick: e => {
              outlineOpen = !outlineOpen
              setDisclosure('outline', outlineOpen)
              outlineEl.classList.toggle('closed', !outlineOpen)
              e.currentTarget.classList.toggle('on', !outlineOpen)
              setTimeout(paintScale, 260)
            },
          }, iconEl('list', 15))),
        h('span.editor-top-group.grow', {}, titleInput, statusHolder, saveState),
        h('span.editor-top-group', {}, deviceSeg,
          h('button.icon-btn', {
            title: 'Quick edits — colour, menu, header & footer',
            'aria-label': 'Quick edits to the site around this page',
            onclick: e => contextMenu(e.clientX, e.clientY, [
              { icon: icon('palette', 14), label: 'Colour & shape', onClick: () => quickDesign(iframe) },
              ...(meta.perms.menus ? (meta.menus || []).map(mu => ({
                icon: icon('menu', 14), label: `Links in ${mu.label || mu.key}`, onClick: () => quickMenu(mu.key, () => refreshPreview()),
              })) : []),
              { icon: icon('layout', 14), label: 'Announcement bar', onClick: () => quickChrome('header.announce', () => refreshPreview()) },
              { icon: icon('layout', 14), label: 'Footer links & social', onClick: () => quickChrome('footer.social', () => refreshPreview()) },
            ]),
          }, iconEl('wand', 15)),
          helpButton('editor', 'the editor'),
          h('button.icon-btn', {
            title: 'Show or hide the inspector', 'aria-label': 'Toggle inspector',
            class: prefs().inspHidden ? 'on' : '',
            onclick: e => {
              const app2 = document.querySelector('.app')
              const hidden = app2.classList.toggle('insp-hidden')
              app2.classList.toggle('insp-open', false)
              setPref('inspHidden', hidden)
              e.currentTarget.classList.toggle('on', hidden)
              setTimeout(paintScale, 260)
            },
          }, iconEl('columns', 15)),
          // One labelled control that clears every panel at once. The two
          // individual toggles remain for fine control, but they are icons in
          // a crowded bar — at 1440px the canvas was 826px (57%) and nothing
          // told you it could be otherwise.
          h('button.btn.ghost.small.wide-btn', {
            title: sc('Give the page the whole window  ⌘.'),
            'aria-pressed': String(!!prefs().wideMode),
            onclick: () => toggleWide(),
          }, iconEl('panel-close', 14), h('span.wide-label', {}, 'Wide')),
          h('button.icon-btn.insp-toggle', {
            title: 'Inspector', 'aria-label': 'Open inspector',
            onclick: () => document.querySelector('.app').classList.toggle('insp-open'),
          }, iconEl('pen', 15)),
          actionsHolder)),
      previewWrap),
    inspector)

  if (prefs().inspW) root.style.setProperty('--insp-w', prefs().inspW)
  const appEl = document.querySelector('.app')
  appEl?.classList.toggle('insp-left', !!prefs().inspLeft)
  appEl?.classList.toggle('insp-hidden', !!prefs().inspHidden)
  // While you are editing one document the site-wide rail is not the job —
  // collapse it to icons and give the pixels to the page you are looking at.
  const railWasOpen = !appEl?.classList.contains('side-collapsed')
  appEl?.classList.add('side-collapsed')
  root.replaceChildren(editorEl)
  // fit only once the holder is actually in the document — measuring a
  // detached element gives 0 and the preview never gets scaled at all
  fitForDevice(prefs().device || '')
  paintSaveState('saved', readOnly ? 'Read only' : 'Saved')
  renderStatus(); renderActions(); renderTree(); renderInspector()

  // ---------- preview bridge ----------

  addEventListener('message', onBridgeMsg)
  function onBridgeMsg(e) {
    const m = e.data || {}
    if (m.blockhouse === 'select' && m.id) selectBlock(m.id, { fromPreview: true })
    if (m.blockhouse === 'ready' && selectedId) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id: selectedId }, '*')
    if (m.blockhouse === 'needsreload') refreshPreviewSoon()
    if (m.blockhouse === 'provenance') onProvenance(m)

    if (m.blockhouse === 'editstart') { snapshotOnce('Edit text'); suppressPreview = true }
    if (m.blockhouse === 'edit' && m.id && m.prop) {
      const found = ops.find(m.id)
      if (found) {
        found.node.props[m.prop] = m.value
        dirty = true
        paintSaveState('', 'Unsaved…')
        scheduleSave()
      }
    }
    if (m.blockhouse === 'editend') {
      suppressPreview = false
      if (inspTab === 'block') renderInspector()
      renderTree()
    }

    if (m.blockhouse === 'blockaction' && m.id) {
      const act = blockActions(m.id).find(a => a !== '-' && (
        (m.action === 'delete' && a.key === 'delete') ||
        (m.action === 'duplicate' && a.key === 'duplicate') ||
        (m.action === 'add-after' && a.key === 'addAfter') ||
        (m.action === 'up' && a.key === 'up') ||
        (m.action === 'down' && a.key === 'down')))
      if (m.action === 'delete') removeWithUndo(m.id)
      else act?.run()
    }
  }

  function onProvenance(m) {
    const opts = []
    const seen = new Set()
    const add = (label2, icon2, go, hint) => { if (!seen.has(label2)) { seen.add(label2); opts.push({ label: label2, icon: icon2, go, hint }) } }
    for (const o of m.options || []) {
      if (o.kind === 'menu' && meta.perms.menus) {
        const mm = meta.menus.find(x => x.key === o.key)
        add(`Edit the “${mm?.label || o.key}” links`, 'menu', () => quickMenu(o.key, () => refreshPreview()), 'Here, without leaving this page')
        add('Open the menu studio', 'external', () => goTo(`#/menus/${o.key}`), 'Structure, mega panels and live preview')
      }
      if ((o.kind === 'header' || o.kind === 'footer') && meta.perms.settings) {
        const slot = o.kind === 'header' ? 'header.announce' : 'footer.social'
        add(`Edit the ${o.kind} text`, 'layout', () => quickChrome(slot, () => refreshPreview()), 'Here, without leaving this page')
        add(`Open the full ${o.kind} editor`, 'external', () => goTo(`#/chrome/${slot}`), 'Add, remove and reorder blocks')
        add(`Edit the ${o.kind} template`, 'code', () => goTo(`#/tpl/${encodeURIComponent('partials/' + o.kind + '.liquid')}`), 'The structure — a safe override, the built-in file is untouched')
      }
      if (o.kind === 'design' && meta.perms.settings) {
        add('Change the colour & shape', 'palette', () => quickDesign(iframe), 'Here, beside the page — the preview updates as you drag')
        add('Open the Design studio', 'external', () => goTo('#/design'), 'Templates, fonts and colour scheme')
      }
    }
    if (m.href && /\/(feed|sitemap)\.xml$/.test(m.href.split('?')[0]) && meta.perms.settings) {
      const which = m.href.includes('feed') ? 'RSS feeds' : 'The sitemap'
      add(`${which} — turn on or off`, 'bolt', () => goTo('#/settings/features'), 'When a feature is off, Blockhouse removes its links site-wide')
    }
    if (m.href && /^\//.test(m.href)) {
      add(`Go edit the page at ${m.href}`, 'page', async () => {
        const { docs } = await get('/content')
        const target = docs.find(d2 => d2.path === m.href.replace(/\/$/, '') || d2.path === m.href)
        if (target) goTo(`#/e/${target.id}`)
        else toast('That link does not point at a page in this site', 'err')
      }, 'Follow the link into its editor, not the live site')
    }
    if (meta.perms.settings) add('Site settings', 'gear', () => goTo('#/settings'), 'Identity, features, everything else')

    const dlg = dialog({
      title: m.text ? `“${m.text}”` : 'This part of the page',
      body: h('div', {},
        h('p.dlg-text', { style: { marginBottom: 'var(--s3)' } }, opts.length > 1 ? 'This is controlled in more than one place — pick where to edit:' : 'Edit it here:'),
        h('div', { style: { display: 'grid', gap: 'var(--s1)' } },
          ...(opts.length ? opts : [{ label: 'This comes from the template', icon: 'info', go: null, hint: 'It is not page content — template files or Design control it.' }])
            .map(o => h('button.row-item', {
              style: { border: '1px solid var(--line)', borderRadius: 'var(--r-s)', padding: 'var(--s3) var(--s3)' },
              onclick: () => { if (o.go) { dlg.closeWith(); o.go() } },
            },
              h('span.row-ico', { html: icon(o.icon, 16) }),
              h('div', { style: { textAlign: 'left' } },
                h('div', { style: { fontWeight: 'var(--fw-semi)', fontSize: 'var(--t-m)' } }, o.label),
                o.hint ? h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, o.hint) : ''))))),
    })
  }

  const goTo = hash => { hooks.pushReturn?.(doc.title, `#/e/${doc.id}/${inspTab}`); location.hash = hash }

  // ---------- keyboard ----------

  // Typing, and anything that owns its own arrow keys. A <button role="radio">
  // is not an input, so without this the global block-navigation handler stole
  // the arrows from the device-width segment and moved the selection instead.
  const isTyping = e => /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable
  const ownsArrows = e => !!e.target.closest?.('[role="radiogroup"], [role="radio"], [role="tablist"], [role="tab"], [role="menu"], .seg')
  const onKey = async e => {
    // A side sheet lives outside .app, so `inert` does not stop this listener.
    // Everything typed into a sheet belongs to the sheet.
    if (sheetIsOpen()) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return save(true) }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); return doUndo() }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); return doRedo() }
    if (isTyping(e)) return
    if (mod && e.key === 'Enter') { e.preventDefault(); const s = ops.siteFor(selectedId); return addBlock(s.parentId, s.index) }
    if (!selectedId) return
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return ops.duplicate(selectedId) }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); await copyBlocks([ops.find(selectedId).node]); return toast('Block copied', 'ok', 1600) }
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); await copyBlocks([ops.find(selectedId).node]); return removeWithUndo(selectedId) }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); const s = ops.siteFor(selectedId); return pasteFrom(s.parentId, s.index) }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); return ops.nudge(selectedId, -1) }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); return ops.nudge(selectedId, 1) }
    // walking the page works from anywhere in the editor, not only when a tree
    // row happens to hold focus
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !ownsArrows(e)) {
      const list = flatten(doc.blocks)
      const i = list.findIndex(x => x.node.id === selectedId)
      const next = list[Math.max(0, Math.min(i + (e.key === 'ArrowDown' ? 1 : -1), list.length - 1))]
      if (next) { e.preventDefault(); selectBlock(next.node.id) }
      return
    }
    if (e.key === 'Escape') {
      const f = ops.find(selectedId)
      if (f?.parents.length) { e.preventDefault(); return selectBlock(f.parents[f.parents.length - 1].id) }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return removeWithUndo(selectedId) }
  }
  addEventListener('keydown', onKey)

  // ---------- palette commands for this screen ----------

  const disposeCommands = registerCommands('editor', () => {
    const sel = selectedId ? ops.find(selectedId) : null
    return [
      { label: 'Publish this document', icon: 'rocket', keywords: 'publish live go', hint: '', run: publishFlow },
      { label: 'Save and create a restore point', icon: 'save', keywords: 'save version snapshot', hint: sc('⌘S'), run: () => save(true) },
      { label: 'Open the SEO panel', icon: 'compass', keywords: 'seo meta description share image', run: () => setTab('seo') },
      { label: 'Open page settings', icon: 'gear', keywords: 'slug schedule template access redirect', run: () => setTab('page') },
      ...(sel ? [
        { label: `Duplicate “${labelOf(sel.node, byType[sel.node.type])}”`, icon: 'copy', keywords: 'duplicate copy block', hint: sc('⌘D'), run: () => ops.duplicate(selectedId) },
        { label: `Delete “${labelOf(sel.node, byType[sel.node.type])}”`, icon: 'trash', keywords: 'delete remove block', hint: 'Del', run: () => removeWithUndo(selectedId) },
      ] : []),
      ...catalogue.slice(0, 40).map(b => ({
        label: `Add block: ${b.label}`, icon: b.icon || 'layout', group: 'Add a block',
        keywords: `${b.type} ${b.group || ''} insert add new`,
        run: () => { const s = ops.siteFor(selectedId); const node = { id: uid(), type: b.type, props: seedProps(b) }; if (b.container) node.children = []; ops.insert(node, s.parentId, s.index); selectBlock(node.id) },
      })),
      ...flatten(doc.blocks).slice(0, 30).map(({ node }) => ({
        label: `Go to: ${labelOf(node, byType[node.type])}`, icon: byType[node.type]?.icon || 'layout',
        group: 'Blocks in this page', keywords: node.type, run: () => selectBlock(node.id),
      })),
    ]
  })

  // ---------- leaving ----------

  const disposeGuard = registerGuard('editor', async () => {
    if (!dirty) return true
    scheduleSave.cancel()
    await save(false)
    return true
  })

  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)

  return () => {
    if (railWasOpen) appEl?.classList.remove('side-collapsed')
    appEl?.classList.remove('insp-hidden')
    removeEventListener('bh:wide', onWide)
    removeEventListener('message', onBridgeMsg)
    removeEventListener('keydown', onKey)
    removeEventListener('resize', onResize)
    removeEventListener('beforeunload', beforeUnload)
    unfitPreview?.()
    disposeCommands()
    disposeGuard()
    hooks.addBlockByType = null
    scheduleSave.cancel()
    if (dirty) save(false)
  }
})
