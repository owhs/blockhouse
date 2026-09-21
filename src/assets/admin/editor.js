// The document editor: outline rail + canvas + inspector.
//
// Three durable surfaces. The outline is always there (it used to live inside
// an inspector tab and vanish whenever you looked at SEO); the canvas is the
// point of the screen; the inspector only ever shows properties of the selected
// thing. Every mutation goes through docops so a shortcut, a drag, a right
// click and a palette entry are the same operation with the same undo entry.

import { get, put, post, del } from './api.js'
import { h, debounce, dialog, confirmDialog, contextMenu, toast, undoToast, fmtDate, makeTreeSortable, skeleton, sc } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, prefs, setPref, disclosure, setDisclosure, hooks, registerGuard, popReturn, peekReturn, wideMode, toggleWide } from './state.js'
import { icon, iconEl } from './icons.js'
import { registerCommands } from './search.js'
import { helpButton } from './help.js'
import { quickDesign, quickChrome, quickMenu } from './quick.js'
import { sheetIsOpen } from './sheet.js'
import { makeOps, findNode, flatten, labelOf, uid, reId, copyBlocks, readClipboard, seedProps } from './docops.js'

// The last control a pointer actually pressed. Browsers do not always focus a
// button on click, so this is the only reliable record of "what opened this"
// for a panel that has to hand the keyboard back when it closes.
let lastPointerControl = null
addEventListener('pointerdown', e => {
  const c = e.target?.closest?.('button, a[href], [tabindex]:not([tabindex="-1"])')
  if (c) lastPointerControl = c
}, true)

registerView('editor', async (root, [docId, tabParam], query) => {
  const meta = state.meta
  let { doc, path, href, exportFile, shortlink, seo, stale } = await get(`/content/${docId}`)
  let baseVersion = doc.version
  let selectedId = null
  const multi = new Set()
  let dirty = false
  const undoStack = [], redoStack = []
  const catalogue = meta.blocks
  const byType = Object.fromEntries(catalogue.map(b => [b.type, b]))

  // R17-4 — "Restore points for this page" read wrong on a Lift or a System.
  // Every "?" sheet in the studio is type-aware; so is this.
  const typeName = (meta.concepts.find(c => c.name === doc.concept)?.label || 'page').toLowerCase()

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

  // Take the server's version as our own baseline. Publish/unpublish write to
  // the document too, so after either one the editor must be looking at the
  // version they produced — otherwise the next save reads as a conflict.
  async function adoptVersion(fresh) {
    let v = fresh
    if (!v || v.version == null) {
      try { v = (await get(`/content/${doc.id}`)).doc } catch { return }
    }
    if (!v || v.version == null) return
    doc.version = v.version
    baseVersion = v.version
    if (v.updatedAt) doc.updatedAt = v.updatedAt
  }

  // `publishing` marks the save the publish flow makes just before it
  // publishes. The server skips that save's Activity row, so one publish
  // reports one action instead of "Saved" and "Published" a second apart.
  async function save(explicit = false, publishing = false) {
    if (readOnly) return
    paintSaveState('saving', 'Saving…')
    // Autosave writes a restore point whenever the structure changed, so a
    // deleted block always has a floor beneath it.
    const wantVersion = explicit || structuralSinceVersion
    try {
      const r = await put(`/content/${doc.id}${publishing ? '?publishing=1' : ''}`, { doc, baseVersion, snapshot: wantVersion })
      doc.version = r.doc.version; doc.updatedAt = r.doc.updatedAt; doc.slug = r.doc.slug
      baseVersion = r.doc.version
      path = r.path; seo = r.seo; stale = r.stale
      dirty = false
      lastSaveAt = new Date()
      // r.unchanged: the server found nothing different and left the document
      // alone — no restore point was made, so do not claim one. (R15-1)
      if (wantVersion) structuralSinceVersion = false
      // R21-2 — the text can match the last autosave and still be newer than
      // the last restore point, and then the server keeps one (`r.snapshot`).
      if (wantVersion && (!r.unchanged || r.snapshot)) lastVersionAt = lastSaveAt
      // R20-3 — a Save the server answers with `unchanged: true` used to move
      // nothing on screen, so the person pressed it again. Say so, briefly, and
      // only for a save they asked for: autosave must stay silent.
      if (explicit && !publishing && r.unchanged) {
        toast(r.snapshot ? 'Saved — restore point kept' : 'Nothing to save — already up to date', 'info', 1200)
      }
      paintSaveState('saved', 'Saved')
      // renderActions owns the Publish/Republish button: without it a save that
      // makes the document stale leaves the button reading "Published".
      renderStatus(); renderActions()
      if (inspTab === 'seo') renderInspector()
      // The preview renders from the server, so it can only be refreshed after
      // the write it is meant to show has landed.
      if (previewStale) { previewStale = false; iframe.contentWindow?.location.reload() }
    } catch (e) {
      if (e.status === 409) return onConflict(e)
      paintSaveState('error', 'Not saved — retry', () => save(explicit, publishing))
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
        h('p.dlg-text.mt-2', {}, 'Nothing is thrown away either way: keeping yours stores theirs as a restore point first.')),
      actions: [
        {
          label: 'Take theirs', onClick: async () => {
            const fresh = await get(`/content/${doc.id}`)
            Object.assign(doc, fresh.doc)
            baseVersion = fresh.doc.version
            path = fresh.path; seo = fresh.seo; stale = fresh.stale
            dirty = false
            titleInput.value = doc.title
            renderTree(); renderInspector(); renderStatus(); renderActions(); refreshPreview()
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
  // The preview's targeted patch can only swap the TEXT of an editable node.
  // A layout prop changes the markup around the block — a container class, a
  // wrapper — so patching does nothing visible and the change appears to have
  // been ignored until you reload. Anything that is not text re-renders.
  const TEXTISH = ['text', 'textarea', 'richtext', 'markdown']

  // A prop may be a path into a list: `slides.0.heading` is the heading of the
  // first slide. The page can now be edited directly, and the words in a list
  // item have to be addressable to make that work.
  const pathParts = k => String(k ?? '').split('.').filter(x => x !== '')
  const getPath = (obj, k) => pathParts(k).reduce((o, part) => (o == null ? o : o[part]), obj)
  const setPath = (obj, k, value) => {
    const parts = pathParts(k)
    if (!parts.length) return
    let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const here = parts[i]
      if (cur[here] == null || typeof cur[here] !== 'object') {
        cur[here] = /^\d+$/.test(parts[i + 1]) ? [] : {}
      }
      cur = cur[here]
    }
    cur[parts[parts.length - 1]] = value
  }
  /** The field definition a (possibly dotted) key points at. */
  const fieldDefAt = (fields, key) => {
    let defs = fields || []
    let fd = null
    for (const part of pathParts(key)) {
      if (/^\d+$/.test(part)) { defs = fd?.item || []; continue }
      fd = (defs || []).find(x => x.key === part)
      if (!fd) return null
      defs = fd.item || []
    }
    return fd
  }
  const dirtyFor = (fields, id, key, value) => {
    const f = fieldDefAt(fields, key)
    return TEXTISH.includes(f?.type || 'text') ? { patch: { id, prop: key, value } } : {}
  }

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
  const scaleBadge = h('button.preview-zoom', {
    type: 'button',
    // The label used to be a fixed aria-label, which overrode the text and hid
    // the width and scale from a screen reader. The text IS the name now.
    title: 'Hide a side panel so the page is shown at full size',
    onclick: () => { toggleOutline(false); setInspHidden(true) },
    hidden: true,
  })
  // With no panel open there is nothing to hide, so the same words became an
  // instruction nobody could follow on a button that did nothing (R9-2a). Then
  // the note is plain text, not a control.
  const scaleNote = h('span.preview-zoom.preview-zoom-flat', { hidden: true })
  const scaleHolder = h('span.preview-zoom-holder', {}, scaleBadge, scaleNote)
  /** Is either side panel actually on screen right now? */
  const anyPanelOpen = () => {
    const app2 = document.querySelector('.app')
    const out = document.querySelector('.editor > .outline')
    const outOpen = matchMedia('(max-width: 1400px)').matches
      ? !!out?.classList.contains('open')
      : !!out && !out.classList.contains('closed')
    const inspOpen = matchMedia('(max-width: 1100px)').matches
      ? !!app2?.classList.contains('insp-open')
      : !app2?.classList.contains('insp-hidden')
    return outOpen || inspOpen
  }
  const canvasEmpty = h('div.canvas-empty', { hidden: true })
  const frameHolder = h('div.preview-frame-holder', {}, iframe)
  const previewWrap = h('div.preview-wrap', { class: prefs().device ? `w-${prefs().device}` : '' }, frameHolder, canvasEmpty)
  // The preview used to be shrunk to 81% (65% with the outline open) because it
  // was forced to render at 1280px in a 630px canvas: body text became
  // unreadable. The canvas now shows the page at 100% and lets the SITE's own
  // responsive rules do the work — which is exactly what a visitor with a
  // window that wide sees — but only once the canvas really is desktop-wide.
  // With the rail, outline and inspector open the canvas is ~630px, and a page
  // rendered at 630px is the site's MOBILE layout: "Desktop" showed a hamburger
  // menu. So Desktop renders at a real desktop width and scales down to fit,
  // with the badge saying how to get it bigger.
  // One sizing rule for every document, every panel toggle and every window
  // size. Desktop means desktop: the page is always rendered 1280px wide — the
  // width most visitors on a laptop actually get — and the whole frame is
  // scaled down to fit the canvas when the canvas is narrower. It is never
  // stretched to the canvas, because then the same button showed the same page
  // at a different width on every screen and every panel arrangement.
  const DESKTOP_W = 1280
  // Tablet and phone are real device widths, not "whatever the canvas allows".
  // Asked for 834 and 390 in CSS, both used to come out at the canvas width —
  // so at 1440 with both panels open the two buttons produced the same 612px
  // iframe. They now go through the same render-wide-then-scale path as
  // Desktop, and the badge says which width you are looking at.
  const DEVICE_W = { tablet: 834, mobile: 390 }
  const DEVICE_LABEL = { tablet: 'Tablet', mobile: 'Phone' }
  const FRAME_BORDER = 20     // the device frame's 10px border, both sides
  const fitForDevice = () => paintScale()

  /**
   * The old code leaned on `requestAnimationFrame` inside `fitPreviewFrame` for
   * the first measurement. A tab that is not painting (the studio opened in a
   * background tab, or a document opened while another view is animating) never
   * ran it, so those documents kept the iframe at the holder's own width with
   * no frame width at all — a ~830px canvas showing the site's TABLET layout.
   * Measuring straight away, and again from a ResizeObserver, removes the race.
   */
  function paintScale() {
    const k = prefs().device || ''
    iframe.style.transform = ''
    iframe.style.transformOrigin = 'top left'
    const availW = previewWrap.clientWidth
    const availH = previewWrap.clientHeight
    if (!availW || !availH) return
    if (k) {
      const dw = DEVICE_W[k] || DESKTOP_W
      const s = Math.min(1, (availW - FRAME_BORDER) / dw)
      frameHolder.style.width = Math.round(dw * s) + FRAME_BORDER + 'px'
      iframe.style.width = dw + 'px'
      iframe.style.height = Math.round((availH - FRAME_BORDER) / s) + 'px'
      iframe.style.transform = s === 1 ? '' : `scale(${s})`
      return setDeviceNote(DEVICE_LABEL[k] || 'Desktop', dw, Math.round(s * 100))
    }
    // The same rule for every document: 1280 wide, scaled to fit. But a page
    // shrunk past 60% has 8px body copy — you can see the layout and read none
    // of it, which is not a preview of anything. Below that floor the preview
    // steps down to a narrower real width (1024, then tablet 834) rather than
    // shrinking further, and says so.
    const FLOOR = 0.6
    let width = DESKTOP_W
    let scale = availW / width
    let narrowed = false
    for (const w of [1024, 834]) {
      if (scale >= FLOOR) break
      width = w
      scale = availW / width
      narrowed = true
    }
    scale = Math.min(1, scale)
    frameHolder.style.width = Math.round(width * scale) + 'px'
    iframe.style.width = width + 'px'
    iframe.style.height = Math.round(availH / scale) + 'px'
    iframe.style.transform = scale === 1 ? '' : `scale(${scale})`
    setZoomNote(Math.round(scale * 100), narrowed)
  }
  /** Device modes always say which width, and the scale when it is not 1:1. */
  function setDeviceNote(label, width, pct) {
    frameHolder.dataset.scale = pct === 100 ? '' : String(pct)
    scaleBadge.textContent = pct === 100
      ? `${label} width — ${width}px, shown full size`
      : `${label} width — ${width}px, shown at ${pct}%`
    scaleBadge.hidden = false
    scaleNote.hidden = true
  }

  /** The zoom level lives beside the device buttons, never over the page. */
  function setZoomNote(pct, narrowed = false) {
    frameHolder.dataset.scale = pct === 100 && !narrowed ? '' : String(pct)
    const hide = pct === 100 && !narrowed
    const open = anyPanelOpen()
    const text = open
      ? (narrowed
        ? 'Shown narrower to keep text readable · hide a panel for desktop width'
        : `${pct}% · hide a panel for full size`)
      : (narrowed
        ? 'Shown narrower to keep text readable — the page is wider than the window'
        : `${pct}% — the page is wider than the window`)
    scaleBadge.hidden = hide || !open
    scaleNote.hidden = hide || open
    if (open) scaleBadge.textContent = text
    else scaleNote.textContent = text
  }
  /** R21 — below 480px the zoom/scale note leaves the toolbar for room, so the
      "⋯" menu carries the same sentence as a line you cannot click. */
  function zoomNoteText() {
    const el = !scaleNote.hidden ? scaleNote : (!scaleBadge.hidden ? scaleBadge : null)
    return el ? String(el.textContent || '').trim() : ''
  }

  const previewRO = new ResizeObserver(() => paintScale())
  previewRO.observe(previewWrap)

  /** The canvas — not the inspector — is where an empty page asks to be started. */
  function paintCanvasEmpty() {
    const empty = !doc.blocks.length
    canvasEmpty.hidden = !empty
    if (!empty) return canvasEmpty.replaceChildren()
    canvasEmpty.replaceChildren(h('div.canvas-empty-card', {},
      h('h2', {}, 'This page is empty'),
      h('p', {}, 'Start with a ready-made layout, or add one block at a time.'),
      h('div.canvas-empty-starters', {},
        ...STARTERS.map(s => h('button.btn.ghost.small', { onclick: () => applyStarter(s) }, s.label))),
      h('button.btn.primary.small', { onclick: () => addBlock('', doc.blocks.length) }, 'Add a block')))
  }

  const onResize = debounce(() => { paintScale(); renderActions() }, 200)
  addEventListener('resize', onResize)

  const refreshPreview = () => { scheduleSave.now?.(); iframe.contentWindow?.location.reload() }
  // Was a 500ms debounce racing a 900ms save debounce: the preview reloaded
  // 400ms BEFORE the write it was showing, so every structural or layout change
  // rendered the PREVIOUS edit and stayed a step behind until the next one.
  let previewStale = false
  const refreshPreviewSoon = () => {
    if (readOnly) return
    if (!dirty) { iframe.contentWindow?.location.reload(); return }
    previewStale = true
    scheduleSave()
  }
  refreshPreviewSoon.cancel = () => { previewStale = false }
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
    // A plain click always collapses the selection back to one block.
    if (!opts.keepMulti) { multi.clear(); if (id) multi.add(id) }
    // Picking a block used to leave the inspector on whatever tab was open, so
    // from the Page tab you clicked a block and still saw Slug and Publish at.
    // Choosing a block means "show me this block". With nothing selected the
    // Page tab is right and stays.
    if (id && inspTab !== 'block' && !opts.keepTab) { inspTab = 'block'; syncTabHash() }
    renderTree()
    renderInspector()
    if (!opts.fromPreview) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id }, '*')
  }

  /**
   * Multi-select. The rubric asks for it by name and there was none: one scalar
   * selectedId, so shift-clicking simply replaced the selection. `multi` always
   * contains selectedId, so single-selection code paths keep working unchanged.
   *
   * Ctrl/Cmd-click adds or removes one row. Shift-click takes the run between
   * the anchor and the row you clicked, in the order the outline shows them —
   * but only among siblings, because a range spanning two parents cannot be
   * duplicated or deleted as one coherent thing.
   */
  function selectRange(id) {
    const rows = visibleRows()
    const a = rows.findIndex(r => r.node.id === selectedId)
    const b = rows.findIndex(r => r.node.id === id)
    if (a < 0 || b < 0) return selectBlock(id)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const parent = rows[a].parentId
    multi.clear()
    for (let i = lo; i <= hi; i++) if (rows[i].parentId === parent) multi.add(rows[i].node.id)
    multi.add(selectedId)
    renderTree(); renderInspector()
  }
  function toggleInSelection(id) {
    if (multi.has(id) && multi.size > 1) {
      multi.delete(id)
      if (selectedId === id) selectedId = [...multi][multi.size - 1]
    } else {
      multi.add(id); selectedId = id
    }
    renderTree(); renderInspector()
  }
  /** Selected ids in outline order — the order any bulk action must use. */
  const selectedInOrder = () => visibleRows().filter(r => multi.has(r.node.id)).map(r => r.node.id)

  // ---------- bulk operations ----------
  // Every one of these runs over the selection, which is a set of exactly one
  // for a normal click, so single-block behaviour is unchanged.
  const selNodes = () => selectedInOrder().map(id => ops.find(id)?.node).filter(Boolean)

  async function bulkCopy(quiet) {
    const nodes = selNodes()
    if (!nodes.length) return
    await copyBlocks(nodes)
    if (!quiet) toast(nodes.length > 1 ? `${nodes.length} blocks copied` : 'Block copied', 'ok', 1600)
  }

  function bulkDuplicate() {
    const ids = selectedInOrder()
    if (!ids.length) return
    snapshotOnce(ids.length > 1 ? `Duplicate ${ids.length} blocks` : 'Duplicate block')
    const made = ids.map(id => ops.duplicate(id)).filter(Boolean)
    if (ids.length > 1) toast(`${made.length} blocks duplicated`, 'ok', 1800)
  }

  function bulkRemove() {
    const ids = selectedInOrder()
    if (!ids.length) return
    if (ids.length === 1) return removeWithUndo(ids[0])
    // capture where each one sat so Undo can put them all back
    const restore = ids.map(id => {
      const site = ops.siteFor(id)
      return { node: JSON.parse(JSON.stringify(ops.find(id).node)), parentId: site.parentId, index: site.index }
    })
    snapshotOnce(`Delete ${ids.length} blocks`)
    for (const id of ids) ops.remove(id)
    multi.clear(); selectedId = null
    renderTree(); renderInspector()
    undoToast(`${ids.length} blocks deleted`, () => {
      for (const r of restore.slice().sort((a, b) => a.index - b.index)) ops.insert(r.node, r.parentId, r.index)
      renderTree(); renderInspector()
    })
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
      { key: 'delete', label: multi.has(id) && multi.size > 1 ? `Delete ${multi.size} blocks` : 'Delete', icon: icon('trash', 14), shortcut: 'Del', danger: true, run: () => (multi.has(id) ? bulkRemove() : removeWithUndo(id)) },
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
    const body = h('div.stack-0', {},
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
    // Whatever opened the picker gets the keyboard back when it closes. The
    // dialog helper restores `document.activeElement`, which is <body> when the
    // picker was opened from a context menu or a synthetic click — so the
    // control is captured here instead, with the last-clicked control as the
    // fallback, and the selected outline row as the last resort.
    const opener = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : lastPointerControl
    const dlg = dialog({
      title: 'Add a block', width: 'min(44rem, 94vw)', body: [search, holder],
      onClose: () => setTimeout(() => {
        if (opener?.isConnected) opener.focus()
        else outlineBody.querySelector('.tree-item.selected')?.focus()
      }, 0),
    })
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
  // Closed until the person opens it. The canvas is the point of the screen,
  // and every panel taking a share of it is another 100px the page is shrunk
  // by. Opening it is one click and the choice is remembered for ever after.
  // Above 1400px there is room for the outline and the canvas both, so a
  // first-time editor opens with the list of blocks in view; on narrower
  // screens the canvas still wins. Either way the choice is remembered.
  let outlineOpen = disclosure('outline', window.innerWidth > 1400)

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

  /** Put keyboard focus on the row the outline now shows as selected. */
  const focusSelectedRow = () =>
    setTimeout(() => outlineBody.querySelector('.tree-item.selected')?.focus({ preventScroll: true }), 0)

  function renderTree() {
    const rows = visibleRows()
    const tree = h('div.tree', { role: 'tree', 'aria-label': 'Page outline' })
    for (const { node, parentId, index, depth } of rows) {
      const def = byType[node.type]
      const isContainer = !!def?.container
      const isFolded = !!folded()[node.id]
      const selected = node.id === selectedId
      const inMulti = multi.has(node.id) && multi.size > 1
      // A row used to be a <button> with the actions <button> inside it —
      // invalid nesting, which is why clicking a label sometimes did nothing.
      // It is a div[role=treeitem] now, with one click handler, and the actions
      // button sits beside the label rather than inside the clickable surface.
      const row = h('div.tree-item', {
        class: [selected ? 'selected' : '', inMulti ? 'multi' : ''].filter(Boolean).join(' '),
        role: 'treeitem', 'aria-selected': String(selected || inMulti), 'aria-level': String(depth + 1),
        ...(isContainer ? { 'aria-expanded': String(!isFolded) } : {}),
        tabindex: selected ? '0' : '-1',
        draggable: 'true',
        dataset: { nodeId: node.id, parentId, index: String(index), container: isContainer ? '1' : '0' },
        onclick: e => {
          if (e.shiftKey) { e.preventDefault(); return selectRange(node.id) }
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); return toggleInSelection(node.id) }
          selectBlock(node.id)
          // renderTree() has just replaced this row, so focus the new one:
          // a mouse click used to leave focus on <body> and the arrow keys
          // did nothing until you Tabbed back into the outline.
          focusSelectedRow()
        },
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
        // Two lines: what the block says, then what kind of block it is. On one
        // line the type was what the ellipsis ate, so eighteen rows all read
        // "The Helmsdale …" with no way to tell a heading from a paragraph.
        // When the label IS the type ("Section Section") one line is enough.
        h('span.t-label', {},
          h('span.t-name', {}, labelOf(node, def)),
          (def?.label || node.type) === labelOf(node, def)
            ? ''
            : h('span.t-type', { 'aria-hidden': 'true' }, def?.label || node.type)),
        h('span.mrow-tools', {},
          h('button.icon-btn', {
            'aria-label': `Actions for ${labelOf(node, def)}`,
            tabindex: '-1',
            onclick: e => { e.stopPropagation(); blockMenu(e, node.id) },
          }, iconEl('more', 13))))
      // Indent is a custom property so the row itself never grows wider than
      // the rail; past five levels it stops, rather than scrolling sideways.
      row.style.setProperty('--depth', String(Math.min(depth, 5)))
      // Every row records its ancestors, so the drop logic can tell a
      // descendant from a cousin. Wrapping only the node's own row (as this
      // did) meant dragging onto your own child looked like a valid drop.
      row.dataset.ancestors = ancestorsOf(node.id).join(' ')
      tree.appendChild(row)
    }
    outlineBody.replaceChildren(
      doc.blocks.length ? tree : h('p.tree-empty', {}, 'This page is empty.'),
      h('button.tree-add', { onclick: () => addBlock('', doc.blocks.length) }, iconEl('plus', 12), ' Add block'))
    paintCanvasEmpty()

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
    } else if (e.key === 'Enter' || e.key === ' ') {
      // A row is a div now, so it has to re-create the button's activation keys.
      e.preventDefault(); selectBlock(id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); multi.has(id) ? bulkRemove() : removeWithUndo(id) }
    else if (e.shiftKey && e.key === 'F10') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); blockMenu({ preventDefault() {}, clientX: r.left + 20, clientY: r.bottom }, id) }
  }

  const outlineEl = h('aside.outline', { class: outlineOpen ? '' : 'closed' },
    h('div.outline-head', {},
      h('span.panel-title.grow', {}, 'Outline'),
      h('button.icon-btn', { 'aria-label': 'Add block', title: 'Add block', onclick: () => addBlock('', doc.blocks.length) }, iconEl('plus', 14))),
    outlineBody)

  // ---------- inspector ----------

  let inspTab = ['block', 'page', 'seo'].includes(tabParam) ? tabParam : 'block'
  const inspBody = h('div.insp-body', { id: 'insp-body', role: 'tabpanel' })
  const crumbs = h('div.insp-crumbs', { 'aria-label': 'Selected block path' })
  const tabs = h('div.insp-tabs', { role: 'tablist', 'aria-label': 'Settings panel' })

  function syncTabHash() {
    const base = `#/e/${doc.id}/${inspTab}`
    if (location.hash.split('?')[0] !== base) history.replaceState(null, '', base)
  }
  const setTab = k => {
    inspTab = k
    syncTabHash()
    renderInspector()
  }

  /**
   * Find the form control for a (possibly dotted) field key, opening any list
   * rows on the way. `slides.0.heading` expands the first slide first.
   */
  function fieldElFor(key) {
    const parts = pathParts(key)
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}.${parts[i]}` : parts[i]
      const next = parts[i + 1]
      if (next != null && /^\d+$/.test(next)) {
        const rows = inspBody.querySelector(`[data-list-key="${CSS.escape(acc)}"]`)
        const row = rows?.querySelector(`.list-row[data-list-index="${CSS.escape(next)}"]`)
        const body = row?.querySelector('.list-row-body')
        if (body && body.style.display === 'none') row.querySelector('.list-row-head')?.click()
        acc = `${acc}.${next}`
        i++
      }
    }
    return inspBody.querySelector(`[data-field-key="${CSS.escape(key)}"]`)
      || inspBody.querySelector(`[data-field-key="${CSS.escape(acc)}"]`)
  }

  /** Show the inspector field behind something clicked on the page. */
  function focusField(key, tab) {
    if (tab && inspTab !== tab) { inspTab = tab; renderInspector() }
    setInspHidden(false)
    // A group (Publishing, "Product details") may be closed around the field.
    const reveal = () => {
      const el = fieldElFor(key)
      if (!el) return false
      for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('field-flash'); void el.offsetWidth; el.classList.add('field-flash')
      el.querySelector('input, textarea, select, [contenteditable]')?.focus?.({ preventScroll: true })
      return true
    }
    if (!reveal()) requestAnimationFrame(() => { reveal() })
    // Flash the same words on the page, so the two halves line up.
    if (tab === 'page') iframe.contentWindow?.postMessage({ blockhouse: 'flashfield', key }, '*')
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

  // Mirrors isCanonicalWidthField in src/render/layout.ts: a `width` field that
  // speaks the shared five-value vocabulary, not a block's own private sizes.
  const CANON_WIDTHS = ['narrow', 'normal', 'wide', 'page', 'full', 'entry']
  const isCanonicalWidth = fd =>
    !!fd && fd.key === 'width' &&
    (fd.canonicalWidth === true ||
      (Array.isArray(fd.options) && fd.options.length &&
        fd.options.every(o => CANON_WIDTHS.includes(typeof o === 'string' ? o : o?.value))))

  function renderBlockTab(found) {
    crumbs.style.display = ''
    crumbs.replaceChildren(
      h('button', {
        onclick: () => { selectedId = null; renderTree(); renderInspector(); iframe.contentWindow?.postMessage({ blockhouse: 'clear' }, '*') },
      }, 'Page'),
      ...(found ? found.parents.flatMap(p => [h('span.sep', {}, '›'), h('button', { onclick: () => selectBlock(p.id) }, byType[p.type]?.label || p.type)]) : []),
      ...(found ? [h('span.sep', {}, '›'), h('button.txt-acc-strong', { 'aria-current': 'true' }, byType[found.node.type]?.label || found.node.type)] : []))

    if (!found) {
      // An empty page asks to be started on the canvas, not in here.
      inspBody.replaceChildren(
        h('div.empty.insp-empty', {},
          h('div.empty-ico', {}, iconEl('layout', 26)),
          h('h3', {}, 'Nothing selected'),
          h('p', {}, doc.blocks.length
            ? 'Pick a block in the outline, or click one in the preview.'
            : 'Add a block from the canvas and its settings appear here.'),
          h('div.insp-empty-acts', {},
            h('button.btn.primary.small', { onclick: () => addBlock('', doc.blocks.length) }, 'Add a block'))))
      return
    }

    const def = byType[found.node.type]

    // One width model: a block sitting straight on the page owns its own width;
    // a block inside a Section takes the Section's. The inspector says which of
    // the two you are looking at instead of hiding width behind a wrapper, and
    // never shows two width controls at once.
    const ownWidth = (def?.fields || []).find(isCanonicalWidth)
    // A nested block must say where its width comes from even when the block
    // it sits in has no width of its own — otherwise a level-2 block got no
    // Layout group at all and the persona had to guess (R9-5 / category 5).
    const ancestors = [...(found.parents || [])].reverse()
    const container = ancestors.find(p => (byType[p.type]?.fields || []).some(isCanonicalWidth)) || ancestors[0]
    const containerDef = container && byType[container.type]
    const containerLabel = containerDef ? (containerDef.label || container.type) : ''
    // The value, not just the sentence: "Width: set by the Section around it — Wide".
    const containerWidthField = containerDef && (containerDef.fields || []).find(isCanonicalWidth)
    const containerWidthValue = containerWidthField
      ? (container.props?.width ?? containerWidthField.default ?? '')
      : ''
    const containerWidthLabel = containerWidthValue
      ? ((meta.layoutWidths || []).find(w => w.value === containerWidthValue)?.label || containerWidthValue)
      : ''

    // Rendering the inspector must never touch the document. `node.props =
    // node.props || {}` here wrote an empty object into the block that happens
    // to be selected when the editor opens, so a page nobody had edited came
    // back different from the stored one: Save flipped a published page to
    // "Published · edited" and asked the owner to republish work that did not
    // exist (R16-1). The form writes into a local holder and the node only
    // gains it when a field actually changes.
    const props = found.node.props || {}
    const keepProps = () => { found.node.props = props }
    const propFields = (def?.fields || []).filter(fd => fd !== ownWidth)
    const propsForm = propFields.length
      ? renderFields(propFields, props, (key, value) => {
        keepProps()
        snapshotOnce(`Edit ${labelOf(found.node, def)}`)
        markDirty(dirtyFor(propFields, found.node.id, key, value))
      })
      : fieldlessForm(found.node, def)

    // "Template default" is one of six options and always does the same as one
    // of the other five, so it has to say which: "Template default (Normal)".
    // Two identically-behaving choices with no way to tell them apart is a
    // guessing game, not a setting.
    // "Template default" leaves the block unstyled — the template decides. Once
    // a width had been picked there was no way back to that, so a block could
    // only ever be returned to "Normal".
    const widthField = {
      key: 'width', type: 'select', label: 'Width', default: '',
      help: 'How wide this block runs across the page.',
      options: [{ value: '', label: templateDefaultLabel(def) },
        ...(meta.layoutWidths || []).map(w => ({ value: w.value, label: w.label }))],
    }
    // Width changes the markup around the block, so the preview has to reload —
    // a text patch would leave the old layout on screen.
    // `holder` is the local the form writes into; `keep` attaches it to the
    // document, and only ever from a change handler.
    const onWidth = (holder, keep) => (key, value) => {
      // Choosing "Template default" has to remove the stored width, not store
      // an empty one: an empty string is still a value the renderer sees.
      if (!value) delete holder[key]
      keep()
      snapshotOnce(`Edit ${labelOf(found.node, def)}`)
      markDirty({ structural: true })
    }

    let layoutForm
    if (ownWidth) {
      layoutForm = [
        h('div.insp-section-title', {}, 'Layout'),
        renderFields([widthField], props, onWidth(props, keepProps)),
      ]
    } else if (container) {
      layoutForm = [
        h('div.insp-section-title', {}, 'Layout'),
        h('div.insp-layout-inherit', {},
          h('p.insp-inherit-line', {},
            `Width: set by the ${containerLabel} around it`,
            containerWidthLabel ? h('strong.insp-inherit-val', {}, ` — ${containerWidthLabel}`) : ''),
          h('button.btn.ghost.small', { onclick: () => selectBlock(container.id) },
            iconEl('up', 14), `Select the ${containerLabel}`)),
      ]
    } else {
      // The one that caused R16-1: this branch is what the default-selected
      // first block of most published pages lands in.
      const layout = { ...found.node.layout }
      const keepLayout = () => {
        if (Object.keys(layout).length) found.node.layout = layout
        else delete found.node.layout
      }
      layoutForm = [
        h('div.insp-section-title', {}, 'Layout'),
        renderFields([widthField], layout, onWidth(layout, keepLayout)),
      ]
    }

    // Same single-column treatment as the Page tab: label above, input full
    // width, help below. A sentence of help in the label cell beside a 9-char
    // select was unreadable and left the control too narrow to use.
    inspBody.replaceChildren(h('div.fields-stack', {},
      h('div.insp-section-title', {}, def?.label || found.node.type,
        h('button.icon-btn', {
          'aria-label': 'Block actions', title: 'Block actions',
          onclick: e => blockMenu(e, found.node.id),
        }, iconEl('more', 14))),
      propsForm,
      ...layoutForm))
  }

  /**
   * A block whose type declares no fields still usually holds one piece of
   * text — the same prop `labelOf` names the row by. Telling people to "edit it
   * straight on the page" left the inspector empty and the text unreachable
   * from the keyboard; edit it here instead.
   */
  const TEXT_PROPS = ['title', 'text', 'question', 'label', 'md']
  function fieldlessForm(node, def) {
    const key = TEXT_PROPS.find(k => typeof node.props?.[k] === 'string')
    if (!key) {
      return h('p.mut.insp-note', {}, 'This block has no settings. Its content comes from the template.')
    }
    const field = key === 'md'
      ? { key, type: 'richtext', label: 'Text' }
      : { key, type: 'textarea', label: 'Text', rows: 3 }
    return h('div', {},
      renderFields([field], node.props, (k, value) => {
        snapshotOnce(`Edit ${labelOf(node, def)}`)
        markDirty(dirtyFor([field], node.id, k, value))
      }),
      h('button.btn.ghost.small', {
        onclick: () => iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id: node.id }, '*'),
      }, 'Show it in the preview'))
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
      h('summary', {}, title), h('div.pt-1', {}, ...body))
    d.addEventListener('toggle', () => setDisclosure(`e.${key}`, d.open))
    return d
  }

  // The page-template list used to be raw file names — `404`, `faqs`, `range`.
  // The stored value stays the file name; only what the owner reads changes.
  const TPL_NAMES = {
    home: 'Home page', product: 'Product page', '404': 'Not-found page',
    list: 'List page', range: 'Range page', faqs: 'FAQs page',
    page: 'Standard page', project: 'Project page',
  }
  function tplLabel(t) {
    if (TPL_NAMES[t]) return TPL_NAMES[t]
    const words = String(t).replace(/[-_]+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1) + ' page'
  }
  function defaultTplLabel(concept) {
    const t = concept?.template || concept?.name || 'page'
    const typeLabel = concept?.label || (concept?.name || 'page')
    return `Default for ${typeLabel} (${tplLabel(t)})`
  }

  /** What "Template default" actually resolves to for this kind of block. */
  function templateDefaultLabel(def) {
    const v = def?.defaults?.width || 'normal'
    const w = (meta.layoutWidths || []).find(x => x.value === v)
    return w ? `Template default (${w.label})` : 'Template default'
  }

  function renderPageTab() {
    crumbs.style.display = 'none'
    const concept = meta.concepts.find(c => c.name === doc.concept)
    const pageVals = { slug: doc.slug, publishAt: doc.publishAt || '', template: doc.template || '' }
    const custom = { ...doc.custom }
    // Repeatable fields seed an empty list into whatever object they are given,
    // so this one is a copy too — rendering must leave the page as it found it.
    const fieldVals = { ...doc.fields }
    const tplSelect = h('div')
    const drawTpl = tpls => tplSelect.replaceChildren(renderFields([{
      key: 'template', type: 'select', label: 'Page template',
      options: tpls.map(t => ({ value: t, label: t ? tplLabel(t) : defaultTplLabel(concept) })),
      help: 'Which page layout to use. Leave as Default unless a designer told you otherwise.',
    }], pageVals, (k, v) => { if (v) doc.template = v; else delete doc.template; snapshotOnce('Change template'); markDirty() }))
    drawTpl(window.__blockhousePageTpls || [''])
    if (!window.__blockhousePageTpls) {
      // fill the select in place — re-rendering the whole tab used to steal the
      // caret out of whatever field you were typing in
      get('/templates/pages').then(r => { window.__blockhousePageTpls = ['', ...r.pages]; drawTpl(window.__blockhousePageTpls) }).catch(() => {})
    }

    const pubHelp = h('span.help', {}, publishAtHelp())
    // Restore points used to sit at the very bottom, below custom code. They are
    // the thing people reach for when something has gone wrong, so they come
    // second — open already, unless there are none yet.
    const versions = group('versions', 'Restore points', true,
      h('p.fnt.insp-note', {}, sc('A restore point is kept every time you press Save (⌘S) or publish.')),
      versionsPanel(n => { if (!n) versions.open = false }))
    inspBody.replaceChildren(h('div.fields-stack', {},
      h('div.insp-section-title', {}, 'Publishing'),
      renderFields([
        { key: 'slug', type: 'text', label: 'Page address', help: 'The last part of the web address. If you change it, the old address still works.' },
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
      versions,
      ...(concept?.fields?.length ? [
        h('div.insp-section-title', {}, `${concept.label} details`),
        renderFields(concept.fields, fieldVals, (k, v) => {
          // Merge, not replace: editing straight on the preview writes into
          // `doc.fields` too, and must not be thrown away by a later edit here.
          doc.fields = Object.assign(doc.fields || {}, fieldVals)
          snapshotOnce('Edit fields')
          const fd = fieldDefAt(concept.fields, k)
          if (TEXTISH.includes(fd?.type || '')) {
            // Patch the words in place. Reloading the page under the cursor is
            // what made typing into these fields feel like a fight.
            refreshPreviewSoon.cancel()
            dirty = true
            paintSaveState('', 'Unsaved…')
            scheduleSave()
            iframe.contentWindow?.postMessage({ blockhouse: 'patchfield', key: k, value: v }, '*')
          } else markDirty()
        }),
      ] : []),
      h('div.insp-section-title', {}, 'Appearance'),
      tplSelect,
      group('addresses', 'Web address', false, routingPanel()),
      group('access', 'Who can see this page', false, accessPanel()),
      group('code', 'Custom code for this page only', false,
        h('p.fnt.text-xs.mb-2', {},
          'Runs on this page for every visitor. Site-wide code lives in Settings → Custom code.'),
        renderFields([
          { key: 'css', type: 'code', lang: 'css', label: 'CSS', rows: 4 },
          ...(meta.perms.html ? [{ key: 'js', type: 'code', lang: 'js', label: 'JavaScript', rows: 4 }] : []),
        // Same rule as the block inspector: rendering the tab must not add an
        // empty `custom` to the page (R16-1).
        ], custom, () => { doc.custom = custom; snapshotOnce('Edit custom code'); markDirty() }))))
  }

  function publishAtHelp() {
    return doc.publishAt
      ? `Scheduled — the page stays hidden until then.${meta.scheduler === false ? ' The scheduler is not running on this server, so it will not publish itself.' : ''}`
      : 'Leave empty to publish immediately when you press Publish.'
  }

  function renderSeoTab() {
    crumbs.style.display = 'none'
    // A local holder: opening the SEO tab must not add an empty `seo` to the
    // page (R16-1). It joins the document when a field actually changes.
    const seoVals = { ...doc.seo }
    const keepSeo = () => { doc.seo = seoVals }
    const site = meta.site
    const title = seoVals.title || doc.title
    inspBody.replaceChildren(
      h('div.serp', {},
        h('div.serp-url', {}, (site.url || '') + path),
        h('div.serp-title', {}, title.length > 60 ? title.slice(0, 57) + '…' : title),
        h('div.serp-desc', {}, (seoVals.description || 'No meta description set — search engines will improvise one.').slice(0, 160))),
      (() => {
        const ogImg = h('div.og-img', {}, seoVals.image ? '' : 'no share image set')
        if (seoVals.image) {
          get('/media').then(r => {
            const mm = r.media.find(x => x.id === seoVals.image)
            if (mm) ogImg.style.backgroundImage = `url(/media/${mm.file})`
          }).catch(() => {})
        }
        return h('div.og-card', {}, ogImg,
          h('div.og-body', {},
            h('div.og-domain', {}, (site.url || '').replace(/^https?:\/\//, '')),
            h('div.og-title', {}, seoVals.title || doc.title),
            h('div.og-desc', {}, seoVals.description || '')))
      })(),
      renderFields([
        { key: 'title', type: 'text', label: 'SEO title', help: 'Defaults to the document title' },
        { key: 'description', type: 'textarea', label: 'Meta description', rows: 3 },
        { key: 'keyword', type: 'text', label: 'Focus keyword', help: 'Enables the keyword checks below' },
        { key: 'image', type: 'image', label: 'Social share image' },
        { key: 'canonical', type: 'text', label: 'Canonical URL override' },
        { key: 'noindex', type: 'boolean', label: 'Hide from search engines (noindex)' },
      ], seoVals, k => { keepSeo(); snapshotOnce('Edit SEO'); markDirty(); if (k === 'keyword' || k === 'image') scheduleSave.now?.() }),
      h('button.btn.ghost.small', {
        onclick: async e => {
          const b = e.currentTarget; b.disabled = true; b.classList.add('busy')
          try {
            const text = JSON.stringify(doc.blocks).slice(0, 8000)
            const r = await post('/x/ai/assist', { task: 'meta', text: `Title: ${doc.title}\n${text}` })
            seoVals.description = r.result.slice(0, 160)
            keepSeo()
            snapshotOnce('AI description'); markDirty(); renderInspector()
          } catch (err) {
            toast(err?.status === 404
              ? 'The AI assist app is not switched on for this site'
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
    const row = (label, value, hint) => h('div.stack-0.mb-2', {},
      h('span.fnt.text-xs', {}, label),
      h('code.text-s.break-all', {}, value),
      hint ? h('span.fnt.text-xs', {}, hint) : '')

    const aliases = h('div.stack-1', {})
    const drawAliases = () => {
      const list = doc.aliases || []
      aliases.replaceChildren(
        ...list.map((a, i) => h('div.d-flex.gap-1', {},
          h('input.input.grow', { value: a, placeholder: '/old-url', 'aria-label': `Old address ${i + 1}`, onchange: e => {
              const v = e.target.value.trim()
              snapshotOnce('Edit addresses')
              if (!v) list.splice(i, 1)
              else list[i] = v.startsWith('/') ? v : '/' + v
              doc.aliases = list.filter(Boolean)
              markDirty(); drawAliases()
            } }),
          h('button.icon-btn', {
            title: 'Remove this old address', 'aria-label': `Remove old address ${a || i + 1}`,
            onclick: () => { snapshotOnce('Remove address'); list.splice(i, 1); doc.aliases = list; markDirty(); drawAliases() },
          }, iconEl('trash', 13)))),
        h('button.btn.ghost.small', {
          onclick: () => { doc.aliases = [...(doc.aliases || []), '']; markDirty(); drawAliases() },
        }, iconEl('plus', 12), 'Add an old address'),
        list.length ? h('label.field-check.mt-1', {},
          h('input', {
            type: 'checkbox', checked: !!doc.mirror,
            onchange: e => { doc.mirror = e.target.checked; if (!doc.mirror) delete doc.mirror; markDirty() },
          }),
          h('span', {}, 'Show this page at the old address too (instead of sending visitors to the new one)')) : '',
        list.length ? h('span.fnt.text-xs', {},
          doc.mirror
            ? 'The page appears at both addresses. Search engines are told this one is the real one.'
            : 'Anyone who uses an old address is sent to the address above.') : '')
    }
    drawAliases()

    // Plain English first. Everything a developer might want (the file that
    // gets written, the address style) is true but not what the owner came
    // here for, so it sits folded away at the bottom.
    return h('div', {},
      row('Address', (meta.site.url || '') + (href || path), 'The full link to this page.'),
      shortlink ? row('Short link', (meta.site.url || '') + shortlink, 'Always works, even if you rename the page.') : '',
      h('span.fnt.text-xs.d-block.m-3-0-1', {}, 'Old addresses'),
      h('p.fnt.text-xs.mb-2', {}, 'If you change the address, the old one keeps working automatically. You can add more here.'),
      aliases,
      h('details.insp-group.mt-2', {},
        h('summary', {}, 'Technical details'),
        h('div.pt-1', {},
          row('File written when you export the site', exportFile || 'index.html'),
          row('Address style', `${meta.urls?.style || 'directory'} · ${meta.urls?.layout || 'pattern'}`),
          h('a.btn.ghost.small', { href: '#/settings/urls' }, 'Change the address style →'))))
  }

  function accessPanel() {
    const hasMembers = (meta.panels || []).some(p => p.plugin === 'members')
    // Local holder again (R16-1): showing "Who can see this page" must not add
    // an empty `access` to the document.
    const access = { ...doc.access }
    const keepAccess = () => {
      if (Object.keys(access).length) doc.access = access
      else delete doc.access
    }
    const wrap = h('div', {})
    const draw = () => {
      const mode = access.mode || 'public'
      const groups = meta.memberGroups || []
      const modeSelect = h('div')
      modeSelect.append(renderFields([{
        key: 'mode', type: 'select', label: 'Visible to', required: true,
        options: [
          { value: 'public', label: 'Everyone' },
          { value: 'members', label: 'Signed-in members' },
          { value: 'groups', label: 'Specific member groups' },
        ],
        help: hasMembers ? '' : 'Switch on the Members app to use member-only pages.',
      }], { mode }, (k, v) => {
        snapshotOnce('Change access')
        if (v === 'public') for (const key of Object.keys(access)) delete access[key]
        else access.mode = v
        keepAccess()
        markDirty(); draw()
      }))
      wrap.replaceChildren(
        modeSelect,
        mode === 'groups'
          ? (groups.length
            ? h('div.stack-1.m-0-0-3', {},
              ...groups.map(g => h('label.field-check', {},
                h('input', {
                  type: 'checkbox', checked: (access.groups || []).includes(g.id),
                  onchange: e => {
                    const set = new Set(access.groups || [])
                    e.target.checked ? set.add(g.id) : set.delete(g.id)
                    access.groups = [...set]
                    keepAccess()
                    markDirty()
                  },
                }),
                h('span', {}, g.label))))
            : h('p.mut.text-s', {}, 'No member groups yet — add them under Members → Groups.'))
          : '',
        mode !== 'public'
          ? renderFields([{ key: 'redirect', type: 'text', label: 'Send visitors to', help: 'Blank uses the Members login page.' }], access, (k, v) => {
            if (v) access.redirect = v; else delete access.redirect
            keepAccess()
            markDirty()
          })
          : '',
        mode !== 'public'
          ? h('p.mut.text-s', {}, 'Gated pages are served with no-store and are skipped by static exports and sitemaps.')
          : '')
    }
    draw()
    return wrap
  }

  /**
   * "Saved at 14:12", with the day when it is not today. The clock time is what
   * the person remembers about the change they want back.
   */
  function savedWhen(ts) {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return fmtDate(ts)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return `at ${time}`
    const yest = new Date(now)
    yest.setDate(now.getDate() - 1)
    if (d.toDateString() === yest.toDateString()) return `yesterday at ${time}`
    return `on ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`
  }

  function versionsPanel(onCount) {
    const holder = h('div', {}, skeleton('rows', 3))
    get(`/content/${doc.id}/versions`).then(({ versions }) => {
      onCount?.(versions.length)
      // Ten rows reading "Nth restore point · Saved · Tower Parking System /
      // Saved at 03:28" gave the owner nothing to choose between (R16-2,
      // R17-3). Two things fix that. Every run of saves made inside the same
      // minute is now folded into one expandable row — "6 saves at 03:28" —
      // whether or not the saves were identical, so the list reads as the
      // handful of moments the owner remembers rather than as autosave noise.
      // And the ordinals are gone: "1st restore point" headed the NEWEST row,
      // which reads backwards. The newest is simply "Latest"; the rest are
      // named by their clock time, which is what people remember anyway.
      const CAUSE = { save: 'Saved', publish: 'Published', restore: 'Restored' }
      const CAUSES = { save: 'saves', publish: 'publishes', restore: 'restores' }
      const minuteOf = v => String(v.savedAt || '').slice(0, 16)

      // Mark a point that looks exactly like the one before it, so nobody
      // hunts through identical copies.
      versions = versions.map((v, i) => ({
        ...v,
        same: !!(versions[i + 1]?.fingerprint && versions[i + 1].fingerprint === v.fingerprint),
      }))

      // Group consecutive entries from the same minute (newest first).
      const groups = []
      for (const v of versions) {
        const g = groups[groups.length - 1]
        if (g && minuteOf(g.items[0]) === minuteOf(v)) g.items.push(v)
        else groups.push({ items: [v] })
      }

      const nameOf = v => `${CAUSE[v.action] || 'Saved'}${v.title ? ` · ${v.title}` : ''}`

      // R19 — a note only ever appeared when a version's fingerprint matched
      // the one before it. Older restore points were written before the studio
      // recorded a fingerprint at all, so six rows in a row came out reading
      // exactly the same and there was nothing to choose between them. Say
      // whatever the saved version does tell us, and when it tells us nothing,
      // say that plainly rather than leaving the row bare.
      const noteOf = v => {
        if (v.same) return 'no visible change'
        if (v.fingerprint) return ''
        const n = Number(v.blocks)
        if (Number.isFinite(n) && n > 0) return `${n} ${n === 1 ? 'block' : 'blocks'} on the page`
        return 'older save'
      }

      // Within one minute the clock time is the same on every row, so two rows
      // can still read identically. Fall back to the seconds, which always
      // differ, for any time that more than one visible row shares.
      const clash = {}
      for (const v of versions) clash[String(v.savedAt || '').slice(0, 16)] = (clash[String(v.savedAt || '').slice(0, 16)] || 0) + 1
      const whenOf = v => {
        const base = savedWhen(v.savedAt)
        if (clash[String(v.savedAt || '').slice(0, 16)] < 2) return base
        const d = new Date(v.savedAt)
        const secs = isNaN(d.getTime()) ? '' : String(d.getSeconds()).padStart(2, '0')
        return secs ? `${base}:${secs}` : base
      }

      /** One restore point: preview on the left, Restore on the right. */
      function pointRow(v, lead) {
        const note = noteOf(v)
        const label = `${lead ? `${lead} · ` : ''}${nameOf(v)} ${whenOf(v)}${note ? ` · ${note}` : ''}`
        return h('div.d-flex.gap-1.items-center', {},
          h('button.row-item.grow', {
            'aria-label': `Preview the restore point ${label}`,
            title: 'Preview this version in a new tab',
            onclick: () => window.open(`/preview/${doc.id}?version=${encodeURIComponent(v.key)}`, '_blank', 'noopener'),
          }, h('span.row-ico', { html: icon('clock', 14) }),
            h('span.row-label', {}, `${lead ? `${lead} · ` : ''}${nameOf(v)}`,
              h('div.row-sub', {}, `${CAUSE[v.action] || 'Saved'} ${whenOf(v)}`,
                note ? h('span.rp-note', {}, ` · ${note}`) : ''))),
          h('button.btn.ghost.small', {
            'aria-label': `Restore the restore point ${label}`,
            onclick: async () => {
              if (!(await confirmDialog('Restore this version',
                `Restore the version saved ${savedWhen(v.savedAt)}? Your current version is saved as a restore point first, and you can undo this.`, 'Restore'))) return
              snapshot('Restore a saved version')
              await post(`/content/${doc.id}/restore`, { key: v.key })
              const fresh = await get(`/content/${doc.id}`)
              Object.assign(doc, fresh.doc)
              baseVersion = fresh.doc.version
              titleInput.value = doc.title
              renderTree(); renderInspector(); renderStatus(); refreshPreview()
              undoToast(`Restored the version saved ${savedWhen(v.savedAt)}`, doUndo)
            },
          }, 'Restore'))
      }

      holder.replaceChildren(...(groups.length ? groups.slice(0, 10).map((g, gi) => {
        const lead = gi === 0 ? 'Latest' : ''
        if (g.items.length === 1) return pointRow(g.items[0], lead)
        // A run inside one minute: one row that opens on the individual saves.
        const kinds = new Set(g.items.map(v => v.action))
        const word = kinds.size === 1 ? (CAUSES[[...kinds][0]] || 'saves') : 'changes'
        const head = `${g.items.length} ${word} ${savedWhen(g.items[0].savedAt)}`
        return h('details.rp-group', {},
          h('summary.rp-summary', {}, lead ? `${lead} · ${head}` : head,
            h('span.rp-note', {}, ' · newest first')),
          h('div.rp-group-body', {}, ...g.items.map(v => pointRow(v, ''))))
      }) : [h('p.mut', {}, 'No restore points yet — they are written when you press Save and whenever the page structure changes.')]))
    }).catch(() => holder.replaceChildren(h('p.mut', {}, 'Could not load restore points.')))
    return holder
  }

  // ---------- topbar ----------

  // The editor is the screen the reader spends the day in and it was the one
  // screen with no "?" of its own (R8-6). It now sits in the toolbar beside the
  // width buttons AND stays in the "⋯" menu, which is where people had learned
  // to look for it.
  const helpBtn = helpButton('editor', 'the editor')

  const titleInput = h('input.doc-title-input', { value: doc.title, 'aria-label': 'Document title', readonly: readOnly })
  titleInput.addEventListener('input', () => { doc.title = titleInput.value; snapshotOnce('Rename'); markDirty() })

  // R11 — a class, so the toolbar's flex rules can reach the chip: below
  // 1100px it yields its width to the title and hides (the ⋯ menu carries the
  // same words at that width).
  const statusHolder = h('span.doc-status')
  let statusLabel = '', statusTip = ''
  function renderStatus() {
    // ONE chip, in the same words the lists use. Two lower-case chips
    // ("published" + "unpublished edits") were a third vocabulary for a state
    // the dashboard and the page list already had names for.
    const scheduled = doc.publishAt && new Date(doc.publishAt) > new Date()
    const when = scheduled
      ? new Date(doc.publishAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : ''
    const [cls, text, tip] =
      scheduled ? ['sched', `Scheduled · ${when}`, `Goes live on ${when}`]
      : stale ? ['stale', 'Published · edited', 'Published, with changes not on the website yet']
      : doc.status === 'published' ? ['published', 'Published', 'Live on the website']
      : doc.status === 'review' ? ['review', 'In review', 'Waiting to be checked']
      : ['draft', 'Draft', 'Not on the website yet']
    statusLabel = text
    statusTip = tip
    statusHolder.replaceChildren(h('span.chip', { class: cls, title: tip }, text))
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

  // R19 — the primary button used to read "Published" on a live page with
  // nothing pending: a state, not an action, and the dialog behind it then
  // claimed changes that did not exist. Three honest cases instead.
  function publishWord() {
    if (doc.status !== 'published') return 'Publish…'
    return stale ? 'Republish' : 'Publish again'
  }
  function publishTip() {
    if (doc.status !== 'published') return 'Put this page on the website'
    return stale ? 'Put your latest changes on the website' : 'Already live — publishes the same content again'
  }

  async function publishFlow() {
    const errors = seo.filter(s => s.level === 'error')
    const again = doc.status === 'published' && !stale
    dialog({
      title: doc.status === 'published' ? (stale ? 'Republish changes' : 'Publish again') : 'Publish',
      body: h('div', {},
        again
          ? h('p.dlg-text', {}, `This page is already live at `, h('code', {}, path),
            ' with these exact contents. Publishing again changes nothing for visitors.')
          : h('p.dlg-text', {}, `“${doc.title}” will go live at `, h('code', {}, path), '.'),
        doc.publishAt && new Date(doc.publishAt) > new Date()
          ? h('p.dlg-text.mt-2', {}, `Scheduled for ${new Date(doc.publishAt).toLocaleString()} — it stays hidden until then.`)
          : '',
        errors.length ? h('div.mt-3', {},
          h('div.insp-section-title', {}, 'SEO issues'),
          h('p.fnt.text-s.mb-1', {}, 'Publishing is not blocked — click one to go and fix it.'),
          ...errors.map(chk => h('button.row-item', {
            onclick: () => { document.querySelector('dialog.dlg[open]')?.closeWith?.(); setTab('seo') },
          }, h('span.row-ico', { html: icon('warn', 14) }), h('span.row-label', {}, chk.label)))) : '',
      ),
      actions: [
        { label: 'Cancel', onClick: () => true },
        {
          label: again ? 'Publish again' : 'Publish now', kind: 'primary', onClick: async () => {
            await save(true, true)
            const r = await post(`/content/${doc.id}/publish`)
            doc.status = r.doc.status; stale = false
            // Publishing bumps the stored version. Without taking it back the
            // very next save looks like someone else's write and 409s.
            await adoptVersion(r.doc)
            renderStatus(); renderActions()
            hooks.refreshCounts?.()
            toast('Published — it is live now', 'ok')
            return true
          },
        },
      ],
    })
  }

  const actionsHolder = h('span.editor-top-group')
  function renderActions() {
    if (readOnly) {
      actionsHolder.replaceChildren(h('span.chip', { title: 'Your account can read this but not change it' }, 'Read only'))
      return
    }
    // Below 1100px the toolbar sheds the status chip and the device segment so
    // the page title keeps its width; below 860px the Save button goes too.
    // They reappear here, so nothing is ever simply gone.
    // At 620px and below the toolbar wraps on to a second row and Save is back
    // on it, so the menu only carries Save in the band where it is hidden.
    const narrow = () => innerWidth <= 860 && innerWidth > 620
    // R21 — at 480px and below the zoom/scale note is hidden in the toolbar.
    const tiny = () => innerWidth <= 480
    // R11 — the status chip leaves the toolbar below 1100px (it was stealing
    // the title's width), so from that width down its words live here.
    const statusHidden = () => innerWidth < 1100
    const more = e => contextMenu(e.clientX, e.clientY, [
      ...(tiny() && zoomNoteText() ? [
        { icon: icon('desktop', 14), label: zoomNoteText(), disabled: true, onClick: () => {} },
        '-',
      ] : []),
      ...(statusHidden() ? [
        { icon: icon(doc.status === 'published' ? 'check' : 'pen', 14), label: `${statusLabel} — ${statusTip}`, disabled: true, onClick: () => {} },
        { icon: icon('desktop', 14), label: 'Preview at desktop width', onClick: () => setDevice('') },
        { icon: icon('tablet', 14), label: 'Preview at tablet width', onClick: () => setDevice('tablet') },
        { icon: icon('phone', 14), label: 'Preview at phone width', onClick: () => setDevice('mobile') },
        '-',
      ] : []),
      ...(narrow() ? [
        { icon: icon('save', 14), label: 'Save', shortcut: sc('⌘S'), onClick: () => save(true) },
        '-',
      ] : []),
      { icon: icon('undo', 14), label: 'Undo', shortcut: sc('⌘Z'), disabled: !undoStack.length, onClick: doUndo },
      { icon: icon('redo', 14), label: 'Redo', shortcut: sc('⇧⌘Z'), disabled: !redoStack.length, onClick: doRedo },
      '-',
      // The toolbar used to carry a wand button whose only job was this list.
      { icon: icon('palette', 14), label: 'Quick edit: colour & shape', onClick: () => quickDesign(iframe) },
      ...(meta.perms.menus ? (meta.menus || []).map(mu => ({
        icon: icon('menu', 14), label: `Quick edit: links in ${mu.label || mu.key}`, onClick: () => quickMenu(mu.key, () => refreshPreview()),
      })) : []),
      { icon: icon('layout', 14), label: 'Quick edit: announcement bar', onClick: () => quickChrome('header.announce', () => refreshPreview()) },
      { icon: icon('layout', 14), label: 'Quick edit: footer links & social', onClick: () => quickChrome('footer.social', () => refreshPreview()) },
      '-',
      { icon: icon(focusedMode ? 'eye' : 'eyeOff', 14), label: focusedMode ? 'Show header & footer' : 'Hide header & footer', onClick: toggleFocused },
      // The biggest preview available is one keystroke away, and nothing said
      // so: the way to a full-size page has to be visible, not folklore.
      { icon: icon(wideMode() ? 'panel-open' : 'panel-close', 14), label: 'Focus on the page (hide panels)', shortcut: sc('⌘.'), onClick: () => toggleWide() },
      { icon: icon('external', 14), label: 'Open preview in a new tab', onClick: () => window.open(`/preview/${doc.id}`, '_blank', 'noopener') },
      { icon: icon('swap', 14), label: 'Swap the settings panel to the other side', onClick: () => { const on = document.querySelector('.app').classList.toggle('insp-left'); setPref('inspLeft', on) } },
      { icon: icon('book', 14), label: 'Help with the editor', onClick: () => helpBtn.click() },
      '-',
      ...(doc.status === 'published' && meta.perms.publish
        ? [{ icon: icon('clock', 14), label: 'Unpublish', onClick: async () => { const r = await post(`/content/${doc.id}/unpublish`); doc.status = 'draft'; await adoptVersion(r?.doc); renderStatus(); renderActions(); toast('Unpublished — visitors will see a page-not-found message instead', 'ok', 5000) } }]
        : []),
      { icon: icon('home', 14), label: 'Make this the homepage', onClick: makeHome },
      ...(meta.perms.delete ? [{ icon: icon('trash', 14), label: 'Delete document', danger: true, onClick: deleteDoc }] : []),
    ])
    actionsHolder.replaceChildren(
      h('button.btn.ghost.small', { onclick: () => save(true), title: sc('Save and create a restore point  ⌘S') }, 'Save'),
      meta.perms.publish
        ? h('button.btn.primary.small', { onclick: publishFlow, title: publishTip() }, publishWord())
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

  const inspector = h('aside.inspector', { 'aria-label': 'Settings panel' },
    h('div.insp-resize', {
      role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the settings panel', tabindex: '0',
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

  // Below 1400px the outline is an overlay drawer; above it, a column that can
  // collapse. Same button, same mental model, different mechanism.
  let outlineBtn = null, inspBtn = null
  const outlineIsDrawer = () => matchMedia('(max-width: 1400px)').matches
  function toggleOutline(force) {
    const drawer = outlineIsDrawer()
    const on = force ?? !(drawer ? outlineEl.classList.contains('open') : outlineOpen)
    if (drawer) {
      outlineEl.classList.toggle('open', on)
    } else {
      outlineOpen = on
      setDisclosure('outline', on)
      outlineEl.classList.toggle('closed', !on)
    }
    outlineBtn?.setAttribute('aria-pressed', String(on))
    outlineBtn?.classList.toggle('on', on)
    paintOverlayNote()
    setTimeout(paintScale, 260)
  }
  /**
   * The inspector's one toggle. There used to be three ways to hide it. Below
   * 1100px the inspector is an overlay driven by `insp-open`, so the same
   * button has to speak that mechanism too.
   */
  const inspIsOverlay = () => matchMedia('(max-width: 1100px)').matches
  const inspShowing = () => {
    const app2 = document.querySelector('.app')
    return inspIsOverlay() ? !!app2?.classList.contains('insp-open') : !app2?.classList.contains('insp-hidden')
  }
  function setInspHidden(hidden) {
    const app2 = document.querySelector('.app')
    if (!app2) return
    if (inspIsOverlay()) {
      app2.classList.remove('insp-hidden')
      app2.classList.toggle('insp-open', !hidden)
    } else {
      app2.classList.toggle('insp-hidden', hidden)
      app2.classList.remove('insp-open')
      setPref('inspHidden', hidden)
    }
    paintInspBtn()
    setTimeout(paintScale, 260)
  }
  function paintInspBtn() {
    const on = inspShowing()
    inspBtn?.setAttribute('aria-pressed', String(on))
    inspBtn?.classList.toggle('on', on)
    paintOverlayNote()
  }

  // On a narrow window the two panels are fixed overlays sitting ON the page
  // rather than beside it, and nothing on screen said so — a 1280px page in a
  // 168px strip (R9-2b). A thin caption at the top of the canvas says it, and
  // closes the panel.
  const overlayNoteText = h('span', {})
  const overlayNote = h('div.canvas-overlay-note', { hidden: true, role: 'status' },
    overlayNoteText,
    h('button.linkish.canvas-overlay-close', {
      onclick: () => { toggleOutline(false); setInspHidden(true) },
    }, 'Close'))

  function paintOverlayNote() {
    if (!matchMedia('(max-width: 1100px)').matches) { overlayNote.hidden = true; return }
    const outOpen = outlineEl.classList.contains('open')
    const inspOpen = inspShowing()
    const names = [outOpen ? 'Outline' : '', inspOpen ? 'Settings panel' : ''].filter(Boolean)
    if (!names.length) { overlayNote.hidden = true; return }
    overlayNote.hidden = false
    overlayNoteText.textContent = names.length === 2
      ? 'The Outline and the Settings panel are floating over the page — close them to see the whole page.'
      : `The ${names[0]} is floating over the page — close it to see the whole page.`
  }
  // Crossing the breakpoint must not strand the panel in the other mode's state.
  const onOutlineBp = () => {
    if (outlineIsDrawer()) { outlineEl.classList.remove('closed') }
    else { outlineEl.classList.remove('open'); outlineEl.classList.toggle('closed', !outlineOpen) }
    const on = outlineIsDrawer() ? outlineEl.classList.contains('open') : outlineOpen
    outlineBtn?.setAttribute('aria-pressed', String(on))
    outlineBtn?.classList.toggle('on', on)
    paintOverlayNote()
  }
  addEventListener('resize', onOutlineBp)
  addEventListener('resize', paintInspBtn)
  // The button's initial state must describe the mode it is actually in: in
  // drawer mode the outline starts closed whatever the wide-mode pref says.
  queueMicrotask(onOutlineBp)
  queueMicrotask(paintInspBtn)

  // The save state now says where a saved copy went: a clock beside "Saved"
  // opens the list of restore points, which used to be buried under the Page tab.
  const restoreBtn = h('button.icon-btn.restore-btn', {
    title: `Restore points for this ${typeName}`, 'aria-label': `Restore points for this ${typeName}`,
    onclick: () => dialog({
      title: `Restore points for this ${typeName}`,
      width: 'min(32rem, 94vw)',
      body: h('div', {},
        h('p.dlg-text', {}, sc('A restore point is kept every time you press Save (⌘S) or publish.')),
        versionsPanel()),
      actions: [{ label: 'Close', onClick: () => true }],
    }),
  }, iconEl('clock', 13))

  const backTo = peekReturn()
  // The toolbar spans the whole editor — outline, canvas and inspector — rather
  // than sitting in the canvas column. Squeezed between two panels it had about
  // 14 characters for the title ("Car Parking & …"); across the window it has
  // the room the title needs.
  const editorEl = h('div.editor', {},
      h('div.editor-top', {},
        h('span.editor-top-group', {},
          h('button.icon-btn', {
            title: backTo ? `Back to ${backTo.label}` : 'Back', 'aria-label': backTo ? `Back to ${backTo.label}` : 'Back',
            onclick: () => { const r = popReturn(); location.hash = r ? r.hash : `#/c/${doc.concept}` },
          }, iconEl('back', 16))),
        h('span.editor-top-group.grow', {}, titleInput, statusHolder, saveState, restoreBtn),
        h('span.editor-top-group', {},
          h('span.top-sep', { 'aria-hidden': 'true' }),
          deviceSeg,
          scaleHolder,
          helpBtn,
          // Two panel toggles, each saying what it controls. There used to be
          // three overlapping ways to hide a panel plus a drawer button.
          outlineBtn = h('button.icon-btn.panel-btn', {
            title: 'Outline', 'aria-label': 'Outline',
            'aria-pressed': String(outlineOpen),
            class: outlineOpen ? 'on' : '',
            onclick: () => toggleOutline(),
          }, iconEl('list', 15), h('span.panel-btn-label', {}, 'Outline')),
          inspBtn = h('button.icon-btn.panel-btn', {
            title: 'Settings panel', 'aria-label': 'Settings panel',
            'aria-pressed': String(!prefs().inspHidden),
            class: prefs().inspHidden ? '' : 'on',
            onclick: () => setInspHidden(inspShowing()),
          }, iconEl('columns', 15), h('span.panel-btn-label', {}, 'Settings panel')),
          h('span.top-sep', { 'aria-hidden': 'true' }),
          actionsHolder)),
    outlineEl,
    h('div.editor-mid', {}, overlayNote, previewWrap),
    inspector)

  if (prefs().inspW) root.style.setProperty('--insp-w', prefs().inspW)
  const appEl = document.querySelector('.app')
  appEl?.classList.toggle('insp-left', !!prefs().inspLeft)
  appEl?.classList.toggle('insp-hidden', !!prefs().inspHidden)
  // Below 1100px both panels are overlays over the page, so the editor opens
  // with both closed: the page is what the screen is for (R9-2b). A remembered
  // choice still applies at the widths where the panels are real columns.
  if (matchMedia('(max-width: 1100px)').matches) {
    appEl?.classList.remove('insp-open')
    outlineEl.classList.remove('open')
  }
  queueMicrotask(paintOverlayNote)
  // While you are editing one document the site-wide rail is not the job — it
  // goes to icons (so you keep your bearings) and the pixels go to the page.
  // A full rail cost the canvas ~190px, which showed the page at 49%.
  const railWasOpen = !appEl?.classList.contains('side-collapsed')
  appEl?.classList.add('side-collapsed')
  hooks.paintNav?.()   // so the rail's own control reads "Expand", not "Collapse"
  // Watching your navigation shrink with no explanation is unsettling. Say it
  // once, on this device, and say how to undo it.
  if (railWasOpen) {
    let told = false
    try { told = localStorage.getItem('blockhouse-rail-shrink-told') === '1' } catch {}
    if (!told) {
      toast(sc('The sidebar is shrunk while you edit so the page gets more room. Press ⌘B or the arrow at the bottom to bring it back.'), 'info', 5000)
      try { localStorage.setItem('blockhouse-rail-shrink-told', '1') } catch {}
    }
  }
  root.replaceChildren(editorEl)
  // fit only once the holder is actually in the document — measuring a
  // detached element gives 0 and the preview never gets scaled at all
  fitForDevice(prefs().device || '')
  paintSaveState('saved', readOnly ? 'Read only' : 'Saved')
  // Opening a document used to select nothing, so the inspector said "Nothing
  // selected" on a page full of blocks. Start on the first top-level block.
  if (!selectedId && doc.blocks[0]) selectedId = doc.blocks[0].id, multi.add(selectedId)
  if (!doc.blocks.length && !tabParam) inspTab = 'page'
  renderStatus(); renderActions(); renderTree(); renderInspector()

  // ---------- preview bridge ----------

  addEventListener('message', onBridgeMsg)
  function onBridgeMsg(e) {
    const m = e.data || {}
    if (m.blockhouse === 'select' && m.id) selectBlock(m.id, { fromPreview: true })
    if (m.blockhouse === 'ready' && selectedId) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id: selectedId }, '*')
    if (m.blockhouse === 'needsreload') refreshPreviewSoon()
    if (m.blockhouse === 'provenance') onProvenance(m)

    if (m.blockhouse === 'editstart') {
      snapshotOnce(m.field ? 'Edit fields' : 'Edit text')
      suppressPreview = true
    }
    if (m.blockhouse === 'edit' && m.id && m.prop) {
      const found = ops.find(m.id)
      if (found) {
        // `prop` may be a path — `tiles.2.title` is the third tile's title.
        setPath(found.node.props, m.prop, m.value)
        dirty = true
        paintSaveState('', 'Unsaved…')
        scheduleSave()
      }
    }
    // Words the template printed from this page's own details, typed straight
    // on the page. Same save and undo path as a block edit.
    if (m.blockhouse === 'fieldedit' && m.key) {
      if (readOnly) return
      if (m.key === 'doc.title') {
        doc.title = m.value
        titleInput.value = m.value
        dirty = true
        paintSaveState('', 'Unsaved…')
        scheduleSave()
        return
      }
      doc.fields ??= {}
      setPath(doc.fields, m.key, m.value)
      dirty = true
      paintSaveState('', 'Unsaved…')
      scheduleSave()
    }
    if (m.blockhouse === 'editend') {
      suppressPreview = false
      renderInspector()
      renderTree()
    }

    // Single click on a content field printed by the template: open the Page
    // tab with that field found and flashing.
    if (m.blockhouse === 'field' && m.key) {
      // The page's name lives in the toolbar, not in the inspector.
      if (m.key === 'doc.title') {
        titleInput.scrollIntoView({ block: 'center', behavior: 'smooth' })
        titleInput.classList.remove('field-flash'); void titleInput.offsetWidth
        titleInput.classList.add('field-flash')
        titleInput.focus({ preventScroll: true })
      } else focusField(m.key, 'page')
    }

    // Click on a picture: the block is already selected, now show the field
    // that chooses the picture.
    if (m.blockhouse === 'focusprop' && m.prop) {
      if (m.id && selectedId !== m.id) selectBlock(m.id, { fromPreview: true })
      focusField(m.prop, 'block')
    }

    // A header or footer block — on every page, not this one.
    if (m.blockhouse === 'slotblock' && m.slot) {
      if (meta.perms.settings) quickChrome(m.slot, () => refreshPreview(), m.blockId || '')
      else toast('The header and footer are managed in Settings', 'err')
    }

    // The bridge says WHERE relative to a block; the tree lives here, so this
    // is where "before/after/inside" becomes a parent and an index. ops.move
    // already refuses a move into the dragged block's own descendants.
    if (m.blockhouse === 'blockdrop' && m.id && m.target) {
      const tgt = ops.find(m.target)
      if (!tgt) return
      if (m.where === 'inside') {
        if (ops.move(m.id, m.target, 0)) selectBlock(m.id)
        return
      }
      // NOT ops.siteFor — that means "insert after this" and redirects into an
      // empty container. A drop needs the target's own slot among its siblings.
      const parentId = tgt.parents.length ? tgt.parents[tgt.parents.length - 1].id : ''
      const at = tgt.siblings.indexOf(tgt.node) + (m.where === 'after' ? 1 : 0)
      if (ops.move(m.id, parentId, at)) selectBlock(m.id)
      return
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

  async function onProvenance(m) {
    const opts = []
    const seen = new Set()
    const add = (label2, icon2, go, hint) => { if (!seen.has(label2)) { seen.add(label2); opts.push({ label: label2, icon: icon2, go, hint }) } }

    // Every route offered below has to land on a real screen with the promised
    // thing on it. Which header/footer areas exist depends on the template, and
    // so does whether it has its own header file to edit, so both are looked up
    // rather than guessed. An option that cannot land is not offered.
    const wantsChrome = (m.options || []).some(o => o.kind === 'header' || o.kind === 'footer')
    let chrome = null
    let tplFiles = []
    if (wantsChrome && meta.perms.settings) {
      chrome = await get('/chrome').catch(() => null)
      tplFiles = await get('/templates/tree').then(r => r.files || []).catch(() => [])
    }
    /** The area of the header/footer worth opening: the one with content in it. */
    const slotFor = kind => {
      const keys = (chrome?.discovered || []).map(d => d.key).filter(k => k.startsWith(kind + '.'))
      if (!keys.length) return null
      return keys.slice().sort((a, b) =>
        ((chrome.slots?.[b] || []).length) - ((chrome.slots?.[a] || []).length))[0]
    }

    for (const o of m.options || []) {
      if (o.kind === 'menu' && meta.perms.menus) {
        const mm = meta.menus.find(x => x.key === o.key)
        add(`Edit the “${mm?.label || o.key}” links`, 'menu', () => quickMenu(o.key, () => refreshPreview()), 'Here, without leaving this page')
        add('Open the menu studio', 'external', () => goTo(`#/menus/${o.key}`), 'Structure, mega panels and live preview')
      }
      if ((o.kind === 'header' || o.kind === 'footer') && meta.perms.settings) {
        const slot = slotFor(o.kind)
        if (slot) {
          add(`Edit the ${o.kind} text`, 'layout', () => quickChrome(slot, () => refreshPreview()), 'Here, without leaving this page')
          add(`Open the full ${o.kind} editor`, 'external', () => goTo(`#/chrome/${encodeURIComponent(slot)}`), 'Add, remove and reorder blocks')
        }
        const rel = `partials/${o.kind}.liquid`
        if (tplFiles.some(f => f.rel === rel)) {
          add(`Edit the ${o.kind} template`, 'code', () => goTo(`#/tpl/${encodeURIComponent(rel)}`), 'The structure — a safe override, the built-in file is untouched')
        }
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
        h('p.dlg-text.mb-3', {}, opts.length > 1 ? 'This is controlled in more than one place — pick where to edit:'
          : opts.length ? 'Edit it here:'
          : 'These words are part of the page design, not something stored as content — so there is nothing here to type into. You can:'),
        h('div.stack-1', {},
          ...(opts.length ? opts : fallbackOptions())
            .map(o => h('button.row-item.bd-line.rad-s.p-3-3', { onclick: () => { if (o.go) { dlg.closeWith(); o.go() } } },
              h('span.row-ico', { html: icon(o.icon, 16) }),
              h('div.ta-l', {},
                h('div.fw-semi.text-m', {}, o.label),
                o.hint ? h('div.fnt.text-xs', {}, o.hint) : ''))))),
    })
  }

  /**
   * Nothing on this page controls what was clicked: it is part of the template's
   * own markup. Say so in words, and still offer somewhere to go — a dead end
   * with no way out was the thing people complained about most.
   */
  function fallbackOptions() {
    const out = []
    if (meta.perms.settings) {
      out.push({
        label: 'Edit the template code (for developers)', icon: 'code',
        hint: 'This wording is written into the page design, not stored as content. Editing it needs HTML.',
        go: () => goTo('#/tpl'),
      })
    }
    out.push({
      label: 'Ask about this in Help', icon: 'help',
      hint: 'What comes from content and what comes from the design, in plain English.',
      go: () => goTo('#/help/content'),
    })
    if (!out.length) {
      out.push({ label: 'This is part of the page design', icon: 'info', go: null, hint: 'It is not content you can change here. Ask an administrator.' })
    }
    return out
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
    // Escape dismisses the topmost floating layer first. Below 1100px the
    // settings panel and the outline sit ON the page — the canvas caption
    // calls them floating — and Escape closes a floating layer everywhere
    // else in the studio. A dialog, sheet or the palette above them keeps
    // Escape for itself; with nothing floating, Escape falls through to
    // selecting the parent block (and to the shell's wide-mode exit).
    if (e.key === 'Escape' && !document.querySelector('dialog[open], .sheet.open')) {
      if (inspIsOverlay() && inspShowing()) { e.preventDefault(); return setInspHidden(true) }
      if (outlineIsDrawer() && matchMedia('(max-width: 1100px)').matches
        && outlineEl.classList.contains('open')) { e.preventDefault(); return toggleOutline(false) }
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return save(true) }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); return doUndo() }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); return doRedo() }
    if (isTyping(e)) return
    if (mod && e.key === 'Enter') { e.preventDefault(); const s = ops.siteFor(selectedId); return addBlock(s.parentId, s.index) }
    // Paste is the one block action that means something with nothing selected:
    // it appends to the end of the page. It used to fall through this gate and
    // do nothing at all — no toast, no change, no explanation.
    if (!selectedId && mod && e.key.toLowerCase() === 'v') {
      e.preventDefault(); return pasteFrom('', doc.blocks.length)
    }
    if (!selectedId) return
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return bulkDuplicate() }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); return bulkCopy() }
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); await bulkCopy(true); return bulkRemove() }
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
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return bulkRemove() }
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
    if (railWasOpen) { appEl?.classList.remove('side-collapsed'); hooks.paintNav?.() }
    appEl?.classList.remove('insp-hidden')
    removeEventListener('bh:wide', onWide)
    removeEventListener('resize', onOutlineBp)
    removeEventListener('resize', paintInspBtn)
    removeEventListener('message', onBridgeMsg)
    removeEventListener('keydown', onKey)
    removeEventListener('resize', onResize)
    removeEventListener('beforeunload', beforeUnload)
    previewRO.disconnect()
    disposeCommands()
    disposeGuard()
    hooks.addBlockByType = null
    scheduleSave.cancel()
    if (dirty) save(false)
  }
})
