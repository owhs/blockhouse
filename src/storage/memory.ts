// In-memory driver — tests, Workers template cache, ephemeral scratch.

import type { StatInfo, StorageDriver } from './driver.ts'
import { bytesToText, textToBytes } from '../core/util.ts'

export class MemoryDriver implements StorageDriver {
  files = new Map<string, { data: Uint8Array; mtime: number }>()

  async read(key: string) { return this.files.get(key)?.data ?? null }
  async readText(key: string) { const f = this.files.get(key); return f ? bytesToText(f.data) : null }
  async write(key: string, data: Uint8Array | string) {
    this.files.set(key, { data: typeof data === 'string' ? textToBytes(data) : data, mtime: Date.now() })
  }
  async delete(key: string) { this.files.delete(key) }
  async list(prefix: string) {
    const p = prefix.endsWith('/') || prefix === '' ? prefix : prefix + '/'
    return [...this.files.keys()].filter(k => k.startsWith(p)).sort()
  }
  async stat(key: string): Promise<StatInfo | null> {
    const f = this.files.get(key)
    return f ? { size: f.data.length, mtime: f.mtime } : null
  }
}
