// Flat-site export: renders every published page to plain HTML + copies assets,
// pre-generates every referenced image variant, and writes sitemap/robots/RSS/
// redirects (_redirects works on Cloudflare Pages and Netlify).

import type { BlockhouseEnv } from '../server/env.ts'
import { renderDocPage, renderListPage, render404 } from '../render/page.ts'
import { robotsTxt, rssXml, sitemapXml } from '../render/seo.ts'
import { FsDriver } from '../storage/fs.ts'
import { fillPattern, normalizePath } from '../core/util.ts'
import { exportFileFor, shortPath } from '../core/urls.ts'

export async function exportStatic(env: BlockhouseEnv, opts: { outDir: string; stage?: boolean }): Promise<{ pages: number; assets: number; variants: number; outDir: string; skipped: string[] }> {
  const out = new FsDriver(opts.outDir)
  const site = await env.site()
  const mode = 'export' as const
  let pages = 0, assets = 0
  const variants = new Set<string>()

  // Every page goes through here, so this is also where image derivatives are
  // collected — scraping in the document loop alone used to miss the ones only
  // referenced by concept index pages, the 404 and mirrored aliases, and those
  // files then 404'd on a flat host. The id is resolved by the media store
  // rather than by pattern, because both the id and the rename pattern may
  // contain hyphens (see MediaStore.parseVariantKey).
  const writePage = async (path: string, html: string) => {
    for (const m of html.matchAll(/\/media\/_var\/[^"'\s]+?\.(?:webp|avif|jpe?g|png)/g)) {
      const key = m[0].replace(/^\//, '')
      const parsed = await env.media.parseVariantKey(key)
      if (parsed) variants.add(`${parsed.id}|${parsed.width}|${parsed.fmt}||${key}`)
    }
    await out.write(exportFileFor(path, site), html)
    pages++
  }

  // documents
  const docs = await env.content.listDocs(undefined, { published: !opts.stage })
  const skipped: string[] = []
  for (const doc of docs) {
    if (!opts.stage && doc.status !== 'published') continue
    if (doc.publishAt && new Date(doc.publishAt).getTime() > Date.now()) continue
    const path = await env.content.docPath(doc)
    // Member-gated pages must never land in a flat export — there is no server
    // to check the cookie, so the file would be world-readable.
    if (doc.access?.mode && doc.access.mode !== 'public') { skipped.push(path); continue }
    await writePage(path, await renderDocPage(env, doc, { mode, path }))
  }

  // concept index pages + feeds
  for (const concept of await env.content.concepts()) {
    if (!concept.indexPath) continue
    const first = await renderListPage(env, concept, 1, { mode, path: normalizePath(concept.indexPath) })
    if (!first) continue
    await writePage(normalizePath(concept.indexPath), first.html)
    for (let p = 2; p <= first.pages; p++) {
      const res = await renderListPage(env, concept, p, { mode, path: `${concept.indexPath}/page/${p}` })
      if (res) await writePage(`${normalizePath(concept.indexPath)}/page/${p}`, res.html)
    }
    if (concept.feed) { await out.write(`${normalizePath(concept.indexPath).slice(1)}/feed.xml`, await rssXml(env, concept)); assets++ }
  }

  // 404 + robots + sitemap. The 404 is written at a fixed filename rather than
  // through the URL-style rules, but it still goes through the scrape so any
  // imagery on it ships with the build.
  {
    const html = await render404(env, { mode, path: '/404' })
    for (const m of html.matchAll(/\/media\/_var\/[^"'\s]+?\.(?:webp|avif|jpe?g|png)/g)) {
      const key = m[0].replace(/^\//, '')
      const parsed = await env.media.parseVariantKey(key)
      if (parsed) variants.add(`${parsed.id}|${parsed.width}|${parsed.fmt}||${key}`)
    }
    await out.write('404.html', html)
  }
  await out.write('robots.txt', await robotsTxt(env))
  await out.write('sitemap.xml', await sitemapXml(env))
  assets += 3

  // static search index (when the search plugin is enabled)
  if (site.plugins?.search?.enabled && site.build?.generateSearchIndex !== false) {
    try {
      const { rank } = await import('../../plugins/search/index.ts')
      void rank
      const entries: any[] = []
      for (const d of docs) {
        if (d.status !== 'published' || d.seo?.noindex) continue
        if (d.access?.mode && d.access.mode !== 'public') continue
        entries.push({
          path: await env.content.docPath(d),
          title: d.title,
          excerpt: (d.seo?.description || '').slice(0, 160),
          concept: d.concept,
          text: (d.title + ' ' + JSON.stringify(d.blocks)).toLowerCase().replace(/<[^>]+>|["{}\[\],]/g, ' ').replace(/\s+/g, ' ').slice(0, 4000),
        })
      }
      await out.write('x/search/index.json', JSON.stringify({ entries }))
      assets++
    } catch {}
  }

  // template assets (layered union) + blockhouse runtime
  for (const rel of await env.resolver.list('assets')) {
    const data = await env.resolver.read(rel)
    if (data) { await out.write(`assets/site/${rel.slice('assets/'.length)}`, data); assets++ }
  }
  for (const rel of await env.appAssets.list('blockhouse')) {
    const data = await env.appAssets.read(rel)
    if (data) { await out.write(`assets/${rel}`, data); assets++ }
  }

  // image variants referenced by pages (generate now so flat hosting has them)
  let variantCount = 0
  for (const v of variants) {
    const [mid, w, fmt, , key] = v.split('|')
    const generated = await env.media.ensureVariant(mid, parseInt(w, 10), fmt as any, site.images)
    const source = generated || null
    if (source) {
      const data = await env.driver.read(source)
      if (data) { await out.write(key, data); variantCount++; continue }
    }
    // fallback: copy original under the variant key so <img> never 404s
    const meta = await env.media.meta(mid)
    if (meta) {
      const data = await env.driver.read(`media/${meta.file}`)
      if (data) { await out.write(key, data); variantCount++ }
    }
  }

  // originals referenced directly (svg/gif/video posters etc.) — copy the library folder
  for (const rel of await env.driver.list('media/library')) {
    const data = await env.driver.read(rel)
    if (data) { await out.write(rel, data); assets++ }
  }

  // redirects: explicit + slug history + per-doc aliases + shortlinks
  const lines: string[] = []
  for (const r of await env.content.redirects()) lines.push(`${r.from} ${r.to} ${r.code || 301}`)
  for (const d of docs) {
    if (d.access?.mode && d.access.mode !== 'public') continue
    const cur = await env.content.docPath(d)
    if (d.slugHistory?.length) {
      const concept = await env.content.concept(d.concept)
      for (const old of d.slugHistory) {
        lines.push(`${normalizePath(fillPattern(concept?.urlPattern || '/{slug}', { slug: old }))} ${cur} 301`)
      }
    }
    for (const alias of d.aliases || []) {
      const from = normalizePath(alias)
      if (from === cur) continue
      // A mirror renders at the alias too; flat hosting gets a real file so it
      // works without redirect support. Otherwise it's a plain 301.
      if (d.mirror) {
        const html = await renderDocPage(env, d, { mode, path: from })
        await writePage(from, html)
      } else lines.push(`${from} ${cur} 301`)
    }
    if (site.urls?.shortlinks) lines.push(`${shortPath(d.id, site)} ${cur} 301`)
  }
  if (lines.length) { await out.write('_redirects', lines.join('\n') + '\n'); assets++ }
  if (skipped.length) console.log(`[blockhouse] export skipped ${skipped.length} member-only page(s): ${skipped.join(', ')}`)

  return { pages, assets, variants: variantCount, outDir: opts.outDir, skipped }
}
