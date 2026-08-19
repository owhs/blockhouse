// Round-6 units: zip/package validation, frontmatter, feature-gated link stripping.

import { describe, expect, test } from 'bun:test'
import { unzip, checkPackage, sha256Hex } from '../src/core/zip.ts'
import { frontmatter } from '../../plugins/mdsync/index.ts'
import { resolvedFeatures } from '../src/render/page.ts'

// build a minimal STORED zip in memory (local headers + central directory + EOCD)
function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255])
  const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255])
  const crc32 = (data: Uint8Array) => {
    let c = ~0
    for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) }
    return ~c >>> 0
  }
  const cat = (...parts: (Uint8Array | number[])[]) => {
    const arrs = parts.map(p => p instanceof Uint8Array ? p : new Uint8Array(p))
    const out = new Uint8Array(arrs.reduce((t, a) => t + a.length, 0))
    let o = 0
    for (const a of arrs) { out.set(a, o); o += a.length }
    return out
  }
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    const local = cat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), nameB, data)
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB))
    chunks.push(local)
    offset += local.length
  }
  const centralBlob = cat(...central)
  const eocd = cat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralBlob.length), u32(offset), u16(0))
  return cat(...chunks, centralBlob, eocd)
}

describe('zip + package validation', () => {
  test('unzip reads stored entries', async () => {
    const zip = makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'world' })
    const entries = await unzip(zip)
    expect(entries.map(e => e.name).sort()).toEqual(['a.txt', 'dir/b.txt'])
    expect(new TextDecoder().decode(entries.find(e => e.name === 'a.txt')!.data)).toBe('hello')
  })

  test('checksums pass clean and catch tampering', async () => {
    const body = '<html>{{ main }}</html>'
    const cs = await sha256Hex(new TextEncoder().encode(body))
    const good = await checkPackage(await unzip(makeZip({
      'layout.liquid': body,
      'blockhouse-package.json': JSON.stringify({ name: 't', kind: 'template', files: { 'layout.liquid': cs } }),
    })))
    expect(good.ok).toBe(true)
    const bad = await checkPackage(await unzip(makeZip({
      'layout.liquid': body + '<!-- evil -->',
      'blockhouse-package.json': JSON.stringify({ name: 't', kind: 'template', files: { 'layout.liquid': cs } }),
    })))
    expect(bad.ok).toBe(false)
    expect(bad.problems.join()).toContain('checksum mismatch')
  })

  test('unlisted files are flagged', async () => {
    const cs = await sha256Hex(new TextEncoder().encode('x'))
    const check = await checkPackage(await unzip(makeZip({
      'layout.liquid': 'x',
      'sneaky.js': 'alert(1)',
      'blockhouse-package.json': JSON.stringify({ name: 't', files: { 'layout.liquid': cs } }),
    })))
    expect(check.ok).toBe(false)
    expect(check.problems.join()).toContain('not in manifest')
  })

  test('ed25519 signature verifies and rejects the wrong key', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify']) as CryptoKeyPair
    const pub = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))))
    const body = 'body{}'
    const cs = await sha256Hex(new TextEncoder().encode(body))
    const canonical = `assets-base.css:${cs}`
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' } as any, kp.privateKey, new TextEncoder().encode(canonical)))))
    const zip = makeZip({
      'assets-base.css': body,
      'blockhouse-package.json': JSON.stringify({ name: 't', files: { 'assets-base.css': cs }, issuer: 'seller', signature: sig }),
    })
    const ok = await checkPackage(await unzip(zip), { seller: pub })
    expect(ok.signatureValid).toBe(true)
    const stranger = await checkPackage(await unzip(zip), {})
    expect(stranger.signatureValid).toBe(false)
  })
})

describe('markdown frontmatter', () => {
  test('parses strings, numbers, bools and lists', () => {
    const { meta, body } = frontmatter(`---\ntitle: Hello World\nslug: hello\ndraft: false\nweight: 3\ntags: [a, b, "c d"]\n---\n# Body\n`)
    expect(meta.title).toBe('Hello World')
    expect(meta.draft).toBe(false)
    expect(meta.weight).toBe(3)
    expect(meta.tags).toEqual(['a', 'b', 'c d'])
    expect(body.trim()).toBe('# Body')
  })
  test('no frontmatter → all body', () => {
    const { meta, body } = frontmatter('# Just markdown')
    expect(Object.keys(meta)).toHaveLength(0)
    expect(body).toBe('# Just markdown')
  })
})

describe('features resolve with defaults', () => {
  test('unset flags default on; explicit false wins', () => {
    const f = resolvedFeatures({ features: { rss: false } } as any)
    expect(f.rss).toBe(false)
    expect(f.sitemap).toBe(true)
    expect(f.themeToggle).toBe(true)
  })
})
