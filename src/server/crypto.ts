// Small AES-GCM helpers for secrets that must live at rest (deploy credentials).
// Key = SHA-256 of the site secret, so rotating BLOCKHOUSE_SECRET invalidates them —
// which is the correct failure mode for stored credentials.

const enc = new TextEncoder()
const dec = new TextDecoder()

async function keyFrom(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`blockhouse-cred:${secret}`))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealSecret(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFrom(secret)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv); out.set(ct, iv.length)
  let b64 = ''
  for (const byte of out) b64 += String.fromCharCode(byte)
  return 'enc1:' + btoa(b64)
}

export async function openSecret(secret: string, sealed: string): Promise<string | null> {
  if (!sealed?.startsWith('enc1:')) return null
  try {
    const raw = atob(sealed.slice(5))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const key = await keyFrom(secret)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
    return dec.decode(pt)
  } catch { return null }
}
