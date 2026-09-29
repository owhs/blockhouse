// Ahrefs plugin — the client, cache, unit cap and routes, against a stubbed
// fetch and a fake plugin context (no network, no site on disk).
import { test, expect } from 'bun:test'
import { Hono } from '../src/vendor/http.ts'
import {
  register, normaliseTarget, explainError, toCsv, diffSnapshots, headHtml, bareHost,
} from '../../plugins/ahrefs/index.ts'

type Call = { path: string; params: URLSearchParams; auth: string | null }

function harness(opts: { units?: number; usage?: number; fail?: number } = {}) {
  const calls: Call[] = []
  const kv = new Map<string, any>()
  const secure = new Map<string, any>()
  const events: { event: string; payload: any }[] = []
  const actions = new Map<string, any>()
  let site: any = { url: 'https://www.strongman.test', plugins: { ahrefs: { enabled: true, approved: ['*'], settings: {} } } }
  const app = new Hono()
  const fetchStub = async (url: string, init: any) => {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/v3/, '')
    calls.push({ path, params: u.searchParams, auth: init?.headers?.authorization ?? null })
    if (opts.fail) return new Response(JSON.stringify(['Error', 'Forbidden']), { status: opts.fail })
    const headers = { 'x-api-units-cost-total-actual': String(opts.units ?? 60) }
    const body: Record<string, any> = {
      '/subscription-info/limits-and-usage': { limits_and_usage: { units_usage_api_key: opts.usage ?? 100, units_limit_api_key: 1000, usage_reset_date: '2026-10-01' } },
      '/site-explorer/domain-rating': { domain_rating: { domain_rating: 34, ahrefs_rank: 99 } },
      '/site-explorer/backlinks-stats': { metrics: { live: 10, live_refdomains: 5, all_time: 20, all_time_refdomains: 8 } },
      '/site-explorer/metrics': { metrics: { org_traffic: 100, org_keywords: 50, org_keywords_1_3: 4, org_cost: 1000 } },
      '/site-explorer/domain-rating-history': { domain_ratings: [{ date: '2026-01-01', domain_rating: 30 }] },
      '/site-explorer/refdomains-history': { refdomains: [{ date: '2026-01-01', refdomains: 3 }] },
      '/site-explorer/metrics-history': { metrics: [{ date: '2026-01-01', org_traffic: 90 }] },
      '/site-explorer/organic-keywords': { keywords: [{ keyword: 'two post lift', best_position: 3, volume: 1000 }] },
      '/site-explorer/top-pages': { pages: [{ url: 'https://www.strongman.test/lifts/tongland/', sum_traffic: 50 }, { url: 'https://www.strongman.test/gone', sum_traffic: 5 }] },
      '/site-explorer/pages-by-backlinks': { pages: [
        { url_to: 'https://www.strongman.test/products/donnington.html', refdomains_target: 12, top_domain_rating_source: 61 },
        { url_to: 'https://www.strongman.test/old-brochure', refdomains_target: 3, top_domain_rating_source: 20 },
        { url_to: 'https://www.strongman.test/gone', refdomains_target: 1, top_domain_rating_source: 5 },
        { url_to: 'https://www.strongman.test/', refdomains_target: 40, top_domain_rating_source: 80 },
      ] },
      '/site-explorer/all-backlinks': { backlinks: [{ url_from: 'https://a.test/x', url_to: 'https://www.strongman.test/' }] },
      '/keywords-explorer/overview': { keywords: [{ keyword: u.searchParams.get('keywords'), volume: 4400, difficulty: 23 }] },
    }
    return new Response(JSON.stringify(body[path] ?? {}), { status: 200, headers })
  }
  const ctx: any = {
    id: 'ahrefs',
    log: () => {},
    settings: { get: async (k: string, f: any) => (secure.has(k) ? secure.get(k) : f), set: async (k: string, v: any) => { secure.set(k, v) } },
    store: { kvGet: async (k: string, f: any) => (kv.has(k) && kv.get(k) !== null ? kv.get(k) : f), kvSet: async (k: string, v: any) => { kv.set(k, v) } },
    events: { emit: async (event: string, payload: any) => { events.push({ event, payload }) }, on: () => {} },
    actions: { register: (a: any) => actions.set(a.type, a) },
    routes: { api: (fn: any) => fn(app), public: () => {}, root: () => {} },
    content: { listDocs: async () => [{ id: 'd1', title: 'Tongland', status: 'published', path: '/lifts/tongland' }] },
    adminPanel: () => {},
    fetch: fetchStub,
    env: {
      site: async () => site,
      content: {
        docPath: async (d: any) => d.path,
        concepts: async () => [{ name: 'lift', indexPath: '/lifts' }],
        redirects: async () => [{ from: '/old-brochure', to: '/brochure', code: 301 }],
        saveSite: async (patch: any) => { site = { ...site, ...patch } },
      },
    },
  }
  register(ctx)
  const req = async (method: string, path: string, body?: any) => {
    const res = await app.fetch(new Request(`http://x${path}`, {
      method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    }))
    return { status: res.status, json: await res.json().catch(() => null) as any }
  }
  return { app, calls, kv, secure, events, actions, req, getSite: () => site, setSettings: (s: any) => { site.plugins.ahrefs.settings = { ...site.plugins.ahrefs.settings, ...s } } }
}

// ---------- pure helpers ----------

test('ahrefs: target normalisation per mode', () => {
  expect(normaliseTarget('https://WWW.Example.com/path?q=1', 'subdomains')).toBe('www.example.com')
  expect(normaliseTarget('example.com/blog', 'domain')).toBe('example.com')
  expect(normaliseTarget('example.com/blog', 'prefix')).toBe('https://example.com/blog')
  expect(normaliseTarget('', 'exact')).toBe('')
})

test('ahrefs: errors are explained, not dumped', () => {
  expect(explainError(403, '["Error","Forbidden"]')).toMatch(/refused the API key/)
  expect(explainError(429, '')).toMatch(/rate-limiting/)
  expect(explainError(400, '{"error":"units limit exceeded"}')).toMatch(/allowance is used up/)
  expect(explainError(500, '{"error":"boom"}')).toBe('Ahrefs error 500: boom')
})

test('ahrefs: csv quoting', () => {
  expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: ['p', 'q'], d: null }])).toBe('a,b,c,d\n"x,y","say ""hi""",p; q,')
  expect(toCsv([])).toBe('')
})

test('ahrefs: snapshot diff reports only meaningful moves', () => {
  const a = { domainRating: 30, refdomains: 100, organicTraffic: 1000, organicKeywords: 500, top3: 10 }
  expect(diffSnapshots(a, { ...a, refdomains: 102 })).toEqual([])            // 2 domains, 2% — noise
  const d = diffSnapshots(a, { ...a, domainRating: 32, organicTraffic: 700 })
  expect(d.map(x => x.key)).toEqual(['domainRating', 'organicTraffic'])
  expect(d[0].text).toBe('Domain Rating rose from 30 to 32')
  expect(d[1].text).toMatch(/fell from 1,000 to 700/)
})

test('ahrefs: head tags are sanitised and consent-aware', () => {
  const prod = { productionHost: 'https://www.strongmanlifts.co.uk' }
  expect(headHtml({})).toBe('')
  expect(headHtml({ verification: 'abc"><script>' })).toBe('<meta name="ahrefs-site-verification" content="abcscript">')
  expect(headHtml({ analyticsKey: 'K1', loadAnalytics: false }, prod)).toBe('')
  expect(headHtml({ analyticsKey: 'K1', loadAnalytics: true })).toBe('')          // no real address known → never count
  const on = headHtml({ analyticsKey: 'K1', loadAnalytics: true }, prod)
  expect(on).toContain('"strongmanlifts.co.uk"')                                  // www. stripped
  expect(on).toContain("setAttribute('data-key',\"K1\")")
  expect(on).not.toContain('<script src=')
  const gated = headHtml({ analyticsKey: 'K1', loadAnalytics: true }, { ...prod, consentGate: true })
  expect(gated).toContain("indexOf('analytics')<0")
})

test('ahrefs: analytics only loads on the real domain, never on staging', () => {
  const html = headHtml({ analyticsKey: 'K1', loadAnalytics: true }, { productionHost: 'https://strongmanlifts.co.uk' })
  const code = /<script>([\s\S]*)<\/script>/.exec(html)![1]
  const run = (hostname: string) => {
    const appended: any[] = []
    const doc = { cookie: '', createElement: () => ({ setAttribute() {} }), head: { appendChild: (x: any) => appended.push(x) } }
    new Function('location', 'document', code)({ hostname }, doc)
    return appended.length
  }
  expect(run('strongmanlifts.co.uk')).toBe(1)
  expect(run('www.strongmanlifts.co.uk')).toBe(1)
  expect(run('strongman.owhs.uk')).toBe(0)
  expect(run('localhost')).toBe(0)
})

test('ahrefs: bareHost', () => {
  expect(bareHost('https://WWW.Example.co.uk/path')).toBe('example.co.uk')
  expect(bareHost('example.com')).toBe('example.com')
  expect(bareHost('')).toBe('')
})

// ---------- client + routes ----------

test('ahrefs: no key → a setup error, not a network call', async () => {
  const t = harness()
  const r = await t.req('GET', '/overview')
  expect(r.status).toBe(400)
  expect(r.json.code).toBe('no_key')
  expect(t.calls.length).toBe(0)
})

test('ahrefs: a refused key is never stored, and never looks like a signed-out session', async () => {
  const t = harness({ fail: 403 })
  const r = await t.req('PUT', '/config', { apiKey: 'nope' })
  expect(r.status).toBe(400)                // not 401: the studio treats 401 as "you've been signed out"
  expect(r.json.code).toBe('bad_key')
  expect(t.secure.get('apiKey')).toBeUndefined()
})

test('ahrefs: config saves the key after checking it, and parses a pasted meta tag', async () => {
  const t = harness()
  const r = await t.req('PUT', '/config', { apiKey: ' k-123 ', verification: '<meta name="ahrefs-site-verification" content="abc123">', rows: 5000, country: 'US', mode: 'bogus' })
  expect(r.status).toBe(200)
  expect(t.secure.get('apiKey')).toBe('k-123')
  expect(t.calls[0].path).toBe('/subscription-info/limits-and-usage')
  expect(t.calls[0].auth).toBe('Bearer k-123')
  const s = t.getSite().plugins.ahrefs.settings
  expect(s.verification).toBe('abc123')
  expect(s.rows).toBe(1000)                  // clamped
  expect(s.country).toBe('us')
  expect(s.mode).toBe('subdomains')          // unknown mode ignored
  expect(s.apiKey).toBeUndefined()           // the key never lands in site.json
  const cfg = await t.req('GET', '/config')
  expect(cfg.json.hasKey).toBe(true)
  expect(cfg.json.keyHint).toBe('…-123')
  expect(cfg.json.resolvedTarget).toBe('www.strongman.test')
})

test('ahrefs: answers are cached, units are counted once, refresh asks again', async () => {
  const t = harness({ units: 75 })
  t.secure.set('apiKey', 'k')
  t.setSettings({ autoSnapshot: false })
  const first = await t.req('GET', '/keywords')
  expect(first.json.cached).toBe(false)
  expect(first.json.units).toBe(75)
  expect(t.calls.length).toBe(1)
  const p = t.calls[0].params
  expect(p.get('target')).toBe('www.strongman.test')
  expect(p.get('limit')).toBe('50')
  expect(p.get('select')).not.toContain('serp_features')
  const second = await t.req('GET', '/keywords')
  expect(second.json.cached).toBe(true)
  expect(second.json.units).toBe(0)
  expect(t.calls.length).toBe(1)
  await t.req('GET', '/keywords?fresh=1')
  expect(t.calls.length).toBe(2)
  const cfg = await t.req('GET', '/config')
  expect(cfg.json.unitsThisMonth).toBe(150)
  // clearing the cache makes the next open ask Ahrefs again
  await t.req('POST', '/cache/clear')
  await t.req('GET', '/keywords')
  expect(t.calls.length).toBe(3)
})

test('ahrefs: the unit cap stops fresh calls but still serves the cache', async () => {
  const t = harness({ usage: 5000 })
  t.secure.set('apiKey', 'k')
  t.setSettings({ autoSnapshot: false })
  await t.req('GET', '/keywords')                    // cached before the cap is set
  t.setSettings({ unitCap: 1000 })
  expect((await t.req('GET', '/keywords')).status).toBe(200)
  const r = await t.req('GET', '/keywords?fresh=1')
  expect(r.status).toBe(429)
  expect(r.json.code).toBe('cap')
  expect(r.json.error).toMatch(/5,000 of the 1,000/)
})

test('ahrefs: top pages are matched to studio pages', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  const r = await t.req('GET', '/pages')
  expect(r.json.rows[0].doc).toEqual({ id: 'd1', title: 'Tongland', status: 'published' })
  expect(r.json.rows[1].doc).toBeNull()
})

test('ahrefs: lost-links filter is valid JSON with a boolean', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  await t.req('GET', '/backlinks?kind=lost')
  const p = t.calls[0].params
  expect(p.get('history')).toMatch(/^since:\d{4}-\d{2}-\d{2}$/)
  const where = JSON.parse(p.get('where')!)
  expect(where.and[1]).toEqual({ field: 'is_lost', is: ['eq', true] })
})

test('ahrefs: snapshots record, then emit changes', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  const a = await t.req('POST', '/snapshots')
  expect(a.json.snapshot.domainRating).toBe(34)
  expect(t.events.map(e => e.event)).toEqual(['snapshot'])
  // pretend yesterday's DR was lower
  const hist = t.kv.get('snapshots'); t.kv.set('snapshot:last', { ...hist[0], domainRating: 30 })
  await t.req('POST', '/snapshots')
  const changed = t.events.find(e => e.event === 'changed')!
  expect(changed.payload.summary).toBe('Domain Rating rose from 30 to 34')
})

test('ahrefs: keyword automation action interpolates the event', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  const out = await t.actions.get('ahrefs.keyword').run({ keyword: '{data.kw}' }, { data: { kw: 'car lift' } })
  expect(out).toMatchObject({ keyword: 'car lift', volume: 4400, difficulty: 23 })
  expect(t.calls[0].params.get('country')).toBe('gb')
})

test('ahrefs: csv export reuses the on-screen answer', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  await t.req('GET', '/keywords')
  const res = await t.app.fetch(new Request('http://x/export/keywords.csv'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/csv')
  expect((await res.text()).split('\n')[0]).toBe('keyword,best_position,volume')
  expect(t.calls.length).toBe(1)          // served from cache
})

test('ahrefs: launch check finds the old addresses the new site would 404', async () => {
  const t = harness()
  t.secure.set('apiKey', 'k')
  const r = await t.req('GET', '/launch')
  expect(r.status).toBe(200)
  const by = Object.fromEntries(r.json.rows.map((x: any) => [x.path, x]))
  expect(by['/lifts/tongland'].state).toBe('exists')            // a studio page (trailing slash ignored)
  expect(by['/'].state).toBe('exists')
  expect(by['/old-brochure']).toMatchObject({ state: 'redirected', redirectTo: '/brochure' })
  expect(by['/products/donnington.html']).toMatchObject({ state: 'missing', linkingSites: 12, bestLinkDR: 61 })
  expect(by['/gone']).toMatchObject({ state: 'missing', visits: 5, linkingSites: 1 })  // merged from both reports
  expect(r.json.missing).toBe(2)
  expect(r.json.rows[0].path).toBe('/products/donnington.html')  // missing first, most valuable first
  const pbb = t.calls.find(c => c.path === '/site-explorer/pages-by-backlinks')!
  expect(pbb.params.get('select')).toBe('url_to,refdomains_target,top_domain_rating_source,http_code_target')
  // the Pages report's answer is reused, not fetched again
  await t.req('GET', '/pages')
  expect(t.calls.filter(c => c.path === '/site-explorer/top-pages').length).toBe(1)
})
