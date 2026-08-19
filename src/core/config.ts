// Site configuration: site/site.json merged over sensible defaults, then over
// environment overrides (BLOCKHOUSE_* vars) so the same project runs unchanged across
// local dev, a staging box, production and Cloudflare.

import type { SiteConfig } from './types.ts'
import { deepMerge } from './util.ts'

export const DEFAULT_CONFIG: SiteConfig = {
  name: 'Untitled site',
  url: 'http://localhost:8787',
  language: 'en',
  template: 'aurora',
  seo: {
    titlePattern: '{title} — {site}',
    robots: 'index,follow',
  },
  images: {
    provider: 'local',
    sizes: [320, 640, 960, 1280, 1920],
    formats: ['webp', 'original'],
    quality: 82,
    stripExif: true,
    renamePattern: '{slug}-{w}',
    watermark: null,
  },
  theme: { tokens: {}, colorScheme: 'auto', showToggle: true },
  vars: {},
  varDefs: [],
  urls: { style: 'directory', layout: 'pattern', lowercase: true, shortlinks: false, shortlinkPrefix: 's' },
  modules: { hidden: [], hiddenForRole: {} },
  build: { trailingSlash: true, minify: false, generateSearchIndex: true },
  slots: {},
  mail: { driver: 'console' },
  plugins: {},
  security: {
    pbkdf2Iterations: 210000,
    csp: 'balanced',
    hsts: false,
    frameAncestors: "'none'",
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    maxLoginAttempts: 8,
    lockoutMinutes: 15,
    adminAllowlist: [],
    auditLog: true,
    minPasswordLength: 8,
  },
}

/** Environment overrides — handy for containers and CI. */
export function envOverrides(env: Record<string, string | undefined> = {}): Partial<SiteConfig> {
  const out: any = {}
  if (env.BLOCKHOUSE_SITE_URL) out.url = env.BLOCKHOUSE_SITE_URL
  if (env.BLOCKHOUSE_SITE_NAME) out.name = env.BLOCKHOUSE_SITE_NAME
  if (env.BLOCKHOUSE_TEMPLATE) out.template = env.BLOCKHOUSE_TEMPLATE
  if (env.BLOCKHOUSE_MAIL_DRIVER) out.mail = { driver: env.BLOCKHOUSE_MAIL_DRIVER, from: env.BLOCKHOUSE_MAIL_FROM }
  if (env.BLOCKHOUSE_MAIL_OPTIONS) {
    try { out.mail = { ...(out.mail || {}), options: JSON.parse(env.BLOCKHOUSE_MAIL_OPTIONS) } } catch {}
  }
  if (env.BLOCKHOUSE_HSTS) out.security = { ...(out.security || {}), hsts: env.BLOCKHOUSE_HSTS !== 'false' }
  if (env.BLOCKHOUSE_CSP) out.security = { ...(out.security || {}), csp: env.BLOCKHOUSE_CSP as any }
  if (env.BLOCKHOUSE_ADMIN_ALLOWLIST) out.security = { ...(out.security || {}), adminAllowlist: env.BLOCKHOUSE_ADMIN_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean) }
  return out
}

export function mergeConfig(raw: Partial<SiteConfig> | null | undefined, env?: Record<string, string | undefined>): SiteConfig {
  let cfg = deepMerge(DEFAULT_CONFIG, (raw || {}) as any)
  if (env) cfg = deepMerge(cfg, envOverrides(env) as any)
  if (cfg.url.endsWith('/')) cfg.url = cfg.url.slice(0, -1)
  return cfg
}
