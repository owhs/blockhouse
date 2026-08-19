// Extended native block library — the marketing/editorial workhorses that turn
// a template into a site: stats, testimonials, logo clouds, timelines, steps,
// feature splits, callouts, related content, sharing, breadcrumbs, maps,
// downloads, accordions and a raw-free "spotlight" hero variant.

import type { BlockDef, RenderCtx } from '../core/types.ts'
import type { Registry } from '../core/registry.ts'
import { escapeAttr as ea, escapeHtml as eh } from '../core/util.ts'
import { mdToHtml } from '../core/markdown.ts'
import { pictureHtml } from './imgtag.ts'
import { siteIcon } from '../core/icons.ts'
import { canView } from '../core/access.ts'

const f = (key: string, type: any, label: string, extra: any = {}) => ({ key, type, label, ...extra })

async function href(ctx: RenderCtx, link: any): Promise<string> {
  if (!link) return '#'
  if (typeof link === 'string') return link
  if (link.docId) {
    const doc = await ctx.env.content.getDoc(link.docId)
    if (doc) return ctx.env.content.docHref ? ctx.env.content.docHref(doc) : ctx.env.content.docPath(doc)
  }
  return link.href || '#'
}

export function registerExtraBlocks(registry: Registry) {
  const defs: BlockDef[] = [

    {
      type: 'stats', label: 'Stats row', group: 'Marketing', icon: 'chart',
      description: 'Big numbers with labels — proof at a glance',
      fields: [
        f('items', 'list', 'Stats', { item: [f('value', 'text', 'Value'), f('label', 'text', 'Label'), f('note', 'text', 'Note')] }),
        f('style', 'select', 'Style', { options: [{ value: 'plain' }, { value: 'cards' }, { value: 'ruled' }], default: 'ruled' }),
      ],
      defaults: { items: [], style: 'ruled' },
      render: (_c, n) => {
        const cells = (n.props.items || []).map((s: any) =>
          `<div class="stat-cell"><span class="stat-value">${eh(s.value)}</span><span class="stat-label">${eh(s.label)}</span>${s.note ? `<span class="stat-note">${eh(s.note)}</span>` : ''}</div>`).join('')
        return `<div class="wb-stats style-${ea(n.props.style)}" style="--n:${(n.props.items || []).length || 1}">${cells}</div>`
      },
    },

    {
      type: 'testimonial', label: 'Testimonial', group: 'Marketing', icon: 'quote',
      fields: [
        f('quote', 'textarea', 'Quote', { rows: 3, required: true }),
        f('name', 'text', 'Name', { width: 'half' }),
        f('role', 'text', 'Role / company', { width: 'half' }),
        f('avatar', 'image', 'Avatar'),
        f('logo', 'image', 'Company logo'),
        f('rating', 'select', 'Rating', { options: [{ value: '' }, { value: '5' }, { value: '4' }, { value: '3' }], width: 'half' }),
      ],
      render: async (c, n) => {
        const av = n.props.avatar ? await pictureHtml(c, n.props.avatar, { width: 96, sizes: '64px', alt: n.props.name }) : ''
        const lg = n.props.logo ? await pictureHtml(c, n.props.logo, { width: 240, sizes: '120px', alt: n.props.role }) : ''
        const stars = n.props.rating ? `<p class="tm-rating" aria-label="${ea(n.props.rating)} out of 5">${'★'.repeat(+n.props.rating)}</p>` : ''
        return `<figure class="wb-testimonial">${stars}<blockquote>${eh(n.props.quote)}</blockquote>` +
          `<figcaption>${av ? `<span class="tm-avatar">${av}</span>` : ''}<span class="tm-who"><span class="tm-name">${eh(n.props.name)}</span>${n.props.role ? `<span class="tm-role">${eh(n.props.role)}</span>` : ''}</span>${lg ? `<span class="tm-logo">${lg}</span>` : ''}</figcaption></figure>`
      },
      jsonld: (_c, node) => node.props.quote && node.props.name ? {
        '@type': 'Review', reviewBody: node.props.quote, author: { '@type': 'Person', name: node.props.name },
        ...(node.props.rating ? { reviewRating: { '@type': 'Rating', ratingValue: Number(node.props.rating), bestRating: 5 } } : {}),
      } : null,
    },

    {
      type: 'logos', label: 'Logo cloud', group: 'Marketing', icon: 'building',
      description: 'Client or partner logos, evenly spaced and muted',
      fields: [
        f('title', 'text', 'Title'),
        f('items', 'list', 'Logos', { item: [f('image', 'image', 'Logo'), f('name', 'text', 'Name'), f('link', 'link', 'Link')] }),
        f('grayscale', 'boolean', 'Mute to greyscale', { default: true }),
      ],
      defaults: { items: [], grayscale: true },
      render: async (c, n) => {
        const cells: string[] = []
        for (const it of n.props.items || []) {
          if (!it.image) continue
          const img = await pictureHtml(c, it.image, { width: 300, sizes: '150px', alt: it.name || '' })
          cells.push(it.link?.href || it.link?.docId
            ? `<a class="logo-cell" href="${ea(await href(c, it.link))}" title="${ea(it.name || '')}">${img}</a>`
            : `<span class="logo-cell" title="${ea(it.name || '')}">${img}</span>`)
        }
        return `<div class="wb-logos${n.props.grayscale ? ' muted' : ''}">${n.props.title ? `<p class="logos-title">${eh(n.props.title)}</p>` : ''}<div class="logos-row">${cells.join('')}</div></div>`
      },
    },

    {
      type: 'timeline', label: 'Timeline', group: 'Editorial', icon: 'gantt',
      fields: [f('items', 'list', 'Entries', { item: [f('when', 'text', 'When'), f('title', 'text', 'Title'), f('text', 'textarea', 'Text', { rows: 2 })] })],
      defaults: { items: [] },
      render: (_c, n) => {
        const rows = (n.props.items || []).map((it: any) =>
          `<li class="tl-item"><span class="tl-when">${eh(it.when)}</span><div class="tl-body"><h3>${eh(it.title)}</h3>${it.text ? `<p>${eh(it.text)}</p>` : ''}</div></li>`).join('')
        return `<ol class="wb-timeline">${rows}</ol>`
      },
    },

    {
      type: 'steps', label: 'Steps', group: 'Editorial', icon: 'list',
      description: 'A numbered how-it-works sequence (emits HowTo data)',
      fields: [
        f('title', 'text', 'Title'),
        f('items', 'list', 'Steps', { item: [f('title', 'text', 'Step title'), f('text', 'textarea', 'Text', { rows: 2 })] }),
        f('layout', 'select', 'Layout', { options: [{ value: 'stack' }, { value: 'row' }], default: 'stack' }),
      ],
      defaults: { items: [], layout: 'stack' },
      render: (_c, n) => {
        const rows = (n.props.items || []).map((it: any, i: number) =>
          `<li class="step"><span class="step-n">${i + 1}</span><div><h3>${eh(it.title)}</h3>${it.text ? `<p>${eh(it.text)}</p>` : ''}</div></li>`).join('')
        return `<div class="wb-steps layout-${ea(n.props.layout)}">${n.props.title ? `<h2 class="steps-title">${eh(n.props.title)}</h2>` : ''}<ol class="steps-list">${rows}</ol></div>`
      },
      jsonld: (_c, node) => (node.props.items || []).length ? {
        '@type': 'HowTo', name: node.props.title || 'How it works',
        step: (node.props.items || []).map((s: any, i: number) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: s.text || s.title })),
      } : null,
    },

    {
      type: 'feature-split', label: 'Feature split', group: 'Marketing', icon: 'columns',
      description: 'Image beside copy — alternating sections build a page fast',
      fields: [
        f('eyebrow', 'text', 'Eyebrow'),
        f('title', 'text', 'Title', { required: true }),
        f('text', 'richtext', 'Text'),
        f('image', 'image', 'Image'),
        f('side', 'select', 'Image side', { options: [{ value: 'right' }, { value: 'left' }], default: 'right', width: 'half' }),
        f('align', 'select', 'Vertical align', { options: [{ value: 'center' }, { value: 'top' }], default: 'center', width: 'half' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary' }, { value: 'ghost' }] })] }),
      ],
      defaults: { side: 'right', align: 'center', buttons: [] },
      render: async (c, n) => {
        const img = n.props.image ? await pictureHtml(c, n.props.image, { width: 860, sizes: '(max-width: 860px) 100vw, 46vw' }) : ''
        const btns: string[] = []
        for (const b of n.props.buttons || []) btns.push(`<a class="btn btn-${ea(b.style || 'primary')}" href="${ea(await href(c, b.link))}">${eh(b.label)}</a>`)
        return `<div class="wb-feature-split side-${ea(n.props.side)} valign-${ea(n.props.align)}">` +
          `<div class="fs-copy">${n.props.eyebrow ? `<p class="eyebrow">${eh(n.props.eyebrow)}</p>` : ''}<h2>${eh(n.props.title)}</h2>` +
          `<div class="prose">${mdToHtml(n.props.text || '')}</div>${btns.length ? `<p class="fs-actions">${btns.join('')}</p>` : ''}</div>` +
          `${img ? `<div class="fs-media">${img}</div>` : ''}</div>`
      },
    },

    {
      type: 'callout', label: 'Callout', group: 'Editorial', icon: 'info',
      description: 'Note / tip / warning box',
      fields: [
        f('tone', 'select', 'Tone', { options: [{ value: 'note' }, { value: 'tip' }, { value: 'warning' }, { value: 'danger' }], default: 'note', width: 'half' }),
        f('title', 'text', 'Title', { width: 'half' }),
        f('text', 'richtext', 'Text'),
      ],
      defaults: { tone: 'note' },
      render: (_c, n) => {
        const icons: Record<string, string> = { note: 'doc', tip: 'star', warning: 'bolt', danger: 'key' }
        return `<aside class="wb-callout tone-${ea(n.props.tone)}"><span class="co-ico">${siteIcon(icons[n.props.tone] || 'doc', 18)}</span>` +
          `<div class="co-body">${n.props.title ? `<p class="co-title">${eh(n.props.title)}</p>` : ''}${mdToHtml(n.props.text || '')}</div></aside>`
      },
    },

    {
      type: 'accordion', label: 'Accordion', group: 'Interactive', icon: 'tabs', container: true, childTypes: ['accordion-item'],
      fields: [f('single', 'boolean', 'Open one at a time', { default: true })],
      defaults: { single: true },
      enhance: 'faq',
      render: (_c, n, inner) => `<div class="wb-faq wb-accordion"${n.props.single ? ' data-single="1"' : ''}>${inner}</div>`,
    },
    {
      type: 'accordion-item', label: 'Accordion item', group: 'Interactive', icon: 'tabs', container: true,
      fields: [f('label', 'text', 'Label', { required: true }), f('open', 'boolean', 'Open by default')],
      render: (_c, n, inner) =>
        `<details class="wb-faq-item"${n.props.open ? ' open' : ''}><summary><span>${eh(n.props.label)}</span><svg class="faq-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary><div class="faq-body">${inner}</div></details>`,
    },

    {
      type: 'related', label: 'Related content', group: 'Editorial', icon: 'link',
      description: 'Auto-list the latest items of a concept, or hand-pick documents',
      fields: [
        f('title', 'text', 'Title', { default: 'Read next' }),
        f('concept', 'text', 'Concept', { help: 'e.g. post — leave blank to hand-pick', width: 'half' }),
        f('limit', 'number', 'How many', { default: 3, width: 'half' }),
        f('picks', 'list', 'Hand-picked', { item: [f('link', 'link', 'Document')] }),
      ],
      defaults: { title: 'Read next', limit: 3, picks: [] },
      render: async (c, n) => {
        const cards: string[] = []
        const add = async (doc: any) => {
          if (!doc) return
          const path = await c.env.content.docPath(doc)
          const cover = doc.fields?.cover ? await pictureHtml(c, doc.fields.cover, { width: 640, sizes: '320px' }) : ''
          cards.push(`<a class="rel-card" href="${ea(path)}">${cover ? `<span class="rel-media">${cover}</span>` : ''}<span class="rel-body"><span class="rel-title">${eh(doc.title)}</span>${doc.fields?.lede ? `<span class="rel-desc">${eh(String(doc.fields.lede).slice(0, 110))}</span>` : ''}</span></a>`)
        }
        if (n.props.concept) {
          const docs = await c.env.content.listDocs(n.props.concept, { published: c.mode !== 'preview' })
          for (const d of docs.filter((d: any) => d.id !== c.doc?.id && canView(d, { admin: c.mode !== 'live', member: c.member })).slice(0, Number(n.props.limit) || 3)) await add(d)
        }
        for (const p of n.props.picks || []) {
          if (p.link?.docId) await add(await c.env.content.getDoc(p.link.docId))
        }
        if (!cards.length) return c.mode === 'preview' ? `<div class="is-empty">Pick a concept or documents…</div>` : ''
        return `<section class="wb-related">${n.props.title ? `<h2 class="rel-heading">${eh(n.props.title)}</h2>` : ''}<div class="rel-grid">${cards.join('')}</div></section>`
      },
    },

    {
      type: 'share', label: 'Share buttons', group: 'Editorial', icon: 'send',
      description: 'Privacy-friendly share links (no third-party scripts)',
      fields: [f('networks', 'text', 'Networks', { default: 'x,linkedin,facebook,email,copy', help: 'comma separated: x · linkedin · facebook · email · copy' })],
      defaults: { networks: 'x,linkedin,facebook,email,copy' },
      enhance: 'share',
      render: (c, n) => {
        const url = c.site.url + (c.path === '/' ? '/' : c.path)
        const title = c.doc?.title || c.site.name
        const map: Record<string, { label: string; href: string; icon: string }> = {
          x: { label: 'X', href: `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`, icon: 'send' },
          linkedin: { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, icon: 'building' },
          facebook: { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, icon: 'globe' },
          email: { label: 'Email', href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`, icon: 'mail' },
        }
        const items = String(n.props.networks || '').split(',').map(s => s.trim()).filter(Boolean).map(k => {
          if (k === 'copy') return `<button class="share-btn" data-share-copy="${ea(url)}">${siteIcon('doc', 15)}<span>Copy link</span></button>`
          const m = map[k]
          return m ? `<a class="share-btn" href="${ea(m.href)}" target="_blank" rel="noopener">${siteIcon(m.icon, 15)}<span>${m.label}</span></a>` : ''
        }).join('')
        return `<div class="wb-share" data-share><span class="share-label">Share</span>${items}</div>`
      },
    },

    {
      type: 'breadcrumbs', label: 'Breadcrumbs', group: 'Editorial', icon: 'chevR',
      fields: [f('home', 'text', 'Home label', { default: 'Home' })],
      defaults: { home: 'Home' },
      render: async (c, n) => {
        const parts = c.path.split('/').filter(Boolean)
        const crumbs: string[] = [`<li><a href="/">${eh(n.props.home)}</a></li>`]
        let acc = ''
        parts.forEach((p, i) => {
          acc += '/' + p
          const label = p.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
          crumbs.push(i === parts.length - 1
            ? `<li aria-current="page">${eh(c.doc?.title || label)}</li>`
            : `<li><a href="${ea(acc)}">${eh(label)}</a></li>`)
        })
        return `<nav class="wb-breadcrumbs" aria-label="Breadcrumb"><ol>${crumbs.join('')}</ol></nav>`
      },
      jsonld: (ctx) => {
        const parts = ctx.path.split('/').filter(Boolean)
        if (!parts.length) return null
        let acc = ''
        return {
          '@type': 'BreadcrumbList',
          itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: ctx.site.url + '/' },
          ...parts.map((p, i) => { acc += '/' + p; return { '@type': 'ListItem', position: i + 2, name: p.replace(/-/g, ' '), item: ctx.site.url + acc } })],
        }
      },
    },

    {
      type: 'map', label: 'Map', group: 'Media', icon: 'location',
      description: 'Static-first map with a click-to-load interactive embed',
      fields: [
        f('query', 'text', 'Place or address', { required: true }),
        f('zoom', 'number', 'Zoom', { default: 14, width: 'half' }),
        f('height', 'number', 'Height (px)', { default: 360, width: 'half' }),
      ],
      defaults: { zoom: 14, height: 360 },
      enhance: 'embed',
      render: (_c, n) => {
        const q = encodeURIComponent(String(n.props.query || ''))
        const src = `https://www.openstreetmap.org/export/embed.html?bbox=&layer=mapnik&marker=&query=${q}`
        return `<div class="wb-map" style="height:${Math.max(160, Number(n.props.height) || 360)}px" data-embed="${ea(src)}" data-title="Map of ${ea(n.props.query)}">` +
          `<button class="embed-facade map-facade" aria-label="Load map for ${ea(n.props.query)}"><span class="map-pin">${siteIcon('location', 26)}</span><span class="map-label">${eh(n.props.query)}</span><span class="map-hint">Click to load the map</span></button></div>`
      },
    },

    {
      type: 'download', label: 'Download', group: 'Actions', icon: 'download',
      fields: [
        f('label', 'text', 'Label', { required: true }),
        f('file', 'text', 'File URL', { help: '/media/… or a delivery link from the Files panel' }),
        f('meta', 'text', 'Meta', { help: 'e.g. PDF · 2.4 MB', width: 'half' }),
        f('icon', 'text', 'Icon name', { default: 'doc', width: 'half' }),
      ],
      defaults: { icon: 'doc' },
      render: (_c, n) =>
        `<a class="wb-download" href="${ea(n.props.file || '#')}" download>${siteIcon(n.props.icon || 'doc', 22)}` +
        `<span class="dl-body"><span class="dl-label">${eh(n.props.label)}</span>${n.props.meta ? `<span class="dl-meta">${eh(n.props.meta)}</span>` : ''}</span>` +
        `${siteIcon('arrow', 16, 'dl-arrow')}</a>`,
    },

    {
      type: 'spotlight', label: 'Spotlight', group: 'Layout', icon: 'star',
      description: 'Full-bleed image with an overlaid headline — for landing pages',
      fields: [
        f('image', 'image', 'Background image', { required: true }),
        f('eyebrow', 'text', 'Eyebrow'),
        f('title', 'text', 'Title', { required: true }),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('align', 'select', 'Text position', { options: [{ value: 'center' }, { value: 'left' }, { value: 'bottom-left' }], default: 'center', width: 'half' }),
        f('height', 'select', 'Height', { options: [{ value: 'medium' }, { value: 'tall' }, { value: 'full' }], default: 'medium', width: 'half' }),
        f('overlay', 'number', 'Overlay strength (0–100)', { default: 45, width: 'half' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary' }, { value: 'ghost' }] })] }),
      ],
      defaults: { align: 'center', height: 'medium', overlay: 45, buttons: [] },
      render: async (c, n) => {
        const img = n.props.image ? await pictureHtml(c, n.props.image, { width: 1920, sizes: '100vw', priority: true }) : ''
        const btns: string[] = []
        for (const b of n.props.buttons || []) btns.push(`<a class="btn btn-${ea(b.style || 'primary')} btn-large" href="${ea(await href(c, b.link))}">${eh(b.label)}</a>`)
        return `<section class="wb-spotlight h-${ea(n.props.height)} align-${ea(n.props.align)}" style="--overlay:${Math.min(90, Number(n.props.overlay) || 45) / 100}">` +
          `<div class="sp-media">${img}</div><div class="sp-copy">` +
          `${n.props.eyebrow ? `<p class="eyebrow">${eh(n.props.eyebrow)}</p>` : ''}<h1>${eh(n.props.title)}</h1>` +
          `${n.props.text ? `<p class="sp-text">${eh(n.props.text)}</p>` : ''}${btns.length ? `<p class="sp-actions">${btns.join('')}</p>` : ''}</div></section>`
      },
    },
  ]

  for (const d of defs) registry.registerBlock(d)
}
