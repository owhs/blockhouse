// SecureStore — the only non-gittable state: users, sessions, tokens, form
// submissions, plugin key/value + table rows, logs, subscribers.
// SQLite locally, D1 on Cloudflare, identical code path.

import type { SqlAdapter } from './sql.ts'
import type { Session, User } from '../core/types.ts'
import { id, now, tryJson } from '../core/util.ts'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT, pass TEXT, grants TEXT, active INTEGER, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, userId TEXT, expiresAt INTEGER, ua TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, kind TEXT, hash TEXT, userId TEXT, meta TEXT, expiresAt INTEGER, uses INTEGER, maxUses INTEGER, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (ns TEXT, k TEXT, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, formId TEXT, data TEXT, meta TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS rows (tableKey TEXT, id TEXT, data TEXT, createdAt TEXT, updatedAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, kind TEXT, data TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, listId TEXT, email TEXT, status TEXT, meta TEXT, createdAt TEXT)`,
]

export class SecureStore {
  constructor(public sql: SqlAdapter) {}

  async migrate() { for (const s of SCHEMA) await this.sql.run(s) }

  // ---------- users ----------

  private rowToUser(r: any): User {
    return { id: r.id, email: r.email, name: r.name, role: r.role, grants: tryJson(r.grants, []), active: !!r.active, createdAt: r.createdAt }
  }

  async userCount(): Promise<number> {
    const r = await this.sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    return r?.n ?? 0
  }
  async users(): Promise<User[]> {
    return (await this.sql.all('SELECT * FROM users ORDER BY createdAt')).map(r => this.rowToUser(r))
  }
  async userByEmail(email: string): Promise<(User & { pass: string }) | null> {
    const r = await this.sql.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()])
    return r ? { ...this.rowToUser(r), pass: r.pass } : null
  }
  async userById(uid: string): Promise<User | null> {
    const r = await this.sql.get('SELECT * FROM users WHERE id = ?', [uid])
    return r ? this.rowToUser(r) : null
  }
  async createUser(u: { email: string; name: string; role: string; pass: string; grants?: string[] }): Promise<User> {
    const user = { id: id('u'), email: u.email.toLowerCase().trim(), name: u.name, role: u.role, grants: u.grants || [], active: true, createdAt: now() }
    await this.sql.run('INSERT INTO users (id, email, name, role, pass, grants, active, createdAt) VALUES (?,?,?,?,?,?,?,?)',
      [user.id, user.email, user.name, user.role, u.pass, JSON.stringify(user.grants), 1, user.createdAt])
    return user as User
  }
  async updateUser(uid: string, patch: { name?: string; role?: string; active?: boolean; grants?: string[]; pass?: string }) {
    const cur = await this.sql.get('SELECT * FROM users WHERE id = ?', [uid])
    if (!cur) return null
    const next = {
      name: patch.name ?? cur.name, role: patch.role ?? cur.role,
      active: patch.active === undefined ? cur.active : (patch.active ? 1 : 0),
      grants: JSON.stringify(patch.grants ?? tryJson(cur.grants, [])), pass: patch.pass ?? cur.pass,
    }
    await this.sql.run('UPDATE users SET name = ?, role = ?, active = ?, grants = ?, pass = ? WHERE id = ?',
      [next.name, next.role, next.active, next.grants, next.pass, uid])
    return this.userById(uid)
  }

  // ---------- sessions ----------

  async createSession(userId: string, ua: string, ttlMs = 30 * 864e5): Promise<Session> {
    const s: Session = { id: id('s') + id(''), userId, expiresAt: Date.now() + ttlMs, ua }
    await this.sql.run('INSERT INTO sessions (id, userId, expiresAt, ua, createdAt) VALUES (?,?,?,?,?)', [s.id, userId, s.expiresAt, ua.slice(0, 200), now()])
    return s
  }
  async session(sid: string): Promise<Session | null> {
    const r = await this.sql.get('SELECT * FROM sessions WHERE id = ?', [sid])
    if (!r || r.expiresAt < Date.now()) return null
    return r
  }
  async deleteSession(sid: string) { await this.sql.run('DELETE FROM sessions WHERE id = ?', [sid]) }
  async deleteSessionsForUser(userId: string) { await this.sql.run('DELETE FROM sessions WHERE userId = ?', [userId]) }
  async pruneSessions() { await this.sql.run('DELETE FROM sessions WHERE expiresAt < ?', [Date.now()]) }

  // ---------- tokens (api keys, magic links, opt-in confirmations) ----------

  async createToken(t: { kind: string; hash: string; userId?: string; meta?: any; ttlMs?: number; maxUses?: number }) {
    const tok = { id: id('t'), expiresAt: t.ttlMs ? Date.now() + t.ttlMs : 0, uses: 0, maxUses: t.maxUses ?? 0 }
    await this.sql.run('INSERT INTO tokens (id, kind, hash, userId, meta, expiresAt, uses, maxUses, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
      [tok.id, t.kind, t.hash, t.userId ?? null, JSON.stringify(t.meta ?? {}), tok.expiresAt, 0, tok.maxUses, now()])
    return tok.id
  }
  async findToken(kind: string, hash: string) {
    const r = await this.sql.get('SELECT * FROM tokens WHERE kind = ? AND hash = ?', [kind, hash])
    if (!r) return null
    if (r.expiresAt && r.expiresAt < Date.now()) return null
    if (r.maxUses && r.uses >= r.maxUses) return null
    return { ...r, meta: tryJson(r.meta, {}) }
  }
  async useToken(tokenId: string) {
    const r = await this.sql.get('SELECT * FROM tokens WHERE id = ?', [tokenId])
    if (r) await this.sql.run('UPDATE tokens SET uses = ? WHERE id = ?', [(r.uses || 0) + 1, tokenId])
  }
  async listTokens(kind: string) {
    return (await this.sql.all('SELECT * FROM tokens WHERE kind = ? ORDER BY createdAt DESC', [kind])).map(r => ({ ...r, meta: tryJson(r.meta, {}) }))
  }
  async deleteToken(tokenId: string) { await this.sql.run('DELETE FROM tokens WHERE id = ?', [tokenId]) }

  // ---------- kv (plugin/system settings that must not be in git) ----------

  async kvGet<T = any>(ns: string, k: string, fallback: T): Promise<T> {
    const r = await this.sql.get('SELECT * FROM kv WHERE ns = ? AND k = ?', [ns, k])
    return r ? tryJson(r.v, fallback) : fallback
  }
  async kvSet(ns: string, k: string, v: any) {
    await this.sql.run('DELETE FROM kv WHERE ns = ? AND k = ?', [ns, k])
    await this.sql.run('INSERT INTO kv (ns, k, v) VALUES (?,?,?)', [ns, k, JSON.stringify(v)])
  }

  // ---------- submissions ----------

  async addSubmission(formId: string, data: any, meta: any = {}) {
    const sid = id('sub')
    await this.sql.run('INSERT INTO submissions (id, formId, data, meta, createdAt) VALUES (?,?,?,?,?)',
      [sid, formId, JSON.stringify(data), JSON.stringify(meta), now()])
    return sid
  }
  async submissions(formId?: string, limit = 200) {
    const rows = formId
      ? await this.sql.all('SELECT * FROM submissions WHERE formId = ? ORDER BY createdAt DESC LIMIT ?', [formId, limit])
      : await this.sql.all('SELECT * FROM submissions ORDER BY createdAt DESC LIMIT ?', [limit])
    return rows.map(r => ({ ...r, data: tryJson(r.data, {}), meta: tryJson(r.meta, {}) }))
  }
  async deleteSubmission(sid: string) { await this.sql.run('DELETE FROM submissions WHERE id = ?', [sid]) }

  // ---------- generic rows (data plugin) ----------

  async rowsList(tableKey: string, limit = 500) {
    const rows = await this.sql.all('SELECT * FROM rows WHERE tableKey = ? ORDER BY createdAt DESC LIMIT ?', [tableKey, limit])
    return rows.map(r => ({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, ...tryJson(r.data, {}) }))
  }
  async rowGet(tableKey: string, rid: string) {
    const r = await this.sql.get('SELECT * FROM rows WHERE tableKey = ? AND id = ?', [tableKey, rid])
    return r ? { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, ...tryJson(r.data, {}) } : null
  }
  async rowInsert(tableKey: string, data: any) {
    const rid = id('r')
    await this.sql.run('INSERT INTO rows (tableKey, id, data, createdAt, updatedAt) VALUES (?,?,?,?,?)', [tableKey, rid, JSON.stringify(data), now(), now()])
    return rid
  }
  async rowUpdate(tableKey: string, rid: string, data: any) {
    await this.sql.run('UPDATE rows SET data = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(data), now(), rid])
  }
  async rowDelete(tableKey: string, rid: string) {
    await this.sql.run('DELETE FROM rows WHERE tableKey = ? AND id = ?', [tableKey, rid])
  }

  // ---------- logs ----------

  async log(kind: string, data: any) {
    await this.sql.run('INSERT INTO logs (id, kind, data, createdAt) VALUES (?,?,?,?)', [id('l'), kind, JSON.stringify(data), now()])
  }
  async logsList(kind?: string, limit = 100) {
    const rows = kind
      ? await this.sql.all('SELECT * FROM logs WHERE kind = ? ORDER BY createdAt DESC LIMIT ?', [kind, limit])
      : await this.sql.all('SELECT * FROM logs ORDER BY createdAt DESC LIMIT ?', [limit])
    return rows.map(r => ({ ...r, data: tryJson(r.data, {}) }))
  }

  // ---------- subscribers (newsletter plugin) ----------

  async subscriberByEmail(listId: string, email: string) {
    const r = await this.sql.get('SELECT * FROM subscribers WHERE listId = ? AND email = ?', [listId, email.toLowerCase().trim()])
    return r ? { ...r, meta: tryJson(r.meta, {}) } : null
  }
  async subscriberUpsert(listId: string, email: string, status: string, meta: any = {}) {
    const existing = await this.subscriberByEmail(listId, email)
    if (existing) {
      await this.sql.run('UPDATE subscribers SET status = ?, meta = ? WHERE id = ?', [status, JSON.stringify(meta), existing.id])
      return existing.id
    }
    const sid = id('n')
    await this.sql.run('INSERT INTO subscribers (id, listId, email, status, meta, createdAt) VALUES (?,?,?,?,?,?)',
      [sid, listId, email.toLowerCase().trim(), status, JSON.stringify(meta), now()])
    return sid
  }
  async subscribers(listId: string, status?: string) {
    const rows = status
      ? await this.sql.all('SELECT * FROM subscribers WHERE listId = ? AND status = ? ORDER BY createdAt DESC', [listId, status])
      : await this.sql.all('SELECT * FROM subscribers WHERE listId = ? ORDER BY createdAt DESC', [listId])
    return rows.map(r => ({ ...r, meta: tryJson(r.meta, {}) }))
  }
}
