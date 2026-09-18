// Template files — a real IDE for the theme, safely layered. Every save writes
// a copy to site/overrides/<file>; the built-in template is never touched and
// Revert is one click. Ships syntax highlighting, liquid intellisense, colour
// swatches, beautify, snippets, a cross-reference panel ("who includes this,
// which slots does it render"), and a live preview of UNSAVED edits.

import { get, put, del, post } from './api.js'
import { h, debounce, confirmDialog, toast, emptyState, fitPreviewFrame } from './ui.js'
import { registerView, state } from './state.js'
import { icon, iconEl } from './icons.js'
import { codeEditor, LIQUID } from './ide.js'

const GROUP_ORDER = ['layout', 'pages', 'partials', 'blocks', 'assets', 'other']
const groupOf = rel =>
  rel === 'layout.liquid' ? 'layout'
    : rel.startsWith('pages/') ? 'pages'
      : rel.startsWith('partials/') ? 'partials'
        : rel.startsWith('blocks/') ? 'blocks'
          : rel.startsWith('assets/') ? 'assets' : 'other'

const SNIPPETS = [
  ['Region (block area)', "{% region 'content' %}", 'Documents pour their blocks into regions'],
  ['Menu', "{% menu 'main' %}", 'Renders a menu with the full nav runtime'],
  ['Slot (site chrome)', "{% slot 'footer.social' %}", 'Filled under Site → Header & footer'],
  ['Include partial', "{% include 'partials/header' %}", ''],
  ['If a field is set', "{% if fields.cover %}\n\n{% endif %}", ''],
  ['Feature guard', "{% if features.rss %}\n\n{% endif %}", 'Only render when the feature is on'],
  ['Loop documents', "{% for d in docs %}\n  <a href=\"{{ d | docpath }}\">{{ d.title }}</a>\n{% endfor %}", 'List templates'],
  ['Responsive image', "{{ fields.cover | img: width: 1200 }}", 'Generates <picture> with srcset'],
  ['Markdown output', "{{ props.text | md }}", ''],
  ['Formatted date', "{{ doc.publishedAt | date: '%b %e, %Y' }}", ''],
]

registerView('templates', async (root, [relParam]) => {
  let { template, files } = await get('/templates/tree')
  let refs = null
  get('/templates/refs').then(r => { refs = r; paintRefs() }).catch(() => {})
  let activeRel = relParam ? decodeURIComponent(relParam) : (files.find(f => f.rel === 'layout.liquid')?.rel || files[0]?.rel)
  let current = null
  let dirty = false

  const meta = state.meta
  const context = {
    partials: [],
    menus: (meta.menus || []).map(m => [m.key, m.label || m.key]),
    slots: ['header.announce', 'header.after', 'footer.before', 'footer.social'],
    fieldsByConcept: Object.fromEntries((meta.concepts || []).map(c => [c.name, (c.fields || []).map(f => f.key)])),
    cssVars: [],
  }

  // ---------- editor ----------
  const pushDraft = debounce(async () => {
    if (!current) return
    await put('/templates/draft', { rel: current.rel, content: editor.value }).catch(() => {})
    if (previewOn) reloadPreview()
  }, 600)

  const editor = codeEditor({
    rel: 'layout.liquid',
    value: '',
    context,
    onChange: () => { dirty = true; saveBtn.textContent = 'Save •'; pushDraft() },
    onSave: () => doSave(),
  })

  // ---------- preview pane ----------
  let previewOn = false
  const pvFrame = h('iframe', { title: 'Draft preview', style: { pointerEvents: 'none' } })
  const pvHolder = h('div.preview-frame-holder', {}, pvFrame)
  const pvWrap = h('div.preview-wrap.tpl-preview', { hidden: true }, pvHolder)
  let unfit = null
  let pvPath = '/'
  const reloadPreview = () => { pvFrame.src = `${pvPath}?__tplpreview=1&__t=${Date.now() % 1e7}` }
  const pvToggle = h('button.btn.ghost.small', {
    onclick: () => {
      previewOn = !previewOn
      pvWrap.hidden = !previewOn
      shell.classList.toggle('with-preview', previewOn)
      pvToggle.classList.toggle('primary', previewOn)
      if (previewOn) { unfit ??= fitPreviewFrame(pvHolder, pvFrame, 1280); pushDraft.now?.(); reloadPreview() }
    },
  }, iconEl('eye', 13), 'Preview')
  const pvPathSel = h('select.input', {
    style: { width: 'auto', padding: '0.2rem 1.6rem 0.2rem 0.5rem', fontSize: 'var(--t-s)' },
    onchange: e => { pvPath = e.target.value; if (previewOn) reloadPreview() },
  }, h('option', { value: '/' }, 'Home'))
  get('/content').then(({ docs }) => {
    for (const d of docs.filter(d2 => d2.status === 'published' && d2.path && d2.path !== '/').slice(0, 20))
      pvPathSel.appendChild(h('option', { value: d.path }, d.path))
  }).catch(() => {})

  // ---------- reference drawer ----------
  const refPanel = h('div.tpl-refs', { hidden: true })
  const refBtn = h('button.btn.ghost.small', {
    onclick: () => { refPanel.hidden = !refPanel.hidden; refBtn.classList.toggle('primary', !refPanel.hidden); paintRefs() },
  }, iconEl('book', 13), 'Reference')

  function paintRefs() {
    if (refPanel.hidden) return
    const info = refs?.files?.[current?.rel]
    const list = (title, items, fmt) => items?.length
      ? h('div', { style: { marginBottom: '0.6rem' } }, h('div.insp-section-title', {}, title),
        ...items.map(x => fmt(x)))
      : ''
    const link = rel2 => h('button.row-item', { onclick: () => openFile(rel2), style: { padding: '0.25rem 0.4rem' } },
      h('span.row-ico', { html: icon('page', 12) }), h('span.row-label', { style: { fontSize: 'var(--t-s)' } }, rel2))
    refPanel.replaceChildren(
      h('div.insp-section-title', {}, 'This file'),
      info ? h('div', { style: { marginBottom: '0.6rem' } },
        list('Includes', info.includes, link),
        list('Included by', info.includedBy, link),
        list('Slots it renders', info.slots, s => h('button.row-item', { style: { padding: '0.25rem 0.4rem' }, onclick: () => (location.hash = `#/chrome/${encodeURIComponent(s)}`) }, h('span.row-ico', { html: icon('layout', 12) }), h('span.row-label', { style: { fontSize: 'var(--t-s)' } }, `${s} → edit content`))),
        list('Menus it renders', info.menus, m => h('button.row-item', { style: { padding: '0.25rem 0.4rem' }, onclick: () => (location.hash = `#/menus/${m}`) }, h('span.row-ico', { html: icon('menu', 12) }), h('span.row-label', { style: { fontSize: 'var(--t-s)' } }, `${m} → edit menu`))),
        list('Regions', info.regions, r => h('span.pill-perm', { style: { marginRight: '0.3rem' } }, r)),
      ) : h('p.mut', {}, 'No cross-reference data for this file.'),
      h('div.insp-section-title', {}, 'Variables'),
      ...LIQUID.variables.map(([v, d]) => h('div.tpl-refrow', {}, h('code.pill-perm', {}, v), h('span', {}, d))),
      h('div.insp-section-title', { style: { marginTop: '0.6rem' } }, 'Filters'),
      ...LIQUID.filters.slice(0, 18).map(([f, d]) => h('div.tpl-refrow', {}, h('code.pill-perm', {}, `| ${f}`), h('span', {}, d))),
    )
  }

  // ---------- snippets ----------
  const snipBtn = h('button.btn.ghost.small', {
    onclick: e => {
      const menu = h('div.mbar-drop', { style: { display: 'block', position: 'fixed', zIndex: 200 } },
        ...SNIPPETS.map(([label, code, hint]) => h('button.mbar-item', {
          onclick: () => { editor.insert(code); menu.remove() },
        }, h('div', {}, h('div', { style: { fontWeight: 'var(--fw-semi)' } }, label), hint ? h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, hint) : ''))))
      const r = e.currentTarget.getBoundingClientRect()
      menu.style.left = `${Math.max(8, r.right - 280)}px`; menu.style.top = `${r.bottom + 4}px`; menu.style.minWidth = '17rem'
      document.body.appendChild(menu)
      setTimeout(() => addEventListener('mousedown', function off(ev) { if (!menu.contains(ev.target)) { menu.remove(); removeEventListener('mousedown', off) } }), 0)
    },
  }, iconEl('sparkle', 13), 'Snippets')

  // ---------- save / revert / status ----------
  const statusChip = h('span.mrow-tag')
  const saveBtn = h('button.btn.primary.small', { onclick: () => doSave() }, 'Save')
  const revertBtn = h('button.btn.ghost.small', {
    onclick: async () => {
      if (!(await confirmDialog('Revert to the original?', 'Your override is deleted; the built-in file takes over again.', 'Revert'))) return
      await del(`/templates/file?rel=${encodeURIComponent(current.rel)}`)
      toast('Reverted — the built-in file is live again', 'ok')
      await reload(); openFile(current.rel)
    },
  }, iconEl('undo', 13), 'Revert')
  const fmtBtn = h('button.btn.ghost.small', { title: 'Beautify (⇧⌥F)', onclick: () => editor.beautify() }, iconEl('wand', 13), 'Format')

  async function doSave() {
    await put('/templates/file', { rel: current.rel, content: editor.value })
    dirty = false
    saveBtn.textContent = 'Saved ✓'
    setTimeout(() => (saveBtn.textContent = 'Save'), 1400)
    current.overridden = true
    await del('/templates/draft').catch(() => {})
    paintStatus(); paintTree()
    if (previewOn) reloadPreview()
  }

  async function reload() { ;({ template, files } = await get('/templates/tree')) }

  const paintStatus = () => {
    statusChip.textContent = current?.overridden ? 'overridden' : 'built-in'
    statusChip.style.background = current?.overridden ? 'color-mix(in oklch, var(--warn) 20%, transparent)' : ''
    revertBtn.style.display = current?.overridden ? '' : 'none'
  }

  async function openFile(rel) {
    if (dirty && !(await confirmDialog('Unsaved changes', 'This file has changes you have not saved. Switch files and discard them?', 'Discard'))) return
    await del('/templates/draft').catch(() => {})
    activeRel = rel
    current = await get(`/templates/file?rel=${encodeURIComponent(rel)}`)
    editor.setLang(rel)
    editor.value = current.content
    dirty = false
    saveBtn.textContent = 'Save'
    paintStatus(); paintTree(); paintRefs()
    crumbs.textContent = `${template} / ${rel}`
    if (/\.css$/.test(rel)) {
      // harvest --tokens for var() completion
      context.cssVars = [...new Set([...current.content.matchAll(/--[a-zA-Z0-9-]+/g)].map(m => m[0]))]
    }
    if (previewOn) { pushDraft.now?.(); reloadPreview() }
  }

  const crumbs = h('code', { style: { fontSize: 'var(--t-s)' } })

  const treeEl = h('div.panel-body')
  function paintTree() {
    const groups = new Map()
    for (const f of files) {
      const g = groupOf(f.rel)
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(f)
    }
    context.partials = files.filter(f => f.rel.startsWith('partials/')).map(f => f.rel)
    treeEl.replaceChildren(...GROUP_ORDER.filter(g => groups.has(g)).flatMap(g => [
      h('div.side-title', {}, h('span', {}, g)),
      ...groups.get(g).map(f => h('button.row-item', {
        class: f.rel === activeRel ? 'active' : '',
        onclick: () => openFile(f.rel),
      },
        h('span.row-ico', { html: icon(f.rel.endsWith('.css') ? 'palette' : f.rel.endsWith('.js') ? 'code' : 'page', 14) }),
        h('span.row-label', {}, f.rel.split('/').pop()),
        f.overridden ? h('span.mrow-tag', { title: 'Edited — your override is live' }, '✎') : '')),
    ]))
  }

  const shell = h('div.tpl-shell', {},
    h('div.tpl-bar', {},
      crumbs, statusChip,
      h('span', { style: { flex: 1 } }),
      pvPathSel, pvToggle, refBtn, snipBtn, fmtBtn,
      revertBtn, saveBtn),
    h('div.tpl-main', {},
      h('div.tpl-editcol', {}, editor.el),
      pvWrap,
      refPanel))

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Template files'),
        h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, template)),
      treeEl),
    h('div.main', {}, shell)))

  paintTree()
  if (activeRel) openFile(activeRel)
  else root.querySelector('.tpl-main')?.replaceChildren(emptyState(icon('code', 26), 'No editable files', ''))

  return () => {
    unfit?.()
    del('/templates/draft').catch(() => {})
    if (dirty) doSave()
  }
})
