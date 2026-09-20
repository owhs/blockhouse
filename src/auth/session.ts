// Cookie sessions: HttpOnly signed cookie carrying a server-side session id,
// plus a readable CSRF cookie checked as a header on mutating admin requests.

import type { Context, Handler as MiddlewareHandler } from '../vendor/http.ts'
import { getCookie, setCookie, deleteCookie } from '../vendor/http.ts'
import { hmacSign, randomToken, timingSafeEqual, sha256hex } from '../core/util.ts'
import type { BlockhouseEnv } from '../server/env.ts'

const SESSION_COOKIE = 'blockhouse_s'
const CSRF_COOKIE = 'blockhouse_c'

// Two sites on the same host (localhost:8792 and localhost:8793, which is what
// `blockhouse sites add --port` gives you) share a cookie jar: cookies are not
// scoped by port. With one fixed name, signing into the second site overwrote
// the first site's session cookie and silently signed you out of it. A short
// stable suffix derived from the project secret keeps the two apart, while the
// unchanged prefix keeps the client-side CSRF lookup a simple prefix match.
const suffixCache = new Map<string, string>()
async function siteSuffix(secret: string): Promise<string> {
  let s = suffixCache.get(secret)
  if (!s) { s = (await sha256hex(secret)).slice(0, 6); suffixCache.set(secret, s) }
  return s
}
/** Per-site cookie names: `blockhouse_s_<6 hex>` / `blockhouse_c_<6 hex>`. */
export async function cookieNames(secret: string): Promise<{ session: string; csrf: string }> {
  const s = await siteSuffix(secret)
  return { session: `${SESSION_COOKIE}_${s}`, csrf: `${CSRF_COOKIE}_${s}` }
}

// Behind a reverse proxy (Cloudflare Tunnel, nginx — see `blockhouse deploy:init`,
// which sets this header for exactly this reason), the request Bun actually sees
// is plain HTTP: TLS was terminated upstream. Trusting X-Forwarded-Proto when
// present is what makes `new URL(c.req.url)` reflect what the browser really
// connected over, instead of silently reporting "http:" for every https:// site.
function isSecureRequest(c: Context): boolean {
  const xfp = c.req.header('x-forwarded-proto')
  if (xfp) return xfp.split(',')[0].trim().toLowerCase() === 'https'
  return new URL(c.req.url).protocol === 'https:'
}

function requestOrigin(c: Context): string {
  const url = new URL(c.req.url)
  url.protocol = isSecureRequest(c) ? 'https:' : 'http:'
  return url.origin
}

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
  const secure = isSecureRequest(c)
  const names = await cookieNames(env.secret)
  setCookie(c, names.session, await signValue(env.secret, session.id), {
    httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: 30 * 86400,
  })
  setCookie(c, names.csrf, randomToken(16), { sameSite: 'Lax', path: '/', secure, maxAge: 30 * 86400 })
  return session
}

export async function destroySession(c: Context, env: BlockhouseEnv) {
  const names = await cookieNames(env.secret)
  const sid = await unsignValue(env.secret, getCookie(c, names.session))
  if (sid) await env.secure.deleteSession(sid)
  deleteCookie(c, names.session, { path: '/' })
  deleteCookie(c, names.csrf, { path: '/' })
}

/** Attaches c.get('user') when a valid session cookie is present. */
export function sessionMiddleware(env: BlockhouseEnv): MiddlewareHandler {
  return async (c, next) => {
    const sid = await unsignValue(env.secret, getCookie(c, (await cookieNames(env.secret)).session))
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
export function csrfMiddleware(env: BlockhouseEnv): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      // auth endpoints run before any CSRF cookie exists — same-origin check instead
      if (c.req.path.startsWith('/api/auth/')) {
        const origin = c.req.header('origin')
        if (origin && origin !== requestOrigin(c)) {
          return c.json({ error: 'cross-origin request rejected' }, 403)
        }
        return next()
      }
      const cookie = getCookie(c, (await cookieNames(env.secret)).csrf)
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
    if (origin && origin !== requestOrigin(c)) {
      return c.json({ error: 'cross-origin submission rejected' }, 403)
    }
    await next()
  }
}
