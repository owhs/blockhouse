// Native block library. Every block: inspector field schema + HTML renderer.
// Styling lives in the template (wb-* classes); interactivity in small runtime
// enhancers loaded only when a page uses them.

import type { BlockDef, RenderCtx, BlockNode } from '../core/types.ts'
import type { Registry } from '../core/registry.ts'
import { escapeAttr as ea, escapeHtml as eh, slugify } from '../core/util.ts'
import { mdToHtml, mdText } from '../core/markdown.ts'
import { pictureHtml } from './imgtag.ts'
import { sanitizeHtml, sanitizeSvg } from '../core/sanitize.ts'
import { LAYOUT_WIDTHS, normalizeWidth } from './layout.ts'

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
  if (!ctx.annotate) return ''
  // mode 'img' means "this is the picture from that prop" — clicking it selects
  // the block and puts the cursor on the matching image field, rather than
  // trying to type into an image.
  if (mode === 'img') return ` data-wbe-img="${prop}"`
  return ` data-wbe="${prop}"${mode ? ` data-wbe-mode="${mode}"` : ''}`
}

export function registerNativeBlocks(registry: Registry) {
  const defs: BlockDef[] = [

    {
      type: 'section', label: 'Section', group: 'Layout', icon: 'layout', container: true,
      description: 'A band across the page. Give it a background and put other blocks inside.',
      fields: [
        f('width', 'select', 'Width', { options: LAYOUT_WIDTHS.map(w => ({ value: w.value, label: w.label })), default: 'normal', help: 'How wide this section runs across the page.', canonicalWidth: true }),
        f('background', 'select', 'Background', { options: [{ value: 'none', label: 'None' }, { value: 'subtle', label: 'Soft tint' }, { value: 'accent', label: 'Brand colour' }, { value: 'contrast', label: 'Dark' }], default: 'none' }),
        f('padding', 'select', 'Vertical padding', { options: [{ value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Tight' }, { value: 'spacious', label: 'Roomy' }, { value: 'none', label: 'None' }], default: 'normal' }),
        f('anchor', 'text', 'Jump-to name', { help: 'A short name so links can jump straight to this section (letters and dashes).' }),
      ],
      defaults: { width: 'normal', background: 'none', padding: 'normal' },
      render: (_c, n, inner) =>
        `<section class="wb-section bg-${ea(n.props.background)} pad-${ea(n.props.padding)}"${n.props.anchor ? ` id="${ea(n.props.anchor)}"` : ''}><div class="container w-${ea(normalizeWidth(n.props.width) || 'normal')}">${inner}</div></section>`,
    },

    {
      type: 'columns', label: 'Columns', group: 'Layout', icon: 'columns', container: true,
      description: 'Side-by-side columns. Put a block in each.',
      fields: [
        f('cols', 'select', 'Columns', { options: [{ value: '2', label: 'Two' }, { value: '3', label: 'Three' }, { value: '4', label: 'Four' }], default: '2' }),
        f('gap', 'select', 'Gap', { options: [{ value: 'normal', label: 'Normal' }, { value: 'tight', label: 'Tight' }, { value: 'loose', label: 'Roomy' }], default: 'normal' }),
        f('align', 'select', 'Vertical align', { options: [{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }], default: 'top' }),
      ],
      defaults: { cols: '2', gap: 'normal', align: 'top' },
      render: (_c, n, inner) => `<div class="wb-columns cols-${ea(n.props.cols)} gap-${ea(n.props.gap)} valign-${ea(n.props.align)}">${inner}</div>`,
    },

    {
      type: 'heading', label: 'Heading', group: 'Text', icon: 'heading',
      description: 'A title that breaks your writing into sections.',
      fields: [
        f('text', 'text', 'Text', { required: true }),
        f('level', 'select', 'Level', { options: [{ value: '1', label: 'Biggest (page title)' }, { value: '2', label: 'Section title' }, { value: '3', label: 'Sub-section' }, { value: '4', label: 'Smallest' }], default: '2', width: 'half', help: 'Use the biggest once per page, then work down in order.' }),
        f('align', 'select', 'Align', { options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centred' }], default: 'left', width: 'half' }),
        f('eyebrow', 'text', 'Eyebrow', { help: 'A small line above the heading.' }),
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
      description: 'Paragraphs, lists and links — most of your writing goes here.',
      fields: [f('md', 'richtext', 'Content')],
      defaults: { md: '' },
      render: (c, n) => `<div class="wb-richtext prose"${wbe(c, 'md', 'md')}>${mdToHtml(n.props.md || '')}</div>`,
    },

    {
      type: 'quote', label: 'Quote', group: 'Text', icon: 'quote',
      description: 'Words from a customer or colleague, set apart from the rest of the page.',
      fields: [f('text', 'textarea', 'Quote', { rows: 3 }), f('cite', 'text', 'Attribution')],
      render: (c, n) => `<figure class="wb-quote"><blockquote${wbe(c, 'text')}>${eh(n.props.text)}</blockquote>${n.props.cite ? `<figcaption${wbe(c, 'cite')}>${eh(n.props.cite)}</figcaption>` : ''}</figure>`,
    },

    {
      type: 'code', label: 'Code', group: 'Text', icon: 'code',
      description: 'A block of computer code, shown exactly as typed.',
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
      description: 'One picture on its own, with an optional caption under it.',
      fields: [
        f('mediaId', 'image', 'Image', { required: true }),
        f('alt', 'text', 'Description for screen readers', { help: 'Says what the picture shows, for people who cannot see it. Leave blank to use the description saved with the picture.' }),
        f('caption', 'text', 'Caption'),
        f('width', 'select', 'Picture size', { options: [{ value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Large' }], default: 'normal', width: 'half', help: 'How big the picture itself is drawn.' }),
        f('rounded', 'boolean', 'Rounded corners', { default: true, width: 'half' }),
        f('lightbox', 'boolean', 'Enlarge on click', { width: 'half', help: 'Clicking the picture opens it full size over the page.' }),
        f('priority', 'boolean', 'First thing people see', { help: 'Loads this picture first. Use it once per page, on the picture at the very top.', width: 'half' }),
      ],
      defaults: { width: 'normal', rounded: true },
      enhance: 'lightbox',
      render: async (c, n) => {
        if (!n.props.mediaId) return `<div class="wb-image is-empty">Choose an image…</div>`
        const pic = await pictureHtml(c, n.props.mediaId, {
          alt: n.props.alt, priority: n.props.priority,
          width: n.props.width === 'wide' ? 1280 : n.props.width === 'small' ? 480 : 860,
        })
        return `<figure class="wb-image size-${ea(n.props.width)}${n.props.rounded ? ' rounded' : ''}${n.props.lightbox ? '" data-lightbox="1' : ''}"${wbe(c, 'mediaId', 'img')}>${pic}${n.props.caption ? `<figcaption${wbe(c, 'caption')}>${eh(n.props.caption)}</figcaption>` : ''}</figure>`
      },
    },

    {
      type: 'gallery', label: 'Gallery', group: 'Media', icon: 'copy',
      description: 'A grid of pictures — a finished job, a product range, a site visit.',
      fields: [
        f('items', 'list', 'Images', { item: [f('mediaId', 'image', 'Image'), f('alt', 'text', 'Description for screen readers')] }),
        f('cols', 'select', 'Columns', { options: [{ value: '2', label: 'Two' }, { value: '3', label: 'Three' }, { value: '4', label: 'Four' }], default: '3', width: 'half' }),
        f('lightbox', 'boolean', 'Enlarge on click', { default: true, width: 'half', help: 'Clicking a picture opens it full size over the page.' }),
      ],
      defaults: { items: [], cols: '3', lightbox: true },
      enhance: 'lightbox',
      render: async (c, n) => {
        const cells: string[] = []
        const items: any[] = n.props.items || []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (!it.mediaId) continue
          cells.push(`<figure${n.props.lightbox ? ' data-lightbox="1"' : ''}${wbe(c, `items.${i}.mediaId`, 'img')}>${await pictureHtml(c, it.mediaId, { alt: it.alt, width: 640, sizes: '(max-width: 640px) 50vw, 33vw' })}</figure>`)
        }
        return `<div class="wb-gallery cols-${ea(n.props.cols)}">${cells.join('')}</div>`
      },
    },

    {
      type: 'video', label: 'Video', group: 'Media', icon: 'video',
      description: 'A video you host yourself, played straight on the page.',
      fields: [
        f('url', 'text', 'Video address', { help: 'The web address of the video file, ending .mp4 or .webm.' }),
        f('poster', 'image', 'Still picture shown before play'),
        f('autoplay', 'boolean', 'Start playing on its own (no sound)', { width: 'half' }),
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
      description: 'A YouTube or Vimeo video that only loads when someone presses play.',
      fields: [
        f('url', 'text', 'Video address', { required: true, help: 'Paste the web address of the YouTube or Vimeo page.' }),
        f('title', 'text', 'Title', { help: 'What the video shows. Read out to people using a screen reader.' }),
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
      type: 'svg', label: 'Drawing or icon', group: 'Media', icon: 'vector',
      description: 'A simple line drawing or symbol that picks up your brand colours.',
      fields: [
        f('source', 'svg', 'Drawing', { help: 'Paste the drawing code your designer gave you. Anything unsafe is removed automatically.' }),
        f('maxWidth', 'number', 'Largest width (pixels)', { width: 'half' }),
        f('align', 'select', 'Align', { options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centred' }], default: 'center', width: 'half' }),
        f('animate', 'boolean', 'Fade in when scrolled to', { default: false }),
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
      description: 'A button that takes someone to another page — "Get a quote", "See the range".',
      fields: [
        f('label', 'text', 'Label', { required: true }),
        f('link', 'link', 'Link'),
        f('style', 'select', 'Style', { options: [{ value: 'primary', label: 'Solid (main action)' }, { value: 'ghost', label: 'Outlined' }, { value: 'soft', label: 'Soft tint' }], default: 'primary', width: 'half' }),
        f('size', 'select', 'Size', { options: [{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }], default: 'normal', width: 'half' }),
        f('align', 'select', 'Align', { options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centred' }], default: 'left', width: 'half' }),
        f('newTab', 'boolean', 'Open in new tab', { width: 'half' }),
      ],
      defaults: { style: 'primary', size: 'normal', align: 'left' },
      render: async (c, n) =>
        `<p class="wb-button"${align(n.props.align)}><a class="btn btn-${ea(n.props.style)} btn-${ea(n.props.size)}" href="${ea(await href(c, n.props.link))}"${n.props.newTab ? ' target="_blank" rel="noopener"' : ''}><span${wbe(c, 'label')}>${eh(n.props.label)}</span></a></p>`,
    },

    {
      type: 'cta', label: 'Call to action', group: 'Actions', icon: 'send',
      description: 'A short prompt with buttons — the "ask" at the end of a page.',
      fields: [
        f('title', 'text', 'Title'),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary', label: 'Solid (main action)' }, { value: 'ghost', label: 'Outlined' }], default: 'primary' })] }),
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
      description: 'The opening banner of a page — big headline, a line of text and a button or two.',
      fields: [
        f('title', 'text', 'Title', { required: true }),
        f('text', 'textarea', 'Text', { rows: 2 }),
        f('eyebrow', 'text', 'Eyebrow', { help: 'A small line above the headline.' }),
        f('mediaId', 'image', 'Image'),
        f('layout', 'select', 'Layout', { options: [{ value: 'center', label: 'Centred' }, { value: 'split', label: 'Text beside the picture' }], default: 'center', width: 'half' }),
        f('buttons', 'list', 'Buttons', { item: [f('label', 'text', 'Label'), f('link', 'link', 'Link'), f('style', 'select', 'Style', { options: [{ value: 'primary', label: 'Solid (main action)' }, { value: 'ghost', label: 'Outlined' }], default: 'primary' })] }),
      ],
      defaults: { layout: 'center', buttons: [] },
      render: async (c, n) => {
        const btns: string[] = []
        for (const b of n.props.buttons || []) btns.push(`<a class="btn btn-${ea(b.style || 'primary')} btn-large" href="${ea(await href(c, b.link))}">${eh(b.label)}</a>`)
        const img = n.props.mediaId ? await pictureHtml(c, n.props.mediaId, { priority: true, width: n.props.layout === 'split' ? 640 : 1280, vtName: 'hero-' + n.id.slice(-6) }) : ''
        return `<header class="wb-hero layout-${ea(n.props.layout)}"><div class="hero-copy">${n.props.eyebrow ? `<p class="eyebrow"${wbe(c, 'eyebrow')}>${eh(n.props.eyebrow)}</p>` : ''}<h1${wbe(c, 'title')}>${eh(n.props.title)}</h1>${n.props.text ? `<p class="hero-text"${wbe(c, 'text')}>${eh(n.props.text)}</p>` : ''}${btns.length ? `<div class="hero-actions">${btns.join('')}</div>` : ''}</div>${img ? `<div class="hero-media"${wbe(c, 'mediaId', 'img')}>${img}</div>` : ''}</header>`
      },
    },

    {
      type: 'divider', label: 'Divider', group: 'Layout', icon: 'minus',
      description: 'A line across the page to separate one part from the next.',
      fields: [f('style', 'select', 'Style', { options: [{ value: 'line', label: 'Line' }, { value: 'dots', label: 'Dots' }, { value: 'blank', label: 'Invisible gap' }], default: 'line' })],
      defaults: { style: 'line' },
      render: (_c, n) => `<hr class="wb-divider style-${ea(n.props.style)}">`,
    },
    {
      type: 'spacer', label: 'Spacer', group: 'Layout', icon: 'spacer',
      description: 'Empty space, for when two blocks need more room between them.',
      fields: [f('size', 'select', 'Size', { options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], default: 'medium' })],
      defaults: { size: 'medium' },
      render: (_c, n) => `<div class="wb-spacer size-${ea(n.props.size)}" aria-hidden="true"></div>`,
    },

    {
      type: 'faq', label: 'FAQ', group: 'Interactive', icon: 'help', container: true, childTypes: ['faq-item'],
      description: 'Questions that open to show the answer. Search engines understand it too.',
      fields: [f('single', 'boolean', 'Open one at a time', { default: false, help: 'Opening a question closes the one before it.' })],
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
      description: 'One question. Put the answer inside it.',
      fields: [f('question', 'text', 'Question', { required: true }), f('open', 'boolean', 'Open by default', { width: 'half' })],
      enhance: 'faq',
      render: (_c, n, inner) =>
        `<details class="wb-faq-item"${n.props.open ? ' open' : ''}><summary><span${wbe(_c as any, 'question')}>${eh(n.props.question)}</span><svg class="faq-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary><div class="faq-body">${inner}</div></details>`,
    },

    {
      type: 'tabs', label: 'Tabs', group: 'Interactive', icon: 'tabs', container: true, childTypes: ['tab'],
      description: 'Named tabs that swap what is shown below them — specs, downloads, delivery.',
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
      description: 'One tab. Put whatever it should show inside it.',
      fields: [f('label', 'text', 'Label', { required: true })],
      render: (ctx, n, inner) => {
        const parentInfo = (ctx as any)._tabIndex?.[n.id] || { parent: n.id, index: 0 }
        return `<div role="tabpanel" class="tab-panel" id="panel-${parentInfo.parent}-${parentInfo.index}" aria-labelledby="tab-${parentInfo.parent}-${parentInfo.index}"${parentInfo.index > 0 ? ' hidden' : ''}>${inner}</div>`
      },
    },

    {
      type: 'table', label: 'Table', group: 'Interactive', icon: 'table',
      description: 'Rows and columns of figures — capacities, sizes, lead times.',
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
      description: 'Side-by-side price cards, each with a list of what is included.',
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
      description: 'Paste in code from another service — a booking widget, a live map. Editors and above only.',
      permission: 'content.publish',
      fields: [f('html', 'code', 'HTML', { help: 'Anything unsafe is removed before the page is shown.' })],
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
