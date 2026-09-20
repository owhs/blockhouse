// Editor preview bridge — runs inside the preview iframe when ?editor=1.
// Click-to-select, double-click inline editing (plain text + markdown rich
// text), a floating block toolbar, and scroll restore across reloads.
(function () {
  const KEY = 'blockhouse-preview-scroll'
  try {
    const y = sessionStorage.getItem(KEY)
    if (y) requestAnimationFrame(() => scrollTo(0, parseInt(y, 10)))
  } catch {}
  addEventListener('scroll', () => { try { sessionStorage.setItem(KEY, String(scrollY)) } catch {} }, { passive: true })

  // This stylesheet is injected into the PREVIEWED PAGE, not the studio, so the
  // studio's own tokens cannot reach it. Use the site's --accent where the
  // theme defines one, so the editor chrome belongs to the page it is drawn
  // over rather than being a fixed green on top of someone else's palette.
  const style = document.createElement('style')
  style.textContent = `
    :root { --wb: var(--accent, #3e7d5f); --wb-ink: var(--accent-contrast, #fff); }
    [data-wb]:hover { outline: 1.5px dashed color-mix(in srgb, var(--wb) 60%, transparent); outline-offset: 3px; }
    [data-wb].wb-selected { outline: 2px solid var(--wb) !important; outline-offset: 3px; position: relative; }
    [data-wbe], [data-wbf] { cursor: text; }
    /* A content field (the model name, a spec value) printed by the template.
       Same dashed hover as block text so "what can I change here" reads the
       same wherever the words came from. */
    [data-wbf]:hover { outline: 1.5px dashed color-mix(in srgb, var(--wb) 60%, transparent); outline-offset: 2px; }
    [data-wbf].wb-live { outline: 1.5px solid var(--wb); outline-offset: 2px; border-radius: 2px; background: color-mix(in srgb, var(--wb) 6%, transparent); }
    [data-wbe-img], [data-wbf-mode="img"] { cursor: pointer; }
    [data-wbf-mode="img"] { cursor: pointer; }
    [data-wbe-img]:hover { outline: 1.5px dashed color-mix(in srgb, var(--wb) 60%, transparent); outline-offset: 2px; }
    /* An emptied field renders as a zero-height void: nothing to see, nothing
       to double-click, no way back to it except the outline. Give it a visible
       placeholder so it stays a thing on the page. */
    [data-wbe]:empty::before, [data-wbf]:empty::before {
      content: "Empty — double-click to write";
      opacity: .45; font-style: italic; font-weight: 400;
      outline: 1px dashed color-mix(in srgb, var(--wb) 45%, transparent);
      outline-offset: 3px; display: inline-block; min-width: 12ch;
    }
    [data-wbe].wb-live { outline: 1.5px solid var(--wb); outline-offset: 2px; border-radius: 2px; background: color-mix(in srgb, var(--wb) 6%, transparent); }
    .wb-flash { animation: wbflash .8s ease; }
    @keyframes wbflash { 0%, 40% { background-color: color-mix(in srgb, var(--wb) 14%, transparent); } }
    .wb-toolbar { position: absolute; z-index: 999; display: flex; gap: 2px; background: color-mix(in srgb, var(--wb) 78%, #000); border-radius: 8px; padding: 3px; box-shadow: 0 6px 20px #0005; }
    .wb-toolbar button { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 5px; background: transparent; color: var(--wb-ink); cursor: pointer; }
    .wb-toolbar button:hover { background: color-mix(in srgb, var(--wb) 55%, #000); }
    .wb-dragging { opacity: 0.4; }
    .wb-droplinewrap { z-index: 100; pointer-events: none; border-top: 2px solid var(--wb); box-shadow: 0 0 0 1px var(--wb); }
    .wb-droplinewrap.wb-inside { border-top: 0; border: 2px dashed var(--wb); box-shadow: none; border-radius: 6px; background: color-mix(in oklch, var(--wb) 10%, transparent); }
    .wb-tip { position: absolute; top: -1.55rem; left: -2px; background: var(--wb); color: var(--wb-ink); font: 600 10.5px/1.7 system-ui; padding: 0 7px; border-radius: 5px 5px 5px 0; z-index: 99; pointer-events: none; white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { .wb-flash { animation: none; } }
  `
  document.head.appendChild(style)

  const I = {
    plus: 'M12 5v14M5 12h14',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
  }
  const svg = d => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`

  let selected = null
  let toolbar = null
  let tip = null

  function clearChrome() { toolbar?.remove(); toolbar = null; tip?.remove(); tip = null }

  function select(el, notify) {
    if (selected) { selected.classList.remove('wb-selected'); clearChrome() }
    selected = el
    if (!el) return
    el.classList.add('wb-selected')
    // type tip + floating toolbar
    const cs = getComputedStyle(el)
    if (cs.position === 'static') el.style.position = 'relative'
    tip = document.createElement('span')
    tip.className = 'wb-tip'
    // The chip is read by the person editing the page, so it says the block's
    // human name ("Hero slider"), the same one the outline and the inspector
    // use. The raw type key is only the fallback for an older preview render.
    tip.textContent = el.dataset.wbLabel || el.dataset.wbType || 'block'
    el.appendChild(tip)
    toolbar = document.createElement('div')
    toolbar.className = 'wb-toolbar'
    // A hero at the top of the page put its toolbar above the document, where
    // it could not be clicked — flip both chrome pieces inside when there is no
    // room above.
    const flip = el.getBoundingClientRect().top < 34
    toolbar.style.top = flip ? '4px' : '-1.7rem'
    toolbar.style.right = '0'
    if (flip) tip.style.top = '4px'
    const actions = [['up', 'Move up', I.up], ['down', 'Move down', I.down], ['add-after', 'Add block after', I.plus], ['duplicate', 'Duplicate', I.copy], ['delete', 'Delete', I.trash]]
    for (const [action, title, d] of actions) {
      const b = document.createElement('button')
      b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = svg(d)
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        parent.postMessage({ blockhouse: 'blockaction', id: el.dataset.wb, action }, '*')
      })
      toolbar.appendChild(b)
    }
    el.appendChild(toolbar)
    if (notify) parent.postMessage({ blockhouse: 'select', id: el.dataset.wb }, '*')
  }

  // ---------- drag and drop on the canvas ----------
  // Reordering only ever worked in the outline rail. The page itself — the
  // surface you are actually looking at — had no drag at all, and below 1400px
  // the rail is a closed drawer, so on a laptop there was no way to reorder a
  // block by pointer. The bridge decides WHERE relative to a block; the editor
  // owns the tree and resolves that into a parent and an index.
  let dragId = null
  let line = null

  const showLine = (el, where) => {
    if (!line) {
      line = document.createElement('div')
      line.className = 'wb-droplinewrap'
      document.body.appendChild(line)
    }
    const r = el.getBoundingClientRect()
    const inside = where === 'inside'
    Object.assign(line.style, {
      position: 'fixed', left: r.left + 'px', width: r.width + 'px',
      top: (where === 'before' ? r.top : where === 'after' ? r.bottom : r.top) + 'px',
      height: inside ? r.height + 'px' : '0px',
    })
    line.classList.toggle('wb-inside', inside)
  }
  const hideLine = () => { line?.remove(); line = null }

  /** Where a drop at this point lands relative to `el`. */
  function dropWhere(el, clientY) {
    const r = el.getBoundingClientRect()
    const edge = Math.min(24, r.height * 0.25)
    if (clientY < r.top + edge) return 'before'
    if (clientY > r.bottom - edge) return 'after'
    return el.dataset.wbContainer === '1' ? 'inside' : (clientY < r.top + r.height / 2 ? 'before' : 'after')
  }

  document.addEventListener('dragstart', e => {
    const el = e.target.closest?.('[data-wb]')
    if (!el || e.target.isContentEditable) return
    dragId = el.dataset.wb
    el.classList.add('wb-dragging')
    e.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag without data on the transfer
    try { e.dataTransfer.setData('text/plain', dragId) } catch {}
  })

  document.addEventListener('dragover', e => {
    if (!dragId) return
    const el = e.target.closest?.('[data-wb]')
    if (!el || el.dataset.wb === dragId || el.closest(`[data-wb="${CSS.escape(dragId)}"]`)) { hideLine(); return }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    showLine(el, dropWhere(el, e.clientY))
  })

  document.addEventListener('drop', e => {
    if (!dragId) return
    const el = e.target.closest?.('[data-wb]')
    hideLine()
    if (!el || el.dataset.wb === dragId || el.closest(`[data-wb="${CSS.escape(dragId)}"]`)) return
    e.preventDefault()
    parent.postMessage({ blockhouse: 'blockdrop', id: dragId, target: el.dataset.wb, where: dropWhere(el, e.clientY) }, '*')
  })

  const endDrag = () => {
    document.querySelector('.wb-dragging')?.classList.remove('wb-dragging')
    hideLine(); dragId = null
  }
  document.addEventListener('dragend', endDrag)
  document.addEventListener('drop', endDrag)

  // ---------- selection + provenance ----------
  // Inside the editor NOTHING navigates. Content blocks select; anything else
  // (header, nav, footer, toggles) reports where it comes from, so the studio
  // can offer “edit the menu / the template / the design” jumps.
  document.addEventListener('click', e => {
    if (e.target.isContentEditable || e.target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) return
    if (e.target.closest('.wb-toolbar')) return

    // Overlays a theme's own runtime script bolts onto <body> (an enlarged
    // image viewer, in practice) are app chrome, not page content — leave
    // them alone entirely. Without this, clicking anywhere inside one
    // (including its own close button) got intercepted here first: this
    // handler doesn't know the element, so it fell into the "what is this"
    // dialog below instead of ever reaching the overlay's own close logic —
    // an overlay you could open but never dismiss.
    if (e.target.closest('.sm-lb, .lightbox-overlay')) return

    // Purely visual, non-navigating controls — a tab switch, an accordion
    // opening — are let through instead of swallowed. Nothing about them
    // leaves the page or loses content, they're just how you reach content
    // that's hidden until you interact with it, and an editor where you can't
    // see what's in the second tab isn't very useful. The containing block
    // still gets selected, so the inspector stays in sync; everything else
    // (real links, nav, submit buttons) keeps the normal "select, don't
    // activate" rule below.
    const safeControl = e.target.closest('[role="tab"], summary')
    if (safeControl) {
      const block = safeControl.closest('[data-wb]')
      if (block) select(block, true)
      return
    }

    const el = e.target.closest('[data-wb]')
    e.preventDefault()
    e.stopPropagation()
    if (el) {
      // A site's own script may also listen on `document` for clicks on a
      // picture and raise an image viewer over the whole canvas. This handler
      // is registered first (bridge.js is a classic script; the site runtime is
      // a module, so it runs later), so cutting the event dead here is what
      // stops the viewer opening at all — `stopPropagation` alone leaves other
      // listeners on `document` itself free to run.
      if (e.target.closest('img, picture, figure')) e.stopImmediatePropagation()
      select(el, true)
      // One click on words — a heading, a paragraph, a button's label — puts
      // the caret in them. Nobody expects to double-click a page to edit it,
      // and a button that only "selects" reads as a button that does nothing.
      const txt = e.target.closest('[data-wbe]')
      if (txt && el.contains(txt) && !e.target.closest('img, picture, figure')) {
        startEdit(txt)
        return
      }
      // A picture cannot be typed into, so clicking one takes you to the field
      // that chooses it, already scrolled to and flashing.
      const img = e.target.closest('[data-wbe-img]')
      if (img && el.contains(img)) {
        parent.postMessage({ blockhouse: 'focusprop', id: el.dataset.wb, prop: img.dataset.wbeImg }, '*')
      }
      return
    }

    // Words the template printed from this page's own details (a product's
    // model name, a spec value). Not a block - but still this page's content,
    // so send the person to the field that holds it.
    const ff = e.target.closest('[data-wbf]')
    if (ff) {
      parent.postMessage({ blockhouse: 'field', key: ff.dataset.wbf }, '*')
      if (ff.dataset.wbfMode !== 'img') startEdit(ff)
      return
    }

    // A block placed in the header or footer, shown on every page.
    const slotEl = e.target.closest('[data-wb-slot]')
    if (slotEl) {
      parent.postMessage({ blockhouse: 'slotblock', slot: slotEl.dataset.wbSlot, blockId: slotEl.dataset.wbSlotBlock || '' }, '*')
      return
    }

    const options = []
    const menuSrc = e.target.closest('[data-blockhouse-src^="menu:"]')
    if (menuSrc) options.push({ kind: 'menu', key: menuSrc.dataset.blockhouseSrc.slice(5) })
    if (e.target.closest('.site-header')) options.push({ kind: 'header' })
    if (e.target.closest('.site-footer')) options.push({ kind: 'footer' })
    if (e.target.closest('[data-blockhouse="theme"], .theme-toggle')) options.push({ kind: 'design' })
    const a = e.target.closest('a')
    parent.postMessage({
      blockhouse: 'provenance',
      options,
      href: a ? a.getAttribute('href') : null,
      text: (e.target.closest('a, button')?.textContent || e.target.textContent || '').trim().slice(0, 60),
    }, '*')
  }, true)
  // belt & braces: even if a click slips through, never leave the preview
  document.addEventListener('auxclick', e => { if (e.target.closest('a')) e.preventDefault() }, true)
  addEventListener('beforeunload', () => { try { sessionStorage.setItem(KEY, String(scrollY)) } catch {} })
  document.addEventListener('submit', e => e.preventDefault(), true)

  // ---------- inline editing ----------
  let editing = null
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

  function domToMd(root) {
    const inline = node => {
      let s = ''
      for (const child of node.childNodes) {
        if (child.nodeType === 3) s += child.textContent.replace(/\n/g, ' ')
        else if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase()
          const inner = inline(child)
          if (tag === 'strong' || tag === 'b') s += inner.trim() ? `**${inner}**` : inner
          else if (tag === 'em' || tag === 'i') s += inner.trim() ? `*${inner}*` : inner
          else if (tag === 'code') s += `\`${child.textContent}\``
          else if (tag === 'a') s += `[${inner}](${child.getAttribute('href') || '#'})`
          else if (tag === 'br') s += '\n'
          else s += inner
        }
      }
      return s
    }
    const out = []
    for (const child of root.children.length ? root.children : [root]) {
      const tag = child.tagName?.toLowerCase() || 'p'
      if (/^h[1-6]$/.test(tag)) out.push(`${'#'.repeat(Math.max(2, +tag[1]))} ${inline(child).trim()}`)
      else if (tag === 'blockquote') out.push(inline(child).trim().split('\n').map(l => `> ${l}`).join('\n'))
      else if (tag === 'ul') out.push([...child.children].map(li => `- ${inline(li).trim()}`).join('\n'))
      else if (tag === 'ol') out.push([...child.children].map((li, i) => `${i + 1}. ${inline(li).trim()}`).join('\n'))
      else if (tag === 'pre') out.push('```\n' + child.textContent.replace(/\n$/, '') + '\n```')
      else if (tag === 'hr') out.push('---')
      else { const t = inline(child).trim(); if (t) out.push(t) }
    }
    return out.join('\n\n')
  }

  function serialize(el) {
    const mode = el.dataset.wbf != null ? el.dataset.wbfMode : el.dataset.wbeMode
    return mode === 'md' ? domToMd(el) : el.innerText.replace(/\n+/g, ' ').trim()
  }

  /** The edit message for an editable element - a block prop or a page field. */
  function editMsg(el, extra) {
    if (el.dataset.wbf != null) {
      return { blockhouse: 'fieldedit', key: el.dataset.wbf, value: serialize(el), ...extra }
    }
    const block = el.closest('[data-wb]')
    return { blockhouse: 'edit', id: block?.dataset.wb, prop: el.dataset.wbe, value: serialize(el), ...extra }
  }

  function startEdit(el) {
    if (!el || editing === el) return
    // A picture is chosen from the library, not typed. One click already sent
    // the person to the field that chooses it.
    if (el.dataset.wbfMode === 'img') return
    const block = el.closest('[data-wb]')
    // A block prop needs its block; a page field stands on its own.
    const isField = el.dataset.wbf != null
    if (!isField && !block) return
    if (editing && editing !== el) endEdit()
    editing = el
    if (block) select(block, true)
    clearChrome() // toolbar out of the way while typing
    const plain = (isField ? el.dataset.wbfMode : el.dataset.wbeMode) !== 'md'
    el.contentEditable = plain ? 'plaintext-only' : 'true'
    if (plain && el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'
    el.classList.add('wb-live')
    el.focus()
    parent.postMessage({ blockhouse: 'editstart', id: block?.dataset.wb, field: isField ? el.dataset.wbf : null }, '*')
    const send = debounce(() => parent.postMessage(editMsg(el), '*'), 250)
    el.oninput = send
    el.onblur = () => endEdit()
    el.onkeydown = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); endEdit() }
      if (ev.key === 'Enter' && plain) { ev.preventDefault(); endEdit() }
    }
  }
  document.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-wbe], [data-wbf]')
    if (el) { e.preventDefault(); startEdit(el) }
  })

  function endEdit() {
    if (!editing) return
    const el = editing
    const block = el.closest('[data-wb]')
    editing = null
    el.contentEditable = 'false'
    el.classList.remove('wb-live')
    el.oninput = el.onblur = el.onkeydown = null
    parent.postMessage(editMsg(el, { final: true }), '*')
    parent.postMessage({ blockhouse: 'editend', id: block?.dataset.wb }, '*')
  }

  // ---------- messages from the studio ----------
  addEventListener('message', e => {
    const m = e.data || {}
    if (m.blockhouse === 'highlight') {
      const el = document.querySelector(`[data-wb="${CSS.escape(m.id)}"]`)
      if (el) {
        select(el, false)
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.remove('wb-flash'); void el.offsetWidth; el.classList.add('wb-flash')
      }
    }
    if (m.blockhouse === 'clear') select(null, false)

    // Targeted patch: the studio sends one changed prop and we update the node
    // in place. Reloading the whole iframe on every keystroke is what made
    // typing feel like it was fighting the preview.
    // Flash the words on the page that a studio field controls, so a change
    // made in the inspector can be found on the page it affects.
    if (m.blockhouse === 'flashfield' && m.key) {
      const el = document.querySelector(`[data-wbf="${CSS.escape(m.key)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.remove('wb-flash'); void el.offsetWidth; el.classList.add('wb-flash')
      }
    }
    if (m.blockhouse === 'patchfield' && m.key) {
      const el = document.querySelector(`[data-wbf="${CSS.escape(m.key)}"]`)
      if (!el || el === editing) return
      if (el.dataset.wbfMode === 'md') parent.postMessage({ blockhouse: 'needsreload' }, '*')
      else el.textContent = m.value
      return
    }
    if (m.blockhouse === 'patch' && m.id) {
      const block = document.querySelector(`[data-wb="${CSS.escape(m.id)}"]`)
      const target = block?.querySelector(`[data-wbe="${CSS.escape(m.prop)}"]`)
        || (block?.dataset.wbe === m.prop ? block : null)
      if (target && target !== editing) {
        if (target.dataset.wbeMode === 'md') parent.postMessage({ blockhouse: 'needsreload' }, '*')
        else { target.textContent = m.value; parent.postMessage({ blockhouse: 'patched', id: m.id }, '*') }
      } else if (!target) {
        parent.postMessage({ blockhouse: 'needsreload' }, '*')
      }
    }
  })

  parent.postMessage({ blockhouse: 'ready' }, '*')
})()
