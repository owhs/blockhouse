// Core unit tests — run with `bun test` (or `node --import tsx --test` on Node).
import { test, expect } from 'bun:test'
import { evaluate, tryEvaluate } from '../src/core/expr.ts'
import { sanitizeHtml, sanitizeSvg } from '../src/core/sanitize.ts'
import { slugify, normalizePath, fillPattern, deepMerge, timingSafeEqual } from '../src/core/util.ts'
import { can } from '../src/core/permissions.ts'
import { LiquidLite } from '../src/vendor/liquid.ts'
import { renderMarkdown } from '../src/vendor/markdown.ts'
import { hashPassword, verifyPassword } from '../src/auth/hash.ts'
import type { User } from '../src/core/types.ts'

// ---------- expressions ----------

test('expr: arithmetic and precedence', () => {
  expect(evaluate('2 + 3 * 4')).toBe(14)
  expect(evaluate('(2 + 3) * 4')).toBe(20)
  expect(evaluate('10 / 4')).toBe(2.5)
  expect(evaluate('10 / 0')).toBe(0) // safe division
})

test('expr: variables, functions, conditionals', () => {
  expect(evaluate('round(qty * unit * (1 - discount / 100), 2)', { qty: 3, unit: 24000, discount: 10 })).toBe(64800)
  expect(evaluate('if(qty > 2, "bulk", "single")', { qty: 3 })).toBe('bulk')
  expect(evaluate('min(3, 8) + max(1, 2)')).toBe(5)
  expect(evaluate('len(concat("a", "bc"))')).toBe(3)
})

test('expr: rejects dangerous refs and bad input', () => {
  expect(() => evaluate('__proto__.polluted')).toThrow()
  expect(() => evaluate('constructor.constructor')).toThrow()
  expect(tryEvaluate('1 +', {}, 'fallback')).toBe('fallback')
  expect(() => evaluate('unknown_fn(1)')).toThrow()
})

// ---------- sanitizer ----------

test('sanitize: strips scripts and event handlers', () => {
  expect(sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
  expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  expect(sanitizeHtml('<img src="https://x.y/a.png" alt="ok">')).toContain('src="https://x.y/a.png"')
  expect(sanitizeHtml('<iframe src="https://evil.example/"></iframe>')).not.toContain('evil')
  expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toContain('youtube')
})

test('sanitize: svg keeps shapes, drops scripts', () => {
  const svg = sanitizeSvg('<svg viewBox="0 0 10 10"><script>bad()</script><circle cx="5" cy="5" r="4" fill="currentColor"/><foreignObject>no</foreignObject></svg>')
  expect(svg).toContain('<circle')
  expect(svg).not.toContain('script')
  expect(svg).not.toContain('foreignObject')
  expect(sanitizeSvg('<div>not svg</div>')).toBe('')
})

// ---------- util ----------

test('util: slugify + paths + patterns', () => {
  expect(slugify('Héllo, Wörld — 2026!')).toBe('hello-world-2026')
  expect(normalizePath('blog//post/')).toBe('/blog/post')
  expect(fillPattern('/blog/{slug}', { slug: 'x' })).toBe('/blog/x')
  expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } } as any)).toEqual({ a: { b: 1, c: 3 } })
  expect(timingSafeEqual('abc', 'abc')).toBe(true)
  expect(timingSafeEqual('abc', 'abd')).toBe(false)
})

// ---------- permissions ----------

const u = (role: User['role'], extra: Partial<User> = {}): User =>
  ({ id: 'u1', email: 'x@y.z', name: 'x', role, active: true, createdAt: '', ...extra })

test('permissions: role ladder', () => {
  expect(can(u('viewer'), 'content.read')).toBe(true)
  expect(can(u('viewer'), 'content.write')).toBe(false)
  expect(can(u('author'), 'content.publish')).toBe(false)
  expect(can(u('editor'), 'content.publish')).toBe(true)
  expect(can(u('editor'), 'users.manage')).toBe(false)
  expect(can(u('admin'), 'users.manage')).toBe(true)
  expect(can(null, 'content.read')).toBe(false)
  expect(can(u('editor', { active: false }), 'content.read')).toBe(false)
})

test('permissions: own-content escape hatch + plugin wildcard', () => {
  expect(can(u('author'), 'content.write', { ownerId: 'u1' })).toBe(true)
  expect(can(u('author'), 'content.write', { ownerId: 'someone-else' })).toBe(false)
  expect(can(u('editor'), 'plugin:forms.manage')).toBe(true)
  expect(can(u('author'), 'plugin:forms.manage')).toBe(false)
  expect(can(u('author', { grants: ['plugin:forms.manage'] }), 'plugin:forms.manage')).toBe(true)
})

// ---------- liquid-lite ----------

const engine = () => new LiquidLite({ read: async () => null })

test('liquid: outputs, filters, kwargs', async () => {
  const e = engine()
  expect(await e.parseAndRender('Hello {{ name | upcase }}!', { name: 'ada' })).toBe('Hello ADA!')
  expect(await e.parseAndRender('{{ missing | default: "fallback" }}', {})).toBe('fallback')
  expect(await e.parseAndRender('{{ t | truncate: 5 }}', { t: 'abcdefgh' })).toBe('abcd…')
  e.registerFilter('kw', (v, _a, kwargs) => `${v}:${kwargs.size}`)
  expect(await e.parseAndRender('{{ "x" | kw: size: 9 }}', {})).toBe('x:9')
})

test('liquid: control flow', async () => {
  const e = engine()
  expect(await e.parseAndRender('{% if a > 2 %}big{% elsif a == 2 %}two{% else %}small{% endif %}', { a: 2 })).toBe('two')
  expect(await e.parseAndRender('{% for x in xs %}[{{ x.n }}]{% endfor %}', { xs: [{ n: 1 }, { n: 2 }] })).toBe('[1][2]')
  expect(await e.parseAndRender('{% assign t = "div" %}<{{ t }}>', {})).toBe('<div>')
  expect(await e.parseAndRender('{% if a and b %}y{% endif %}', { a: 1, b: 1 })).toBe('y')
  expect(await e.parseAndRender('{% if a and b %}y{% else %}n{% endif %}', { a: 1, b: 0 })).toBe('n')
})

test('liquid: custom tags get evaluated args + scope', async () => {
  const e = engine()
  e.registerTag('shout', async (arg, scope) => `${String(arg).toUpperCase()}-${scope.suffix}`)
  expect(await e.parseAndRender('{% shout "hi" %}', { suffix: 'x' })).toBe('HI-x')
})

test('liquid: date filter', async () => {
  const e = engine()
  expect(await e.parseAndRender("{{ d | date: '%b %e, %Y' }}", { d: '2026-08-08T12:00:00Z' })).toMatch(/Aug 8, 2026/)
})

// ---------- markdown ----------

test('markdown: block + inline elements', () => {
  const html = renderMarkdown('## Title\n\nSome **bold** and *em* and `code`.\n\n- one\n- two\n\n> quoted\n\n```js\nlet x = 1 < 2\n```')
  expect(html).toContain('<h2>Title</h2>')
  expect(html).toContain('<strong>bold</strong>')
  expect(html).toContain('<em>em</em>')
  expect(html).toContain('<li>one</li>')
  expect(html).toContain('<blockquote>')
  expect(html).toContain('language-js')
  expect(html).toContain('1 &lt; 2') // code content escaped
})

test('markdown: links restricted to safe protocols', () => {
  expect(renderMarkdown('[x](https://a.b)')).toContain('href="https://a.b"')
  expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript')
})

// ---------- password hashing ----------

test('auth: pbkdf2 hash roundtrip', async () => {
  const stored = await hashPassword('correct horse', 1000) // low iters for test speed
  expect(await verifyPassword('correct horse', stored)).toBe(true)
  expect(await verifyPassword('wrong', stored)).toBe(false)
  expect(stored.startsWith('pbkdf2$sha256$1000$')).toBe(true)
})

// ---------- expression aggregates (data line-items) ----------
test('expr: aggregates over line items', () => {
  const vars = { lines: [{ total: 100 }, { total: 250 }, { total: 50 }], qty: [1, 2, 3] }
  expect(evaluate('sum(lines, "total")', vars)).toBe(400)
  expect(evaluate('count(lines)', vars)).toBe(3)
  expect(evaluate('round(avg(lines, "total"), 2)', vars)).toBeCloseTo(133.33, 2)
  expect(evaluate('round(sum(lines, "total") * 1.2, 2)', vars)).toBe(480)
})

// ---------- search ranking ----------
import { rank } from '../../plugins/search/index.ts'
test('search: ranks title matches highest', () => {
  const entries = [
    { path: '/a', title: 'Dark mode design', excerpt: '', concept: 'post', text: 'dark mode design themes' },
    { path: '/b', title: 'Something else', excerpt: '', concept: 'post', text: 'mentions dark once' },
    { path: '/c', title: 'Unrelated', excerpt: '', concept: 'post', text: 'nothing here' },
  ]
  const r = rank(entries, 'dark')
  expect(r[0].path).toBe('/a')
  expect(r.length).toBe(2)
})

// ---------- validator ----------
import { validateSite } from '../src/agent/validate.ts'
test('validate: exists as a function', () => { expect(typeof validateSite).toBe('function') })

// ---------- restore points: what counts as a change ----------
// R16-1: opening the inspector used to write `layout: {}` onto the selected
// block, so pressing Save on a page nobody had edited made a new version and
// told the owner to republish. An empty holder is not content.
import { docFingerprint } from '../src/storage/content.ts'
const baseDoc = (blocks: any[]) => ({ id: 'd1', concept: 'page', slug: 'about', title: 'About', status: 'published', blocks }) as any

test('docFingerprint: an empty layout object is not a change', () => {
  expect(docFingerprint(baseDoc([{ id: 'b1', type: 'richtext', props: { md: 'hi' }, layout: {} }])))
    .toBe(docFingerprint(baseDoc([{ id: 'b1', type: 'richtext', props: { md: 'hi' } }])))
})

test('docFingerprint: empty props, seo, access and custom are not changes', () => {
  const bare = baseDoc([{ id: 'b1', type: 'spacer' }])
  const padded = { ...baseDoc([{ id: 'b1', type: 'spacer', props: {} }]), seo: {}, access: {}, custom: {}, aliases: [] }
  expect(docFingerprint(padded)).toBe(docFingerprint(bare))
})

test('docFingerprint: a real width is still a change', () => {
  expect(docFingerprint(baseDoc([{ id: 'b1', type: 'richtext', layout: { width: 'wide' } }])))
    .not.toBe(docFingerprint(baseDoc([{ id: 'b1', type: 'richtext', layout: {} }])))
})

test('docFingerprint: list positions survive an empty entry', () => {
  expect(docFingerprint(baseDoc([{ id: 'b1', type: 'x' }, {}, { id: 'b2', type: 'y' }])))
    .not.toBe(docFingerprint(baseDoc([{ id: 'b1', type: 'x' }, { id: 'b2', type: 'y' }])))
})

// R17-2: an edit and its undo left the page identical to the live copy, but
// `hasUnpublishedChanges` compared version numbers, so the studio still said
// "Published · edited" and asked the owner to republish nothing at all.
import { publishFingerprint } from '../src/storage/content.ts'
const published = { ...baseDoc([{ id: 'b1', type: 'richtext', props: { md: 'hi' } }]), version: 4, updatedAt: '2026-01-01T00:00:00.000Z', status: 'published' } as any

test('publishFingerprint: an edit that was undone is not an unpublished change', () => {
  // Two autosaves later: same words, higher version, newer timestamp.
  const reverted = { ...published, version: 6, updatedAt: '2026-02-02T10:00:00.000Z' }
  expect(publishFingerprint(reverted)).toBe(publishFingerprint(published))
})

test('publishFingerprint: a draft working copy of the same words is not a change', () => {
  expect(publishFingerprint({ ...published, status: 'draft', version: 5 })).toBe(publishFingerprint(published))
})

test('publishFingerprint: a real edit is still an unpublished change', () => {
  const edited = { ...published, version: 5, title: 'About us' }
  expect(publishFingerprint(edited)).not.toBe(publishFingerprint(published))
  expect(publishFingerprint({ ...published, version: 5, blocks: [{ id: 'b1', type: 'richtext', props: { md: 'hi there' } }] }))
    .not.toBe(publishFingerprint(published))
})
