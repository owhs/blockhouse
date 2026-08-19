// Experimental: File System Access API driver, for running the studio fully
// in-browser against a local folder (Chrome/Edge). Not used by the server runtime.

import type { StatInfo, StorageDriver } from './driver.ts'
import { bytesToText } from '../core/util.ts'

type DirHandle = any // FileSystemDirectoryHandle

export class FsaDriver implements StorageDriver {
  constructor(private root: DirHandle) {}

  private async dir(parts: string[], create = false): Promise<DirHandle | null> {
    let cur = this.root
    for (const p of parts) {
      try { cur = await cur.getDirectoryHandle(p, { create }) } catch { return null }
    }
    return cur
  }

  private async fileHandle(key: string, create = false) {
    const parts = key.split('/')
    const name = parts.pop()!
    const dir = await this.dir(parts, create)
    if (!dir) return null
    try { return await dir.getFileHandle(name, { create }) } catch { return null }
  }

  async read(key: string) {
    const h = await this.fileHandle(key)
    if (!h) return null
    const f = await h.getFile()
    return new Uint8Array(await f.arrayBuffer())
  }
  async readText(key: string) { const b = await this.read(key); return b ? bytesToText(b) : null }
  async write(key: string, data: Uint8Array | string) {
    const h = await this.fileHandle(key, true)
    if (!h) throw new Error('cannot create ' + key)
    const w = await h.createWritable()
    await w.write(data as any)
    await w.close()
  }
  async delete(key: string) {
    const parts = key.split('/')
    const name = parts.pop()!
    const dir = await this.dir(parts)
    try { await dir?.removeEntry(name) } catch {}
  }
  async list(prefix: string) {
    const out: string[] = []
    const start = prefix ? await this.dir(prefix.split('/').filter(Boolean)) : this.root
    if (!start) return out
    const walk = async (dir: DirHandle, base: string) => {
      for await (const [name, handle] of dir.entries()) {
        if (name.startsWith('.')) continue
        const p = base ? `${base}/${name}` : name
        if (handle.kind === 'directory') await walk(handle, p)
        else out.push(prefix ? `${prefix}/${p}` : p)
      }
    }
    await walk(start, '')
    return out.sort()
  }
  async stat(key: string): Promise<StatInfo | null> {
    const h = await this.fileHandle(key)
    if (!h) return null
    const f = await h.getFile()
    return { size: f.size, mtime: f.lastModified }
  }
}
