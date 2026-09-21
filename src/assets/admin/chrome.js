// Site chrome — the content that lives around every page: header announcement,
// after-nav extras, footer rows. These are template *slots* filled with blocks
// (site.slots in site.json); this view is where that content is edited, with a
// live preview so "that link in the footer" is never a mystery again.

import { get, put } from './api.js'
import { h, dialog, confirmDialog, toast, emptyState, fitPreviewFrame, unsavedDialog } from './ui.js'
import { registerView, state, registerGuard } from './state.js'
import { helpButton } from './help.js'
import { icon, iconEl } from './icons.js'
import { renderFields } from './fields.js'
import { labelOf } from './docops.js'

const NICE = {
  'header.announce': ['Announcement bar', 'A strip above the menu — offers, notices, opening hours'],
  'header.after': ['Below the menu', 'Shown directly under the menu on every page'],
  'footer.before': ['Above the footer', 'A band just before the footer — a good place for a call to action'],
  'footer.columns': ['Footer columns', 'The link columns at the bottom of every page'],
  'footer.social': ['Footer links & social', 'The small print row — social links, feed links, credits'],
}

// Any spot a template invents gets a readable name too: "footer.columns-b"
// becomes "Footer · Columns b". A raw key is never shown.
const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1)
const niceOf = key => NICE[key] || [
  key.split('.').map(part => titleCase(part.replace(/-/g, ' '))).join(' · '),
  'A spot the template leaves for your content',
]

/**
 * A one-line summary of what a block holds. `labelOf` covers the usual text
 * props; a footer column keeps its links in an array, so fall back to the
 * first one's label.
 */
function summaryOf(node, def, kind) {
  const direct = labelOf(node, def)
  if (direct && direct !== kind && direct !== node.type) return direct
  for (const v of Object.values(node.props || {})) {
    if (!Array.isArray(v)) continue
    for (const item of v) {
      const t = String(item?.label || item?.title || item?.text || item?.link?.label || '').trim()
      if (t) return t
    }
  }
  return ''
}

registerView('chrome', async (root, [slotParam]) => {
  const meta = state.meta
  const byType = Object.fromEntries(meta.blocks.map(b => [b.type, b]))
  let { slots, discovered } = await get('/chrome')
  let active = slotParam ? decodeURIComponent(slotParam) : (discovered[0]?.key || 'footer.social')
  let dirty = false

  const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  // ---------- preview ----------
  const iframe = h('iframe.no-pointer', { src: '/?__blockhousepreview=1', title: 'Site preview' })
  const holder = h('div.preview-frame-holder', {}, iframe)
  const previewWrap = h('div.preview-wrap.minh-16', {}, holder)
  const unfit = fitPreviewFrame(holder, iframe, 1280)
  const reloadPreview = () => { iframe.contentWindow?.location.reload() }

  // ---------- slot list ----------
  const slotList = h('div.panel-body')
  const paintSlots = () => {
    slotList.replaceChildren(...discovered.map(d => {
      const [label, hint] = niceOf(d.key)
      const n = (slots[d.key] || []).length
      return h('button.row-item.chrome-slot-row', { class: d.key === active ? 'active' : '', onclick: () => { active = d.key; paint() } },
        h('span.row-ico', { html: icon(d.key.startsWith('header') ? 'layout' : 'menu', 14) }),
        h('span.chrome-slot-text', {}, h('span.row-label', {}, label), h('span.chrome-slot-hint', {}, hint)),
        n ? h('span.mrow-tag', {}, String(n)) : '')
    }))
  }

  // ---------- block editor for the active slot ----------
  const blocksEl = h('div')
  const save = async () => {
    await put('/chrome', { slots })
    dirty = false
    saveBtn.textContent = 'Saved ✓'; setTimeout(() => (saveBtn.textContent = 'Save'), 1400)
    reloadPreview()
  }
  const saveBtn = h('button.btn.primary.small', { onclick: save }, 'Save')
  const mark = () => { dirty = true; saveBtn.textContent = 'Save •' }

  const paintBlocks = () => {
    const list = slots[active] || []
    const [label, hint] = niceOf(active)
    const rows = list.map((node, i) => {
      const def = byType[node.type] || { label: node.type, fields: [] }
      // What is actually in this block — "Footer column" three times over told
      // you nothing about which one you were opening.
      const kind = def.label || node.type
      const summary = summaryOf(node, def, kind)
      const open = h('div.card.p-4.mt-2', {},
        def.fields?.length
          ? renderFields(def.fields, node.props ||= {}, () => mark())
          : h('p.mut', {}, 'This block has no options.'))
      open.hidden = true
      return h('div.mb-2', {},
        h('div.mrow', {},
          h('span.row-ico', { html: icon(def.icon || 'block', 15) }),
          h('button.chrome-block-btn', {
            'aria-expanded': 'false',
            onclick: e => { open.hidden = !open.hidden; e.currentTarget.setAttribute('aria-expanded', String(!open.hidden)) },
          },
            h('span.chrome-block-kind', {}, kind),
            summary ? h('span.chrome-block-sum', {}, summary) : ''),
          h('span.mrow-tools', {},
            h('button.icon-btn', { title: 'Move up', 'aria-label': 'Move this block up', onclick: () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; mark(); paintBlocks() } } }, iconEl('up', 13)),
            h('button.icon-btn', { title: 'Move down', 'aria-label': 'Move this block down', onclick: () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; mark(); paintBlocks() } } }, iconEl('down', 13)),
            h('button.icon-btn', { title: 'Remove', 'aria-label': `Remove this ${kind}`, onclick: async () => { if (await confirmDialog('Remove this?', `Remove the ${kind}${summary ? ` “${summary}”` : ''} from every page?`, 'Remove')) { list.splice(i, 1); mark(); paintBlocks() } } }, iconEl('trash', 13)))),
        open)
    })
    blocksEl.replaceChildren(
      h('div.page-head.mb-2', {},
        h('div', {}, h('strong', {}, label), h('p.fnt.text-s', {}, hint)),
        h('div.d-flex.gap-2', {},
          h('button.btn.ghost.small', { onclick: addBlock }, iconEl('plus', 13), 'Add block'), saveBtn)),
      rows.length ? h('div', {}, ...rows)
        : emptyState(icon('layout', 24), 'Nothing here yet', 'Nothing shows in this spot at the moment. Add something to fill it.'))
  }

  const addBlock = () => {
    const groups = {}
    for (const b of meta.blocks) (groups[b.group || 'Other'] ??= []).push(b)
    const body = h('div')
    const dlg = dialog({ title: 'Add a block', width: 'min(44rem, 94vw)', body })
    for (const [g, defs] of Object.entries(groups)) {
      const grid = h('div.chrome-slot-grid', {})
      for (const def of defs) {
        grid.appendChild(h('button.row-item.bd-line.rad-s.p-2-3', { onclick: () => {
            ;(slots[active] ??= []).push({ id: uid(), type: def.type, props: JSON.parse(JSON.stringify(def.defaults || {})) })
            mark(); paintBlocks(); dlg.closeWith()
          } },
          h('span.row-ico', { html: icon(def.icon || 'block', 15) }),
          h('div.ta-l', {},
            h('div.fw-semi.text-m', {}, def.label),
            h('div.fnt.text-xs', {}, def.description || ''))))
      }
      body.append(h('div.insp-section-title.mt-3', {}, g), grid)
    }
  }

  const paint = () => { paintSlots(); paintBlocks() }

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Header & footer')),
      slotList),
    h('div.main.chrome-main', {},
      h('div.page-head.chrome-head', {},
        h('div', {}, h('h1', {}, 'Header & footer'),
          h('p.sub', {}, 'Text and links that appear on every page. The layout itself comes from the template.')),
        helpButton('chrome', 'Header & footer')),
      h('div', {}, blocksEl),
      h('div', {},
        h('p.fnt.chrome-preview-label', {}, 'Preview — every page shares this'),
        previewWrap)))
  )
  paint()

  // Removing a footer block and wandering off used to ship it to every page.
  const disposeGuard = registerGuard('chrome', async () => {
    if (!dirty) return true
    return await unsavedDialog({
      title: 'Unsaved header & footer changes',
      body: 'These are not live yet. Saving puts them on every page straight away.',
      saveLabel: 'Save to every page',
      onSave: save,
    })
  })
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)
  return () => { unfit(); disposeGuard(); removeEventListener('beforeunload', beforeUnload) }
})
