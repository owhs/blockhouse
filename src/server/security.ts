// Security hardening: response headers (CSP et al), brute-force lockout,
// admin network allowlist, and an append-only audit log.
//
// The CSP is generated to match what Blockhouse actually emits, so 'balanced' works
// out of the box (inline theme-boot + token styles are hashed/allowed), and
// 'strict' switches to nonces for the few inline scripts we control.

import type { Handler } from '../vendor/http.ts'
import type { SecurityConfig, SiteConfig } from '../core/types.ts'
import type { BlockhouseEnv } from './env.ts'
import { randomToken } from '../core/util.ts'

// ---------- headers ----------

export function buildCsp(site: SiteConfig, opts: { nonce?: string; admin?: boolean } = {}): string | null {
  const sec = site.security || {}
  if (sec.csp === 'off') return null

  const strict = sec.csp === 'strict'
  const scriptSrc = strict && opts.nonce
    ? `'self' 'nonce-${opts.nonce}'`
    : `'self' 'unsafe-inline'`   // balanced: our inline boot scripts are tiny + first-party

  const directives: Record<string, string> = {
    'default-src': "'self'",
    'base-uri': "'self'",
    'object-src': "'none'",
    'script-src': scriptSrc,
    'style-src': "'self' 'unsafe-inline'",     // token/theme styles are generated inline
    'img-src': "'self' data: blob: https:",
    'font-src': "'self' data:",
    'connect-src': "'self' https://nominatim.openstreetmap.org",   // the map block looks its address up
    'frame-src': "'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://open.spotify.com https://www.openstreetmap.org https://www.google.com/maps/",
    'frame-ancestors': opts.admin ? "'self'" : (sec.frameAncestors || "'none'"),
    'form-action': "'self'",
    'manifest-src': "'self'",
  }
  // the studio previews the site in an iframe, so admin pages allow self-framing
  if (opts.admin) directives['frame-src'] = "'self'"
  // Ahrefs Web Analytics loads its script from, and reports to, its own host.
  const ahrefs = site.plugins?.ahrefs as any
  if (ahrefs?.enabled && ahrefs.settings?.analyticsKey && ahrefs.settings?.loadAnalytics && !opts.admin) {
    directives['script-src'] += ' https://analytics.ahrefs.com'
    directives['connect-src'] += ' https://analytics.ahrefs.com'
  }

  for (const [k, v] of Object.entries(sec.cspExtra || {})) directives[k] = v
  return Object.entries(directives).map(([k, v]) => `${k} ${v}`).join('; ')
}

export function securityHeaders(site: SiteConfig, opts: { https: boolean; admin?: boolean; nonce?: string } = { https: false }): Record<string, string> {
  const sec: SecurityConfig = site.security || {}
  const h: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': sec.referrerPolicy || 'strict-origin-when-cross-origin',
    'x-frame-options': opts.admin ? 'SAMEORIGIN' : (sec.frameAncestors === "'none'" || !sec.frameAncestors ? 'DENY' : 'SAMEORIGIN'),
    'cross-origin-opener-policy': 'same-origin',
  }
  if (sec.permissionsPolicy) h['permissions-policy'] = sec.permissionsPolicy
  const csp = buildCsp(site, { nonce: opts.nonce, admin: opts.admin })
  if (csp) h['content-security-policy'] = csp
  if (sec.hsts && opts.https) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  if (opts.admin) h['x-robots-tag'] = 'noindex, nofollow'
  return h
}

/** Applies headers to every response; admin/API get stricter treatment. */
export function securityMiddleware(env: BlockhouseEnv): Handler {
  return async (c, next) => {
    await next()
    try {
      const site = await env.site()
      const url = new URL(c.req.url)
      const isAdmin = url.pathname.startsWith('/admin') || url.pathname.startsWith('/api') || url.pathname.startsWith('/preview')
      const headers = securityHeaders(site, { https: url.protocol === 'https:', admin: isAdmin })
      for (const [k, v] of Object.entries(headers)) c.resHeaders.set(k, v)
    } catch { /* never let hardening break a response */ }
  }
}

// ---------- admin network allowlist ----------

function ipMatches(ip: string, rule: string): boolean {
  if (!rule) return false
  if (rule === ip) return true
  if (rule.endsWith('*')) return ip.startsWith(rule.slice(0, -1))
  if (rule.includes('/')) {
    // simple IPv4 CIDR
    const [base, bitsStr] = rule.split('/')
    const bits = parseInt(bitsStr, 10)
    const toInt = (a: string) => a.split('.').reduce((t, o) => (t << 8) + (parseInt(o, 10) || 0), 0) >>> 0
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (toInt(ip) & mask) === (toInt(base) & mask)
  }
  return false
}

export function adminAllowlistMiddleware(env: BlockhouseEnv): Handler {
  return async (c, next) => {
    const site = await env.site()
    const list = site.security?.adminAllowlist || []
    if (!list.length) return next()
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith('/admin') && !url.pathname.startsWith('/api')) return next()
    if (url.pathname.startsWith('/api/auth/me')) return next()
    const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim() || '127.0.0.1'
    if (ip === '127.0.0.1' || ip === '::1' || list.some(r => ipMatches(ip, r))) return next()
    return c.json({ error: 'admin access is restricted from this network' }, 403)
  }
}

// ---------- brute-force protection ----------

interface Attempt { fails: number; until: number }
const attempts = new Map<string, Attempt>()

export function loginBlocked(key: string): number {
  const a = attempts.get(key)
  if (!a) return 0
  if (a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000)
  if (a.until && a.until <= Date.now()) attempts.delete(key)
  return 0
}

export function recordLoginFailure(key: string, sec: SecurityConfig) {
  const max = sec.maxLoginAttempts ?? 8
  const mins = sec.lockoutMinutes ?? 15
  const a = attempts.get(key) || { fails: 0, until: 0 }
  a.fails++
  if (a.fails >= max) { a.until = Date.now() + mins * 60_000; a.fails = 0 }
  attempts.set(key, a)
}

export function clearLoginFailures(key: string) { attempts.delete(key) }

// ---------- password policy ----------

export function checkPasswordPolicy(pw: string, sec: SecurityConfig): string | null {
  const min = sec.minPasswordLength ?? 8
  if (!pw || pw.length < min) return `Password must be at least ${min} characters`
  if (/^(password|12345678|qwerty|letmein|welcome)/i.test(pw)) return 'That password is too common'
  return null
}

// ---------- audit log ----------

export async function audit(env: BlockhouseEnv, action: string, detail: Record<string, any> = {}) {
  try {
    const site = await env.site()
    if (site.security?.auditLog === false) return
    await env.secure.log('audit', { action, ...detail, at: new Date().toISOString() })
  } catch { /* auditing must never break the request */ }
}

export function newNonce(): string { return randomToken(12) }
