// Markdown-lite: the CommonMark subset Blockhouse's rich text uses.
// Headings, paragraphs, lists (one nest level), blockquotes, fenced code,
// hr, bold/italic/strikethrough/code, links, images.

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

export function renderMarkdown(md: string, opts: { headingIds?: (text: string) => string } = {}): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[][] } | null = null
  let quote: string[] = []
  let code: { lang: string; lines: string[] } | null = null

  const inline = (s: string): string => {
    // escape first, then apply spans (so injected tags survive)
    let r = escapeHtml(s)
    // images before links
    r = r.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) =>
      /^(https?:\/\/|\/)/.test(src) ? `<img src="${src}" alt="${alt}" loading="lazy">` : _m)
    r = r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) =>
      /^(https?:\/\/|\/|#|mailto:)/.test(href) ? `<a href="${href}">${text}</a>` : _m)
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>')
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    r = r.replace(/(^|[^*\w])\*([^*]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>')
    r = r.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return r
  }

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map(it => `<li>${it.map(inline).join('<br>')}</li>`).join('')
      out.push(`<${list.tag}>${items}</${list.tag}>`)
      list = null
    }
  }
  const flushQuote = () => {
    if (quote.length) { out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`); quote = [] }
  }
  const flushAll = () => { flushPara(); flushList(); flushQuote() }

  for (const line of lines) {
    if (code) {
      if (/^```/.test(line.trim())) { out.push(`<pre><code${code.lang ? ` class="language-${escapeHtml(code.lang)}"` : ''}>${escapeHtml(code.lines.join('\n'))}</code></pre>`); code = null }
      else code.lines.push(line)
      continue
    }
    const t = line.trim()
    const fence = /^```(\w*)/.exec(t)
    if (fence) { flushAll(); code = { lang: fence[1], lines: [] }; continue }
    if (!t) { flushAll(); continue }
    const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t)
    if (hm) {
      flushAll()
      const level = hm[1].length
      const text = hm[2]
      const id = opts.headingIds ? ` id="${opts.headingIds(text)}"` : ''
      out.push(`<h${level}${id}>${inline(text)}</h${level}>`)
      continue
    }
    if (/^(---+|\*\*\*+|___+)$/.test(t)) { flushAll(); out.push('<hr>'); continue }
    const qm = /^>\s?(.*)$/.exec(t)
    if (qm) { flushPara(); flushList(); quote.push(qm[1]); continue }
    const ul = /^[-*+]\s+(.+)$/.exec(t)
    if (ul) {
      flushPara(); flushQuote()
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] } }
      list.items.push([ul[1]])
      continue
    }
    const ol = /^\d+[.)]\s+(.+)$/.exec(t)
    if (ol) {
      flushPara(); flushQuote()
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] } }
      list.items.push([ol[1]])
      continue
    }
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1].push(t); continue }
    flushList(); flushQuote()
    para.push(t)
  }
  flushAll()
  if (code) out.push(`<pre><code>${escapeHtml((code as any).lines.join('\n'))}</code></pre>`)
  return out.join('\n')
}
