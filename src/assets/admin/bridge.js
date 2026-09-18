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

  const style = document.createElement('style')
  style.textContent = `
    [data-wb]:hover { outline: 1.5px dashed color-mix(in srgb, #3e7d5f 60%, transparent); outline-offset: 3px; }
    [data-wb].wb-selected { outline: 2px solid #3e7d5f !important; outline-offset: 3px; position: relative; }
    [data-wbe] { cursor: text; }
    [data-wbe].wb-live { outline: 1.5px solid #3e7d5f; outline-offset: 2px; border-radius: 2px; background: color-mix(in srgb, #3e7d5f 6%, transparent); }
    .wb-flash { animation: wbflash .8s ease; }
    @keyframes wbflash { 0%, 40% { background-color: color-mix(in srgb, #3e7d5f 14%, transparent); } }
    .wb-toolbar { position: absolute; z-index: 999; display: flex; gap: 2px; background: #163527; border-radius: 8px; padding: 3px; box-shadow: 0 6px 20px #0005; }
    .wb-toolbar button { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 5px; background: transparent; color: #cfe8db; cursor: pointer; }
    .wb-toolbar button:hover { background: #24513c; color: #fff; }
    .wb-tip { position: absolute; top: -1.55rem; left: -2px; background: #3e7d5f; color: #fff; font: 600 10.5px/1.7 system-ui; padding: 0 7px; border-radius: 5px 5px 5px 0; z-index: 99; pointer-events: none; white-space: nowrap; }
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
    tip.textContent = el.dataset.wbType || 'block'
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
      b.type = 'button'; b.title = title; b.innerHTML = svg(d)
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        parent.postMessage({ blockhouse: 'blockaction', id: el.dataset.wb, action }, '*')
      })
      toolbar.appendChild(b)
    }
    el.appendChild(toolbar)
    if (notify) parent.postMessage({ blockhouse: 'select', id: el.dataset.wb }, '*')
  }

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
    if (el) { select(el, true); return }

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
    return el.dataset.wbeMode === 'md' ? domToMd(el) : el.innerText.replace(/\n+/g, ' ').trim()
  }

  document.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-wbe]')
    const block = el?.closest('[data-wb]')
    if (!el || !block) return
    e.preventDefault()
    if (editing && editing !== el) endEdit()
    editing = el
    select(block, true)
    clearChrome() // toolbar out of the way while typing
    const plain = el.dataset.wbeMode !== 'md'
    el.contentEditable = plain ? 'plaintext-only' : 'true'
    if (plain && el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'
    el.classList.add('wb-live')
    el.focus()
    parent.postMessage({ blockhouse: 'editstart', id: block.dataset.wb }, '*')
    const send = debounce(() => {
      parent.postMessage({ blockhouse: 'edit', id: block.dataset.wb, prop: el.dataset.wbe, value: serialize(el) }, '*')
    }, 250)
    el.oninput = send
    el.onblur = () => endEdit()
    el.onkeydown = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); endEdit() }
      if (ev.key === 'Enter' && plain) { ev.preventDefault(); endEdit() }
    }
  })

  function endEdit() {
    if (!editing) return
    const el = editing
    const block = el.closest('[data-wb]')
    editing = null
    el.contentEditable = 'false'
    el.classList.remove('wb-live')
    el.oninput = el.onblur = el.onkeydown = null
    if (block) parent.postMessage({ blockhouse: 'edit', id: block.dataset.wb, prop: el.dataset.wbe, value: serialize(el), final: true }, '*')
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
