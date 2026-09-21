// Root Hono app — identical on Node, Bun and Workers.

import { Hono } from '../vendor/http.ts'
import type { BlockhouseEnv } from './env.ts'
import { mcpHttpRoutes } from './mcp-http.ts'
import { sessionMiddleware, csrfMiddleware, sameOriginOnly } from '../auth/session.ts'
import { apiRoutes } from './api.ts'
import { siteRoutes } from './site.ts'
import { adminShell } from './admin.ts'
import { renderDocPage } from '../render/page.ts'
import { can } from '../core/permissions.ts'
import { mimeOf } from '../images/exif.ts'
import { streamSSE } from '../vendor/http.ts'
import { securityMiddleware, adminAllowlistMiddleware } from './security.ts'

export function buildApp(env: BlockhouseEnv): Hono {
  const app = new Hono()

  // Liveness probe — deliberately before auth/session so orchestrators can
  // reach it, and deliberately free of anything that could leak configuration.
  app.get('/healthz', async c => {
    try {
      const site = await env.site()
      return c.json({ ok: true, name: site.name, env: env.envName, mode: env.mode })
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message || e) }, 503)
    }
  })

  // Optional error log (security.errorLog, on by default): server exceptions
  // land in .blockhouse/logs/error.log with the path that triggered them, so "it
  // broke yesterday" is diagnosable. Never logs request bodies or cookies.
  app.use('*', async (c, next) => {
    try { await next() } catch (err: any) {
      try {
        const site = await env.site()
        if (site.security?.errorLog !== false && (env as any).projectDir) {
          const { appendFileSync, mkdirSync } = await import('node:fs')
          const { join } = await import('node:path')
          const dirp = join((env as any).projectDir, '.blockhouse', 'logs')
          mkdirSync(dirp, { recursive: true })
          appendFileSync(join(dirp, 'error.log'),
            JSON.stringify({ at: new Date().toISOString(), path: new URL(c.req.url).pathname, error: String(err?.message || err), stack: String(err?.stack || '').split('\n').slice(0, 6).join(' | ') }) + '\n')
        }
      } catch {}
      throw err
    }
  })

  app.use('*', securityMiddleware(env))
  app.use('*', adminAllowlistMiddleware(env))
  app.use('*', sessionMiddleware(env))

  // ---------- studio ----------
  // The studio path is renameable (security.adminPath) — obscurity is not
  // security, but it starves bots that hammer /admin and /wp-admin. The
  // default path answers 404 when a custom one is set.

  const adminPath = async () => {
    const site = await env.site().catch(() => null as any)
    const p = String(site?.security?.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '')
    return p || 'admin'
  }

  app.use('*', async (c, next) => {
    const ap = await adminPath()
    const path = c.req.path
    if (!(path === `/${ap}` || path.startsWith(`/${ap}/`))) {
      // hide the default path when renamed
      if (ap !== 'admin' && (path === '/admin' || path.startsWith('/admin/'))) return c.notFound()
      return next()
    }
    const rest = path.slice(ap.length + 1)
    if (rest.startsWith('/assets/')) {
      const rel = rest.slice('/assets/'.length)
      if (rel.includes('..')) return c.notFound()
      const data = await env.appAssets.read(`admin/${rel}`)
      if (!data) return c.notFound()
      // 'private', not 'public': this is the studio bundle, gated behind a login — a
      // shared/CDN cache (Cloudflare's edge, a corporate proxy) has no business holding
      // a copy at all, and having one is exactly what turned "restart the site" into
      // "also go purge Cloudflare's cache" for an admin-JS change more than once.
      return c.body(data as any, 200, { 'content-type': mimeOf(rel), 'cache-control': env.dev ? 'no-cache' : 'private, max-age=3600' })
    }
    if (rest === '') return c.redirect(`/${ap}/`)
    return c.html(await adminShell(env, ap))
  })

  // live preview of working copies (draft state), optionally annotated for the editor
  app.get('/preview/:id', async c => {
    const u = c.get('user' as never) as any
    if (!can(u, 'preview')) return c.redirect('/admin/')
    const doc = await env.content.getDoc(c.req.param('id'))
    if (!doc) return c.notFound()
    const path = await env.content.docPath(doc)
    const html = await renderDocPage(env, doc, {
      mode: 'preview', user: u, path, annotate: c.req.query('editor') === '1',
      bare: c.req.query('bare') === '1',
    })
    return c.html(html, 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })
  })

  // ---------- dev reload (SSE) ----------

  if (env.dev) {
    /* The boot id lets the client tell a dropped connection from a restarted
     * server: a reconnect on its own is not a reason to reload the page. */
    const bootId = String(Date.now())
    app.get('/api/dev/events', c =>
      streamSSE(c, async stream => {
        let open = true
        const hook = () => { if (open) stream.writeSSE({ event: 'reload', data: String(Date.now()) }).catch(() => {}) }
        env.reloadHooks.add(hook)
        stream.onAbort(() => { open = false; env.reloadHooks.delete(hook) })
        await stream.writeSSE({ event: 'hello', data: bootId })
        while (open) {
          await stream.writeSSE({ event: 'ping', data: 'k' })
          await stream.sleep(15000)
        }
      }))
  }

  // ---------- API ----------

  // the AI assistant connection — token-only, never cookies (see mcp-http.ts)
  app.route('/mcp', mcpHttpRoutes(env))

  const api = apiRoutes(env)
  app.use('/api/*', csrfMiddleware(env))
  app.route('/api', api)

  // ---------- plugin public routes ----------

  for (const { pid, fn } of env.pluginRoutes.public) {
    const sub = new Hono()
    sub.use('*', sameOriginOnly())
    fn(sub)
    app.route(`/x/${pid}`, sub)
  }
  for (const { fn } of env.pluginRoutes.root) {
    const sub = new Hono()
    fn(sub)
    app.route('/', sub)
  }

  // ---------- public site ----------

  app.route('/', siteRoutes(env))

  return app
}
