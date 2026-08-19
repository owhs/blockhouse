// Password hashing via WebCrypto PBKDF2-SHA256 — portable across Node, Bun and
// Workers with no native deps. Format: pbkdf2$sha256$<iters>$<salt>$<hash>

import { b64url, b64urlDecode, timingSafeEqual } from '../core/util.ts'

export async function hashPassword(password: string, iterations = 210000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await derive(password, salt, iterations)
  return `pbkdf2$sha256$${iterations}$${b64url(salt)}$${b64url(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, algo, itersStr, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'pbkdf2' || algo !== 'sha256') return false
    const bits = await derive(password, b64urlDecode(saltB64), parseInt(itersStr, 10))
    return timingSafeEqual(b64url(bits), hashB64)
  } catch { return false }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return new Uint8Array(bits)
}
