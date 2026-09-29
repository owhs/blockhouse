// Node/Bun entry: builds the env from a project directory, watches files in dev,
// serves via Bun.serve or the vendored node:http adapter.

import { join } from 'node:path'
import { watch, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FsDriver } from '../storage/fs.ts'
import { SecureStore } from '../secure/store.ts'
import { openSqlite, jsonFallback, privateStateDir } from '../secure/sql.ts'
import { buildEnv, type BlockhouseEnv } from './env.ts'
import { buildApp } from './app.ts'
import { notifyReload } from './api.ts'
import { randomToken } from '../core/util.ts'
import { builtinPlugins } from '../../../plugins/index.ts'

const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url))
// templates/ and plugins/ are shareable units, not part of the engine repo —
// they live one level up, as siblings of the package root (PKG_ROOT), same as
// sites/. SHARED_ROOT is the parent both are resolved from.
const SHARED_ROOT = join(PKG_ROOT, '..')

export async function createNodeEnv(projectDir: string, opts: { dev?: boolean; envName?: string } = {}): Promise<BlockhouseEnv> {
  const stateDir = join(projectDir, '.blockhouse')
  await privateStateDir(stateDir)

  // secret for cookie signing — generated once per project
  const secretFile = join(stateDir, 'secret')
  let secret = process.env.BLOCKHOUSE_SECRET || ''
  if (!secret) {
    if (existsSync(secretFile)) secret = readFileSync(secretFile, 'utf8').trim()
    else { secret = randomToken(32); writeFileSync(secretFile, secret, { mode: 0o600 }) }
  }

  const sql = (await openSqlite(join(stateDir, 'secure.db'))) ?? jsonFallback(new FsDriver(projectDir))
  if (sql.kind === 'json-fallback') console.warn('[blockhouse] no sqlite available — using JSON secure-store fallback (dev only)')
  const secure = new SecureStore(sql)
  await secure.migrate()

  // site-local plugins: <project>/plugins/<id>/index.ts — installed packages or
  // hand-written. Same capability model as built-ins: nothing runs until the
  // admin approves its permissions.
  const pluginModules: Record<string, any> = { ...builtinPlugins }
  const localPluginsDir = join(projectDir, 'plugins')
  if (existsSync(localPluginsDir)) {
    const { readdirSync } = await import('node:fs')
    const { pathToFileURL } = await import('node:url')
    for (const id of readdirSync(localPluginsDir)) {
      const entry = join(localPluginsDir, id, 'index.ts')
      if (!existsSync(entry)) continue
      try {
        const mod = await import(pathToFileURL(entry).href)
        if (mod?.manifest?.id && typeof mod.register === 'function') {
          if (pluginModules[mod.manifest.id]) console.warn(`[blockhouse] site plugin "${mod.manifest.id}" shadows a built-in — skipped`)
          else pluginModules[mod.manifest.id] = mod
        } else console.warn(`[blockhouse] site plugin "${id}" has no manifest/register export — skipped`)
      } catch (e) { console.error(`[blockhouse] site plugin "${id}" failed to import:`, e) }
    }
  }

  const env = await buildEnv({
    mode: 'node',
    dev: opts.dev,
    driver: new FsDriver(projectDir),
    templatesDriver: new FsDriver(join(SHARED_ROOT, 'templates')),
    appAssets: new FsDriver(join(PKG_ROOT, 'src', 'assets')),
    secure,
    secret,
    pluginModules,
    envName: opts.envName || process.env.BLOCKHOUSE_ENV || (opts.dev ? 'dev' : 'production'),
    processEnv: process.env,
  })
  ;(env as any).projectDir = projectDir
  return env
}

export async function serve(projectDir: string, opts: { port?: number; dev?: boolean; envName?: string } = {}) {
  const env = await createNodeEnv(projectDir, opts)
  const app = buildApp(env)
  const port = opts.port || parseInt(process.env.PORT || '8787', 10)

  if (opts.dev) {
    // watch content + templates → invalidate caches + push reload to browsers
    let t: any
    let needBlocks = false
    // Anything blockhouse writes while serving (image derivatives, logs, the secure
    // store, exports) must not look like an edit, or the browser reloads in a
    // loop. Block definitions only ever come from templates and site overrides,
    // so a media or content change never needs a re-registration pass.
    const IGNORE = /(^|[\\/])(\.blockhouse|_var|og|dist|dist-staging|node_modules)([\\/]|$)|\.(tmp|log|db|db-wal|db-shm)$/
    const BLOCKS = /(^|[\\/])(templates|overrides)[\\/]|[\\/]blocks[\\/]/
    const onChange = (_e: string, file: string | null) => {
      if (!file || IGNORE.test(file)) return
      // Windows' recursive watcher also emits bare *directory* notifications
      // ("media\_meta") when something is written nearby — and blockhouse writes
      // image derivatives while it serves, so browsing a cold site reloaded the
      // page under the reader every few seconds. A real edit always names a
      // file with an extension, so anything without one is not an edit.
      if (!/\.[a-z0-9]+$/i.test(file)) return
      if (BLOCKS.test(file)) needBlocks = true
      clearTimeout(t)
      t = setTimeout(async () => {
        env.invalidate()
        if (needBlocks) {
          needBlocks = false
          const { registerTemplateBlocks } = await import('../render/template-blocks.ts')
          await registerTemplateBlocks(env).catch(() => {})
        }
        notifyReload(env)
      }, 220)
    }
    try {
      watch(projectDir, { recursive: true }, onChange)
      watch(join(SHARED_ROOT, 'templates'), { recursive: true }, onChange)
    } catch { console.warn('[blockhouse] recursive fs.watch unavailable — live reload off') }
  }

  const userCount = await env.secure.userCount()
  const bun = (globalThis as any).Bun
  if (bun) {
    bun.serve({ port, fetch: app.fetch, idleTimeout: 120 })
  } else {
    const { serve: nodeServe } = await import('../vendor/node-server.ts')
    nodeServe({ fetch: app.fetch, port })
  }
  const site = await env.site()
  console.log(`\n  ⌁ blockhouse ${opts.dev ? 'dev ' : ''}server — ${site.name}`)
  console.log(`    site    http://localhost:${port}/`)
  console.log(`    studio  http://localhost:${port}/admin/`)
  if (userCount === 0) console.log(`    ➜ no users yet — open the studio to create the owner account`)
  console.log('')
  return { env, app, port }
}
