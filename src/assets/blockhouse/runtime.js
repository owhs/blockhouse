// Blockhouse site runtime — ~4KB of progressive enhancement, no framework.
// Theme toggle · mobile nav + mega menus · hover/viewport prefetch ·
// block enhancers (tabs, lightbox, embed facades, ajax forms, reveal).

const doc = document

// The studio frames real pages in its Design, Header & footer, Menus and page
// previews. Those frames are a picture of the site, not a visit to it: nothing
// that greets a first-time visitor (consent banner, theme-toggle nudge, any
// timed pop-up) belongs in them, and nothing may drift open on its own.
// The server sets data-bh-preview on <html> — see src/render/page.ts.
// The Navigation page's preview is the exception: it is meant to show the
// panel being edited, already open, so it only gets the banner suppression.
const PREVIEW = doc.documentElement.getAttribute('data-bh-preview')
const PREVIEW_MENU = PREVIEW === 'menu'

// ---------- theme ----------
for (const btn of doc.querySelectorAll('[data-blockhouse="theme"]')) {
  btn.addEventListener('click', () => {
    const cur = doc.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next = cur === 'dark' ? 'light' : 'dark'
    doc.documentElement.dataset.theme = next
    try { localStorage.setItem('blockhouse-theme', next) } catch {}
  })
}

// ---------- nav: burger, drill-down (mobile), panels, showcase detail sync ----------
const mobileNav = () => matchMedia('(max-width: 1000px)').matches
const burger = doc.querySelector('[data-blockhouse="burger"]')
const headerNav = doc.querySelector('.site-header .nav')

function closeAllPanels() {
  for (const o of doc.querySelectorAll('.nav-item.open, .nav-item.drilled')) {
    o.classList.remove('open', 'drilled')
    o.querySelector('.nav-link')?.setAttribute('aria-expanded', 'false')
  }
}
if (burger) burger.addEventListener('click', () => {
  const open = doc.body.classList.toggle('nav-open')
  burger.setAttribute('aria-expanded', String(open))
  if (!open) closeAllPanels()
})

for (const item of (headerNav || doc).querySelectorAll('.nav-item.has-mega, .nav-item.has-drop')) {
  const btn = item.querySelector(':scope > .nav-link')
  if (!btn) continue
  btn.addEventListener('click', e => {
    e.preventDefault()
    if (mobileNav()) {
      // drill in
      closeAllPanels()
      item.classList.add('drilled')
      btn.setAttribute('aria-expanded', 'true')
      item.querySelector('.drill-head')?.scrollIntoView({ block: 'nearest' })
    } else {
      const open = item.classList.toggle('open')
      btn.setAttribute('aria-expanded', String(open))
      for (const other of doc.querySelectorAll('.nav-item.open')) {
        if (other !== item) { other.classList.remove('open'); other.querySelector('.nav-link')?.setAttribute('aria-expanded', 'false') }
      }
    }
  })
  // drill back button
  item.querySelector('.drill-back')?.addEventListener('click', () => {
    item.classList.remove('drilled')
    btn.setAttribute('aria-expanded', 'false')
  })
}
doc.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const drilled = doc.querySelector('.nav-item.drilled')
    if (drilled) { drilled.classList.remove('drilled'); return }
    if (doc.body.classList.contains('nav-open')) { doc.body.classList.remove('nav-open'); burger?.setAttribute('aria-expanded', 'false'); return }
    closeAllPanels()
  }
})
doc.addEventListener('click', e => {
  if (!mobileNav() && !e.target.closest('.nav-item')) closeAllPanels()
})

// showcase mega: hovering/focusing a card swaps the detail pane
for (const showcase of doc.querySelectorAll('.mega-showcase')) {
  const cards = [...showcase.querySelectorAll('.mega-card')]
  const panes = [...showcase.querySelectorAll('.mm-pane')]
  const activate = id => {
    for (const cd of cards) cd.classList.toggle('active', cd.dataset.mm === id)
    for (const pn of panes) {
      const on = pn.dataset.mmPane === id
      pn.classList.toggle('active', on)
      pn.hidden = !on
    }
  }
  for (const card of cards) {
    card.addEventListener('mouseenter', () => { if (!mobileNav()) activate(card.dataset.mm) })
    card.addEventListener('focus', () => { if (!mobileNav()) activate(card.dataset.mm) })
    card.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      if (!dir) return
      e.preventDefault()
      const i = cards.indexOf(card)
      const nxt = cards[(i + dir + cards.length) % cards.length]
      nxt.focus()
    })
  }
}

// catalogue mega: category tabs across the top, item list ↔ detail pane sync.
// On mobile the tab bar becomes an accordion inside the drill-down.
for (const cat of doc.querySelectorAll('.mega-catalogue')) {
  const tabBtns = [...cat.querySelectorAll('.mc-tab-btn')]
  const tabPanes = [...cat.querySelectorAll('.mc-tabpane')]
  const showTab = id => {
    for (const b of tabBtns) { const on = b.dataset.mctab === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)) }
    for (const p of tabPanes) { const on = p.dataset.mctabPane === id; p.classList.toggle('active', on); p.hidden = mobileNav() ? p.hidden : !on }
  }
  for (const b of tabBtns) {
    b.addEventListener('click', () => {
      if (mobileNav()) {
        // accordion: toggle just this tab's pane
        const pane = tabPanes.find(p => p.dataset.mctabPane === b.dataset.mctab)
        const open = pane && pane.hidden
        for (const p of tabPanes) p.hidden = true
        for (const x of tabBtns) x.classList.remove('active')
        if (open && pane) { pane.hidden = false; b.classList.add('active') }
      } else showTab(b.dataset.mctab)
    })
    b.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!dir) return
      e.preventDefault()
      const i = tabBtns.indexOf(b)
      const nxt = tabBtns[(i + dir + tabBtns.length) % tabBtns.length]
      nxt.focus(); nxt.click()
    })
  }
  // items ↔ detail panes, scoped per tab
  for (const tabPane of tabPanes) {
    const items = [...tabPane.querySelectorAll('.mc-item')]
    const panes = [...tabPane.querySelectorAll('.mc-pane')]
    const activate = id => {
      for (const it of items) it.classList.toggle('active', it.dataset.mc === id)
      for (const pn of panes) { const on = pn.dataset.mcPane === id; pn.classList.toggle('active', on); pn.hidden = !on }
    }
    for (const it of items) {
      it.addEventListener('mouseenter', () => { if (!mobileNav()) activate(it.dataset.mc) })
      it.addEventListener('focus', () => { if (!mobileNav()) activate(it.dataset.mc) })
      it.addEventListener('keydown', e => {
        const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
        if (!dir) return
        e.preventDefault()
        items[(items.indexOf(it) + dir + items.length) % items.length].focus()
      })
    }
  }
  // mobile initial state: collapse all accordion sections except the first
  if (mobileNav()) {
    tabPanes.forEach((p, i) => (p.hidden = i !== 0))
  }
}

// ---------- preview: no greetings, nothing hanging open ----------
if (PREVIEW) {
  if (!PREVIEW_MENU) {
    closeAllPanels()
    doc.body.classList.remove('nav-open', 'mega-open')
    doc.documentElement.classList.remove('mega-open')
  }
  // belt and braces: a banner that slipped through (a cached page, a plugin
  // that injects its own) is removed rather than left floating over the design
  for (const el of doc.querySelectorAll('#blockhouse-consent, .blockhouse-consent, [data-bh-popup]')) el.remove()
}

// The Navigation page's preview is a picture of the draft menu, not a visit to
// the site: following a link threw the draft away and left the owner on the
// real page with no way back. Every link and form in that frame is dead; a
// click on a menu entry instead tells the studio to select that entry, so the
// preview behaves like part of the editor.
if (PREVIEW_MENU) {
  const tellParent = id => {
    try { parent.postMessage({ blockhouse: 'menuselect', id }, '*') } catch {}
  }
  doc.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]')
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    const navId = a.closest('[data-nav-id]')?.getAttribute('data-nav-id')
    if (navId) tellParent(navId)
  }, true)
  doc.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation() }, true)
  doc.addEventListener('auxclick', e => { if (e.target.closest?.('a[href]')) e.preventDefault() }, true)
}

// ---------- studio preview hooks (only when framed by the editor) ----------
// ?__open=<menu item id> auto-opens that nav panel so the menu editor's live
// preview shows the panel being edited without a human click.
if (window.self !== window.top) {
  const openId = new URLSearchParams(location.search).get('__open')
  if (openId) {
    const li = doc.querySelector(`.nav-item[data-nav-id="${CSS.escape(openId)}"]`)
    const btn = li?.querySelector(':scope > .nav-link')
    if (li && btn && (li.classList.contains('has-mega') || li.classList.contains('has-drop'))) {
      li.classList.add('open')
      btn.setAttribute('aria-expanded', 'true')
    }
  }
  // live design-token injection from the Design view — instant, no reload
  addEventListener('message', e => {
    const m = e.data || {}
    if (m.blockhouse === 'tokens' && m.tokens) {
      for (const [k, v] of Object.entries(m.tokens)) {
        if (v === null || v === '') doc.documentElement.style.removeProperty(`--${k}`)
        else doc.documentElement.style.setProperty(`--${k}`, String(v))
      }
    }
    if (m.blockhouse === 'scrolltop') scrollTo({ top: 0 })
  })
}

// ---------- prefetch (backs up speculation rules on other browsers) ----------
const prefetched = new Set()
function prefetch(href) {
  if (prefetched.has(href) || href.includes('#')) return
  const u = new URL(href, location.href)
  if (u.origin !== location.origin || u.pathname.startsWith('/admin') || u.pathname.startsWith('/api')) return
  prefetched.add(href)
  const l = doc.createElement('link')
  l.rel = 'prefetch'; l.href = u.pathname
  doc.head.appendChild(l)
}
if (!navigator.connection?.saveData) {
  doc.addEventListener('mouseover', e => {
    const a = e.target.closest?.('a[href^="/"]')
    if (a) prefetch(a.getAttribute('href'))
  }, { passive: true })
  doc.addEventListener('touchstart', e => {
    const a = e.target.closest?.('a[href^="/"]')
    if (a) prefetch(a.getAttribute('href'))
  }, { passive: true })
}

// ---------- enhancers (loaded per page via body[data-blockhouse-enhance]) ----------
const wants = new Set((doc.body.dataset.blockhouseEnhance || '').split(' ').filter(Boolean))

// tabs — roving tabindex, arrow keys
if (wants.has('tabs')) for (const tabs of doc.querySelectorAll('[data-tabs]')) {
  const btns = [...tabs.querySelectorAll('[role=tab]')]
  const panels = [...tabs.querySelectorAll(':scope > [role=tabpanel]')]
  const select = i => btns.forEach((b, j) => {
    b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1
    if (panels[j]) panels[j].hidden = i !== j
  })
  btns.forEach((b, i) => {
    b.addEventListener('click', () => select(i))
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (d) { e.preventDefault(); const n = (i + d + btns.length) % btns.length; select(n); btns[n].focus() }
    })
  })
}

// faq — optional single-open behaviour
if (wants.has('faq')) for (const faq of doc.querySelectorAll('.wb-faq[data-single]')) {
  faq.addEventListener('toggle', e => {
    if (e.target.open) for (const d of faq.querySelectorAll('details[open]')) if (d !== e.target) d.open = false
  }, true)
}

// lightbox
if (wants.has('lightbox')) doc.addEventListener('click', e => {
  const fig = e.target.closest?.('[data-lightbox]')
  if (!fig) return
  const img = fig.querySelector('img')
  if (!img) return
  e.preventDefault()
  const overlay = doc.createElement('div')
  overlay.className = 'lightbox-overlay'
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', img.alt || 'Image')
  const big = new Image()
  big.src = img.currentSrc || img.src; big.alt = img.alt || ''
  overlay.appendChild(big)
  const close = () => { overlay.remove(); doc.removeEventListener('keydown', onKey) }
  const onKey = ev => ev.key === 'Escape' && close()
  overlay.addEventListener('click', close)
  doc.addEventListener('keydown', onKey)
  doc.body.appendChild(overlay)
})

// embed facades — swap in the iframe only on demand
if (wants.has('embed')) doc.addEventListener('click', e => {
  const facade = e.target.closest?.('.embed-facade')
  const host = facade?.closest('[data-embed]')
  if (!host) return
  const iframe = doc.createElement('iframe')
  iframe.src = host.dataset.embed
  iframe.title = host.dataset.title || 'Embedded content'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
  iframe.allowFullscreen = true
  host.replaceChildren(iframe)
})

// forms — ajax submit with inline status (falls back to normal POST without JS)
if (wants.has('form')) for (const form of doc.querySelectorAll('[data-blockhouse-form]')) {
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const status = form.querySelector('.form-status')
    const btn = form.querySelector('[type=submit]')
    btn && (btn.disabled = true)
    status && (status.textContent = '…', status.className = 'form-status')
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' } })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        status && (status.textContent = json.message || 'Thanks!', status.classList.add('ok'))
        form.reset()
      } else {
        status && (status.textContent = json.error || 'Something went wrong — try again.', status.classList.add('err'))
      }
    } catch {
      status && (status.textContent = 'Network error — try again.', status.classList.add('err'))
    }
    btn && (btn.disabled = false)
  })
}

// external-engine search forms: merge site: for google, expand {q} templates
for (const form of doc.querySelectorAll('form.wb-search-ext')) {
  form.addEventListener('submit', e => {
    const input = form.querySelector('input[type="search"]')
    const q = (input?.value || '').trim()
    const siteHost = form.dataset.sitesearch
    if (siteHost && input) input.value = `site:${siteHost} ${q}`
    const tpl = form.dataset.searchurl
    if (tpl) { e.preventDefault(); location.href = tpl.replace('{q}', encodeURIComponent(q)) }
  })
}

// instant search
if (wants.has('search')) for (const box of doc.querySelectorAll('[data-search]')) {
  const input = box.querySelector('input')
  const results = box.querySelector('.search-results')
  const source = box.dataset.source || 'api'
  let staticIndex = null
  const rankStatic = (entries, q) => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return entries.map(e => {
      let s = 0; const t = (e.title || '').toLowerCase()
      for (const term of terms) { if (t.includes(term)) s += 10; s += Math.min((e.text || '').split(term).length - 1, 8) }
      return { e, s }
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.e)
  }
  const show = list => {
    if (!list.length) { results.innerHTML = '<div class="search-empty">No results</div>'; results.hidden = false; return }
    results.innerHTML = list.map(r => `<a href="${r.path}" role="option"><strong>${escapeHtml(r.title)}</strong>${r.excerpt ? `<span>${escapeHtml(r.excerpt)}</span>` : ''}</a>`).join('')
    results.hidden = false
  }
  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const run = async q => {
    if (!q) { results.hidden = true; return }
    if (source === 'static') {
      if (!staticIndex) staticIndex = (await fetch('/x/search/index.json').then(r => r.json()).catch(() => ({ entries: [] }))).entries
      show(rankStatic(staticIndex, q))
    } else {
      const { results: list } = await fetch('/x/search/api?q=' + encodeURIComponent(q)).then(r => r.json()).catch(() => ({ results: [] }))
      show(list)
    }
  }
  let t
  input.addEventListener('input', () => {
    clearTimeout(t)
    const q = input.value.trim()
    if (!q) { results.hidden = true; return }
    t = setTimeout(() => run(q), 180)
  })

  // Arriving with ?q= (a submitted search form, or a shared link) should show
  // the results, not an empty box the visitor has to retype into.
  const initial = new URLSearchParams(location.search).get('q')
  if (initial && initial.trim()) { input.value = initial; run(initial.trim()) }
  doc.addEventListener('click', e => { if (!box.contains(e.target)) results.hidden = true })
  input.addEventListener('focus', () => { if (input.value.trim() && results.innerHTML) results.hidden = false })
}

// member portal — fills in the signed-in state
if (wants.has('members')) for (const portal of doc.querySelectorAll('[data-member-portal]')) {
  fetch('/x/members/me', { headers: { accept: 'application/json' } })
    .then(r => r.json())
    .then(({ member }) => {
      const inEl = portal.querySelector('.mp-signed-in')
      const outEl = portal.querySelector('.mp-signed-out')
      if (member) {
        inEl.hidden = false
        portal.querySelector('.mp-identity').textContent = `${member.name || ''} ${member.email}`.trim()
        // deliveries issued to this account (files plugin, if enabled)
        fetch('/x/files/mine', { headers: { accept: 'application/json' } }).then(r => r.ok ? r.json() : { files: [] }).then(({ files }) => {
          const box = portal.querySelector('.mp-files')
          if (!box || !files?.length) return
          box.hidden = false
          box.querySelector('.mp-file-list').innerHTML = files.map(f =>
            `<li><a href="/x/files/portal/${encodeURIComponent(f.id)}">${(f.label || f.file).replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch]))}</a>` +
            (f.maxUses ? ` <small>${f.uses}/${f.maxUses} downloads used</small>` : '') + `</li>`).join('')
        }).catch(() => {})
        const nameInput = portal.querySelector('input[name=name]')
        if (nameInput) nameInput.value = member.name || ''
      } else outEl.hidden = false
    })
    .catch(() => { portal.querySelector('.mp-signed-out').hidden = false })
}

// share (copy link)
if (wants.has('share')) doc.addEventListener('click', async e => {
  const btn = e.target.closest?.('[data-share-copy]')
  if (!btn) return
  try {
    await navigator.clipboard.writeText(btn.dataset.shareCopy)
    const span = btn.querySelector('span')
    const old = span.textContent
    span.textContent = 'Copied!'
    setTimeout(() => (span.textContent = old), 1600)
  } catch {}
})

// reveal on view
// In the studio preview the frame is scaled and scrolled independently, so an
// on-scroll reveal left blocks permanently faded out. Show them all at once
// there; on the real site nothing changes.
if (wants.has('reveal') && !doc.documentElement.hasAttribute('data-bh-preview')) {
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) }
  }, { threshold: 0.2 })
  for (const el of doc.querySelectorAll('.reveal')) io.observe(el)
} else if (wants.has('reveal')) {
  for (const el of doc.querySelectorAll('.reveal')) el.classList.add('in')
}

// ---------- drive (client document portal) ----------
if (wants.has('drive')) for (const root of doc.querySelectorAll('[data-blockhouse-enhance="drive"]')) {
  const holder = root.querySelector('[data-drive-areas]')
  const tpl = root.querySelector('template[data-drive-request]')
  const draw = async () => {
    let data
    try { data = await (await fetch('/x/drive/mine')).json() } catch { holder.innerHTML = '<p class="drive-note">The portal is unavailable right now.</p>'; return }
    holder.replaceChildren()
    if (!data.areas.length) { holder.innerHTML = '<p class="drive-note">No document areas are published yet.</p>'; return }
    for (const a of data.areas) {
      const box = document.createElement('div')
      box.className = 'drive-area' + (a.allowed ? ' open' : ' locked')
      let inner = `<div class="drive-area-head"><h3>${a.label}</h3><span class="drive-badge">${a.allowed ? (a.files?.length || 0) + ' files' : 'restricted'}</span></div>`
      if (a.description) inner += `<p class="drive-desc">${a.description}</p>`
      if (a.allowed) {
        inner += a.files?.length
          ? `<ul class="drive-files">${a.files.map(f => `<li><a href="${f.href}" download>${f.rel}</a></li>`).join('')}</ul>`
          : '<p class="drive-note">Nothing here yet.</p>'
      } else if (a.requestable) {
        inner += `<button class="btn btn-ghost drive-ask" data-area="${a.id}" data-label="${a.label}">Request access</button>`
      }
      box.innerHTML = inner
      holder.appendChild(box)
    }
    if (!data.signedIn) {
      const p = document.createElement('p')
      p.className = 'drive-note'
      p.innerHTML = 'Already approved? <a href="/account">Sign in</a> with your work email to see your files.'
      holder.appendChild(p)
    }
  }
  holder.addEventListener('click', e => {
    const btn = e.target.closest('.drive-ask')
    if (!btn || !tpl) return
    const form = tpl.content.firstElementChild.cloneNode(true)
    form.querySelector('[data-area-label]').textContent = btn.dataset.label
    form.dataset.area = btn.dataset.area
    btn.replaceWith(form)
    form.addEventListener('submit', async ev => {
      ev.preventDefault()
      const fd = new FormData(form)
      const status = form.querySelector('.drive-status')
      try {
        const r = await (await fetch('/x/drive/request', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ area: form.dataset.area, email: fd.get('email'), role: fd.get('role'), company: fd.get('company'), note: fd.get('note') }),
        })).json()
        status.textContent = r.message || r.error || 'Done.'
        if (r.ok) form.querySelector('button[type=submit]').disabled = true
      } catch { status.textContent = 'Could not send the request — try again.' }
    })
  })
  draw()
}

// ---------- commerce (cart + checkout) ----------
if (wants.has('cart')) (() => {
  const KEY = 'blockhouse_cart'
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
  const write = items => { try { localStorage.setItem(KEY, JSON.stringify(items)) } catch {} }

  for (const btn of doc.querySelectorAll('[data-add-sku]')) {
    btn.addEventListener('click', () => {
      const sku = btn.dataset.addSku
      if (!sku) return
      const items = read()
      const hit = items.find(i => i.sku === sku)
      if (hit) hit.qty = (hit.qty || 1) + 1
      else items.push({ sku, qty: 1 })
      write(items)
      const old = btn.textContent
      btn.textContent = 'Added ✓'
      setTimeout(() => (btn.textContent = old), 1200)
    })
  }

  const cartEl = doc.querySelector('[data-cart]')
  if (!cartEl) return
  const linesEl = cartEl.querySelector('[data-cart-lines]')
  const form = cartEl.querySelector('.cart-checkout')
  const money = (v, cur) => `${{ GBP: '£', EUR: '€', USD: '$' }[cur] || cur + ' '}${v.toFixed(2)}`

  const draw = async () => {
    const items = read()
    if (!items.length) { linesEl.innerHTML = '<p class="cart-note">Your cart is empty.</p>'; form.hidden = true; return }
    let quote
    try {
      quote = await (await fetch('/x/commerce/quote', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }),
      })).json()
    } catch { linesEl.innerHTML = '<p class="cart-note">Pricing is unavailable right now.</p>'; return }
    linesEl.innerHTML = `<table class="cart-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody>` +
      quote.lines.map(l => `<tr data-sku="${l.sku}"><td>${l.title}${l.stock != null && l.stock < 5 ? ` <span class="cart-low">only ${l.stock} left</span>` : ''}</td>` +
        `<td><input class="cart-qty" type="number" min="1" max="999" value="${l.qty}"></td>` +
        `<td>${money(l.subtotal, quote.currency)}</td><td><button class="cart-rm" aria-label="Remove">×</button></td></tr>`).join('') +
      `</tbody><tfoot><tr><td colspan="2">Total</td><td colspan="2"><strong>${money(quote.total, quote.currency)}</strong></td></tr></tfoot></table>`
    form.hidden = false
  }

  linesEl.addEventListener('change', e => {
    const input = e.target.closest('.cart-qty')
    if (!input) return
    const sku = input.closest('tr').dataset.sku
    const items = read()
    const hit = items.find(i => i.sku === sku)
    if (hit) { hit.qty = Math.max(1, parseInt(input.value, 10) || 1); write(items); draw() }
  })
  linesEl.addEventListener('click', e => {
    const rm = e.target.closest('.cart-rm')
    if (!rm) return
    const sku = rm.closest('tr').dataset.sku
    write(read().filter(i => i.sku !== sku)); draw()
  })

  form?.addEventListener('submit', async e => {
    e.preventDefault()
    const fd = new FormData(form)
    const status = form.querySelector('.cart-status')
    status.textContent = 'Placing order…'
    try {
      const r = await (await fetch('/x/commerce/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: read(), name: fd.get('name'), email: fd.get('email'), company: fd.get('company'), address: fd.get('address'), note: fd.get('note'), cancelPath: location.pathname }),
      })).json()
      if (r.redirect) { write([]); location.href = r.redirect; return }
      if (r.ok) {
        write([])
        linesEl.innerHTML = `<p class="cart-note" style="font-size:1.05em"><strong>Order received ✓</strong> — ${r.message || 'we will confirm by email.'}${r.orderId ? ` Reference: <code>${r.orderId.slice(-6).toUpperCase()}</code>` : ''}</p>`
        form.hidden = true
      }
      else status.textContent = r.error || 'Something went wrong.'
    } catch { status.textContent = 'Could not reach the shop — try again.' }
  })

  draw()
})()
