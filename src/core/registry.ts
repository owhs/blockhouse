// Registries: blocks, automation actions, mail drivers, plugin resources, admin panels.
// One instance per running app (env), populated at boot by core + template + plugins.

import type { AutomationAction, BlockDef, MailDriver, PluginManifest, ResourceDef } from './types.ts'

export interface AdminPanel {
  plugin: string
  key: string
  label: string
  icon?: string
  kind: 'resources' | 'custom'
  resources?: ResourceDef[]
}

export interface SettingsSection {
  plugin: string
  key: string
  label: string
  description?: string
  fields: { key: string; label: string; type?: string; help?: string; options?: any[]; default?: any; width?: string }[]
}

export class Registry {
  blocks = new Map<string, BlockDef>()
  settingsSections: SettingsSection[] = []
  actions = new Map<string, AutomationAction>()
  mailDrivers = new Map<string, MailDriver>()
  plugins = new Map<string, PluginManifest>()
  adminPanels: AdminPanel[] = []
  resources = new Map<string, { plugin: string; def: ResourceDef }>()

  /**
   * `replace` is for registrations that are *expected* to happen again — template
   * blocks re-read from disk on every dev invalidation, and a template block may
   * deliberately shadow a native one. Only an accidental clash is worth a warning.
   */
  registerBlock(def: BlockDef, opts: { replace?: boolean } = {}) {
    if (this.blocks.has(def.type) && !opts.replace) console.warn(`[blockhouse] block "${def.type}" re-registered`)
    this.blocks.set(def.type, def)
  }
  block(type: string) { return this.blocks.get(type) }

  registerAction(a: AutomationAction) { this.actions.set(a.type, a) }
  registerMailDriver(d: MailDriver) { this.mailDrivers.set(d.id, d) }

  registerResource(plugin: string, def: ResourceDef) {
    this.resources.set(`${plugin}/${def.key}`, { plugin, def })
  }

  /** Serializable block catalogue for the studio picker/inspector. */
  blockCatalogue(userPerms: (perm: string) => boolean) {
    return [...this.blocks.values()]
      .filter(b => !b.hiddenFromPicker)
      .filter(b => !b.permission || userPerms(b.permission))
      .map(b => ({
        type: b.type, label: b.label, group: b.group, icon: b.icon || 'block',
        description: b.description || '', fields: b.fields, defaults: b.defaults || {},
        container: !!b.container, childTypes: b.childTypes || null,
      }))
  }
}
