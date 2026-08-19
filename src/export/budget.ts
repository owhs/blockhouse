// Page-weight budget — renders every published page and measures what a visitor
// actually downloads: the HTML document plus the CSS/JS/font/image files it
// references. Sites drift heavy quietly; this makes it a number you can fail CI on.

import type { BlockhouseEnv } from '../server/env.ts'
import { renderDocPage, renderListPage } from '../render/page.ts'
import { isGated } from '../core/access.ts'
import { normalizePath } from '../core/util.ts'

export interface PageWeight {
  path: string
  title: string
  html: number            // bytes of the document itself
  css: number
  js: number
  images: number          // referenced <img>/<source>, counted once per page
  total: number
  requests: number
  inlineScriptBytes: number
  domNodes: number
  over: string[]          // budget names exceeded
}

export interface BudgetConfig {
  html?: number           // per-page document budget, bytes
  css?: number
  js?: number
  total?: number          // everything except images
  images?: number
  requests?: number
}

export const DEFAULT_BUDGET: Required<BudgetConfig> = {
  html: 100_000,
  css: 120_000,
  js: 100_000,
  total: 300_000,
  images: 900_000,
  requests: 30,
}

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s).length

/** All same-origin asset URLs a document references, de-duplicated. */
function assetUrls(html: string): { css: string[]; js: string[]; img: string[] } {
  const css = new Set<string>(), js = new Set<string>(), img = new Set<string>()
  for (const m of html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)) {
    const href = /href=["']([^"']+)["']/.exec(m[0])?.[1]
    if (href && !/^https?:/i.test(href)) css.add(href)
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (!/^https?:/i.test(m[1])) js.add(m[1])
  }
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)=["']([^"']+)["']/gi)) {
    // srcset: take the first candidate — that's what a narrow viewport fetches
    const first = m[1].split(',')[0].trim().split(/\s+/)[0]
    if (first && !/^(https?:|data:)/i.test(first)) img.add(first)
  }
  return { css: [...css], js: [...js], img: [...img] }
}

async function assetSize(env: BlockhouseEnv, url: string): Promise<number> {
  const clean = normalizePath(url.split('?')[0])
  const tries: Array<() => Promise<Uint8Array | null>> = []
  if (clean.startsWith('/assets/site/')) tries.push(() => env.resolver.read(`assets/${clean.slice('/assets/site/'.length)}`))
  else if (clean.startsWith('/assets/blockhouse/')) tries.push(() => env.appAssets.read(`blockhouse/${clean.slice('/assets/blockhouse/'.length)}`))
  else if (clean.startsWith('/media/')) tries.push(() => env.driver.read(`media/${clean.slice('/media/'.length)}`))
  else tries.push(() => env.driver.read(clean.slice(1)))
  for (const t of tries) {
    try { const d = await t(); if (d) return d.byteLength } catch {}
  }
  return 0
}

function inlineBytes(html: string): { script: number; style: number } {
  let script = 0, style = 0
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) script += bytes(m[1])
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) style += bytes(m[1])
  return { script, style }
}

async function weigh(env: BlockhouseEnv, path: string, title: string, html: string, budget: Required<BudgetConfig>, cache: Map<string, number>): Promise<PageWeight> {
  const refs = assetUrls(html)
  const size = async (u: string) => {
    if (!cache.has(u)) cache.set(u, await assetSize(env, u))
    return cache.get(u)!
  }
  let css = 0, js = 0, images = 0
  for (const u of refs.css) css += await size(u)
  for (const u of refs.js) js += await size(u)
  for (const u of refs.img) images += await size(u)

  const inline = inlineBytes(html)
  const htmlBytes = bytes(html)
  css += inline.style
  js += inline.script
  const total = htmlBytes + css + js
  const requests = 1 + refs.css.length + refs.js.length + refs.img.length
  const domNodes = (html.match(/<[a-zA-Z][^>]*>/g) || []).length

  const over: string[] = []
  if (htmlBytes > budget.html) over.push('html')
  if (css > budget.css) over.push('css')
  if (js > budget.js) over.push('js')
  if (total > budget.total) over.push('total')
  if (images > budget.images) over.push('images')
  if (requests > budget.requests) over.push('requests')

  return { path, title, html: htmlBytes, css, js, images, total, requests, inlineScriptBytes: inline.script, domNodes, over }
}

export async function measureSite(env: BlockhouseEnv, opts: { budget?: BudgetConfig } = {}): Promise<{
  pages: PageWeight[]
  budget: Required<BudgetConfig>
  worst: PageWeight | null
  median: number
  failures: number
}> {
  const site = await env.site()
  const budget = { ...DEFAULT_BUDGET, ...(site.build?.budget || {}), ...(opts.budget || {}) }
  const cache = new Map<string, number>()
  const pages: PageWeight[] = []

  for (const doc of await env.content.listDocs(undefined, { published: true })) {
    if (doc.status !== 'published' || isGated(doc)) continue
    const path = await env.content.docPath(doc)
    const html = await renderDocPage(env, doc, { mode: 'export', path })
    pages.push(await weigh(env, path, doc.title, html, budget, cache))
  }
  for (const concept of await env.content.concepts()) {
    if (!concept.indexPath) continue
    const res = await renderListPage(env, concept, 1, { mode: 'export', path: normalizePath(concept.indexPath) })
    if (res) pages.push(await weigh(env, normalizePath(concept.indexPath), `${concept.labelPlural || concept.label} index`, res.html, budget, cache))
  }

  pages.sort((a, b) => b.total - a.total)
  const totals = pages.map(p => p.total).sort((a, b) => a - b)
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0
  return { pages, budget, worst: pages[0] || null, median, failures: pages.filter(p => p.over.length).length }
}

export function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} kB`
}
