// Minimal ZIP reader — enough to unpack theme/plugin packages, zero deps.
// Supports stored (0) and deflate (8) entries via DecompressionStream.

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8) }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

export interface ZipEntry { name: string; data: Uint8Array }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as any]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Read every file entry from a zip archive (directories skipped). */
export async function unzip(buf: Uint8Array): Promise<ZipEntry[]> {
  // find end-of-central-directory
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file (no central directory)')
  const count = u16(buf, eocd + 10)
  let off = u32(buf, eocd + 16)
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (u32(buf, off) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = u16(buf, off + 10)
    const compSize = u32(buf, off + 20)
    const nameLen = u16(buf, off + 28)
    const extraLen = u16(buf, off + 30)
    const commentLen = u16(buf, off + 32)
    const localOff = u32(buf, off + 42)
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    // local header: sizes of name/extra can differ from central copies
    const lNameLen = u16(buf, localOff + 26)
    const lExtraLen = u16(buf, localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 0 ? new Uint8Array(raw) : method === 8 ? await inflateRaw(raw) : null
    if (data == null) throw new Error(`unsupported compression method ${method} for ${name}`)
    out.push({ name, data })
  }
  return out
}

/** SHA-256 hex of bytes. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as any)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface PackageCheck {
  manifest: any | null
  ok: boolean
  problems: string[]
  checksums: Record<string, string>
  signatureValid: boolean | null   // null = unsigned
}

/**
 * Validate a blockhouse package: a zip whose blockhouse-package.json lists per-file SHA-256
 * checksums, and may carry an Ed25519 signature over the sorted checksum list.
 * Sellers sign packages; sites pin trusted issuer public keys.
 */
export async function checkPackage(entries: ZipEntry[], trustedKeys: Record<string, string> = {}): Promise<PackageCheck> {
  const problems: string[] = []
  const manifestEntry = entries.find(e => e.name === 'blockhouse-package.json' || e.name.endsWith('/blockhouse-package.json'))
  const manifest = manifestEntry ? JSON.parse(new TextDecoder().decode(manifestEntry.data)) : null
  const prefix = manifestEntry && manifestEntry.name.includes('/') ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1) : ''
  const checksums: Record<string, string> = {}
  for (const e of entries) {
    const rel = e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name
    if (rel === 'blockhouse-package.json') continue
    checksums[rel] = await sha256Hex(e.data)
  }
  if (!manifest) return { manifest: null, ok: false, problems: ['no blockhouse-package.json — install allowed, but nothing can be verified'], checksums, signatureValid: null }
  for (const [rel, want] of Object.entries(manifest.files || {})) {
    if (!checksums[rel]) problems.push(`listed file missing: ${rel}`)
    else if (checksums[rel] !== want) problems.push(`checksum mismatch: ${rel}`)
  }
  for (const rel of Object.keys(checksums)) {
    if (manifest.files && !manifest.files[rel]) problems.push(`file not in manifest: ${rel}`)
  }
  let signatureValid: boolean | null = null
  if (manifest.signature && manifest.issuer) {
    signatureValid = false
    const pub = trustedKeys[manifest.issuer]
    if (!pub) problems.push(`issuer "${manifest.issuer}" is not in security.trustedIssuers`)
    else {
      try {
        const canonical = Object.entries(manifest.files || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join('\n')
        const key = await crypto.subtle.importKey('raw', b64ToBytes(pub) as any, { name: 'Ed25519' } as any, false, ['verify'])
        signatureValid = await crypto.subtle.verify({ name: 'Ed25519' } as any, key, b64ToBytes(manifest.signature) as any, new TextEncoder().encode(canonical) as any)
        if (!signatureValid) problems.push('signature does not verify against the issuer key')
      } catch (e: any) { problems.push(`signature check failed: ${e?.message || e}`) }
    }
  }
  return { manifest, ok: problems.length === 0, problems, checksums, signatureValid }
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
