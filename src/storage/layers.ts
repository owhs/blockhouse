// Layered file resolution for templates & template assets.
// Lookup order: site overrides → site-local template → built-in template.
// This is what lets a site tweak header.liquid (or a single CSS file) without
// forking the template.

import type { StorageDriver } from './driver.ts'

export interface Layer { driver: StorageDriver; prefix: string }

export class LayeredResolver {
  /**
   * Layers may be a fixed array or a provider function evaluated per lookup.
   * The provider form is what lets a site switch templates at runtime: the
   * resolver re-reads the current template on the very next file read, with no
   * window where the old and new layers disagree.
   */
  constructor(private source: Layer[] | (() => Layer[])) {}

  /**
   * Ephemeral top layer for the template IDE's live preview: while a draft is
   * set, that file resolves to the unsaved buffer. Nothing touches disk.
   */
  preview: Map<string, string> | null = null

  get layers(): Layer[] {
    return typeof this.source === 'function' ? this.source() : this.source
  }
  set layers(next: Layer[]) { this.source = next }

  private candidates(rel: string): { driver: StorageDriver; key: string }[] {
    return this.layers.map(l => ({ driver: l.driver, key: l.prefix ? `${l.prefix}/${rel}` : rel }))
  }

  async readText(rel: string): Promise<string | null> {
    const draft = this.preview?.get(rel)
    if (draft != null) return draft
    for (const c of this.candidates(rel)) {
      const v = await c.driver.readText(c.key)
      if (v != null) return v
    }
    return null
  }

  async read(rel: string): Promise<Uint8Array | null> {
    const draft = this.preview?.get(rel)
    if (draft != null) return new TextEncoder().encode(draft)
    for (const c of this.candidates(rel)) {
      const v = await c.driver.read(c.key)
      if (v != null) return v
    }
    return null
  }

  async stat(rel: string) {
    for (const c of this.candidates(rel)) {
      const s = await c.driver.stat(c.key)
      if (s) return s
    }
    return null
  }

  /** Union of relative keys across layers (top layer wins are irrelevant for listing). */
  async list(relPrefix: string): Promise<string[]> {
    const seen = new Set<string>()
    for (const l of this.layers) {
      const p = l.prefix ? `${l.prefix}/${relPrefix}` : relPrefix
      for (const key of await l.driver.list(p)) {
        seen.add(l.prefix ? key.slice(l.prefix.length + 1) : key)
      }
    }
    return [...seen].sort()
  }
}
