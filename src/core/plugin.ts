// Plugin kernel with capability-based authorization.
// A plugin declares permissions in its manifest; an admin approves them in the
// studio (stored in site.json → plugins[id].approved). The kernel hands each
// plugin a context whose surface is *gated per capability* — an unapproved
// permission means the API simply throws. Plugins never touch stores directly.

import type { Hono } from '../vendor/http.ts'
import type { AutomationAction, BlockDef, PluginManifest, ResourceDef } from './types.ts'
import { PermissionError } from './permissions.ts'
import { id, now, stringify, tryJson } from './util.ts'

export interface PluginModule {
  manifest: PluginManifest
  register: (ctx: PluginContext) => void | Promise<void>
}

export interface PluginContext {
  id: string
  manifest: PluginManifest
  log: (...args: any[]) => void
  settings: { get<T = any>(key: string, fallback: T): Promise<T>; set(key: string, v: any): Promise<void> }
  events: { on: (event: string, h: (payload: any, event: string) => any) => void; emit: (event: string, payload: any) => Promise<void> }
  blocks: { register: (def: BlockDef) => void }
  actions: { register: (a: AutomationAction) => void }
  routes: {
    public: (fn: (app: Hono) => void) => void   // mounted at /x/<id>
    root: (fn: (app: Hono) => void) => void     // mounted at / (short urls like /f/:token)
    api: (fn: (app: Hono) => void) => void      // mounted at /api/x/<id>, session+perm guarded
  }
  content: {
    listDocs: (concept?: string, opts?: { published?: boolean }) => Promise<any[]>
    getDoc: (id: string) => Promise<any>
    saveDoc: (doc: any) => Promise<any>
  }
  store: {
    kvGet: <T = any>(k: string, fallback: T) => Promise<T>
    kvSet: (k: string, v: any) => Promise<void>
    rows: (table: string) => {
      list: (limit?: number) => Promise<any[]>
      get: (rid: string) => Promise<any>
      insert: (data: any) => Promise<string>
      update: (rid: string, data: any) => Promise<void>
      remove: (rid: string) => Promise<void>
    }
  }
  json: {  // gittable JSON documents under site/<pluginId>/
    list: (dir: string) => Promise<any[]>
    get: (dir: string, key: string) => Promise<any>
    save: (dir: string, key: string, value: any) => Promise<void>
    remove: (dir: string, key: string) => Promise<void>
  }
  mail: { send: (msg: { to: string; subject: string; text?: string; html?: string }) => Promise<void> }
  fetch: typeof fetch
  resources: { register: (def: ResourceDef) => void }
  adminPanel: (opts: { label: string; icon?: string }) => void
  util: { id: typeof id; now: typeof now }
  env: any
}

async function approvedPerms(env: any, pluginId: string): Promise<{ enabled: boolean; approved: string[] }> {
  const site = await env.site()
  const entry = site.plugins?.[pluginId]
  return { enabled: entry?.enabled ?? false, approved: entry?.approved ?? [] }
}

export async function loadPlugins(env: any, modules: Record<string, PluginModule>) {
  for (const [pid, mod] of Object.entries(modules)) {
    env.registry.plugins.set(pid, mod.manifest)
    const { enabled, approved } = await approvedPerms(env, pid)
    if (!enabled) continue
    try {
      await mod.register(makeContext(env, mod.manifest, approved))
    } catch (e) {
      // A missing grant is a configuration problem with a one-line fix, so say
      // what to do instead of dumping a stack trace over the startup banner.
      const detail = e instanceof PermissionError
        ? `${e.message}
  Fix: add it to plugins.${pid}.approved in site/site.json, or run \`blockhouse doctor\`.`
        : (e as Error)?.stack || String(e)
      env.registry.pluginErrors?.set(pid, String((e as Error)?.message || e))
      console.error(`[blockhouse] plugin "${pid}" is disabled — ${detail}`)
    }
  }
}

function makeContext(env: any, manifest: PluginManifest, approved: string[]): PluginContext {
  const pid = manifest.id
  const need = (perm: string) => {
    if (!manifest.permissions.includes(perm)) throw new PermissionError(`${perm} (not declared by ${pid})`)
    if (!approved.includes(perm) && !approved.includes('*')) throw new PermissionError(`${perm} (not approved for ${pid})`)
  }
  const ns = `p:${pid}`

  const ctx: PluginContext = {
    id: pid,
    manifest,
    log: (...args) => console.log(`[blockhouse:${pid}]`, ...args),
    settings: {
      get: async (key, fallback) => { need('settings.own'); return env.secure.kvGet(ns, `settings:${key}`, fallback) },
      set: async (key, v) => { need('settings.own'); await env.secure.kvSet(ns, `settings:${key}`, v) },
    },
    events: {
      on: (event, h) => { need('events.listen'); env.events.on(event, h) },
      emit: async (event, payload) => { need('events.emit'); await env.events.emit(`${pid}.${event}`, payload) },
    },
    blocks: { register: def => { need('blocks.register'); env.registry.registerBlock(def) } },
    actions: { register: a => { need('actions.register'); env.registry.registerAction(a) } },
    /** Declare a section in Settings → Plugins; values live in this plugin's settings store. */
    settingsSection: (sec: { key: string; label: string; description?: string; fields: any[] }) => {
      need('settings.own')
      env.registry.settingsSections.push({ plugin: pid, ...sec })
    },
    routes: {
      public: fn => { need('routes.public'); env.pluginRoutes.public.push({ pid, fn }) },
      root: fn => { need('routes.root'); env.pluginRoutes.root.push({ pid, fn }) },
      api: fn => { need('routes.api'); env.pluginRoutes.api.push({ pid, fn }) },
    },
    content: {
      listDocs: async (concept, opts) => { need('content.read'); return env.content.listDocs(concept, opts) },
      getDoc: async (docId) => { need('content.read'); return env.content.getDoc(docId) },
      saveDoc: async (doc) => { need('content.write'); return env.content.saveDoc(doc) },
    },
    store: {
      kvGet: async (k, fallback) => { need('secure.tables'); return env.secure.kvGet(ns, k, fallback) },
      kvSet: async (k, v) => { need('secure.tables'); await env.secure.kvSet(ns, k, v) },
      rows: table => {
        const tk = `${pid}:${table}`
        return {
          list: async (limit?: number) => { need('secure.tables'); return env.secure.rowsList(tk, limit) },
          get: async (rid: string) => { need('secure.tables'); return env.secure.rowGet(tk, rid) },
          insert: async (data: any) => { need('secure.tables'); return env.secure.rowInsert(tk, data) },
          update: async (rid: string, data: any) => { need('secure.tables'); await env.secure.rowUpdate(tk, rid, data) },
          remove: async (rid: string) => { need('secure.tables'); await env.secure.rowDelete(tk, rid) },
        }
      },
    },
    json: {
      list: async dir => {
        need('settings.own')
        const keys = await env.driver.list(`site/${pid}/${dir}`)
        const out = []
        for (const k of keys.filter((k: string) => k.endsWith('.json'))) {
          const v = tryJson(await env.driver.readText(k), null)
          if (v) out.push(v)
        }
        return out
      },
      get: async (dir, key) => { need('settings.own'); return tryJson(await env.driver.readText(`site/${pid}/${dir}/${safeKey(key)}.json`), null) },
      save: async (dir, key, value) => { need('settings.own'); await env.driver.write(`site/${pid}/${dir}/${safeKey(key)}.json`, stringify(value)) },
      remove: async (dir, key) => { need('settings.own'); await env.driver.delete(`site/${pid}/${dir}/${safeKey(key)}.json`) },
    },
    mail: { send: async msg => { need('mail.send'); const { sendMail } = await import('../server/env.ts'); await sendMail(env, msg) } },
    fetch: ((...args: Parameters<typeof fetch>) => { need('net.fetch'); return fetch(...args) }) as typeof fetch,
    resources: {
      register: def => {
        env.registry.registerResource(pid, def)
        let panel = env.registry.adminPanels.find((p: any) => p.plugin === pid)
        if (!panel) {
          panel = { plugin: pid, key: pid, label: manifest.name, kind: 'resources', resources: [] }
          env.registry.adminPanels.push(panel)
        }
        panel.resources.push(def)
      },
    },
    adminPanel: opts => {
      const panel = env.registry.adminPanels.find((p: any) => p.plugin === pid)
      if (panel) Object.assign(panel, opts)
      else env.registry.adminPanels.push({ plugin: pid, key: pid, kind: 'resources', resources: [], ...opts })
    },
    util: { id, now },
    env,
  }
  return ctx
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('invalid key')
  return key
}
