// Asset manager — folder tree, tags, search, multi-select bulk actions,
// per-asset metadata (alt/title/caption/credit/focal), and a non-destructive
// image processing wizard (crop · resize · rotate · format · quality · watermark).

import { get, post, patch, del } from './api.js'
import { h, dialog, confirmDialog, toast, emptyState, debounce, promptDialog, undoToast } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state } from './state.js'
import { helpButton } from './help.js'

const humanSize = n => !n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`

registerView('media', async root => {
  let filter = { text: '', folder: undefined, tag: '', type: '' }
  let selection = new Set()
  let items = []
  let idx = { folders: [], tags: [], total: 0 }

  const grid = h('div.media-grid')
  const treeHolder = h('div.panel-body')
  const bulkBar = h('div.bulk-bar', { hidden: true })
  const countLabel = h('span.fnt.text-s', {})

  const qs = () => {
    const p = new URLSearchParams()
    if (filter.text) p.set('q', filter.text)
    if (filter.folder !== undefined) p.set('folder', filter.folder)
    if (filter.tag) p.set('tag', filter.tag)
    if (filter.type) p.set('type', filter.type)
    return p.toString() ? '?' + p.toString() : '?q='
  }

  async function refresh() {
    ;[{ media: items }, idx] = await Promise.all([get('/media' + qs()), get('/media/index')])
    renderTree(); renderGrid(); renderBulk()
  }

  function renderTree() {
    const rows = [
      folderRow('All assets', undefined, idx.total, 'folder'),
      folderRow('Unfiled', '', null, 'folder'),
      ...idx.folders.map(f => folderRow(f.split('/').pop(), f, null, 'folder', f.split('/').length - 1)),
    ]
    treeHolder.replaceChildren(
      ...rows,
      idx.tags.length ? h('div.panel-title.p-4-3-1', {}, 'Tags') : '',
      ...idx.tags.map(t => h('button.row-item', {
        class: filter.tag === t.tag ? 'active' : '',
        onclick: () => { filter.tag = filter.tag === t.tag ? '' : t.tag; refresh() },
      }, h('span.row-ico', { html: icon('hash', 14) }), h('span.row-label', {}, t.tag), h('span.chip.draft', {}, String(t.n)))))
  }
  function folderRow(label, path, n, ico, depth = 0) {
    return h('button.row-item', {
      class: filter.folder === path ? 'active' : '',
      style: depth ? { paddingLeft: `${0.65 + depth * 0.8}rem` } : {},
      onclick: () => { filter.folder = path; refresh() },
    }, h('span.row-ico', { html: icon(ico, 14) }), h('span.row-label', {}, label), n != null ? h('span.chip.draft', {}, String(n)) : '')
  }

  function renderGrid() {
    countLabel.textContent = `${items.length} asset${items.length === 1 ? '' : 's'}`
    if (!items.length) { grid.replaceChildren(emptyState(icon('image', 26), 'Nothing here', 'Drop files to upload, or clear the filters.')); return }
    grid.replaceChildren(...items.map(m => {
      const card = h('button.media-card', {
        class: selection.has(m.id) ? 'selected' : '',
        onclick: e => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleSel(m.id); return }
          editAsset(m)
        },
      },
        h('div.media-thumb', {}, m.type.startsWith('image/')
          ? h('img', { src: `/media/${m.file}`, loading: 'lazy', alt: '', style: m.focal ? { objectPosition: `${m.focal.x * 100}% ${m.focal.y * 100}%` } : {} })
          : iconEl('page', 22)),
        !m.alt && m.type.startsWith('image/') ? h('span.media-alt-warn', {}, 'no alt') : '',
        m.private ? h('span.media-alt-warn.tag-private', {}, 'private') : '',
        h('div.media-meta', {},
          h('div.media-name', {}, m.name),
          h('div.media-dims', {}, m.width ? `${m.width}×${m.height} · ` : '', humanSize(m.size), (m.tags || []).length ? ` · ${m.tags.length} tag${m.tags.length > 1 ? 's' : ''}` : '')))
      // a small checkbox affordance for selection without modifier keys
      const check = h('span.media-check', {
        class: selection.has(m.id) ? 'on' : '',
        onclick: e => { e.stopPropagation(); toggleSel(m.id) },
        html: selection.has(m.id) ? icon('check', 11) : '',
      })
      card.appendChild(check)
      return card
    }))
  }
  function toggleSel(id) { selection.has(id) ? selection.delete(id) : selection.add(id); renderGrid(); renderBulk() }

  function renderBulk() {
    if (!selection.size) { bulkBar.hidden = true; return }
    bulkBar.hidden = false
    bulkBar.replaceChildren(
      h('strong', {}, `${selection.size} selected`),
      h('button.btn.ghost.small', { onclick: async () => {
        const folder = await promptDialog({
          title: 'Move to a folder',
          label: 'Folder',
          value: filter.folder || '',
          placeholder: 'brand/logos',
          help: 'Leave blank to move these out of any folder.',
          confirmLabel: 'Move',
          datalist: idx?.folders || [],
        })
        if (folder === null) return
        await post('/media/bulk', { ids: [...selection], action: 'move', value: folder })
        selection.clear(); toast('Moved', 'ok'); refresh()
      } }, iconEl('folder', 13), 'Move'),
      h('button.btn.ghost.small', { onclick: async () => {
        const tag = await promptDialog({
          title: 'Add a tag',
          label: 'Tag',
          placeholder: 'logo',
          help: 'Tags let you filter the library later.',
          confirmLabel: 'Add tag',
          datalist: idx?.tags || [],
        })
        if (!tag) return
        await post('/media/bulk', { ids: [...selection], action: 'tag', value: tag })
        selection.clear(); toast('Tagged', 'ok'); refresh()
      } }, iconEl('hash', 13), 'Tag'),
      h('button.btn.ghost.small', { onclick: async () => {
        await post('/media/bulk', { ids: [...selection], action: 'private', value: true })
        selection.clear(); toast('Marked private', 'ok'); refresh()
      } }, iconEl('key', 13), 'Make private'),
      state.meta.perms.delete ? h('button.btn.danger.small', { onclick: async () => {
        if (!(await confirmDialog('Delete assets', `Delete ${selection.size} asset(s) and their derivatives?`))) return
        await post('/media/bulk', { ids: [...selection], action: 'delete' })
        selection.clear(); toast('Deleted', 'ok'); refresh()
      } }, iconEl('trash', 13), 'Delete') : '',
      h('button.btn.ghost.small', { onclick: () => { selection.clear(); renderGrid(); renderBulk() } }, 'Clear'))
  }

  // ---------- per-asset editor ----------
  function editAsset(m) {
    const vals = { alt: m.alt || '', title: m.title || '', caption: m.caption || '', credit: m.credit || '', folder: m.folder || '', tags: (m.tags || []).join(', '), private: !!m.private }
    const focal = { ...(m.focal || { x: 0.5, y: 0.5 }) }
    const isImage = m.type.startsWith('image/')

    const focalPicker = h('div.focal-picker', {
      onclick: e => {
        const r = e.currentTarget.getBoundingClientRect()
        focal.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        focal.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
        dot.style.left = `${focal.x * 100}%`; dot.style.top = `${focal.y * 100}%`
      },
    })
    const dot = h('span', { style: { position: 'absolute', left: `${focal.x * 100}%`, top: `${focal.y * 100}%`, width: '14px', height: '14px', marginLeft: '-7px', marginTop: '-7px', borderRadius: 'var(--r-pill)', border: '2px solid #fff', background: 'var(--acc)', boxShadow: '0 0 0 1px #0006', pointerEvents: 'none' } })
    if (isImage) focalPicker.append(h('img.d-block.w-full.mh-13.obj-contain.bg-app', { src: `/media/${m.file}` }), dot)

    const { renderFields } = window.__blockhouseFields
    dialog({
      title: m.name,
      width: 'min(42rem, 95vw)',
      body: h('div', {},
        isImage ? h('div.field', {}, h('label', {}, 'Focal point', h('span.help', {}, 'click to set the crop anchor')), focalPicker) : '',
        renderFields([
          { key: 'alt', type: 'text', label: 'Alt text', help: 'Describes the image for screen readers and search' },
          { key: 'title', type: 'text', label: 'Title', width: 'half' },
          { key: 'credit', type: 'text', label: 'Credit', width: 'half' },
          { key: 'caption', type: 'textarea', label: 'Caption', rows: 2 },
          { key: 'folder', type: 'text', label: 'Folder', help: 'e.g. brand/logos', width: 'half' },
          { key: 'tags', type: 'text', label: 'Tags (comma separated)', width: 'half' },
          { key: 'private', type: 'boolean', label: 'Private (delivered only via file links)' },
        ], vals, () => {}),
        h('p.fnt.mono.text-xs', {}, `/media/${m.file} · ${m.type} · ${humanSize(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}`)),
      actions: [
        isImage ? { label: 'Edit image…', onClick: () => { processWizard(m, refresh); return true } } : null,
        { label: 'Delete', kind: 'danger', onClick: async () => {
          if (!(await confirmDialog('Delete file', `Delete ${m.name} and its variants?`))) return false
          await del(`/media/${m.id}`); refresh(); return true
        } },
        { label: 'Save', kind: 'primary', onClick: async () => {
          await patch(`/media/${m.id}`, { ...vals, tags: vals.tags.split(',').map(t => t.trim()).filter(Boolean), focal })
          refresh(); return true
        } },
      ].filter(Boolean),
    })
  }

  // ---------- upload ----------
  const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } })
  const upload = async files => {
    const done = [], failed = []
    const prog = toast(`Uploading 0 of ${files.length}…`, 'info', { ms: 0 })
    for (const f of files) {
      const fd = new FormData()
      fd.append('file', f)
      if (filter.folder) fd.append('folder', filter.folder)
      try { await post('/media', fd); done.push(f.name) }
      catch (err) { failed.push(`${f.name} (${err.message || 'failed'})`) }
      prog.text = `Uploading ${done.length + failed.length} of ${files.length}…`
    }
    prog.close()
    if (failed.length) toast(`Uploaded ${done.length} of ${files.length}. Failed: ${failed.join(', ')}`, 'err')
    else toast(`Uploaded ${done.length} file${done.length === 1 ? '' : 's'}`, 'ok'); refresh()
  }
  fileInput.addEventListener('change', () => upload([...fileInput.files]))
  const drop = h('div.dropzone', {}, 'Drag & drop files here, or ', h('a', { href: '#', onclick: e => { e.preventDefault(); fileInput.click() } }, 'browse'),
    filter.folder ? h('span.fnt', {}, ` → uploads into “${filter.folder}”`) : '', fileInput)
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]) })

  const search = h('input.input.mw-18', { type: 'search', 'aria-label': 'Search assets', placeholder: 'Search name, alt, tags…' })
  search.addEventListener('input', debounce(() => { filter.text = search.value; refresh() }, 250))
  const typeSeg = h('div.seg', {}, ...[['', 'All'], ['image', 'Images'], ['doc', 'Files']].map(([k, l]) =>
    h('button', { class: filter.type === k ? 'active' : '', onclick: e => { filter.type = k; typeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active'); refresh() } }, l)))

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Library')),
      treeHolder),
    h('div.main', {}, h('div.main-pad.mw-78', {},
      h('div.page-head', {},
        h('div', {}, h('h1', {}, 'Assets'), h('p.sub', {}, 'Folders, tags and non-destructive image editing. Originals are never overwritten.')),
        h('div.d-flex.gap-2.items-center', {},
          helpButton('media', 'Assets'),
          h('button.btn.primary', { onclick: () => fileInput.click() }, iconEl('upload', 15), 'Upload'))),
      h('div.d-flex.gap-3.items-center.mb-4.wrap', {}, search, typeSeg, countLabel),
      bulkBar, drop, grid))))

  await refresh()
})

// ---------- image processing wizard ----------

function processWizard(m, onDone) {
  const ops = { width: m.width && m.width > 1600 ? 1600 : m.width || 1200, format: 'webp', quality: 82, fit: 'cover', rotate: 0, watermark: false }
  const crop = { x: 0, y: 0, w: 1, h: 1 }
  let cropping = false

  const stage = h('div.pos-rel.ovh.rad-s.bd-line.bg-app', {})
  const img = h('img.d-block.w-full.mh-16.obj-contain', { src: `/media/${m.file}` })
  const cropBox = h('div', { style: { position: 'absolute', inset: '0', border: '2px dashed var(--acc)', background: 'color-mix(in oklch, var(--acc) 10%, transparent)', display: 'none', pointerEvents: 'none' } })
  stage.append(img, cropBox)

  // drag to crop
  let start = null
  stage.addEventListener('pointerdown', e => {
    if (!cropping) return
    const r = stage.getBoundingClientRect()
    start = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    stage.setPointerCapture(e.pointerId)
  })
  stage.addEventListener('pointermove', e => {
    if (!cropping || !start) return
    const r = stage.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height
    crop.x = Math.max(0, Math.min(start.x, nx)); crop.y = Math.max(0, Math.min(start.y, ny))
    crop.w = Math.min(1 - crop.x, Math.abs(nx - start.x)); crop.h = Math.min(1 - crop.y, Math.abs(ny - start.y))
    Object.assign(cropBox.style, { display: 'block', left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, inset: 'auto' })
  })
  stage.addEventListener('pointerup', () => { start = null })

  const preset = (label, w, hh) => h('button.btn.ghost.small', { onclick: () => { ops.width = w; ops.height = hh || undefined; sync() } }, label)
  const out = h('div.fnt.text-s', {})
  const sync = () => {
    out.textContent = `→ ${ops.width || 'auto'}${ops.height ? `×${ops.height}` : ''} ${ops.format.toUpperCase()} q${ops.quality}` +
      (crop.w < 1 || crop.h < 1 ? ` · cropped ${Math.round(crop.w * 100)}%×${Math.round(crop.h * 100)}%` : '') +
      (ops.rotate ? ` · ${ops.rotate}°` : '') + (ops.watermark ? ' · watermarked' : '')
    form.querySelectorAll('input,select').forEach(() => {})
  }

  const { renderFields } = window.__blockhouseFields
  const form = renderFields([
    { key: 'width', type: 'number', label: 'Width (px)', width: 'half' },
    { key: 'height', type: 'number', label: 'Height (px, optional)', width: 'half' },
    { key: 'fit', type: 'select', label: 'Fit', options: [{ value: 'cover' }, { value: 'contain' }, { value: 'inside' }], width: 'half' },
    { key: 'format', type: 'select', label: 'Format', options: [{ value: 'webp' }, { value: 'avif' }, { value: 'jpeg' }, { value: 'png' }], width: 'half' },
    { key: 'quality', type: 'number', label: 'Quality (1–100)', width: 'half' },
    { key: 'rotate', type: 'select', label: 'Rotate', options: [{ value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }], width: 'half' },
    { key: 'grayscale', type: 'boolean', label: 'Grayscale' },
    { key: 'watermark', type: 'boolean', label: 'Apply site watermark' },
    { key: 'name', type: 'text', label: 'New asset name', help: 'Leave blank for “<name>-edit”' },
  ], ops, () => sync())

  dialog({
    title: `Edit image — ${m.name}`,
    width: 'min(44rem, 95vw)',
    body: h('div', {},
      h('p.dlg-text.mb-3', {}, 'Creates a new asset; the original stays untouched.'),
      stage,
      h('div.row.m-3-0.wrap', {},
        h('button.btn.ghost.small', { onclick: e => { cropping = !cropping; e.currentTarget.classList.toggle('primary', cropping); e.currentTarget.textContent = cropping ? 'Drag on the image…' : 'Crop' } }, 'Crop'),
        h('button.btn.ghost.small', { onclick: () => { crop.x = 0; crop.y = 0; crop.w = 1; crop.h = 1; cropBox.style.display = 'none'; sync() } }, 'Reset crop'),
        preset('Hero 1600', 1600), preset('Card 800', 800), preset('Thumb 400', 400), preset('OG 1200×630', 1200, 630),
        out),
      form),
    actions: [{
      label: 'Create asset', kind: 'primary', onClick: async () => {
        const payload = { ...ops, quality: Number(ops.quality) || 82, width: Number(ops.width) || undefined, height: Number(ops.height) || undefined, rotate: Number(ops.rotate) || 0 }
        if (crop.w < 0.999 || crop.h < 0.999) payload.crop = crop
        try {
          const r = await post(`/media/${m.id}/process`, payload)
          toast(`Created ${r.media.name}`, 'ok'); onDone?.(); return true
        } catch { return false }
      },
    }],
  })
  sync()
}
