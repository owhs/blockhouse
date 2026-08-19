// The document editor: block tree + inspector + annotated live preview.

import { get, put, post, del } from './api.js'
import { h, debounce, dialog, confirmDialog, contextMenu, makeSortable, toast, fmtDate, fitPreviewFrame } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, prefs, setPref } from './state.js'
import { icon, iconEl } from './icons.js'

registerView('editor', async (root, [docId]) => {
  const meta = state.meta
  let { doc, path, href, exportFile, shortlink, seo, stale } = await get(`/content/${docId}`)
  let baseVersion = doc.version
  let selectedId = null
  let dirty = false
  const undoStack = [], redoStack = []
  const catalogue = meta.blocks
  const byType = Object.fromEntries(catalogue.map(b => [b.type, b]))

  // ---------- helpers ----------

  const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  function findNode(id, blocks = doc.blocks, parents = []) {
    for (const b of blocks) {
      if (b.id === id) return { node: b, parents, siblings: blocks }
      if (b.children) {
        const r = findNode(id, b.children, [...parents, b])
        if (r) return r
      }
    }
    return null
  }

  function stateJson() { return JSON.stringify({ blocks: doc.blocks, fields: doc.fields, seo: doc.seo, title: doc.title, slug: doc.slug }) }
  function snapshot() {
    undoStack.push(stateJson())
    if (undoStack.length > 60) undoStack.shift()
    redoStack.length = 0
  }
  function doUndo() { if (undoStack.length) { redoStack.push(stateJson()); restore(undoStack.pop()) } }
  function doRedo() { if (redoStack.length) { undoStack.push(stateJson()); restore(redoStack.pop()) } }
  function restore(json) {
    const s = JSON.parse(json)
    Object.assign(doc, s)
    titleInput.value = doc.title
    renderTree(); renderInspector(); refreshPreview()
    scheduleSave()
  }

  // ---------- saving ----------

  const saveState = h('span.save-state', {}, '')
  async function save(explicit = false) {
    saveState.textContent = 'Saving…'; saveState.className = 'save-state saving'
    try {
      const r = await put(`/content/${doc.id}`, { doc, baseVersion, snapshot: explicit }, )
      doc.version = r.doc.version; doc.updatedAt = r.doc.updatedAt; doc.slug = r.doc.slug
      baseVersion = r.doc.version
      path = r.path; seo = r.seo; stale = r.stale
      dirty = false
      saveState.textContent = explicit ? 'Saved ✓' : 'Autosaved'
      saveState.className = 'save-state saved'
      renderStatus()
      if (inspTab === 'seo') renderInspector()
    } catch (e) {
      if (e.status === 409) {
        saveState.textContent = 'Conflict'
        dialog({
          title: 'Edited elsewhere',
          body: h('p.dlg-text', {}, `This document changed on the server (v${e.data.serverVersion}, ${fmtDate(e.data.serverUpdatedAt)}) while you were editing. Load the newer version, or overwrite it with yours?`),
          actions: [
            { label: 'Load newer', onClick: () => { location.reload(); return true } },
            { label: 'Overwrite', kind: 'danger', onClick: async () => { baseVersion = e.data.serverVersion; await save(true); return true } },
          ],
        })
      } else { saveState.textContent = 'Save failed'; saveState.className = 'save-state saving' }
    }
  }
  const scheduleSave = debounce(() => save(false), 900)
  let suppressPreview = false   // true while typing inline in the canvas
  const markDirty = () => { dirty = true; saveState.textContent = 'Unsaved…'; saveState.className = 'save-state'; scheduleSave(); if (!suppressPreview) refreshPreviewSoon() }

  // ---------- preview ----------

  let focusedMode = !!prefs().focusedMode
  const previewSrc = () => `/preview/${doc.id}?editor=1${focusedMode ? '&bare=1' : ''}`
  const iframe = h('iframe', { src: previewSrc(), title: 'Page preview' })
  const frameHolder = h('div.preview-frame-holder', {}, iframe)
  const previewWrap = h('div.preview-wrap', { class: prefs().device ? `w-${prefs().device}` : '' }, frameHolder)
  // Desktop preview renders at real desktop width and scales down, so a narrow
  // pane never flips the site into its mobile layout (tablet/mobile are exact).
  let unfitPreview = null
  const fitForDevice = k => {
    unfitPreview?.(); unfitPreview = null
    iframe.style.width = ''; iframe.style.height = ''; iframe.style.transform = ''
    if (!k) unfitPreview = fitPreviewFrame(frameHolder, iframe, 1280)
  }
  fitForDevice(prefs().device || '')
  const refreshPreview = () => { scheduleSave.now?.(); iframe.contentWindow?.location.reload() }
  const refreshPreviewSoon = debounce(() => iframe.contentWindow?.location.reload(), 1100)

  addEventListener('message', onBridgeMsg)
  function onBridgeMsg(e) {
    const m = e.data || {}
    if (m.blockhouse === 'select' && m.id) { selectBlock(m.id, { fromPreview: true }) }
    if (m.blockhouse === 'ready' && selectedId) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id: selectedId }, '*')

    // “what is this / where do I edit it” — clicks on non-content chrome
    if (m.blockhouse === 'provenance') {
      const opts = []
      const seen = new Set()
      const add = (label2, icon2, go, hint) => { if (!seen.has(label2)) { seen.add(label2); opts.push({ label: label2, icon: icon2, go, hint }) } }
      for (const o of m.options || []) {
        if (o.kind === 'menu' && meta.perms.menus) {
          const mm = meta.menus.find(x => x.key === o.key)
          add(`Edit the “${mm?.label || o.key}” menu`, 'menu', () => (location.hash = `#/menus/${o.key}`), 'Structure, panels and links — with live preview')
        }
        if ((o.kind === 'header' || o.kind === 'footer') && meta.perms.settings) {
          add(`Edit the ${o.kind} content`, 'layout', () => (location.hash = `#/chrome/${o.kind === 'header' ? 'header.announce' : 'footer.social'}`), 'Announcement bar, footer rows and links — the content poured into the template')
          add(`Edit the ${o.kind} template`, 'code', () => (location.hash = `#/tpl/${encodeURIComponent('partials/' + o.kind + '.liquid')}`), 'The structure — a safe override, the built-in file is untouched')
        }
        if (o.kind === 'design' && meta.perms.settings) {
          add('Open Design', 'palette', () => (location.hash = '#/design'), 'Palette, template, colour scheme')
        }
      }
      if (m.href && /\/(feed|sitemap)\.xml$/.test(m.href.split('?')[0]) && meta.perms.settings) {
        const which = m.href.includes('feed') ? 'RSS feeds' : 'The sitemap'
        add(`${which} — turn on or off in Features`, 'bolt', () => (location.hash = '#/settings/features'), 'When a feature is off, blockhouse removes its links site-wide')
      }
      if (m.href && /^\//.test(m.href)) {
        add(`Go edit the page at ${m.href}`, 'page', async () => {
          const { docs } = await get('/content')
          const target = docs.find(d2 => d2.path === m.href.replace(/\/$/, '') || d2.path === m.href)
          if (target) location.hash = `#/e/${target.id}`
          else toast('That link doesn’t point at a page in this site', 'err')
        }, 'Follow the link into its editor, not the live site')
      }
      if (meta.perms.settings) add('Site settings', 'gear', () => (location.hash = '#/settings'), 'Identity, features, everything else')
      const dlg = dialog({
        title: m.text ? `“${m.text}”` : 'This part of the page',
        body: h('div', {},
          h('p.dlg-text', { style: { marginBottom: '0.6rem' } }, opts.length > 1 ? 'This element is controlled in more than one place — pick where to edit:' : 'Edit it here:'),
          h('div', { style: { display: 'grid', gap: '0.3rem' } },
            ...(opts.length ? opts : [{ label: 'This comes from the template', icon: 'info', go: null, hint: 'It isn’t page content — template files or Design control it.' }])
              .map(o => h('button.row-item', {
                style: { border: '1px solid var(--line)', borderRadius: 'var(--r-s)', padding: '0.6rem 0.7rem' },
                onclick: () => { if (o.go) { dlg.closeWith(); o.go() } },
              },
                h('span.row-ico', { html: icon(o.icon, 16) }),
                h('div', { style: { textAlign: 'left' } },
                  h('div', { style: { fontWeight: 640, fontSize: '0.86rem' } }, o.label),
                  o.hint ? h('div.fnt', { style: { fontSize: '0.74rem' } }, o.hint) : ''))))),
      })
    }

    // inline canvas editing
    if (m.blockhouse === 'editstart') { snapshotOnce(); suppressPreview = true }
    if (m.blockhouse === 'edit' && m.id && m.prop) {
      const found = findNode(m.id)
      if (found) {
        found.node.props[m.prop] = m.value
        dirty = true
        saveState.textContent = 'Unsaved…'; saveState.className = 'save-state'
        scheduleSave()
      }
    }
    if (m.blockhouse === 'editend') {
      suppressPreview = false
      refreshPreviewSoon()
      if (inspTab === 'block') renderInspector()
      renderTree()
    }

    // floating toolbar actions from the canvas
    if (m.blockhouse === 'blockaction' && m.id) {
      const found = findNode(m.id)
      if (!found) return
      const { node, siblings } = found
      const i = siblings.indexOf(node)
      if (m.action === 'delete') { snapshot(); siblings.splice(i, 1); if (selectedId === m.id) selectedId = null; markDirty(); renderTree(); renderInspector() }
      if (m.action === 'duplicate') { snapshot(); const copy = JSON.parse(JSON.stringify(node)); reId(copy); siblings.splice(i + 1, 0, copy); markDirty(); renderTree() }
      if (m.action === 'add-after') addBlock(siblings, i + 1)
      if (m.action === 'up' && i > 0) { snapshot(); siblings.splice(i, 1); siblings.splice(i - 1, 0, node); markDirty(); renderTree() }
      if (m.action === 'down' && i < siblings.length - 1) { snapshot(); siblings.splice(i, 1); siblings.splice(i + 1, 0, node); markDirty(); renderTree() }
    }
  }

  // ---------- block ops ----------

  function selectBlock(id, opts = {}) {
    selectedId = id
    inspTab = 'block'
    renderTree()
    renderInspector()
    if (!opts.fromPreview) iframe.contentWindow?.postMessage({ blockhouse: 'highlight', id }, '*')
  }

  function addBlock(intoChildren, index, restrictTypes) {
    const groups = {}
    for (const b of catalogue) {
      if (restrictTypes && !restrictTypes.includes(b.type)) continue
      ;(groups[b.group] ??= []).push(b)
    }
    const search = h('input.pal-input', { placeholder: 'Search blocks…' })
    const holder = h('div.picker-groups')
    const renderPicker = () => {
      const q = search.value.toLowerCase()
      holder.replaceChildren(...Object.entries(groups).map(([g, items]) => {
        const vis = items.filter(b => !q || b.label.toLowerCase().includes(q) || b.type.includes(q))
        if (!vis.length) return ''
        return h('div', {}, h('div.picker-group-title', {}, g), h('div.picker-grid', {},
          vis.map(b => h('button.picker-item', {
            onclick: () => {
              snapshot()
              const node = { id: uid(), type: b.type, props: JSON.parse(JSON.stringify(b.defaults || {})) }
              if (b.container) node.children = []
              if (b.type === 'faq') node.children = [{ id: uid(), type: 'faq-item', props: { question: 'A good question?' }, children: [{ id: uid(), type: 'richtext', props: { md: 'A clear answer.' } }] }]
              if (b.type === 'tabs') node.children = [{ id: uid(), type: 'tab', props: { label: 'Tab 1' }, children: [] }, { id: uid(), type: 'tab', props: { label: 'Tab 2' }, children: [] }]
              intoChildren.splice(index ?? intoChildren.length, 0, node)
              dlg.closeWith()
              markDirty(); renderTree(); selectBlock(node.id)
            },
          }, h('span.p-ico', { html: icon(b.icon || 'layout', 17) }), h('span.p-label', {}, b.label), b.description ? h('span.p-desc', {}, b.description) : '')),
        ))
      }).filter(Boolean))
    }
    search.addEventListener('input', renderPicker)
    const dlg = dialog({ title: 'Add a block', width: 'min(44rem, 94vw)', body: [search, holder] })
    renderPicker()
    search.focus()
  }

  function blockMenu(e, node, siblings) {
    e.preventDefault()
    contextMenu(e.clientX, e.clientY, [
      { icon: icon('plus', 14), label: 'Add block after', onClick: () => addBlock(siblings, siblings.indexOf(node) + 1) },
      { icon: icon('copy', 14), label: 'Duplicate', onClick: () => { snapshot(); const copy = JSON.parse(JSON.stringify(node)); reId(copy); siblings.splice(siblings.indexOf(node) + 1, 0, copy); markDirty(); renderTree() } },
      '-',
      { icon: icon('undo', 14), label: 'Move up', onClick: () => { const i = siblings.indexOf(node); if (i > 0) { snapshot(); siblings.splice(i, 1); siblings.splice(i - 1, 0, node); markDirty(); renderTree() } } },
      { icon: icon('redo', 14), label: 'Move down', onClick: () => { const i = siblings.indexOf(node); if (i < siblings.length - 1) { snapshot(); siblings.splice(i, 1); siblings.splice(i + 1, 0, node); markDirty(); renderTree() } } },
      '-',
      { icon: icon('trash', 14), label: 'Delete', danger: true, onClick: () => { snapshot(); siblings.splice(siblings.indexOf(node), 1); if (selectedId === node.id) selectedId = null; markDirty(); renderTree(); renderInspector() } },
    ])
  }
  function reId(node) { node.id = uid(); for (const c of node.children || []) reId(c) }

  // ---------- tree ----------

  const treeHolder = h('div')
  function renderTree() {
    treeHolder.replaceChildren(buildTree(doc.blocks, []), h('button.tree-add', { onclick: () => addBlock(doc.blocks) }, '＋ Add block'))
  }
  function buildTree(blocks, parents) {
    const holder = h('div.tree')
    for (const node of blocks) {
      const def = byType[node.type]
      const label = blockLabel(node, def)
      const row = h('div.tree-item', {
        class: node.id === selectedId ? 'selected' : '',
        draggable: 'true',
        onclick: () => selectBlock(node.id),
        oncontextmenu: e => blockMenu(e, node, blocks),
      },
        h('span.t-grip', { html: icon('grip', 13) }),
        h('span.t-ico', { html: icon(def?.icon || 'layout', 14) }),
        h('span.t-label', {}, label, ' ', h('span.t-type', {}, def?.label || node.type)),
      )
      const wrap = h('div', {}, row)
      if (def?.container) {
        const kids = buildTree(node.children ?? (node.children = []), [...parents, node])
        kids.className = 'tree-kids tree'
        wrap.appendChild(kids)
        wrap.appendChild(h('div.tree-kids', {}, h('button.tree-add', { onclick: () => addBlock(node.children, undefined, def.childTypes) }, '＋ inside')))
      }
      holder.appendChild(wrap)
    }
    makeSortable(holder, {
      onMove: (from, to) => { snapshot(); const [m] = blocks.splice(from, 1); blocks.splice(to, 0, m); markDirty(); renderTree() },
    })
    return holder
  }
  function blockLabel(node, def) {
    const p = node.props || {}
    return String(p.title || p.text || p.question || p.label || p.md || '').replace(/[#*_>`]/g, '').slice(0, 26) || ''
  }

  // ---------- inspector ----------

  let inspTab = 'block'
  const inspBody = h('div.insp-body')
  const crumbs = h('div.insp-crumbs')
  const tabs = h('div.insp-tabs')

  function renderInspector() {
    tabs.replaceChildren(...[['block', 'Block'], ['page', 'Page'], ['seo', 'SEO']].map(([k, label]) =>
      h('button', { class: inspTab === k ? 'active' : '', onclick: () => { inspTab = k; renderInspector() } }, label)))

    if (inspTab === 'block') {
      const found = selectedId ? findNode(selectedId) : null
      crumbs.style.display = ''
      crumbs.replaceChildren(
        h('button', { onclick: () => { selectedId = null; renderTree(); renderInspector(); iframe.contentWindow?.postMessage({ blockhouse: 'clear' }, '*') } }, 'Page'),
        ...(found ? found.parents.flatMap(p => [h('span.sep', {}, '›'), h('button', { onclick: () => selectBlock(p.id) }, byType[p.type]?.label || p.type)]) : []),
        ...(found ? [h('span.sep', {}, '›'), h('button', { style: { color: 'var(--acc-strong)' } }, byType[found.node.type]?.label || found.node.type)] : []))

      if (!found) {
        inspBody.replaceChildren(
          h('div.insp-section-title', {}, 'Content blocks'),
          treeHolder)
        renderTree()
        return
      }
      const def = byType[found.node.type]
      const propsForm = def?.fields?.length
        ? renderFields(def.fields, found.node.props, () => { snapshotOnce(); markDirty() })
        : h('p.mut', {}, 'This block has no options.')
      inspBody.replaceChildren(
        h('div.insp-section-title', {}, def?.label || found.node.type,
          h('button.icon-btn', { title: 'Delete block', onclick: () => { snapshot(); found.siblings.splice(found.siblings.indexOf(found.node), 1); selectedId = null; markDirty(); renderTree(); renderInspector() } }, iconEl('trash', 14))),
        propsForm,
        h('div.insp-section-title', {}, 'Structure'),
        treeHolder)
      renderTree()
    }

    if (inspTab === 'page') {
      crumbs.style.display = 'none'
      const concept = meta.concepts.find(c => c.name === doc.concept)
      const pageVals = { slug: doc.slug, publishAt: doc.publishAt || '', template: doc.template || '' }
      if (!window.__blockhousePageTpls) {
        window.__blockhousePageTpls = ['']
        get('/templates/pages').then(r => { window.__blockhousePageTpls = ['', ...r.pages]; renderInspector() }).catch(() => {})
      }
      inspBody.replaceChildren(
        h('div.insp-section-title', {}, 'Document'),
        renderFields([
          { key: 'slug', type: 'text', label: 'Slug', help: 'Old slugs 301-redirect automatically' },
          { key: 'publishAt', type: 'date', label: 'Publish at (scheduled)' },
          {
            key: 'template', type: 'select', label: 'Page template',
            options: (window.__blockhousePageTpls || ['']).map(t => ({ value: t, label: t || `Default (${concept?.template || concept?.name || 'page'})` })),
            help: 'Templates live under Site → Templates; add pages/<name>.liquid and it appears here.',
          },
        ], pageVals, (k, v) => {
          if (k === 'slug') doc.slug = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
          else if (v) doc[k] = v; else delete doc[k]
          markDirty()
        }),
        ...(concept?.fields?.length ? [
          h('div.insp-section-title', {}, `${concept.label} fields`),
          renderFields(concept.fields, doc.fields, () => { snapshotOnce(); markDirty() }),
        ] : []),
        h('div.insp-section-title', {}, 'Addresses'),
        routingPanel(),
        h('div.insp-section-title', {}, 'Access'),
        accessPanel(),
        h('div.insp-section-title', {}, 'Custom code (this page only)'),
        renderFields([
          { key: 'css', type: 'code', label: 'CSS', rows: 4, help: 'Injected on this page after the theme' },
          ...(meta.perms.html ? [{ key: 'js', type: 'code', label: 'JavaScript', rows: 4, help: 'Runs as a module on this page (editors+)' }] : []),
        ], (doc.custom ??= {}), () => markDirty()),
        h('div.insp-section-title', {}, 'Versions'),
        versionsPanel())
    }

    if (inspTab === 'seo') {
      crumbs.style.display = 'none'
      doc.seo ??= {}
      const site = meta.site
      const title = doc.seo.title || doc.title
      inspBody.replaceChildren(
        h('div.serp', {},
          h('div.serp-url', {}, (site.url || '') + path),
          h('div.serp-title', {}, title.length > 60 ? title.slice(0, 57) + '…' : title),
          h('div.serp-desc', {}, (doc.seo.description || 'No meta description set — search engines will improvise one.').slice(0, 160))),
        // social share preview
        (() => {
          const ogImg = h('div.og-img', {}, doc.seo.image ? '' : 'no share image set')
          if (doc.seo.image) {
            get('/media').then(r => {
              const mm = r.media.find(x => x.id === doc.seo.image)
              if (mm) ogImg.style.backgroundImage = `url(/media/${mm.file})`
            }).catch(() => {})
          }
          return h('div.og-card', {}, ogImg,
            h('div.og-body', {},
              h('div.og-domain', {}, (site.url || '').replace(/^https?:\/\//, '')),
              h('div.og-title', {}, doc.seo.title || doc.title),
              h('div.og-desc', {}, doc.seo.description || '')))
        })(),
        renderFields([
          { key: 'title', type: 'text', label: 'SEO title', help: 'Defaults to the document title' },
          { key: 'description', type: 'textarea', label: 'Meta description', rows: 3 },
          { key: 'keyword', type: 'text', label: 'Focus keyword', help: 'Enables keyword checks below' },
          { key: 'image', type: 'image', label: 'Social share image' },
          { key: 'canonical', type: 'text', label: 'Canonical URL override' },
          { key: 'noindex', type: 'boolean', label: 'Hide from search engines (noindex)' },
        ], doc.seo, k => { markDirty(); if (k === 'keyword' || k === 'image') scheduleSave.now?.() }),
        h('button.btn.ghost.small', {
          onclick: async e => {
            const b = e.currentTarget; b.disabled = true
            try {
              const text = JSON.stringify(doc.blocks).slice(0, 8000)
              const r = await post('/x/ai/assist', { task: 'meta', text: `Title: ${doc.title}\n${text}` })
              doc.seo.description = r.result.slice(0, 160)
              markDirty(); renderInspector()
            } catch {}
            b.disabled = false
          },
        }, '✦ Draft description with AI'),
        h('div.insp-section-title', {}, 'Checks'),
        h('div', {}, ...seo.map(chk => h('div.seo-check', { class: chk.level },
          h('span.dot'), h('span', {}, chk.label, chk.detail ? h('span.detail', {}, chk.detail) : '')))))
    }
  }

  let snapshotArmed = true
  function snapshotOnce() { if (snapshotArmed) { snapshot(); snapshotArmed = false; setTimeout(() => (snapshotArmed = true), 1500) } }

  // Where this page lives: canonical address, the static file it becomes, its
  // shortlink, and any extra addresses (301 redirects, or mirrors that render
  // the page in place at a second URL).
  function routingPanel() {
    const row = (label, value, hint) => h('div', { style: { display: 'grid', gap: '0.1rem', marginBottom: '0.5rem' } },
      h('span.fnt', { style: { fontSize: '0.72rem' } }, label),
      h('code', { style: { fontSize: '0.78rem', wordBreak: 'break-all' } }, value),
      hint ? h('span.fnt', { style: { fontSize: '0.7rem' } }, hint) : '')

    const aliases = h('div', { style: { display: 'grid', gap: '0.35rem' } })
    const drawAliases = () => {
      const list = doc.aliases || []
      aliases.replaceChildren(
        ...list.map((a, i) => h('div', { style: { display: 'flex', gap: '0.3rem' } },
          h('input.input', {
            value: a, style: { flex: '1' }, placeholder: '/old-url',
            onchange: e => {
              const v = e.target.value.trim()
              if (!v) list.splice(i, 1)
              else list[i] = v.startsWith('/') ? v : '/' + v
              doc.aliases = list.filter(Boolean)
              markDirty(); drawAliases()
            },
          }),
          h('button.icon-btn', {
            title: 'Remove', onclick: () => { list.splice(i, 1); doc.aliases = list; markDirty(); drawAliases() },
          }, iconEl('trash', 13)))),
        h('button.btn.ghost.small', {
          onclick: () => { doc.aliases = [...(doc.aliases || []), '']; markDirty(); drawAliases() },
        }, iconEl('plus', 12), 'Add address'),
        list.length ? h('label.field-check', { style: { marginTop: '0.3rem' } },
          h('input', {
            type: 'checkbox', checked: !!doc.mirror,
            onchange: e => { doc.mirror = e.target.checked; if (!doc.mirror) delete doc.mirror; markDirty() },
          }),
          h('span', {}, 'Mirror instead of redirect')) : '',
        list.length ? h('span.fnt', { style: { fontSize: '0.7rem' } },
          doc.mirror
            ? 'Each address renders this page in place (canonical tag still points here).'
            : 'Each address 301-redirects to the canonical URL.') : '')
    }
    drawAliases()

    return h('div', {},
      row('Canonical URL', (meta.site.url || '') + (href || path), 'Changing the slug adds an automatic redirect from the old one.'),
      row('Static file', exportFile || 'index.html', `URL style: ${meta.urls?.style || 'directory'} · layout: ${meta.urls?.layout || 'pattern'} — change under Settings → URLs.`),
      shortlink ? row('Shortlink', (meta.site.url || '') + shortlink, 'Stable even if the slug changes.') : '',
      h('span.fnt', { style: { fontSize: '0.72rem', display: 'block', margin: '0.6rem 0 0.3rem' } }, 'Extra addresses'),
      aliases)
  }

  // Who may view the page once published. Requires the Members plugin for
  // anything other than public.
  function accessPanel() {
    const hasMembers = (meta.panels || []).some(p => p.plugin === 'members')
    doc.access ??= {}
    const wrap = h('div', {})
    const draw = () => {
      const mode = doc.access.mode || 'public'
      const groups = meta.memberGroups || []
      wrap.replaceChildren(
        renderFields([{
          key: 'mode', type: 'select', label: 'Visible to', required: true,
          options: [
            { value: 'public', label: 'Everyone' },
            { value: 'members', label: 'Signed-in members' },
            { value: 'groups', label: 'Specific member groups' },
          ],
          help: hasMembers ? '' : 'Install the Members plugin to use member-only pages.',
        }], { mode }, (k, v) => {
          if (v === 'public') doc.access = {}
          else doc.access.mode = v
          markDirty(); draw()
        }),
        mode === 'groups'
          ? (groups.length
            ? h('div', { style: { display: 'grid', gap: '0.25rem', margin: '0.2rem 0 0.6rem' } },
              ...groups.map(g => h('label.field-check', {},
                h('input', {
                  type: 'checkbox', checked: (doc.access.groups || []).includes(g.id),
                  onchange: e => {
                    const set = new Set(doc.access.groups || [])
                    e.target.checked ? set.add(g.id) : set.delete(g.id)
                    doc.access.groups = [...set]
                    markDirty()
                  },
                }),
                h('span', {}, g.label))))
            : h('p.mut', { style: { fontSize: '0.78rem' } }, 'No member groups yet — add them under Members → Groups.'))
          : '',
        mode !== 'public'
          ? renderFields([{ key: 'redirect', type: 'text', label: 'Send visitors to', help: 'Blank uses the Members login page.' }], doc.access, (k, v) => {
            if (v) doc.access.redirect = v; else delete doc.access.redirect
            markDirty()
          })
          : '',
        mode !== 'public'
          ? h('p.mut', { style: { fontSize: '0.75rem' } }, 'Gated pages are served with no-store and are skipped by static exports and sitemaps.')
          : '')
    }
    draw()
    return wrap
  }

  function versionsPanel() {
    const holder = h('div', {}, h('div.spin'))
    get(`/content/${doc.id}/versions`).then(({ versions }) => {
      holder.replaceChildren(...(versions.length ? versions.slice(0, 10).map(v =>
        h('button.row-item', {
          onclick: async () => {
            if (await confirmDialog('Restore version', `Restore v${v.version} from ${fmtDate(v.savedAt)}? Current state is snapshotted first.`, 'Restore')) {
              await post(`/content/${doc.id}/restore`, { key: v.key })
              location.reload()
            }
          },
        }, h('span.row-ico', { html: icon('refresh', 14) }), h('span.row-label', {}, `v${v.version}`, h('div.row-sub', {}, fmtDate(v.savedAt))))
      ) : [h('p.mut', {}, 'No snapshots yet — explicit saves create them.')]))
    })
    return holder
  }

  // ---------- topbar ----------

  const titleInput = h('input.doc-title-input', { value: doc.title })
  titleInput.addEventListener('input', () => { doc.title = titleInput.value; markDirty() })

  const statusHolder = h('span')
  function renderStatus() {
    statusHolder.replaceChildren(
      h('span.chip', { class: doc.status }, doc.status),
      stale ? h('span.chip.stale', { title: 'Published version is older than this draft' }, 'unpublished edits') : '')
  }

  const deviceSeg = h('div.seg', {}, ...[['', 'desktop', 'Desktop'], ['tablet', 'tablet', 'Tablet'], ['mobile', 'phone', 'Mobile']].map(([k, icoName, title]) =>
    h('button', {
      title, class: (prefs().device || '') === k ? 'active' : '',
      onclick: e => {
        setPref('device', k)
        previewWrap.className = 'preview-wrap' + (k ? ` w-${k}` : '')
        fitForDevice(k)
        deviceSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
        e.currentTarget.classList.add('active')
      },
    }, iconEl(icoName, 14))))

  async function publishFlow() {
    const errors = seo.filter(s => s.level === 'error')
    dialog({
      title: doc.status === 'published' ? 'Republish changes' : 'Publish',
      body: h('div', {},
        h('p.dlg-text', {}, `“${doc.title}” will go live at `, h('code', {}, path), '.'),
        errors.length ? h('div', { style: { marginTop: '0.7rem' } },
          h('div.insp-section-title', {}, 'SEO issues'),
          ...errors.map(chk => h('div.seo-check', { class: chk.level }, h('span.dot'), h('span', {}, chk.label)))) : '',
      ),
      actions: [
        { label: 'Cancel', onClick: () => true },
        {
          label: 'Publish now', kind: 'primary', onClick: async () => {
            await save(true)
            const r = await post(`/content/${doc.id}/publish`)
            doc.status = r.doc.status; stale = false
            renderStatus(); renderActions()
            toast('Published ✓', 'ok')
            return true
          },
        },
      ],
    })
  }

  const actionsHolder = h('span', { style: { display: 'inline-flex', gap: '0.4rem' } })
  function renderActions() {
    actionsHolder.replaceChildren(
      h('button.btn.ghost.small', { onclick: () => save(true) }, 'Save'),
      meta.perms.publish
        ? h('button.btn.primary.small', { onclick: publishFlow }, doc.status === 'published' ? (stale ? 'Republish' : 'Published ✓') : 'Publish…')
        : h('button.btn.soft.small', { onclick: async () => { await save(true); await post(`/content/${doc.id}/submit`); doc.status = 'review'; renderStatus(); toast('Submitted for review', 'ok') } }, 'Submit for review'),
      doc.status === 'published' && meta.perms.publish
        ? h('button.icon-btn', {
          title: 'More', onclick: e => contextMenu(e.clientX, e.clientY, [
            { icon: icon('clock', 14), label: 'Unpublish', onClick: async () => { await post(`/content/${doc.id}/unpublish`); doc.status = 'draft'; renderStatus(); renderActions() } },
            { icon: icon('home', 14), label: 'Make this the homepage', onClick: async () => { await post(`/content/${doc.id}/make-home`); toast('This is now the homepage', 'ok') } },
            ...(meta.perms.delete ? [{ icon: icon('trash', 14), label: 'Delete document', danger: true, onClick: deleteDoc }] : []),
          ]),
        }, iconEl('more', 15))
        : h('button.icon-btn', {
          title: 'More', onclick: e => contextMenu(e.clientX, e.clientY, [
            { icon: icon('home', 14), label: 'Make this the homepage', onClick: async () => { await post(`/content/${doc.id}/make-home`); toast('This is now the homepage', 'ok') } },
            ...(meta.perms.delete ? [{ icon: icon('trash', 14), label: 'Delete document', danger: true, onClick: deleteDoc }] : []),
          ]),
        }, iconEl('more', 15)))
  }
  async function deleteDoc() {
    if (await confirmDialog('Delete document', `Delete “${doc.title}”? It moves to the site trash folder.`)) {
      await del(`/content/${doc.id}`)
      location.hash = `#/c/${doc.concept}`
    }
  }

  const inspector = h('aside.inspector', {},
    h('div.insp-resize', {
      onpointerdown: e => {
        e.preventDefault()
        const target = e.currentTarget
        target.classList.add('on')
        const startX = e.clientX
        const startW = inspector.getBoundingClientRect().width
        const left = document.querySelector('.app')?.classList.contains('insp-left')
        const move = ev => {
          const w = Math.min(560, Math.max(240, startW + (left ? ev.clientX - startX : startX - ev.clientX)))
          root.style.setProperty('--insp-w', w + 'px')
        }
        const up = () => { target.classList.remove('on'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); setPref('inspW', root.style.getPropertyValue('--insp-w')) }
        addEventListener('pointermove', move); addEventListener('pointerup', up)
      },
    }),
    tabs, crumbs, inspBody)

  const editorEl = h('div.editor', {},
    h('div.editor-mid', {},
      h('div.editor-top', {},
        h('button.icon-btn', { title: 'Back', onclick: () => (location.hash = `#/c/${doc.concept}`) }, iconEl('back', 16)),
        titleInput, statusHolder, saveState,
        h('button.icon-btn', { title: 'Undo (⌘Z)', onclick: doUndo }, iconEl('undo', 15)),
        h('button.icon-btn', { title: 'Redo (⇧⌘Z)', onclick: doRedo }, iconEl('redo', 15)),
        deviceSeg,
        h('button.icon-btn', {
          title: 'Focused mode — hide the site header/footer while editing',
          class: focusedMode ? 'active-ic' : '',
          onclick: e => {
            focusedMode = !focusedMode
            setPref('focusedMode', focusedMode)
            e.currentTarget.classList.toggle('active-ic', focusedMode)
            iframe.src = previewSrc()
          },
        }, iconEl('eye', 15)),
        h('button.icon-btn', { title: 'Open preview in a new tab', onclick: () => window.open(`/preview/${doc.id}`, '_blank') }, iconEl('external', 15)),
        h('button.icon-btn', { title: 'Swap inspector side', onclick: () => { const appEl = document.querySelector('.app'); appEl.classList.toggle('insp-left'); setPref('inspLeft', appEl.classList.contains('insp-left')) } }, iconEl('swap', 15)),
        actionsHolder),
      previewWrap),
    inspector)

  if (prefs().inspW) root.style.setProperty('--insp-w', prefs().inspW)
  document.querySelector('.app')?.classList.toggle('insp-left', !!prefs().inspLeft)
  root.replaceChildren(editorEl)
  renderStatus(); renderActions(); renderInspector()

  // keyboard
  const onKey = e => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 's') { e.preventDefault(); save(true) }
    if (mod && !e.shiftKey && e.key === 'z' && !isTyping(e)) { e.preventDefault(); doUndo() }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); doRedo() }
    if (e.key === 'Delete' && selectedId && !isTyping(e)) {
      const found = findNode(selectedId)
      if (found) { snapshot(); found.siblings.splice(found.siblings.indexOf(found.node), 1); selectedId = null; markDirty(); renderTree(); renderInspector() }
    }
  }
  const isTyping = e => /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable
  addEventListener('keydown', onKey)

  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)

  return () => {
    removeEventListener('message', onBridgeMsg)
    removeEventListener('keydown', onKey)
    removeEventListener('beforeunload', beforeUnload)
    unfitPreview?.()
    scheduleSave.cancel()
    if (dirty) save(false)
  }
})
