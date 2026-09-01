// Public site routes: pages by concept URL patterns, list pages + pagination,
// media originals + on-demand derivatives, template assets, sitemap/robots/RSS,
// redirects and slug-history 301s.

import { Hono } from '../vendor/http.ts'
import type { BlockhouseEnv } from './env.ts'
import { escapeHtml, normalizePath } from '../core/util.ts'
import { canonicalizeRequestPath, hrefFor } from '../core/urls.ts'
import { renderDocPage, renderListPage, render404, renderSystemPage } from '../render/page.ts'
import { robotsTxt, rssXml, sitemapXml } from '../render/seo.ts'
import { mimeOf } from '../images/exif.ts'

const LONG_CACHE = 'public, max-age=31536000, immutable'
const PAGE_CACHE = 'public, max-age=0, must-revalidate'

export function siteRoutes(env: BlockhouseEnv): Hono {
  const app = new Hono()

  // Template IDE live preview: an authed request carrying ?__tplpreview=1
  // renders with the studio's unsaved draft buffers layered on top of the
  // resolver — nothing touches disk, and only for this request.
  app.use('*', async (c, next) => {
    const drafts: Map<string, string> | undefined = (env as any).tplDrafts
    if (!drafts?.size || !c.get('user' as never)) return next()
    const flagged = c.req.query('__tplpreview') === '1'
      || (c.req.path.startsWith('/assets/') && (c.req.header('referer') || '').includes('__tplpreview=1'))
    if (!flagged) return next()
    const resolver: any = env.resolver
    resolver.preview = drafts
    try { await next() } finally { resolver.preview = null }
  })

  // Private / staging protection.
  //   'staging' — studio users only. Everyone else gets a 401 "Not authorised"
  //               page (or privateRedirect, if set) instead of the real content.
  //   'members' — anyone signed in via the Members plugin, studio users included.
  // This is the "forgot the DNS rule" safety net for staging instances; pair it
  // with real firewall/Cloudflare Access rules for defence in depth.
  app.use('*', async (c, next) => {
    const site = await env.site()
    const mode = site.security?.private || 'off'
    if (mode !== 'staging' && mode !== 'members') return next()
    if (c.get('user' as never)) return next()
    const path = canonicalizeRequestPath(new URL(c.req.url).pathname)
    const ap = String(site.security?.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin'
    if (path === `/${ap}` || path.startsWith(`/${ap}/`) || path.startsWith('/api/') || path === '/healthz' || path.startsWith('/x/members/')) return next()
    if (mode === 'members') {
      const gate = (env as any).memberGate
      const member = gate ? await gate.resolve(c).catch(() => null) : null
      if (member) return next()
      const login = gate ? await gate.loginPath() : '/account'
      if (path !== login) return c.redirect(`${login}?next=${encodeURIComponent(path)}`, 302)
      return next()
    }
    // mode === 'staging': studio sign-in only — the Members gate above doesn't apply here.
    const to = site.security?.privateRedirect
    if (to) return c.redirect(to, 302)
    return notAuthorizedResponse(c, env, path, undefined)
  })

  // Maintenance mode: the public site returns 503 with a page you control, while
  // the studio, its API and anyone signed in keep working so you can finish the job.
  app.use('*', async (c, next) => {
    const site = await env.site()
    if (!site.maintenance?.enabled) return next()
    const path = canonicalizeRequestPath(new URL(c.req.url).pathname)
    if (c.get('user' as never)) return next()
    if (path.startsWith('/assets') || path.startsWith('/media') || path === '/healthz' || path === '/robots.txt') return next()
    for (const allow of site.maintenance.allow || []) {
      if (path === normalizePath(allow) || path.startsWith(normalizePath(allow) + '/')) return next()
    }
    const html = await renderSystemPage(env, 'maintenance', { mode: 'live', path }, {
      title: 'Back shortly',
      fallback: `<section class="wb-section pad-spacious"><div class="container w-normal" style="text-align:center"><h1>Back shortly</h1><p>${escapeHtml(site.maintenance.message || 'We are making some changes. Please check back in a little while.')}</p></div></section>`,
    })
    return c.html(html, 503, {
      'retry-after': String(site.maintenance.retryAfter || 600),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    })
  })

  app.get('/sitemap.xml', async c => {
    if ((await env.site()).features?.sitemap === false) return c.notFound()
    return c.body(await sitemapXml(env), 200, { 'content-type': 'application/xml' })
  })
  // OpenSearch description — lets browsers register this site as a search
  // engine. Points at the search plugin's page (?q=) when it is enabled.
  app.get('/opensearch.xml', async c => {
    const site = await env.site()
    if (!site.plugins?.search?.enabled || site.features?.searchOpenSearch === false) return c.notFound()
    const name = escapeHtml(site.name)
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${name}</ShortName>
  <Description>Search ${name}</Description>
  <Url type="text/html" template="${escapeHtml(site.url)}/x/search/go?q={searchTerms}"/>
  <InputEncoding>UTF-8</InputEncoding>
</OpenSearchDescription>
`, 200, { 'content-type': 'application/opensearchdescription+xml' })
  })
  app.get('/robots.txt', async c => c.text(await robotsTxt(env)))

  // blockhouse's own site runtime (prefetch, enhancers, theme toggle)
  app.get('/assets/blockhouse/*', async c => {
    const rel = c.req.path.slice('/assets/blockhouse/'.length)
    if (rel.includes('..')) return c.notFound()
    const data = await env.appAssets.read(`blockhouse/${rel}`)
    if (!data) return c.notFound()
    return c.body(data as any, 200, { 'content-type': mimeOf(rel), 'cache-control': env.dev ? 'no-cache' : LONG_CACHE })
  })

  // template + blockhouse runtime assets (layered: site overrides win)
  app.get('/assets/site/*', async c => {
    const rel = c.req.path.slice('/assets/site/'.length)
    if (rel.includes('..')) return c.notFound()
    const data = await env.resolver.read(`assets/${rel}`)
    if (!data) return c.notFound()
    return c.body(data as any, 200, {
      'content-type': mimeOf(rel),
      'cache-control': env.dev ? 'no-cache' : LONG_CACHE,
    })
  })

  // media originals (never private/) and generated derivatives
  app.get('/media/*', async c => {
    const rel = decodeURIComponent(c.req.path.slice('/media/'.length))
    if (rel.includes('..') || rel.startsWith('private/') || rel.startsWith('_meta/')) return c.notFound()
    if (rel.startsWith('_var/')) {
      let data = await env.driver.read(`media/${rel}`)
      if (!data) {
        const parsed = await env.media.parseVariantKey(rel)
        if (parsed) {
          const site = await env.site()
          const key = await env.media.ensureVariant(parsed.id, parsed.width, parsed.fmt, site.images)
          if (key) data = await env.driver.read(key)
        }
        if (!data) {
          // graceful fallback: serve the original (no sharp / bad size)
          if (parsed) {
            const meta = await env.media.meta(parsed.id)
            if (meta) {
              const orig = await env.driver.read(`media/${meta.file}`)
              if (orig) return c.body(orig as any, 200, { 'content-type': meta.type, 'cache-control': PAGE_CACHE })
            }
          }
          return c.notFound()
        }
      }
      return c.body(data as any, 200, { 'content-type': mimeOf(rel), 'cache-control': env.dev ? 'no-cache' : LONG_CACHE })
    }
    const data = await env.driver.read(`media/${rel}`)
    if (!data) return c.notFound()
    return c.body(data as any, 200, { 'content-type': mimeOf(rel), 'cache-control': env.dev ? 'no-cache' : 'public, max-age=86400' })
  })

  // everything else: resolve as a page
  app.get('/*', async c => {
    const user = c.get('user' as never) as any
    const site = await env.site()
    const path = canonicalizeRequestPath(new URL(c.req.url).pathname)
    if (path.startsWith('/admin') || path.startsWith('/api')) return c.notFound()

    // shortlinks: /s/<code> → the doc's canonical URL
    const sp = site.urls?.shortlinkPrefix || 's'
    if (site.urls?.shortlinks && path.startsWith(`/${sp}/`)) {
      const doc = await env.content.getByShortCode(path.slice(sp.length + 2))
      if (doc) return c.redirect(hrefFor(await env.content.docPath(doc), site), 301)
      return notFoundResponse(c, env, path, user)
    }

    // exact redirects
    for (const r of await env.content.redirects()) {
      if (normalizePath(r.from) === path) return c.redirect(r.to, (r.code as any) || 301)
    }

    // per-doc aliases: mirror (render here) or redirect to the canonical URL
    const alias = await env.content.getByAlias(path)
    if (alias) {
      const canonicalPath = await env.content.docPath(alias.doc)
      const pub = await env.content.getBySlug(alias.doc.concept, alias.doc.slug, true)
      // Gate before revealing the canonical URL, so an alias can't be used to
      // enumerate member-only pages.
      const gated = pub ? await gateCheck(c, env, pub, path) : null
      if (gated) return gated
      if (!alias.mirror) return c.redirect(hrefFor(canonicalPath, site), 301)
      if (pub) {
        return c.html(
          await renderDocPage(env, pub, { mode: 'live', path, canonicalPath, user, member: await currentMember(c, env) }),
          200,
          { 'cache-control': pub.access?.mode && pub.access.mode !== 'public' ? 'private, no-store' : PAGE_CACHE })
      }
    }

    // concept index pages + pagination + feeds
    for (const concept of await env.content.concepts()) {
      if (!concept.indexPath) continue
      const idx = normalizePath(concept.indexPath)
      if (path === idx || path.startsWith(idx + '/page/') || path === idx + '/feed.xml') {
        if (path.endsWith('/feed.xml')) {
          if (!concept.feed || site.features?.rss === false) return c.notFound()
          return c.body(await rssXml(env, concept), 200, { 'content-type': 'application/rss+xml' })
        }
        const page = path.includes('/page/') ? parseInt(path.split('/page/')[1], 10) || 1 : 1
        const res = await renderListPage(env, concept, page, { mode: 'live', path, user, member: await currentMember(c, env), menuDraft: user ? c.req.query('__menudraft') || undefined : undefined })
        if (!res) return c.notFound()
        return c.html(res.html, 200, { 'cache-control': PAGE_CACHE })
      }
    }

    const doc = await env.content.getByPath(path, true)
    if (doc) {
      if (doc.publishAt && new Date(doc.publishAt).getTime() > Date.now()) {
        return notFoundResponse(c, env, path, user)
      }
      const gated = await gateCheck(c, env, doc, path)
      if (gated) return gated
      const menuDraft = user ? c.req.query('__menudraft') || undefined : undefined
      const html = await renderDocPage(env, doc, { mode: 'live', path, user, member: await currentMember(c, env), menuDraft })
      return c.html(html, 200, { 'cache-control': doc.access?.mode && doc.access.mode !== 'public' ? 'private, no-store' : PAGE_CACHE })
    }

    // old slugs → 301
    const moved = await env.content.findBySlugHistory(path)
    if (moved && moved !== path) return c.redirect(moved, 301)

    return notFoundResponse(c, env, path, user)
  })

  return app
}

async function notFoundResponse(c: any, env: BlockhouseEnv, path: string, user: any) {
  const html = await render404(env, { mode: 'live', path, user })
  return c.html(html, 404)
}

// Deliberately does NOT go through renderSystemPage/assemble() — those pull in
// the site's real header/nav (which can itself carry real content, e.g. a
// mega-menu's preview panes), defeating the point of a staging gate meant to
// show unauthorised visitors nothing at all. This is a bare, standalone page.
async function notAuthorizedResponse(c: any, env: BlockhouseEnv, _path: string, _user: any) {
  const site = await env.site()
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Not authorised — ${escapeHtml(site.name || '')}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#1a1a1a}
a{color:inherit}</style></head>
<body><h1>Not authorised</h1><p>This site is only visible to signed-in team members.</p>
<p><a href="/admin">Sign in →</a></p></body></html>`
  return c.html(html, 401, { 'x-robots-tag': 'noindex' })
}

/**
 * Member gating. Returns a Response when the visitor may NOT see the page
 * (redirect to the login page, carrying ?next=), or null to continue.
 */
async function gateCheck(c: any, env: BlockhouseEnv, doc: any, path: string) {
  const access = doc.access
  if (!access || !access.mode || access.mode === 'public') return null
  const gate = (env as any).memberGate
  if (!gate) {
    // Members plugin disabled but the page is still marked member-only — fail
    // closed. Opening it up silently would leak whatever it was protecting.
    console.warn(`[blockhouse] "${path}" is member-only but the Members plugin is disabled — serving 404`)
    return notFoundResponse(c, env, path, c.get('user' as never))
  }
  const member = await gate.resolve(c)
  if (gate.allowed(member, access)) return null
  const login = access.redirect || (await gate.loginPath()) || '/account'
  return c.redirect(`${login}?next=${encodeURIComponent(path)}`, 302)
}

/** Resolve the signed-in site visitor once per request, for listing filters. */
async function currentMember(c: any, env: BlockhouseEnv) {
  const gate = (env as any).memberGate
  if (!gate) return null
  try { return await gate.resolve(c) } catch { return null }
}
