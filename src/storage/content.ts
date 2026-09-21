// ContentStore — everything gittable lives here as pretty-printed JSON:
//   site/site.json, site/concepts/*.json, site/content/<concept>/<slug>.json,
//   site/content/.published/** (publish snapshots), site/menus/*.json,
//   site/redirects.json, site/.versions/<docId>/<n>.json
// Working copies hold draft state; the live site renders only from .published.

import type { ConceptDef, Doc, Menu, Redirect, SiteConfig } from '../core/types.ts'
import { deepMerge, fillPattern, id, normalizePath, now, slugify, stringify, tryJson } from '../core/util.ts'
import { docPathFor, hrefFor, shortCode } from '../core/urls.ts'
import type { StorageDriver } from './driver.ts'
import { moveKey } from './driver.ts'
import { envOverrides, mergeConfig } from '../core/config.ts'

const MAX_VERSIONS = 25

/** Every field the editor can change, in a stable order, as one string.
 *  Two docs with the same fingerprint are the same document as far as the
 *  owner is concerned — `updatedAt` and `version` are deliberately excluded. */
const COMPARABLE = [
  'concept', 'slug', 'title', 'status', 'fields', 'blocks', 'regions', 'seo',
  'template', 'publishAt', 'custom', 'aliases', 'mirror', 'access',
] as const

/** What made a restore point: a Save, a Publish, or restoring an older version. */
export type SaveAction = 'save' | 'publish' | 'restore'

/** What one save did: the stored document, whether the page actually changed,
 *  and whether a restore point was kept. */
export type SaveResult = { doc: Doc; unchanged: boolean; snapshot: boolean }

export type VersionInfo = {
  version: number
  savedAt: string
  key: string
  action: SaveAction
  title: string
  /** Content fingerprint — two equal ones mean the page looked the same. */
  fingerprint: string
}

/** An empty object or array carries no content, so it must not read as a change. */
const isEmptyHolder = (v: any) =>
  v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0)

/**
 * Sort keys, drop `undefined`, and drop values that hold nothing — `{}`, `[]`.
 * A form that renders an empty holder onto a node (an inspector opening a width
 * box, say) would otherwise make an untouched page look edited: the owner is
 * told to republish work nobody did. Emptiness is dropped bottom-up, so
 * `{ layout: { extra: {} } }` reduces to nothing at all, same as absent.
 */
function stable(v: any): any {
  // Array *positions* are meaningful — an empty entry is dropped only when it
  // is the whole value, never from the middle of a list.
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) {
      const sv = stable(v[k])
      if (sv === undefined || isEmptyHolder(sv)) continue
      out[k] = sv
    }
    return out
  }
  return v
}

export function docFingerprint(doc: Doc): string {
  const pick: Record<string, any> = {}
  for (const k of COMPARABLE) {
    const v = (doc as any)[k]
    if (v === undefined || v === null) continue
    const sv = stable(v)
    if (isEmptyHolder(sv)) continue
    pick[k] = sv
  }
  return JSON.stringify(pick)
}

/** Fingerprint used to compare a working copy with its published snapshot.
 *  Everything the publish machinery moves on its own is excluded: `version`
 *  and `updatedAt` are already outside `COMPARABLE`, and `status` is dropped
 *  here because the snapshot is written with `status: 'published'` while the
 *  working copy may be back in draft or awaiting review — neither of which is
 *  an edit to the words on the page. Both sides go through this same function,
 *  so the comparison is symmetric. */
export function publishFingerprint(doc: Doc): string {
  return docFingerprint({ ...doc, status: undefined } as unknown as Doc)
}

export class ContentStore {
  private conceptCache: Map<string, ConceptDef> | null = null
  private pathIndex: Map<string, { id: string; published: boolean }> | null = null
  private docCache = new Map<string, Doc>()
  private siteCache: SiteConfig | null = null
  /** Last resolved template name. The template resolver reads this synchronously,
   *  so switching templates takes effect on the next request without a restart. */
  lastTemplate = 'aurora'

  /**
   * @param envName  deployment name (dev · staging · production …) selecting the
   *                 `site/site.<envName>.json` overlay
   * @param processEnv  environment variables applied as the last layer
   */
  constructor(
    public driver: StorageDriver,
    private envName = 'dev',
    private processEnv: Record<string, string | undefined> = {},
  ) {}

  invalidate() {
    this.conceptCache = null
    this.pathIndex = null
    this.docCache.clear()
    this.siteCache = null
  }

  // ---------- site config ----------

  /**
   * Config is layered, lowest priority first:
   *   defaults → site/site.json → site/site.<env>.json → .blockhouse/local.json → BLOCKHOUSE_* vars
   * so one committed project runs unchanged on a laptop, a staging box, a
   * production server and Cloudflare — with machine-local tweaks kept out of git.
   */
  async site(): Promise<SiteConfig> {
    if (this.siteCache) return this.siteCache
    const layers: any[] = [tryJson(await this.driver.readText('site/site.json'), {})]
    if (this.envName && this.envName !== 'dev') {
      const overlay = tryJson(await this.driver.readText(`site/site.${this.envName}.json`), null)
      if (overlay) layers.push(overlay)
    }
    const local = tryJson(await this.driver.readText('.blockhouse/local.json'), null)
    if (local) layers.push(local)
    let raw: any = {}
    for (const l of layers) raw = deepMerge(raw, l)
    this.siteCache = mergeConfig(raw, this.processEnv)
    this.lastTemplate = this.siteCache.template
    return this.siteCache
  }

  /** Which config layers are actually present — surfaced by `blockhouse doctor`. */
  async configLayers(): Promise<{ source: string; present: boolean; keys: string[] }[]> {
    const read = async (key: string) => tryJson<any>(await this.driver.readText(key), null)
    const base = await read('site/site.json')
    const overlay = this.envName && this.envName !== 'dev' ? await read(`site/site.${this.envName}.json`) : null
    const local = await read('.blockhouse/local.json')
    const envKeys = Object.keys(envOverrides(this.processEnv))
    return [
      { source: 'site/site.json', present: !!base, keys: Object.keys(base || {}) },
      { source: `site/site.${this.envName}.json`, present: !!overlay, keys: Object.keys(overlay || {}) },
      { source: '.blockhouse/local.json', present: !!local, keys: Object.keys(local || {}) },
      { source: 'BLOCKHOUSE_* environment', present: envKeys.length > 0, keys: envKeys },
    ]
  }

  async saveSite(patch: Partial<SiteConfig>): Promise<SiteConfig> {
    const raw = tryJson(await this.driver.readText('site/site.json'), {} as any)
    const merged = { ...raw, ...patch }
    await this.driver.write('site/site.json', stringify(merged))
    this.siteCache = null
    return this.site()
  }

  // ---------- concepts ----------

  async concepts(): Promise<ConceptDef[]> {
    if (!this.conceptCache) {
      this.conceptCache = new Map()
      for (const key of await this.driver.list('site/concepts')) {
        const def = tryJson<ConceptDef | null>(await this.driver.readText(key), null)
        if (def?.name) this.conceptCache.set(def.name, def)
      }
    }
    return [...this.conceptCache.values()]
  }

  async concept(name: string): Promise<ConceptDef | null> {
    await this.concepts()
    return this.conceptCache!.get(name) ?? null
  }

  async saveConcept(def: ConceptDef) {
    await this.driver.write(`site/concepts/${def.name}.json`, stringify(def))
    this.conceptCache = null
    this.pathIndex = null
  }

  // ---------- documents ----------

  private docKey(concept: string, slug: string, published = false) {
    return `site/content/${published ? '.published/' : ''}${concept}/${slug}.json`
  }

  async listDocs(concept?: string, opts: { published?: boolean } = {}): Promise<Doc[]> {
    const base = opts.published ? 'site/content/.published' : 'site/content'
    const prefix = concept ? `${base}/${concept}` : base
    const keys = (await this.driver.list(prefix)).filter(k => k.endsWith('.json'))
      .filter(k => opts.published || !k.includes('/.published/'))
    const docs: Doc[] = []
    for (const key of keys) {
      const d = tryJson<Doc | null>(await this.driver.readText(key), null)
      if (d?.id) docs.push(d)
    }
    return docs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }

  async getDoc(docId: string): Promise<Doc | null> {
    if (this.docCache.has(docId)) return this.docCache.get(docId)!
    for (const key of (await this.driver.list('site/content')).filter(k => k.endsWith('.json') && !k.includes('/.published/'))) {
      const d = tryJson<Doc | null>(await this.driver.readText(key), null)
      if (d?.id === docId) { this.docCache.set(docId, d); return d }
    }
    return null
  }

  async getBySlug(concept: string, slug: string, published = false): Promise<Doc | null> {
    return tryJson(await this.driver.readText(this.docKey(concept, slug, published)), null)
  }

  async docPath(doc: Doc, concept?: ConceptDef | null): Promise<string> {
    const c = concept ?? await this.concept(doc.concept)
    const site = await this.site()
    return docPathFor(doc, c, site)
  }

  /** Public href honouring the site's URL style (trailing slash / .html / bare). */
  async docHref(doc: Doc, concept?: ConceptDef | null): Promise<string> {
    const site = await this.site()
    return hrefFor(await this.docPath(doc, concept), site)
  }

  /** Resolve an alias path → { doc, mirror }. Aliases either 301 or render in place. */
  async getByAlias(path: string): Promise<{ doc: Doc; mirror: boolean } | null> {
    path = normalizePath(path)
    for (const d of await this.listDocs()) {
      if (!d.aliases?.length) continue
      if (d.aliases.some(a => normalizePath(a) === path)) return { doc: d, mirror: !!d.mirror }
    }
    return null
  }

  /** Resolve /s/<code> shortlinks. */
  async getByShortCode(code: string): Promise<Doc | null> {
    for (const d of await this.listDocs()) if (shortCode(d.id) === code) return d
    return null
  }

  private async buildPathIndex(): Promise<Map<string, { id: string; published: boolean }>> {
    if (this.pathIndex) return this.pathIndex
    const idx = new Map<string, { id: string; published: boolean }>()
    for (const published of [false, true]) {
      for (const d of await this.listDocs(undefined, { published })) {
        const p = await this.docPath(d)
        const existing = idx.get(p)
        idx.set(p, { id: d.id, published: published || (existing?.published ?? false) })
      }
    }
    this.pathIndex = idx
    return idx
  }

  /** Resolve a URL path to a doc. published=true → only publish snapshots. */
  async getByPath(path: string, published: boolean): Promise<Doc | null> {
    path = normalizePath(path)
    const idx = await this.buildPathIndex()
    const hit = idx.get(path)
    if (!hit) return null
    if (published) {
      if (!hit.published) return null
      const doc = await this.getDoc(hit.id)
      if (!doc) return null
      return this.getBySlug(doc.concept, doc.slug, true)
    }
    return this.getDoc(hit.id)
  }

  /** Old slug → current path (301s). */
  async findBySlugHistory(path: string): Promise<string | null> {
    path = normalizePath(path)
    for (const d of await this.listDocs()) {
      if (!d.slugHistory?.length) continue
      const c = await this.concept(d.concept)
      for (const old of d.slugHistory) {
        if (normalizePath(fillPattern(c?.urlPattern || '/{slug}', { slug: old })) === path) {
          return this.docHref(d, c)   // honour the site's URL style in the 301 target
        }
      }
    }
    return null
  }

  async createDoc(input: Partial<Doc> & { concept: string; title: string }, authorId?: string): Promise<Doc> {
    const slug = await this.uniqueSlug(input.concept, input.slug || slugify(input.title))
    const doc: Doc = {
      id: id('d'),
      concept: input.concept,
      slug,
      title: input.title,
      status: 'draft',
      fields: input.fields || {},
      blocks: input.blocks || [],
      seo: input.seo || {},
      author: authorId,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
      ...(input.template ? { template: input.template } : {}),
    }
    await this.driver.write(this.docKey(doc.concept, doc.slug), stringify(doc))
    this.invalidateDoc(doc)
    return doc
  }

  private async uniqueSlug(concept: string, want: string): Promise<string> {
    let slug = slugify(want)
    let n = 2
    while (await this.driver.stat(this.docKey(concept, slug))) slug = `${slugify(want)}-${n++}`
    return slug
  }

  /** Write `prev` as a restore point and prune the oldest ones. */
  private async writeVersion(prev: Doc, action: SaveAction) {
    // The action goes in the file NAME, not in the stored document: a
    // restore point is a verbatim copy of the page and must stay one.
    // Nine rows reading "1st restore point · saved at 03:28" gave the owner
    // nothing to choose between, so the list needs to say what made each one.
    await this.driver.write(
      `site/.versions/${prev.id}/${String(prev.version).padStart(5, '0')}.${action}.json`, stringify(prev))
    const versions = await this.driver.list(`site/.versions/${prev.id}`)
    for (const old of versions.slice(0, Math.max(0, versions.length - MAX_VERSIONS))) await this.driver.delete(old)
  }

  async saveDoc(doc: Doc, opts: { snapshot?: boolean; action?: SaveAction } = {}): Promise<Doc> {
    return (await this.saveDocResult(doc, opts)).doc
  }

  /** As `saveDoc`, but also reports whether anything changed and whether a
   *  restore point was written — the editor needs both to word its toast. */
  async saveDocResult(doc: Doc, opts: { snapshot?: boolean; action?: SaveAction } = {}): Promise<SaveResult> {
    const prev = await this.getDoc(doc.id)
    // A save that changes nothing must change nothing: no new version, no
    // restore point, no "edited" badge, no Activity row. Otherwise pressing
    // Save on an untouched published page tells the owner to republish work
    // that does not exist. Everything the editor can edit is compared.
    if (prev && docFingerprint(prev) === docFingerprint(doc)) {
      // R21-2 — the comparison above is against the last AUTOSAVE, but an
      // explicit Save promises a restore point. Someone who edits, waits for
      // the autosave, then presses Save was told "nothing to save" and got no
      // restore point. So when a snapshot is asked for, compare against the
      // newest restore point instead, and keep one if the page has moved on.
      if (opts.snapshot === true) {
        const [newest] = await this.versions(doc.id)
        if (!newest || newest.fingerprint !== docFingerprint(prev)) {
          await this.writeVersion(prev, opts.action || 'save')
          return { doc: prev, unchanged: true, snapshot: true }
        }
      }
      return { doc: prev, unchanged: true, snapshot: false }
    }
    if (prev && (prev.slug !== doc.slug || prev.concept !== doc.concept)) {
      doc.slug = await this.uniqueSlug(doc.concept, doc.slug)
      doc.slugHistory = [...new Set([...(prev.slugHistory || []), prev.slug])].slice(-10)
      await this.driver.delete(this.docKey(prev.concept, prev.slug))
      // Move the published snapshot too, or the old URL keeps serving stale
      // content and shows up in exports, sitemaps and weight reports.
      const publishedOld = this.docKey(prev.concept, prev.slug, true)
      const snapshot = tryJson<Doc | null>(await this.driver.readText(publishedOld), null)
      if (snapshot) {
        await this.driver.write(this.docKey(doc.concept, doc.slug, true), stringify({ ...snapshot, slug: doc.slug, concept: doc.concept }))
        await this.driver.delete(publishedOld)
      }
    }
    doc.updatedAt = now()
    doc.version = (prev?.version || 0) + 1
    const kept = opts.snapshot !== false && !!prev
    if (kept && prev) await this.writeVersion(prev, opts.action || 'save')
    await this.driver.write(this.docKey(doc.concept, doc.slug), stringify(doc))
    this.invalidateDoc(doc)
    return { doc, unchanged: false, snapshot: kept }
  }

  async deleteDoc(docId: string): Promise<boolean> {
    const doc = await this.getDoc(docId)
    if (!doc) return false
    await moveKey(this.driver, this.docKey(doc.concept, doc.slug), `site/.trash/${doc.concept}-${doc.slug}-${Date.now()}.json`)
    await this.driver.delete(this.docKey(doc.concept, doc.slug, true))
    this.invalidateDoc(doc)
    return true
  }

  async publish(docId: string): Promise<Doc | null> {
    const doc = await this.getDoc(docId)
    if (!doc) return null
    doc.status = 'published'
    await this.saveDoc(doc, { snapshot: true, action: 'publish' })
    await this.driver.write(this.docKey(doc.concept, doc.slug, true), stringify(doc))
    this.invalidateDoc(doc)
    return doc
  }

  async unpublish(docId: string): Promise<Doc | null> {
    const doc = await this.getDoc(docId)
    if (!doc) return null
    doc.status = 'draft'
    await this.saveDoc(doc, { snapshot: false })
    await this.driver.delete(this.docKey(doc.concept, doc.slug, true))
    this.invalidateDoc(doc)
    return doc
  }

  /** Is the published snapshot older than the working copy? */
  async hasUnpublishedChanges(doc: Doc): Promise<boolean> {
    const pub = await this.getBySlug(doc.concept, doc.slug, true)
    if (!pub) return doc.status === 'published'
    // Version numbers count saves, not changes: an edit and its undo both bump
    // the version while leaving the page byte-identical to the live copy, and
    // the owner was then told to republish work that does not exist (R17-2).
    // Compare what is actually on the page instead.
    return publishFingerprint(pub) !== publishFingerprint(doc)
  }

  /**
   * Restore points, newest first. Each carries what the owner needs to tell
   * them apart: the action that made it, the title the page had at the time,
   * and a fingerprint so the list can say "no visible change".
   */
  async versions(docId: string): Promise<VersionInfo[]> {
    const keys = await this.driver.list(`site/.versions/${docId}`)
    const out: VersionInfo[] = []
    for (const key of keys.reverse()) {
      const d = tryJson<Doc | null>(await this.driver.readText(key), null)
      if (!d) continue
      const named = /\.(save|publish|restore)\.json$/.exec(key)
      out.push({
        version: d.version, savedAt: d.updatedAt, key,
        action: (named?.[1] as SaveAction) || 'save',
        title: d.title,
        fingerprint: docFingerprint(d),
      })
    }
    return out
  }

  async getVersion(key: string): Promise<Doc | null> {
    if (!key.startsWith('site/.versions/')) return null
    return tryJson(await this.driver.readText(key), null)
  }

  private invalidateDoc(doc: Doc) {
    this.docCache.delete(doc.id)
    this.pathIndex = null
  }

  // ---------- menus ----------

  async menus(): Promise<Menu[]> {
    const out: Menu[] = []
    for (const key of await this.driver.list('site/menus')) {
      const m = tryJson<Menu | null>(await this.driver.readText(key), null)
      if (m?.key) out.push(m)
    }
    return out
  }
  async menu(key: string): Promise<Menu | null> {
    return tryJson(await this.driver.readText(`site/menus/${key}.json`), null)
  }
  async saveMenu(menu: Menu) { await this.driver.write(`site/menus/${menu.key}.json`, stringify(menu)) }
  async deleteMenu(key: string) { await this.driver.delete(`site/menus/${key}.json`) }

  // ---------- redirects ----------

  async redirects(): Promise<Redirect[]> {
    return tryJson(await this.driver.readText('site/redirects.json'), [])
  }
  async saveRedirects(list: Redirect[]) { await this.driver.write('site/redirects.json', stringify(list)) }
}
