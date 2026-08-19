// Cookie sessions: HttpOnly signed cookie carrying a server-side session id,
// plus a readable CSRF cookie checked as a header on mutating admin requests.

import type { Context, Handler as MiddlewareHandler } from '../vendor/http.ts'
import { getCookie, setCookie, deleteCookie } from '../vendor/http.ts'
import { hmacSign, randomToken, timingSafeEqual } from '../core/util.ts'
import type { BlockhouseEnv } from '../server/env.ts'

const SESSION_COOKIE = 'blockhouse_s'
const CSRF_COOKIE = 'blockhouse_c'

export async function signValue(secret: string, v: string): Promise<string> {
  return `${v}.${await hmacSign(secret, v)}`
}
export async function unsignValue(secret: string, signed: string | undefined): Promise<string | null> {
  if (!signed) return null
  const i = signed.lastIndexOf('.')
  if (i < 1) return null
  const v = signed.slice(0, i)
  const sig = signed.slice(i + 1)
  return timingSafeEqual(sig, await hmacSign(secret, v)) ? v : null
}

export async function establishSession(c: Context, env: BlockhouseEnv, userId: string) {
  const session = await env.secure.createSession(userId, c.req.header('user-agent') || '')
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, await signValue(env.secret, session.id), {
    httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: 30 * 86400,
  })
  setCookie(c, CSRF_COOKIE, randomToken(16), { sameSite: 'Lax', path: '/', secure, maxAge: 30 * 86400 })
  return session
}

export async function destroySession(c: Context, env: BlockhouseEnv) {
  const sid = await unsignValue(env.secret, getCookie(c, SESSION_COOKIE))
  if (sid) await env.secure.deleteSession(sid)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
}

/** Attaches c.get('user') when a valid session cookie is present. */
export function sessionMiddleware(env: BlockhouseEnv): MiddlewareHandler {
  return async (c, next) => {
    const sid = await unsignValue(env.secret, getCookie(c, SESSION_COOKIE))
    if (sid) {
      const session = await env.secure.session(sid)
      if (session) {
        const user = await env.secure.userById(session.userId)
        if (user?.active) c.set('user', user)
      }
    }
    await next()
  }
}

/** CSRF double-submit check for mutating /api requests. */
export function csrfMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      // auth endpoints run before any CSRF cookie exists — same-origin check instead
      if (c.req.path.startsWith('/api/auth/')) {
        const origin = c.req.header('origin')
        if (origin && origin !== new URL(c.req.url).origin) {
          return c.json({ error: 'cross-origin request rejected' }, 403)
        }
        return next()
      }
      const cookie = getCookie(c, CSRF_COOKIE)
      const header = c.req.header('x-blockhouse-csrf')
      if (!cookie || !header || !timingSafeEqual(cookie, header)) {
        return c.json({ error: 'CSRF token mismatch' }, 403)
      }
    }
    await next()
  }
}

/** Same-origin check for anonymous public POSTs (forms, subscribe). */
export function sameOriginOnly(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (origin) {
      const reqOrigin = new URL(c.req.url).origin
      if (origin !== reqOrigin) return c.json({ error: 'cross-origin submission rejected' }, 403)
    }
    await next()
  }
}
