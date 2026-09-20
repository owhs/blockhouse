// Tiny UI kit: h() DOM builder, dialogs, toasts, context menus, drag-to-reorder
// (flat and tree), skeletons. No framework, no build step.

import { icon } from './icons.js'

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.')
  const el = document.createElement(name || 'div')
  if (classes.length) el.className = classes.join(' ')
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className += (el.className ? ' ' : '') + v
    else if (k === 'dataset') Object.assign(el.dataset, v)
    // Object.assign ignores custom properties (`--x`), so a data-driven colour
    // handed in as a variable silently did nothing. Set those the long way.
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv)
        else el.style[sk] = sv
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'html') el.innerHTML = v
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...[children].flat(9).filter(c => c != null && c !== false).map(c => (typeof c === 'string' || typeof c === 'number') ? document.createTextNode(c) : c))
  return el
}

// ---------- keyboard shortcut labels ----------
// Every handler already accepts metaKey OR ctrlKey, but the *labels* were
// written in Mac glyphs only, so Windows users were told to press a key their
// keyboard does not have. Author shortcuts in the Mac form and pass them
// through sc(); on other platforms they render as Ctrl/Alt/Shift/Enter.
export const IS_MAC = /mac|iphone|ipad|ipod/i.test(
  navigator.userAgentData?.platform || navigator.platform || navigator.userAgent)

const KEYS = { '⏎': 'Enter', '⌫': 'Backspace', '⎋': 'Esc', '←': 'Left', '↑': 'Up', '→': 'Right', '↓': 'Down' }
const MODS = { '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Ctrl' }
const ORDER = ['Ctrl', 'Alt', 'Shift'] // the order Windows and Linux write them in

/** Format a shortcut label for this platform. sc('⇧⌘Z') -> 'Ctrl+Shift+Z' off Mac. */
export function sc(label) {
  if (IS_MAC || !label) return label
  // Only the modifier glyphs reorder; everything else keeps its position, so
  // labels like '⌘K / ⌘B' and 'Ctrl+Space' survive unchanged.
  return String(label).replace(/[⌘⌥⇧⌃]+[^\s/·]*/g, run => {
    const mods = []
    let rest = ''
    for (const ch of run) {
      if (MODS[ch]) { if (!mods.includes(MODS[ch])) mods.push(MODS[ch]) }
      else rest += KEYS[ch] ?? ch
    }
    mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    return [...mods, rest].filter(Boolean).join('+')
  })
}

export function debounce(fn, ms) {
  let t
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
  wrapped.now = (...a) => { clearTimeout(t); fn(...a) }
  wrapped.cancel = () => clearTimeout(t)
  return wrapped
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const diff = (now - d) / 1000
  if (diff < 90) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

// ---------- toasts ----------
// One live region so a screen reader hears what everyone else sees. Errors stay
// until dismissed — a failure that vanishes in 3 seconds is a failure nobody
// can act on.

let toastHolder, alertHolder
const TOAST_ICON = { ok: 'check', err: 'warn', info: 'info' }

/**
 * Two regions, created up front: a screen reader only announces content that
 * lands in a live region that already existed, so creating it lazily loses the
 * first message. Failures go in an assertive region so they interrupt.
 */
function ensureToasts(kind) {
  if (!toastHolder) {
    toastHolder = h('div.toasts', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' })
    alertHolder = h('div.toasts.toasts-alert', { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'false' })
    document.body.append(toastHolder, alertHolder)
  }
  return kind === 'err' ? alertHolder : toastHolder
}
// exist before anything needs them
if (typeof document !== 'undefined') {
  if (document.body) ensureToasts()
  else addEventListener('DOMContentLoaded', () => ensureToasts())
}

/**
 * toast('Saved', 'ok')
 * toast('Deleted Hero', 'info', { action: { label: 'Undo', onClick } })
 */
export function toast(message, kind = 'info', opts = 3200) {
  const o = typeof opts === 'number' ? { ms: opts } : (opts || {})
  const ms = o.ms ?? (kind === 'err' ? 0 : 3200)   // 0 = stays until dismissed
  const holder = ensureToasts(kind)

  // never let a burst of uploads bury the screen
  while (holder.children.length >= 3) holder.firstElementChild.remove()

  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 220) }
  const t = h('div.toast', { class: kind },
    h('span.toast-ico', { html: icon(TOAST_ICON[kind] || 'info', 14) }),
    h('span.toast-msg', {}, message),
    o.action ? h('button.toast-action', {
      onclick: () => { close(); o.action.onClick() },
    }, o.action.label) : '',
    h('button.toast-x', { 'aria-label': 'Dismiss', onclick: close, html: icon('x', 12) }))
  holder.appendChild(t)
  void t.offsetWidth
  t.classList.add('in')
  if (ms > 0) setTimeout(close, ms)
  return { close, el: t, set text(v) { t.querySelector('.toast-msg').textContent = v } }
}

/** Destructive action + a way back. The pattern every delete should use. */
export function undoToast(what, onUndo) {
  return toast(what, 'info', { ms: 7000, action: { label: 'Undo', onClick: onUndo } })
}

// ---------- dialogs ----------
// Dialogs STACK. Closing the top one reveals the one beneath, and focus returns
// to whatever opened it. The previous implementation destroyed every open
// dialog before showing a new one, so a background autosave conflict could
// silently eat the form you were filling in.

const dlgStack = []

/**
 * The "you have unsaved work" question, asked once, in one place.
 *
 * This existed as six hand-written copies and five of them got it wrong: they
 * used a two-button confirm and then returned `true` no matter which button was
 * pressed, so Cancel discarded the work and navigated anyway. The dialog asked
 * "save or discard?" and silently discarded on either answer but Save.
 *
 * Leaving must be a three-way choice, because it genuinely is one. Resolves
 * true to let the navigation through, false to stay put. Not dismissable:
 * clicking the backdrop must not decide the fate of someone's work.
 */
export function unsavedDialog({ title, body, saveLabel, onSave, stayLabel = 'Keep editing', discardLabel = 'Discard changes' }) {
  return new Promise(resolve => {
    dialog({
      title, dismissable: false,
      body: typeof body === 'string' ? h('p.dlg-text', {}, body) : body,
      actions: [
        { label: stayLabel, onClick: () => { resolve(false); return true } },
        { label: discardLabel, kind: 'danger', onClick: () => { resolve(true); return true } },
        {
          label: saveLabel, kind: 'primary', onClick: async () => {
            try { await onSave() } catch { resolve(false); return true }
            resolve(true); return true
          },
        },
      ],
    })
  })
}

export function dialog({ title, body, actions = [], width, onClose, headerExtra, dismissable = true, guard = false }) {
  const opener = document.activeElement
  const dlg = h('dialog.dlg', { style: width ? { width } : {} })
  if (title) dlg.setAttribute('aria-label', title)

  const close = val => {
    const i = dlgStack.indexOf(dlg)
    if (i >= 0) dlgStack.splice(i, 1)
    dlg.classList.add('closing')
    try { dlg.close() } catch {}
    setTimeout(() => dlg.remove(), 200)
    onClose?.(val)
    // restore focus to whatever opened this, or to the dialog now on top
    const top = dlgStack[dlgStack.length - 1]
    if (top) top.querySelector('input, button, [tabindex]')?.focus()
    else if (opener?.isConnected) opener.focus()
  }

  // Dismissing a dialog you have typed into used to throw the input away with
  // no warning: the X, the backdrop and Escape all went straight to close().
  // A dialog now knows whether it holds work, and asks before discarding it.
  // A search box is not work: typing "hero" into the block picker's filter used
  // to make the dialog think it held unsaved input, so Escape asked "Discard
  // what you typed?" instead of closing. Filters opt out with .pal-input.
  const fieldsOf = () => [...dlg.querySelectorAll('input:not([type=hidden]):not(.pal-input), textarea, select')]
  let openSnapshot = null
  const snapshotFields = () => fieldsOf().map(f => (f.type === 'checkbox' || f.type === 'radio') ? String(f.checked) : f.value).join(String.fromCharCode(31))
  const hasWork = () => openSnapshot !== null && snapshotFields() !== openSnapshot
  async function tryDismiss() {
    if (!dismissable) return
    if (!hasWork()) return close(undefined)
    const discard = await confirmDialog('Discard what you typed?',
      'This form has changes that have not been used yet. Closing loses them.', 'Discard')
    if (discard) close(undefined)
  }
  dlg.addEventListener('cancel', e => { e.preventDefault(); tryDismiss() })
  // Escape has to reach the dialog even from inside a field whose own keydown
  // handler runs first (the block picker's filter, the palette's input).
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !dismissable) return
    e.preventDefault(); e.stopPropagation()
    tryDismiss()
  })
  dlg.addEventListener('mousedown', e => { if (e.target === dlg) tryDismiss() })

  // focus trap — Tab must not escape into the page behind the modal
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return
    const f = [...dlg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null || el === document.activeElement)
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })

  // Async actions get a busy state for free — no more double-clicking Publish.
  const actionBtns = actions.map(a =>
    h(`button.btn.${a.kind || 'ghost'}`, {
      type: 'button',
      onclick: async ev => {
        const btn = ev.currentTarget
        if (btn.dataset.busy) return
        btn.dataset.busy = '1'
        btn.classList.add('busy')
        try {
          const r = await a.onClick?.(dlg)
          if (r !== false) close(r)
        } finally {
          delete btn.dataset.busy
          btn.classList.remove('busy')
        }
      },
    }, a.label))

  const dlgBody = h('div.dlg-body', {}, body)
  dlg.append(
    title || headerExtra || dismissable
      ? h('header.dlg-head', {}, h('h2', {}, title || ''), headerExtra || '',
        dismissable ? h('button.icon-btn', { onclick: () => tryDismiss(), 'aria-label': 'Close', html: icon('x', 14) }) : '')
      : '',
    dlgBody,
    actions.length ? h('footer.dlg-foot', {}, ...actionBtns) : '',
  )
  document.body.appendChild(dlg)
  // A dialog that is part of deciding whether a navigation happens at all (the
  // "you have unsaved work" question, the conflict warning) must survive the
  // route change it is asking about. Everything else belongs to the screen it
  // was opened from and is closed when you leave that screen — see
  // closeOpenDialogs().
  if (!dismissable || guard) dlg.dataset.guard = '1'
  dlgStack.push(dlg)
  dlg.showModal()
  // showModal() lands on the first focusable element, which is the header's
  // Close (×) — so every dialog opened on "close this". Focus the first thing
  // in the body you can actually use, else the primary action, never Close.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  const firstInBody = dlgBody.querySelector(FOCUSABLE)
  // A question about losing work must not land on the answer that loses it:
  // Enter on a guard dialog has to mean "keep my work", so focus the first
  // action that is not the destructive one (Cancel / Keep editing).
  const safeBtn = actionBtns.find((_, i) => (actions[i].kind || '') !== 'danger')
  const primaryBtn = actionBtns.find((_, i) => (actions[i].kind || '') === 'primary' || (actions[i].kind || '') === 'danger')
    || actionBtns[actionBtns.length - 1]
  const landing = guard ? (safeBtn || primaryBtn) : (firstInBody || primaryBtn)
  if (landing) landing.focus({ preventScroll: true })
  else { dlg.tabIndex = -1; dlg.focus({ preventScroll: true }) }
  openSnapshot = snapshotFields()
  void dlg.offsetWidth   // see sheet.js: rAF does not run in a background tab
  dlg.classList.add('in')
  dlg.closeWith = close
  return dlg
}

/**
 * Shut every dialog that belongs to the screen you are leaving.
 *
 * A modal left open across a route change sits over an unrelated screen with a
 * Save button for a person you are no longer looking at. Called by the router
 * on every hash change, before it paints the new view.
 */
export function closeOpenDialogs() {
  for (const dlg of [...dlgStack]) {
    if (dlg.dataset.guard === '1') continue
    try { dlg.closeWith?.(undefined) } catch {}
  }
}

export function confirmDialog(title, message, confirmLabel = 'Delete', { guard = false } = {}) {
  return new Promise(resolve => {
    dialog({
      title, guard, body: typeof message === 'string' ? h('p.dlg-text', {}, message) : message,
      actions: [
        // Returning true closes the dialog; the old code returned false, which
        // told dialog() to stay open, so Cancel did nothing at all.
        { label: 'Cancel', onClick: () => { resolve(false); return true } },
        { label: confirmLabel, kind: 'danger', onClick: () => { resolve(true); return true } },
      ],
      onClose: v => { if (v === undefined) resolve(false) },
    })
  })
}

/** A text prompt that looks like the rest of the studio. Replaces window.prompt. */
export function promptDialog({ title, label, value = '', placeholder = '', help, confirmLabel = 'Save', datalist }) {
  return new Promise(resolve => {
    const listId = datalist?.length ? 'pl-' + Math.random().toString(36).slice(2, 7) : null
    const input = h('input.input', { value, placeholder, ...(listId ? { list: listId } : {}) })
    const body = h('div', {},
      h('div.field', {}, h('label', {}, label), input,
        help ? h('span.help', {}, help) : ''),
      listId ? h('datalist', { id: listId }, ...datalist.map(v => h('option', { value: v }))) : '')
    const dlg = dialog({
      title, body,
      actions: [
        { label: 'Cancel', onClick: () => { resolve(null); return true } },
        { label: confirmLabel, kind: 'primary', onClick: () => { resolve(input.value); return true } },
      ],
      onClose: v => { if (v === undefined) resolve(null) },
    })
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); resolve(input.value); dlg.closeWith(true) }
    })
    setTimeout(() => { input.focus(); input.select() }, 30)
  })
}

// ---------- context menu ----------

export function contextMenu(x, y, items) {
  document.querySelector('.ctx-menu')?.remove()
  const menu = h('div.ctx-menu', { role: 'menu', style: { left: x + 'px', top: y + 'px' } },
    items.filter(Boolean).map(it => it === '-' ? h('hr') :
      h('button', {
        role: 'menuitem', class: it.danger ? 'danger' : '', disabled: !!it.disabled,
        title: it.hint || '',
        onclick: () => { menu.remove(); it.onClick() },
      },
        it.icon ? h('span.ctx-ico', { html: it.icon }) : h('span.ctx-ico'),
        h('span.grow', {}, it.label),
        it.shortcut ? h('span.kbd', {}, it.shortcut) : '')))
  document.body.appendChild(menu)
  const r = menu.getBoundingClientRect()
  if (r.right > innerWidth) menu.style.left = Math.max(4, x - r.width) + 'px'
  if (r.bottom > innerHeight) menu.style.top = Math.max(4, y - r.height) + 'px'
  menu.querySelector('button:not([disabled])')?.focus()
  const off = e => { if (!menu.contains(e.target)) { menu.remove(); removeEventListener('mousedown', off) } }
  const esc = e => { if (e.key === 'Escape') { menu.remove(); removeEventListener('keydown', esc) } }
  setTimeout(() => { addEventListener('mousedown', off); addEventListener('keydown', esc) }, 0)
  return menu
}

// ---------- drag to reorder (flat lists) ----------
// makeSortable(container, { handle, onMove(fromIndex, toIndex) })
//
// Rows may be wrapped in a positioning element — walk up to the direct child of
// the container rather than demanding the draggable BE the direct child. That
// requirement silently disabled every drag in the editor's block tree.

export function makeSortable(container, opts = {}) {
  let dragEl = null, fromIndex = -1
  const directChild = el => {
    while (el && el.parentElement !== container) el = el.parentElement
    return el
  }
  container.addEventListener('pointerdown', e => {
    if (!opts.handle) return
    const item = e.target.closest('[draggable]')
    if (!item) return
    // with a handle, only the handle starts a drag — so text stays selectable
    item.draggable = !!e.target.closest(opts.handle)
  })
  container.addEventListener('dragstart', e => {
    const item = directChild(e.target.closest('[draggable]'))
    if (!item || item.parentElement !== container) return
    dragEl = item
    fromIndex = [...container.children].indexOf(item)
    item.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', '') } catch {}
  })
  container.addEventListener('dragover', e => {
    if (!dragEl) return
    e.preventDefault()
    const after = [...container.children].filter(c => c !== dragEl).find(c => {
      const r = c.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    if (after) container.insertBefore(dragEl, after)
    else container.appendChild(dragEl)
  })
  container.addEventListener('dragend', () => {
    if (!dragEl) return
    dragEl.classList.remove('dragging')
    const toIndex = [...container.children].indexOf(dragEl)
    if (toIndex !== fromIndex && toIndex >= 0) opts.onMove?.(fromIndex, toIndex)
    dragEl = null
  })
}

// ---------- drag to reorder (nested trees) ----------
/**
 * makeTreeSortable(root, { onMove(id, parentId, index), canDrop(id, parentId) })
 *
 * Rows opt in with data-node-id, data-parent-id and data-index; container rows
 * add data-container="1" so a drop in the middle of them means "inside".
 * A single delegated handler means a block can be dragged from one container to
 * another — which flat per-level sortables can never do.
 */
export function makeTreeSortable(root, { onMove, canDrop = () => true } = {}) {
  let dragId = null, drop = null
  const line = h('div.drop-line')

  const rows = () => [...root.querySelectorAll('[data-node-id]')]

  const clear = () => { line.remove(); root.querySelectorAll('.drop-into').forEach(el => el.classList.remove('drop-into')) }

  root.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-node-id]')
    if (!row) return
    dragId = row.dataset.nodeId
    row.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', dragId) } catch {}
  })

  root.addEventListener('dragover', e => {
    if (!dragId) return
    e.preventDefault()
    const row = e.target.closest('[data-node-id]')
    clear()
    drop = null
    if (!row) return
    // never drop a node into itself or its own descendants
    const ancestors = (row.dataset.ancestors || '').split(' ').filter(Boolean)
    if (row.dataset.nodeId === dragId || ancestors.includes(dragId)) return

    const r = row.getBoundingClientRect()
    const rel = (e.clientY - r.top) / r.height
    const isContainer = row.dataset.container === '1'
    let cand
    if (isContainer && rel > 0.3 && rel < 0.7) {
      cand = { parentId: row.dataset.nodeId, index: 0, into: row }
    } else {
      cand = {
        parentId: row.dataset.parentId || '',
        index: Number(row.dataset.index) + (rel > 0.5 ? 1 : 0),
      }
    }
    if (!canDrop(dragId, cand.parentId)) return
    drop = cand
    if (cand.into) cand.into.classList.add('drop-into')
    else {
      row.parentElement.insertBefore(line, rel > 0.5 ? row.nextSibling : row)
    }
  })

  root.addEventListener('drop', e => {
    if (!dragId || !drop) return
    e.preventDefault()
    onMove?.(dragId, drop.parentId, drop.index)
  })

  root.addEventListener('dragend', () => {
    rows().forEach(r => r.classList.remove('dragging'))
    clear()
    dragId = null; drop = null
  })
}

export function emptyState(iconOrHtml, title, text, action) {
  const ico = String(iconOrHtml).startsWith('<')
    ? h('div.empty-ico', { html: iconOrHtml })
    : h('div.empty-ico.text-3xl', {}, iconOrHtml)
  return h('div.empty', {}, ico, h('h3', {}, title), text ? h('p', {}, text) : '', action || '')
}

export function spinner() { return h('div.spin') }

// ---------- skeletons ----------
// When the shape of what is coming is known, show the shape. A centred spinner
// tells you nothing; a skeleton tells you what you are waiting for.

export function skeleton(kind = 'rows', n = 6) {
  if (kind === 'cards') return h('div.sk-cards', {}, ...Array.from({ length: n }, () => h('div.sk.sk-card')))
  if (kind === 'grid') return h('div.sk-grid', {}, ...Array.from({ length: n }, () => h('div.sk.sk-tile')))
  if (kind === 'form') return h('div.sk-form', {}, ...Array.from({ length: n }, () => h('div', {}, h('div.sk.sk-lbl'), h('div.sk.sk-inp'))))
  return h('div.sk-rows', {}, ...Array.from({ length: n }, () => h('div.sk.sk-row')))
}

/**
 * Render a site preview iframe at real desktop width and scale it to fit its
 * holder — otherwise a ~900px pane triggers the site's mobile breakpoint and
 * you preview the wrong layout. Returns a disposer.
 */
export function fitPreviewFrame(holder, iframe, targetWidth = 1280, onFit) {
  const fit = () => {
    const w = holder.clientWidth, hgt = holder.clientHeight
    if (!w || !hgt) return
    if (!targetWidth || w >= targetWidth) {
      iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.transform = ''
      holder.dataset.scale = ''
      onFit?.(100)
      return
    }
    const scale = w / targetWidth
    iframe.style.width = `${targetWidth}px`
    iframe.style.height = `${Math.round(hgt / scale)}px`
    iframe.style.transform = `scale(${scale})`
    iframe.style.transformOrigin = 'top left'
    // surfaced so the editor can say when the preview is too small to judge
    holder.dataset.scale = String(Math.round(scale * 100))
    onFit?.(Math.round(scale * 100))
  }
  const ro = new ResizeObserver(fit)
  ro.observe(holder)
  requestAnimationFrame(fit)
  return () => ro.disconnect()
}
