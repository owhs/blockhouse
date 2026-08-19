// Cloudflare Workers entry.
//
// wrangler.toml bindings expected:
//   [[r2_buckets]]  binding = "SITE"   — bucket holding the project layout (site/, media/, templates/)
//   [[d1_databases]] binding = "DB"    — secure store
//   [vars] / secrets: BLOCKHOUSE_SECRET
//
// Push your project folder to the bucket (`npx wrangler r2 object put ...` or
// any S3 sync tool), or publish via `blockhouse export` to Pages for flat hosting.
// Set site.json → images.provider = "cloudflare" to use CF Image Resizing.

import { R2Driver } from '../storage/r2.ts'
import { MemoryDriver } from '../storage/memory.ts'
import { SecureStore } from '../secure/store.ts'
import { d1Adapter } from '../secure/sql.ts'
import { buildEnv, type BlockhouseEnv } from './env.ts'
import { buildApp } from './app.ts'
import { builtinPlugins } from '../../../plugins/index.ts'

let cached: { env: BlockhouseEnv; app: ReturnType<typeof buildApp> } | null = null

async function getApp(bindings: any) {
  if (cached) return cached
  const driver = new R2Driver(bindings.SITE)
  const secure = new SecureStore(d1Adapter(bindings.DB))
  await secure.migrate()
  const env = await buildEnv({
    mode: 'worker',
    driver,
    templatesDriver: new R2Driver(bindings.SITE, 'templates'),
    appAssets: bindings.ASSETS ? new R2Driver(bindings.ASSETS) : new MemoryDriver(),
    secure,
    secret: bindings.BLOCKHOUSE_SECRET || 'change-me',
    pluginModules: builtinPlugins,
    // Worker bindings (vars + secrets) act as the environment layer, so the
    // same R2 project runs as staging or production purely from wrangler config.
    envName: bindings.BLOCKHOUSE_ENV || 'production',
    processEnv: bindings,
  })
  cached = { env, app: buildApp(env) }
  return cached
}

export default {
  async fetch(request: Request, bindings: any, ctx: any): Promise<Response> {
    const { env, app } = await getApp(bindings)
    env.waitUntil = p => ctx.waitUntil(p)
    return app.fetch(request, bindings, ctx)
  },
}
