// Content validator — used by `blockhouse check` (CI + agents) and by the MCP server
// before writes. Verifies referential integrity so an agent editing raw JSON
// can't silently break the site.

import type { BlockhouseEnv } from '../server/env.ts'
import { normalizePath, walkBlocks } from '../core/util.ts'
import { shortCode } from '../core/urls.ts'

export interface Issue { level: 'error' | 'warn'; where: string; message: string }

export async function validateSite(env: BlockhouseEnv): Promise<Issue[]> {
  const issues: Issue[] = []
  const site = await env.site()
  const concepts = await env.content.concepts()
  const conceptNames = new Set(concepts.map(c => c.name))
  const blockTypes = new Set(env.registry.blocks.keys())
  const docs = await env.content.listDocs()
  const docIds = new Set(docs.map(d => d.id))

  // concepts
  for (const c of concepts) {
    if (!/^[a-z][a-z0-9-]*$/.test(c.name)) issues.push({ level: 'error', where: `concept:${c.name}`, message: 'invalid concept name' })
    if (!c.urlPattern?.includes('{slug}') && c.name !== 'page') issues.push({ level: 'warn', where: `concept:${c.name}`, message: 'urlPattern has no {slug}' })
  }

  // home doc exists
  if (site.homeDocId && !docIds.has(site.homeDocId)) issues.push({ level: 'error', where: 'site.json', message: `homeDocId ${site.homeDocId} not found` })

  // docs
  const paths = new Map<string, string>()
  for (const d of docs) {
    const w = `doc:${d.concept}/${d.slug}`
    if (!conceptNames.has(d.concept)) issues.push({ level: 'error', where: w, message: `unknown concept "${d.concept}"` })
    if (!/^[a-z0-9-]+$/.test(d.slug)) issues.push({ level: 'warn', where: w, message: 'slug has unusual characters' })
    const p = await env.content.docPath(d)
    if (paths.has(p)) issues.push({ level: 'error', where: w, message: `duplicate path ${p} (also ${paths.get(p)})` })
    else paths.set(p, w)

    walkBlocks(d.blocks, (b: any) => {
      if (!blockTypes.has(b.type)) issues.push({ level: 'error', where: `${w} block:${b.type}`, message: `unknown block type "${b.type}"` })
      // link integrity
      for (const v of Object.values(b.props || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).docId && !docIds.has((v as any).docId)) {
          issues.push({ level: 'warn', where: w, message: `link to missing doc ${(v as any).docId}` })
        }
      }
    })
  }

  // aliases must not shadow a real page or each other, and shortcodes must be unique
  const aliasOwner = new Map<string, string>()
  const codes = new Map<string, string>()
  for (const d of docs) {
    const w = `doc:${d.concept}/${d.slug}`
    for (const a of d.aliases || []) {
      const p = normalizePath(a)
      if (paths.has(p)) issues.push({ level: 'error', where: w, message: `alias ${p} collides with the page at that URL` })
      else if (aliasOwner.has(p)) issues.push({ level: 'error', where: w, message: `alias ${p} already used by ${aliasOwner.get(p)}` })
      else aliasOwner.set(p, w)
    }
    if (site.urls?.shortlinks) {
      const code = shortCode(d.id)
      if (codes.has(code)) issues.push({ level: 'error', where: w, message: `shortlink code ${code} collides with ${codes.get(code)}` })
      else codes.set(code, w)
    }
    if (d.access?.mode && d.access.mode !== 'public' && !site.plugins?.members?.enabled) {
      issues.push({ level: 'warn', where: w, message: 'member-only page but the Members plugin is disabled — it will return 404' })
    }
    if (d.access?.mode === 'groups' && !(d.access.groups || []).length) {
      issues.push({ level: 'warn', where: w, message: 'gated to specific groups but no groups are selected — any signed-in member can view it' })
    }
  }

  // system pages must point at documents that exist
  for (const [key, docId] of Object.entries(site.systemPages || {})) {
    if (docId && !docIds.has(docId)) issues.push({ level: 'error', where: 'site.json', message: `systemPages.${key} references missing doc ${docId}` })
  }

  // menus
  for (const menu of await env.content.menus()) {
    walkMenu(menu.items, item => {
      if (item.docId && !docIds.has(item.docId)) issues.push({ level: 'warn', where: `menu:${menu.key}`, message: `item "${item.label}" links to missing doc ${item.docId}` })
      if (item.type === 'auto' && item.concept && !conceptNames.has(item.concept)) issues.push({ level: 'warn', where: `menu:${menu.key}`, message: `auto item references unknown concept ${item.concept}` })
    })
  }

  return issues
}

function walkMenu(items: any[], fn: (item: any) => void) {
  for (const it of items || []) {
    fn(it)
    if (it.children) walkMenu(it.children, fn)
    if (it.mega?.columns) for (const col of it.mega.columns) walkMenu(col.items || [], fn)
    if (it.mega?.items) walkMenu(it.mega.items, fn)
  }
}
