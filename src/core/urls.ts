// URL strategy — one place that decides what a page's address looks like and
// what file it becomes on a static build. Sites choose:
//   style:  directory (/about/ → about/index.html)
//           extension (/about.html)
//           bare      (/about  → about.html served without extension)
//   layout: pattern (concept urlPattern) or flat (everything at the root)
// Plus per-doc aliases (redirect or mirror) and optional /s/<code> shortlinks.

import type { ConceptDef, Doc, SiteConfig } from './types.ts'
import { fillPattern, normalizePath } from './util.ts'

export function docPathFor(doc: Doc, concept: ConceptDef | null, site: SiteConfig): string {
  if (site.homeDocId && doc.id === site.homeDocId) return '/'
  const layout = site.urls?.layout || 'pattern'
  const raw = layout === 'flat'
    ? `/${doc.slug}`
    : fillPattern(concept?.urlPattern || '/{slug}', { slug: doc.slug, concept: doc.concept })
  let p = normalizePath(raw)
  if (site.urls?.lowercase !== false) p = p.toLowerCase()
  return p
}

/** The href written into links/sitemaps for a canonical path. */
export function hrefFor(path: string, site: SiteConfig): string {
  const style = site.urls?.style || 'directory'
  const base = site.build?.basePath ? normalizePath(site.build.basePath) : ''
  if (path === '/') return base ? base + '/' : '/'
  if (style === 'extension') return `${base}${path}.html`
  if (style === 'bare') return `${base}${path}`
  return site.build?.trailingSlash === false ? `${base}${path}` : `${base}${path}/`
}

/** The file a path becomes in a static export. */
export function exportFileFor(path: string, site: SiteConfig): string {
  const style = site.urls?.style || 'directory'
  if (path === '/') return 'index.html'
  const clean = path.slice(1)
  if (style === 'extension' || style === 'bare') return `${clean}.html`
  return `${clean}/index.html`
}

/**
 * Short, stable code for a doc — used by /s/<code>.
 *
 * FNV-1a with a murmur3 finalizer, base36, zero-padded to a fixed 7 characters.
 * The avalanche step matters: plain djb2 clusters hard on ids that share a
 * prefix and differ only near the end (exactly what generated and imported ids
 * look like), producing tens of thousands of collisions in 50k ids where this
 * produces none. Never truncate the result — base36 keeps the low-order bits
 * last, so a shorter slice throws away the part that actually varies.
 */
export function shortCode(docId: string): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < docId.length; i++) {
    h ^= docId.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h.toString(36).padStart(7, '0')
}

export function shortPath(docId: string, site: SiteConfig): string {
  return `/${site.urls?.shortlinkPrefix || 's'}/${shortCode(docId)}`
}

/** Normalize an incoming request path so every URL style resolves. */
export function canonicalizeRequestPath(pathname: string): string {
  let p = decodeURIComponent(pathname)
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length) || '/'
  else if (p.endsWith('.html')) p = p.slice(0, -'.html'.length)
  return normalizePath(p || '/')
}
