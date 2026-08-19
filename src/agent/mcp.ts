// `blockhouse mcp` — a Model Context Protocol server (JSON-RPC 2.0 over stdio) that
// lets an AI agent operate a Blockhouse site through safe, validated tools instead of
// hand-editing JSON. Zero deps: implements just the MCP methods a client needs.
//
//   blockhouse mcp --dir sites/demo
//
// Tools: list_concepts, list_docs, get_doc, create_doc, update_doc_blocks,
// publish_doc, list_blocks, search_content, data_query, validate_site.

import { createNodeEnv } from '../server/node.ts'
import type { BlockhouseEnv } from '../server/env.ts'
import { validateSite } from './validate.ts'
import { id as genId, now, slugify } from '../core/util.ts'

interface RpcReq { jsonrpc: '2.0'; id?: number | string; method: string; params?: any }

const TOOLS = [
  { name: 'list_concepts', description: 'List content types (concepts) with their fields and URL patterns.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_docs', description: 'List documents, optionally filtered by concept.', inputSchema: { type: 'object', properties: { concept: { type: 'string' } } } },
  { name: 'get_doc', description: 'Get a full document (blocks, fields, seo) by id or by concept+slug.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, concept: { type: 'string' }, slug: { type: 'string' } } } },
  { name: 'create_doc', description: 'Create a draft document. blocks is an array of {type, props, children?}.', inputSchema: { type: 'object', required: ['concept', 'title'], properties: { concept: { type: 'string' }, title: { type: 'string' }, blocks: { type: 'array' }, fields: { type: 'object' }, seo: { type: 'object' } } } },
  { name: 'update_doc', description: 'Replace a document\'s blocks/fields/seo/title. Only provided keys change.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, title: { type: 'string' }, blocks: { type: 'array' }, fields: { type: 'object' }, seo: { type: 'object' } } } },
  { name: 'publish_doc', description: 'Publish a document by id.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'list_blocks', description: 'List available block types with their field schemas (what props each accepts).', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_content', description: 'Full-text search across documents.', inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } },
  { name: 'data_query', description: 'List rows of a data table by id.', inputSchema: { type: 'object', required: ['table'], properties: { table: { type: 'string' } } } },
  { name: 'validate_site', description: 'Check the whole site for broken links, unknown blocks, duplicate paths.', inputSchema: { type: 'object', properties: {} } },
]

async function call(env: BlockhouseEnv, name: string, args: any): Promise<any> {
  const content = env.content
  switch (name) {
    case 'list_concepts': return await content.concepts()
    case 'list_docs': {
      const docs = await content.listDocs(args.concept)
      const out = []
      for (const d of docs) out.push({ id: d.id, concept: d.concept, slug: d.slug, title: d.title, status: d.status, path: await content.docPath(d) })
      return out
    }
    case 'get_doc': {
      const doc = args.id ? await content.getDoc(args.id) : await content.getBySlug(args.concept, args.slug)
      if (!doc) throw new Error('document not found')
      return doc
    }
    case 'create_doc': {
      if (!(await content.concept(args.concept))) throw new Error(`unknown concept "${args.concept}"`)
      const doc = await content.createDoc({ concept: args.concept, title: args.title, blocks: args.blocks || [], fields: args.fields || {}, seo: args.seo || {} })
      return { id: doc.id, path: await content.docPath(doc), status: doc.status }
    }
    case 'update_doc': {
      const doc = await content.getDoc(args.id)
      if (!doc) throw new Error('document not found')
      if (args.title !== undefined) doc.title = args.title
      if (args.blocks !== undefined) doc.blocks = args.blocks
      if (args.fields !== undefined) doc.fields = args.fields
      if (args.seo !== undefined) doc.seo = args.seo
      const saved = await content.saveDoc(doc)
      return { id: saved.id, version: saved.version, path: await content.docPath(saved) }
    }
    case 'publish_doc': {
      const doc = await content.publish(args.id)
      if (!doc) throw new Error('document not found')
      return { id: doc.id, status: doc.status, path: await content.docPath(doc) }
    }
    case 'list_blocks': {
      return [...env.registry.blocks.values()].filter(b => !b.hiddenFromPicker).map(b => ({ type: b.type, label: b.label, group: b.group, container: !!b.container, fields: b.fields, defaults: b.defaults || {} }))
    }
    case 'search_content': {
      const docs = await content.listDocs()
      const q = String(args.q).toLowerCase()
      const hits = []
      for (const d of docs) {
        const hay = (d.title + ' ' + JSON.stringify(d.blocks)).toLowerCase()
        if (hay.includes(q)) hits.push({ id: d.id, title: d.title, path: await content.docPath(d), status: d.status })
      }
      return hits.slice(0, 20)
    }
    case 'data_query': {
      return await env.secure.rowsList(`data:t:${args.table}`, 500)
    }
    case 'validate_site': return await validateSite(env)
    default: throw new Error(`unknown tool ${name}`)
  }
}

export async function runMcp(projectDir: string) {
  const env = await createNodeEnv(projectDir, {})
  const send = (obj: any) => process.stdout.write(JSON.stringify(obj) + '\n')

  const handle = async (req: RpcReq) => {
    try {
      if (req.method === 'initialize') {
        return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'blockhouse', version: '0.2.0' } }
      }
      if (req.method === 'tools/list') return { tools: TOOLS }
      if (req.method === 'tools/call') {
        const result = await call(env, req.params.name, req.params.arguments || {})
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      if (req.method === 'ping') return {}
      throw new Error(`method not found: ${req.method}`)
    } catch (e: any) {
      throw e
    }
  }

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async chunk => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let req: RpcReq
      try { req = JSON.parse(line) } catch { continue }
      try {
        const result = await handle(req)
        if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, result })
      } catch (e: any) {
        if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: String(e?.message || e) } })
      }
    }
  })
  process.stderr.write(`blockhouse mcp server ready — ${TOOLS.length} tools over stdio (project: ${projectDir})\n`)
}
