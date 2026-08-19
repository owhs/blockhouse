// Local filesystem driver (Node/Bun). Atomic writes via tmp+rename.

import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { StatInfo, StorageDriver } from './driver.ts'

export class FsDriver implements StorageDriver {
  constructor(public root: string) {}

  private p(key: string): string {
    const full = join(this.root, key)
    const rel = relative(this.root, full)
    if (rel.startsWith('..')) throw new Error(`path escapes root: ${key}`)
    return full
  }

  async read(key: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await fs.readFile(this.p(key))) } catch { return null }
  }
  async readText(key: string): Promise<string | null> {
    try { return await fs.readFile(this.p(key), 'utf8') } catch { return null }
  }
  async write(key: string, data: Uint8Array | string): Promise<void> {
    const full = this.p(key)
    await fs.mkdir(dirname(full), { recursive: true })
    const tmp = full + '.tmp' + Math.random().toString(36).slice(2, 8)
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, full)
  }
  async delete(key: string): Promise<void> {
    try { await fs.rm(this.p(key)) } catch {}
  }
  async list(prefix: string): Promise<string[]> {
    const base = this.p(prefix)
    const out: string[] = []
    const walk = async (dir: string) => {
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.published' && e.name !== '.trash') continue
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else out.push(relative(this.root, full).split(sep).join('/'))
      }
    }
    await walk(base)
    return out.sort()
  }
  async stat(key: string): Promise<StatInfo | null> {
    try {
      const s = await fs.stat(this.p(key))
      return s.isFile() ? { size: s.size, mtime: s.mtimeMs } : null
    } catch { return null }
  }
  async move(from: string, to: string): Promise<void> {
    const dst = this.p(to)
    await fs.mkdir(dirname(dst), { recursive: true })
    await fs.rename(this.p(from), dst)
  }
}
