// The site's MCP server, over HTTPS, for an AI assistant that works on behalf of
// one signed-up person.
//
//   POST /mcp      Authorization: Bearer bhai_<token>
//
// There is no anonymous access and no cookie access: the only way in is a
// personal connection token made in the studio ("Connect an AI assistant").
// The token carries the person who made it, so the assistant can do what that
// person's role allows and nothing more, and every change it makes is written
// to the Activity log under their name. Publishing is a separate permission on
// the token, off by default.
//
// Because it never reads cookies, a web page in someone's browser cannot use
// their studio session to reach it — so it needs no CSRF token.

import { Hono } from '../vendor/http.ts'
import type { BlockhouseEnv } from './env.ts'
import { audit } from './security.ts'
import { can } from '../core/permissions.ts'
import { checkToken, issueToken } from '../auth/tokens.ts'
import { handleRpc, type McpCaller, type RpcReq } from '../agent/mcp.ts'

export const AI_TOKEN_KIND = 'ai-connection'
export const AI_TOKEN_PREFIX = 'bhai_'
const PER_MINUTE = 120

const hits = new Map<string, { n: number; reset: number }>()
function allow(key: string): boolean {
  const t = Date.now()
  const b = hits.get(key)
  if (!b || b.reset < t) { hits.set(key, { n: 1, reset: t + 60_000 }); return true }
  return ++b.n <= PER_MINUTE
}

export async function issueAiToken(env: BlockhouseEnv, userId: string, name: string, allowPublish: boolean) {
  const { token, id } = await issueToken(env.secure, AI_TOKEN_KIND, { userId, meta: { name, allowPublish, lastUsed: 0 } })
  return { id, token: AI_TOKEN_PREFIX + token }
}

export function mcpHttpRoutes(env: BlockhouseEnv): Hono {
  const app = new Hono()

  const refuse = (c: any, status: number, message: string) =>
    c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message } }, status, { 'www-authenticate': 'Bearer' })

  // A browser or a curious person opening the address: say what this is.
  app.get('/', (c: any) => c.json({
    name: 'blockhouse', transport: 'http',
    help: 'This is the AI assistant connection for this website. It needs a personal token made in the studio under your name: open the studio, click your name, then "Connect an AI assistant".',
  }))

  app.post('/', async (c: any) => {
    const m = /^Bearer\s+bhai_([A-Za-z0-9_-]+)$/.exec(c.req.header('authorization') || '')
    if (!m) return refuse(c, 401, 'Sign-in needed: send the connection token from the studio as "Authorization: Bearer bhai_…".')
    const row = await checkToken(env.secure, AI_TOKEN_KIND, m[1])
    if (!row) return refuse(c, 401, 'That connection token is not valid any more. Make a new one in the studio.')
    const person = row.userId ? await env.secure.userById(row.userId) : null
    if (!person || (person as any).disabled) return refuse(c, 401, 'The account this token belongs to is no longer active.')
    if (!allow(row.id)) return refuse(c, 429, 'Too many requests — wait a minute.')

    const who: McpCaller = {
      userId: person.id, name: person.name || person.email,
      canWrite: can(person, 'content.write') || can(person, 'content.write.own'),
      ownOnly: !can(person, 'content.write'),
      canPublish: !!row.meta?.allowPublish && can(person, 'content.publish'),
      canData: can(person, 'settings.write'),
    }

    let body: RpcReq | RpcReq[]
    try { body = await c.req.json() } catch { return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }, 400) }

    const via = { by: person.id, byName: `${who.name} (AI assistant: ${row.meta?.name || 'unnamed'})`, via: 'ai' }
    const log = async (tool: string, args: any, result: any) => {
      if (tool === 'create_doc') await audit(env, 'content.created', { ...via, docId: result?.id, title: args.title, concept: args.concept })
      if (tool === 'update_doc') await audit(env, 'content.saved', { ...via, docId: args.id, title: args.title })
      if (tool === 'publish_doc') await audit(env, 'content.published', { ...via, docId: args.id })
    }

    const one = async (req: RpcReq) => {
      try {
        const result = await handleRpc(env, req, who, log)
        return req.id === undefined ? null : { jsonrpc: '2.0', id: req.id, result }
      } catch (e: any) {
        return req.id === undefined ? null : { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: String(e?.message || e) } }
      }
    }

    env.secure.useToken(row.id).catch(() => {})
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(one))).filter(Boolean)
      return out.length ? c.json(out) : c.body(null, 202)
    }
    const out = await one(body)
    return out ? c.json(out) : c.body(null, 202)
  })

  return app
}
