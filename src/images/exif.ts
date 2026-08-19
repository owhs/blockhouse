// Pure-JS image helpers used when sharp is unavailable (and for cheap meta):
// JPEG EXIF/metadata segment stripping and PNG/JPEG/WebP/GIF/SVG dimension reads.

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xda) { // start of scan — copy rest verbatim
      for (let j = i; j < bytes.length; j++) out.push(bytes[j])
      break
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe // APP1..APP15 + comments (keep APP0/JFIF)
    if (!isMeta) for (let j = i; j < i + 2 + len; j++) out.push(bytes[j])
    i += 2 + len
  }
  return new Uint8Array(out)
}

export function imageDimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  try {
    if (type === 'image/png' && bytes.length > 24) {
      return { width: readU32(bytes, 16), height: readU32(bytes, 20) }
    }
    if (type === 'image/gif' && bytes.length > 10) {
      return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
    }
    if (type === 'image/jpeg') {
      let i = 2
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue }
        const marker = bytes[i + 1]
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
        }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3])
      }
    }
    if (type === 'image/webp' && bytes.length > 30) {
      const fourcc = String.fromCharCode(...bytes.slice(12, 16))
      if (fourcc === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff }
      if (fourcc === 'VP8L') {
        const b = bytes
        return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
      }
      if (fourcc === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
    }
    if (type === 'image/svg+xml') {
      const text = new TextDecoder().decode(bytes.slice(0, 2000))
      const vb = /viewBox\s*=\s*["']([\d.\s-]+)["']/.exec(text)
      if (vb) {
        const parts = vb[1].trim().split(/\s+/).map(Number)
        if (parts.length === 4) return { width: parts[2], height: parts[3] }
      }
      const w = /\bwidth\s*=\s*["']?(\d+)/.exec(text), h = /\bheight\s*=\s*["']?(\d+)/.exec(text)
      if (w && h) return { width: +w[1], height: +h[1] }
    }
  } catch {}
  return null
}

function readU32(b: Uint8Array, o: number) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3] }

export const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  html: 'text/html', txt: 'text/plain', md: 'text/markdown', xml: 'application/xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', zip: 'application/zip', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function mimeOf(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream'
}
