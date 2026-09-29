// Admin REST API. Session-cookie auth + CSRF; every route permission-checked.

import { Hono } from '../vendor/http.ts'
import { LAYOUT_WIDTHS } from '../render/layout.ts'
import type { BlockhouseEnv } from './env.ts'
import { can, PermissionError, PLUGIN_PERMISSION_INFO } from '../core/permissions.ts'
import { hashPassword, verifyPassword } from '../auth/hash.ts'
import { establishSession, destroySession } from '../auth/session.ts'
import { analyzeSeo } from '../core/seo-analyze.ts'
import { audit, checkPasswordPolicy, clearLoginFailures, loginBlocked, recordLoginFailure } from './security.ts'
import type { Doc, User } from '../core/types.ts'
import { deepClone, id, randomToken, slugify, stringify, tryJson } from '../core/util.ts'
import { evaluate } from '../core/expr.ts'
import { exportFileFor, hrefFor, shortPath } from '../core/urls.ts'
import { openSecret, sealSecret } from './crypto.ts'

/** H1 hints: blocks that declare they render one, plus concepts whose page
 *  template owns the H1 (product/sector layouts). */
async function seoOpts(env: any, doc: any) {
  const h1Types = [...env.registry.blocks.values()].filter((b: any) => b.providesH1).map((b: any) => b.type)
  const concept = doc?.concept ? await env.content.concept(doc.concept) : null
  return { h1Types, templateH1: !!(concept as any)?.seo?.templateH1 }
}

type C = any

function user(c: C): User | null { return c.get('user') ?? null }

/** The host part of a site's own web address — "strongmanlifts.co.uk". */
function hostOf(url: unknown): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).host } catch { return '' }
}

/**
 * Every audit entry names the person who did it, by id AND by name — the
 * Activity page must not fall back to "someone" when an account is later
 * renamed or removed.
 */
function actor(c: C): { by: string; byName: string } {
  const u = user(c)
  return { by: u?.id || 'unknown', byName: u?.name || u?.email || 'someone' }
}

function guard(perm: string) {
  return async (c: C, next: any) => {
    if (!can(user(c), perm)) return c.json({ error: `permission required: ${perm}` }, user(c) ? 403 : 401)
    await next()
  }
}

/** Like guard(), but passes if the user holds any one of several permissions
 *  — for routes a narrower grant should also unlock, not just settings.write. */
function guardAny(...perms: string[]) {
  return async (c: C, next: any) => {
    if (!perms.some(p => can(user(c), p))) return c.json({ error: `permission required: one of ${perms.join(', ')}` }, user(c) ? 403 : 401)
    await next()
  }
}

// simple in-memory rate limiter (login etc.)
const buckets = new Map<string, { n: number; reset: number }>()
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const nowMs = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < nowMs) { buckets.set(key, { n: 1, reset: nowMs + windowMs }); return true }
  b.n++
  return b.n <= max
}

export function apiRoutes(env: BlockhouseEnv): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof PermissionError) return c.json({ error: err.message }, 403)
    console.error('[blockhouse api]', err)
    return c.json({ error: env.dev ? String(err) : 'internal error' }, 500)
  })

  // ---------- auth ----------

  app.post('/auth/bootstrap', async c => {
    if ((await env.secure.userCount()) > 0) return c.json({ error: 'already set up' }, 400)
    const body = await c.req.json()
    const site = await env.site()
    if (!body.email) return c.json({ error: 'email required' }, 400)
    const pwErr = checkPasswordPolicy(body.password || '', site.security || {})
    if (pwErr) return c.json({ error: pwErr }, 400)
    const u = await env.secure.createUser({
      email: body.email, name: body.name || 'Owner', role: 'owner',
      pass: await hashPassword(body.password, site.security?.pbkdf2Iterations),
    })
    await establishSession(c, env, u.id)
    env.events.emitBg('user.created', { userId: u.id, role: 'owner' })
    return c.json({ ok: true, user: u })
  })

  app.post('/auth/login', async c => {
    const site = await env.site()
    const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local').split(',')[0].trim()
    const body = await c.req.json()
    const email = String(body.email || '').toLowerCase().trim()
    const key = `${ip}|${email}`

    const wait = loginBlocked(key)
    if (wait) return c.json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` }, 429)
    if (!rateLimit(`login:${ip}`, 20, 10 * 60_000)) return c.json({ error: 'too many attempts, try again later' }, 429)

    const u = await env.secure.userByEmail(email)
    if (!u || !u.active || !(await verifyPassword(body.password || '', u.pass))) {
      recordLoginFailure(key, site.security || {})
      await audit(env, 'auth.login.failed', { email, ip })
      return c.json({ error: 'invalid credentials' }, 401)
    }
    clearLoginFailures(key)
    await establishSession(c, env, u.id)
    await env.secure.kvSet('lastlogin', u.id, new Date().toISOString()).catch(() => {})
    await audit(env, 'auth.login', { userId: u.id, email: u.email, ip })
    const { pass, ...safe } = u
    return c.json({ ok: true, user: safe })
  })

  app.post('/auth/logout', async c => { await destroySession(c, env); return c.json({ ok: true }) })

  // ---------- password reset (safe: token by email, no enumeration) ----------

  app.post('/auth/forgot', async c => {
    const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local').split(',')[0].trim()
    if (!rateLimit(`forgot:${ip}`, 5, 15 * 60_000)) return c.json({ ok: true })   // same shape either way
    const email = String((await c.req.json()).email || '').toLowerCase().trim()
    const u = await env.secure.userByEmail(email)
    if (u?.active) {
      const { issueToken } = await import('../auth/tokens.ts')
      const { token } = await issueToken(env.secure, 'pwreset', { meta: { userId: u.id }, ttlMs: 30 * 60_000, maxUses: 1 })
      const site = await env.site()
      const ap = String(site.security?.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin'
      const { sendMail } = await import('./env.ts')
      await sendMail(env, {
        to: email, subject: `Reset your ${site.name} studio password`,
        text: `Someone (hopefully you) asked to reset the studio password for ${email}.\n\n${site.url}/${ap}/#/reset/${token}\n\nThe link works once and expires in 30 minutes. If this wasn't you, ignore it.`,
      }).catch(e => console.error('[blockhouse] reset mail failed:', e?.message))
      await audit(env, 'auth.reset.requested', { email, ip })
    }
    return c.json({ ok: true, message: 'If that address has an account, a reset link is on its way.' })
  })

  app.post('/auth/reset', async c => {
    const { token, password } = await c.req.json()
    const site = await env.site()
    const pwErr = checkPasswordPolicy(password || '', site.security || {})
    if (pwErr) return c.json({ error: pwErr }, 400)
    const { checkToken } = await import('../auth/tokens.ts')
    const row = await checkToken(env.secure, 'pwreset', String(token || ''))
    if (!row) return c.json({ error: 'that link is invalid or has expired — request a new one' }, 400)
    const u = await env.secure.userById(row.meta.userId)
    if (!u) return c.json({ error: 'account no longer exists' }, 400)
    await env.secure.updateUser(u.id, { pass: await hashPassword(password, site.security?.pbkdf2Iterations) })
    await audit(env, 'auth.reset.completed', { userId: u.id })
    await establishSession(c, env, u.id)
    return c.json({ ok: true })
  })

  // dev-only: passwordless login for local tooling/screenshots.
  // Requires the project secret (.blockhouse/secret) — never enabled in production mode.
  app.get('/auth/dev-login', async c => {
    if (!env.dev) return c.notFound()
    if (c.req.query('s') !== env.secret) return c.json({ error: 'bad secret' }, 403)
    const u = await env.secure.userByEmail(c.req.query('email') || '')
    if (!u) return c.json({ error: 'no such user' }, 404)
    await establishSession(c, env, u.id)
    await env.secure.kvSet('lastlogin', u.id, new Date().toISOString()).catch(() => {})
    return c.redirect('/admin/', 302)
  })

  // ---------- AI assistant connections (personal tokens for /mcp) ----------
  // Each person manages their own. The token itself is shown once, at creation.

  app.get('/me/ai-connections', async c => {
    const u = user(c); if (!u) return c.json({ error: 'sign in first' }, 401)
    const { AI_TOKEN_KIND } = await import('./mcp-http.ts')
    const rows = (await env.secure.listTokens(AI_TOKEN_KIND)).filter((t: any) => t.userId === u.id)
    return c.json({
      connections: rows.map((t: any) => ({ id: t.id, name: t.meta?.name || 'Unnamed', allowPublish: !!t.meta?.allowPublish, createdAt: t.createdAt, uses: t.uses || 0 })),
      canPublish: can(u, 'content.publish'),
      canWrite: can(u, 'content.write') || can(u, 'content.write.own'),
    })
  })
  app.post('/me/ai-connections', async c => {
    const u = user(c); if (!u) return c.json({ error: 'sign in first' }, 401)
    const body = await c.req.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 60) || 'My AI assistant'
    const { AI_TOKEN_KIND, issueAiToken } = await import('./mcp-http.ts')
    const mine = (await env.secure.listTokens(AI_TOKEN_KIND)).filter((t: any) => t.userId === u.id)
    if (mine.length >= 10) return c.json({ error: 'You already have 10 connections. Remove one you no longer use first.' }, 400)
    const allowPublish = !!body.allowPublish && can(u, 'content.publish')
    const made = await issueAiToken(env, u.id, name, allowPublish)
    await audit(env, 'ai.connection.created', { ...actor(c), name, allowPublish })
    return c.json({ ok: true, id: made.id, token: made.token })
  })
  app.delete('/me/ai-connections/:id', async c => {
    const u = user(c); if (!u) return c.json({ error: 'sign in first' }, 401)
    const { AI_TOKEN_KIND } = await import('./mcp-http.ts')
    const row = (await env.secure.listTokens(AI_TOKEN_KIND)).find((t: any) => t.id === c.req.param('id'))
    // owners may remove anyone's; everyone else only their own
    if (!row || (row.userId !== u.id && !can(u, 'users.manage'))) return c.json({ error: 'not found' }, 404)
    await env.secure.deleteToken(row.id)
    await audit(env, 'ai.connection.removed', { ...actor(c), name: row.meta?.name })
    return c.json({ ok: true })
  })

  app.get('/auth/me', async c => {
    const u = user(c)
    return c.json({ user: u, needsBootstrap: (await env.secure.userCount()) === 0 })
  })

  // ---------- meta (everything the studio shell needs in one call) ----------

  app.get('/meta', guard('content.read'), async c => {
    const u = user(c)!
    const site = await env.site()
    const concepts = await env.content.concepts()
    const menus = await env.content.menus()
    return c.json({
      // Two sites can carry the same name (a staging copy of a live site is the
      // usual case), and then two studio tabs are indistinguishable. `hint` is
      // the one short thing that always differs: the site's own web address,
      // host only. The switcher's `ambiguous` flag needs the registry and so
      // cannot be answered here; the studio decides with it how loudly to show
      // the hint.
      site: { name: site.name, url: site.url, hint: hostOf(site.url), template: site.template, homeDocId: site.homeDocId, colorScheme: site.theme?.colorScheme || 'auto' },
      modules: site.modules || { hidden: [], hiddenForRole: {} },
      urls: site.urls || {},
      memberGroups: await listMemberGroups(env),
      concepts: concepts.filter(cc => !cc.hidden),
      menus: menus.map(m => ({ key: m.key, label: m.label })),
      blocks: env.registry.blockCatalogue(p => can(u, p)),
      layoutWidths: LAYOUT_WIDTHS,
      panels: env.registry.adminPanels.map(p => ({
        plugin: p.plugin, key: p.key, label: p.label, icon: p.icon,
        section: p.section, settingsOnly: !!p.settingsOnly,
        resources: (p.resources || []).map(r => ({ ...r })),
      })),
      user: u,
      perms: {
        publish: can(u, 'content.publish'), users: can(u, 'users.manage'),
        settings: can(u, 'settings.write'), menus: can(u, 'menus.write'),
        plugins: can(u, 'plugins.manage'), delete: can(u, 'content.delete'),
        seo: can(u, 'seo.tools'), html: can(u, 'content.publish'),
        audit: can(u, 'users.manage') || can(u, 'audit.read'),
      },
      dev: env.dev,
      settingsSections: env.registry.settingsSections,
      features: site.features || {},
    })
  })

  // multi-site registry (written by `blockhouse sites add`) — powers the switcher
  /** Is that studio listening? One second to answer, remembered for thirty. */
  const aliveCache = new Map<string, { at: number; ok: boolean }>()
  async function studioAlive(url: string): Promise<boolean> {
    if (!url) return false
    const hit = aliveCache.get(url)
    if (hit && Date.now() - hit.at < 30_000) return hit.ok
    let ok = false
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 1000)
      try {
        // Any answer at all means something is listening — a sign-in redirect
        // or a 404 is still a running studio.
        const r = await fetch(url + '/admin/', { method: 'HEAD', signal: ctl.signal, redirect: 'manual' })
        ok = !!r
      } finally { clearTimeout(t) }
    } catch { ok = false }
    aliveCache.set(url, { at: Date.now(), ok })
    return ok
  }

  app.get('/projects', guard('content.read'), async c => {
    try {
      const { homedir } = await import('node:os')
      const { readFileSync } = await import('node:fs')
      const { basename, join, resolve } = await import('node:path')
      const reg = JSON.parse(readFileSync(`${homedir()}/.blockhouse-projects.json`, 'utf8'))
      // `C:\projects\…` from the registry and `C:/projects/…` from the running
      // server are the same folder, and a string compare said they were not —
      // so no row was ever marked as the one you are standing in.
      const norm = (p3: string) => {
        let out = resolve(String(p3 || ''))
        if (process.platform === 'win32') out = out.toLowerCase().split('\\').join('/')
        return out.replace(/\/+$/, '')
      }
      const current = norm((env as any).projectDir || '')
      // The registry's `url` is where that site's studio is served from; the
      // public address a visitor types lives in the site's own site.json. The
      // switcher shows the public address and links to the studio, so a name
      // that appears twice can still be told apart.
      const projects = (reg.projects || []).map((p2: any) => {
        let name = p2.label
        let url = ''
        try {
          const sj = JSON.parse(readFileSync(join(p2.dir, 'site', 'site.json'), 'utf8'))
          name = sj.name || name
          url = sj.url || ''
        } catch {}
        return {
          label: name,
          folder: basename(String(p2.dir || '')),
          url,
          // A registry entry may record the port separately; honour it as a
          // candidate when the full URL has gone stale.
          port: Number(p2.port) || 0,
          studioUrl: String(p2.url || '').replace(/\/+$/, ''),
          // Where a person's browser should go. On a server the registry `url`
          // is the studio's internal address (http://localhost:8801) — right
          // for the liveness knock below, useless as a link from anyone else's
          // computer. `publicUrl` (`blockhouse sites add --public-url`) is the
          // address the studio is published on, e.g. https://automatic.owhs.uk.
          publicUrl: String(p2.publicUrl || '').replace(/\/+$/, ''),
          current: !!current && norm(p2.dir) === current,
        }
      })
      // A studio may be served from a copy of the folder the registry knows
      // (a staging checkout, for instance), and then no row is marked at all —
      // which is the one thing the switcher exists to tell you. Fall back to
      // the site's own public address, which is unique per site, and then to
      // the folder name.
      if (!projects.some((p2: any) => p2.current)) {
        const me = await env.site()
        const same = (a: string, b: string) => !!a && !!b && a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
        const byUrl = projects.filter((p2: any) => same(p2.url, String(me.url || '')))
        const hit = byUrl.length === 1 ? byUrl[0]
          : projects.filter((p2: any) => p2.folder === basename(current)).length === 1
            ? projects.find((p2: any) => p2.folder === basename(current)) : null
        if (hit) hit.current = true
      }
      const seen: Record<string, number> = {}
      for (const p2 of projects) seen[p2.label] = (seen[p2.label] || 0) + 1
      for (const p2 of projects) (p2 as any).ambiguous = seen[p2.label] > 1
      // Each studio runs on its own machine, so half of them are usually not
      // listening. Offering a link that ends in a browser connection error is
      // worse than saying so: one quick knock per row, cached, so opening the
      // switcher is not a round of network requests every time.
      // The registry's `url` is written once, by `blockhouse sites add`, and
      // goes stale the moment a studio is started on a different port: the
      // switcher then says "not running" about a studio that is running, and
      // can never reach it. When the recorded address does not answer, knock on
      // a small set of candidates as well, and only accept one that identifies
      // itself as this same site (`/healthz` reports the site name).
      const selfOrigin = (() => { try { return new URL(c.req.url).origin } catch { return '' } })()
      const envList = String(process.env.BLOCKHOUSE_STUDIOS || '')
        .split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean)
      const selfPort = Number(new URL(selfOrigin || 'http://localhost').port || 0)
      const neighbours = selfPort
        ? [selfPort - 2, selfPort - 1, selfPort + 1, selfPort + 2]
          .filter(n => n > 0 && n < 65536)
          .map(n => `${new URL(selfOrigin).protocol}//${new URL(selfOrigin).hostname}:${n}`)
        : []
      /** Does this address serve the site we think it does? */
      const identifies = async (url: string, name: string) => {
        try {
          const ctl = new AbortController()
          const t = setTimeout(() => ctl.abort(), 1000)
          try {
            const r = await fetch(url + '/healthz', { signal: ctl.signal })
            if (!r.ok) return false
            const j: any = await r.json()
            return !!j?.ok && String(j.name || '') === name
          } finally { clearTimeout(t) }
        } catch { return false }
      }
      const taken = new Set<string>([selfOrigin].filter(Boolean))
      for (const p2 of projects as any[]) {
        if (p2.current) { p2.alive = true; taken.add(p2.studioUrl); continue }
        if (await studioAlive(p2.studioUrl)) { p2.alive = true; taken.add(p2.studioUrl); continue }
        p2.alive = false
        const host = (() => { try { return new URL(p2.studioUrl).hostname } catch { return 'localhost' } })()
        const candidates = [
          p2.port ? `http://${host}:${p2.port}` : '',
          ...envList,
          ...neighbours,
        ].filter(Boolean).filter(u => !taken.has(u) && u !== p2.studioUrl)
        for (const u of candidates) {
          if (!(await studioAlive(u))) continue
          if (!(await identifies(u, p2.label))) continue
          // Found it somewhere else. Say where, so the row is not silently
          // pointing at an address nobody typed.
          p2.alive = true
          p2.foundAt = u
          p2.recordedUrl = p2.studioUrl
          p2.studioUrl = u
          taken.add(u)
          break
        }
      }
      // The link itself. A viewer on this machine can follow a localhost
      // address; anyone else gets the public one or, when there is none, no
      // link at all — a link to "localhost" on someone else's computer opens
      // nothing, or worse, whatever they happen to be running.
      const isLocal = (u: string) => { try { return /^(localhost|127\.|\[::1\])/.test(new URL(u).hostname) } catch { return false } }
      // Behind a tunnel or proxy the request can look local even though the
      // person is miles away; anything that came through one isn't.
      const viewerLocal = isLocal(selfOrigin) && !c.req.header('cf-ray') && !c.req.header('x-forwarded-for')
      for (const p2 of projects as any[]) {
        const internal = p2.studioUrl
        p2.openUrl = p2.publicUrl || (!isLocal(internal) || viewerLocal ? internal : '')
      }
      return c.json({ projects })
    } catch { return c.json({ projects: [] }) }
  })

  // ---------- content ----------

  app.get('/content', guard('content.read'), async c => {
    const concept = c.req.query('concept') || undefined
    const docs = await env.content.listDocs(concept)
    const listSite = await env.site()
    const out = []
    for (const d of docs) {
      out.push({
        id: d.id, concept: d.concept, slug: d.slug, title: d.title, status: d.status,
        updatedAt: d.updatedAt, author: d.author, path: await env.content.docPath(d),
        stale: d.status === 'published' && await env.content.hasUnpublishedChanges(d),
        // the studio list shows type-specific columns, a scheduled state and a
        // "search-engine problems" count, all of which need these three
        publishAt: d.publishAt ?? null,
        fields: d.fields ?? {},
        seoErrors: analyzeSeo(d, listSite, await seoOpts(env, d)).filter(ch => ch.level === 'error').length,
      })
    }
    return c.json({ docs: out })
  })

  app.post('/content', guard('content.write.own'), async c => {
    const body = await c.req.json()
    if (!body.concept || !body.title) return c.json({ error: 'concept and title required' }, 400)
    if (!(await env.content.concept(body.concept))) return c.json({ error: 'unknown concept' }, 400)
    const doc = await env.content.createDoc(body, user(c)!.id)
    env.events.emitBg('content.created', { docId: doc.id, concept: doc.concept, user: user(c)!.id })
    await audit(env, 'content.created', { ...actor(c), docId: doc.id, title: doc.title, concept: doc.concept })
    return c.json({ doc, path: await env.content.docPath(doc) })
  })

  app.get('/content/:id', guard('content.read'), async c => {
    const doc = await env.content.getDoc(c.req.param('id'))
    if (!doc) return c.json({ error: 'not found' }, 404)
    const site = await env.site()
    const path = await env.content.docPath(doc)
    return c.json({
      doc,
      path,
      href: hrefFor(path, site),
      exportFile: exportFileFor(path, site),
      shortlink: site.urls?.shortlinks ? shortPath(doc.id, site) : null,
      seo: analyzeSeo(doc, site, await seoOpts(env, doc)),
      stale: doc.status === 'published' && await env.content.hasUnpublishedChanges(doc),
      isHome: site.homeDocId === doc.id,
    })
  })

  app.put('/content/:id', async c => {
    const existing = await env.content.getDoc(c.req.param('id'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    const u = user(c)
    if (!can(u, 'content.write', { ownerId: existing.author })) return c.json({ error: 'permission required: content.write' }, u ? 403 : 401)
    const body = await c.req.json()
    const incoming: Doc = body.doc
    if (!incoming || incoming.id !== existing.id) return c.json({ error: 'bad doc' }, 400)
    if (body.baseVersion !== undefined && body.baseVersion !== existing.version) {
      return c.json({ error: 'conflict', serverVersion: existing.version, serverUpdatedAt: existing.updatedAt }, 409)
    }
    // status transitions are controlled by dedicated endpoints
    incoming.status = existing.status
    incoming.author = existing.author
    incoming.createdAt = existing.createdAt
    const result = await env.content.saveDocResult(incoming, { snapshot: body.snapshot !== false })
    const saved = result.doc
    // Nothing actually changed: storage left the document alone, so we do too —
    // no event, no Activity row, no reload ping. (R15-1) `snapshot` still says
    // whether a restore point was kept — an explicit Save keeps one even when
    // the text matches the last autosave (R21-2).
    if (result.unchanged) {
      const site0 = await env.site()
      return c.json({ doc: saved, unchanged: true, snapshot: result.snapshot, path: await env.content.docPath(saved), seo: analyzeSeo(saved, site0, await seoOpts(env, saved)), stale: saved.status === 'published' && await env.content.hasUnpublishedChanges(saved) })
    }
    env.events.emitBg('content.saved', { docId: saved.id, concept: saved.concept, user: u!.id }, env.waitUntil)
    // The editor autosaves; only a save that actually produced a new version is
    // worth a line in Activity, or the log becomes a keystroke record.
    // The editor saves immediately before it publishes. That pair used to read
    // in Activity as two actions a second apart ("Saved X" under "Published
    // X"); the publish flow marks its save with ?publishing=1 so only the
    // publish is logged.
    if (saved.version !== existing.version && c.req.query('publishing') !== '1') {
      await audit(env, 'content.saved', { ...actor(c), docId: saved.id, title: saved.title, concept: saved.concept })
    }
    notifyReload(env)
    const site = await env.site()
    return c.json({ doc: saved, path: await env.content.docPath(saved), seo: analyzeSeo(saved, site, await seoOpts(env, saved)), stale: saved.status === 'published' && await env.content.hasUnpublishedChanges(saved) })
  })

  app.delete('/content/:id', guard('content.delete'), async c => {
    const doomed = await env.content.getDoc(c.req.param('id'))
    const ok = await env.content.deleteDoc(c.req.param('id'))
    if (ok) await audit(env, 'content.deleted', { ...actor(c), docId: c.req.param('id'), title: doomed?.title, concept: doomed?.concept })
    notifyReload(env)
    return c.json({ ok })
  })

  app.post('/content/:id/publish', guard('content.publish'), async c => {
    const doc = await env.content.publish(c.req.param('id'))
    if (!doc) return c.json({ error: 'not found' }, 404)
    env.events.emitBg('content.published', { docId: doc.id, concept: doc.concept, path: await env.content.docPath(doc), user: user(c)!.id }, env.waitUntil)
    await audit(env, 'content.published', { ...actor(c), docId: doc.id, title: doc.title, concept: doc.concept })
    notifyReload(env)
    return c.json({ doc })
  })

  app.post('/content/:id/unpublish', guard('content.publish'), async c => {
    const doc = await env.content.unpublish(c.req.param('id'))
    if (!doc) return c.json({ error: 'not found' }, 404)
    env.events.emitBg('content.unpublished', { docId: doc.id }, env.waitUntil)
    await audit(env, 'content.unpublished', { ...actor(c), docId: doc.id, title: doc.title, concept: doc.concept })
    notifyReload(env)
    return c.json({ doc })
  })

  app.post('/content/:id/submit', guard('content.submit'), async c => {
    const doc = await env.content.getDoc(c.req.param('id'))
    if (!doc) return c.json({ error: 'not found' }, 404)
    doc.status = 'review'
    const saved = await env.content.saveDoc(doc, { snapshot: false })
    env.events.emitBg('content.submitted', { docId: doc.id, user: user(c)!.id }, env.waitUntil)
    return c.json({ doc: saved })
  })

  app.get('/content/:id/versions', guard('content.read'), async c => {
    return c.json({ versions: await env.content.versions(c.req.param('id')) })
  })

  app.post('/content/:id/restore', async c => {
    const existing = await env.content.getDoc(c.req.param('id'))
    if (!existing) return c.json({ error: 'not found' }, 404)
    if (!can(user(c), 'content.write', { ownerId: existing.author })) return c.json({ error: 'forbidden' }, 403)
    const body = await c.req.json()
    const version = await env.content.getVersion(body.key)
    if (!version || version.id !== existing.id) return c.json({ error: 'bad version' }, 400)
    const restored = await env.content.saveDoc({ ...version, status: existing.status }, { snapshot: true, action: 'restore' })
    notifyReload(env)
    return c.json({ doc: restored })
  })

  app.post('/content/:id/make-home', guard('settings.write'), async c => {
    await env.content.saveSite({ homeDocId: c.req.param('id') } as any)
    env.invalidate()
    notifyReload(env)
    return c.json({ ok: true })
  })

  // ---------- media ----------

  app.get('/media', guard('media.read'), async c => {
    const q = c.req.query('q'), folder = c.req.query('folder'), tag = c.req.query('tag'), type = c.req.query('type')
    if (q === undefined && folder === undefined && tag === undefined && type === undefined) {
      return c.json({ media: await env.media.list() })
    }
    const media = await env.media.search({
      text: q, folder, tag, type,
      private: c.req.query('private') === '1' ? true : c.req.query('private') === '0' ? false : undefined,
    })
    return c.json({ media })
  })

  app.get('/media/index', guard('media.read'), async c => c.json(await env.media.index()))

  app.post('/media/:id/process', guard('media.write'), async c => {
    const ops = await c.req.json()
    const site = await env.site()
    const res = await env.media.process(c.req.param('id'), ops, site)
    if ((res as any).error) return c.json(res, 400)
    await audit(env, 'media.processed', { source: c.req.param('id'), result: (res as any).id, by: user(c)!.id })
    return c.json({ media: res })
  })

  app.post('/media/bulk', guard('media.write'), async c => {
    const { ids, action, value } = await c.req.json()
    if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'ids[] required' }, 400)
    let n = 0
    for (const mid of ids) {
      const meta = await env.media.meta(mid)
      if (!meta) continue
      if (action === 'move') meta.folder = String(value || '')
      else if (action === 'tag') meta.tags = [...new Set([...(meta.tags || []), String(value)])]
      else if (action === 'untag') meta.tags = (meta.tags || []).filter(t => t !== value)
      else if (action === 'private') meta.private = !!value
      else if (action === 'delete') { if (!can(user(c), 'media.manage')) return c.json({ error: 'permission required: media.manage' }, 403); await env.media.delete(mid); n++; continue }
      else continue
      meta.updatedAt = new Date().toISOString()
      await env.media.saveMeta(meta)
      n++
    }
    return c.json({ ok: true, updated: n })
  })

  app.post('/media', guard('media.write'), async c => {
    const body = await c.req.parseBody()
    const file = body.file as File
    if (!file?.name) return c.json({ error: 'file required' }, 400)
    if (file.size > 40 * 1024 * 1024) return c.json({ error: 'file too large (40MB max)' }, 400)
    const site = await env.site()
    const meta = await env.media.upload(file.name, new Uint8Array(await file.arrayBuffer()), site, {
      alt: typeof body.alt === 'string' ? body.alt : '',
      private: body.private === '1',
      folder: typeof body.folder === 'string' ? body.folder : '',
      tags: typeof body.tags === 'string' && body.tags ? body.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
    })
    env.events.emitBg('media.uploaded', { mediaId: meta.id, name: meta.name, user: user(c)!.id }, env.waitUntil)
    return c.json({ media: meta })
  })

  // font upload → stored as media, returns a path usable in site.fonts[]
  app.post('/fonts', guard('settings.write'), async c => {
    const body = await c.req.parseBody()
    const file = body.file as File
    if (!file?.name || !/\.(woff2?|ttf|otf)$/i.test(file.name)) return c.json({ error: 'woff2/woff/ttf font required' }, 400)
    const site = await env.site()
    const meta = await env.media.upload(file.name, new Uint8Array(await file.arrayBuffer()), site, {})
    return c.json({ file: meta.file, name: meta.name })
  })

  app.patch('/media/:id', guard('media.write'), async c => {
    const meta = await env.media.meta(c.req.param('id'))
    if (!meta) return c.json({ error: 'not found' }, 404)
    const body = await c.req.json()
    for (const k of ['alt', 'name', 'title', 'caption', 'credit', 'folder', 'tags', 'focal', 'noWatermark', 'private'] as const) {
      if (body[k] !== undefined) (meta as any)[k] = body[k]
    }
    meta.updatedAt = new Date().toISOString()
    await env.media.saveMeta(meta)
    return c.json({ media: meta })
  })

  app.delete('/media/:id', guard('media.manage'), async c => {
    await env.media.delete(c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---------- menus ----------

  app.get('/menus', guard('content.read'), async c => c.json({ menus: await env.content.menus() }))
  app.get('/menus/:key', guard('content.read'), async c => {
    const m = await env.content.menu(c.req.param('key'))
    return m ? c.json({ menu: m }) : c.json({ error: 'not found' }, 404)
  })
  // Draft channel: the menu editor's live preview renders from here, so
  // editing never mutates the real menu until Save.
  app.put('/menus/:key/draft', guard('menus.write'), async c => {
    const body = await c.req.json()
    env.menuDrafts.set(c.req.param('key'), body.menu)
    return c.json({ ok: true })
  })
  app.delete('/menus/:key/draft', guard('menus.write'), async c => {
    env.menuDrafts.delete(c.req.param('key'))
    return c.json({ ok: true })
  })

  app.put('/menus/:key', guard('menus.write'), async c => {
    const body = await c.req.json()
    const menu = body.menu
    if (!menu || menu.key !== c.req.param('key')) return c.json({ error: 'bad menu' }, 400)
    await env.content.saveMenu(menu)
    await audit(env, 'menu.saved', { ...actor(c), key: menu.key, label: menu.label, items: menu.items?.length ?? 0 })
    notifyReload(env)
    return c.json({ menu })
  })

  // ---------- concepts ----------

  app.get('/concepts', guard('content.read'), async c => {
    const concepts = await env.content.concepts()
    const counts: Record<string, number> = {}
    for (const cc of concepts) counts[cc.name] = (await env.content.listDocs(cc.name)).length
    return c.json({ concepts, counts })
  })
  app.put('/concepts/:name', guard('settings.write'), async c => {
    const body = await c.req.json()
    if (!body.concept || body.concept.name !== c.req.param('name')) return c.json({ error: 'bad concept' }, 400)
    if (!/^[a-z][a-z0-9-]*$/.test(body.concept.name)) return c.json({ error: 'invalid name' }, 400)
    if (!String(body.concept.urlPattern || '').includes('{slug}') ) return c.json({ error: 'urlPattern must contain {slug}' }, 400)
    // key collisions: two types must not share a URL pattern
    for (const other of await env.content.concepts()) {
      if (other.name !== body.concept.name && other.urlPattern === body.concept.urlPattern) {
        return c.json({ error: `“${other.label}” already uses that URL pattern` }, 400)
      }
    }
    await env.content.saveConcept(body.concept)
    env.invalidate()
    notifyReload(env)
    await audit(env, 'concept.saved', { ...actor(c), name: body.concept.name })
    return c.json({ concept: body.concept })
  })
  app.delete('/concepts/:name', guard('settings.write'), async c => {
    const name = c.req.param('name')
    const docs = await env.content.listDocs(name)
    if (docs.length) return c.json({ error: `${docs.length} document(s) still use this type — delete or move them first` }, 400)
    await env.driver.delete(`site/concepts/${safe(name)}.json`)
    env.invalidate()
    notifyReload(env)
    await audit(env, 'concept.deleted', { ...actor(c), name })
    return c.json({ ok: true })
  })

  // ---------- users ----------

  app.get('/users', guard('users.manage'), async c => {
    const users = await env.secure.users()
    const out = []
    for (const u of users) {
      out.push({ ...u, lastLoginAt: await env.secure.kvGet('lastlogin', u.id, null) })
    }
    return c.json({ users: out })
  })
  app.post('/users', guard('users.manage'), async c => {
    const body = await c.req.json()
    const site = await env.site()
    if (!body.email) return c.json({ error: 'email required' }, 400)
    const pwErr = checkPasswordPolicy(body.password || '', site.security || {})
    if (pwErr) return c.json({ error: pwErr }, 400)
    if (await env.secure.userByEmail(body.email)) return c.json({ error: 'email already registered' }, 400)
    if (body.role === 'owner' && user(c)!.role !== 'owner') return c.json({ error: 'only owners can create owners' }, 403)
    const u = await env.secure.createUser({
      email: body.email, name: body.name || body.email.split('@')[0],
      role: ['viewer', 'author', 'editor', 'admin', 'owner'].includes(body.role) ? body.role : 'author',
      pass: await hashPassword(body.password, site.security?.pbkdf2Iterations),
    })
    env.events.emitBg('user.created', { userId: u.id, role: u.role }, env.waitUntil)
    await audit(env, 'user.created', { ...actor(c), userId: u.id, userName: u.name, email: u.email, role: u.role })
    return c.json({ user: u })
  })
  app.patch('/users/:id', guard('users.manage'), async c => {
    const body = await c.req.json()
    const site = await env.site()
    const patch: any = {}
    for (const k of ['name', 'role', 'active', 'grants']) if (body[k] !== undefined) patch[k] = body[k]
    if (body.password) {
      const pwErr = checkPasswordPolicy(body.password, site.security || {})
      if (pwErr) return c.json({ error: pwErr }, 400)
      patch.pass = await hashPassword(body.password, site.security?.pbkdf2Iterations)
    }
    const target = await env.secure.userById(c.req.param('id'))
    if (target?.role === 'owner' && user(c)!.role !== 'owner') return c.json({ error: 'cannot modify an owner' }, 403)
    const u = await env.secure.updateUser(c.req.param('id'), patch)
    // privilege or credential change → drop that user's other sessions
    const revoked = !!(u && (patch.role !== undefined || patch.pass || patch.active === false || patch.grants))
    if (u && revoked) await env.secure.deleteSessionsForUser(u.id)
    if (u) {
      // Record WHAT changed. The old log said "its role is now …" for every
      // patch, including a sign-in toggle that never touched the role.
      const changed: string[] = []
      if (patch.name !== undefined && patch.name !== target?.name) changed.push('name')
      if (patch.active !== undefined && patch.active !== target?.active) changed.push('active')
      if (patch.role !== undefined && patch.role !== target?.role) changed.push('role')
      if (patch.grants !== undefined) changed.push('grants')
      if (patch.pass) changed.push('password')
      await audit(env, 'user.updated', {
        ...actor(c), userId: u.id, userName: u.name, changed,
        ...(changed.includes('role') ? { oldRole: target?.role, newRole: u.role } : {}),
        ...(changed.includes('active') ? { active: !!u.active } : {}),
        sessionsRevoked: revoked,
      })
    }
    return u ? c.json({ user: u }) : c.json({ error: 'not found' }, 404)
  })

  // audit trail
  app.get('/audit', guardAny('users.manage', 'audit.read'), async c => {
    const rows = await env.secure.logsList('audit', 200)
    return c.json({ entries: rows.map((r: any) => ({ id: r.id, at: r.createdAt, ...r.data })) })
  })

  // ---------- settings & plugins ----------

  app.get('/settings', guard('settings.write'), async c => {
    const raw = tryJson(await env.driver.readText('site/site.json'), {})
    return c.json({ settings: raw, effective: await env.site() })
  })
  app.put('/settings', guard('settings.write'), async c => {
    const body = await c.req.json()
    await env.content.saveSite(body.patch || {})
    await audit(env, 'settings.saved', { ...actor(c), keys: Object.keys(body.patch || {}) })
    env.invalidate()
    // Finish loading a newly chosen template's blocks BEFORE answering, so the
    // preview the studio reloads next already has them.
    if (body.patch && 'template' in body.patch) {
      await env.content.site()
      const { registerTemplateBlocks } = await import('../render/template-blocks.ts')
      await registerTemplateBlocks(env).catch(() => {})
    }
    notifyReload(env)
    return c.json({ settings: tryJson(await env.driver.readText('site/site.json'), {}) })
  })

  app.get('/plugins', guard('plugins.manage'), async c => {
    const site = await env.site()
    return c.json({
      plugins: [...env.registry.plugins.values()].map(m => ({
        ...m,
        state: site.plugins?.[m.id] || { enabled: false, approved: [] },
        // Is it actually running right now? A switch only takes effect on the
        // next restart, so the studio needs the truth, not the setting. (R15-2)
        running: env.registry.pluginsRunning?.has(m.id) ?? false,
        permissionInfo: Object.fromEntries(m.permissions.map(p => [p, PLUGIN_PERMISSION_INFO[p] || p])),
      })),
    })
  })
  app.patch('/plugins/:id', guard('plugins.manage'), async c => {
    const pid = c.req.param('id')
    if (!env.registry.plugins.has(pid)) return c.json({ error: 'unknown plugin' }, 404)
    const body = await c.req.json()
    const site = await env.site()
    const plugins = deepClone(site.plugins || {})
    plugins[pid] = {
      enabled: !!body.enabled,
      approved: Array.isArray(body.approved) ? body.approved : plugins[pid]?.approved || [],
      settings: plugins[pid]?.settings,
    }
    await env.content.saveSite({ plugins } as any)
    await audit(env, 'plugin.toggled', { ...actor(c), id: pid, name: env.registry.plugins.get(pid)?.name, enabled: !!body.enabled })
    return c.json({ ok: true, restartRequired: true })
  })

  // ---------- generic plugin resources (auto CRUD from ResourceDef) ----------

  app.all('/res/:plugin/:key/:rid?', async c => {
    const u = user(c)
    const pid = c.req.param('plugin'), key = c.req.param('key'), rid = c.req.param('rid')
    const entry = env.registry.resources.get(`${pid}/${key}`)
    if (!entry) return c.json({ error: 'unknown resource' }, 404)
    const def = entry.def
    const perm = (c.req.method === 'GET' ? def.readPerm : def.writePerm) || `plugin:${pid}.manage`
    if (!can(u, perm)) return c.json({ error: `permission required: ${perm}` }, u ? 403 : 401)

    const computedApply = (data: any) => {
      for (const fdef of def.fields) {
        if (fdef.computed) {
          try { data[fdef.key] = evaluate(fdef.computed, data) } catch { data[fdef.key] = null }
        }
      }
      return data
    }

    if (def.storage === 'json') {
      const dir = `site/${pid}/${key}`
      if (c.req.method === 'GET' && !rid) {
        const keys = await env.driver.list(dir)
        const items = []
        for (const k of keys.filter(k2 => k2.endsWith('.json'))) {
          const v = tryJson(await env.driver.readText(k), null)
          if (v) items.push(v)
        }
        return c.json({ items })
      }
      if (c.req.method === 'GET') return c.json({ item: tryJson(await env.driver.readText(`${dir}/${safe(rid!)}.json`), null) })
      if (c.req.method === 'POST') {
        const body = await c.req.json()
        const item = computedApply({ id: body.id || slugify(body[def.titleField || 'label'] || '') || id('x'), ...body })
        await env.driver.write(`${dir}/${safe(item.id)}.json`, stringify(item))
        env.events.emitBg(`${pid}.${key}.saved`, { id: item.id }, env.waitUntil)
        return c.json({ item })
      }
      if (c.req.method === 'PUT' && rid) {
        const item = computedApply({ ...(await c.req.json()), id: rid })
        await env.driver.write(`${dir}/${safe(rid)}.json`, stringify(item))
        env.events.emitBg(`${pid}.${key}.saved`, { id: rid }, env.waitUntil)
        return c.json({ item })
      }
      if (c.req.method === 'DELETE' && rid) {
        await env.driver.delete(`${dir}/${safe(rid)}.json`)
        return c.json({ ok: true })
      }
    } else {
      const tk = `${pid}:${key}`
      if (c.req.method === 'GET' && !rid) return c.json({ items: await env.secure.rowsList(tk) })
      if (c.req.method === 'GET') return c.json({ item: await env.secure.rowGet(tk, rid!) })
      if (c.req.method === 'POST') {
        const data = computedApply(await c.req.json())
        const newId = await env.secure.rowInsert(tk, data)
        env.events.emitBg(`${pid}.${key}.created`, { id: newId, data }, env.waitUntil)
        return c.json({ item: { id: newId, ...data } })
      }
      if (c.req.method === 'PUT' && rid) {
        const { id: _i, createdAt: _c2, updatedAt: _u, ...data } = computedApply(await c.req.json())
        await env.secure.rowUpdate(tk, rid, data)
        return c.json({ item: { id: rid, ...data } })
      }
      if (c.req.method === 'DELETE' && rid) { await env.secure.rowDelete(tk, rid); return c.json({ ok: true }) }
    }
    return c.json({ error: 'unsupported' }, 405)
  })

  // ---------- dynamic help ----------

  app.get('/help', guard('content.read'), async c => {
    const { buildHelp } = await import('./help.ts')
    return c.json(await buildHelp(env, c.req.query('topic')))
  })
  app.get('/help/tips', guard('content.read'), async c => {
    const { contextTips } = await import('./help.ts')
    return c.json(await contextTips(env, c.req.query('panel') || ''))
  })

  // ---------- seo tools ----------

  app.get('/seo/audit', guard('seo.tools'), async c => {
    const site = await env.site()
    const docs = await env.content.listDocs()
    const concepts = await env.content.concepts()
    const knownPaths = new Set<string>(['/'])
    for (const d of docs) knownPaths.add(await env.content.docPath(d))
    for (const cc of concepts) if (cc.indexPath) knownPaths.add(cc.indexPath)

    const out = []
    for (const d of docs) {
      const checks = analyzeSeo(d, site, await seoOpts(env, d))
      // collect internal links from blocks (link props + markdown)
      const links: string[] = []
      const walk = (blocks: any[]) => {
        for (const b of blocks || []) {
          for (const v of Object.values(b.props || {})) {
            if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).href) links.push(String((v as any).href))
            if (Array.isArray(v)) for (const item of v) if (item?.link?.href) links.push(String(item.link.href))
          }
          if (b.props?.md) for (const m of String(b.props.md).matchAll(/\]\((\/[^)\s#]+)/g)) links.push(m[1])
          walk(b.children)
        }
      }
      walk(d.blocks)
      const broken = [...new Set(links)]
        .filter(l => l.startsWith('/') && !l.startsWith('/media') && !l.startsWith('/assets') && !l.startsWith('/admin') && !l.startsWith('/x/'))
        .filter(l => !knownPaths.has(l.replace(/\/$/, '') || '/') && !knownPaths.has(l.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'))
      if (broken.length) checks.push({ level: 'error', label: `${broken.length} broken internal link${broken.length > 1 ? 's' : ''}`, detail: broken.join(' · ') })
      out.push({
        id: d.id, title: d.title, path: await env.content.docPath(d), status: d.status, concept: d.concept,
        errors: checks.filter(x => x.level === 'error').length,
        warns: checks.filter(x => x.level === 'warn').length,
        oks: checks.filter(x => x.level === 'ok').length,
        issues: checks.filter(x => x.level !== 'ok'),
      })
    }
    out.sort((a, b) => (b.errors * 10 + b.warns) - (a.errors * 10 + a.warns))
    return c.json({ docs: out, total: docs.length })
  })

  app.get('/redirects', guard('seo.tools'), async c => c.json({ redirects: await env.content.redirects() }))
  app.put('/redirects', guard('seo.tools'), async c => {
    const body = await c.req.json()
    if (!Array.isArray(body.redirects)) return c.json({ error: 'redirects[] required' }, 400)
    const clean = body.redirects
      .filter((r: any) => r.from && r.to)
      .map((r: any) => ({ from: String(r.from), to: String(r.to), code: r.code === 302 ? 302 : 301 }))
    await env.content.saveRedirects(clean)
    notifyReload(env)
    return c.json({ redirects: clean })
  })

  // ---------- export ----------

  // ---------- autocomplete suggestions ----------
  // src = concept:<name>.<fieldKey> | table:<tableId>.<fieldKey> | title:<concept>
  app.get('/suggest', guard('content.read'), async c => {
    const src = String(c.req.query('src') || '')
    const values = new Set<string>()
    const push = (v: any) => { if (v != null && v !== '' && values.size < 60) values.add(String(v)) }
    let m
    if ((m = /^concept:([a-z0-9-]+)\.([\w-]+)$/.exec(src))) {
      for (const d of await env.content.listDocs(m[1])) push((d.fields as any)?.[m[2]])
    } else if ((m = /^title:([a-z0-9-]+)$/.exec(src))) {
      for (const d of await env.content.listDocs(m[1])) push(d.title)
    } else if ((m = /^table:([\w-]+)\.([\w-]+)$/.exec(src))) {
      const rows = await env.secure.rowsList(`data:t:${m[1]}`, 500).catch(() => [])
      for (const r of rows as any[]) push((r.data || r)[m[2]])
    }
    return c.json({ values: [...values].sort() })
  })

  // ---------- bulk import (CSV rows parsed client-side) ----------
  app.post('/content/bulk', guard('content.write'), async c => {
    const { concept, docs } = await c.req.json()
    if (!(await env.content.concept(concept))) return c.json({ error: 'unknown concept' }, 400)
    if (!Array.isArray(docs) || !docs.length) return c.json({ error: 'no rows' }, 400)
    if (docs.length > 500) return c.json({ error: 'max 500 rows per import' }, 400)
    let created = 0
    for (const row of docs) {
      if (!row?.title) continue
      await env.content.createDoc({ concept, title: String(row.title), slug: row.slug, fields: row.fields || {} }, user(c)!.id)
      created++
    }
    env.invalidate()
    return c.json({ ok: true, created })
  })

  // ---------- template files (layered editing — overrides only) ----------
  // Editing writes to site/overrides/<rel>; built-ins are never touched, and a
  // per-file Revert is just deleting the override.

  const TPL_EDITABLE = /\.(liquid|css|js|json|svg)$/

  app.get('/templates/tree', guard('settings.write'), async c => {
    const site = await env.site()
    const files = new Map<string, { rel: string; layer: 'override' | 'site' | 'builtin'; overridden: boolean }>()
    const overrides = new Set((await env.driver.list('site/overrides')).map(k => k.slice('site/overrides/'.length)))
    const add = (rel: string, layer: 'site' | 'builtin') => {
      if (!TPL_EDITABLE.test(rel)) return
      if (!files.has(rel)) files.set(rel, { rel, layer, overridden: overrides.has(rel) })
    }
    for (const k of await env.driver.list(`templates/${site.template}`)) add(k.slice(`templates/${site.template}/`.length), 'site')
    for (const k of await env.templatesDriver.list(site.template)) add(k.slice(site.template.length + 1), 'builtin')
    for (const rel of overrides) {
      if (TPL_EDITABLE.test(rel) && !files.has(rel)) files.set(rel, { rel, layer: 'override', overridden: true })
    }
    return c.json({ template: site.template, files: [...files.values()].sort((a, b) => a.rel.localeCompare(b.rel)) })
  })

  app.get('/templates/file', guard('settings.write'), async c => {
    const rel = String(c.req.query('rel') || '')
    if (rel.includes('..') || !TPL_EDITABLE.test(rel)) return c.json({ error: 'bad path' }, 400)
    const override = await env.driver.readText(`site/overrides/${rel}`)
    const base = await env.resolver.readText(rel)
    return c.json({ rel, content: override ?? base ?? '', overridden: override != null, baseContent: base ?? '' })
  })

  app.put('/templates/file', guard('settings.write'), async c => {
    const { rel, content } = await c.req.json()
    if (!rel || String(rel).includes('..') || !TPL_EDITABLE.test(rel)) return c.json({ error: 'bad path' }, 400)
    await env.driver.write(`site/overrides/${rel}`, String(content ?? ''))
    env.invalidate()
    notifyReload(env)
    await audit(env, 'template.override', { rel, by: user(c)!.id })
    return c.json({ ok: true })
  })

  app.delete('/templates/file', guard('settings.write'), async c => {
    const rel = String(c.req.query('rel') || '')
    if (rel.includes('..')) return c.json({ error: 'bad path' }, 400)
    await env.driver.delete(`site/overrides/${rel}`)
    env.invalidate()
    notifyReload(env)
    return c.json({ ok: true })
  })

  // tail the error log (Settings → Security)
  app.get('/logs/errors', guard('settings.write'), async c => {
    const dir = (env as any).projectDir
    if (!dir) return c.json({ lines: [], note: 'no filesystem project' })
    try {
      const { readFileSync } = await import('node:fs')
      const raw = readFileSync(`${dir}/.blockhouse/logs/error.log`, 'utf8')
      const lines = raw.trim().split('\n').slice(-100).map(l => tryJson(l, { raw: l }))
      return c.json({ lines: lines.reverse() })
    } catch { return c.json({ lines: [] }) }
  })
  app.delete('/logs/errors', guard('settings.write'), async c => {
    const dir = (env as any).projectDir
    if (dir) { const { writeFileSync } = await import('node:fs'); try { writeFileSync(`${dir}/.blockhouse/logs/error.log`, '') } catch {} }
    return c.json({ ok: true })
  })

  // security self-probe: fetch our own public URL for paths that must 404.
  // Run it against the *deployed* domain to catch reverse-proxy mistakes.
  app.post('/security/probe', guard('settings.write'), async c => {
    const site = await env.site()
    const base = String((await c.req.json()).url || site.url).replace(/\/$/, '')
    const paths = ['/.blockhouse/secret', '/.blockhouse/secure.db', '/site/site.json', '/site/content/page/home.json', '/media/private/x', '/.git/config', '/.env']
    const results = []
    for (const p of paths) {
      try {
        const r = await fetch(base + p, { redirect: 'manual' })
        results.push({ path: p, status: r.status, ok: r.status === 404 || r.status === 403 || (r.status >= 300 && r.status < 400) })
      } catch (e: any) { results.push({ path: p, status: 0, ok: false, error: String(e?.message || e).slice(0, 80) }) }
    }
    const exposed = results.filter(r => !r.ok)
    return c.json({ base, results, ok: exposed.length === 0, advice: exposed.length ? 'Something answered 200 where it must not. If a reverse proxy or object store serves the project folder directly, block these paths (nginx: location ~ /\\.(blockhouse|git) { deny all; } · Cloudflare: a WAF rule matching the paths above).' : 'Nothing sensitive is reachable from that URL.' })
  })

  // Shareable staging bypass link — see security.previewToken in site.ts.
  // Generates once, rotates on demand; PUT /settings already goes through
  // env.invalidate() via saveSite, so this takes effect immediately, no
  // restart needed (unlike a token set by hand-editing site.json on disk).
  app.post('/security/preview-link', guard('settings.write'), async c => {
    const token = randomToken(20)
    await env.content.saveSite({ security: { ...(await env.site()).security, previewToken: token } })
    env.invalidate()
    return c.json({ token })
  })

  // send the signed-in admin a test email through the configured driver
  app.post('/mail/test', guard('settings.write'), async c => {
    const u = user(c)!
    const site = await env.site()
    try {
      const { sendMail } = await import('./env.ts')
      await sendMail(env, { to: u.email, subject: `Test from ${site.name}`, text: `Mail works. Driver: ${site.mail?.driver || 'console'} · sent ${new Date().toISOString()}` })
      return c.json({ ok: true, to: u.email })
    } catch (e: any) { return c.json({ ok: false, error: String(e?.message || e) }, 502) }
  })

  // ---------- packages: themes & plugins with checksums + licences ----------
  // A blockhouse package is a zip carrying blockhouse-package.json: {name, kind:
  // 'template'|'plugin', version, author, license, files: {rel: sha256},
  // issuer?, signature?}. Checksums verify integrity; an Ed25519 signature
  // from a trusted issuer (security.trustedIssuers) verifies origin — the
  // foundation for buying/selling themes and plugins with licence keys.

  const PKG_META = 'packages'   // secure kv namespace: install records + licence keys

  app.get('/themes', guard('settings.write'), async c => {
    const site = await env.site()
    const names = new Set<string>()
    for (const k of await env.templatesDriver.list('')) { const top = k.split('/')[0]; if (top) names.add(top) }
    const local = new Set<string>()
    for (const k of await env.driver.list('templates')) { const top = k.slice('templates/'.length).split('/')[0]; if (top) { names.add(top); local.add(top) } }
    const themes = []
    for (const name of [...names].sort()) {
      const metaRaw = local.has(name)
        ? await env.driver.readText(`templates/${name}/template.json`)
        : await env.templatesDriver.readText(`${name}/template.json`)
      // A theme is a directory with a template.json manifest. Loose files that
      // happen to sit beside the theme directories (LICENSE, README) are not
      // themes and have no business in the Design page's list.
      if (metaRaw == null) continue
      const record = await env.secure.kvGet(PKG_META, `template:${name}`, null)
      themes.push({
        name, source: local.has(name) ? 'installed' : 'built-in',
        active: site.template === name,
        meta: tryJson(metaRaw, {}),
        pkg: record ? { version: record.version, author: record.author, license: record.license, licenseKey: record.licenseKey ? '••••••' : '', verified: record.signatureValid, installedAt: record.installedAt } : null,
      })
    }
    return c.json({ themes })
  })

  async function installPackage(c: any, kind: 'template' | 'plugin') {
    const dir = (env as any).projectDir
    if (!dir) return c.json({ error: 'package install needs a filesystem project' }, 501)
    const form = await c.req.raw.formData().catch(() => null)
    const file = form?.get('file') as File | null
    if (!file) return c.json({ error: 'upload the package zip as "file"' }, 400)
    const licenseKey = String(form?.get('licenseKey') || '')
    const { unzip, checkPackage } = await import('../core/zip.ts')
    let entries
    try { entries = await unzip(new Uint8Array(await file.arrayBuffer())) } catch (e: any) { return c.json({ error: `not a readable zip: ${e.message}` }, 400) }
    const site = await env.site()
    const check = await checkPackage(entries, site.security?.trustedIssuers || {})
    if (check.manifest && check.manifest.kind && check.manifest.kind !== kind) {
      return c.json({ error: `this is a ${check.manifest.kind} package — install it under ${check.manifest.kind}s` }, 400)
    }
    const name = String(check.manifest?.name || file.name.replace(/\.zip$/i, '')).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!name || name === '-') return c.json({ error: 'package has no usable name' }, 400)
    const prefixEntry = entries.find(e => e.name.endsWith('blockhouse-package.json'))
    const prefix = prefixEntry && prefixEntry.name.includes('/') ? prefixEntry.name.slice(0, prefixEntry.name.lastIndexOf('/') + 1) : ''
    const targetBase = kind === 'template' ? `templates/${name}` : `plugins/${name}`
    const needed = kind === 'template' ? 'layout.liquid' : 'index.ts'
    const rels = entries.map(e => (e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name))
    if (!rels.includes(needed)) return c.json({ error: `a ${kind} package must contain ${needed}`, problems: check.problems }, 400)
    for (const e of entries) {
      const rel = e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name
      if (rel.includes('..') || rel.startsWith('/')) return c.json({ error: `unsafe path in package: ${rel}` }, 400)
      if (rel === 'blockhouse-package.json') continue
      await env.driver.write(`${targetBase}/${rel}`, e.data)
    }
    await env.secure.kvSet(PKG_META, `${kind}:${name}`, {
      name, kind, version: check.manifest?.version || '0.0.0', author: check.manifest?.author || '',
      license: check.manifest?.license || '', licenseKey: licenseKey || undefined,
      files: check.checksums, signatureValid: check.signatureValid, problems: check.problems,
      installedAt: new Date().toISOString(), by: user(c)!.id,
    })
    env.invalidate(); notifyReload(env)
    await audit(env, 'package.installed', { kind, name, verified: check.signatureValid, by: user(c)!.id })
    return c.json({ ok: true, name, verified: check.signatureValid, problems: check.problems, note: kind === 'plugin' ? 'restart the server to load the plugin, then approve its permissions' : undefined })
  }

  app.post('/themes/install', guard('settings.write'), c => installPackage(c, 'template'))
  app.post('/pluginpkgs/install', guard('plugins.manage'), c => installPackage(c, 'plugin'))

  app.post('/packages/:kind/:name/verify', guard('settings.write'), async c => {
    const kind = c.req.param('kind'), name = c.req.param('name')
    const record = await env.secure.kvGet(PKG_META, `${kind}:${name}`, null)
    if (!record?.files) return c.json({ error: 'no install record — this package was not installed from a zip' }, 404)
    const { sha256Hex } = await import('../core/zip.ts')
    const base = kind === 'template' ? `templates/${name}` : `plugins/${name}`
    const problems: string[] = []
    for (const [rel, want] of Object.entries(record.files as Record<string, string>)) {
      const data = await env.driver.read(`${base}/${rel}`)
      if (!data) problems.push(`missing: ${rel}`)
      else if (await sha256Hex(data) !== want) problems.push(`modified: ${rel}`)
    }
    return c.json({ ok: problems.length === 0, problems, checked: Object.keys(record.files).length })
  })

  app.delete('/themes/:name', guard('settings.write'), async c => {
    const name = c.req.param('name')
    const site = await env.site()
    if (site.template === name) return c.json({ error: 'this theme is active — switch templates first' }, 400)
    const keys = await env.driver.list(`templates/${name}`)
    if (!keys.length) return c.json({ error: 'not an installed theme (built-ins cannot be deleted)' }, 404)
    for (const k of keys) await env.driver.delete(k)
    await env.secure.kvSet(PKG_META, `template:${name}`, null)
    env.invalidate()
    return c.json({ ok: true })
  })

  // unsaved-draft buffer backing the IDE's live preview (?__tplpreview=1)
  app.put('/templates/draft', guard('settings.write'), async c => {
    const { rel, content } = await c.req.json()
    if (!rel || String(rel).includes('..') || !TPL_EDITABLE.test(rel)) return c.json({ error: 'bad path' }, 400)
    const drafts: Map<string, string> = ((env as any).tplDrafts ??= new Map())
    if (content == null) drafts.delete(rel)
    else drafts.set(rel, String(content))
    return c.json({ ok: true, drafts: drafts.size })
  })
  app.delete('/templates/draft', guard('settings.write'), async c => {
    ;((env as any).tplDrafts as Map<string, string> | undefined)?.clear()
    return c.json({ ok: true })
  })

  // page templates available for the current theme — feeds the pickers
  app.get('/templates/pages', guard('content.read'), async c => {
    const names = new Set<string>()
    for (const rel of await env.resolver.list('pages')) {
      const m = /^pages\/([a-z0-9-]+)\.liquid$/.exec(rel)
      if (m) names.add(m[1])
    }
    return c.json({ pages: [...names].sort() })
  })

  // cross-reference map for the IDE and the chrome editor: for every template
  // file, which partials it includes, who includes it, which slots/regions/
  // menus it renders — so "what uses this?" is always one call away.
  app.get('/templates/refs', guard('settings.write'), async c => {
    const site = await env.site()
    const rels = new Set<string>()
    for (const k of await env.templatesDriver.list(site.template)) rels.add(k.slice(site.template.length + 1))
    for (const k of await env.driver.list(`templates/${site.template}`)) rels.add(k.slice(`templates/${site.template}/`.length))
    for (const k of await env.driver.list('site/overrides')) rels.add(k.slice('site/overrides/'.length))
    const files: Record<string, { includes: string[]; includedBy: string[]; slots: string[]; regions: string[]; menus: string[] }> = {}
    const read = async (rel: string) => (await env.driver.readText(`site/overrides/${rel}`)) ?? (await env.resolver.readText(rel)) ?? ''
    for (const rel of rels) {
      if (!/\.liquid$/.test(rel)) continue
      const src = await read(rel)
      files[rel] = {
        includes: [...src.matchAll(/\{%\s*include\s+'([^']+)'/g)].map(m => `${m[1]}.liquid`),
        includedBy: [],
        slots: [...src.matchAll(/\{%\s*slot\s+'([^']+)'/g)].map(m => m[1]),
        regions: [...src.matchAll(/\{%\s*region\s+'([^']+)'/g)].map(m => m[1]),
        menus: [...src.matchAll(/\{%\s*menu\s+'([^']+)'/g)].map(m => m[1]),
      }
    }
    for (const [rel, info] of Object.entries(files)) {
      for (const inc of info.includes) if (files[inc]) files[inc].includedBy.push(rel)
    }
    return c.json({ template: site.template, files })
  })

  // ---------- site chrome (slot content — header/footer extras) ----------
  // Slots are template insertion points ({% slot 'footer.social' %}) filled
  // with blocks from site.slots. This is where "that link in the footer"
  // actually lives, so the studio must make it editable.

  app.get('/chrome', guard('settings.write'), async c => {
    const site = await env.site()
    const discovered: { key: string; file: string }[] = []
    const seen = new Set<string>()
    const scan = async (rel: string) => {
      const src = (await env.driver.readText(`site/overrides/${rel}`)) ?? (await env.resolver.readText(rel)) ?? ''
      for (const m of src.matchAll(/\{%\s*slot\s+'([^']+)'/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); discovered.push({ key: m[1], file: rel }) }
      }
    }
    await scan('layout.liquid')
    for (const rel of await env.resolver.list('partials')) if (rel.endsWith('.liquid')) await scan(rel)
    for (const key of Object.keys(site.slots || {})) {
      if (!seen.has(key)) { seen.add(key); discovered.push({ key, file: '(not in current template)' }) }
    }
    return c.json({ slots: site.slots || {}, discovered })
  })

  app.put('/chrome', guard('settings.write'), async c => {
    const { slots } = await c.req.json()
    if (!slots || typeof slots !== 'object') return c.json({ error: 'slots object required' }, 400)
    await env.content.saveSite({ slots })
    env.invalidate()
    notifyReload(env)
    await audit(env, 'chrome.saved', { ...actor(c), keys: Object.keys(slots) })
    return c.json({ ok: true })
  })

  // ---------- ops: diagnostics + page weight ----------

  app.get('/doctor', guardAny('settings.write', 'deploy.export'), async c => {
    const { doctor } = await import('../cli/doctor.ts')
    const dir = (env as any).projectDir
    if (!dir) return c.json({ error: 'diagnostics need a filesystem project (not available on Workers)' }, 501)
    const checks = await doctor(env, dir, { target: c.req.query('target') || 'server', deep: c.req.query('deep') === '1' })
    return c.json({
      checks, env: env.envName,
      summary: {
        fail: checks.filter(x => x.level === 'fail').length,
        warn: checks.filter(x => x.level === 'warn').length,
        ok: checks.filter(x => x.level === 'ok').length,
      },
    })
  })

  app.get('/budget', guardAny('settings.write', 'deploy.export'), async c => {
    const { measureSite } = await import('../export/budget.ts')
    return c.json(await measureSite(env))
  })

  app.get('/deploy/preset/:target', guardAny('settings.write', 'deploy.export'), async c => {
    const { deployInit, TARGETS } = await import('../cli/deploy-init.ts')
    const target = c.req.param('target') as any
    if (!TARGETS.includes(target)) return c.json({ error: 'unknown target' }, 400)
    const dir = (env as any).projectDir
    if (!dir) return c.json({ error: 'writing deploy files needs a filesystem project' }, 501)
    const written = deployInit(dir, target, await env.site(), { force: c.req.query('force') === '1' })
    return c.json({ written })
  })

  // ---------- deploy targets: saved profiles with encrypted credentials ----------
  // kinds: export (build only) · hook (POST a deploy/build webhook) · command
  // (owner-only shell). target: staging builds drafts too; production publishes.

  const PROFILE_NS = 'deployprofiles'
  const ROLE_RANK: Record<string, number> = { viewer: 0, author: 1, editor: 2, admin: 3, owner: 4 }
  const roleOk = (u: User, min: string) => (ROLE_RANK[u.role] ?? 0) >= (ROLE_RANK[min] ?? 3)

  const maskProfile = (p2: any) => ({
    ...p2,
    url: p2.url ? '••••••••' : '',
    command: p2.command ? '••••••••' : '',
  })

  async function loadProfiles(): Promise<any[]> {
    return env.secure.kvGet(PROFILE_NS, 'all', [])
  }

  app.get('/deploy/profiles', guardAny('settings.write', 'deploy.export'), async c => {
    const profiles = await loadProfiles()
    return c.json({ profiles: profiles.map(maskProfile) })
  })

  app.put('/deploy/profiles/:id', guard('settings.write'), async c => {
    const body = (await c.req.json()).profile || {}
    const idp = c.req.param('id')
    if (!/^[a-z0-9-]+$/.test(idp)) return c.json({ error: 'bad id' }, 400)
    if (body.kind === 'command' && user(c)!.role !== 'owner') return c.json({ error: 'command profiles are owner-only' }, 403)
    const profiles = await loadProfiles()
    const existing = profiles.find(p2 => p2.id === idp) || {}
    const next: any = {
      id: idp,
      label: body.label || idp,
      kind: ['export', 'hook', 'command'].includes(body.kind) ? body.kind : 'export',
      target: ['staging', 'production'].includes(body.target) ? body.target : 'production',
      outDir: String(body.outDir || 'dist').replace(/[^\w./-]/g, ''),
      minRole: ['editor', 'admin', 'owner'].includes(body.minRole) ? body.minRole : 'admin',
      url: existing.url, command: existing.command,
    }
    // secrets: keep when masked/blank, seal when provided
    if (body.url && body.url !== '••••••••') next.url = await sealSecret(env.secret, String(body.url))
    if (body.command && body.command !== '••••••••') next.command = await sealSecret(env.secret, String(body.command))
    const out = profiles.filter(p2 => p2.id !== idp).concat([next])
    await env.secure.kvSet(PROFILE_NS, 'all', out)
    await audit(env, 'deploy.profile.saved', { id: idp, kind: next.kind, target: next.target, by: user(c)!.id })
    return c.json({ ok: true })
  })

  app.delete('/deploy/profiles/:id', guard('settings.write'), async c => {
    const profiles = await loadProfiles()
    await env.secure.kvSet(PROFILE_NS, 'all', profiles.filter(p2 => p2.id !== c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/deploy/profiles/:id/test', guard('settings.write'), async c => {
    const p2 = (await loadProfiles()).find(x => x.id === c.req.param('id'))
    if (!p2) return c.json({ error: 'not found' }, 404)
    try {
      if (p2.kind === 'hook') {
        const url = await openSecret(env.secret, p2.url || '')
        if (!url) return c.json({ ok: false, detail: 'no URL stored (or the site secret changed)' })
        const res = await fetch(url, { method: 'HEAD' }).catch(() => fetch(url, { method: 'OPTIONS' }))
        return c.json({ ok: res.status < 500, detail: `endpoint answered ${res.status}` })
      }
      if (p2.kind === 'command') {
        const cmd = await openSecret(env.secret, p2.command || '')
        if (!cmd) return c.json({ ok: false, detail: 'no command stored (or the site secret changed)' })
        return c.json({ ok: true, detail: `would run: ${cmd.slice(0, 60)}${cmd.length > 60 ? '…' : ''} (dry)` })
      }
      return c.json({ ok: true, detail: `exports to ${p2.outDir}` })
    } catch (e: any) { return c.json({ ok: false, detail: String(e?.message || e) }) }
  })

  app.post('/deploy/run/:id', async c => {
    const u = user(c)
    if (!u) return c.json({ error: 'auth required' }, 401)
    const p2 = (await loadProfiles()).find(x => x.id === c.req.param('id'))
    if (!p2) return c.json({ error: 'not found' }, 404)
    if (!roleOk(u, p2.minRole || 'admin')) return c.json({ error: `requires ${p2.minRole} or above` }, 403)

    const log: string[] = []
    const started = Date.now()
    const { exportStatic } = await import('../export/static.ts')
    const stage = p2.target === 'staging'
    const outDir = (env as any).projectDir ? `${(env as any).projectDir}/${p2.outDir || 'dist'}${stage ? '-staging' : ''}` : (p2.outDir || 'dist')
    const res = await exportStatic(env, { outDir, stage })
    log.push(`exported ${res.pages} pages, ${res.assets} assets → ${outDir}${stage ? ' (staging: drafts included)' : ''}`)

    if (p2.kind === 'hook') {
      const url = await openSecret(env.secret, p2.url || '')
      if (!url) return c.json({ error: 'no URL stored', log }, 400)
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'blockhouse', target: p2.target, at: new Date().toISOString() }) })
      log.push(`deploy hook → ${r.status} ${r.statusText}`)
      if (!r.ok) return c.json({ ok: false, log }, 502)
    } else if (p2.kind === 'command') {
      if (u.role !== 'owner') return c.json({ error: 'command deploys are owner-only', log }, 403)
      const cmd = await openSecret(env.secret, p2.command || '')
      if (!cmd) return c.json({ error: 'no command stored', log }, 400)
      const bun = (globalThis as any).Bun
      if (!bun) return c.json({ error: 'command deploys need the Bun runtime', log }, 501)
      const proc = bun.spawn(['sh', '-c', cmd], {
        cwd: (env as any).projectDir, stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, BLOCKHOUSE_TARGET: p2.target, BLOCKHOUSE_OUT: outDir },
      })
      const [out, errT, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      for (const line of (out + errT).trim().split('\n').slice(-20)) if (line) log.push(line)
      log.push(`command exited ${code}`)
      if (code !== 0) return c.json({ ok: false, log }, 500)
    }
    await audit(env, 'deploy.run', { id: p2.id, target: p2.target, by: u.id, ms: Date.now() - started })
    log.push(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return c.json({ ok: true, log })
  })

  app.post('/export', guardAny('settings.write', 'deploy.export'), async c => {
    const { exportStatic } = await import('../export/static.ts')
    const res = await exportStatic(env, { outDir: 'dist' })
    await audit(env, 'export.run', { outDir: res.outDir, pages: res.pages, assets: res.assets, by: user(c)!.id })
    return c.json(res)
  })

  // plugin admin API routes (session + plugin permission guard)
  for (const { pid, fn } of env.pluginRoutes.api) {
    const sub = new Hono()
    sub.use('*', guard(`plugin:${pid}.manage`))
    fn(sub)
    app.route(`/x/${pid}`, sub)
  }

  return app
}

function safe(s: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('invalid id')
  return s
}

/** Member groups, if the members plugin is installed — used to populate page access pickers. */
async function listMemberGroups(env: BlockhouseEnv): Promise<{ id: string; label: string }[]> {
  if (!env.registry.resources.get('members/groups')) return []
  try {
    const keys = await env.driver.list('site/members/groups')
    const out: { id: string; label: string }[] = []
    for (const k of keys.filter(k2 => k2.endsWith('.json'))) {
      const v: any = tryJson(await env.driver.readText(k), null)
      if (v?.id) out.push({ id: v.id, label: v.label || v.id })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  } catch { return [] }
}

export function notifyReload(env: BlockhouseEnv) {
  for (const fn of env.reloadHooks) { try { fn() } catch {} }
}
