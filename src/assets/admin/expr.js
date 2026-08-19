// Client-side port of the safe expression engine (src/core/expr.ts) —
// powers live computed-field preview and conditional show/require rules.

const OPS = ['<=', '>=', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!']

function lex(src) {
  if (src.length > 2000) throw new Error('too long')
  const toks = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j) }); i = j; continue }
    if (/[a-zA-Z_]/.test(c)) { let j = i; while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue }
    if (c === '"' || c === "'") { let j = i + 1, out = ''; while (j < src.length && src[j] !== c) { out += src[j] === '\\' ? src[++j] : src[j]; j++ } toks.push({ t: 'str', v: out }); i = j + 1; continue }
    if (c === '(') { toks.push({ t: 'lp' }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp' }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue }
    const op = OPS.find(o => src.startsWith(o, i))
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue }
    throw new Error('bad char ' + c)
  }
  return toks
}

const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }

function parse(toks) {
  let pos = 0
  const peek = () => toks[pos], next = () => toks[pos++]
  function primary() {
    const t = next()
    if (!t) throw new Error('eof')
    if (t.t === 'num') return { k: 'num', v: parseFloat(t.v) }
    if (t.t === 'str') return { k: 'str', v: t.v }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v, a: primary() }
    if (t.t === 'lp') { const e = expr(0); if (next()?.t !== 'rp') throw new Error(')'); return e }
    if (t.t === 'id') {
      if (peek()?.t === 'lp') {
        next()
        const args = []
        if (peek()?.t !== 'rp') { args.push(expr(0)); while (peek()?.t === 'comma') { next(); args.push(expr(0)) } }
        if (next()?.t !== 'rp') throw new Error(')')
        return { k: 'call', fn: t.v, args }
      }
      if (t.v === 'true') return { k: 'num', v: 1 }
      if (t.v === 'false') return { k: 'num', v: 0 }
      return { k: 'ref', v: t.v }
    }
    throw new Error('tok')
  }
  function expr(min) {
    let left = primary()
    while (peek()?.t === 'op' && PREC[peek().v] !== undefined && PREC[peek().v] >= min) {
      const op = next().v
      left = { k: 'bin', op, a: left, b: expr(PREC[op] + 1) }
    }
    return left
  }
  const root = expr(0)
  if (pos !== toks.length) throw new Error('trailing')
  return root
}

const FNS = {
  round: (x, dp = 0) => Math.round(x * 10 ** dp) / 10 ** dp,
  floor: Math.floor, ceil: Math.ceil, abs: Math.abs,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  if: (c, a, b) => (c ? a : b),
  len: s => (s == null ? 0 : String(s).length),
  concat: (...a) => a.map(String).join(''),
  number: s => { const n = parseFloat(s); return isNaN(n) ? 0 : n },
  sum: (arr, key) => Array.isArray(arr) ? arr.reduce((t, r) => t + (parseFloat(key != null ? r?.[key] : r) || 0), 0) : 0,
  count: arr => (Array.isArray(arr) ? arr.length : 0),
  avg: (arr, key) => { if (!Array.isArray(arr) || !arr.length) return 0; return FNS.sum(arr, key) / arr.length },
  empty: v => (v == null || v === '' || (Array.isArray(v) && !v.length) ? 1 : 0),
}

function ev(n, vars, d = 0) {
  if (d > 64) throw new Error('deep')
  switch (n.k) {
    case 'num': case 'str': return n.v
    case 'ref': {
      if (/__proto__|constructor|prototype/.test(n.v)) throw new Error('ref')
      let cur = vars
      for (const p of n.v.split('.')) { if (cur == null || typeof cur !== 'object') return 0; cur = Object.prototype.hasOwnProperty.call(cur, p) ? cur[p] : undefined }
      if (cur == null) return 0
      return cur
    }
    case 'un': { const a = ev(n.a, vars, d + 1); return n.op === '-' ? -a : (a ? 0 : 1) }
    case 'bin': {
      const a = ev(n.a, vars, d + 1)
      if (n.op === '&&') return a ? ev(n.b, vars, d + 1) : a
      if (n.op === '||') return a || ev(n.b, vars, d + 1)
      const b = ev(n.b, vars, d + 1)
      switch (n.op) {
        case '+': return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : a + b
        case '-': return a - b; case '*': return a * b
        case '/': return b === 0 ? 0 : a / b; case '%': return b === 0 ? 0 : a % b
        case '==': return a == b ? 1 : 0; case '!=': return a != b ? 1 : 0
        case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0
        case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0
      }
    }
    case 'call': { const fn = FNS[n.fn]; if (!fn) throw new Error(n.fn); return fn(...n.args.map(a => ev(a, vars, d + 1))) }
  }
}

const cache = new Map()
export function evaluate(src, vars = {}) {
  let ast = cache.get(src)
  if (!ast) { ast = parse(lex(src)); if (cache.size > 300) cache.clear(); cache.set(src, ast) }
  return ev(ast, vars)
}
export function tryEval(src, vars, fallback = null) {
  try { return evaluate(src, vars) } catch { return fallback }
}
