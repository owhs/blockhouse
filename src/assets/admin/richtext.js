// WYSIWYG rich text: contenteditable surface storing MARKDOWN.
// md→html for display, DOM→md serializer on edit. Deliberately small surface:
// p, h2–h4, bold/italic/code, links, ul/ol, blockquote.

import { h, promptDialog, toast } from './ui.js'
import { post } from './api.js'

export function mountRichtext(md, onChange, opts = {}) {
  const surface = h('div.rt-surface', { contenteditable: 'true', spellcheck: 'true' })
  surface.innerHTML = mdToHtml(md)

  const emit = () => onChange(domToMd(surface))
  surface.addEventListener('input', emit)
  surface.addEventListener('blur', () => onChange.now?.(domToMd(surface)))

  surface.addEventListener('paste', e => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  })
  surface.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); cmd('bold') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); cmd('italic') }
  })

  const cmd = (name, arg) => { surface.focus(); document.execCommand(name, false, arg); emit() }
  const block = tag => cmd('formatBlock', `<${tag}>`)

  const btn = (label, title, fn) => h('button', { type: 'button', title, onmousedown: e => e.preventDefault(), onclick: fn }, label)

  let mode = 'visual'
  const mdArea = h('textarea.mono', { rows: 10, style: { display: 'none', borderRadius: '0 0 7px 7px' }, spellcheck: 'false' })
  mdArea.addEventListener('input', () => onChange(mdArea.value))

  const toolbar = h('div.rt-toolbar', {},
    btn('B', 'Bold (⌘B)', () => cmd('bold')),
    btn('I', 'Italic (⌘I)', () => cmd('italic')),
    btn('‹›', 'Inline code', () => wrapCode(surface, emit)),
    h('span.rt-sep'),
    btn('¶', 'Paragraph', () => block('p')),
    btn('H2', 'Heading 2', () => block('h2')),
    btn('H3', 'Heading 3', () => block('h3')),
    h('span.rt-sep'),
    btn('•', 'Bullet list', () => cmd('insertUnorderedList')),
    btn('1.', 'Numbered list', () => cmd('insertOrderedList')),
    btn('❝', 'Quote', () => block('blockquote')),
    h('span.rt-sep'),
    btn('🔗', 'Link', async () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) return
      const url = await promptDialog({ title: 'Add a link', label: 'URL', placeholder: 'https://… or /path', confirmLabel: 'Link' })
      if (url) cmd('createLink', url)
    }),
    btn('⌫', 'Clear formatting', () => cmd('removeFormat')),
    h('span.rt-sep'),
    btn('✦', 'AI: improve selection or all', async e => {
      const b = e.currentTarget
      const sel = window.getSelection()
      const hasSel = sel && !sel.isCollapsed && surface.contains(sel.anchorNode)
      const text = hasSel ? sel.toString() : domToMd(surface)
      b.textContent = '…'
      try {
        const r = await post('/x/ai/assist', { task: 'improve', text })
        if (hasSel) document.execCommand('insertText', false, r.result)
        else surface.innerHTML = mdToHtml(r.result)
        emit()
      } catch (err) {
        // api.js already toasts the reason; say what it means for this button
        if (err?.status === 404) toast('The AI assist app is not installed on this site', 'err')
      }
      b.textContent = '✦'
    }),
    h('span.rt-sep'),
    btn('MD', 'Toggle markdown source', function () {
      mode = mode === 'visual' ? 'md' : 'visual'
      if (mode === 'md') { mdArea.value = domToMd(surface); surface.style.display = 'none'; mdArea.style.display = '' }
      else { surface.innerHTML = mdToHtml(mdArea.value); mdArea.style.display = 'none'; surface.style.display = '' }
      this.classList.toggle('on', mode === 'md')
    }),
  )
  return h('div', {}, toolbar, surface, mdArea)
}

function wrapCode(surface, emit) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const code = document.createElement('code')
  try {
    const range = sel.getRangeAt(0)
    range.surroundContents(code)
    emit()
  } catch {}
}

// ---------- markdown → html (editing surface subset) ----------

export function mdToHtml(md) {
  if (!md) return '<p></p>'
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => /^(https?:|\/|#|mailto:)/.test(u) ? `<a href="${u}">${t}</a>` : m)

  const lines = md.split('\n')
  const out = []
  let list = null, para = []
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null } }
  for (const line of lines) {
    const t = line.trim()
    if (!t) { flushPara(); flushList(); continue }
    const hm = /^(#{1,4})\s+(.+)/.exec(t)
    if (hm) { flushPara(); flushList(); out.push(`<h${Math.max(2, hm[1].length)}>${inline(hm[2])}</h${Math.max(2, hm[1].length)}>`); continue }
    const q = /^>\s?(.*)/.exec(t)
    if (q) { flushPara(); flushList(); out.push(`<blockquote><p>${inline(q[1])}</p></blockquote>`); continue }
    const ul = /^[-*]\s+(.+)/.exec(t)
    if (ul) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] } } list.items.push(ul[1]); continue }
    const ol = /^\d+\.\s+(.+)/.exec(t)
    if (ol) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] } } list.items.push(ol[1]); continue }
    flushList(); para.push(t)
  }
  flushPara(); flushList()
  return out.join('\n') || '<p></p>'
}

// ---------- DOM → markdown ----------

export function domToMd(root) {
  const out = []
  const inline = node => {
    let s = ''
    for (const child of node.childNodes) {
      if (child.nodeType === 3) s += child.textContent.replace(/\n/g, ' ')
      else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase()
        const inner = inline(child)
        if (tag === 'strong' || tag === 'b') s += inner.trim() ? `**${inner}**` : inner
        else if (tag === 'em' || tag === 'i') s += inner.trim() ? `*${inner}*` : inner
        else if (tag === 'code') s += `\`${child.textContent}\``
        else if (tag === 'a') s += `[${inner}](${child.getAttribute('href') || '#'})`
        else if (tag === 'br') s += '\n'
        else s += inner
      }
    }
    return s
  }
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { const t = child.textContent.trim(); if (t) out.push(t) ; continue }
      if (child.nodeType !== 1) continue
      const tag = child.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) out.push(`${'#'.repeat(Math.max(2, +tag[1]))} ${inline(child).trim()}`)
      else if (tag === 'p' || tag === 'div') { const t = inline(child).trim(); if (t) out.push(t) }
      else if (tag === 'blockquote') out.push(inline(child).trim().split('\n').map(l => `> ${l}`).join('\n'))
      else if (tag === 'ul') out.push([...child.children].map(li => `- ${inline(li).trim()}`).join('\n'))
      else if (tag === 'ol') out.push([...child.children].map((li, i) => `${i + 1}. ${inline(li).trim()}`).join('\n'))
      else { const t = inline(child).trim(); if (t) out.push(t) }
    }
  }
  walk(root)
  return out.join('\n\n')
}
