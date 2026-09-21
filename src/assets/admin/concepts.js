// Content Types — create and shape your own document types (products, projects,
// docs, recipes…) without touching JSON. This is the answer to "why is it just
// pages and posts": it never was; this screen is where the rest get made.

import { get, put, del, post } from './api.js'
import { h, dialog, confirmDialog, toast, emptyState } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state } from './state.js'
import { icon, iconEl } from './icons.js'
import { refreshMeta, conceptIcon } from './state.js'

const TYPE_ICONS = ['page', 'pen', 'tag', 'folder', 'book', 'star', 'image', 'video', 'calendar', 'cart', 'building', 'globe', 'help', 'quote', 'mountain', 'form']
// The raw glyph key ("pen", "chevD") is a developer's word. A picker button
// has to say what the picture is, on screen readers as well as on hover.
const ICON_NAMES = {
  page: 'Page', pen: 'Pen', tag: 'Tag', folder: 'Folder', book: 'Book', star: 'Star',
  image: 'Picture', video: 'Video', calendar: 'Calendar', cart: 'Shopping basket',
  building: 'Building', globe: 'Globe', help: 'Question mark', quote: 'Quote marks',
  mountain: 'Mountain', form: 'Form',
}
const iconName = k => ICON_NAMES[k] || k

const FIELD_TYPES = [
  { value: 'text', label: 'Text — single line' },
  { value: 'textarea', label: 'Text — multi line' },
  { value: 'richtext', label: 'Rich text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Toggle' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice (dropdown)' },
  { value: 'image', label: 'Image' },
  { value: 'link', label: 'Link (page or URL)' },
  { value: 'color', label: 'Colour' },
]

const PRESETS = {
  blank: { fields: [] },
  article: {
    indexed: true,
    fields: [
      { key: 'lede', type: 'textarea', label: 'Lede', help: 'One-sentence summary shown in lists' },
      { key: 'cover', type: 'image', label: 'Cover image' },
    ],
  },
  product: {
    indexed: true,
    fields: [
      { key: 'price', type: 'text', label: 'Price', help: 'e.g. £49 or “From £2,400”' },
      { key: 'sku', type: 'text', label: 'SKU / reference', width: 'half' },
      { key: 'available', type: 'boolean', label: 'Available', default: true, width: 'half' },
      { key: 'cover', type: 'image', label: 'Product image' },
      { key: 'gallery', type: 'textarea', label: 'Notes' },
    ],
  },
  project: {
    indexed: true,
    fields: [
      { key: 'client', type: 'text', label: 'Client', width: 'half' },
      { key: 'year', type: 'text', label: 'Year', width: 'half' },
      { key: 'lede', type: 'textarea', label: 'Summary' },
      { key: 'cover', type: 'image', label: 'Cover image' },
    ],
  },
}

registerView('concepts', async (root, [typeName]) => {
  let { concepts, counts } = await get('/concepts')
  let active = concepts.find(cc => cc.name === typeName) || concepts[0] || null
  let dirty = false

  const listEl = h('div.panel-body')
  const mainEl = h('div.main-pad.mw-52', {})

  const paintList = () => {
    listEl.replaceChildren(
      ...concepts.map(cc => h('button.row-item', {
        class: active?.name === cc.name ? 'active' : '',
        onclick: async () => { if (await guardDirty()) { active = cc; dirty = false; paintList(); paintMain() } },
      },
        h('span.row-ico', { html: icon(conceptIcon(cc), 15) }),
        h('span.row-label', {}, cc.labelPlural || cc.label),
        h('span.count.ml-auto', {}, String(counts[cc.name] ?? 0)))),
      h('button.tree-add.m-2', { onclick: createWizard }, '＋ New content type'))
  }

  const guardDirty = async () => !dirty || await confirmDialog('Unsaved changes', 'This content type has changes you have not saved. Leave and discard them?', 'Discard')

  function urlPreview(cc) {
    const fill = (cc.urlPattern || '/{slug}').replace('{slug}', 'example-item').replace('{concept}', cc.name)
    return `${state.meta.site.url}${fill}`
  }

  function paintMain() {
    if (!active) {
      mainEl.replaceChildren(emptyState(icon('layout', 26), 'No content types yet', 'Create the first one — pages, posts, products, anything.'))
      return
    }
    const cc = active
    cc.fields ??= []
    cc.seo ??= {}
    const markDirty = () => { dirty = true; saveBtn.textContent = 'Save type •' }
    const saveBtn = h('button.btn.primary', {
      onclick: async () => {
        try {
          await put(`/concepts/${cc.name}`, { concept: cc })
          dirty = false
          saveBtn.textContent = 'Saved ✓'
          setTimeout(() => (saveBtn.textContent = 'Save type'), 1400)
          const r = await get('/concepts'); concepts = r.concepts; counts = r.counts
          await refreshMeta()
          paintList()
          urlChip.textContent = urlPreview(cc)
        } catch (e) { toast(String(e.message || e), 'err', 4500) }
      },
    }, 'Save type')

    const urlChip = h('code.text-s', {}, urlPreview(cc))

    const iconPicker = h('div.d-flex.gap-1.wrap', {},
      ...TYPE_ICONS.map(name => h('button.icon-btn', {
        title: iconName(name), 'aria-label': iconName(name),
        style: cc.icon === name ? { background: 'var(--acc-soft)', color: 'var(--acc-strong)' } : {},
        onclick: e => {
          cc.icon = name; markDirty()
          iconPicker.querySelectorAll('button').forEach(b => (b.style.background = '', b.style.color = ''))
          e.currentTarget.style.background = 'var(--acc-soft)'
        },
        html: icon(name, 16),
      })))

    const basics = renderFields([
      { key: 'label', type: 'text', label: 'Name (singular)', required: true, width: 'half' },
      { key: 'labelPlural', type: 'text', label: 'Name (plural)', width: 'half', help: 'Shown in the sidebar' },
    ], cc, markDirty)

    const urls = renderFields([
      { key: 'urlPattern', type: 'text', label: 'URL pattern', required: true, help: 'Must contain {slug} — e.g. /work/{slug}' },
      { key: 'indexPath', type: 'text', label: 'Index page', help: 'e.g. /work — a generated listing of every published item. Leave blank for none.', width: 'half' },
      { key: 'perPage', type: 'number', label: 'Items per index page', width: 'half' },
      { key: 'feed', type: 'boolean', label: 'Publish an RSS feed at <index>/feed.xml' },
    ], cc, () => { markDirty(); urlChip.textContent = urlPreview(cc) })

    const tplOptions = (window.__blockhousePageTpls || ['']).map(t => ({ value: t, label: t || 'Default' }))
    if (!window.__blockhousePageTpls) {
      get('/templates/pages').then(r => { window.__blockhousePageTpls = ['', ...r.pages]; paintMain() }).catch(() => {})
    }
    const tpl = renderFields([
      { key: 'template', type: 'select', label: 'Page template', options: tplOptions, help: `Which page layout these use. Leave blank and it picks "${cc.name}" if your design has one, otherwise the plain page layout.`, width: 'half' },
      { key: 'indexTemplate', type: 'text', label: 'Listing page layout', help: 'The layout for the page that lists them all. Leave blank for the standard list.', width: 'half' },
    ], cc, markDirty)
    const seo = renderFields([
      { key: 'titlePattern', type: 'text', label: 'Title pattern', help: '{title} — {site}. Overrides the site default for this type.' },
    ], cc.seo, markDirty)

    // ----- fields builder -----
    const fieldsHolder = h('div.stack-2', {})
    const paintFields = () => {
      fieldsHolder.replaceChildren(
        ...cc.fields.map((f, i) => fieldRow(f, i)),
        h('button.tree-add', {
          onclick: () => { cc.fields.push({ key: '', type: 'text', label: '' }); markDirty(); paintFields() },
        }, '＋ Add field'))
    }
    const fieldRow = (f, i) => {
      const open = h('details', { open: !f.key },
        h('summary.row.clickable.p-2-3', {},
          iconEl('grip', 13),
          h('strong.text-m', {}, f.label || f.key || 'New field'),
          h('code.fnt.text-xs', {}, f.key || ''),
          h('span.fnt.text-xs', {}, FIELD_TYPES.find(t => t.value === f.type)?.label.split(' — ')[0] || f.type),
          f.required ? h('span.badge.badge-accent', {}, 'required') : '',
          h('span.grow', {}),
          h('button.icon-btn', { title: 'Move up', 'aria-label': `Move “${f.label || f.key || 'New field'}” up`, onclick: e => { e.preventDefault(); if (i > 0) { cc.fields.splice(i - 1, 0, cc.fields.splice(i, 1)[0]); markDirty(); paintFields() } }, html: icon('back', 12, 'rot90') }),
          h('button.icon-btn', { title: 'Move down', 'aria-label': `Move “${f.label || f.key || 'New field'}” down`, onclick: e => { e.preventDefault(); if (i < cc.fields.length - 1) { cc.fields.splice(i + 1, 0, cc.fields.splice(i, 1)[0]); markDirty(); paintFields() } }, html: icon('fwd', 12, 'rot90') }),
          h('button.icon-btn', { title: 'Remove field', 'aria-label': `Remove field “${f.label || f.key || 'New field'}”`, onclick: e => { e.preventDefault(); cc.fields.splice(i, 1); markDirty(); paintFields() }, html: icon('trash', 13) })),
        h('div.p-0-3-3', {},
          renderFields([
            { key: 'label', type: 'text', label: 'Label', width: 'half' },
            { key: 'key', type: 'text', label: 'Key', width: 'half', help: 'Stable machine name — letters, numbers, dashes' },
            { key: 'type', type: 'select', label: 'Type', options: FIELD_TYPES, required: true, width: 'half' },
            { key: 'width', type: 'select', label: 'Width', options: [{ value: '', label: 'Full row' }, { value: 'half', label: 'Half row' }], width: 'half' },
            ...(f.type === 'select' ? [{ key: '_options', type: 'text', label: 'Choices', help: 'Separate with | — e.g. Small|Medium|Large' }] : []),
            { key: 'suggest', type: 'text', label: 'Autocomplete', help: 'a|b|c preset · title:<type> · concept:<type>.<field> · table:<id>.<field>' },
            { key: 'help', type: 'text', label: 'Help text', help: 'Shown under the field in the editor' },
            { key: 'required', type: 'boolean', label: 'Required' },
          ], fieldVals(f), (k, v) => {
            if (k === '_options') f.options = String(v).split('|').map(x => x.trim()).filter(Boolean).map(x => ({ value: x }))
            else if (k === 'key') f.key = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
            else if (v === '' || v === false) { if (k !== 'label') delete f[k]; else f[k] = v }
            else f[k] = v
            markDirty()
            if (k === 'type') paintFields()
          })))
      return h('div.card.p-0', {}, open)
    }
    const fieldVals = f => ({ ...f, _options: (f.options || []).map(o => o.value ?? o).join('|') })

    const danger = h('div.card.p-4-4.card-danger', {},
      h('div.d-flex.items-center.justify-between.gap-4', {},
        h('div', {},
          h('strong.text-m', {}, 'Delete this type'),
          h('p.fnt.text-s.m-0', {}, (counts[cc.name] ?? 0) > 0 ? `Blocked — ${counts[cc.name]} document(s) still use it.` : 'No documents use it, so this is safe.')),
        h('button.btn.ghost.small', {
          disabled: (counts[cc.name] ?? 0) > 0,
          onclick: async () => {
            if (!(await confirmDialog(`Delete “${cc.label}”?`, 'The type definition is removed. This cannot be undone.'))) return
            await del(`/concepts/${cc.name}`)
            const r = await get('/concepts'); concepts = r.concepts; counts = r.counts
            active = concepts[0] || null; dirty = false
            await refreshMeta()
            paintList(); paintMain()
            toast('Type deleted', 'ok')
          },
        }, iconEl('trash', 13), 'Delete')))

    const section = (title, sub, body) => h('section.mb-5', {},
      h('h2.text-l.mb-0', {}, title),
      sub ? h('p.fnt.text-s.mb-3', {}, sub) : '',
      h('div.card.p-4-4', {}, body))

    mainEl.replaceChildren(
      h('div.page-head', {},
        h('div', {},
          h('h1', {}, cc.labelPlural || cc.label),
          h('p.sub', {}, 'Everything about this content type — its address, its fields, its templates.')),
        h('div.d-flex.gap-2', {},
          h('a.btn.ghost', { href: `#/c/${cc.name}` }, 'Open list'),
          saveBtn)),
      section('Basics', null, h('div', {}, basics, h('div.field', {}, h('label', {}, h('span', {}, 'Icon')), iconPicker))),
      section('Addresses', null, h('div', {},
        h('p.fnt.text-s.mb-3', {}, 'Example URL: ', urlChip),
        urls)),
      section('Fields', 'Structured data every document of this type carries — shown as a form in the editor’s Page tab, usable in templates as {{ fields.key }}.', fieldsHolder),
      section('Templates & SEO', null, h('div', {}, tpl, seo)),
      danger)
    paintFields()
  }

  async function createWizard() {
    const vals = { label: '', name: '', preset: 'article', icon: 'tag' }
    const nameInput = h('input.input', { placeholder: 'products', oninput: e => (vals.name = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')) })
    dialog({
      title: 'New content type',
      width: 'min(30rem, 94vw)',
      body: h('div', {},
        renderFields([
          { key: 'label', type: 'text', label: 'What is one of these called?', required: true, help: 'e.g. Product, Project, Recipe, Course' },
          {
            key: 'preset', type: 'select', label: 'Start from', required: true, options: [
              { value: 'article', label: 'Article — lede + cover, with an index page' },
              { value: 'product', label: 'Product — price, SKU, availability' },
              { value: 'project', label: 'Project / case study — client, year' },
              { value: 'blank', label: 'Blank — no fields yet' },
            ],
          },
        ], vals, (k, v) => {
          if (k === 'label' && !nameInput.value) {
            vals.name = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/s$/, '') + 's'
            nameInput.value = vals.name
          }
        }),
        h('div.field', {}, h('label', {}, h('span', {}, 'Machine name'), h('span.help', {}, 'Used in URLs and file names — cannot change later')), nameInput)),
      actions: [{
        label: 'Create type', kind: 'primary', onClick: async () => {
          const name = (nameInput.value || vals.name || '').trim()
          if (!vals.label || !/^[a-z][a-z0-9-]*$/.test(name)) { toast('Give it a name (lowercase letters)', 'err'); return false }
          if (concepts.some(cc => cc.name === name)) { toast('That machine name is taken', 'err'); return false }
          const preset = PRESETS[vals.preset] || PRESETS.blank
          const concept = {
            name, label: vals.label,
            labelPlural: vals.label.endsWith('s') ? vals.label : vals.label + 's',
            icon: vals.preset === 'product' ? 'tag' : vals.preset === 'project' ? 'folder' : 'page',
            urlPattern: `/${name}/{slug}`,
            ...(preset.indexed ? { indexPath: `/${name}`, perPage: 9 } : {}),
            fields: JSON.parse(JSON.stringify(preset.fields)),
          }
          await put(`/concepts/${name}`, { concept })
          const r = await get('/concepts'); concepts = r.concepts; counts = r.counts
          active = concepts.find(cc => cc.name === name)
          dirty = false
          await refreshMeta()
          paintList(); paintMain()
          toast(`“${concept.labelPlural}” created — it’s in the sidebar now`, 'ok', 4000)
          return true
        },
      }],
    })
  }

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Content types')),
      listEl),
    h('div.main', {}, mainEl)))
  paintList()
  paintMain()
  if (location.hash.endsWith('/new')) createWizard()
})
