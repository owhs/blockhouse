// Tiny UI kit: h() DOM builder, dialogs, toasts, context menus, command palette,
// drag-to-reorder helper. No framework, no build step.

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.')
  const el = document.createElement(name || 'div')
  if (classes.length) el.className = classes.join(' ')
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className += (el.className ? ' ' : '') + v
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'html') el.innerHTML = v
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...[children].flat(9).filter(c => c != null && c !== false).map(c => (typeof c === 'string' || typeof c === 'number') ? document.createTextNode(c) : c))
  return el
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

let toastHolder
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHolder) { toastHolder = h('div.toasts'); document.body.appendChild(toastHolder) }
  const t = h('div.toast', { class: kind }, message)
  toastHolder.appendChild(t)
  requestAnimationFrame(() => t.classList.add('in'))
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250) }, ms)
}

// ---------- dialogs ----------

export function dialog({ title, body, actions = [], width, onClose, headerExtra }) {
  // Each call appends a fresh native <dialog> and calls showModal() on it —
  // nothing closed the previous one first. Two dialogs opened in quick
  // succession (e.g. clicking a second content link before dismissing the
  // first "what is this" popup) stacked as two separate top-layer elements;
  // only the newest reliably receives clicks, so buttons on the older one
  // could look present but do nothing when pressed.
  document.querySelectorAll('dialog.dlg[open]').forEach(d => { try { d.close() } catch {} d.remove() })

  const dlg = h('dialog.dlg', { style: width ? { width } : {} })
  const close = val => { dlg.close(); dlg.remove(); onClose?.(val) }
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(undefined) })
  dlg.addEventListener('mousedown', e => { if (e.target === dlg) close(undefined) })
  const actionBtns = actions.map(a =>
    h(`button.btn.${a.kind || 'ghost'}`, {
      type: 'button',
      onclick: async () => {
        const r = await a.onClick?.(dlg)
        if (r !== false) close(r)
      },
    }, a.label))
  dlg.append(
    h('header.dlg-head', {}, h('h2', {}, title), headerExtra || '', h('button.icon-btn', { onclick: () => close(undefined), 'aria-label': 'Close', html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
    h('div.dlg-body', {}, body),
    actions.length ? h('footer.dlg-foot', {}, ...actionBtns) : '',
  )
  document.body.appendChild(dlg)
  dlg.showModal()
  dlg.closeWith = close
  return dlg
}

export function confirmDialog(title, message, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    dialog({
      title, body: h('p.dlg-text', {}, message),
      actions: [
        { label: 'Cancel', onClick: () => false && resolve(false) },
        { label: confirmLabel, kind: 'danger', onClick: () => { resolve(true); return true } },
      ],
      onClose: v => { if (v === undefined) resolve(false) },
    })
  })
}

// ---------- context menu ----------

export function contextMenu(x, y, items) {
  document.querySelector('.ctx-menu')?.remove()
  const menu = h('div.ctx-menu', { style: { left: x + 'px', top: y + 'px' } },
    items.map(it => it === '-' ? h('hr') :
      h('button', { class: it.danger ? 'danger' : '', onclick: () => { menu.remove(); it.onClick() } },
        it.icon ? h('span.ctx-ico', { html: it.icon.startsWith?.('<') ? it.icon : undefined }, it.icon.startsWith?.('<') ? '' : it.icon) : '', it.label)))
  document.body.appendChild(menu)
  const r = menu.getBoundingClientRect()
  if (r.right > innerWidth) menu.style.left = (x - r.width) + 'px'
  if (r.bottom > innerHeight) menu.style.top = (y - r.height) + 'px'
  const off = e => { if (!menu.contains(e.target)) { menu.remove(); removeEventListener('mousedown', off) } }
  setTimeout(() => addEventListener('mousedown', off), 0)
}

// ---------- command palette ----------

export function palette(commands) {
  const input = h('input.pal-input', { placeholder: 'Type a command or search…', autofocus: true })
  const list = h('div.pal-list')
  let filtered = [], active = 0

  const render = () => {
    const q = input.value.toLowerCase().trim()
    filtered = commands()
      .map(c => ({ ...c, score: score(c.label.toLowerCase(), q) }))
      .filter(c => c.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
    active = Math.min(active, Math.max(0, filtered.length - 1))
    list.replaceChildren(...filtered.map((c, i) =>
      h('button.pal-item', { class: i === active ? 'active' : '', onclick: () => run(c) },
        c.icon?.startsWith?.('<') ? h('span.pal-ico', { html: c.icon }) : h('span.pal-ico', {}, c.icon || '›'),
        h('span', {}, c.label),
        c.hint ? h('span.pal-hint', {}, c.hint) : '')))
  }
  const run = c => { dlg.closeWith?.(); c.onRun() }
  const dlg = dialog({ title: '', body: [input, list], width: 'min(34rem, 92vw)' })
  dlg.classList.add('pal')
  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render() }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render() }
    if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); run(filtered[active]) }
  })
  render()
}

function score(label, q) {
  if (!q) return 1
  if (label.includes(q)) return 100 - label.indexOf(q)
  let li = 0, s = 0
  for (const ch of q) {
    const idx = label.indexOf(ch, li)
    if (idx === -1) return -1
    s += 10 - Math.min(9, idx - li)
    li = idx + 1
  }
  return s
}

// ---------- drag to reorder ----------
// makeSortable(container, { handle, onMove(fromIndex, toIndex) })

export function makeSortable(container, opts = {}) {
  let dragEl = null, fromIndex = -1
  container.addEventListener('dragstart', e => {
    const item = e.target.closest('[draggable]')
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

export function emptyState(iconOrHtml, title, text, action) {
  const ico = String(iconOrHtml).startsWith('<')
    ? h('div.empty-ico', { html: iconOrHtml })
    : h('div.empty-ico', { style: { fontSize: '1.6rem' } }, iconOrHtml)
  return h('div.empty', {}, ico, h('h3', {}, title), text ? h('p', {}, text) : '', action || '')
}

export function spinner() { return h('div.spin') }


/**
 * Render a site preview iframe at real desktop width and scale it to fit its
 * holder — otherwise a ~900px pane triggers the site's mobile breakpoint and
 * you preview the wrong layout. Returns a disposer.
 */
export function fitPreviewFrame(holder, iframe, targetWidth = 1280) {
  const fit = () => {
    const w = holder.clientWidth, hgt = holder.clientHeight
    if (!w || !hgt) return
    if (!targetWidth || w >= targetWidth) {
      iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.transform = ''
      return
    }
    const scale = w / targetWidth
    iframe.style.width = `${targetWidth}px`
    iframe.style.height = `${Math.round(hgt / scale)}px`
    iframe.style.transform = `scale(${scale})`
    iframe.style.transformOrigin = 'top left'
  }
  const ro = new ResizeObserver(fit)
  ro.observe(holder)
  requestAnimationFrame(fit)
  return () => ro.disconnect()
}
