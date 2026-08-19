// Minimal web-standard HTTP router (Hono-compatible surface for the subset
// Blockhouse uses). Zero dependencies; runs on Bun, Node (via node-server.ts) and
// Cloudflare Workers, all through fetch(Request) → Response.

export type Handler = (c: Context, next: () => Promise<void>) => any
export type Middleware = Handler

interface RouteEntry {
  method: string
  regex: RegExp
  params: string[]
  handlers: Handler[]
  isUse: boolean
  onError?: (err: any, c: Context) => Response | Promise<Response>
}

function compile(pattern: string): { regex: RegExp; params: string[] } {
  const params: string[] = []
  if (pattern === '*' || pattern === '/*') return { regex: /^\/.*$/, params }
  let rx = ''
  for (const seg of pattern.split('/')) {
    if (seg === '') continue
    if (seg === '*') { rx += '(?:/.*)?'; continue }
    if (seg.startsWith(':')) {
      const opt = seg.endsWith('?')
      const name = seg.slice(1, opt ? -1 : undefined)
      params.push(name)
      rx += opt ? '(?:/([^/]+))?' : '/([^/]+)'
    } else {
      rx += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return { regex: new RegExp(`^${rx || '/'}$`), params }
}

export class BlockhouseRequest {
  raw: Request
  path: string
  private _params: Record<string, string> = {}
  private _url: URL
  constructor(raw: Request) {
    this.raw = raw
    this._url = new URL(raw.url)
    this.path = this._url.pathname
  }
  get url() { return this.raw.url }
  get method() { return this.raw.method }
  header(name: string): string | undefined { return this.raw.headers.get(name) ?? undefined }
  query(name: string): string | undefined { return this._url.searchParams.get(name) ?? undefined }
  param(name: string): string { return this._params[name] }
  _setParams(p: Record<string, string>) { this._params = p }
  async json(): Promise<any> { return this.raw.json() }
  async text(): Promise<string> { return this.raw.text() }
  async parseBody(): Promise<Record<string, any>> {
    const ct = this.raw.headers.get('content-type') || ''
    if (ct.includes('application/json')) return this.raw.json()
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const fd = await this.raw.formData()
      const out: Record<string, any> = {}
      for (const [k, v] of fd.entries()) out[k] = v
      return out
    }
    return {}
  }
}

export class Context {
  req: BlockhouseRequest
  env: any
  executionCtx: any
  private vars = new Map<string, any>()
  resHeaders = new Headers()
  finalized: Response | null = null

  constructor(raw: Request, env?: any, execCtx?: any) {
    this.req = new BlockhouseRequest(raw)
    this.env = env
    this.executionCtx = execCtx
  }
  set(k: string, v: any) { this.vars.set(k, v) }
  get(k: string) { return this.vars.get(k) }

  private mk(body: BodyInit | null, status: number, headers?: Record<string, string>, type?: string): Response {
    const h = new Headers(this.resHeaders)
    if (type && !h.has('content-type')) h.set('content-type', type)
    for (const [k, v] of Object.entries(headers || {})) h.set(k, v)
    return new Response(body, { status, headers: h })
  }
  json(obj: any, status = 200, headers?: Record<string, string>) { return this.mk(JSON.stringify(obj), status, headers, 'application/json') }
  html(s: string, status = 200, headers?: Record<string, string>) { return this.mk(s, status, headers, 'text/html; charset=utf-8') }
  text(s: string, status = 200, headers?: Record<string, string>) { return this.mk(s, status, headers, 'text/plain; charset=utf-8') }
  body(data: BodyInit | null, status = 200, headers?: Record<string, string>) { return this.mk(data, status, headers) }
  redirect(url: string, status = 302) { return this.mk(null, status, { location: url }) }
  notFound() { return this.mk('Not found', 404, undefined, 'text/plain') }
}

export class Hono {
  private entries: RouteEntry[] = []
  private errorHandler?: (err: any, c: Context) => Response | Promise<Response>
  private notFoundHandler?: (c: Context) => Response | Promise<Response>

  private add(method: string, pattern: string, handlers: Handler[], isUse = false) {
    const { regex, params } = compile(pattern)
    this.entries.push({ method, regex, params, handlers, isUse, onError: undefined })
    return this
  }
  use(pattern: string, ...handlers: Handler[]) { return this.add('ALL', pattern, handlers, true) }
  get(p: string, ...h: Handler[]) { return this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { return this.add('POST', p, h) }
  put(p: string, ...h: Handler[]) { return this.add('PUT', p, h) }
  patch(p: string, ...h: Handler[]) { return this.add('PATCH', p, h) }
  delete(p: string, ...h: Handler[]) { return this.add('DELETE', p, h) }
  all(p: string, ...h: Handler[]) { return this.add('ALL', p, h) }
  onError(fn: (err: any, c: Context) => Response | Promise<Response>) { this.errorHandler = fn; return this }
  notFoundFn(fn: (c: Context) => Response | Promise<Response>) { this.notFoundHandler = fn; return this }

  /** Mount a sub-app under a prefix (its routes are copied with the prefix). */
  route(prefix: string, sub: Hono) {
    const clean = prefix === '/' ? '' : prefix.replace(/\/$/, '')
    for (const e of sub.entries) {
      // rebuild pattern by prefixing the regex source
      const src = e.regex.source.replace(/^\^/, '').replace(/\$$/, '')
      const prefixRx = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const merged = src === '\\/' || src === '/'
        ? new RegExp(`^${prefixRx}/?$`)
        : new RegExp(`^${prefixRx}${src}$`)
      this.entries.push({ ...e, regex: merged, onError: e.onError ?? sub.errorHandler })
    }
    return this
  }

  fetch = async (raw: Request, env?: any, execCtx?: any): Promise<Response> => {
    const c = new Context(raw, env, execCtx)
    const path = c.req.path
    const method = raw.method

    const chain: { e: RouteEntry; params: Record<string, string> }[] = []
    let routeErr: RouteEntry['onError'] | undefined
    for (const e of this.entries) {
      if (!e.isUse && e.method !== 'ALL' && e.method !== method) continue
      const m = e.regex.exec(path)
      if (!m) continue
      const params: Record<string, string> = {}
      e.params.forEach((p, i) => { if (m[i + 1] !== undefined) params[p] = decodeURIComponent(m[i + 1]) })
      chain.push({ e, params })
      if (!e.isUse) { routeErr = e.onError; break } // first concrete route wins
    }

    let out: Response | undefined
    let i = 0
    const handlers: { fn: Handler; params: Record<string, string> }[] = []
    for (const { e, params } of chain) for (const fn of e.handlers) handlers.push({ fn, params })

    const dispatch = async (): Promise<void> => {
      if (i >= handlers.length) return
      const { fn, params } = handlers[i++]
      c.req._setParams(params)
      const r = await fn(c, dispatch)
      if (r instanceof Response && !out) out = r
    }

    try {
      await dispatch()
    } catch (err) {
      const eh = routeErr || this.errorHandler
      if (eh) return eh(err, c)
      console.error('[blockhouse http]', err)
      return c.text('Internal error', 500)
    }
    if (out) return out
    if (this.notFoundHandler) return this.notFoundHandler(c)
    return c.notFound()
  }
}

// ---------- cookies ----------

export function getCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('cookie')
  if (!header) return undefined
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return undefined
}

export interface CookieOpts { httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; secure?: boolean; maxAge?: number }

export function setCookie(c: Context, name: string, value: string, opts: CookieOpts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`
  s += `; Path=${opts.path || '/'}`
  if (opts.maxAge !== undefined) s += `; Max-Age=${opts.maxAge}`
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`
  if (opts.httpOnly) s += '; HttpOnly'
  if (opts.secure) s += '; Secure'
  c.resHeaders.append('set-cookie', s)
}

export function deleteCookie(c: Context, name: string, opts: CookieOpts = {}) {
  setCookie(c, name, '', { ...opts, maxAge: 0 })
}

// ---------- server-sent events ----------

export function streamSSE(c: Context, cb: (stream: SSEStream) => Promise<void>): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const enc = new TextEncoder()
  let aborted = false
  const abortFns: (() => void)[] = []
  c.req.raw.signal?.addEventListener('abort', () => { aborted = true; abortFns.forEach(f => f()) })

  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      controller = ctl
      const api: SSEStream = {
        writeSSE: async ({ event, data }) => {
          if (aborted) return
          try { controller.enqueue(enc.encode(`${event ? `event: ${event}\n` : ''}data: ${data}\n\n`)) } catch { aborted = true }
        },
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        onAbort: fn => abortFns.push(fn),
        get aborted() { return aborted },
      }
      cb(api).catch(() => {}).finally(() => { try { controller.close() } catch {} })
    },
    cancel() { aborted = true; abortFns.forEach(f => f()) },
  })
  return c.body(stream, 200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

export interface SSEStream {
  writeSSE(msg: { event?: string; data: string }): Promise<void>
  sleep(ms: number): Promise<void>
  onAbort(fn: () => void): void
  readonly aborted: boolean
}
