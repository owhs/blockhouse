// Site chrome — the content that lives around every page: header announcement,
// after-nav extras, footer rows. These are template *slots* filled with blocks
// (site.slots in site.json); this view is where that content is edited, with a
// live preview so "that link in the footer" is never a mystery again.

import { get, put } from './api.js'
import { h, dialog, confirmDialog, toast, emptyState, fitPreviewFrame, unsavedDialog } from './ui.js'
import { registerView, state, registerGuard } from './state.js'
import { icon, iconEl } from './icons.js'
import { renderFields } from './fields.js'

const NICE = {
  'header.announce': ['Announcement bar', 'A strip above the header — offers, notices, launch banners'],
  'header.after': ['Below the header', 'Rendered directly under the navigation on every page'],
  'footer.before': ['Above the footer', 'A band that sits just before the footer — CTAs live well here'],
  'footer.social': ['Footer links & social', 'The small print row — social links, RSS, credits'],
}

registerView('chrome', async (root, [slotParam]) => {
  const meta = state.meta
  const byType = Object.fromEntries(meta.blocks.map(b => [b.type, b]))
  let { slots, discovered } = await get('/chrome')
  let active = slotParam ? decodeURIComponent(slotParam) : (discovered[0]?.key || 'footer.social')
  let dirty = false

  const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  // ---------- preview ----------
  const iframe = h('iframe', { src: '/?__blockhousepreview=1', title: 'Site preview', style: { pointerEvents: 'none' } })
  const holder = h('div.preview-frame-holder', {}, iframe)
  const previewWrap = h('div.preview-wrap', { style: { minHeight: '16rem' } }, holder)
  const unfit = fitPreviewFrame(holder, iframe, 1280)
  const reloadPreview = () => { iframe.contentWindow?.location.reload() }

  // ---------- slot list ----------
  const slotList = h('div.panel-body')
  const paintSlots = () => {
    slotList.replaceChildren(...discovered.map(d => {
      const [label] = NICE[d.key] || [d.key]
      const n = (slots[d.key] || []).length
      return h('button.row-item', { class: d.key === active ? 'active' : '', onclick: () => { active = d.key; paint() } },
        h('span.row-ico', { html: icon(d.key.startsWith('header') ? 'layout' : 'menu', 14) }),
        h('span.row-label', {}, label),
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
    const [label, hint] = NICE[active] || [active, `Rendered wherever the template puts {% slot '${active}' %}`]
    const rows = list.map((node, i) => {
      const def = byType[node.type] || { label: node.type, fields: [] }
      const open = h('div.card', { style: { padding: 'var(--s4)', marginTop: 'var(--s2)' } },
        def.fields?.length
          ? renderFields(def.fields, node.props ||= {}, () => mark())
          : h('p.mut', {}, 'This block has no options.'))
      open.hidden = true
      return h('div', { style: { marginBottom: 'var(--s2)' } },
        h('div.mrow', {},
          h('span.row-ico', { html: icon(def.icon || 'block', 15) }),
          h('button', { style: { flex: 1, cursor: 'pointer', textAlign: 'left', fontWeight: 'var(--fw-semi)' }, 'aria-expanded': 'false', onclick: e => { open.hidden = !open.hidden; e.currentTarget.setAttribute('aria-expanded', String(!open.hidden)) } }, def.label || node.type),
          h('span.mrow-tools', {},
            h('button.icon-btn', { title: 'Move up', 'aria-label': 'Move this block up', onclick: () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; mark(); paintBlocks() } } }, iconEl('up', 13)),
            h('button.icon-btn', { title: 'Move down', 'aria-label': 'Move this block down', onclick: () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; mark(); paintBlocks() } } }, iconEl('down', 13)),
            h('button.icon-btn', { title: 'Edit', 'aria-label': 'Edit this block', onclick: () => (open.hidden = !open.hidden) }, iconEl('pen', 13)),
            h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove this block', onclick: async () => { if (await confirmDialog('Remove block', `Remove this ${def.label || node.type}?`, 'Remove')) { list.splice(i, 1); mark(); paintBlocks() } } }, iconEl('trash', 13)))),
        open)
    })
    blocksEl.replaceChildren(
      h('div.page-head', { style: { marginBottom: 'var(--s2)' } },
        h('div', {}, h('strong', {}, label), h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, hint)),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost.small', { onclick: addBlock }, iconEl('plus', 13), 'Add block'), saveBtn)),
      rows.length ? h('div', {}, ...rows)
        : emptyState(icon('layout', 24), 'Nothing here yet', 'This slot is empty — the template renders nothing for it. Add a block to fill it.'))
  }

  const addBlock = () => {
    const groups = {}
    for (const b of meta.blocks) (groups[b.group || 'Other'] ??= []).push(b)
    const body = h('div')
    const dlg = dialog({ title: 'Add a block', width: 'min(44rem, 94vw)', body })
    for (const [g, defs] of Object.entries(groups)) {
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))', gap: 'var(--s2)' } })
      for (const def of defs) {
        grid.appendChild(h('button.row-item', {
          style: { border: '1px solid var(--line)', borderRadius: 'var(--r-s)', padding: 'var(--s2) var(--s3)' },
          onclick: () => {
            ;(slots[active] ??= []).push({ id: uid(), type: def.type, props: JSON.parse(JSON.stringify(def.defaults || {})) })
            mark(); paintBlocks(); dlg.closeWith()
          },
        },
          h('span.row-ico', { html: icon(def.icon || 'block', 15) }),
          h('div', { style: { textAlign: 'left' } },
            h('div', { style: { fontWeight: 'var(--fw-semi)', fontSize: 'var(--t-m)' } }, def.label),
            h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, def.description || ''))))
      }
      body.append(h('div.insp-section-title', { style: { marginTop: 'var(--s3)' } }, g), grid)
    }
  }

  const paint = () => { paintSlots(); paintBlocks() }

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Header & footer'),
        h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, 'slots')),
      slotList),
    h('div.main', { style: { display: 'grid', gridTemplateRows: 'auto 1fr', gap: 'var(--s4)', padding: 'var(--s4)' } },
      h('div', {}, blocksEl),
      h('div', {},
        h('p.fnt', { style: { fontSize: 'var(--t-s)', margin: '0 0 var(--s2)' } },
          'Live preview — saves apply to every page. The header and footer *structure* is a template file (Site → Templates); this is the content poured into it.'),
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
