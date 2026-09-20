// BlockhouseEnv — the assembled application: config + stores + registry + events +
// template resolution + plugins. Built once per process (or per Worker isolate).

import type { SiteConfig } from '../core/types.ts'
import { EventBus } from '../core/events.ts'
import { Registry } from '../core/registry.ts'
import { ContentStore } from '../storage/content.ts'
import type { StorageDriver } from '../storage/driver.ts'
import { LayeredResolver } from '../storage/layers.ts'
import { SecureStore } from '../secure/store.ts'
import { registerNativeBlocks } from '../render/native-blocks.ts'
import { registerExtraBlocks } from '../render/blocks-extra.ts'
import { registerTemplateBlocks } from '../render/template-blocks.ts'
import { createEngine } from '../render/engine.ts'
import { loadPlugins } from '../core/plugin.ts'
import { registerMailDrivers } from './mail.ts'
import { MediaStore } from '../images/pipeline.ts'
import type { LiquidLite } from '../vendor/liquid.ts'

export interface BlockhouseEnv {
  mode: 'node' | 'worker'
  dev: boolean
  envName: string                  // dev · staging · production …
  driver: StorageDriver            // site project root (site/, media/)
  templatesDriver: StorageDriver   // built-in templates root
  appAssets: StorageDriver         // blockhouse's own assets (studio UI, site runtime)
  content: ContentStore
  media: MediaStore
  secure: SecureStore
  registry: Registry
  events: EventBus
  resolver: LayeredResolver        // layered template file resolution
  liquid: LiquidLite
  secret: string
  site: () => Promise<SiteConfig>
  invalidate: () => void
  reloadHooks: Set<() => void>     // dev SSE clients
  /** Unsaved menus being edited in the studio — rendered instead of the real
   *  menu ONLY for authed preview requests carrying ?__menudraft=<key>. */
  menuDrafts: Map<string, any>
  pluginRoutes: { public: PluginRoute[]; root: PluginRoute[]; api: PluginRoute[] }
  memberGate?: { resolve: (c: any) => Promise<any>; allowed: (m: any, access: any) => boolean; loginPath: () => Promise<string> }
  waitUntil?: (p: Promise<any>) => void
}

export interface PluginRoute { pid: string; fn: (app: any) => void }

export interface BuildEnvOpts {
  mode: 'node' | 'worker'
  dev?: boolean
  driver: StorageDriver
  templatesDriver: StorageDriver
  appAssets: StorageDriver
  secure: SecureStore
  secret: string
  pluginModules?: Record<string, { manifest: any; register: (ctx: any) => void | Promise<void> }>
  /** Deployment name selecting the site.<env>.json overlay: dev · staging · production … */
  envName?: string
  /** Environment variables applied as the highest-priority config layer. */
  processEnv?: Record<string, string | undefined>
}

export async function buildEnv(opts: BuildEnvOpts): Promise<BlockhouseEnv> {
  const content = new ContentStore(opts.driver, opts.envName || 'dev', opts.processEnv || {})
  const site = await content.site()   // also primes content.lastTemplate

  // Lookup order: site overrides → a template vendored into the project →
  // the built-in template. Rebuilt on invalidate() so switching templates in
  // the studio takes effect without a restart.
  const layersFor = (template: string) => [
    { driver: opts.driver, prefix: 'site/overrides' },
    { driver: opts.driver, prefix: `templates/${template}` },
    { driver: opts.templatesDriver, prefix: template },
  ]
  const resolver = new LayeredResolver(() => layersFor(content.lastTemplate))

  const env: BlockhouseEnv = {
    mode: opts.mode,
    dev: !!opts.dev,
    envName: opts.envName || 'dev',
    driver: opts.driver,
    templatesDriver: opts.templatesDriver,
    appAssets: opts.appAssets,
    content,
    media: new MediaStore(opts.driver),
    secure: opts.secure,
    registry: new Registry(),
    events: new EventBus(),
    resolver,
    liquid: null as any,
    secret: opts.secret,
    site: () => content.site(),
    invalidate: () => {
      content.invalidate()
      // The resolver reads content.lastTemplate on every lookup, so a template
      // change takes effect as soon as the config is re-read. Rebuilding the
      // engine drops its compiled-template cache along with it.
      env.liquid = createEngine(env)
      ;(env as any).assetVersion = Date.now().toString(36)
      // A template brings its own block types. They were registered once at
      // boot, so switching template on a running server left the new look
      // without its blocks until someone restarted it.
      const before = content.lastTemplate
      void content.site().then(() => {
        if (content.lastTemplate !== before) return registerTemplateBlocks(env)
      }).catch(() => {})
    },
    reloadHooks: new Set(),
    menuDrafts: new Map(),
    pluginRoutes: { public: [], root: [], api: [] },
  }

  ;(env as any).assetVersion = Date.now().toString(36)
  env.liquid = createEngine(env)
  registerMailDrivers(env.registry)
  registerNativeBlocks(env.registry)
  registerExtraBlocks(env.registry)
  await registerTemplateBlocks(env)
  await loadPlugins(env, opts.pluginModules || {})
  return env
}

export async function sendMail(env: BlockhouseEnv, msg: { to: string; subject: string; text?: string; html?: string }) {
  const site = await env.site()
  const driverId = site.mail?.driver || 'console'
  const driver = env.registry.mailDrivers.get(driverId)
  if (!driver) throw new Error(`mail driver "${driverId}" not registered`)
  await driver.send({ from: site.mail?.from, ...msg }, site.mail?.options || {})
  await env.secure.log('mail', { to: msg.to, subject: msg.subject, driver: driverId })
}
