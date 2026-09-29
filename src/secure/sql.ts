// Minimal SQL adapter with zero native npm deps.
// Backends: bun:sqlite (Bun), node:sqlite (Node ≥22), Cloudflare D1, or a
// JSON-file fallback for environments with none of those (dev only).

export interface SqlAdapter {
  run(sql: string, params?: any[]): Promise<void>
  all<T = any>(sql: string, params?: any[]): Promise<T[]>
  get<T = any>(sql: string, params?: any[]): Promise<T | null>
  kind: string
}

export async function openSqlite(path: string): Promise<SqlAdapter | null> {
  // Bun
  if (typeof (globalThis as any).Bun !== 'undefined') {
    try {
      const { Database } = await import('bun:sqlite')
      const db = new Database(path, { create: true })
      db.run('PRAGMA journal_mode = WAL')
      return {
        kind: 'bun:sqlite',
        async run(sql, params = []) { db.query(sql).run(...params) },
        async all(sql, params = []) { return db.query(sql).all(...params) as any[] },
        async get(sql, params = []) { return (db.query(sql).get(...params) as any) ?? null },
      }
    } catch {}
  }
  // Node
  try {
    const mod = await import('node:sqlite')
    const db = new (mod as any).DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL')
    return {
      kind: 'node:sqlite',
      async run(sql, params = []) { db.prepare(sql).run(...params) },
      async all(sql, params = []) { return db.prepare(sql).all(...params) },
      async get(sql, params = []) { return db.prepare(sql).get(...params) ?? null },
    }
  } catch {}
  return null
}

// .blockhouse/ holds password hashes, sessions, AI tokens and sealed secrets,
// so only the owning user may enter it. Creates it 0700, and tightens an
// existing directory and secure.db (+ -wal/-shm) left group/world-readable by
// older versions. POSIX only; a failed chmod (not the owner) is left to doctor.
export async function privateStateDir(stateDir: string): Promise<void> {
  const { existsSync, mkdirSync, statSync, chmodSync } = await import('node:fs')
  const { join } = await import('node:path')
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return
  const lock = (p: string, mode: number) => {
    try { if (existsSync(p) && statSync(p).mode & 0o077) chmodSync(p, mode) } catch {}
  }
  lock(stateDir, 0o700)
  for (const f of ['secure.db', 'secure.db-wal', 'secure.db-shm', 'secure.json']) lock(join(stateDir, f), 0o600)
}

export function d1Adapter(d1: any): SqlAdapter {
  return {
    kind: 'd1',
    async run(sql, params = []) { await d1.prepare(sql).bind(...params).run() },
    async all(sql, params = []) { return (await d1.prepare(sql).bind(...params).all()).results ?? [] },
    async get(sql, params = []) { return (await d1.prepare(sql).bind(...params).first()) ?? null },
  }
}

// ---------- JSON fallback (single-process dev only) ----------
// Implements just the query shapes SecureStore uses. Not a SQL engine.

import type { StorageDriver } from '../storage/driver.ts'
import { stringify, tryJson } from '../core/util.ts'

export function jsonFallback(driver: StorageDriver, file = '.blockhouse/secure.json'): SqlAdapter {
  let cache: Record<string, any[]> | null = null
  let writing = Promise.resolve()
  const load = async () => (cache ??= tryJson(await driver.readText(file), {}))
  const save = (data: Record<string, any[]>) => {
    writing = writing.then(() => driver.write(file, stringify(data)))
    return writing
  }
  const tableOf = (sql: string) => /(?:from|into|update|table if not exists)\s+([a-z_]+)/i.exec(sql)?.[1] || '_'

  return {
    kind: 'json-fallback',
    async run(sql, params = []) {
      const data = await load()
      const table = tableOf(sql)
      data[table] ??= []
      if (/^create table/i.test(sql)) return save(data)
      if (/^insert/i.test(sql)) {
        const cols = /\(([^)]+)\)\s*values/i.exec(sql)?.[1].split(',').map(s => s.trim()) || []
        const row: any = {}
        cols.forEach((c, i) => (row[c] = params[i]))
        // emulate INSERT OR REPLACE on primary key `id` / composite for kv
        data[table] = data[table].filter(r => !(row.id != null && r.id === row.id) || table === 'kv')
        if (table === 'kv') data[table] = data[table].filter(r => !(r.ns === row.ns && r.k === row.k))
        data[table].push(row)
        return save(data)
      }
      if (/^update/i.test(sql)) {
        const sets = /set\s+(.+?)\s+where/i.exec(sql)?.[1].split(',').map(s => s.split('=')[0].trim()) || []
        const whereCol = /where\s+([a-z_]+)\s*=/i.exec(sql)?.[1]
        const whereVal = params[params.length - 1]
        for (const r of data[table]) if (whereCol && r[whereCol] === whereVal) sets.forEach((c, i) => (r[c] = params[i]))
        return save(data)
      }
      if (/^delete/i.test(sql)) {
        const conds = [...sql.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(m => m[1])
        const ltCol = /([a-z_]+)\s*<\s*\?/i.exec(sql)?.[1]
        data[table] = data[table].filter(r => {
          let i = 0
          for (const c of conds) if (r[c] !== params[i++]) return true
          if (ltCol) return !(r[ltCol] < params[i])
          return false
        })
        return save(data)
      }
    },
    async all(sql, params = []) {
      const data = await load()
      let rows = [...(data[tableOf(sql)] || [])]
      const conds = [...sql.matchAll(/([a-z_]+)\s*=\s*\?/gi)].map(m => m[1])
      let i = 0
      for (const c of conds) { const v = params[i++]; rows = rows.filter(r => r[c] === v) }
      const ord = /order by\s+([a-z_]+)\s*(desc)?/i.exec(sql)
      if (ord) rows.sort((a, b) => (a[ord[1]] < b[ord[1]] ? -1 : 1) * (ord[2] ? -1 : 1))
      const lim = /limit\s+(\d+)/i.exec(sql)
      if (lim) rows = rows.slice(0, parseInt(lim[1]))
      if (/select\s+count\(\*\)\s+as\s+n/i.test(sql)) return [{ n: rows.length } as any]
      return rows
    },
    async get(sql, params = []) { return (await this.all(sql, params))[0] ?? null },
  }
}
