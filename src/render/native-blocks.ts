// Native block library. Every block: inspector field schema + HTML renderer.
// Styling lives in the template (wb-* classes); interactivity in small runtime
// enhancers loaded only when a page uses them.

import type { BlockDef, RenderCtx, BlockNode } from '../core/types.ts'
import type { Registry } from '../core/registry.ts'
import { escapeAttr as ea, escapeHtml as eh, slugify } from '../core/util.ts'
import { mdToHtml, mdText } from '../core/markdown.ts'
import { pictureHtml } from './imgtag.ts'
import { sanitizeHtml, sanitizeSvg } from '../core/sanitize.ts'

const f = (key: string, type: any, label: string, extra: any = {}) => ({ key, type, label, ...extra })

async function href(ctx: RenderCtx, link: any): Promise<string> {
  if (!link) return '#'
  if (typeof link === 'string') return link
  if (link.docId) {
    const doc = await ctx.env.content.getDoc(link.docId)
    if (doc) return ctx.env.content.docPath(doc)
  }
  return link.href || '#'
}

function align(a: string | undefined): string { return a && a !== 'left' ? ` style="text-align:${a}"` : '' }

/** inline-edit annotation: emitted only in the editor preview */
function wbe(ctx: RenderCtx, prop: string, mode?: string): string {
  return ctx.annotate ? ` data-wbe="${prop}"${mode ? ` data-wbe-mode="${mode}"` : ''}` : ''
}

export function registerNativeBlocks(registry: Registry) {
  const defs: BlockDef[] = [

    {
      type: 'section', label: 'Section', group: 'Layout', icon: 'layout', container: true,
      description: 'Wrapper with width, background and anchor controls',
      fields: [
        f('width', 'select', 'Width', { options: [{ value: 'normal' }, { value: 'wide' }, { value: 'full' }], default: 'normal' }),
        f('background', 'select', 'Background', { options: [{ value: 'none' }, { value: 'subtle' }, { value: 'accent' }, { value: 'contrast' }], default: 'none' }),
        f('padding', 'select', 'Vertical padding', { options: [{ value: 'normal' }, { value: 'compact' }, { value: 'spacious' }, { value: 'none' }], default: 'normal' }),
        f('anchor', 'text', 'Anchor id', { help: 'Link to this section with #anchor' }),
      ],
      defaults: { width: 'normal', background: 'none', padding: 'normal' },
      render: (_c, n, inner) =>
        `<section class="wb-section bg-${ea(n.props.background)} pad-${ea(n.props.padding)}"${n.props.anchor ? ` id="${ea(n.props.anchor)}"` : ''}><div class="container w-${ea(n.props.width)}">${inner}</div></section>`,
    },

    {
      type: 'columns', label: 'Columns', group: 'Layout', icon: 'columns', container: true,
      description: 'Responsive grid — each child block becomes a cell',
      fields: [
        f('cols', 'select', 'Columns', { options: [{ value: '2' }, { value: '3' }, { value: '4' }], default: '2' }),
        f('gap', 'select', 'Gap', { options: [{ value: 'normal' }, { value: 'tight' }, { value: 'loose' }], default: 'normal' }),
        f('align', 'select', 'Vertical align', { options: [{ value: 'top' }, { value: 'center' }], default: 'top' }),
      ],
      defaults: { cols: '2', gap: 'normal', align: 'top' },
      render: (_c, n, inner) => `<div class="wb-columns cols-${ea(n.props.cols)} gap-${ea(n.props.gap)} valign-${ea(n.props.align)}">${inner}</div>`,
    },

    {
      type: 'heading', label: 'Heading', group: 'Text', icon: 'heading',
      fields: [
        f('text', 'text', 'Text', { required: true }),
        f('level', 'select', 'Level', { options: [{ value: '1', label: 'H1' }, { value: '2', label: 'H2' }, { value: '3', label: 'H3' }, { value: '4', label: 'H4' }], default: '2', width: 'half' }),
        f('align', 'select', 'Align', { options: [{ value: 'left' }, { value: 'center' }], default: 'left', width: 'half' }),
        f('eyebrow', 'text', 'Eyebrow', { help: 'Small label above the heading' }),
      ],
      defaults: { level: '2', align: 'left' },
      render: (c, n) => {
        const l = ['1', '2', '3', '4'].includes(String(n.props.level)) ? n.props.level : '2'
        // A slugged id turns every heading into a deep-link/anchor target for
        // free — harmless to add (nothing reads it unless a template's own
        // nav or a manual link opts in), and saves themes from re-deriving
        // the same slug independently to stay in sync with the rendered id.
        const id = n.props.text ? ` id="${ea(slugify(String(n.props.text)))}"` : ''
        return `<div class="wb-heading"${align(n.props.align)}>${n.props.eyebrow ? `<p class="eyebrow"${wbe(c, 'eyebrow')}>${eh(n.props.eyebrow)}</p>` : ''}<h${l}${id}${wbe(c, 'text')}>${eh(n.props.text)}</h${l}></div>`
      },
    },

    {
      type: 'richtext', label: 'Rich text', group: 'Text', icon: 'text',
      description: 'WYSIWYG text, stored as markdown',
      fields: [f('md', 'richtext', 'Content')],
      defaults: { md: '' },
      render: (c, n) => `<div class="wb-richtext prose"${wbe(c, 'md', 'md')}>${mdToHtml(n.props.md || '')}</div>`,
    },

    {
      type: 'quote', label: 'Quote', group: 'Text', icon: 'quote',
      fields: [f('text', 'textarea', 'Quote', { rows: 3 }), f('cite', 'text', 'Attribution')],
      render: (c, n) => `<figure class="wb-quote"><blockquote${wbe(c, 'text')}>${eh(n.props.text)}</blockquote>${n.props.cite ? `<figcaption${wbe(c, 'cite')}>${eh(n.props.cite)}</figcaption>` : ''}</figure>`,
    },

    {
      type: 'code', label: 'Code', group: 'Text', icon: 'code',
      fields: [
        f('code', 'code', 'Code'),
        f('lang', 'text', 'Language', { width: 'half' }),
        f('filename', 'text', 'Filename', { width: 'half' }),
      ],
      render: (_c, n) =>
        `<figure class="wb-code">${n.props.filename ? `<figcaption><span>${eh(n.props.filename)}</span>${n.props.lang ? `<span class="lang">${eh(n.props.lang)}</span>` : ''}</figcaption>` : ''}<pre><code${n.props.lang ? ` class="language-${ea(n.props.lang)}"` : ''}>${eh(n.props.code)}</code></pre></figure>`,
    },

    {
      type: 'image', label: 'Image', group: 'Media', icon: 'image',
      fields: [
        f('mediaId', 'image', 'Image', { required: true }),
        f('alt', 'text', 'Alt text', { help: 'Overrides the library alt' }),
        f('caption', 'text', 'Caption'),
        f('width', 'select', 'Size', { options: [{ value: 'normal' }, { value: 'wide' }, { value: 'small' }], default: 'normal', width: 'half' }),
        f('rounded', 'boolean', 'Rounded corners', { default: true, width: 'half' }),
        f('lightbox', 'boolean', 'Open in lightbox', { width: 'half' }),
        f('priority', 'boolean', 'Above the fold', { help: 'Eager-load + preload (use once per page)', width: 'half' }),
      ],
      defaults: { width: 'normal', rounded: true },
      enhance: 'lightbox',
      render: async (c, n) => {
        if (!n.props.mediaId) return `<div class="wb-image is-empty">Choose an image…</div>`
        const pic = await pictureHtml(c, n.props.mediaId, {
          alt: n.props.alt, priority: n.props.priority,
          width: n.props.width === 'wide' ? 1280 : n.props.width === 'small' ? 480 : 860,
        })
        return `<figure class="wb-image size-${ea(n.props.width)}${n.props.rounded ? ' rounded' : ''}${n.props.lightbox ? '" data-lightbox="1' : ''}">${pic}${n.props.caption ? `<figcaption>${eh(n.props.caption)}</figcaption>` : ''}</figure>`
      },
    },

    {
      type: 'gallery', label: 'Gallery', group: 'Media', icon: 'copy',
      fields: [
        f('items', 'list', 'Images', { item: [f('mediaId', 'image', 'Image'), f('alt', 'text', 'Alt text')] }),
        f('cols', 'select', 'Columns', { options: [{ value: '2' }, { value: '3' }, { value: '4' }], default: '3', width: 'half' }),
        f('lightbox', 'boolean', 'Lightbox', { default: true, width: 'half' }),
      ],
      defaults: { items: [], cols: '3', lightbox: true },
      enhance: 'lightbox',
      render: async (c, n) => {
        const cells: string[] = []
        for (const it of n.props.items || []) {
          if (!it.mediaId) continue
          cells.push(`<figure${n.props.lightbox ? ' data-lightbox="1"' : ''}>${await pictureHtml(c, it.mediaId, { alt: it.alt, width: 640, sizes: '(max-width: 640px) 50vw, 33vw' })}</figure>`)
        }
        return `<div class="wb-gallery cols-${ea(n.props.cols)}">${cells.join('')}</div>`
      },
    },

    {
      type: 'video', label: 'Video', group: 'Media', icon: 'video',
      fields: [
        f('url', 'text', 'Video URL', { help: 'MP4/WebM file URL' }),
        f('poster', 'image', 'Poster image'),
        f('autoplay', 'boolean', 'Autoplay (muted)', { width: 'half' }),
        f('loop', 'boolean', 'Loop', { width: 'half' }),
      ],
      render: async (c, n) => {
        if (!n.props.url) return `<div class="wb-video is-empty">Set a video URL…</div>`
        let poster = ''
        if (n.props.poster) {
          const m = await c.env.media.meta(n.props.poster)
          if (m) poster = ` poster="/media/${ea(m.file)}"`
        }
        const auto = n.props.autoplay ? ' autoplay muted playsinline' : ' controls'
        return `<figure class="wb-video"><video src="${ea(n.props.url)}"${poster}${auto}${n.props.loop ? ' loop' : ''} preload="metadata"></video></figure>`
      },
    },

    {
      type: 'embed', label: 'Embed', group: 'Media', icon: 'play',
      description: 'YouTube/Vimeo with a privacy-friendly click-to-load facade',
      fields: [
        f('url', 'text', 'URL', { required: true, help: 'YouTube, Vimeo or embeddable page URL' }),
        f('title', 'text', 'Title', { help: 'Accessible label' }),
      ],
      enhance: 'embed',
      render: (_c, n) => {
        const url = String(n.props.url || '')
        const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.exec(url)
        const vm = /vimeo\.com\/(\d+)/.exec(url)
        const title = ea(n.props.title || 'Embedded video')
        if (yt) {
          return `<div class="wb-embed" data-embed="https://www.youtube-nocookie.com/embed/${ea(yt[1])}?autoplay=1" data-title="${title}">` +
            `<button class="embed-facade" style="background-image:url('https://i.ytimg.com/vi/${ea(yt[1])}/hqdefault.jpg')" aria-label="Play: ${title}"><span class="embed-play" aria-hidden="true"></span></button></div>`
        }
        if (vm) {
          return `<div class="wb-embed" data-embed="https://player.vimeo.com/video/${ea(vm[1])}?autoplay=1" data-title="${title}">` +
            `<button class="embed-facade" aria-label="Play: ${title}"><span class="embed-play" aria-hidden="true"></span></button></div>`
        }
        if (!url) return `<div class="wb-embed is-empty">Paste a URL…</div>`
        return `<div class="wb-embed"><iframe src="${ea(url)}" title="${title}" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`
      },
    },

    {
      type: 'svg', label: 'SVG', group: 'Media', icon: 'vector',
      description: 'Inline vector art — theme-aware via currentColor',
      fields: [
        f('source', 'svg', 'SVG source', { help: 'Sanitized. Use fill="currentColor" to follow the theme.' }),
        f('maxWidth', 'number', 'Max width (px)', { width: 'half' }),
        f('align', 'select', 'Align', { options: [{ value: 'left' }, { value: 'center' }], default: 'center', width: 'half' }),
        f('animate', 'boolean', 'Fade in on view', { default: false }),
      ],
      defaults: { align: 'center' },
      enhance: 'reveal',
      render: (_c, n) => {
        const svg = sanitizeSvg(n.props.source || '')
        if (!svg) return `<div class="wb-svg is-empty">Paste SVG source…</div>`
        return `<div class="wb-svg${n.props.animate ? ' reveal' : ''}"${align(n.props.align)}><div class="svg-holder"${n.props.maxWidth ? ` style="max-width:${+n.props.maxWidth}px"` : ''}>${svg}</div></div>`
      },
    },

    {
      type: 'button', label: 'Button', group: 'Actions', icon: 'link',
      fields: [
        f('label', 'text', 'Label', { required: true }),
        f('link', 'link', 'Link'),
        f('style', 'select', 'Style', { options: [{ value: 'primary' }, { value: 'ghost' }, { value: 'soft' }], default: 'primary', width: 'half' }),
        f('size', 'select', 'Size', { options: [{ value: 'normal' }, { value: 'large' }], default: 'normal', width: 'half' }),
        f('align', 'select', 'Align', { options: [{ value: 'left' }, { value: 'center' }], default: 'left', width: 'half' }),
        f('newTab', 'boolean', 'Open in new tab', { width: 'half' }),
      ],
      defaults: { style: 'primary', size: 'normal', align: 'left' },
      render: async (c, n) =>
        `<p class="wb-button"${align(n.props.align)}><a class="btn btn-${ea(n.props.style)} btn-${ea(n.props.size)}" href="${ea(await href(c, n.props.link))}"${n.props.newTab ? ' target="_blank" rel="noopener"' : ''}><span${wbe(c, 'label')}>${eh(n.props.label)}</span></a></p>`,
    },

    {
      type: 'cta', label: 'Call to action', group: 'Actions', icon: 'send',
      fields: [
        f('title', 'text', 'Title'),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary' }, { value: 'ghost' }], default: 'primary' })] }),
      ],
      defaults: { buttons: [] },
      render: async (c, n) => {
        const btns: string[] = []
        for (const b of n.props.buttons || []) {
          btns.push(`<a class="btn btn-${ea(b.style || 'primary')} btn-large" href="${ea(await href(c, b.link))}">${eh(b.label)}</a>`)
        }
        return `<div class="wb-cta"><div class="cta-body"><h2${wbe(c, 'title')}>${eh(n.props.title)}</h2>${n.props.text ? `<p${wbe(c, 'text')}>${eh(n.props.text)}</p>` : ''}</div><div class="cta-actions">${btns.join('')}</div></div>`
      },
    },

    {
      type: 'hero', label: 'Hero', group: 'Layout', icon: 'mountain',
      fields: [
        f('title', 'text', 'Title', { required: true }),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('eyebrow', 'text', 'Eyebrow'),
        f('mediaId', 'image', 'Image'),
        f('layout', 'select', 'Layout', { options: [{ value: 'center' }, { value: 'split' }], default: 'center', width: 'half' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary' }, { value: 'ghost' }], default: 'primary' })] }),
      ],
      defaults: { layout: 'center', buttons: [] },
      render: async (c, n) => {
        const btns: string[] = []
        for (const b of n.props.buttons || []) btns.push(`<a class="btn btn-${ea(b.style || 'primary')} btn-large" href="${ea(await href(c, b.link))}">${eh(b.label)}</a>`)
        const img = n.props.mediaId ? await pictureHtml(c, n.props.mediaId, { priority: true, width: n.props.layout === 'split' ? 640 : 1280, vtName: 'hero-' + n.id.slice(-6) }) : ''
        return `<header class="wb-hero layout-${ea(n.props.layout)}"><div class="hero-copy">${n.props.eyebrow ? `<p class="eyebrow"${wbe(c, 'eyebrow')}>${eh(n.props.eyebrow)}</p>` : ''}<h1${wbe(c, 'title')}>${eh(n.props.title)}</h1>${n.props.text ? `<p class="hero-text"${wbe(c, 'text')}>${eh(n.props.text)}</p>` : ''}${btns.length ? `<div class="hero-actions">${btns.join('')}</div>` : ''}</div>${img ? `<div class="hero-media">${img}</div>` : ''}</header>`
      },
    },

    {
      type: 'divider', label: 'Divider', group: 'Layout', icon: 'minus',
      fields: [f('style', 'select', 'Style', { options: [{ value: 'line' }, { value: 'dots' }, { value: 'blank' }], default: 'line' })],
      defaults: { style: 'line' },
      render: (_c, n) => `<hr class="wb-divider style-${ea(n.props.style)}">`,
    },
    {
      type: 'spacer', label: 'Spacer', group: 'Layout', icon: 'spacer',
      fields: [f('size', 'select', 'Size', { options: [{ value: 'small' }, { value: 'medium' }, { value: 'large' }], default: 'medium' })],
      defaults: { size: 'medium' },
      render: (_c, n) => `<div class="wb-spacer size-${ea(n.props.size)}" aria-hidden="true"></div>`,
    },

    {
      type: 'faq', label: 'FAQ', group: 'Interactive', icon: 'help', container: true, childTypes: ['faq-item'],
      description: 'Accessible accordion + automatic FAQ structured data',
      fields: [f('single', 'boolean', 'Open one at a time', { default: false })],
      render: (_c, n, inner) => `<div class="wb-faq"${n.props.single ? ' data-single="1"' : ''}>${inner}</div>`,
      jsonld: (ctx, node) => {
        const qs = (node.children || []).filter(c => c.type === 'faq-item' && c.props.question)
        if (!qs.length) return null
        return {
          '@type': 'FAQPage',
          mainEntity: qs.map(q => ({
            '@type': 'Question', name: q.props.question,
            acceptedAnswer: { '@type': 'Answer', text: mdText(collectMd(q)) },
          })),
        }
      },
    },
    {
      type: 'faq-item', label: 'FAQ item', group: 'Interactive', icon: 'help', container: true, hiddenFromPicker: false,
      fields: [f('question', 'text', 'Question', { required: true }), f('open', 'boolean', 'Open by default', { width: 'half' })],
      enhance: 'faq',
      render: (_c, n, inner) =>
        `<details class="wb-faq-item"${n.props.open ? ' open' : ''}><summary><span${wbe(_c as any, 'question')}>${eh(n.props.question)}</span><svg class="faq-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary><div class="faq-body">${inner}</div></details>`,
    },

    {
      type: 'tabs', label: 'Tabs', group: 'Interactive', icon: 'tabs', container: true, childTypes: ['tab'],
      fields: [],
      enhance: 'tabs',
      render: (_c, n, inner) => {
        const labels = (n.children || []).map((t, i) =>
          `<button role="tab" id="tab-${n.id}-${i}" aria-controls="panel-${n.id}-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${eh(t.props.label || `Tab ${i + 1}`)}</button>`).join('')
        return `<div class="wb-tabs" data-tabs><div role="tablist" class="tabs-list">${labels}</div>${inner}</div>`
      },
    },
    {
      type: 'tab', label: 'Tab', group: 'Interactive', icon: 'tabs', container: true, hiddenFromPicker: false,
      fields: [f('label', 'text', 'Label', { required: true })],
      render: (ctx, n, inner) => {
        const parentInfo = (ctx as any)._tabIndex?.[n.id] || { parent: n.id, index: 0 }
        return `<div role="tabpanel" class="tab-panel" id="panel-${parentInfo.parent}-${parentInfo.index}" aria-labelledby="tab-${parentInfo.parent}-${parentInfo.index}"${parentInfo.index > 0 ? ' hidden' : ''}>${inner}</div>`
      },
    },

    {
      type: 'table', label: 'Table', group: 'Interactive', icon: 'table',
      fields: [
        f('data', 'table', 'Table data'),
        f('headerRow', 'boolean', 'First row is header', { default: true, width: 'half' }),
        f('striped', 'boolean', 'Striped rows', { default: true, width: 'half' }),
        f('caption', 'text', 'Caption'),
      ],
      defaults: { data: [['Column A', 'Column B'], ['', '']], headerRow: true, striped: true },
      render: (_c, n) => {
        const rows: string[][] = Array.isArray(n.props.data) ? n.props.data : []
        if (!rows.length) return `<div class="wb-table is-empty">Add table data…</div>`
        let html = `<div class="wb-table${n.props.striped ? ' striped' : ''}"><table>`
        if (n.props.caption) html += `<caption>${eh(n.props.caption)}</caption>`
        rows.forEach((row, ri) => {
          const cell = n.props.headerRow && ri === 0 ? 'th' : 'td'
          if (n.props.headerRow && ri === 0) html += '<thead>'
          if (ri === (n.props.headerRow ? 1 : 0)) html += (n.props.headerRow ? '</thead>' : '') + '<tbody>'
          html += `<tr>${row.map(c2 => `<${cell}${cell === 'th' ? ' scope="col"' : ''}>${mdToHtml(String(c2 ?? '')).replace(/^<p>|<\/p>\n?$/g, '')}</${cell}>`).join('')}</tr>`
        })
        return html + '</tbody></table></div>'
      },
    },

    {
      type: 'pricing', label: 'Pricing', group: 'Marketing', icon: 'tag',
      fields: [
        f('plans', 'list', 'Plans', {
          item: [
            f('name', 'text', 'Name'), f('price', 'text', 'Price'), f('period', 'text', 'Period'),
            f('features', 'textarea', 'Features (one per line)', { rows: 4 }),
            f('ctaLabel', 'text', 'Button label'), f('link', 'link', 'Button link'),
            f('featured', 'boolean', 'Featured'),
          ],
        }),
      ],
      defaults: { plans: [] },
      render: async (c, n) => {
        const cards: string[] = []
        for (const p of n.props.plans || []) {
          const feats = String(p.features || '').split('\n').filter(Boolean)
            .map((ft: string) => `<li>${eh(ft)}</li>`).join('')
          cards.push(`<div class="price-card${p.featured ? ' featured' : ''}">${p.featured ? '<span class="price-flag">Most popular</span>' : ''}<h3>${eh(p.name)}</h3><p class="price"><span class="amount">${eh(p.price)}</span>${p.period ? `<span class="period">/${eh(p.period)}</span>` : ''}</p><ul class="price-features">${feats}</ul>${p.ctaLabel ? `<a class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'}" href="${ea(await href(c, p.link))}">${eh(p.ctaLabel)}</a>` : ''}</div>`)
        }
        return `<div class="wb-pricing cols-${Math.min(4, Math.max(1, (n.props.plans || []).length))}">${cards.join('')}</div>`
      },
    },

    {
      type: 'html', label: 'Raw HTML', group: 'Advanced', icon: 'code',
      description: 'Sanitized raw HTML (editors and up)',
      permission: 'content.publish',
      fields: [f('html', 'code', 'HTML')],
      render: (_c, n) => `<div class="wb-html">${sanitizeHtml(n.props.html || '')}</div>`,
    },
  ]

  for (const d of defs) registry.registerBlock(d)
}

function collectMd(node: BlockNode): string {
  let out = ''
  const walk = (n: BlockNode) => {
    if (n.type === 'richtext' && n.props.md) out += n.props.md + '\n'
    for (const c of n.children || []) walk(c)
  }
  walk(node)
  return out
}
