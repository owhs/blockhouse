// Small shared utilities. Everything here must run on Node, Bun and Workers.

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz'

export function id(prefix = ''): string {
  const t = Date.now().toString(36)
  let r = ''
  const a = crypto.getRandomValues(new Uint8Array(8))
  for (const b of a) r += ALPHA[b % 36]
  return prefix + t + r
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'untitled'
}

export function now(): string { return new Date().toISOString() }

export function stringify(v: unknown): string { return JSON.stringify(v, null, 2) + '\n' }

export function tryJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any
  )[c])
}

export function escapeAttr(s: unknown): string { return escapeHtml(s) }

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const h = await crypto.subtle.digest('SHA-256', buf as BufferSource)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return b64url(new Uint8Array(sig))
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let out = 0
  for (let i = 0; i < ea.length; i++) out |= ea[i] ^ eb[i]
  return out === 0
}

export function deepClone<T>(v: T): T { return v == null ? v : JSON.parse(JSON.stringify(v)) }

export function deepMerge<T extends Record<string, any>>(base: T, over: Partial<T> | undefined): T {
  if (!over) return base
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v as any)
    } else if (v !== undefined) out[k] = v
  }
  return out
}

export function pathJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

export function normalizePath(p: string): string {
  if (!p.startsWith('/')) p = '/' + p
  p = p.replace(/\/+/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

export function fillPattern(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

export function walkBlocks(blocks: BlockLike[] | undefined, fn: (b: BlockLike, parent: BlockLike | null) => void, parent: BlockLike | null = null) {
  for (const b of blocks || []) { fn(b, parent); if (b.children) walkBlocks(b.children, fn, b) }
}
interface BlockLike { id: string; type: string; props: any; children?: BlockLike[] }

export function bytesToText(b: Uint8Array): string { return new TextDecoder().decode(b) }
export function textToBytes(s: string): Uint8Array { return new TextEncoder().encode(s) }

export function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)) }

export function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }
