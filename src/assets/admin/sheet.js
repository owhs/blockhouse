// The side sheet: bring the control to the person, instead of routing the
// person to the control.
//
// Anything that used to mean "leave this document, go to Design, change the
// accent, come back and find your place again" can instead open beside the work
// you were already doing, with your preview still live and still yours.

import { h } from './ui.js'
import { iconEl } from './icons.js'

let open = null

/**
 * openSheet({ title, sub, body, onClose, width })
 * `body` may be a node or an async function returning one.
 */
export async function openSheet({ title, sub, body, onClose, width }) {
  closeSheet()
  const opener = document.activeElement

  const scrim = h('div.sheet-scrim', { onclick: () => closeSheet() })
  const holder = h('div.sheet-body')
  const panel = h('aside.sheet', {
    // it traps Tab and marks the rest of the app inert, so it IS modal
    role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    style: width ? { width } : {},
  },
    h('header.sheet-head', {},
      h('div', {}, h('h2', {}, title), sub ? h('p.sub', {}, sub) : ''),
      h('button.icon-btn', { 'aria-label': 'Close panel', onclick: () => closeSheet() }, iconEl('x', 15))),
    holder)

  document.body.append(scrim, panel)
  // A forced reflow starts the transition reliably. requestAnimationFrame does
  // not run in a background tab, so the panel could stay parked off-screen.
  void panel.offsetWidth
  scrim.classList.add('in'); panel.classList.add('in')

  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); return }
    // The sheet is a dialog with a scrim, so Tab must not walk out of it into
    // the page it is covering. <dialog> gets this for free; this does not.
    if (e.key !== 'Tab') return
    const f = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null || el === document.activeElement)
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  panel.addEventListener('keydown', onKey)
  // anything behind the scrim is unreachable while the sheet is open
  const appEl = document.querySelector('.app')
  if (appEl) appEl.inert = true

  open = {
    panel, scrim, onClose,
    dispose: () => {
      panel.removeEventListener('keydown', onKey)
      if (appEl) appEl.inert = false
      opener?.isConnected && opener.focus()
    },
  }

  holder.replaceChildren(typeof body === 'function' ? await body() : body)
  panel.querySelector('input, button, select, textarea, [tabindex]')?.focus()
  return { close: closeSheet, body: holder }
}

export function closeSheet() {
  if (!open) return
  const { panel, scrim, onClose, dispose } = open
  open = null
  panel.classList.remove('in')
  scrim.classList.remove('in')
  setTimeout(() => { panel.remove(); scrim.remove() }, 260)
  dispose()
  onClose?.()
}

export const sheetIsOpen = () => !!open
