// `blockhouse doctor` — one command that answers "will this actually run, and is it
// safe?" for whichever environment you point it at. Grouped checks with a
// pass/warn/fail verdict and, where possible, the exact fix.

import { existsSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlockhouseEnv } from '../server/env.ts'
import { validateSite } from '../agent/validate.ts'
import { measureSite, kb } from '../export/budget.ts'
import { hasSharp } from '../images/pipeline.ts'
import { PLUGIN_PERMISSION_INFO } from '../core/permissions.ts'

/** Permissions worth naming out loud in a report — they reach outside the site. */
const HIGH_TRUST = new Set(['net.fetch', 'content.write', 'secure.tables', 'files.private', 'mail.send', 'routes.root'])

export type Level = 'ok' | 'warn' | 'fail' | 'info'

export interface Check {
  group: string
  label: string
  level: Level
  detail: string
  fix?: string
}

interface Ctx { env: BlockhouseEnv; dir: string; target: string; deep: boolean }

export async function doctor(env: BlockhouseEnv, dir: string, opts: { target?: string; deep?: boolean } = {}): Promise<Check[]> {
  const ctx: Ctx = { env, dir, target: opts.target || 'server', deep: !!opts.deep }
  const checks: Check[] = []
  for (const run of [runtime, project, config, secrets, security, plugins, content, deployment, performance]) {
    try { checks.push(...await run(ctx)) } catch (e: any) {
      checks.push({ group: 'doctor', label: 'check crashed', level: 'fail', detail: String(e?.message || e) })
    }
  }
  return checks
}

// ---------- groups ----------

async function runtime({ env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const bun = (globalThis as any).Bun
  out.push({
    group: 'Runtime', label: 'JavaScript runtime', level: 'ok',
    detail: bun ? `Bun ${bun.version}` : `Node ${process.version}`,
  })
  const major = parseInt((process.versions.node || '0').split('.')[0], 10)
  if (!bun && major < 20) {
    out.push({ group: 'Runtime', label: 'Node version', level: 'fail', detail: `Node ${process.version} is too old`, fix: 'Blockhouse needs Node 20+ (or Bun 1.1+)' })
  }

  const sqlKind = (env.secure as any).sql?.kind || 'unknown'
  out.push({
    group: 'Runtime', label: 'Secure store', level: sqlKind === 'json-fallback' ? 'warn' : 'ok',
    detail: sqlKind === 'json-fallback' ? 'JSON fallback (dev only — not safe for concurrent writes)' : `SQLite (${sqlKind})`,
    fix: sqlKind === 'json-fallback' ? 'Run on Bun, or Node 22.5+ for node:sqlite, so users/sessions get a real database' : undefined,
  })

  // Ask the image pipeline rather than importing sharp here: a literal
  // `import('sharp')` anywhere in the graph makes the Workers bundle pull in
  // node builtins and fail to build.
  const sharp = await hasSharp()
  out.push({
    group: 'Runtime', label: 'Image processing', level: sharp ? 'ok' : 'warn',
    detail: sharp ? 'sharp available — resizing, WebP and watermarks are live' : 'sharp not installed — originals are served unresized',
    fix: sharp ? undefined : 'npm install sharp (optional dependency), or set images.provider = "cloudflare"',
  })
  return out
}

async function project({ dir, env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const need = ['site/site.json', 'site/concepts', 'site/content']
  for (const rel of need) {
    const ok = existsSync(join(dir, rel))
    out.push({ group: 'Project', label: rel, level: ok ? 'ok' : 'fail', detail: ok ? 'present' : 'missing', fix: ok ? undefined : 'blockhouse init <name> scaffolds the expected layout' })
  }
  // .gitignore may live in the project or in a repo root above it
  const ig = [join(dir, '.gitignore'), join(dir, '..', '.gitignore'), join(dir, '..', '..', '.gitignore')]
    .filter(existsSync).map(f => readFileSync(f, 'utf8')).join('\n')
  const mustIgnore = ['.blockhouse', 'dist', 'node_modules']
  const missing = mustIgnore.filter(m => !ig.split(/\r?\n/).some(l => l.trim().replace(/^\//, '').replace(/\/$/, '') === m))
  out.push({
    group: 'Project', label: '.gitignore', level: missing.length ? 'warn' : 'ok',
    detail: missing.length ? `not ignoring: ${missing.join(', ')}` : 'secrets and build output excluded',
    fix: missing.length ? `Add these lines to .gitignore: ${missing.join(', ')} — .blockhouse holds the cookie secret and the user database` : undefined,
  })
  const git = [join(dir, '.git'), join(dir, '..', '.git'), join(dir, '..', '..', '.git')].some(existsSync)
  out.push({ group: 'Project', label: 'Version control', level: git ? 'ok' : 'info', detail: git ? 'git repository detected — content is diffable' : 'not a git repository', fix: git ? undefined : 'git init — Blockhouse stores content as flat JSON precisely so it reviews well in pull requests' })

  const docs = await env.content.listDocs()
  out.push({ group: 'Project', label: 'Content', level: 'info', detail: `${docs.length} document(s), ${(await env.content.concepts()).length} concept(s), ${(await env.content.menus()).length} menu(s)` })
  return out
}

async function config({ env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const site = await env.site()
  const layers = await env.content.configLayers()
  out.push({
    group: 'Config', label: `Environment: ${env.envName}`, level: 'info',
    detail: layers.filter(l => l.present).map(l => `${l.source} (${l.keys.length} key${l.keys.length === 1 ? '' : 's'})`).join('  →  ') || 'defaults only',
  })

  const localhost = /localhost|127\.0\.0\.1|^$/.test(site.url)
  out.push({
    group: 'Config', label: 'Public URL', level: env.envName === 'dev' ? 'ok' : localhost ? 'fail' : 'ok',
    detail: site.url || '(unset)',
    fix: localhost && env.envName !== 'dev'
      ? 'Canonical tags, sitemap, RSS and email links all use this. Set it via site.<env>.json, .blockhouse/local.json, or BLOCKHOUSE_SITE_URL.'
      : undefined,
  })

  const mail = site.mail?.driver || 'console'
  out.push({
    group: 'Config', label: 'Mail driver', level: mail === 'console' && env.envName !== 'dev' ? 'warn' : 'ok',
    detail: mail === 'console' ? 'console (messages are logged, not sent)' : `${mail}${site.mail?.from ? ` from ${site.mail.from}` : ''}`,
    fix: mail === 'console' && env.envName !== 'dev' ? 'Set mail.driver (smtp / resend / postmark …) or magic links and form notifications go nowhere' : undefined,
  })
  if (mail !== 'console' && !site.mail?.from) {
    out.push({ group: 'Config', label: 'Mail from address', level: 'warn', detail: 'not set', fix: 'Set mail.from — most providers reject messages without an envelope sender' })
  }

  const tplOk = !!(await env.resolver.stat('layout.liquid'))
  out.push({
    group: 'Config', label: `Template "${site.template}"`, level: tplOk ? 'ok' : 'fail',
    detail: tplOk ? 'resolves (site overrides → project template → built-in)' : 'layout.liquid not found in any layer',
    fix: tplOk ? undefined : 'Check site.template matches a folder in templates/',
  })
  return out
}

async function secrets({ dir, env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const secretFile = join(dir, '.blockhouse', 'secret')
  if (process.env.BLOCKHOUSE_SECRET) {
    out.push({ group: 'Secrets', label: 'Cookie secret', level: process.env.BLOCKHOUSE_SECRET.length >= 32 ? 'ok' : 'warn', detail: `from BLOCKHOUSE_SECRET (${process.env.BLOCKHOUSE_SECRET.length} chars)`, fix: process.env.BLOCKHOUSE_SECRET.length >= 32 ? undefined : 'Use at least 32 random characters' })
  } else if (existsSync(secretFile)) {
    const mode = statSync(secretFile).mode & 0o777
    out.push({
      group: 'Secrets', label: 'Cookie secret', level: mode & 0o077 ? 'warn' : 'ok',
      detail: `.blockhouse/secret (mode ${mode.toString(8).padStart(3, '0')})`,
      fix: mode & 0o077 ? `chmod 600 ${secretFile} — other users on this machine can currently read it` : undefined,
    })
  } else {
    out.push({ group: 'Secrets', label: 'Cookie secret', level: 'warn', detail: 'not generated yet', fix: 'Starts on first boot. In containers set BLOCKHOUSE_SECRET so sessions survive a restart.' })
  }
  const stateDir = join(dir, '.blockhouse')
  if (process.platform !== 'win32' && existsSync(stateDir)) {
    const mode = statSync(stateDir).mode & 0o777
    out.push({
      group: 'Secrets', label: 'State directory', level: mode & 0o077 ? 'fail' : 'ok',
      detail: `.blockhouse/ (mode ${mode.toString(8).padStart(3, '0')}) — users, sessions, tokens, sealed secrets`,
      fix: mode & 0o077 ? `chmod 700 ${stateDir} — other users on this machine can currently read secure.db` : undefined,
    })
  }
  if (env.secret === 'change-me') {
    out.push({ group: 'Secrets', label: 'Default secret in use', level: 'fail', detail: 'sessions can be forged', fix: 'Set BLOCKHOUSE_SECRET (Workers: wrangler secret put BLOCKHOUSE_SECRET)' })
  }

  const userCount = await env.secure.userCount()
  out.push({
    group: 'Secrets', label: 'Studio accounts', level: userCount === 0 ? 'warn' : 'ok',
    detail: userCount === 0 ? 'none — the first visitor to /admin can claim ownership' : `${userCount} account(s)`,
    fix: userCount === 0 ? 'Create the owner now: blockhouse user:add --email you@example.com --password … --role owner' : undefined,
  })
  return out
}

async function security({ env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const site = await env.site()
  const s = site.security || {}
  const prod = env.envName !== 'dev'
  const https = site.url.startsWith('https://')

  out.push({
    group: 'Security', label: 'HTTPS', level: prod && !https ? 'fail' : 'ok',
    detail: https ? 'site URL is https' : 'site URL is http',
    fix: prod && !https ? 'Session cookies are only marked Secure over https. Terminate TLS at your proxy and update the site URL.' : undefined,
  })
  out.push({
    group: 'Security', label: 'HSTS', level: prod && https && !s.hsts ? 'warn' : 'ok',
    detail: s.hsts ? 'enabled' : 'off',
    fix: prod && https && !s.hsts ? 'Turn on security.hsts once you are confident every subdomain serves https' : undefined,
  })
  out.push({
    group: 'Security', label: 'Content-Security-Policy', level: s.csp === 'off' ? 'warn' : 'ok',
    detail: s.csp || 'balanced',
    fix: s.csp === 'off' ? 'Set security.csp to "balanced" (allows first-party inline scripts) or "strict" (nonces only)'
      : s.csp === 'balanced' ? 'For maximum hardening try "strict" — verify custom JS blocks still run' : undefined,
  })
  const iter = s.pbkdf2Iterations || 0
  out.push({
    group: 'Security', label: 'Password hashing', level: iter >= 200_000 ? 'ok' : 'warn',
    detail: `PBKDF2-SHA256 × ${iter.toLocaleString()}`,
    fix: iter >= 200_000 ? undefined : 'Raise security.pbkdf2Iterations to at least 210,000 (OWASP guidance)',
  })
  out.push({
    group: 'Security', label: 'Login throttling', level: s.maxLoginAttempts ? 'ok' : 'warn',
    detail: s.maxLoginAttempts ? `${s.maxLoginAttempts} attempts, ${s.lockoutMinutes || 15} min lockout` : 'unlimited attempts',
    fix: s.maxLoginAttempts ? undefined : 'Set security.maxLoginAttempts to slow down credential stuffing',
  })
  out.push({
    group: 'Security', label: 'Admin IP allowlist', level: 'info',
    detail: s.adminAllowlist?.length ? `${s.adminAllowlist.length} entr(y|ies): ${s.adminAllowlist.join(', ')}` : 'open to any address',
    fix: s.adminAllowlist?.length ? undefined : 'If the studio only needs to be reachable from your office or VPN, add CIDRs to security.adminAllowlist',
  })
  out.push({ group: 'Security', label: 'Audit log', level: s.auditLog === false ? 'warn' : 'ok', detail: s.auditLog === false ? 'disabled' : 'recording logins, publishes and permission changes' })

  try {
    const recent = await env.secure.logsList('audit', 50)
    const lastExport = recent.find((r: any) => r.data?.action === 'export.run' || r.data?.action === 'deploy.run')
    out.push({
      group: 'Deploy', label: 'Last export', level: lastExport ? 'ok' : 'info',
      detail: lastExport
        ? `${new Date(lastExport.data.at || lastExport.createdAt).toLocaleString()} — ${lastExport.data.outDir || lastExport.data.target || 'dist'} (${lastExport.data.pages ?? '?'} pages)`
        : 'no export recorded yet',
    })
  } catch { /* audit log unavailable — not a doctor failure on its own */ }

  // member-only pages without the plugin that enforces them
  const membersOn = !!site.plugins?.members?.enabled
  const gated = (await env.content.listDocs()).filter(d => d.access?.mode && d.access.mode !== 'public')
  if (gated.length && !membersOn) {
    out.push({ group: 'Security', label: 'Member-only pages', level: 'fail', detail: `${gated.length} page(s) are member-only but the Members plugin is disabled — they now return 404`, fix: 'Enable the Members plugin, or set those pages back to public' })
  } else if (gated.length) {
    out.push({ group: 'Security', label: 'Member-only pages', level: 'ok', detail: `${gated.length} gated page(s) — excluded from exports, sitemap, feeds and search` })
  }
  return out
}

async function plugins({ env }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const site = await env.site()
  const entries = Object.entries(site.plugins || {})
  const enabled = entries.filter(([, v]) => v.enabled)
  out.push({ group: 'Plugins', label: 'Enabled', level: 'info', detail: enabled.length ? enabled.map(([k]) => k).join(', ') : 'none' })

  for (const [pid, cfg] of enabled) {
    const mf = env.registry.plugins.get(pid)
    if (!mf) {
      out.push({ group: 'Plugins', label: pid, level: 'warn', detail: 'enabled in config but not loaded', fix: 'The plugin module is missing — remove it from site.json or restore the code' })
      continue
    }
    const wanted: string[] = mf.permissions || []
    const missing = wanted.filter(p => !(cfg.approved || []).includes(p))
    const extra = (cfg.approved || []).filter(p => !wanted.includes(p))
    if (missing.length) {
      out.push({
        group: 'Plugins', label: pid, level: 'warn',
        detail: `${missing.length} requested permission(s) not approved: ${missing.join(', ')}`,
        fix: 'Approve them in Settings → Plugins, or expect those features to be inert',
      })
    } else if (extra.length) {
      out.push({ group: 'Plugins', label: pid, level: 'warn', detail: `approved but no longer requested: ${extra.join(', ')}`, fix: 'Trim site.json — grants outlive the code that needed them' })
    } else {
      const risky = wanted.filter(p => HIGH_TRUST.has(p))
      out.push({ group: 'Plugins', label: pid, level: 'ok', detail: `${wanted.length} permission(s) approved${risky.length ? ` — high-trust: ${risky.map(r => PLUGIN_PERMISSION_INFO[r] || r).join('; ')}` : ''}` })
    }
  }
  return out
}

async function content({ env }: Ctx): Promise<Check[]> {
  const issues = await validateSite(env)
  if (!issues.length) return [{ group: 'Content', label: 'Integrity', level: 'ok', detail: 'no broken links, orphans or duplicate paths' }]
  return issues.map(i => ({
    group: 'Content', label: i.where, level: i.level === 'error' ? 'fail' as const : 'warn' as const, detail: i.message, fix: (i as any).fix,
  }))
}

async function deployment({ dir, env, target }: Ctx): Promise<Check[]> {
  const out: Check[] = []
  const site = await env.site()
  const has = (f: string) => existsSync(join(dir, f))

  if (target === 'cloudflare' || has('wrangler.toml')) {
    const wrangler = has('wrangler.toml')
    out.push({ group: 'Deploy', label: 'wrangler.toml', level: wrangler ? 'ok' : 'warn', detail: wrangler ? 'present' : 'missing', fix: wrangler ? undefined : 'blockhouse deploy:init cloudflare writes a starting point' })
    if (wrangler) {
      const txt = readFileSync(join(dir, 'wrangler.toml'), 'utf8')
      for (const [binding, why] of [['SITE', 'R2 bucket holding site/ and media/'], ['DB', 'D1 database for users and sessions']]) {
        const ok = new RegExp(`binding\\s*=\\s*["']${binding}["']`).test(txt)
        out.push({ group: 'Deploy', label: `binding ${binding}`, level: ok ? 'ok' : 'fail', detail: ok ? 'declared' : `missing — ${why}` })
      }
      out.push({ group: 'Deploy', label: 'BLOCKHOUSE_SECRET', level: /BLOCKHOUSE_SECRET/.test(txt) ? 'info' : 'warn', detail: /BLOCKHOUSE_SECRET/.test(txt) ? 'referenced in wrangler.toml' : 'not referenced', fix: 'wrangler secret put BLOCKHOUSE_SECRET — never commit it to [vars]' })
    }
    if (site.images?.provider === 'local') {
      out.push({ group: 'Deploy', label: 'Image provider', level: 'warn', detail: 'local (sharp) — unavailable inside a Worker', fix: 'Set images.provider = "cloudflare" to use Image Resizing, or pre-generate variants with blockhouse export' })
    }
  }

  if (target === 'static') {
    out.push({ group: 'Deploy', label: 'Static export', level: 'info', detail: 'forms, members, search-as-a-service and analytics need a server; blocks that require one degrade to plain markup' })
  }

  if (target === 'server') {
    out.push({ group: 'Deploy', label: 'Container files', level: has('Dockerfile') ? 'ok' : 'info', detail: has('Dockerfile') ? 'Dockerfile present' : 'no Dockerfile', fix: has('Dockerfile') ? undefined : 'blockhouse deploy:init docker writes one (plus compose and a systemd unit)' })
    const port = process.env.PORT || '8787'
    out.push({ group: 'Deploy', label: 'Listen port', level: 'info', detail: `${port} (PORT env var)` })
  }

  out.push({
    group: 'Deploy', label: 'Publish state', level: 'info',
    detail: `${(await env.content.listDocs(undefined, { published: true })).length} published snapshot(s) in site/content/.published`,
  })

  // ----- exposure: the mistakes that turn a dev box into a breach -----
  const site2 = await env.site()
  const sec: any = site2.security || {}
  const publicUrl = String(site2.url || '')
  const isPublicHost = !/localhost|127\.0\.0\.1|\.local(:|$|\/)/.test(publicUrl)
  if (env.dev && isPublicHost) {
    out.push({
      group: 'Exposure', label: 'Dev mode, public URL', level: 'warn',
      detail: `this instance runs in dev mode but site.url is ${publicUrl}`,
      fix: 'dev mode enables dev-login and verbose errors — run `blockhouse serve` in production, or set security.private to "staging" so only signed-in users see it',
    })
  }
  if (isPublicHost && (sec.private || 'off') === 'off' && env.envName !== 'production') {
    out.push({
      group: 'Exposure', label: 'Staging protection', level: 'info',
      detail: `env is "${env.envName}" on a public URL and the site is world-readable`,
      fix: 'Settings → Security → "Who can view the site" = Staging keeps it studio-only; on Cloudflare add an Access rule for the studio path as a second layer',
    })
  }
  out.push({
    group: 'Exposure', label: 'Studio path', level: 'info',
    detail: sec.adminPath && sec.adminPath !== 'admin' ? `custom (/${sec.adminPath}/)` : 'default (/admin/) — bots probe this constantly',
    fix: sec.adminPath && sec.adminPath !== 'admin' ? undefined : 'renaming it (Settings → Security) plus the IP allowlist starves credential stuffing',
  })
  out.push({
    group: 'Exposure', label: 'Self-probe', level: 'info',
    detail: 'blockhouse never serves .blockhouse/, .git/, site/ JSON or private media',
    fix: `verify from the outside: Settings → Security → “Probe my public URL”, or curl -s -o /dev/null -w '%{http_code}' ${publicUrl}/.blockhouse/secret (must not be 200)`,
  })
  return out
}

async function performance({ env, deep }: Ctx): Promise<Check[]> {
  if (!deep) return [{ group: 'Performance', label: 'Page weight', level: 'info', detail: 'skipped — run with --deep (or use `blockhouse budget`) to render and measure every page' }]
  const res = await measureSite(env)
  const out: Check[] = []
  out.push({
    group: 'Performance', label: 'Page weight', level: res.failures ? 'warn' : 'ok',
    detail: `${res.pages.length} page(s), median ${kb(res.median)}, heaviest ${res.worst ? `${res.worst.path} at ${kb(res.worst.total)}` : 'n/a'}`,
    fix: res.failures ? `${res.failures} page(s) exceed the budget — run: blockhouse budget` : undefined,
  })
  for (const p of res.pages.filter(p2 => p2.over.length).slice(0, 5)) {
    out.push({ group: 'Performance', label: p.path, level: 'warn', detail: `over budget on ${p.over.join(', ')} — html ${kb(p.html)} · css ${kb(p.css)} · js ${kb(p.js)} · ${p.requests} requests` })
  }
  return out
}

// ---------- reporting ----------

const GLYPH: Record<Level, string> = { ok: '✓', warn: '⚠', fail: '✗', info: '·' }

export function printChecks(checks: Check[]): { fails: number; warns: number } {
  let group = ''
  for (const c of checks) {
    if (c.group !== group) { group = c.group; console.log(`\n  ${group}`) }
    console.log(`    ${GLYPH[c.level]} ${c.label.padEnd(24)} ${c.detail}`)
    if (c.fix) console.log(`      → ${c.fix}`)
  }
  const fails = checks.filter(c => c.level === 'fail').length
  const warns = checks.filter(c => c.level === 'warn').length
  console.log(`\n  ${fails ? '✗' : warns ? '⚠' : '✓'} ${fails} problem(s), ${warns} warning(s)\n`)
  return { fails, warns }
}
