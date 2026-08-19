// Cloudflare R2 driver — pass the R2 bucket binding from your Worker env.
// The whole site layout (site/, media/, templates/) lives under one bucket prefix.

import type { StatInfo, StorageDriver } from './driver.ts'
import { bytesToText } from '../core/util.ts'

interface R2Bucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number; uploaded: Date } | null>
  put(key: string, value: Uint8Array | string): Promise<unknown>
  delete(key: string): Promise<void>
  list(opts: { prefix: string; cursor?: string }): Promise<{ objects: { key: string; size: number; uploaded: Date }[]; truncated: boolean; cursor?: string }>
  head(key: string): Promise<{ size: number; uploaded: Date } | null>
}

export class R2Driver implements StorageDriver {
  constructor(private bucket: R2Bucket, private prefix = '') {}
  private k(key: string) { return this.prefix ? `${this.prefix}/${key}` : key }

  async read(key: string) {
    const obj = await this.bucket.get(this.k(key))
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null
  }
  async readText(key: string) {
    const b = await this.read(key)
    return b ? bytesToText(b) : null
  }
  async write(key: string, data: Uint8Array | string) { await this.bucket.put(this.k(key), data) }
  async delete(key: string) { await this.bucket.delete(this.k(key)) }
  async list(prefix: string) {
    const out: string[] = []
    let cursor: string | undefined
    do {
      const res = await this.bucket.list({ prefix: this.k(prefix), cursor })
      for (const o of res.objects) out.push(this.prefix ? o.key.slice(this.prefix.length + 1) : o.key)
      cursor = res.truncated ? res.cursor : undefined
    } while (cursor)
    return out.sort()
  }
  async stat(key: string): Promise<StatInfo | null> {
    const h = await this.bucket.head(this.k(key))
    return h ? { size: h.size, mtime: h.uploaded.getTime() } : null
  }
}
