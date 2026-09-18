// Quick edits, in a side sheet, without leaving the page you were working on.
//
// The provenance dialog used to be a set of doors *out* of the document: click
// the footer, land in another view, lose your place. These panels bring the
// control to the work instead. Each is the same data and the same endpoint as
// its full view — this is a second door, never a second source of truth.

import { get, put } from './api.js'
import { h, debounce, toast, confirmDialog, undoToast } from './ui.js'
import { registerGuard } from './state.js'
import { iconEl } from './icons.js'
import { openSheet, closeSheet } from './sheet.js'
import { renderFields } from './fields.js'

/**
 * Palette and corner radius, injected live into whichever preview iframe you
 * are already looking at. Design owns these values; this edits the same ones.
 */
export async function quickDesign(previewFrame) {
  const { settings } = await get('/settings')
  const theme = settings.theme || {}
  const tokens = { ...(theme.tokens || {}) }
  const num = (k, d) => (tokens[k] === undefined || tokens[k] === '' ? d : parseFloat(String(tokens[k])))
  const work = { hue: num('hue', 275), chroma: num('accent-chroma', 0.16), radius: num('radius', 14) }
  let dirty = false

  const push = debounce(() => {
    previewFrame?.contentWindow?.postMessage({
      blockhouse: 'tokens',
      tokens: { hue: String(work.hue), 'accent-chroma': String(work.chroma), radius: `${work.radius}px` },
    }, '*')
  }, 50)

  const saveBtn = h('button.btn.primary', { onclick: save }, 'Save to the site')
  const mark = () => { dirty = true; saveBtn.textContent = 'Save to the site •'; push() }

  async function save() {
    // re-read so a template or font changed elsewhere since this panel opened
    // is not rolled back by our copy of the theme
    const cur = await get('/settings').then(r => r.settings.theme || {}).catch(() => theme)
    const next = { ...(cur.tokens || {}), ...tokens, hue: String(work.hue), 'accent-chroma': String(work.chroma), radius: `${work.radius}px` }
    await put('/settings', { patch: { theme: { ...cur, tokens: next } } })
    Object.assign(tokens, next)
    dirty = false
    saveBtn.textContent = 'Saved'
    toast('Design saved — every page now uses it', 'ok')
    setTimeout(() => { saveBtn.textContent = 'Save to the site' }, 1400)
  }

  const slider = (label, min, max, step, key, fmt) => {
    const out = h('output', { style: { font: '600 0.78rem var(--mono)', minWidth: '3.4rem', textAlign: 'right' } }, fmt(work[key]))
    const input = h('input', {
      type: 'range', min, max, step, value: work[key], 'aria-label': label,
      oninput: e => { work[key] = parseFloat(e.target.value); out.value = fmt(work[key]); mark() },
    })
    return h('div.design-slider', {}, h('label', {}, label),
      h('div', { style: { display: 'flex', gap: '0.7rem', alignItems: 'center' } }, input, out))
  }

  const hue = slider('Accent hue', 0, 360, 1, 'hue', v => `${Math.round(v)}°`)
  hue.querySelector('input').classList.add('hue-track')

  // The sheet is a second door onto the same work, so it needs the same
  // contract: leaving with unsaved changes asks, exactly as the full view does.
  const dispose = registerGuard('quick-design', async () => {
    if (!dirty) return true
    const keep = await confirmDialog('Unsaved colour changes',
      'The palette in the side panel is not live yet. Save it to the site, or discard?', 'Save to the site')
    if (keep) await save()
    // decided either way — clear it so closeSheet does not ask a second time
    dirty = false
    return true
  })

  await openSheet({
    title: 'Colour & shape',
    sub: 'Changes show in the preview immediately; nothing is live until you save',
    body: h('div', { style: { display: 'grid', gap: '0.9rem' } },
      hue,
      slider('Colour intensity', 0.01, 0.2, 0.005, 'chroma', v => v.toFixed(3)),
      slider('Corner radius', 0, 24, 1, 'radius', v => `${Math.round(v)}px`),
      h('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } }, saveBtn,
        h('a.btn.ghost.small', { href: '#/design', onclick: () => closeSheet() }, 'Open Design', iconEl('external', 12))),
      h('p.fnt', { style: { fontSize: 'var(--t-s)' } },
        'Two numbers drive the whole palette. Templates, fonts and colour scheme live in Design.')),
    onClose: async () => {
      dispose()
      if (!dirty) return
      if (await confirmDialog('Unsaved colour changes',
        'Save the palette to the site, or discard it?', 'Save to the site')) await save()
      else previewFrame?.contentWindow?.location.reload()   // put the preview back
    },
  })
}

/**
 * The blocks in one header/footer slot — the thing you actually clicked —
 * beside the page rather than three routes away.
 */
export async function quickChrome(slotKey, onSaved) {
  const NICE = {
    'header.announce': 'Announcement bar',
    'header.after': 'Below the header',
    'footer.before': 'Above the footer',
    'footer.social': 'Footer links & social',
  }
  const { slots } = await get('/chrome')
  const { blocks } = await import('./state.js').then(m => ({ blocks: m.state.meta.blocks }))
  const byType = Object.fromEntries(blocks.map(b => [b.type, b]))
  const list = slots[slotKey] || []
  let dirty = false

  async function saveSlots() {
    // This panel and the full Header & footer view both PUT the whole object.
    // Re-read first and merge only the slot being edited, so a second editor's
    // work in another slot is not overwritten by a stale copy of it.
    const fresh = await get('/chrome').catch(() => null)
    const merged = fresh ? { ...fresh.slots, [slotKey]: slots[slotKey] } : slots
    await put('/chrome', { slots: merged })
    Object.assign(slots, merged)
    dirty = false
    saveBtn.textContent = 'Saved'
    toast('Header and footer updated on every page', 'ok')
    onSaved?.()
    setTimeout(() => { saveBtn.textContent = 'Save to every page' }, 1400)
  }
  const saveBtn = h('button.btn.primary', { onclick: saveSlots }, 'Save to every page')
  const mark = () => { dirty = true; saveBtn.textContent = 'Save to every page •' }

  const body = h('div', { style: { display: 'grid', gap: '0.6rem' } })
  const paint = () => {
    body.replaceChildren(
      ...(list.length ? list.map(node => {
        const def = byType[node.type] || { label: node.type, fields: [] }
        return h('details.insp-group', { open: list.length === 1 },
          h('summary', {}, def.label || node.type),
          def.fields?.length
            ? renderFields(def.fields, node.props ||= {}, () => mark())
            : h('p.mut', { style: { fontSize: 'var(--t-m)' } }, 'This block has no options.'))
      }) : [h('p.mut', {}, 'Nothing in this slot yet.')]),
      h('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.4rem' } }, saveBtn,
        h('a.btn.ghost.small', { href: `#/chrome/${encodeURIComponent(slotKey)}`, onclick: () => closeSheet() },
          'Add or reorder blocks', iconEl('external', 12))))
  }
  paint()

  const dispose = registerGuard('quick-chrome', async () => {
    if (!dirty) return true
    const keep = await confirmDialog('Unsaved header & footer changes',
      'These are not live yet. Save them to every page, or discard?', 'Save to every page')
    if (keep) await saveSlots()
    dirty = false
    return true
  })

  await openSheet({
    title: NICE[slotKey] || slotKey,
    sub: 'The content in this slot, on every page',
    body,
    onClose: async () => {
      dispose()
      if (!dirty) return
      if (await confirmDialog('Unsaved header & footer changes',
        'Save them to every page, or discard?', 'Save to every page')) await saveSlots()
    },
  })
}

/**
 * Add or retitle a top-level link in a menu, beside the page you are on.
 * "Add a link to the main menu" is the rubric's own worked example of a job
 * that should not cost you your place in a document.
 */
export async function quickMenu(menuKey, onSaved) {
  const { menus } = await get('/menus')
  const menu = menus.find(m => m.key === menuKey) || menus[0]
  if (!menu) return toast('This site has no menus yet', 'err')
  const { docs } = await get('/content').catch(() => ({ docs: [] }))
  let dirty = false

  const saveBtn = h('button.btn.primary', { onclick: doSave }, 'Publish to the site')
  const mark = () => { dirty = true; saveBtn.textContent = 'Publish to the site •' }

  async function doSave() {
    // Re-read and merge only the links, so a label or structure changed in the
    // menu studio since this sheet opened is not rolled back by our copy.
    const fresh = await get('/menus').then(r => r.menus.find(m => m.key === menu.key)).catch(() => null)
    const merged = fresh ? { ...fresh, items: menu.items } : menu
    await put(`/menus/${menu.key}`, { menu: merged })
    Object.assign(menu, merged)
    dirty = false
    saveBtn.textContent = 'Published'
    toast(`The ${menu.label || menu.key} menu is live`, 'ok')
    onSaved?.()
    setTimeout(() => { saveBtn.textContent = 'Publish to the site' }, 1400)
  }

  const rows = h('div', { style: { display: 'grid', gap: '0.2rem' } })
  const paint = () => {
    rows.replaceChildren(...(menu.items || []).map((it, i) => h('div', { style: { display: 'flex', gap: '0.3rem', alignItems: 'center' } },
      h('input.input', {
        value: it.label || '', 'aria-label': `Label for item ${i + 1}`, style: { flex: 1 },
        oninput: e => { it.label = e.target.value; mark() },
      }),
      h('button.icon-btn', {
        title: 'Remove', 'aria-label': `Remove ${it.label || 'this item'}`,
        onclick: async () => {
          const gone = menu.items.splice(i, 1)[0]
          mark(); paint()
          undoToast(`Removed “${gone.label || 'item'}”`, () => { menu.items.splice(i, 0, gone); mark(); paint() })
        },
      }, iconEl('trash', 13)))))
  }
  paint()

  const pick = h('select.input', { 'aria-label': 'Page to link to' },
    h('option', { value: '' }, 'Choose a page…'),
    ...docs.map(d => h('option', { value: d.id }, `${d.title} — ${d.path}`)))

  const dispose = registerGuard('quick-menu', async () => {
    if (!dirty) return true
    const keep = await confirmDialog('Unsaved menu changes',
      `The ${menu.label || menu.key} menu has changes that are not live yet. Publish them, or discard?`, 'Publish now')
    if (keep) await doSave()
    dirty = false
    return true
  })

  await openSheet({
    title: menu.label || `${menu.key} menu`,
    sub: 'Rename or remove links here; the full editor does structure and mega panels',
    body: h('div', { style: { display: 'grid', gap: '0.7rem' } },
      h('div.field', {}, h('label', {}, 'Add a link to a page'),
        h('div', { style: { display: 'flex', gap: '0.4rem' } }, pick,
          h('button.btn.ghost.small', {
            onclick: () => {
              const d = docs.find(x => x.id === pick.value)
              if (!d) return toast('Choose a page first', 'info', 2000)
              ;(menu.items ??= []).push({ id: 'mi' + Math.random().toString(36).slice(2, 8), type: 'doc', label: d.title, docId: d.id })
              pick.value = ''
              mark(); paint()
            },
          }, iconEl('plus', 12), 'Add'))),
      h('div.insp-section-title', {}, 'Links'),
      rows,
      h('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.3rem' } }, saveBtn,
        h('a.btn.ghost.small', { href: `#/menus/${menu.key}`, onclick: () => closeSheet() },
          'Open the menu studio', iconEl('external', 12)))),
    onClose: async () => {
      dispose()
      if (!dirty) return
      if (await confirmDialog('Unsaved menu changes', 'Publish them to the site, or discard?', 'Publish now')) await doSave()
    },
  })
}
