// Live SEO checks shown in the studio's SEO tab and the publish dialog.

import type { Doc, SiteConfig } from './types.ts'
import { walkBlocks } from './util.ts'
import { mdText } from './markdown.ts'

export interface SeoCheck { level: 'ok' | 'warn' | 'error'; label: string; detail?: string }

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

  if (!title) push('error', 'Missing title')
  else if (title.length < 15) push('warn', `Title is short (${title.length} chars)`, 'Aim for 30–60 characters.')
  else if (title.length > 60) push('warn', `Title may truncate in results (${title.length} chars)`)
  else push('ok', `Title length good (${title.length} chars)`)

  if (!desc) push('warn', 'No meta description', 'Search engines will pick their own snippet.')
  else if (desc.length < 50) push('warn', `Description is short (${desc.length} chars)`)
  else if (desc.length > 160) push('warn', `Description may truncate (${desc.length} chars)`)
  else push('ok', `Description length good (${desc.length} chars)`)

  let words = 0, images = 0, missingAlt = 0, headings = 0, h1s = 0, links = 0
  walkBlocks(doc.blocks, b => {
    if (b.type === 'richtext' && b.props.md) words += mdText(b.props.md).split(/\s+/).filter(Boolean).length
    if (b.type === 'heading') { headings++; if ((b.props.level ?? 2) === 1) h1s++; words += String(b.props.text || '').split(/\s+/).length }
    if (h1Types.has(b.type)) h1s++
    if (b.type === 'image') { images++; if (!b.props.alt && !b.props.mediaAltFallback) missingAlt++ }
    if (b.type === 'button' || b.type === 'cta') links++
    if (b.type === 'richtext' && b.props.md) {
      images += (b.props.md.match(/!\[/g) || []).length
      links += (b.props.md.match(/\]\(/g) || []).length
    }
  })

  if (words < 50) push('warn', `Thin content (${words} words)`)
  else push('ok', `${words} words of content`)

  if (opts.templateH1 && h1s === 0) push('ok', 'H1 rendered by the page template')
  else if (h1s === 0) push('warn', 'No H1 on page', 'Add a hero or a level-1 heading.')
  else if (h1s > 1) push('warn', `${h1s} H1 headings — use exactly one`)
  else push('ok', 'Exactly one H1')

  if (images > 0 && missingAlt > 0) push('error', `${missingAlt} image${missingAlt > 1 ? 's' : ''} missing alt text`)
  else if (images > 0) push('ok', `All ${images} images have alt text`)

  if (!doc.seo?.image && !site.seo.image) push('warn', 'No social share image')
  else push('ok', 'Social share image set')

  if (!/^[a-z0-9-]+$/.test(doc.slug)) push('warn', 'Slug contains unusual characters')
  else if (doc.slug.length > 60) push('warn', 'Slug is long')
  else push('ok', 'Clean slug')

  if (doc.seo?.noindex) push('warn', 'Page is set to noindex')

  // focus keyword analysis
  const kw = doc.seo?.keyword?.trim().toLowerCase()
  if (kw) {
    const inTitle = title.toLowerCase().includes(kw)
    const inDesc = desc.toLowerCase().includes(kw)
    const inSlug = doc.slug.includes(kw.replace(/\s+/g, '-'))
    let bodyHits = 0, inH1 = false
    walkBlocks(doc.blocks, b => {
      if (b.type === 'richtext' && b.props.md) bodyHits += (mdText(b.props.md).toLowerCase().split(kw).length - 1)
      if ((b.type === 'hero' && String(b.props.title || '').toLowerCase().includes(kw)) ||
          (b.type === 'heading' && (b.props.level ?? 2) == 1 && String(b.props.text || '').toLowerCase().includes(kw))) inH1 = true
    })
    push(inTitle ? 'ok' : 'warn', inTitle ? `Keyword in title` : `Keyword missing from title`, `“${kw}”`)
    push(inDesc ? 'ok' : 'warn', inDesc ? 'Keyword in description' : 'Keyword missing from description')
    push(inH1 ? 'ok' : 'warn', inH1 ? 'Keyword in H1' : 'Keyword missing from H1')
    push(inSlug ? 'ok' : 'warn', inSlug ? 'Keyword in slug' : 'Keyword missing from slug')
    if (bodyHits === 0) push('warn', 'Keyword not found in body text')
    else if (words > 100 && bodyHits / (words / 100) > 3) push('warn', `Keyword may be over-used (${bodyHits}×)`, 'Reads as stuffing beyond ~3 per 100 words.')
    else push('ok', `Keyword appears ${bodyHits}× in body`)
  }

  return checks
}
