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
      description: 'A row of headline numbers — years in business, jobs completed, tonnes lifted.',
      fields: [
        f('items', 'list', 'Stats', { item: [f('value', 'text', 'Number'), f('label', 'text', 'What it counts'), f('note', 'text', 'Small note')] }),
        f('style', 'select', 'Style', { options: [{ value: 'plain', label: 'Plain' }, { value: 'cards', label: 'Cards' }, { value: 'ruled', label: 'Divided by lines' }], default: 'ruled' }),
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
      description: 'What a customer said about you, with their name and company.',
      fields: [
        f('quote', 'textarea', 'Quote', { rows: 3, required: true }),
        f('name', 'text', 'Name', { width: 'half' }),
        f('role', 'text', 'Role / company', { width: 'half' }),
        f('avatar', 'image', 'Photo of them'),
        f('logo', 'image', 'Company logo'),
        f('rating', 'select', 'Rating', { options: [{ value: '', label: 'No stars' }, { value: '5', label: '5 stars' }, { value: '4', label: '4 stars' }, { value: '3', label: '3 stars' }], width: 'half' }),
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
      description: 'A row of customer or supplier logos, evenly spaced.',
      fields: [
        f('title', 'text', 'Title'),
        f('items', 'list', 'Logos', { item: [f('image', 'image', 'Logo'), f('name', 'text', 'Name'), f('link', 'link', 'Link')] }),
        f('grayscale', 'boolean', 'Show in grey', { default: true, help: 'Drops the colour out of each logo so the row looks tidy.' }),
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
      description: 'Dated entries down the page — company history, or the stages of a job.',
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
      description: 'Numbered steps that explain how something works. Search engines understand it too.',
      fields: [
        f('title', 'text', 'Title'),
        f('items', 'list', 'Steps', { item: [f('title', 'text', 'Step title'), f('text', 'textarea', 'Text', { rows: 2 })] }),
        f('layout', 'select', 'Layout', { options: [{ value: 'stack', label: 'One under another' }, { value: 'row', label: 'Across the page' }], default: 'stack' }),
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
      description: 'A picture beside some writing. Alternate the side to build a page quickly.',
      fields: [
        f('eyebrow', 'text', 'Eyebrow'),
        f('title', 'text', 'Title', { required: true }),
        f('text', 'richtext', 'Text'),
        f('image', 'image', 'Image'),
        f('side', 'select', 'Picture side', { options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }], default: 'right', width: 'half' }),
        f('align', 'select', 'Vertical align', { options: [{ value: 'center', label: 'Middle' }, { value: 'top', label: 'Top' }], default: 'center', width: 'half' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary', label: 'Solid (main action)' }, { value: 'ghost', label: 'Outlined' }] })] }),
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
      description: 'A boxed note, tip or warning that stands out from the text around it.',
      fields: [
        f('tone', 'select', 'Kind', { options: [{ value: 'note', label: 'Note' }, { value: 'tip', label: 'Tip' }, { value: 'warning', label: 'Warning' }, { value: 'danger', label: 'Important — safety' }], default: 'note', width: 'half' }),
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
      description: 'Headings that open to reveal what is under them — good for long pages.',
      fields: [f('single', 'boolean', 'Open one at a time', { default: true, help: 'Opening one closes the one before it.' })],
      defaults: { single: true },
      enhance: 'faq',
      render: (_c, n, inner) => `<div class="wb-faq wb-accordion"${n.props.single ? ' data-single="1"' : ''}>${inner}</div>`,
    },
    {
      type: 'accordion-item', label: 'Accordion item', group: 'Interactive', icon: 'tabs', container: true,
      description: 'One heading in an accordion. Put its content inside.',
      fields: [f('label', 'text', 'Label', { required: true }), f('open', 'boolean', 'Open by default')],
      render: (_c, n, inner) =>
        `<details class="wb-faq-item"${n.props.open ? ' open' : ''}><summary><span>${eh(n.props.label)}</span><svg class="faq-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary><div class="faq-body">${inner}</div></details>`,
    },

    {
      type: 'related', label: 'Related content', group: 'Editorial', icon: 'link',
      description: 'Cards linking to other pages — picked by you, or filled in automatically.',
      fields: [
        f('title', 'text', 'Title', { default: 'Read next' }),
        f('concept', 'text', 'Fill automatically from', { help: 'The kind of page to list, e.g. product. Leave blank and pick pages yourself below.', width: 'half' }),
        f('limit', 'number', 'How many', { default: 3, width: 'half' }),
        f('picks', 'list', 'Pages you choose', { item: [f('link', 'link', 'Page')] }),
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
      description: 'Buttons for sharing the page. Nothing is tracked until someone presses one.',
      fields: [f('networks', 'text', 'Which buttons', { default: 'x,linkedin,facebook,email,copy', help: 'Separate with commas. Choose from: x, linkedin, facebook, email, copy.' })],
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
      description: 'The trail of links back to the home page, shown along the top.',
      fields: [f('home', 'text', 'Name for the home page', { default: 'Home' })],
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
      description: 'A map of an address that only loads when someone clicks it.',
      fields: [
        f('query', 'text', 'Place or address', { help: 'A postcode or a full address.' }),
        f('embedUrl', 'text', 'Or a map link from Google', { help: 'In Google Maps choose Share, then Embed a map, and paste the web address that starts https://www.google.com/maps/embed' }),
        f('zoom', 'number', 'How close in', { default: 14, width: 'half', help: 'Higher means closer. 14 shows a town, 18 a street.' }),
        f('height', 'number', 'Height (pixels)', { default: 360, width: 'half' }),
      ],
      defaults: { zoom: 14, height: 360 },
      enhance: 'embed',
      render: (_c, n) => {
        const q = encodeURIComponent(String(n.props.query || ''))
        // A map pasted from Google's or OpenStreetMap's "embed" box is used as it
        // is — it already points at the right place. Anything else is refused.
        const pasted = String(n.props.embedUrl || '')
        const ok = /^https:\/\/(www\.google\.com\/maps\/embed\?|www\.openstreetmap\.org\/export\/embed\.html\?)/.test(pasted)
        const src = ok ? pasted : `https://www.openstreetmap.org/export/embed.html?bbox=&layer=mapnik&marker=&query=${q}`
        return `<div class="wb-map" style="height:${Math.max(160, Number(n.props.height) || 360)}px" data-embed="${ea(src)}" data-map-query="${ok ? '' : ea(n.props.query || '')}" data-map-zoom="${Number(n.props.zoom) || 14}" data-title="Map${n.props.query ? ' of ' + ea(n.props.query) : ''}">` +
          `<button class="embed-facade map-facade" aria-label="Load the map"><span class="map-pin">${siteIcon('location', 26)}</span><span class="map-label">${eh(n.props.query || 'Map')}</span><span class="map-hint">Click to load the map</span></button></div>`
      },
    },

    {
      type: 'download', label: 'Download', group: 'Actions', icon: 'download',
      description: 'A link people click to save a file — a brochure, a data sheet.',
      fields: [
        f('label', 'text', 'Label', { required: true }),
        f('file', 'text', 'The file', { help: 'The web address of the file. Copy it from the Files panel after you upload.' }),
        f('meta', 'text', 'Small print', { help: 'Tells people what they are getting, e.g. PDF · 2.4 MB', width: 'half' }),
        f('icon', 'text', 'Icon', { default: 'doc', width: 'half', help: 'A name from the site icon set, e.g. doc, chart, gear. Leave as doc if unsure.' }),
      ],
      defaults: { icon: 'doc' },
      render: (_c, n) =>
        `<a class="wb-download" href="${ea(n.props.file || '#')}" download>${siteIcon(n.props.icon || 'doc', 22)}` +
        `<span class="dl-body"><span class="dl-label">${eh(n.props.label)}</span>${n.props.meta ? `<span class="dl-meta">${eh(n.props.meta)}</span>` : ''}</span>` +
        `${siteIcon('arrow', 16, 'dl-arrow')}</a>`,
    },

    {
      type: 'spotlight', label: 'Spotlight', group: 'Layout', icon: 'star',
      description: 'A picture filling the full width with a headline written over it.',
      fields: [
        f('image', 'image', 'Background image', { required: true }),
        f('eyebrow', 'text', 'Eyebrow'),
        f('title', 'text', 'Title', { required: true }),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('align', 'select', 'Text position', { options: [{ value: 'center', label: 'Centred' }, { value: 'left', label: 'Left' }, { value: 'bottom-left', label: 'Bottom left' }], default: 'center', width: 'half' }),
        f('height', 'select', 'Height', { options: [{ value: 'medium', label: 'Medium' }, { value: 'tall', label: 'Tall' }, { value: 'full', label: 'Fills the screen' }], default: 'medium', width: 'half' }),
        f('overlay', 'number', 'How much to darken the picture (0–100)', { default: 45, width: 'half', help: 'Higher makes the words easier to read.' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary', label: 'Solid (main action)' }, { value: 'ghost', label: 'Outlined' }] })] }),
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
