// Head/SEO builder: title patterns, meta, canonical, OG/Twitter, robots,
// JSON-LD graph (site Organization/WebSite + per-doc Article + block
// contributions like FAQPage), sitemap.xml and RSS.

import type { ConceptDef, Doc, RenderCtx, SiteConfig } from '../core/types.ts'
import { escapeAttr, escapeHtml, fillPattern, normalizePath, walkBlocks } from '../core/util.ts'
import { mdExcerpt, mdText } from '../core/markdown.ts'
import { hrefFor } from '../core/urls.ts'

/** Site-root a path so JSON-LD carries absolute URLs, as the spec expects. */
function absolute(site: SiteConfig, url: string): string {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url
  return site.url.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`)
}

export function docDescription(doc: Doc): string {
  if (doc.seo?.description) return doc.seo.description
  for (const b of doc.blocks || []) {
    if (b.type === 'richtext' && b.props?.md) return mdExcerpt(b.props.md, 28)
    if (b.type === 'hero' && b.props?.text) return String(b.props.text).slice(0, 160)
  }
  return ''
}

export async function headHtml(ctx: RenderCtx, doc: Doc | null, concept: ConceptDef | null, opts: { titleOverride?: string } = {}): Promise<string> {
  const site = ctx.site
  const pattern = doc?.seo?.title ? '{title}' : (concept?.seo?.titlePattern || site.seo.titlePattern)
  const baseTitle = opts.titleOverride ?? (doc?.seo?.title || doc?.title || site.name)
  // The home page defaults to "{site} — {tagline}" since a page-title pattern
  // like "{title} - {site}" has nothing meaningful to put in {title} there —
  // but a doc that explicitly sets its own seo.title (the home doc's SEO tab
  // exposes exactly this field) means it, and must win over the default.
  const title = ctx.path === '/' && !opts.titleOverride && !doc?.seo?.title
    ? `${site.name}${site.tagline ? ' — ' + site.tagline : ''}`
    : fillPattern(pattern, { title: baseTitle, site: site.name })
  const desc = (doc ? docDescription(doc) : '') || site.seo.description || ''
  // A mirrored page is reachable at several addresses; the canonical always
  // points at the document's own URL, never at the address being served.
  const canonicalPath = ctx.canonicalPath || ctx.path
  const canonical = doc?.seo?.canonical || site.url + (canonicalPath === '/' ? '/' : hrefFor(canonicalPath, site))
  const robots = doc?.seo?.noindex ? 'noindex,nofollow' : (site.seo.robots || 'index,follow')

  let ogImage = ''
  let ogAlt = ''
  // A page's own cover is a better social card than the site-wide fallback —
  // without this step every share of every page showed the same photograph.
  // Explicit SEO image first, then the document's cover, then the site default.
  const ogMediaId = doc?.seo?.image || doc?.fields?.cover || site.seo.image
  if (ogMediaId) {
    const meta = await ctx.env.media.meta(ogMediaId)
    if (meta) {
      const w = site.images.sizes.filter((s: number) => s <= 1280).pop() || 1280
      ogImage = site.url + (site.images.provider === 'cloudflare'
        ? `/cdn-cgi/image/width=${w},format=auto/media/${meta.file}`
        : ctx.env.media.variantUrl(meta, w, 'webp', site.images))
      ctx.collect.variants.add(`${meta.id}|${w}|webp`)
      ogAlt = meta.alt || ''
    }
  }

  const parts = [
    `<title>${escapeHtml(title)}</title>`,
    desc ? `<meta name="description" content="${escapeAttr(desc)}">` : '',
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    `<meta name="robots" content="${escapeAttr(robots)}">`,
    `<meta property="og:type" content="${escapeAttr(doc?.seo?.ogType || (concept?.seo?.schema === 'article' ? 'article' : 'website'))}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    desc ? `<meta property="og:description" content="${escapeAttr(desc)}">` : '',
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    `<meta property="og:site_name" content="${escapeAttr(site.name)}">`,
    ogImage ? `<meta property="og:image" content="${escapeAttr(ogImage)}">` : '',
    ogImage && ogAlt ? `<meta property="og:image:alt" content="${escapeAttr(ogAlt)}">` : '',
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    site.seo.twitter ? `<meta name="twitter:site" content="${escapeAttr(site.seo.twitter)}">` : '',
  ]

  // JSON-LD graph.
  //
  // The identity nodes (WebSite / Organization / LocalBusiness) go on *every*
  // page, not just the home page, and carry @id so per-page nodes can point at
  // them. Search engines read a business's details from whichever page they
  // happen to land on, so publishing them only at the root leaves every deep
  // page — which is most of the site — with no company information at all.
  const graph: any[] = []
  const org = site.seo.organization
  if (org?.name) {
    const orgId = `${site.url}/#organization`
    const address = org.address && {
      '@type': 'PostalAddress',
      ...(org.address.streetAddress ? { streetAddress: org.address.streetAddress } : {}),
      ...(org.address.addressLocality ? { addressLocality: org.address.addressLocality } : {}),
      ...(org.address.addressRegion ? { addressRegion: org.address.addressRegion } : {}),
      ...(org.address.postalCode ? { postalCode: org.address.postalCode } : {}),
      ...(org.address.addressCountry ? { addressCountry: org.address.addressCountry } : {}),
    }

    graph.push({
      '@type': 'Organization', '@id': orgId, name: org.name, url: site.url + '/',
      ...(org.legalName ? { legalName: org.legalName } : {}),
      ...(org.logo ? { logo: absolute(site, org.logo) } : {}),
      ...(site.seo.description ? { description: site.seo.description } : {}),
      ...(org.telephone ? { telephone: org.telephone } : {}),
      ...(org.email ? { email: org.email } : {}),
      ...(address ? { address } : {}),
      ...(org.sameAs?.length ? { sameAs: org.sameAs } : {}),
    })

    // A LocalBusiness node only makes sense once there is a real address to
    // put on it — a bare name would be a worse result, not a richer one.
    if (address && org.localBusiness !== false) {
      graph.push({
        '@type': org.businessType || 'LocalBusiness', '@id': `${site.url}/#localbusiness`,
        name: org.name, url: site.url + '/', address,
        parentOrganization: { '@id': orgId },
        ...(org.logo ? { image: absolute(site, org.logo) } : {}),
        ...(org.telephone ? { telephone: org.telephone } : {}),
        ...(org.priceRange ? { priceRange: org.priceRange } : {}),
        ...(org.geo ? { geo: { '@type': 'GeoCoordinates', latitude: org.geo.latitude, longitude: org.geo.longitude } } : {}),
        ...(org.openingHours?.length ? { openingHoursSpecification: org.openingHours } : {}),
        ...(org.areaServed ? { areaServed: org.areaServed } : {}),
        ...(org.hasMap ? { hasMap: org.hasMap } : {}),
        ...(org.aggregateRating ? { aggregateRating: { '@type': 'AggregateRating', ...org.aggregateRating } } : {}),
      })
    }
  }

  graph.push({
    '@type': 'WebSite', '@id': `${site.url}/#website`, name: site.name, url: site.url + '/',
    ...(site.tagline ? { description: site.tagline } : {}),
    ...(org?.name ? { publisher: { '@id': `${site.url}/#organization` } } : {}),
  })

  if (doc && ctx.path !== '/') {
    graph.push({
      '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: doc.title,
      ...(desc ? { description: desc } : {}),
      isPartOf: { '@id': `${site.url}/#website` },
      ...(ogImage ? { primaryImageOfPage: ogImage } : {}),
    })
  }
  if (doc && concept?.seo?.schema === 'article') {
    graph.push({
      '@type': 'Article', headline: doc.title, datePublished: doc.publishAt || doc.createdAt,
      dateModified: doc.updatedAt, mainEntityOfPage: canonical,
      ...(desc ? { description: desc } : {}), ...(ogImage ? { image: ogImage } : {}),
    })
  }
  if (doc && concept?.seo?.schema === 'product') {
    // Every spec-list on the page is already clean label/value pairs — reuse
    // them as Product.additionalProperty instead of asking editors to enter
    // the same numbers twice. No price/offers: this isn't an ecommerce site
    // and inventing availability data would be worse than omitting it.
    const additionalProperty: { '@type': string; name: string; value: string }[] = []
    walkBlocks(doc.blocks, b => {
      if (b.type === 'spec-list' && Array.isArray(b.props?.rows)) {
        for (const r of b.props.rows) {
          if (r?.label && r?.value) additionalProperty.push({ '@type': 'PropertyValue', name: String(r.label), value: String(r.value) })
        }
      }
    })
    graph.push({
      '@type': 'Product', '@id': `${canonical}#product`, url: canonical,
      name: doc.fields?.name || doc.title,
      ...(desc || doc.fields?.strapline ? { description: desc || doc.fields.strapline } : {}),
      ...(ogImage ? { image: ogImage } : {}),
      ...(org?.name ? { brand: { '@type': 'Brand', name: org.name } } : {}),
      ...(additionalProperty.length ? { additionalProperty } : {}),
    })
  }
  graph.push(...ctx.collect.jsonld)
  if (doc?.seo?.jsonld?.length) graph.push(...doc.seo.jsonld)
  if (graph.length) {
    parts.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`)
  }
  if (site.plugins?.search?.enabled && site.features?.searchOpenSearch !== false) {
    parts.push(`<link rel="search" type="application/opensearchdescription+xml" title="${escapeAttr(site.name)}" href="/opensearch.xml">`)
  }
  parts.push(...ctx.collect.headExtra)
  return parts.filter(Boolean).join('\n  ')
}

export async function sitemapXml(env: any): Promise<string> {
  const site: SiteConfig = await env.site()
  const docs = await env.content.listDocs(undefined, { published: true })
  const urls: string[] = []
  for (const d of docs) {
    if (d.seo?.noindex) continue
    if (d.access?.mode && d.access.mode !== 'public') continue // gated pages stay out of the index
    const p = await env.content.docPath(d)
    urls.push(`<url><loc>${escapeHtml(site.url + hrefFor(p, site))}</loc><lastmod>${d.updatedAt.slice(0, 10)}</lastmod></url>`)
  }
  for (const c of await env.content.concepts()) {
    if (c.indexPath) urls.push(`<url><loc>${escapeHtml(site.url + hrefFor(normalizePath(c.indexPath), site))}</loc></url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
}

export async function robotsTxt(env: any): Promise<string> {
  const site: SiteConfig = await env.site()
  const sitemap = site.features?.sitemap === false ? '' : `\nSitemap: ${site.url}/sitemap.xml`
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${sitemap}\n`
}

export async function rssXml(env: any, concept: ConceptDef): Promise<string> {
  const site: SiteConfig = await env.site()
  const docs = (await env.content.listDocs(concept.name, { published: true })).slice(0, 20)
  const items: string[] = []
  for (const d of docs) {
    if (d.access?.mode && d.access.mode !== 'public') continue
    const p = hrefFor(await env.content.docPath(d), site)
    const desc = docDescription(d) || mdText(d.blocks?.find((b: any) => b.type === 'richtext')?.props?.md || '').slice(0, 300)
    items.push(`<item><title>${escapeHtml(d.title)}</title><link>${escapeHtml(site.url + p)}</link><guid>${escapeHtml(site.url + p)}</guid><pubDate>${new Date(d.publishAt || d.createdAt).toUTCString()}</pubDate><description>${escapeHtml(desc)}</description></item>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeHtml(site.name)} — ${escapeHtml(concept.labelPlural || concept.label)}</title><link>${escapeHtml(site.url + (concept.indexPath || '/'))}</link><description>${escapeHtml(site.seo.description || '')}</description>\n${items.join('\n')}\n</channel></rss>`
}
