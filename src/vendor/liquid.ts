// Liquid-lite: a small async template engine speaking the Liquid subset Blockhouse's
// templates use — outputs with filter chains (incl. kwargs), if/elsif/else,
// for-in, assign, include (shared scope), and pluggable custom tags/filters.
// Templates stay syntax-compatible with real Liquid so they remain portable.

type Scope = Record<string, any>
export type FilterFn = (input: any, args: any[], kwargs: Scope, scope: Scope) => any
export type TagFn = (arg: any, scope: Scope) => string | Promise<string>

type Node =
  | { k: 'text'; v: string }
  | { k: 'out'; expr: Expr }
  | { k: 'if'; branches: { cond: Expr | null; body: Node[] }[] }
  | { k: 'for'; name: string; list: Expr; body: Node[] }
  | { k: 'assign'; name: string; expr: Expr }
  | { k: 'include'; file: Expr }
  | { k: 'tag'; name: string; arg: Expr | null }

interface Expr { base: Val; filters: { name: string; args: ValOrKw[] }[] }
type Val = { t: 'lit'; v: any } | { t: 'path'; v: string[] } | { t: 'cmp'; op: string; a: Val; b: Val } | { t: 'bool'; op: 'and' | 'or'; a: Val; b: Val }
type ValOrKw = { key?: string; val: Val }

const TOKEN_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g

export class LiquidLite {
  private filters = new Map<string, FilterFn>()
  private tags = new Map<string, TagFn>()
  private cache = new Map<string, Node[]>()

  constructor(private opts: { read: (file: string) => Promise<string | null>; cache?: boolean }) {
    registerBuiltins(this)
  }

  registerFilter(name: string, fn: FilterFn) { this.filters.set(name, fn) }
  registerTag(name: string, fn: TagFn) { this.tags.set(name, fn) }

  async renderFile(file: string, data: Scope): Promise<string> {
    const key = file.endsWith('.liquid') ? file : `${file}.liquid`
    let ast = this.opts.cache ? this.cache.get(key) : undefined
    if (!ast) {
      const src = await this.opts.read(key)
      if (src == null) throw new Error(`template not found: ${key}`)
      ast = parse(src)
      if (this.opts.cache) this.cache.set(key, ast)
    }
    return this.renderNodes(ast, data)
  }

  async parseAndRender(src: string, data: Scope): Promise<string> {
    return this.renderNodes(parse(src), data)
  }

  private async renderNodes(nodes: Node[], scope: Scope): Promise<string> {
    let out = ''
    for (const n of nodes) {
      switch (n.k) {
        case 'text': out += n.v; break
        case 'out': out += toStr(await this.evalExpr(n.expr, scope)); break
        case 'assign': scope[n.name] = await this.evalExpr(n.expr, scope); break
        case 'if': {
          for (const br of n.branches) {
            if (br.cond === null || truthy(await this.evalVal(br.cond.base, scope, br.cond))) {
              out += await this.renderNodes(br.body, scope)
              break
            }
          }
          break
        }
        case 'for': {
          const list = await this.evalExpr(n.list, scope)
          if (Array.isArray(list)) {
            const prev = scope[n.name]
            const prevLoop = scope.forloop      // nested loops restore the outer one
            for (let i = 0; i < list.length; i++) {
              scope[n.name] = list[i]
              scope.forloop = {
                index: i + 1, index0: i,
                rindex: list.length - i, rindex0: list.length - i - 1,
                first: i === 0, last: i === list.length - 1,
                length: list.length,
              }
              out += await this.renderNodes(n.body, scope)
            }
            scope[n.name] = prev
            scope.forloop = prevLoop
          }
          break
        }
        case 'include': {
          const file = toStr(await this.evalExpr(n.file, scope))
          out += await this.renderFile(file, scope)
          break
        }
        case 'tag': {
          const fn = this.tags.get(n.name)
          if (!fn) break
          out += await fn(n.arg ? await this.evalExpr(n.arg, scope) : null, scope)
          break
        }
      }
    }
    return out
  }

  private async evalExpr(expr: Expr, scope: Scope): Promise<any> {
    let v = await this.evalVal(expr.base, scope, expr)
    for (const f of expr.filters) {
      const fn = this.filters.get(f.name)
      if (!fn) continue
      const args: any[] = []
      const kwargs: Scope = {}
      for (const a of f.args) {
        const av = resolveVal(a.val, scope)
        if (a.key) kwargs[a.key] = av
        else args.push(av)
      }
      v = await fn(v, args, kwargs, scope)
    }
    return v
  }

  private async evalVal(v: Val, scope: Scope, _e?: Expr): Promise<any> { return resolveVal(v, scope) }
}

function toStr(v: any): string { return v == null ? '' : String(v) }
function truthy(v: any): boolean { return Array.isArray(v) ? v.length > 0 : !!v }

function resolveVal(v: Val, scope: Scope): any {
  switch (v.t) {
    case 'lit': return v.v
    case 'path': {
      let cur: any = scope
      for (const part of v.v) {
        if (cur == null) return undefined
        cur = cur[part]
      }
      return cur
    }
    case 'cmp': {
      const a = resolveVal(v.a, scope), b = resolveVal(v.b, scope)
      switch (v.op) {
        case '==': return a == b; case '!=': return a != b
        case '>': return a > b; case '<': return a < b
        case '>=': return a >= b; case '<=': return a <= b
        case 'contains': return String(a ?? '').includes(String(b ?? ''))
      }
      return false
    }
    case 'bool': {
      const a = truthy(resolveVal(v.a, scope))
      return v.op === 'and' ? (a && truthy(resolveVal(v.b, scope))) : (a || truthy(resolveVal(v.b, scope)))
    }
  }
}

// ---------- parsing ----------

function parse(src: string): Node[] {
  const parts = src.split(TOKEN_RE)
  let pos = 0
  const peek = () => parts[pos]
  const next = () => parts[pos++]

  function body(enders: string[]): { nodes: Node[]; ended: string | null } {
    const nodes: Node[] = []
    while (pos < parts.length) {
      const part = next()
      if (part === undefined) break
      if (part.startsWith('{{')) {
        nodes.push({ k: 'out', expr: parseExpr(part.slice(2, -2).trim()) })
      } else if (part.startsWith('{%')) {
        const inner = part.slice(2, -2).trim()
        const [word] = inner.split(/\s+/, 1)
        if (enders.includes(word)) return { nodes, ended: inner }
        nodes.push(...tagNode(word, inner.slice(word.length).trim()))
      } else if (part) {
        nodes.push({ k: 'text', v: part })
      }
    }
    return { nodes, ended: null }
  }

  function tagNode(word: string, rest: string): Node[] {
    switch (word) {
      case 'if': {
        const branches: { cond: Expr | null; body: Node[] }[] = []
        let cond: Expr | null = parseCond(rest)
        for (;;) {
          const r = body(['elsif', 'else', 'endif'])
          branches.push({ cond, body: r.nodes })
          if (!r.ended || r.ended.startsWith('endif')) break
          if (r.ended.startsWith('elsif')) cond = parseCond(r.ended.slice(5).trim())
          else cond = null // else
        }
        return [{ k: 'if', branches }]
      }
      /**
       * case/when, desugared into the if node so there is one branch-rendering
       * path rather than two. Without this the tag was unknown, `{% case %}`
       * emitted nothing and every `{% when %}` body rendered as literal text —
       * a silent wrong-output failure rather than an error.
       *
       * Supports `when a`, `when a, b` and `when a or b`.
       */
      case 'case': {
        const subject = parseExpr(rest).base
        const branches: { cond: Expr | null; body: Node[] }[] = []
        // anything between {% case %} and the first {% when %} is whitespace
        let r = body(['when', 'else', 'endcase'])
        for (;;) {
          if (!r.ended || r.ended.startsWith('endcase')) break
          if (r.ended.startsWith('when')) {
            const opts = r.ended.slice(4).trim().split(/\s*,\s*|\s+or\s+/).filter(Boolean)
            let cond: Val = { t: 'cmp', op: '==', a: subject, b: parseExpr(opts[0] || '').base }
            for (let i = 1; i < opts.length; i++) {
              cond = { t: 'bool', op: 'or', a: cond, b: { t: 'cmp', op: '==', a: subject, b: parseExpr(opts[i]).base } }
            }
            const next = body(['when', 'else', 'endcase'])
            branches.push({ cond: { base: cond, filters: [] }, body: next.nodes })
            r = next
          } else {
            const next = body(['when', 'else', 'endcase'])
            branches.push({ cond: null, body: next.nodes })
            r = next
          }
        }
        return [{ k: 'if', branches }]
      }
      case 'unless': {
        const branches: { cond: Expr | null; body: Node[] }[] = []
        const inner = body(['endunless'])
        const c = parseCond(rest)
        // negate by wrapping: unless X == if !X — emulate via bool op with false compare
        branches.push({ cond: { base: { t: 'cmp', op: '==', a: c.base as any, b: { t: 'lit', v: false } }, filters: [] }, body: inner.nodes })
        return [{ k: 'if', branches }]
      }
      case 'for': {
        const m = /^(\w+)\s+in\s+(.+)$/.exec(rest)
        const r = body(['endfor'])
        if (!m) return []
        return [{ k: 'for', name: m[1], list: parseExpr(m[2]), body: r.nodes }]
      }
      case 'assign': {
        const eq = rest.indexOf('=')
        return [{ k: 'assign', name: rest.slice(0, eq).trim(), expr: parseExpr(rest.slice(eq + 1).trim()) }]
      }
      case 'include': case 'render':
        return [{ k: 'include', file: parseExpr(rest.split(',')[0].trim()) }]
      case 'comment': { body(['endcomment']); return [] }
      case 'raw': { const r = body(['endraw']); return r.nodes.filter(n2 => n2.k === 'text') }
      default:
        return [{ k: 'tag', name: word, arg: rest ? parseExpr(rest) : null }]
    }
  }

  const { nodes } = body([])
  return nodes
}

function parseCond(src: string): Expr {
  // split on and/or (left-assoc), each side a comparison or value
  const orParts = src.split(/\s+or\s+/)
  const build = (s: string): Val => {
    const andParts = s.split(/\s+and\s+/)
    let acc: Val | null = null
    for (const p of andParts) {
      const v = parseComparison(p.trim())
      acc = acc ? { t: 'bool', op: 'and', a: acc, b: v } : v
    }
    return acc!
  }
  let acc: Val | null = null
  for (const p of orParts) {
    const v = build(p)
    acc = acc ? { t: 'bool', op: 'or', a: acc, b: v } : v
  }
  return { base: acc!, filters: [] }
}

function parseComparison(src: string): Val {
  const m = /^(.+?)\s+(==|!=|>=|<=|>|<|contains)\s+(.+)$/.exec(src)
  if (m) return { t: 'cmp', op: m[2], a: parseValue(m[1].trim()), b: parseValue(m[3].trim()) }
  return parseValue(src)
}

function parseExpr(src: string): Expr {
  const segments = splitTop(src, '|')
  const base = parseComparison(segments[0].trim())
  const filters = segments.slice(1).map(seg => {
    const colon = seg.indexOf(':')
    const name = (colon === -1 ? seg : seg.slice(0, colon)).trim()
    const argsSrc = colon === -1 ? '' : seg.slice(colon + 1)
    const args: ValOrKw[] = []
    if (argsSrc.trim()) {
      for (const rawArg of splitTop(argsSrc, ',')) {
        const kw = /^\s*([a-zA-Z_][\w-]*)\s*:\s*([\s\S]+)$/.exec(rawArg)
        if (kw) args.push({ key: kw[1], val: parseValue(kw[2].trim()) })
        else args.push({ val: parseValue(rawArg.trim()) })
      }
    }
    return { name, args }
  })
  return { base, filters }
}

/** split on a delimiter, ignoring occurrences inside quotes */
function splitTop(src: string, delim: string): string[] {
  const out: string[] = []
  let cur = '', q: string | null = null
  for (const ch of src) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === delim) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function parseValue(src: string): Val {
  src = src.trim()
  if (/^'.*'$/.test(src) || /^".*"$/.test(src)) return { t: 'lit', v: src.slice(1, -1) }
  if (/^-?\d+(\.\d+)?$/.test(src)) return { t: 'lit', v: parseFloat(src) }
  if (src === 'true') return { t: 'lit', v: true }
  if (src === 'false') return { t: 'lit', v: false }
  if (src === 'nil' || src === 'null' || src === '') return { t: 'lit', v: null }
  return { t: 'path', v: src.split('.').map(s => s.replace(/\[['"]?|['"]?\]/g, '')) }
}

// ---------- built-in filters ----------

function registerBuiltins(engine: LiquidLite) {
  const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch])
  engine.registerFilter('escape', v => esc(v))
  engine.registerFilter('e', v => esc(v))
  engine.registerFilter('default', (v, [d]) => (v == null || v === '' ? d : v))
  engine.registerFilter('upcase', v => String(v ?? '').toUpperCase())
  engine.registerFilter('downcase', v => String(v ?? '').toLowerCase())
  engine.registerFilter('capitalize', v => { const s = String(v ?? ''); return s.charAt(0).toUpperCase() + s.slice(1) })
  engine.registerFilter('truncate', (v, [n, tail]) => {
    const s = String(v ?? ''); const len = Number(n) || 50
    return s.length > len ? s.slice(0, len - 1).trimEnd() + (tail ?? '…') : s
  })
  engine.registerFilter('join', (v, [sep]) => (Array.isArray(v) ? v.join(sep ?? ', ') : String(v ?? '')))
  engine.registerFilter('size', v => (Array.isArray(v) || typeof v === 'string' ? v.length : 0))
  engine.registerFilter('append', (v, [s]) => String(v ?? '') + String(s ?? ''))
  engine.registerFilter('prepend', (v, [s]) => String(s ?? '') + String(v ?? ''))
  engine.registerFilter('replace', (v, [a, b2]) => String(v ?? '').split(String(a)).join(String(b2 ?? '')))
  engine.registerFilter('strip_html', v => String(v ?? '').replace(/<[^>]+>/g, ''))
  engine.registerFilter('date', (v, [fmt]) => strftime(v === 'now' ? new Date() : new Date(v), String(fmt || '%Y-%m-%d')))
  engine.registerFilter('plus', (v, [n]) => Number(v) + Number(n))
  engine.registerFilter('minus', (v, [n]) => Number(v) - Number(n))
  engine.registerFilter('times', (v, [n]) => Number(v) * Number(n))
  engine.registerFilter('divided_by', (v, [n]) => (Number(n) ? Number(v) / Number(n) : 0))
  engine.registerFilter('round', (v, [dp]) => { const d = Number(dp) || 0; return Math.round(Number(v) * 10 ** d) / 10 ** d })
  engine.registerFilter('money', (v, [sym]) => `${sym ?? '£'}${(Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  engine.registerFilter('number', (v, [dp]) => (Number(v) || 0).toLocaleString('en-GB', dp != null ? { minimumFractionDigits: Number(dp), maximumFractionDigits: Number(dp) } : {}))
  engine.registerFilter('md', (v) => v == null ? '' : String(v))  // overridden by app engine; no-op fallback
  engine.registerFilter('where', (arr, [key, val]) => Array.isArray(arr) ? arr.filter(x => String(x?.[key]) === String(val)) : [])
  engine.registerFilter('first', v => (Array.isArray(v) ? v[0] : v))
  engine.registerFilter('last', v => (Array.isArray(v) ? v[v.length - 1] : v))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function strftime(d: Date, fmt: string): string {
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return fmt.replace(/%([a-zA-Z%])/g, (_, ch) => {
    switch (ch) {
      case 'Y': return String(d.getFullYear())
      case 'y': return pad(d.getFullYear() % 100)
      case 'm': return pad(d.getMonth() + 1)
      case 'b': return MONTHS[d.getMonth()].slice(0, 3)
      case 'B': return MONTHS[d.getMonth()]
      case 'd': return pad(d.getDate())
      case 'e': return String(d.getDate())
      case 'a': return DAYS[d.getDay()].slice(0, 3)
      case 'A': return DAYS[d.getDay()]
      case 'H': return pad(d.getHours())
      case 'M': return pad(d.getMinutes())
      case 'S': return pad(d.getSeconds())
      case '%': return '%'
      default: return ''
    }
  })
}
