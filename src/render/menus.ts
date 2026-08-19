// Menus → accessible nav markup.
// Desktop: dropdowns, column mega panels, and full-width *showcase* panels —
// a JLR-style card rail (image · label · price · note) driving a detail pane,
// plus utility tiles and a brand-bar footer.
// Mobile: the same DOM becomes a full-screen drill-down menu (back button per
// level), so authors configure one menu and get both experiences.

import type { Menu, MenuItem, MegaPanel, MegaTab, RenderCtx } from '../core/types.ts'
import { canView } from '../core/access.ts'
import { escapeAttr, escapeHtml } from '../core/util.ts'
import { renderBlocks } from './blocks.ts'
import { pictureHtml } from './imgtag.ts'
import { siteIcon } from '../core/icons.ts'

const CHEV = `<svg class="nav-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
const CHEV_R = `<svg class="mm-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`

async function itemHref(ctx: RenderCtx, item: { href?: string; docId?: string }): Promise<string> {
  if (item.docId) {
    const doc = await ctx.env.content.getDoc(item.docId)
    if (doc) return await ctx.env.content.docPath(doc)
  }
  return item.href || '#'
}

function visible(ctx: RenderCtx, item: MenuItem): boolean {
  // features switchboard: a disabled feed/sitemap must not leave dead menu links
  const feats = ctx.site?.features || {}
  const href = (item.href || '').split('?')[0]
  if (feats.rss === false && /\/feed\.xml$/.test(href)) return false
  if (feats.sitemap === false && /\/sitemap\.xml$/.test(href)) return false
  const v = item.visibility || 'all'
  if (v === 'auth' && !(ctx.user || ctx.member)) return false
  if (v === 'guest' && (ctx.user || ctx.member)) return false
  if (item.roles?.length && (!ctx.user || !item.roles.includes(ctx.user.role))) return false
  if (item.memberGroups?.length) {
    // member-group targeting; studio previews (annotate) show everything
    if (ctx.annotate) return true
    const groups: string[] = (ctx.member as any)?.groups || []
    if (!groups.some(g => item.memberGroups!.includes(g))) return false
  }
  return true
}

async function autoChildren(ctx: RenderCtx, item: MenuItem): Promise<MenuItem[]> {
  if (item.type !== 'auto' || !item.concept) return item.children || []
  const all = await ctx.env.content.listDocs(item.concept, { published: ctx.mode !== 'preview' })
  const docs = all.filter((d: any) => canView(d, { admin: ctx.mode !== 'live', member: ctx.member }))
  return await Promise.all(docs.slice(0, item.limit || 5).map(async (d: any) => ({
    id: d.id, label: d.title, type: 'link' as const, href: await ctx.env.content.docPath(d),
    sublabel: d.fields?.lede ? undefined : undefined, description: d.fields?.lede,
  })))
}

export async function renderMenu(ctx: RenderCtx, menu: Menu, opts: { class?: string } = {}): Promise<string> {
  ctx.collect.enhancers.add('nav')
  const items: string[] = []
  for (const item of menu.items) {
    if (!visible(ctx, item)) continue
    items.push(await renderItem(ctx, item))
  }
  return `<nav class="nav ${escapeAttr(opts.class || '')}" aria-label="${escapeAttr(menu.label || menu.key)}" data-blockhouse="nav" data-blockhouse-src="menu:${escapeAttr(menu.key)}">` +
    `<div class="nav-mobile-head" aria-hidden="true"><span class="nav-mobile-title">Menu</span></div>` +
    `<ul class="nav-list">${items.join('')}</ul></nav>`
}

async function renderItem(ctx: RenderCtx, item: MenuItem): Promise<string> {
  if (item.type === 'divider') return `<li class="nav-divider" role="separator"></li>`
  if (item.type === 'heading') return `<li class="nav-heading">${escapeHtml(item.label)}</li>`

  if (item.mega) return renderMegaItem(ctx, item)

  const children = await autoChildren(ctx, item)
  if (children.length) {
    const subs: string[] = []
    for (const sub of children) {
      if (!visible(ctx, sub)) continue
      subs.push(`<li><a href="${escapeAttr(await itemHref(ctx, sub))}">${escapeHtml(sub.label)}</a></li>`)
    }
    return `<li class="nav-item has-drop" data-nav-id="${escapeAttr(item.id)}">` +
      `<button class="nav-link" aria-expanded="false" aria-haspopup="true"><span>${escapeHtml(item.label)}</span>${CHEV}</button>` +
      `<div class="drop-panel">${drillHead(item.label)}<ul class="drop-list">${subs.join('')}</ul></div></li>`
  }

  const href = await itemHref(ctx, item)
  const active = ctx.path !== '/' && href !== '#' && href !== '/' && ctx.path.startsWith(href) ? ' aria-current="page"' : ''
  return `<li class="nav-item" data-nav-id="${escapeAttr(item.id)}"><a class="nav-link" href="${escapeAttr(href)}"${active}><span>${escapeHtml(item.label)}</span></a></li>`
}

function drillHead(label: string): string {
  return `<div class="drill-head"><button class="drill-back" aria-label="Back">${siteIcon('back', 18)}</button><span class="drill-title">${escapeHtml(label)}</span></div>`
}

async function renderMegaItem(ctx: RenderCtx, item: MenuItem): Promise<string> {
  const mega = item.mega!
  const layout = mega.layout || (mega.tabs?.length ? 'catalogue' : mega.items?.length ? 'showcase' : 'columns')
  let inner = ''

  if (layout === 'catalogue') inner = await renderCatalogue(ctx, item, mega)
  else if (layout === 'showcase') inner = await renderShowcase(ctx, item, mega)
  else inner = await renderColumns(ctx, mega)

  const tiles = await renderTiles(ctx, mega)
  const footer = await renderMegaFooter(ctx, mega)
  const full = layout === 'showcase' || layout === 'catalogue'

  return `<li class="nav-item has-mega" data-nav-id="${escapeAttr(item.id)}">` +
    `<button class="nav-link" aria-expanded="false" aria-haspopup="true"><span>${escapeHtml(item.label)}</span>${CHEV}</button>` +
    `<div class="mega-panel${mega.wide ? ' mega-wide' : ''}${full ? ' mega-full' : ''}${layout === 'catalogue' ? ' mega-cat-panel' : ''}" role="group" aria-label="${escapeAttr(item.label)}">` +
    drillHead(item.label) +
    `<div class="mega-scroll">${inner}${tiles}</div>${footer}` +
    `</div></li>`
}

/**
 * Catalogue layout — the full-screen pattern: category tabs across the top,
 * an item list on the left (thumbnail · name · category line), and a detail
 * pane on the right (big name, CTA, category, hero image, description or
 * custom blocks). Hover/focus switches the detail; tabs switch categories.
 * On mobile the same DOM becomes accordion sections inside the drill-down.
 */
async function renderCatalogue(ctx: RenderCtx, item: MenuItem, mega: MegaPanel): Promise<string> {
  const tabs = (mega.tabs || []).filter(t => t.items?.length || true)
  const cta = mega.ctaLabel || 'Explore'
  const tabBtns: string[] = []
  const tabPanes: string[] = []

  for (let ti = 0; ti < tabs.length; ti++) {
    const tab = tabs[ti]
    const first = ti === 0
    tabBtns.push(
      `<button class="mc-tab-btn${first ? ' active' : ''}" role="tab" aria-selected="${first}" data-mctab="${escapeAttr(tab.id)}">${escapeHtml(tab.label)}</button>`)

    // auto items expand inside catalogue tabs too
    const expanded: MenuItem[] = []
    for (const sub of tab.items || []) {
      if (!visible(ctx, sub)) continue
      if (sub.type === 'auto') expanded.push(...await autoChildren(ctx, sub))
      else expanded.push(sub)
    }

    const rows: string[] = []
    const panes: string[] = []
    for (let i = 0; i < expanded.length; i++) {
      const entry = expanded[i]
      const active = i === 0
      const href = await itemHref(ctx, entry)
      const thumb = entry.image
        ? await pictureHtml(ctx, entry.image, { width: 180, sizes: '90px' })
        : `<span class="mc-thumb-ph">${siteIcon(entry.icon || 'doc', 20)}</span>`
      rows.push(
        `<a class="mc-item${active ? ' active' : ''}" href="${escapeAttr(href)}" data-mc="${escapeAttr(entry.id)}">` +
        `<span class="mc-thumb">${thumb}</span>` +
        `<span class="mc-body"><span class="mc-name">${escapeHtml(entry.label)}</span>` +
        (entry.sublabel ? `<span class="mc-cat">${escapeHtml(entry.sublabel)}</span>` : '') +
        `</span>${CHEV_R}</a>`)

      let paneInner: string
      if (entry.detail?.length) {
        paneInner = await renderBlocks({ ...ctx, annotate: false }, entry.detail)
      } else {
        const hero = entry.image ? await pictureHtml(ctx, entry.image, { width: 1000, sizes: '(max-width: 1000px) 90vw, 760px' }) : ''
        paneInner =
          `<div class="mc-detail-head"><h3>${escapeHtml(entry.label)}</h3>` +
          `<a class="btn btn-primary mc-cta" href="${escapeAttr(href)}">${escapeHtml(entry.note || cta)}</a></div>` +
          (entry.sublabel ? `<p class="mc-detail-cat">${escapeHtml(entry.sublabel)}</p>` : '') +
          (hero ? `<div class="mc-hero">${hero}</div>` : '') +
          (entry.description ? `<p class="mc-desc">${escapeHtml(entry.description)}</p>` : '')
      }
      panes.push(`<div class="mc-pane${active ? ' active' : ''}" data-mc-pane="${escapeAttr(entry.id)}"${active ? '' : ' hidden'}>${paneInner}</div>`)
    }

    tabPanes.push(
      `<div class="mc-tabpane${first ? ' active' : ''}" data-mctab-pane="${escapeAttr(tab.id)}"${first ? '' : ' hidden'}>` +
      `<div class="mc-list" role="list">${rows.join('')}</div>` +
      `<div class="mc-detail">${panes.join('')}</div>` +
      `</div>`)
  }

  return `<div class="mega-catalogue">` +
    `<div class="mc-tabs" role="tablist">${tabBtns.join('')}</div>` +
    `<div class="mc-panes">${tabPanes.join('')}</div></div>`
}

async function renderColumns(ctx: RenderCtx, mega: MegaPanel): Promise<string> {
  const cols: string[] = []
  for (const col of mega.columns || []) {
    let inner = ''
    if (col.title) inner += `<p class="mega-title">${escapeHtml(col.title)}</p>`
    if (col.items?.length) {
      const links: string[] = []
      for (const sub of col.items) {
        if (!visible(ctx, sub)) continue
        const expanded = sub.type === 'auto' ? await autoChildren(ctx, sub) : [sub]
        for (const link of expanded) {
          links.push(`<li><a href="${escapeAttr(await itemHref(ctx, link))}">${link.icon ? `<span class="mega-icon">${siteIcon(link.icon, 18) || escapeHtml(link.icon)}</span>` : ''}<span class="mega-link-body"><span class="mega-link-label">${escapeHtml(link.label)}</span>${link.description ? `<span class="mega-link-desc">${escapeHtml(link.description)}</span>` : ''}</span></a></li>`)
        }
      }
      inner += `<ul class="mega-links">${links.join('')}</ul>`
    }
    if (col.blocks?.length) inner += `<div class="mega-blocks">${await renderBlocks({ ...ctx, annotate: false }, col.blocks)}</div>`
    cols.push(`<div class="mega-col"${col.span ? ` style="grid-column: span ${col.span}"` : ''}>${inner}</div>`)
  }
  return `<div class="mega-grid">${cols.join('')}</div>`
}

async function renderShowcase(ctx: RenderCtx, item: MenuItem, mega: MegaPanel): Promise<string> {
  const cards: string[] = []
  const panes: string[] = []
  let first = true
  for (const card of mega.items || []) {
    if (!visible(ctx, card)) continue
    const href = await itemHref(ctx, card)
    const img = card.image
      ? await pictureHtml(ctx, card.image, { width: 200, sizes: '180px' })
      : `<span class="mm-thumb-ph">${siteIcon('doc', 22)}</span>`

    cards.push(
      `<a class="mega-card${first ? ' active' : ''}" href="${escapeAttr(href)}" data-mm="${escapeAttr(card.id)}">` +
      `<span class="mm-thumb">${img}</span>` +
      `<span class="mm-body">` +
      `<span class="mm-label">${escapeHtml(card.label)}</span>` +
      (card.sublabel ? `<span class="mm-sub">${escapeHtml(card.sublabel)}</span>` : '') +
      (card.note ? `<span class="mm-note">${escapeHtml(card.note)}</span>` : '') +
      `</span>${CHEV_R}</a>`)

    let paneInner: string
    if (card.detail?.length) {
      paneInner = await renderBlocks({ ...ctx, annotate: false }, card.detail)
    } else {
      const bigImg = card.image ? await pictureHtml(ctx, card.image, { width: 760, sizes: '(max-width: 1000px) 90vw, 620px' }) : ''
      paneInner =
        `<div class="mm-pane-copy"><h3>${escapeHtml(card.label)}</h3>` +
        (card.description ? `<p class="mm-tagline">${escapeHtml(card.description)}</p>` : '') +
        (card.sublabel ? `<p class="mm-price">${escapeHtml(card.sublabel)}${card.note ? ` <span class="mm-price-note">· ${escapeHtml(card.note)}</span>` : ''}</p>` : '') +
        `<p class="mm-actions"><a class="btn btn-primary" href="${escapeAttr(href)}">${siteIcon('arrow', 15)} Explore</a></p></div>` +
        (bigImg ? `<div class="mm-pane-media">${bigImg}</div>` : '')
    }
    panes.push(`<div class="mm-pane${first ? ' active' : ''}" data-mm-pane="${escapeAttr(card.id)}"${first ? '' : ' hidden'}>${paneInner}</div>`)
    first = false
  }
  return `<div class="mega-showcase"><div class="mega-cards" role="list">${cards.join('')}</div><div class="mega-detail">${panes.join('')}</div></div>`
}

async function renderTiles(ctx: RenderCtx, mega: MegaPanel): Promise<string> {
  if (!mega.tiles?.length) return ''
  const tiles: string[] = []
  for (const t of mega.tiles) {
    tiles.push(`<a class="mega-tile" href="${escapeAttr(await itemHref(ctx, t))}">` +
      `<span class="mt-ico">${siteIcon(t.icon, 22) || ''}</span><span class="mt-label">${escapeHtml(t.label)}</span></a>`)
  }
  return `<div class="mega-tiles">${tiles.join('')}</div>`
}

async function renderMegaFooter(ctx: RenderCtx, mega: MegaPanel): Promise<string> {
  if (!mega.footer?.length) return ''
  const links: string[] = []
  for (const f of mega.footer) {
    links.push(`<a class="mega-brand" href="${escapeAttr(await itemHref(ctx, f))}"><span>${escapeHtml(f.label)}</span>${CHEV_R}</a>`)
  }
  return `<div class="mega-footer">${mega.footerTitle ? `<p class="mega-footer-title">${escapeHtml(mega.footerTitle)}</p>` : ''}<div class="mega-brands">${links.join('')}</div></div>`
}
