// Live SEO checks shown in the studio's SEO tab and the publish dialog.

import type { Doc, SiteConfig } from './types.ts'
import { walkBlocks } from './util.ts'
import { mdText } from './markdown.ts'

export interface SeoCheck { level: 'ok' | 'warn' | 'error'; label: string; detail?: string }

/**
 * Prop names that never hold reading matter: media ids, links, layout choices,
 * colours. Everything else that is a string is treated as words on the page —
 * template blocks invent their own prop names (`lede`, `caption`, `blurb`,
 * `answer`…) and a fixed list of "known text props" always missed most of them,
 * which is why the home page used to report 0 words.
 */
const NON_TEXT_PROPS = /^(id|_id|type|kind|image|img|images|icon|iconName|photo|media|mediaId|mediaAlt|mediaAltFallback|href|url|src|link|to|slug|path|anchor|class|className|style|align|alignment|width|maxWidth|height|padding|margin|gap|color|colour|background|bg|variant|size|level|interval|columns|cols|ratio|aspect|target|rel|format|layout|theme|mode|value|key|name|tag|tags|date|order|sort|embed|video|map|lat|lng|code|json|html|css|script)$/i

/** Words that a visitor would actually read, from any block tree shape. */
export function blockText(blocks: any[] | undefined): string {
  const out: string[] = []
  const eat = (v: any, key: string) => {
    if (v == null) return
    if (typeof v === 'string') {
      if (NON_TEXT_PROPS.test(key)) return
      if (/^(https?:|mailto:|tel:|#|\/|m-)/.test(v.trim())) return
      out.push(/[*_`[\]#>]/.test(v) ? mdText(v) : v)
      return
    }
    if (Array.isArray(v)) { for (const item of v) eat(item, key) ; return }
    if (typeof v === 'object') { for (const [k, val] of Object.entries(v)) eat(val, k) }
  }
  const walk = (list: any[] | undefined) => {
    for (const b of list || []) {
      for (const [k, v] of Object.entries(b?.props || {})) eat(v, k)
      walk(b?.children)
    }
  }
  walk(blocks)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length

/**
 * `opts.h1Types` — block types that render an H1 (a template's own hero block,
 * for example). `opts.templateH1` — the page template renders the H1 itself, as
 * product and sector layouts usually do, so the block tree is the wrong place
 * to look for one.
 */
export function analyzeSeo(doc: Doc, site: SiteConfig, opts: { h1Types?: string[]; templateH1?: boolean } = {}): SeoCheck[] {
  const h1Types = new Set(['hero', ...(opts.h1Types || [])])
  const checks: SeoCheck[] = []
  const title = doc.seo?.title || doc.title || ''
  const desc = doc.seo?.description || ''

  const push = (level: SeoCheck['level'], label: string, detail?: string) => checks.push({ level, label, detail })

  if (!title) push('error', 'No title for search results')
  else if (title.length < 15) push('warn', `Search-result title is very short (${title.length} characters)`, 'Aim for 30 to 60 characters.')
  else if (title.length > 60) push('warn', `Search-result title may be cut off (${title.length} characters)`)
  else push('ok', `Search-result title is a good length (${title.length} characters)`)

  if (!desc) push('warn', 'No short description for search results', 'Search engines will write their own.')
  else if (desc.length < 50) push('warn', `Short description is very brief (${desc.length} characters)`)
  else if (desc.length > 160) push('warn', `Short description may be cut off (${desc.length} characters)`)
  else push('ok', `Short description is a good length (${desc.length} characters)`)

  const bodyText = blockText(doc.blocks)
  const words = countWords(bodyText)
  let images = 0, missingAlt = 0, headings = 0, h1s = 0, links = 0
  walkBlocks(doc.blocks, b => {
    if (b.type === 'heading') { headings++; if ((b.props.level ?? 2) === 1) h1s++ }
    if (h1Types.has(b.type)) h1s++
    if (b.type === 'image') { images++; if (!b.props.alt && !b.props.mediaAltFallback) missingAlt++ }
    if (b.type === 'button' || b.type === 'cta') links++
    if (b.type === 'richtext' && b.props.md) {
      images += (b.props.md.match(/!\[/g) || []).length
      links += (b.props.md.match(/\]\(/g) || []).length
    }
  })

  if (words < 50) push('warn', `Very little writing on this page (${words} words)`)
  else push('ok', `${words} words of writing`)

  if (opts.templateH1 && h1s === 0) push('ok', 'The page template provides the main heading')
  else if (h1s === 0) push('warn', 'No main heading at the top of the page', 'Add a hero block, or a heading set to level 1.')
  else if (h1s > 1) push('warn', `${h1s} main headings — a page should have exactly one`)
  else push('ok', 'One main heading')

  if (images > 0 && missingAlt > 0) push('error', `${missingAlt} picture${missingAlt > 1 ? 's have' : ' has'} no description`, 'Blind visitors and search engines cannot tell what they show.')
  else if (images > 0) push('ok', `All ${images} pictures have a description`)

  if (!doc.seo?.image && !site.seo.image) push('warn', 'No picture for when the page is shared')
  else push('ok', 'Social share image set')

  if (!/^[a-z0-9-]+$/.test(doc.slug)) push('warn', 'The web address contains unusual characters')
  else if (doc.slug.length > 60) push('warn', 'The web address is very long')
  else push('ok', 'Tidy web address')

  if (doc.seo?.noindex) push('warn', 'This page is deliberately hidden from search engines')

  // focus keyword analysis
  const kw = doc.seo?.keyword?.trim().toLowerCase()
  if (kw) {
    const inTitle = title.toLowerCase().includes(kw)
    const inDesc = desc.toLowerCase().includes(kw)
    const inSlug = doc.slug.includes(kw.replace(/\s+/g, '-'))
    let inH1 = false
    const bodyHits = bodyText.toLowerCase().split(kw).length - 1
    walkBlocks(doc.blocks, b => {
      if ((b.type === 'hero' && String(b.props.title || '').toLowerCase().includes(kw)) ||
          (b.type === 'heading' && (b.props.level ?? 2) == 1 && String(b.props.text || '').toLowerCase().includes(kw))) inH1 = true
    })
    push(inTitle ? 'ok' : 'warn', inTitle ? 'Focus keyword is in the search-result title' : 'Focus keyword is missing from the search-result title', `“${kw}”`)
    push(inDesc ? 'ok' : 'warn', inDesc ? 'Focus keyword is in the short description' : 'Focus keyword is missing from the short description')
    push(inH1 ? 'ok' : 'warn', inH1 ? 'Focus keyword is in the main heading' : 'Focus keyword is missing from the main heading')
    push(inSlug ? 'ok' : 'warn', inSlug ? 'Focus keyword is in the web address' : 'Focus keyword is missing from the web address')
    if (bodyHits === 0) push('warn', 'Focus keyword does not appear in the writing on this page')
    else if (words > 100 && bodyHits / (words / 100) > 3) push('warn', `Focus keyword is used a lot (${bodyHits} times)`, 'Repeating it more than about 3 times per 100 words reads as spam.')
    else push('ok', `Focus keyword appears ${bodyHits} times in the writing`)
  }

  return checks
}
