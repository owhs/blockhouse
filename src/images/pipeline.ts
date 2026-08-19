// Image pipeline. Originals live in media/, metadata in media/_meta/<id>.json,
// derivatives in media/_var/. Derivatives are generated on demand (then cached
// on disk / in the bucket), or pre-generated during static export.
// sharp powers resize/webp/watermark when present; without it the pipeline
// degrades to serving (exif-stripped) originals.

import type { ImageConfig, MediaMeta, SiteConfig } from '../core/types.ts'
import { id, now, slugify, stringify, tryJson, fillPattern, sha256hex } from '../core/util.ts'
import type { StorageDriver } from '../storage/driver.ts'
import { imageDimensions, mimeOf, stripJpegMetadata } from './exif.ts'

let sharpMod: any = undefined
/** True when native image processing is available. Used by `blockhouse doctor`. */
export async function hasSharp(): Promise<boolean> { return !!(await getSharp()) }
async function getSharp(): Promise<any | null> {
  if (sharpMod !== undefined) return sharpMod
  // Indirect specifier: keeps bundlers (and the Workers build, which has no
  // node builtins) from statically pulling sharp in. On Bun/Node it still
  // resolves normally when the optional dependency is installed.
  const spec = 'sharp'
  try { sharpMod = (await import(/* @vite-ignore */ spec)).default } catch { sharpMod = null }
  return sharpMod
}

export class MediaStore {
  constructor(private driver: StorageDriver) {}

  async list(): Promise<MediaMeta[]> {
    const keys = await this.driver.list('media/_meta')
    const out: MediaMeta[] = []
    for (const k of keys.filter(k => k.endsWith('.json'))) {
      const m = tryJson<MediaMeta | null>(await this.driver.readText(k), null)
      if (m?.id) out.push(m)
    }
    return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  }

  async meta(mediaId: string): Promise<MediaMeta | null> {
    return tryJson(await this.driver.readText(`media/_meta/${mediaId}.json`), null)
  }

  async saveMeta(meta: MediaMeta) {
    await this.driver.write(`media/_meta/${meta.id}.json`, stringify(meta))
  }

  /** Folder tree + tag cloud derived from metadata (virtual, no filesystem moves). */
  async index(): Promise<{ folders: string[]; tags: { tag: string; n: number }[]; total: number }> {
    const all = await this.list()
    const folders = new Set<string>()
    const tags = new Map<string, number>()
    for (const m of all) {
      if (m.folder) {
        const parts = m.folder.split('/').filter(Boolean)
        for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
      }
      for (const t of m.tags || []) tags.set(t, (tags.get(t) || 0) + 1)
    }
    return {
      folders: [...folders].sort(),
      tags: [...tags.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
      total: all.length,
    }
  }

  /** Search + filter for the asset manager. */
  async search(q: { text?: string; folder?: string; tag?: string; type?: string; private?: boolean }): Promise<MediaMeta[]> {
    const text = (q.text || '').toLowerCase().trim()
    return (await this.list()).filter(m => {
      if (q.private !== undefined && !!m.private !== q.private) return false
      if (q.folder !== undefined && q.folder !== '' && !(m.folder || '').startsWith(q.folder)) return false
      if (q.folder === '' && m.folder) return false
      if (q.tag && !(m.tags || []).includes(q.tag)) return false
      if (q.type === 'image' && !m.type.startsWith('image/')) return false
      if (q.type === 'doc' && m.type.startsWith('image/')) return false
      if (!text) return true
      const hay = [m.name, m.alt, m.title, m.caption, m.credit, m.folder, ...(m.tags || [])].join(' ').toLowerCase()
      return hay.includes(text)
    })
  }

  async upload(name: string, bytes: Uint8Array, cfg: SiteConfig, opts: { alt?: string; private?: boolean; folder?: string; tags?: string[] } = {}): Promise<MediaMeta> {
    const ext = (name.split('.').pop() || 'bin').toLowerCase()
    const base = slugify(name.replace(/\.[^.]+$/, '')) || 'file'
    const type = mimeOf(name)
    const mid = id('m')

    let data = bytes
    if (cfg.images.stripExif && type === 'image/jpeg') {
      const sharp = await getSharp()
      if (sharp) {
        try { data = new Uint8Array(await sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer()) }
        catch { data = stripJpegMetadata(bytes) }
      } else data = stripJpegMetadata(bytes)
    }

    const file = `${opts.private ? 'private' : 'library'}/${base}-${mid.slice(-6)}.${ext}`
    await this.driver.write(`media/${file}`, data)

    let dims = imageDimensions(data, type)
    let dominant: string | undefined
    const sharp = await getSharp()
    if (sharp && type.startsWith('image/') && type !== 'image/svg+xml') {
      try {
        const img = sharp(Buffer.from(data))
        const md = await img.metadata()
        dims = { width: md.width || dims?.width || 0, height: md.height || dims?.height || 0 }
        const { dominant: d } = await img.stats()
        dominant = `rgb(${d.r},${d.g},${d.b})`
      } catch {}
    }

    const meta: MediaMeta = {
      id: mid, file, name, alt: opts.alt || '', type, size: data.length,
      width: dims?.width, height: dims?.height, dominant,
      folder: opts.folder || '', tags: opts.tags || [],
      focal: { x: 0.5, y: 0.5 },
      private: !!opts.private, createdAt: now(), updatedAt: now(),
    }
    await this.saveMeta(meta)
    return meta
  }

  /**
   * Non-destructive edit: writes a NEW asset from an existing one, applying the
   * wizard's operations (crop/resize/rotate/flip/format/quality/grayscale/
   * watermark). The original is never touched.
   */
  async process(mediaId: string, ops: ProcessOps, cfg: SiteConfig): Promise<MediaMeta | { error: string }> {
    const meta = await this.meta(mediaId)
    if (!meta) return { error: 'asset not found' }
    const sharp = await getSharp()
    if (!sharp) return { error: 'image processing needs sharp — install it, or use the Cloudflare image provider' }
    const orig = await this.driver.read(`media/${meta.file}`)
    if (!orig) return { error: 'original file missing' }
    try {
      let img = sharp(Buffer.from(orig)).rotate()
      if (ops.crop) {
        const md = await sharp(Buffer.from(orig)).metadata()
        const W = md.width || 0, H = md.height || 0
        img = img.extract({
          left: Math.max(0, Math.round(ops.crop.x * W)),
          top: Math.max(0, Math.round(ops.crop.y * H)),
          width: Math.max(1, Math.min(W, Math.round(ops.crop.w * W))),
          height: Math.max(1, Math.min(H, Math.round(ops.crop.h * H))),
        })
      }
      if (ops.rotate) img = img.rotate(ops.rotate)
      if (ops.flipX) img = img.flop()
      if (ops.flipY) img = img.flip()
      if (ops.width || ops.height) img = img.resize({ width: ops.width || undefined, height: ops.height || undefined, fit: ops.fit || 'cover', withoutEnlargement: true })
      if (ops.grayscale) img = img.grayscale()
      if (ops.blur) img = img.blur(Math.min(40, ops.blur))
      if (ops.watermark) img = await this.applyWatermark(img, meta, ops.width || meta.width || 1200, cfg)

      const q = ops.quality ?? cfg.images.quality
      const fmt = ops.format || 'webp'
      let buf: Buffer
      if (fmt === 'webp') buf = await img.webp({ quality: q }).toBuffer()
      else if (fmt === 'avif') buf = await img.avif({ quality: Math.max(35, q - 20) }).toBuffer()
      else if (fmt === 'png') buf = await img.png().toBuffer()
      else buf = await img.jpeg({ quality: q, mozjpeg: true }).toBuffer()

      const baseName = (ops.name || meta.name.replace(/\.[^.]+$/, '') + '-edit') + '.' + (fmt === 'jpeg' ? 'jpg' : fmt)
      return await this.upload(baseName, new Uint8Array(buf), cfg, {
        alt: meta.alt, folder: ops.folder ?? meta.folder, tags: meta.tags, private: meta.private,
      })
    } catch (e: any) {
      return { error: String(e?.message || e) }
    }
  }

  async delete(mediaId: string) {
    const meta = await this.meta(mediaId)
    if (!meta) return
    await this.driver.delete(`media/${meta.file}`)
    await this.driver.delete(`media/_meta/${mediaId}.json`)
    for (const v of await this.driver.list('media/_var')) {
      if (v.includes(`/${mediaId}-`) || v.includes(`_var/${mediaId}-`)) await this.driver.delete(v)
    }
  }

  variantKey(meta: MediaMeta, w: number, fmt: string, cfg: ImageConfig): string {
    const base = fillPattern(cfg.renamePattern || '{slug}-{w}', {
      slug: slugify(meta.name.replace(/\.[^.]+$/, '')), id: meta.id, w: String(w), hash: meta.id.slice(-6),
    })
    return `media/_var/${meta.id}-${base}.${fmt === 'original' ? meta.file.split('.').pop() : fmt}`
  }

  variantUrl(meta: MediaMeta, w: number, fmt: string, cfg: ImageConfig): string {
    return '/' + this.variantKey(meta, w, fmt, cfg)
  }

  /**
   * The inverse of `variantKey` — turn a derivative path back into the media
   * id, width and format that produced it.
   *
   * Both halves of the name can contain hyphens: ids conventionally look like
   * `m-hero-cutaway`, and the default rename pattern (`{slug}-{w}`) contributes
   * a slug of its own. That makes the boundary between them impossible to find
   * by pattern alone, so the width and format come off the tail and the id is
   * settled by asking the store which prefix actually exists, longest first.
   *
   * Accepts the key with or without a leading slash or `media/` prefix.
   */
  async parseVariantKey(key: string): Promise<{ id: string; width: number; fmt: 'webp' | 'avif' | 'original' } | null> {
    const rel = key.replace(/^\//, '').replace(/^media\//, '')
    const m = /^_var\/(.+)-(\d+)\.(webp|avif|jpe?g|png)$/.exec(rel)
    if (!m) return null
    const [, head, w, ext] = m
    const fmt = ext === 'webp' || ext === 'avif' ? (ext as 'webp' | 'avif') : 'original'

    const parts = head.split('-')
    for (let n = parts.length; n > 0; n--) {
      const candidate = parts.slice(0, n).join('-')
      if (await this.meta(candidate)) return { id: candidate, width: parseInt(w, 10), fmt }
    }
    return null
  }

  /** Generate (or reuse) a derivative. Returns its key, or null when impossible. */
  async ensureVariant(mediaId: string, w: number, fmt: 'webp' | 'avif' | 'original', cfg: ImageConfig): Promise<string | null> {
    const meta = await this.meta(mediaId)
    if (!meta || !meta.type.startsWith('image/') || meta.type === 'image/svg+xml' || meta.type === 'image/gif') return null
    if (!cfg.sizes.includes(w)) return null
    const key = this.variantKey(meta, w, fmt, cfg)
    if (await this.driver.stat(key)) return key
    const sharp = await getSharp()
    if (!sharp) return null
    const orig = await this.driver.read(`media/${meta.file}`)
    if (!orig) return null
    try {
      let img = sharp(Buffer.from(orig)).rotate().resize({ width: w, withoutEnlargement: true })
      img = await this.applyWatermark(img, meta, w, cfg)
      let buf: Buffer
      if (fmt === 'webp') buf = await img.webp({ quality: cfg.quality }).toBuffer()
      else if (fmt === 'avif') buf = await img.avif({ quality: Math.max(40, cfg.quality - 20) }).toBuffer()
      else if (meta.type === 'image/png') buf = await img.png().toBuffer()
      else buf = await img.jpeg({ quality: cfg.quality, mozjpeg: true }).toBuffer()
      await this.driver.write(key, new Uint8Array(buf))
      return key
    } catch (e) {
      console.error('[blockhouse] variant generation failed:', e)
      return null
    }
  }

  private async applyWatermark(img: any, meta: MediaMeta, w: number, cfg: ImageConfig) {
    const wm = cfg.watermark
    if (!wm || meta.noWatermark) return img
    if (wm.minWidth && w < wm.minWidth) return img
    let wmBytes: Uint8Array | null = null
    if (wm.media) {
      const wmMeta = await this.meta(wm.media)
      if (wmMeta) wmBytes = await this.driver.read(`media/${wmMeta.file}`)
    } else if (wm.file) {
      wmBytes = await this.driver.read(wm.file)
    }
    if (!wmBytes) return img
    const sharp = await getSharp()
    const scale = wm.scale ?? 0.18
    const overlay = await sharp(Buffer.from(wmBytes))
      .resize({ width: Math.max(24, Math.round(w * scale)) })
      .ensureAlpha()
      .composite([{ input: Buffer.from([255, 255, 255, Math.round((wm.opacity ?? 0.5) * 255)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
      .png().toBuffer()
    return img.composite([{ input: overlay, gravity: wm.gravity || 'southeast' }])
  }
}

export interface ProcessOps {
  crop?: { x: number; y: number; w: number; h: number }   // 0–1 fractions
  width?: number
  height?: number
  fit?: 'cover' | 'contain' | 'inside'
  rotate?: number
  flipX?: boolean
  flipY?: boolean
  grayscale?: boolean
  blur?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'png'
  quality?: number
  watermark?: boolean
  name?: string
  folder?: string
}

/** Stable asset-version hash for cache busting. */
export async function contentHash(text: string): Promise<string> {
  return (await sha256hex(text)).slice(0, 10)
}
