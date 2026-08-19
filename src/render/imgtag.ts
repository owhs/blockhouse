// Responsive <picture> builder. Emits webp sources + fallback with srcset,
// intrinsic dimensions, lazy loading and a dominant-colour placeholder.
// provider "cloudflare" swaps derivative URLs for /cdn-cgi/image/ transforms.

import type { MediaMeta, RenderCtx } from '../core/types.ts'
import { escapeAttr } from '../core/util.ts'

export interface ImgOpts {
  alt?: string
  sizes?: string
  class?: string
  priority?: boolean       // above-the-fold: eager + fetchpriority + preload
  width?: number           // layout hint (largest useful CSS px)
  vtName?: string          // view-transition-name for shared-element transitions
}

export async function pictureHtml(ctx: RenderCtx, mediaId: string, opts: ImgOpts = {}): Promise<string> {
  const media = ctx.env.media
  const meta: MediaMeta | null = await media.meta(mediaId)
  if (!meta) return ''
  const cfg = ctx.site.images
  const alt = escapeAttr(opts.alt ?? meta.alt ?? '')

  if (!meta.type.startsWith('image/') || meta.type === 'image/svg+xml' || meta.type === 'image/gif') {
    return `<img src="/media/${escapeAttr(meta.file)}" alt="${alt}" ${meta.width ? `width="${meta.width}" height="${meta.height}"` : ''} loading="lazy" decoding="async"${opts.class ? ` class="${escapeAttr(opts.class)}"` : ''}>`
  }

  const maxW = opts.width || 1280
  const widths = cfg.sizes.filter(w => !meta.width || w <= Math.max(meta.width, cfg.sizes[0])).filter(w => w <= maxW * 2)
  const use = widths.length ? widths : [cfg.sizes[0]]
  const sizes = opts.sizes || `(max-width: 640px) 100vw, ${Math.min(maxW, meta.width || maxW)}px`

  const url = (w: number, fmt: string) => {
    if (cfg.provider === 'cloudflare') {
      const f = fmt === 'original' ? 'auto' : fmt
      return `/cdn-cgi/image/width=${w},quality=${cfg.quality},format=${f}/media/${meta.file}`
    }
    const u = media.variantUrl(meta, w, fmt, cfg)
    ctx.collect.variants.add(`${meta.id}|${w}|${fmt}`)
    return u
  }

  const webpSet = use.map(w => `${url(w, 'webp')} ${w}w`).join(', ')
  const fallbackSet = use.map(w => `${url(w, 'original')} ${w}w`).join(', ')
  const fallbackSrc = url(use[Math.min(1, use.length - 1)], 'original')

  const ratio = meta.width && meta.height ? ` style="aspect-ratio:${meta.width}/${meta.height};${meta.dominant ? `background:${meta.dominant};` : ''}${opts.vtName ? `view-transition-name:${escapeAttr(opts.vtName)};` : ''}"` : ''
  const loading = opts.priority ? `loading="eager" fetchpriority="high"` : `loading="lazy"`
  if (opts.priority) ctx.collect.headExtra.push(`<link rel="preload" as="image" href="${url(use[use.length - 1], 'webp')}" imagesrcset="${webpSet}" imagesizes="${escapeAttr(sizes)}">`)

  return `<picture>` +
    `<source type="image/webp" srcset="${webpSet}" sizes="${escapeAttr(sizes)}">` +
    `<img src="${fallbackSrc}" srcset="${fallbackSet}" sizes="${escapeAttr(sizes)}" alt="${alt}"` +
    `${meta.width ? ` width="${meta.width}" height="${meta.height}"` : ''}${ratio} ${loading} decoding="async"${opts.class ? ` class="${escapeAttr(opts.class)}"` : ''}>` +
    `</picture>`
}
