// Safe arithmetic/logic expression evaluator for computed fields.
// Supports: numbers, strings, field refs, + - * / % comparisons, and/or/not,
// parentheses, function calls: round(x[,dp]) floor ceil abs min max if(cond,a,b) len(concat(...)).
// No eval, no prototype access, bounded input.

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string }

const OPS = ['<=', '>=', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!']

function lex(src: string): Tok[] {
  if (src.length > 2000) throw new Error('expression too long')
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++
      toks.push({ t: 'num', v: src.slice(i, j) }); i = j; continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i; while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++
      toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = ''
      while (j < src.length && src[j] !== c) { out += src[j] === '\\' ? src[++j] : src[j]; j++ }
      toks.push({ t: 'str', v: out }); i = j + 1; continue
    }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma', v: c }); i++; continue }
    const op = OPS.find(o => src.startsWith(o, i))
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue }
    throw new Error(`unexpected character "${c}"`)
  }
  return toks
}

type Node =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'ref'; v: string }
  | { k: 'un'; op: string; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

const PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }

function parse(toks: Tok[]): Node {
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]

  function primary(): Node {
    const t = next()
    if (!t) throw new Error('unexpected end')
    if (t.t === 'num') return { k: 'num', v: parseFloat(t.v) }
    if (t.t === 'str') return { k: 'str', v: t.v }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v, a: primary() }
    if (t.t === 'lp') { const e = expr(0); if (next()?.t !== 'rp') throw new Error('missing )'); return e }
    if (t.t === 'id') {
      if (peek()?.t === 'lp') {
        next()
        const args: Node[] = []
        if (peek()?.t !== 'rp') {
          args.push(expr(0))
          while (peek()?.t === 'comma') { next(); args.push(expr(0)) }
        }
        if (next()?.t !== 'rp') throw new Error('missing )')
        return { k: 'call', fn: t.v, args }
      }
      if (t.v === 'true') return { k: 'num', v: 1 }
      if (t.v === 'false') return { k: 'num', v: 0 }
      return { k: 'ref', v: t.v }
    }
    throw new Error(`unexpected token "${t.v}"`)
  }

  function expr(minPrec: number): Node {
    let left = primary()
    while (peek()?.t === 'op' && PREC[peek().v] !== undefined && PREC[peek().v] >= minPrec) {
      const op = next().v
      const right = expr(PREC[op] + 1)
      left = { k: 'bin', op, a: left, b: right }
    }
    return left
  }

  const root = expr(0)
  if (pos !== toks.length) throw new Error('trailing input')
  return root
}

const FNS: Record<string, (...a: any[]) => any> = {
  round: (x, dp = 0) => Math.round(x * 10 ** dp) / 10 ** dp,
  floor: Math.floor, ceil: Math.ceil, abs: Math.abs,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  if: (c, a, b) => (c ? a : b),
  len: (s: any) => (s == null ? 0 : String(s).length),
  concat: (...a) => a.map(String).join(''),
  number: (s: any) => { const n = parseFloat(s); return isNaN(n) ? 0 : n },
  // aggregates over list/line-item fields: sum(items, 'total'), count(items), avg(items, 'qty')
  sum: (arr: any, key?: any) => Array.isArray(arr) ? arr.reduce((t, r) => t + (parseFloat(key != null ? r?.[key] : r) || 0), 0) : 0,
  count: (arr: any) => (Array.isArray(arr) ? arr.length : 0),
  avg: (arr: any, key?: any) => { if (!Array.isArray(arr) || !arr.length) return 0; return (FNS.sum as any)(arr, key) / arr.length },
  empty: (v: any) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? 1 : 0),
}

function evalNode(n: Node, vars: Record<string, any>, depth = 0): any {
  if (depth > 64) throw new Error('expression too deep')
  switch (n.k) {
    case 'num': return n.v
    case 'str': return n.v
    case 'ref': {
      if (n.v.includes('__proto__') || n.v.includes('constructor') || n.v.includes('prototype')) throw new Error('bad ref')
      let cur: any = vars
      for (const part of n.v.split('.')) {
        if (cur == null || typeof cur !== 'object') { cur = undefined; break }
        cur = Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined
      }
      if (cur == null) return 0
      // arrays/objects pass through for aggregate functions; scalars as-is
      return cur
    }
    case 'un': { const a = evalNode(n.a, vars, depth + 1); return n.op === '-' ? -a : (a ? 0 : 1) }
    case 'bin': {
      const a = evalNode(n.a, vars, depth + 1)
      if (n.op === '&&') return a ? evalNode(n.b, vars, depth + 1) : a
      if (n.op === '||') return a ? a : evalNode(n.b, vars, depth + 1)
      const b = evalNode(n.b, vars, depth + 1)
      switch (n.op) {
        case '+': return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : a + b
        case '-': return a - b; case '*': return a * b
        case '/': return b === 0 ? 0 : a / b
        case '%': return b === 0 ? 0 : a % b
        case '==': return a == b ? 1 : 0; case '!=': return a != b ? 1 : 0
        case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0
        case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0
      }
      throw new Error('bad op')
    }
    case 'call': {
      const fn = FNS[n.fn]
      if (!fn) throw new Error(`unknown function ${n.fn}()`)
      return fn(...n.args.map(a => evalNode(a, vars, depth + 1)))
    }
  }
}

const cache = new Map<string, Node>()

export function evaluate(expression: string, vars: Record<string, any> = {}): any {
  let ast = cache.get(expression)
  if (!ast) {
    ast = parse(lex(expression))
    if (cache.size > 500) cache.clear()
    cache.set(expression, ast)
  }
  return evalNode(ast, vars)
}

export function tryEvaluate(expression: string, vars: Record<string, any>, fallback: any = null): any {
  try { return evaluate(expression, vars) } catch { return fallback }
}
