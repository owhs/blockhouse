// Markdown → sanitized HTML. Rich text is *stored* as markdown (git-friendly
// diffs); the studio round-trips it to a WYSIWYG surface client-side.
// Rendering uses the zero-dependency vendored engine; swap in `marked` via
// this module if you want the full CommonMark spec.

import { renderMarkdown } from '../vendor/markdown.ts'
import { sanitizeHtml } from './sanitize.ts'
import { slugify } from './util.ts'

export function mdToHtml(md: string): string {
  if (!md) return ''
  return sanitizeHtml(renderMarkdown(md, { headingIds: t => slugify(t) }))
}

export function mdExcerpt(md: string, words = 40): string {
  const text = mdText(md)
  const parts = text.split(' ')
  return parts.length <= words ? text : parts.slice(0, words).join(' ') + '…'
}

export function mdText(md: string): string {
  return mdToHtml(md).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
