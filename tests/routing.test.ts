// Routing, access control, config layering and page-weight tests.
import { test, expect } from 'bun:test'
import { docPathFor, hrefFor, exportFileFor, shortCode, shortPath, canonicalizeRequestPath } from '../src/core/urls.ts'
import { canView, isGated, memberAllowed } from '../src/core/access.ts'
import { mergeConfig, envOverrides, DEFAULT_CONFIG } from '../src/core/config.ts'
import { ContentStore } from '../src/storage/content.ts'
import { MemoryDriver } from '../src/storage/memory.ts'
import { deployInit, TARGETS } from '../src/cli/deploy-init.ts'
import type { ConceptDef, Doc, SiteConfig } from '../src/core/types.ts'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const site = (over: Partial<SiteConfig> = {}) => mergeConfig(over as any)
const doc = (over: Partial<Doc> = {}): Doc => ({
  id: 'd1', concept: 'page', slug: 'about', title: 'About', status: 'published',
  fields: {}, blocks: [], seo: {}, createdAt: '', updatedAt: '', version: 1, ...over,
} as Doc)
const page: ConceptDef = { name: 'page', label: 'Page', urlPattern: '/{slug}', fields: [] } as any
const post: ConceptDef = { name: 'post', label: 'Post', urlPattern: '/blog/{slug}', fields: [] } as any

// ---------- URL strategy ----------

test('urls: pattern vs flat layout', () => {
  expect(docPathFor(doc({ concept: 'post', slug: 'hello' }), post, site())).toBe('/blog/hello')
  expect(docPathFor(doc({ concept: 'post', slug: 'hello' }), post, site({ urls: { layout: 'flat' } }))).toBe('/hello')
})

test('urls: home doc always resolves to /', () => {
  expect(docPathFor(doc({ id: 'h' }), page, site({ homeDocId: 'h' }))).toBe('/')
})

test('urls: lowercase normalisation can be turned off', () => {
  expect(docPathFor(doc({ slug: 'MixedCase' }), page, site())).toBe('/mixedcase')
  expect(docPathFor(doc({ slug: 'MixedCase' }), page, site({ urls: { lowercase: false } }))).toBe('/MixedCase')
})

test('urls: href style — directory, extension, bare', () => {
  expect(hrefFor('/about', site())).toBe('/about/')
  expect(hrefFor('/about', site({ urls: { style: 'extension' } }))).toBe('/about.html')
  expect(hrefFor('/about', site({ urls: { style: 'bare' } }))).toBe('/about')
  expect(hrefFor('/', site())).toBe('/')
})

test('urls: trailingSlash:false drops the slash in directory style', () => {
  expect(hrefFor('/about', site({ build: { trailingSlash: false } }))).toBe('/about')
})

test('urls: basePath prefixes every href', () => {
  expect(hrefFor('/about', site({ build: { basePath: '/docs' } }))).toBe('/docs/about/')
  expect(hrefFor('/', site({ build: { basePath: '/docs' } }))).toBe('/docs/')
})

test('urls: export filename follows the style', () => {
  expect(exportFileFor('/', site())).toBe('index.html')
  expect(exportFileFor('/blog/x', site())).toBe('blog/x/index.html')
  expect(exportFileFor('/blog/x', site({ urls: { style: 'extension' } }))).toBe('blog/x.html')
})

test('urls: shortcodes are stable, short and prefix-configurable', () => {
  const a = shortCode('dabc123'), b = shortCode('dabc123')
  expect(a).toBe(b)
  expect(a.length).toBe(7)
  expect(shortCode('dabc124')).not.toBe(a)
  expect(shortPath('dabc123', site())).toBe(`/s/${a}`)
  expect(shortPath('dabc123', site({ urls: { shortlinkPrefix: 'go' } }))).toBe(`/go/${a}`)
})

test('urls: incoming request paths canonicalize across every style', () => {
  for (const p of ['/about', '/about/', '/about.html', '/about/index.html']) {
    expect(canonicalizeRequestPath(p)).toBe('/about')
  }
  expect(canonicalizeRequestPath('/')).toBe('/')
  expect(canonicalizeRequestPath('/index.html')).toBe('/')
  expect(canonicalizeRequestPath('/blog/a%20b')).toBe('/blog/a b')
})

// ---------- access control ----------

test('access: public documents are visible to everyone', () => {
  expect(isGated(doc())).toBe(false)
  expect(canView(doc(), {})).toBe(true)
  expect(canView(doc({ access: { mode: 'public' } }), {})).toBe(true)
})

test('access: members-only needs a signed-in member', () => {
  const d = doc({ access: { mode: 'members' } })
  expect(isGated(d)).toBe(true)
  expect(canView(d, {})).toBe(false)
  expect(canView(d, { member: { id: 'm1' } })).toBe(true)
  expect(canView(d, { admin: true })).toBe(true)   // studio preview
})

test('access: group gating checks membership', () => {
  const d = doc({ access: { mode: 'groups', groups: ['vip', 'staff'] } })
  expect(canView(d, { member: { id: 'm1', groups: [] } })).toBe(false)
  expect(canView(d, { member: { id: 'm1', groups: ['other'] } })).toBe(false)
  expect(canView(d, { member: { id: 'm1', groups: ['staff'] } })).toBe(true)
})

test('access: groups mode with no groups listed means any member', () => {
  expect(memberAllowed({ id: 'm' }, { mode: 'groups', groups: [] })).toBe(true)
  expect(memberAllowed(null, { mode: 'groups', groups: [] })).toBe(false)
})

// ---------- config layering ----------

test('config: environment variables override file config', () => {
  const cfg = mergeConfig({ url: 'http://localhost:8787', name: 'Local' }, {
    BLOCKHOUSE_SITE_URL: 'https://example.com', BLOCKHOUSE_SITE_NAME: 'Live',
  })
  expect(cfg.url).toBe('https://example.com')
  expect(cfg.name).toBe('Live')
})

test('config: trailing slash is stripped from the site URL', () => {
  expect(mergeConfig({ url: 'https://example.com/' }).url).toBe('https://example.com')
})

test('config: security defaults are safe out of the box', () => {
  const s = DEFAULT_CONFIG.security!
  expect(s.pbkdf2Iterations).toBeGreaterThanOrEqual(210_000)
  expect(s.csp).toBe('balanced')
  expect(s.maxLoginAttempts).toBeGreaterThan(0)
  expect(s.frameAncestors).toBe("'none'")
})

test('config: allowlist parses comma-separated CIDRs', () => {
  expect(envOverrides({ BLOCKHOUSE_ADMIN_ALLOWLIST: '10.0.0.0/8, 192.168.1.5 ' }).security!.adminAllowlist)
    .toEqual(['10.0.0.0/8', '192.168.1.5'])
})

test('config: layers stack site.json → site.<env>.json → local → env', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'Base', url: 'http://localhost:8787', template: 'aurora' }))
  await d.write('site/site.production.json', JSON.stringify({ url: 'https://prod.example', security: { hsts: true } }))
  await d.write('.blockhouse/local.json', JSON.stringify({ name: 'Local override' }))

  const dev = await new ContentStore(d, 'dev').site()
  expect(dev.url).toBe('http://localhost:8787')     // overlay not applied in dev
  expect(dev.name).toBe('Local override')            // local layer always applies

  const prod = await new ContentStore(d, 'production').site()
  expect(prod.url).toBe('https://prod.example')
  expect(prod.security!.hsts).toBe(true)
  expect(prod.security!.pbkdf2Iterations).toBe(DEFAULT_CONFIG.security!.pbkdf2Iterations) // deep merge, not replace

  const withEnv = await new ContentStore(d, 'production', { BLOCKHOUSE_SITE_URL: 'https://from-env' }).site()
  expect(withEnv.url).toBe('https://from-env')
})

test('config: configLayers reports which sources are present', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'X' }))
  const layers = await new ContentStore(d, 'production').configLayers()
  expect(layers.find(l => l.source === 'site/site.json')!.present).toBe(true)
  expect(layers.find(l => l.source === 'site/site.production.json')!.present).toBe(false)
  expect(layers.find(l => l.source === '.blockhouse/local.json')!.present).toBe(false)
})

// ---------- content store: slugs and aliases ----------

test('content: renaming a slug records history and moves the published snapshot', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'T', url: 'https://t.example' }))
  await d.write('site/concepts/page.json', JSON.stringify(page))
  const cs = new ContentStore(d)

  const first = await cs.saveDoc(doc({ id: 'd1', slug: 'old-name' }))
  await d.write('site/content/.published/page/old-name.json', JSON.stringify({ ...first, status: 'published' }))

  const renamed = await cs.saveDoc({ ...first, slug: 'new-name' })
  expect(renamed.slugHistory).toContain('old-name')
  expect(await d.readText('site/content/.published/page/old-name.json')).toBeFalsy()
  const moved = JSON.parse((await d.readText('site/content/.published/page/new-name.json'))!)
  expect(moved.slug).toBe('new-name')

  cs.invalidate()
  expect(await cs.findBySlugHistory('/old-name')).toBe('/new-name/')  // honours URL style
})

test('content: aliases resolve to their document with the mirror flag', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'T', url: 'https://t.example' }))
  await d.write('site/concepts/page.json', JSON.stringify(page))
  const cs = new ContentStore(d)
  await cs.saveDoc(doc({ id: 'd1', slug: 'offer', aliases: ['/promo', '/campaign/spring'], mirror: true }))
  cs.invalidate()

  const hit = await cs.getByAlias('/campaign/spring')
  expect(hit?.doc.id).toBe('d1')
  expect(hit?.mirror).toBe(true)
  expect(await cs.getByAlias('/nothing-here')).toBeNull()
})

// ---------- deploy presets ----------

test('urls: shortcodes do not collide across a realistic id space', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 20_000; i++) seen.add(shortCode('dmskw' + i.toString(36) + 'abc'))
  expect(seen.size).toBe(20_000)
})

// ---------- deploy presets ----------

test('deploy: each target writes files interpolated from the site config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockhouse-deploy-'))
  const cfg = site({ name: 'Acme', url: 'https://acme.example' })
  for (const t of TARGETS) {
    const written = deployInit(dir, t, cfg)
    expect(written.length).toBeGreaterThan(0)
    for (const w of written) expect(existsSync(join(dir, w.file))).toBe(true)
  }
  expect(readFileSync(join(dir, 'wrangler.toml'), 'utf8')).toContain('https://acme.example')
  expect(readFileSync(join(dir, 'deploy/Caddyfile'), 'utf8')).toContain('acme.example')
  expect(readFileSync(join(dir, 'docker-compose.yml'), 'utf8')).toContain('BLOCKHOUSE_SECRET')

  // second run must not clobber edited files
  const again = deployInit(dir, 'docker', cfg)
  expect(again.every(w => w.skipped)).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})

// ---------- content store: a save that changes nothing (R15-1) ----------

test('content: saving an identical document is a no-op', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'T', url: 'https://t.example' }))
  await d.write('site/concepts/page.json', JSON.stringify(page))
  const cs = new ContentStore(d)

  const first = await cs.saveDoc(doc({ id: 'd1', slug: 'about', blocks: [{ id: 'b1', type: 'text', props: { html: 'hi' } } as any] }))
  await cs.saveDoc({ ...first, title: 'About us' })          // a real edit: version 2, one restore point
  const edited = (await cs.getDoc('d1'))!
  expect(edited.version).toBe(2)
  expect((await cs.versions('d1')).length).toBe(1)

  // Same content, different key order and a fresh object — the document itself
  // is left alone. (An explicit save may still keep a restore point; that is
  // the next test.)
  const again = await cs.saveDoc(JSON.parse(JSON.stringify({ ...edited, updatedAt: '1999-01-01T00:00:00.000Z' })), { snapshot: false })
  expect(again.version).toBe(2)
  expect(again.updatedAt).toBe(edited.updatedAt)
  expect((await cs.versions('d1')).length).toBe(1)           // no extra restore point
  expect(JSON.parse((await d.readText('site/content/page/about.json'))!).version).toBe(2)

  // A genuine change still bumps the version.
  const changed = await cs.saveDoc({ ...edited, blocks: [{ id: 'b1', type: 'text', props: { html: 'bye' } } as any] })
  expect(changed.version).toBe(3)
})

// R21-2: edit, let the autosave land, then press Save. The text now matches the
// autosaved document but not the last restore point, and Save promises one.
test('content: an explicit save after an autosave still keeps a restore point', async () => {
  const d = new MemoryDriver()
  await d.write('site/site.json', JSON.stringify({ name: 'T', url: 'https://t.example' }))
  await d.write('site/concepts/page.json', JSON.stringify(page))
  const cs = new ContentStore(d)

  const first = await cs.saveDoc(doc({ id: 'd1', slug: 'about' }))
  const before = (await cs.versions('d1')).length

  // autosave: the edit reaches the server, no restore point
  await cs.saveDoc({ ...first, title: 'About us' }, { snapshot: false })
  expect((await cs.versions('d1')).length).toBe(before)
  const autosaved = (await cs.getDoc('d1'))!

  // explicit Save of the very same text: one restore point, document untouched
  const r = await cs.saveDocResult({ ...autosaved }, { snapshot: true })
  expect(r.unchanged).toBe(true)
  expect(r.snapshot).toBe(true)
  expect(r.doc.version).toBe(autosaved.version)
  const after = await cs.versions('d1')
  expect(after.length).toBe(before + 1)
  expect(after[0]!.title).toBe('About us')

  // pressing Save again adds nothing: the restore point already matches
  const r2 = await cs.saveDocResult({ ...autosaved }, { snapshot: true })
  expect(r2.unchanged).toBe(true)
  expect(r2.snapshot).toBe(false)
  expect((await cs.versions('d1')).length).toBe(after.length)
})
