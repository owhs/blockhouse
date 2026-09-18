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
    role: 'dialog', 'aria-modal': 'false', 'aria-label': title,
    style: width ? { width } : {},
  },
    h('header.sheet-head', {},
      h('div', {}, h('h2', {}, title), sub ? h('p.sub', {}, sub) : ''),
      h('button.icon-btn', { 'aria-label': 'Close panel', onclick: () => closeSheet() }, iconEl('x', 15))),
    holder)

  document.body.append(scrim, panel)
  requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in') })

  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet() } }
  panel.addEventListener('keydown', onKey)

  open = {
    panel, scrim, onClose,
    dispose: () => { panel.removeEventListener('keydown', onKey); opener?.isConnected && opener.focus() },
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
