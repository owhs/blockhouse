// A real code editor for the template IDE — zero dependencies.
// Overlay architecture: a syntax-highlighted <pre> sits behind a transparent
// <textarea>; they share metrics, the textarea owns input and scrolling.
// Ships: liquid/HTML/CSS/JS highlighting, caret-anchored autocomplete,
// colour swatches (click to open a picker), beautify, snippets, and a
// context bar that explains the token under the caret.

import { h, sc } from './ui.js'

// ---------- language data ----------

export const LIQUID = {
  tags: [
    ['if', 'Conditional — {% if x %} … {% elsif %} … {% else %} … {% endif %}'],
    ['elsif', 'Extra branch of an if'],
    ['else', 'Fallback branch'],
    ['endif', 'Closes an if'],
    ['for', 'Loop — {% for item in list %} … {% endfor %}'],
    ['endfor', 'Closes a for'],
    ['assign', 'Set a variable — {% assign x = doc.title %}'],
    ['include', "Render a partial — {% include 'partials/header' %}"],
    ['region', "A block region documents fill — {% region 'content' %}"],
    ['menu', "Render a menu — {% menu 'main' %}"],
    ['slot', "Site-chrome insertion point — {% slot 'footer.social' %} (filled in Header & footer)"],
    ['comment', 'Ignored — {% comment %} … {% endcomment %}'],
    ['endcomment', 'Closes a comment'],
    ['raw', 'Output braces literally'],
    ['endraw', 'Closes raw'],
  ],
  filters: [
    ['md', 'Markdown → HTML. {{ props.text | md }}'],
    ['e', 'HTML-escape (alias: escape)'],
    ['escape', 'HTML-escape'],
    ['excerpt', 'First N words of markdown, plain. {{ doc.body | excerpt: 32 }}'],
    ['date', "Format a date. {{ doc.publishedAt | date: '%b %e, %Y' }}"],
    ['img', "Media id → responsive <img>. {{ fields.cover | img: width: 1200 }}"],
    ['asset', "Template asset URL. {{ 'base.css' | asset }}"],
    ['icon', 'Site icon set by name. {{ \'arrow\' | icon: 18 }}'],
    ['docpath', 'Document → its URL'],
    ['slug', 'Slugify a string'],
    ['json', 'JSON-encode'],
    ['default', "Fallback value. {{ x | default: 'none' }}"],
    ['upcase', 'UPPER CASE'], ['downcase', 'lower case'], ['capitalize', 'First letter up'],
    ['truncate', 'Cut to N chars. {{ x | truncate: 80 }}'],
    ['strip_html', 'Remove tags'], ['size', 'Length of list/string'],
    ['first', 'First item'], ['last', 'Last item'], ['join', "Join list. {{ list | join: ', ' }}"],
    ['where', "Filter list by property. {{ docs | where: 'concept', 'post' }}"],
    ['replace', 'Replace substring'], ['append', 'Append string'], ['prepend', 'Prepend string'],
    ['plus', 'Add'], ['minus', 'Subtract'], ['times', 'Multiply'], ['divided_by', 'Divide'],
    ['round', 'Round'], ['money', 'Format as currency'], ['number', 'Format number'],
  ],
  variables: [
    ['site', 'Site config — site.name, site.tagline, site.url, site.vars.*'],
    ['doc', 'Current document — doc.title, doc.slug, doc.publishedAt'],
    ['fields', 'The document\'s custom fields — fields.<key>'],
    ['props', 'Block properties (inside block templates)'],
    ['features', 'The Features switchboard — features.rss, features.themeToggle…'],
    ['vars', 'Brand variables from Design'],
    ['main', 'The rendered page body (layout only)'],
    ['head', 'SEO head tags (layout only)'],
    ['lang', 'Site language code'],
    ['body_attrs', 'Attributes blockhouse needs on <body> (layout only)'],
    ['show_theme_toggle', 'True when the visitor theme toggle should render'],
    ['docs', 'The page of documents (list templates)'],
    ['pagination', 'pagination.page / pages / prev / next (list templates)'],
  ],
}

// ---------- tokenizers (line-based, tiny state machines) ----------

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const span = (cls, text) => `<span class="tk-${cls}">${esc(text)}</span>`

const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|\b(?:oklch|rgb|rgba|hsl|hsla)\([^)]*\)|\blight-dark\([^)]*\))/g

function paintColors(html) {
  // operate on already-escaped html; colour literals contain no &<> except none
  return html.replace(COLOR_RE, m =>
    `<span class="tk-swatch" data-color="${m.replace(/"/g, '&quot;')}" style="--sw:${m.replace(/"/g, '&quot;')}"></span>${m}`)
}

function hlLiquid(src) {
  // highlight {{ … }} and {% … %} islands, then HTML around them
  let out = ''
  let i = 0
  const re = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g
  let m
  while ((m = re.exec(src))) {
    out += hlHtml(src.slice(i, m.index))
    const body = m[0]
    out += `<span class="tk-liq">${hlLiquidIsland(body)}</span>`
    i = m.index + body.length
  }
  out += hlHtml(src.slice(i))
  return out
}

const LIQ_KW = new Set(['if', 'elsif', 'else', 'endif', 'unless', 'endunless', 'for', 'endfor', 'in', 'assign', 'include', 'region', 'menu', 'slot', 'comment', 'endcomment', 'raw', 'endraw', 'and', 'or', 'contains'])
function hlLiquidIsland(body) {
  // token-at-a-time so generated spans are never re-scanned
  let out = esc(body.slice(0, 2))
  const inner = body.slice(2, -2)
  const re = /('[^']*'|"[^"]*"|\|\s*[a-z_]+|[a-zA-Z_][a-zA-Z0-9_.]*|\s+|.)/g
  let m
  while ((m = re.exec(inner))) {
    const t = m[0]
    if (t[0] === "'" || t[0] === '"') out += span('str', t)
    else if (t[0] === '|') { const f = t.match(/[a-z_]+$/)[0]; out += esc(t.slice(0, t.length - f.length)) + span('fn', f) }
    else if (LIQ_KW.has(t)) out += span('kw', t)
    else out += esc(t)
  }
  out += esc(body.slice(-2))
  return out
}

function hlHtml(src) {
  let out = ''
  const re = /(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>)/g
  let i = 0, m
  while ((m = re.exec(src))) {
    out += esc(src.slice(i, m.index))
    const t = m[0]
    if (t.startsWith('<!--')) out += span('com', t)
    else out += hlTag(t)
    i = m.index + t.length
  }
  out += esc(src.slice(i))
  return out
}

function hlTag(t) {
  // <  /?name  (attr(="value")?)*  /?>  — built token-by-token, never re-scanned
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>$/.exec(t)
  if (!m) return esc(t)
  const [, slash, name, attrs, selfSlash] = m
  let out = `&lt;${slash}` + span('tag', name)
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(=)("[^"]*"|'[^']*'|[^\s>]*)|(\s+)|(.)/g
  let am
  while ((am = re.exec(attrs))) {
    if (am[1] != null) out += span('attr', am[1]) + '=' + span('str', am[3] ?? '')
    else if (am[4] != null) out += am[4]
    else out += esc(am[5])
  }
  return out + `${selfSlash}&gt;`
}

function hlCss(src) {
  let out = esc(src)
  out = out.replace(/\/\*[\s\S]*?\*\//g, m => span('com', m).replaceAll('&amp;', '&'))
  out = out.replace(/(^|[{;}\s])(--[a-zA-Z0-9-]+)/g, (_, p, v) => `${p}<span class="tk-var">${v}</span>`)
  out = out.replace(/([a-z-]+)(\s*:)/g, (m, p, c) => (m.includes('tk-') ? m : `<span class="tk-attr">${p}</span>${c}`))
  out = out.replace(/(@[a-z-]+)/g, `<span class="tk-kw">$1</span>`)
  out = paintColors(out)
  return out
}

function hlJs(src) {
  let out = ''
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g
  let i = 0, m
  while ((m = re.exec(src))) {
    out += hlJsCode(src.slice(i, m.index))
    const t = m[0]
    out += t[0] === '/' && (t[1] === '/' || t[1] === '*') ? span('com', t) : span('str', t)
    i = m.index + t.length
  }
  out += hlJsCode(src.slice(i))
  return out
}
function hlJsCode(s) {
  return esc(s)
    .replace(/\b(const|let|var|function|return|if|else|for|while|of|in|new|class|await|async|import|from|export|try|catch|throw|typeof|=&gt;)\b/g, `<span class="tk-kw">$1</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g, `<span class="tk-num">$1</span>`)
}

export function highlight(src, rel) {
  if (/\.css$/.test(rel)) return hlCss(src)
  if (/\.js$/.test(rel)) return hlJs(src)
  if (/\.(json|svg)$/.test(rel)) return hlHtml(src)
  return hlLiquid(src)
}

// ---------- beautify ----------

export function beautify(src, rel) {
  if (/\.css$/.test(rel)) return beautifyCss(src)
  if (/\.json$/.test(rel)) { try { return JSON.stringify(JSON.parse(src), null, 2) + '\n' } catch { return src } }
  if (/\.js$/.test(rel)) return src   // leave JS alone — reformatting can change semantics
  return beautifyMarkup(src)
}

function beautifyCss(src) {
  const out = []
  let depth = 0
  const lines = src
    .replace(/\{\s*/g, ' {\n').replace(/;\s*(?![^(]*\))/g, ';\n').replace(/\s*\}/g, '\n}\n')
    .split('\n')
  for (let raw of lines) {
    const line = raw.trim()
    if (!line) { if (out[out.length - 1] !== '') out.push(''); continue }
    if (line.startsWith('}')) depth = Math.max(0, depth - 1)
    out.push('  '.repeat(depth) + line)
    if (line.endsWith('{')) depth++
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function beautifyMarkup(src) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
  const OPENERS = /\{%\s*(if|for|comment|raw)\b/
  const CLOSERS = /\{%\s*end(if|for|comment|raw)\b/
  const MID = /\{%\s*(else|elsif)\b/
  const tokens = src.split(/(<[^>]+>|\{%[\s\S]*?%\})/g).filter(t => t !== '')
  const out = []
  let depth = 0
  let line = ''
  const flush = () => { if (line.trim()) out.push('  '.repeat(Math.max(0, depth)) + line.trim()); line = '' }
  for (const t of tokens) {
    const isTag = t.startsWith('<') && t.endsWith('>')
    const isLiq = t.startsWith('{%')
    if (isTag) {
      const name = (t.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/) || [])[1]?.toLowerCase()
      const closing = t.startsWith('</')
      const selfClosed = t.endsWith('/>') || VOID.has(name)
      if (closing) { flush(); depth = Math.max(0, depth - 1); line = t; flush() }
      else { flush(); line = t; flush(); if (!selfClosed) depth++ }
    } else if (isLiq) {
      if (CLOSERS.test(t)) { flush(); depth = Math.max(0, depth - 1); line = t; flush() }
      else if (MID.test(t)) { flush(); depth = Math.max(0, depth - 1); line = t; flush(); depth++ }
      else if (OPENERS.test(t)) { flush(); line = t; flush(); depth++ }
      else { flush(); line = t; flush() }
    } else {
      for (const part of t.split('\n')) { const p = part.trim(); if (p) { flush(); line = p; flush() } }
    }
  }
  flush()
  return out.join('\n') + '\n'
}

// ---------- the editor component ----------

export function codeEditor({ rel, value, onChange, onSave, context }) {
  // context: { partials: [], menus: [], slots: [], fieldsByConcept: {}, cssVars: [] }
  const ta = h('textarea.ide-ta', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' })
  const hl = h('div.ide-hl', { 'aria-hidden': 'true' })
  const gutter = h('div.ide-gutter', { 'aria-hidden': 'true' })
  const ctxBar = h('div.ide-ctx')
  const popup = h('div.ide-pop', { hidden: true })
  const surface = h('div.ide-surface', {}, hl, ta)
  const wrap = h('div.ide-wrap', {}, gutter, surface, popup)
  const rootEl = h('div.ide-root', {}, wrap, ctxBar)
  ta.value = value

  let lang = rel
  const paint = () => {
    hl.innerHTML = highlight(ta.value, lang) + '\n&nbsp;'
    const n = (ta.value.match(/\n/g) || []).length + 1
    if (gutter.childElementCount !== n) gutter.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', {}, String(i + 1))))
  }
  const sync = () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    gutter.style.transform = `translateY(${-ta.scrollTop}px)`
    if (!popup.hidden) positionPop()   // follow the caret instead of vanishing
  }
  ta.addEventListener('scroll', sync)

  // ---------- caret coordinates (mirror technique) ----------
  let mirror = null
  const caretXY = () => {
    if (!mirror) {
      mirror = h('div.ide-mirror', { 'aria-hidden': 'true' })
      surface.appendChild(mirror)
    }
    const upTo = ta.value.slice(0, ta.selectionStart)
    mirror.textContent = upTo
    const dot = h('span', {}, '​')
    mirror.appendChild(dot)
    const x = dot.offsetLeft - ta.scrollLeft
    const y = dot.offsetTop - ta.scrollTop
    return { x, y }
  }

  // ---------- autocomplete ----------
  let popItems = []
  let popIndex = 0
  const hidePop = () => { popup.hidden = true; popItems = [] }
  const positionPop = () => {
    const { x, y } = caretXY()
    popup.style.left = Math.max(4, Math.min(x + gutter.offsetWidth + 8, wrap.clientWidth - 290)) + 'px'
    popup.style.top = Math.max(4, Math.min(y + 22, wrap.clientHeight - popup.offsetHeight - 8)) + 'px'
  }
  const showPop = (items, replaceFrom) => {
    if (!items.length) return hidePop()
    popItems = items.slice(0, 12)
    popIndex = 0
    popup.replaceChildren(...popItems.map((it, i) => h('button.ide-pop-item', {
      class: i === 0 ? 'active' : '',
      onmousedown: e => { e.preventDefault(); accept(i, replaceFrom) },
    },
      h('span.ide-pop-label', {}, it.label),
      it.hint ? h('span.ide-pop-hint', {}, it.hint) : '')))
    popup.hidden = false
    positionPop()
    popup.dataset.from = String(replaceFrom)
  }
  const accept = (i, from = Number(popup.dataset.from)) => {
    const it = popItems[i]
    if (!it) return
    const insert = it.insert ?? it.label
    const end = ta.selectionStart
    ta.value = ta.value.slice(0, from) + insert + ta.value.slice(end)
    const pos = from + insert.length + (it.caretBack || 0) * -1
    ta.selectionStart = ta.selectionEnd = it.caretBack ? from + insert.length - it.caretBack : from + insert.length
    hidePop(); fire(); paint()
  }

  const wordFrom = () => {
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const m = /[a-zA-Z0-9_.-]*$/.exec(before)
    return { word: m ? m[0] : '', from: pos - (m ? m[0].length : 0), before }
  }

  const complete = () => {
    const { word, from, before } = wordFrom()
    const items = []
    const push = (label, hint, insert, caretBack) => items.push({ label, hint, insert, caretBack })
    const liqTag = /\{%\s*[a-z]*$/.test(before)
    const inLiqIsland = (() => {
      const o = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'))
      if (o < 0) return null
      const c = Math.max(before.lastIndexOf('}}'), before.lastIndexOf('%}'))
      return c < o ? before.slice(o) : null
    })()

    if (/include\s+'[^']*$/.test(before)) {
      for (const p of context.partials || []) if (p.includes(word) || !word) push(p, 'partial', p.replace(/\.liquid$/, ''))
      return showPop(items.filter(i => i.insert.includes(word) || !word), from)
    }
    if (/menu\s+'[^']*$/.test(before)) {
      for (const [key, label] of context.menus || []) push(key, label)
      return showPop(items.filter(i => i.label.startsWith(word)), from)
    }
    if (/slot\s+'[^']*$/.test(before)) {
      for (const s of context.slots || []) push(s, 'slot')
      return showPop(items.filter(i => i.label.startsWith(word)), from)
    }
    if (/var\(--[a-zA-Z0-9-]*$/.test(before) && /\.css$/.test(lang)) {
      const vfrom = ta.selectionStart - (before.match(/--[a-zA-Z0-9-]*$/)?.[0].length || 0)
      for (const v of context.cssVars || []) if (v.startsWith(before.match(/--[a-zA-Z0-9-]*$/)?.[0] || '--')) push(v, 'token')
      return showPop(items, vfrom)
    }
    if (inLiqIsland) {
      if (/\|\s*[a-z_]*$/.test(before)) {
        for (const [f, doc] of LIQUID.filters) if (f.startsWith(word)) push(f, doc.split('.')[0])
        return showPop(items, from)
      }
      if (liqTag) {
        for (const [t, doc] of LIQUID.tags) if (t.startsWith(word)) push(t, doc.split('—')[0].trim())
        return showPop(items, from)
      }
      // variable path completion
      const path = before.match(/([a-zA-Z_][a-zA-Z0-9_.]*)$/)?.[1] || ''
      if (path.includes('.')) {
        const [head] = path.split('.')
        if (head === 'fields') {
          for (const [ck, fs] of Object.entries(context.fieldsByConcept || {}))
            for (const f of fs) push(`fields.${f}`, ck, `fields.${f}`)
        } else if (head === 'site') {
          for (const p of ['site.name', 'site.tagline', 'site.url', 'site.language', 'site.template', 'site.vars']) push(p, 'site config')
        } else if (head === 'doc') {
          for (const p of ['doc.title', 'doc.slug', 'doc.publishedAt', 'doc.updatedAt', 'doc.id']) push(p, 'document')
        } else if (head === 'features') {
          for (const p of ['features.rss', 'features.sitemap', 'features.prefetch', 'features.viewTransitions', 'features.themeToggle', 'features.searchOpenSearch']) push(p, 'switchboard')
        } else if (head === 'pagination') {
          for (const p of ['pagination.page', 'pagination.pages', 'pagination.prev', 'pagination.next']) push(p, 'list pages')
        }
        return showPop(items.filter(i => i.label.startsWith(path)), ta.selectionStart - path.length)
      }
      for (const [v, doc] of LIQUID.variables) if (v.startsWith(word)) push(v, doc.split('—')[0].trim())
      return showPop(items, from)
    }
    hidePop()
  }

  // ---------- context bar (what is the caret on?) ----------
  const explain = () => {
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const island = (() => {
      const o = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('{%'))
      if (o < 0) return null
      const rest = ta.value.slice(o)
      const end = rest.search(/\}\}|%\}/)
      return end < 0 ? null : rest.slice(0, end + 2)
    })()
    let text = ''
    if (island) {
      const filt = island.match(/\|\s*([a-z_]+)/g)?.pop()?.replace(/\|\s*/, '')
      const tag = island.match(/\{%\s*([a-z]+)/)?.[1]
      const vr = island.match(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)/)?.[1]
      const fdoc = filt && LIQUID.filters.find(([f]) => f === filt)?.[1]
      const tdoc = tag && LIQUID.tags.find(([t]) => t === tag)?.[1]
      const vdoc = vr && LIQUID.variables.find(([v]) => vr.startsWith(v))?.[1]
      text = fdoc ? `| ${filt} — ${fdoc}` : tdoc ? `{% ${tag} %} — ${tdoc}` : vdoc ? `${vr.split('.')[0]} — ${vdoc}` : ''
    }
    ctxBar.textContent = text || sc('Ctrl+Space — complete · ⌘S — save · ⇧⌥F — beautify. Liquid: {{ output | filter }} · {% tag %}')
    ctxBar.classList.toggle('has-doc', !!text)
  }

  // ---------- events ----------
  const fire = () => onChange?.(ta.value)
  ta.addEventListener('input', () => { paint(); fire(); complete(); explain() })
  ta.addEventListener('click', () => { hidePop(); explain() })
  ta.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { hidePop(); explain() } })
  ta.addEventListener('keydown', e => {
    if (!popup.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        popIndex = (popIndex + (e.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length
        ;[...popup.children].forEach((el, i) => el.classList.toggle('active', i === popIndex))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(popIndex); return }
      if (e.key === 'Escape') { e.preventDefault(); hidePop(); return }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); complete(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave?.(); return }
    if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
      e.preventDefault()
      const pos = ta.selectionStart
      ta.value = beautify(ta.value, lang)
      ta.selectionStart = ta.selectionEnd = Math.min(pos, ta.value.length)
      paint(); fire(); return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const { selectionStart: st, selectionEnd: en, value } = ta
      ta.value = value.slice(0, st) + '  ' + value.slice(en)
      ta.selectionStart = ta.selectionEnd = st + 2
      paint(); fire(); return
    }
    if (e.key === 'Enter') {
      // keep indentation
      const st = ta.selectionStart
      const lineStart = ta.value.lastIndexOf('\n', st - 1) + 1
      const indent = (ta.value.slice(lineStart, st).match(/^\s*/) || [''])[0]
      e.preventDefault()
      ta.value = ta.value.slice(0, st) + '\n' + indent + ta.value.slice(ta.selectionEnd)
      ta.selectionStart = ta.selectionEnd = st + 1 + indent.length
      paint(); fire(); return
    }
  })

  // colour swatch clicks (swatches are pointer-enabled inside the overlay)
  hl.addEventListener('mousedown', e => {
    const sw = e.target.closest('.tk-swatch')
    if (!sw) return
    e.preventDefault()
    const color = sw.dataset.color
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return   // native picker only speaks 6-digit hex
    const input = h('input.offscreen-color', { type: 'color', value: color })
    document.body.appendChild(input)
    input.addEventListener('input', () => {
      const idx = ta.value.indexOf(color)
      if (idx >= 0) { ta.value = ta.value.slice(0, idx) + input.value + ta.value.slice(idx + color.length); paint(); fire() }
    })
    input.addEventListener('change', () => input.remove())
    input.click()
  })

  paint(); explain()

  return {
    el: rootEl,
    get value() { return ta.value },
    set value(v) { ta.value = v; paint(); sync() },
    setLang(r) { lang = r; paint() },
    focus: () => ta.focus(),
    insert(text, caretBack = 0) {
      const st = ta.selectionStart
      ta.value = ta.value.slice(0, st) + text + ta.value.slice(ta.selectionEnd)
      ta.selectionStart = ta.selectionEnd = st + text.length - caretBack
      ta.focus(); paint(); fire()
    },
    beautify() { ta.value = beautify(ta.value, lang); paint(); fire() },
  }
}
