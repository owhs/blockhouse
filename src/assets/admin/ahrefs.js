// The Ahrefs panel (plugins/ahrefs). Every report here costs the owner API
// units, so nothing loads until its tab is opened, answers come from the
// server's cache unless "Refresh" is pressed, and each report says how old it is.
//
// Broken backlinks — someone else's link to an address this site no longer
// has — are the one place Ahrefs data turns straight into an action: each row
// gets a "Redirect" button that writes to the same redirects list the SEO page
// manages.

import { api, get, put, post, del } from './api.js'
import { h, toast, emptyState, skeleton, promptDialog, confirmDialog } from './ui.js'
import { icon, iconEl } from './icons.js'
import { prefs, setPref, hooks } from './state.js'

const X = '/x/ahrefs'
const quiet = path => api(path, { quiet: true })

// ---------- formatting ----------

const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const num = v => (v === null || v === undefined || v === '' ? '—' : Math.abs(v) >= 10000 ? nf.format(v) : Number(v).toLocaleString())
/** Ahrefs sends money in US cents. */
const usd = c => (c === null || c === undefined ? '—' : `$${Math.abs(c) >= 1e6 ? nf.format(c / 100) : Math.round(c / 100).toLocaleString()}`)
const ago = at => {
  if (!at) return ''
  const m = Math.round((Date.now() - at) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const shortDate = d => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
const host = u => { try { return new URL(u).host.replace(/^www\./, '') } catch { return u || '' } }
const pathOf = u => { try { const p = new URL(u).pathname; return p.length > 1 ? p.replace(/\/$/, '') : '/' } catch { return u || '' } }

/** A position change: +3 means it moved up three places. */
function movement(prev, now) {
  if (now == null && prev != null) return h('span.badge.badge-err', { title: `Was ${prev}` }, 'lost')
  if (prev == null && now != null) return h('span.badge.badge-ok', {}, 'new')
  if (prev == null || now == null || prev === now) return h('span.fnt', {}, '·')
  const up = now < prev
  return h('span', { class: up ? 'ahx-up' : 'ahx-down', title: `Was ${prev}` }, `${up ? '▲' : '▼'} ${Math.abs(prev - now)}`)
}

const kdWord = kd => (kd < 10 ? 'easy' : kd < 30 ? 'fairly easy' : kd < 60 ? 'hard' : kd < 80 ? 'very hard' : 'super hard')
const kdClass = kd => (kd < 30 ? 'badge-ok' : kd < 60 ? 'badge-warn' : 'badge-err')
function difficulty(kd) {
  if (kd === null || kd === undefined) return h('span.fnt', {}, '—')
  return h('span.badge', { class: kdClass(kd), title: `Keyword difficulty ${kd} of 100 — ${kdWord(kd)}` }, String(kd))
}

/** Line chart for a [{date, value}] series. */
function lineChart(series, label, fmt = num) {
  const pts = (series || []).filter(p => typeof p.value === 'number')
  if (pts.length < 2) return h('p.fnt.text-s', {}, 'Not enough history yet.')
  const w = 640, ch = 120, pad = 4
  const vals = pts.map(p => p.value)
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
  const x = i => pad + (i / (pts.length - 1)) * (w - pad * 2)
  const y = v => ch - pad - ((v - lo) / span) * (ch - pad * 2)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="6" fill="transparent"><title>${p.date}: ${fmt(p.value)}</title></circle>`).join('')
  const el = h('div.ahx-chart')
  el.innerHTML = `<svg viewBox="0 0 ${w} ${ch + 18}" width="100%" role="img" aria-label="${label}, ${fmt(pts[0].value)} to ${fmt(pts[pts.length - 1].value)}">
    <path d="${d}L${x(pts.length - 1)},${ch}L${x(0)},${ch}Z" fill="var(--acc)" opacity="0.1"/>
    <path d="${d}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${dots}
    <text x="0" y="${ch + 14}" font-size="11" fill="var(--fnt)">${shortDate(pts[0].date)}</text>
    <text x="${w}" y="${ch + 14}" font-size="11" fill="var(--fnt)" text-anchor="end">${shortDate(pts[pts.length - 1].date)}</text></svg>`
  el.append(h('div.fnt.text-xs', {}, `Low ${fmt(lo)} · high ${fmt(hi)} · now ${fmt(pts[pts.length - 1].value)}`))
  return el
}

/**
 * A report table. cols: [{ label, cell: row => node|string, num?: bool }].
 * On a phone each row becomes a card (cards-sm), labelled by column.
 */
function table(cols, rows, empty = 'Nothing to show.') {
  if (!rows?.length) return h('p.fnt.mt-2', {}, empty)
  return h('div.table-wrap', {}, h('table.data-table.cards-sm.ahx-table', {},
    h('thead', {}, h('tr', {}, ...cols.map(c => h('th', { class: c.num ? 'ta-r' : '' }, c.label)))),
    h('tbody', {}, ...rows.map(r => h('tr.cursor-default', {},
      ...cols.map((c, i) => h('td', { class: c.num ? 'ta-r nowrap' : '', 'data-label': i ? c.label : '' }, c.cell(r))))))))
}

const extLink = (u, text) => h('a.ahx-url', { href: u, target: '_blank', rel: 'noopener noreferrer', title: u }, text || u)
const studioLink = (doc, label) => doc
  ? h('a', { href: `#/e/${doc.id}/seo`, onclick: () => hooks.pushReturn?.('Ahrefs', location.hash) }, label || doc.title)
  : ''

/**
 * "From Ahrefs just now · 650 units" or "Saved answer from 3 h ago · free".
 * The refresh spends units, so it says so.
 */
function freshness(d, reload) {
  const at = d?.cachedAt
  const text = !at ? ''
    : d.cached ? `Saved answer from ${ago(at)} · no units used`
    : `From Ahrefs ${ago(at)} · ${d.units ? `used ${num(d.units)} API units` : 'free'}`
  return h('div.ahx-fresh', {},
    h('span.fnt.text-s', {}, text),
    h('button.btn.ghost.small', { title: 'Asks Ahrefs again. Uses API units.', onclick: () => reload(true) }, iconEl('refresh', 13), 'Refresh'))
}

function errorBox(e, retry) {
  const code = e?.data?.code
  const msg = e?.data?.error || e?.message || String(e)
  const setup = ['no_key', 'bad_key', 'no_project', 'no_target', 'cap'].includes(code)
  return h('div.ahx-error', { role: 'alert' },
    h('span', { html: icon('warn', 16), 'aria-hidden': 'true' }),
    h('div', {}, h('p.mt-0', {}, msg),
      h('div.d-flex.gap-2', {},
        setup ? h('button.btn.soft.small', { onclick: () => hooks.ahrefsTab?.('setup') }, 'Open setup') : '',
        retry && !setup ? h('button.btn.ghost.small', { onclick: () => retry(false) }, 'Try again') : '')))
}

/**
 * The shape every report tab takes: a holder that loads on first paint,
 * shows a skeleton, then the body or an explained error.
 */
function report(load, paint) {
  const holder = h('div', {}, skeleton('rows', 5))
  const run = async (fresh = false) => {
    holder.replaceChildren(skeleton('rows', 5))
    try {
      const data = await load(fresh)
      holder.replaceChildren(paint(data, run))
    } catch (e) { holder.replaceChildren(errorBox(e, run)) }
  }
  run()
  return holder
}

function seg(options, current, onPick, label) {
  const el = h('div.seg.ahx-seg', { role: 'tablist', 'aria-label': label },
    ...options.map(([k, text]) => h('button', {
      role: 'tab', 'aria-selected': String(k === current), class: k === current ? 'active' : '',
      onclick: e => {
        for (const b of el.children) { b.classList.toggle('active', b === e.currentTarget); b.setAttribute('aria-selected', String(b === e.currentTarget)) }
        onPick(k)
      },
    }, text)))
  return el
}

const csvLink = (report, q = '') => h('a.btn.ghost.small', { href: `/api${X}/export/${report}.csv${q}`, download: '' }, iconEl('download', 13), 'CSV')

// ---------- tabs ----------

function overviewTab() {
  return report(fresh => quiet(`${X}/overview${fresh ? '?fresh=1' : ''}`), (d, reload) => {
    const b = d.backlinks, m = d.metrics
    const stat = (n, l, sub) => h('div.card.stat', {}, h('span.n', {}, n), h('span.l', {}, l), sub ? h('span.fnt.text-xs', {}, sub) : '')
    let snapHolder = h('div')
    get(`${X}/snapshots`).then(({ snapshots }) => {
      const recent = snapshots.slice(-8).reverse()
      snapHolder.replaceChildren(recent.length
        ? table([
          { label: 'Day', cell: s => s.day },
          { label: 'DR', num: true, cell: s => String(s.domainRating ?? '—') },
          { label: 'Referring domains', num: true, cell: s => num(s.refdomains) },
          { label: 'Search traffic', num: true, cell: s => num(s.organicTraffic) },
          { label: 'Keywords', num: true, cell: s => num(s.organicKeywords) },
          { label: 'Top 3', num: true, cell: s => num(s.top3) },
        ], recent)
        : h('p.fnt.text-s', {}, 'The first daily record is taken today; after that, changes show here and can trigger automations (event: ahrefs.changed).'))
    }).catch(() => {})
    return h('div', {},
      freshness(d, reload),
      h('div.cards.mb-4', {},
        stat(String(d.domainRating ?? '—'), 'Domain Rating', d.ahrefsRank ? `Ahrefs Rank #${num(d.ahrefsRank)}` : ''),
        stat(num(b.live_refdomains), 'Referring domains', `${num(b.all_time_refdomains)} all time`),
        stat(num(b.live), 'Backlinks', `${num(b.all_time)} all time`),
        stat(num(m.org_traffic), 'Search visits / month', `worth ${usd(m.org_cost)}`),
        stat(num(m.org_keywords), 'Ranking keywords', `${num(m.org_keywords_1_3)} in the top 3`)),
      h('div.ahx-grid.mb-4', {},
        h('div.card', {}, h('strong', {}, 'Domain Rating'), lineChart(d.history.domainRating, 'Domain Rating over the last year', v => String(v))),
        h('div.card', {}, h('strong', {}, 'Referring domains'), lineChart(d.history.refdomains, 'Referring domains over the last year')),
        h('div.card', {}, h('strong', {}, 'Search traffic'), lineChart(d.history.traffic, 'Estimated monthly search traffic over the last year'))),
      h('div.card', {},
        h('div.card-head.mb-2', {}, h('strong', {}, 'Daily record'), csvLink('snapshots')),
        h('p.fnt.text-s.mt-0', {}, 'Kept on this site, one row a day, so you can see how things move even after Ahrefs’ own history rolls on.'),
        snapHolder))
  })
}

function backlinksTab() {
  const kinds = [['new', 'New'], ['lost', 'Lost'], ['all', 'Best'], ['domains', 'Referring domains'], ['anchors', 'Anchor text'], ['broken', 'Broken']]
  let kind = prefs().ahrefsLinks || 'new'
  const body = h('div')
  const blurbs = {
    new: 'Sites that started linking to you in the last 30 days, one row per site.',
    lost: 'Links that disappeared in the last 30 days, and why.',
    all: 'Your strongest live links, one per site, best first.',
    domains: 'Every site linking to you, strongest first.',
    anchors: 'The words other sites use when they link to you.',
    broken: 'Other sites link to addresses here that no longer work. Each one is a visitor landing on “not found” — redirect it to the right page and the link counts again.',
  }
  const paint = () => {
    const blurb = h('p.sub.mt-0', {}, blurbs[kind])
    if (kind === 'domains') {
      body.replaceChildren(blurb, report(f => quiet(`${X}/refdomains${f ? '?fresh=1' : ''}`), (d, reload) => h('div', {},
        h('div.ahx-bar', {}, freshness(d, reload), csvLink('refdomains')),
        table([
          { label: 'Site', cell: r => h('span', {}, extLink(`https://${r.domain}`, r.domain), r.is_spam ? h('span.badge.badge-warn.ml-1', {}, 'spam?') : '') },
          { label: 'DR', num: true, cell: r => String(r.domain_rating ?? '—') },
          { label: 'Their traffic', num: true, cell: r => num(r.traffic_domain) },
          { label: 'Links to you', num: true, cell: r => num(r.links_to_target) },
          { label: 'Followed', num: true, cell: r => num(r.dofollow_links) },
          { label: 'First seen', cell: r => shortDate(r.first_seen) },
        ], d.rows, 'No referring domains found.'))))
      return
    }
    if (kind === 'anchors') {
      body.replaceChildren(blurb, report(f => quiet(`${X}/anchors${f ? '?fresh=1' : ''}`), (d, reload) => h('div', {},
        h('div.ahx-bar', {}, freshness(d, reload), csvLink('anchors')),
        table([
          { label: 'Anchor text', cell: r => r.anchor ? h('span', {}, r.anchor) : h('em.fnt', {}, '(no text — image or empty link)') },
          { label: 'Sites', num: true, cell: r => num(r.refdomains) },
          { label: 'Links', num: true, cell: r => num(r.links_to_target) },
          { label: 'Followed', num: true, cell: r => num(r.dofollow_links) },
        ], d.rows))))
      return
    }
    if (kind === 'broken') { body.replaceChildren(blurb, brokenReport()); return }
    body.replaceChildren(blurb, report(f => quiet(`${X}/backlinks?kind=${kind}${f ? '&fresh=1' : ''}`), (d, reload) => h('div', {},
      h('div.ahx-bar', {}, freshness(d, reload), csvLink('backlinks', `?kind=${kind}`)),
      table([
        { label: 'From', cell: r => h('div', {}, h('strong', {}, r.title || host(r.url_from)), h('div.row-sub', {}, extLink(r.url_from, host(r.url_from) + pathOf(r.url_from).slice(0, 60)))) },
        { label: 'DR', num: true, cell: r => String(r.domain_rating_source ?? '—') },
        { label: 'Anchor', cell: r => r.anchor || h('em.fnt', {}, 'none') },
        { label: 'To', cell: r => h('code.text-s', {}, pathOf(r.url_to)) },
        { label: 'Type', cell: r => h('span.badge', { class: r.is_dofollow ? 'badge-ok' : '' }, r.is_dofollow ? 'followed' : 'nofollow') },
        kind === 'lost'
          ? { label: 'Lost', cell: r => h('span', { title: r.lost_reason || '' }, shortDate(r.last_seen), r.lost_reason ? h('div.row-sub', {}, String(r.lost_reason).replace(/_/g, ' ')) : '') }
          : { label: 'Found', cell: r => shortDate(r.first_seen_link) },
      ], d.rows, kind === 'new' ? 'No new links in the last 30 days.' : kind === 'lost' ? 'No links lost in the last 30 days.' : 'No backlinks found.'))))
  }
  paint()
  return h('div', {}, seg(kinds, kind, k => { kind = k; setPref('ahrefsLinks', k); paint() }, 'Which links'), h('div.mt-3', {}, body))
}

function brokenReport() {
  return report(async f => {
    // The page list is fetched with the report so the redirect dialog opens at once.
    const [d, r, pages] = await Promise.all([
      quiet(`${X}/backlinks?kind=broken${f ? '&fresh=1' : ''}`),
      get('/redirects').catch(() => ({ redirects: [] })),
      api('/seo/audit', { quiet: true }).then(a => a.docs.map(x => x.path)).catch(() => []),
    ])
    return { ...d, redirects: r.redirects || [], pages }
  }, (d, reload) => {
    const redirects = d.redirects
    // Group by the missing address: ten sites linking to one old page is one fix.
    const groups = new Map()
    for (const r of d.rows) {
      const p = pathOf(r.url_to)
      if (!groups.has(p)) groups.set(p, { path: p, links: [] })
      groups.get(p).links.push(r)
    }
    const list = [...groups.values()].sort((a, b) => Math.max(...b.links.map(l => l.domain_rating_source || 0)) - Math.max(...a.links.map(l => l.domain_rating_source || 0)))
    const holder = h('div')
    const paintList = () => holder.replaceChildren(list.length
      ? table([
        { label: 'Missing address', cell: g => h('code.text-s.break-all', {}, g.path) },
        { label: 'Linked from', cell: g => h('div', {}, ...g.links.slice(0, 3).map(l => h('div.row-sub', {}, extLink(l.url_from, `${host(l.url_from)} (DR ${l.domain_rating_source ?? '?'})`))), g.links.length > 3 ? h('div.row-sub', {}, `and ${g.links.length - 3} more`) : '') },
        { label: 'Fix', cell: g => {
          const existing = redirects.find(r => r.from === g.path)
          return existing
            ? h('span.badge.badge-ok', { title: `Already redirects to ${existing.to}` }, `→ ${existing.to}`)
            : h('button.btn.soft.small', { onclick: () => addRedirect(g.path) }, 'Redirect…')
        } },
      ], list)
      : emptyState(icon('check', 24), 'No broken backlinks', 'Every link Ahrefs knows about lands on a working page.'))
    const addRedirect = async from => {
      const to = await promptDialog({
        title: `Redirect ${from}`, label: 'Send visitors to', placeholder: '/new-page', datalist: d.pages,
        help: 'A permanent (301) redirect — search engines pass the old link’s value on to the new page.',
        confirmLabel: 'Add redirect',
      })
      if (!to?.trim()) return
      const target = to.trim()
      if (!target.startsWith('/') && !/^https?:\/\//.test(target)) return toast('Start with / for a page on this site, or https:// for another site', 'err')
      const fresh = (await get('/redirects')).redirects || []
      if (fresh.some(r => r.from === from)) return toast(`${from} already redirects somewhere — see SEO → Redirects`, 'err')
      fresh.push({ from, to: target, code: 301 })
      await put('/redirects', { redirects: fresh })
      redirects.push({ from, to: target, code: 301 })
      toast(`Redirected ${from} → ${target}`, 'ok'); paintList()
    }
    paintList()
    return h('div', {}, h('div.ahx-bar', {}, freshness(d, reload), csvLink('backlinks', '?kind=broken')), holder)
  })
}

function keywordsTab() {
  let filter = ''
  return report(f => quiet(`${X}/keywords${f ? '?fresh=1' : ''}`), (d, reload) => {
    const holder = h('div')
    const paint = () => {
      const q = filter.toLowerCase()
      const rows = d.rows.filter(r => !q || String(r.keyword).toLowerCase().includes(q))
      holder.replaceChildren(table([
        { label: 'Keyword', cell: r => h('span', {}, h('button.ahx-kw', { onclick: () => hooks.ahrefsResearch?.(r.keyword), title: 'Research this keyword' }, r.keyword), r.is_branded ? h('span.badge.ml-1', {}, 'brand') : '') },
        { label: 'Position', num: true, cell: r => h('span', {}, String(r.best_position ?? '—'), ' ', movement(r.best_position_prev, r.best_position)) },
        { label: 'Searches', num: true, cell: r => num(r.volume) },
        { label: 'KD', num: true, cell: r => difficulty(r.keyword_difficulty) },
        { label: 'Visits', num: true, cell: r => num(r.sum_traffic) },
        { label: 'Page', cell: r => r.best_position_url ? h('code.text-s', {}, pathOf(r.best_position_url)) : '—' },
      ], rows, q ? 'No keyword matches that filter.' : 'Ahrefs has not seen this site rank for anything yet.'))
    }
    paint()
    const up = d.rows.filter(r => r.best_position_prev && r.best_position && r.best_position < r.best_position_prev).length
    const down = d.rows.filter(r => r.best_position_prev && r.best_position && r.best_position > r.best_position_prev).length
    return h('div', {},
      h('div.ahx-bar', {}, freshness(d, reload),
        h('input.input.ahx-filter', { type: 'search', placeholder: 'Filter keywords', 'aria-label': 'Filter keywords', oninput: e => { filter = e.target.value; paint() } }),
        csvLink('keywords')),
      h('p.sub.mt-0', {}, `Your ${d.rows.length} best keywords by search traffic. Over 30 days: `, h('span.ahx-up', {}, `${up} up`), ', ', h('span.ahx-down', {}, `${down} down`), '.'),
      holder)
  })
}

function pagesTab() {
  return report(f => quiet(`${X}/pages${f ? '?fresh=1' : ''}`), (d, reload) => h('div', {},
    h('div.ahx-bar', {}, freshness(d, reload), csvLink('pages')),
    h('p.sub.mt-0', {}, 'Your pages by estimated search visits. Pages that exist in this studio link to their SEO tab.'),
    table([
      { label: 'Page', cell: r => h('div', {}, r.doc ? h('strong', {}, studioLink(r.doc)) : h('strong', {}, r.path), h('div.row-sub', {}, extLink(r.url, r.path))) },
      { label: 'Visits', num: true, cell: r => h('span', {}, num(r.sum_traffic), r.traffic_diff ? h('div.row-sub', { class: r.traffic_diff > 0 ? 'ahx-up' : 'ahx-down' }, `${r.traffic_diff > 0 ? '+' : ''}${num(r.traffic_diff)}`) : '') },
      { label: 'Keywords', num: true, cell: r => num(r.keywords) },
      { label: 'Top keyword', cell: r => r.top_keyword ? h('span', {}, r.top_keyword, h('span.fnt', {}, ` #${r.top_keyword_best_position ?? '?'}`)) : '—' },
      { label: 'UR', num: true, cell: r => String(r.ur ?? '—') },
      { label: 'Linking sites', num: true, cell: r => num(r.referring_domains) },
    ], d.rows, 'No pages with search traffic yet.'),
    h('div.card.mt-4', {}, h('strong', {}, 'Competing sites'),
      h('p.sub', {}, 'Sites that rank for the same searches you do.'),
      report(f => quiet(`${X}/competitors${f ? '?fresh=1' : ''}`), (c, reload2) => h('div', {},
        h('div.ahx-bar', {}, freshness(c, reload2), csvLink('competitors')),
        table([
          { label: 'Site', cell: r => extLink(`https://${r.competitor_domain}`, r.competitor_domain) },
          { label: 'DR', num: true, cell: r => String(r.domain_rating ?? '—') },
          { label: 'Shared keywords', num: true, cell: r => num(r.keywords_common) },
          { label: 'Their keywords', num: true, cell: r => num(r.keywords_competitor) },
          { label: 'Their traffic', num: true, cell: r => num(r.traffic) },
        ], c.rows, 'No competitors found for this country.'))))))
}

const COUNTRIES = [['gb', 'United Kingdom'], ['us', 'United States'], ['ie', 'Ireland'], ['ca', 'Canada'], ['au', 'Australia'], ['nz', 'New Zealand'], ['de', 'Germany'], ['fr', 'France'], ['nl', 'Netherlands'], ['es', 'Spain'], ['it', 'Italy'], ['tr', 'Turkey'], ['in', 'India'], ['za', 'South Africa']]
const countrySelect = (value, onchange) => h('select.input.ahx-country', { 'aria-label': 'Country', onchange },
  ...COUNTRIES.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
  COUNTRIES.some(([v]) => v === value) || !value ? '' : h('option', { value, selected: true }, value.toUpperCase()))

function researchTab(cfg, initial = '') {
  let country = cfg.country || 'gb'
  const input = h('input.input.ahx-q', { type: 'search', placeholder: 'e.g. two post car lift', 'aria-label': 'Keyword to research', value: initial })
  const out = h('div.mt-4')
  const go = (fresh = false) => {
    const q = input.value.trim()
    if (!q) { input.focus(); return }
    setPref('ahrefsLastKeyword', q)
    out.replaceChildren(report(f => quiet(`${X}/research?q=${encodeURIComponent(q)}&country=${country}${f || fresh ? '&fresh=1' : ''}`), (d, reload) => {
      const o = d.overview || {}
      const kwTable = rows => table([
        { label: 'Keyword', cell: r => h('button.ahx-kw', { onclick: () => { input.value = r.keyword; go() } }, r.keyword) },
        { label: 'Searches', num: true, cell: r => num(r.volume) },
        { label: 'KD', num: true, cell: r => difficulty(r.difficulty) },
        { label: 'Potential', num: true, cell: r => num(r.traffic_potential) },
      ], rows, 'None found.')
      const serpHolder = h('div')
      return h('div', {},
        freshness(d, reload),
        d.overview ? h('div.cards.mb-4', {},
          h('div.card.stat', {}, h('span.n', {}, num(o.volume)), h('span.l', {}, 'Searches / month')),
          h('div.card.stat', {}, h('span.n', {}, o.difficulty == null ? '—' : String(o.difficulty)), h('span.l', {}, 'Difficulty (0–100)'),
            o.difficulty == null ? '' : h('span', {}, h('span.badge', { class: kdClass(o.difficulty) }, kdWord(o.difficulty)))),
          h('div.card.stat', {}, h('span.n', {}, num(o.traffic_potential)), h('span.l', {}, 'Traffic potential'), o.parent_topic ? h('span.fnt.text-xs', {}, `parent topic: ${o.parent_topic}`) : ''),
          h('div.card.stat', {}, h('span.n', {}, o.cpc == null ? '—' : `$${(o.cpc / 100).toFixed(2)}`), h('span.l', {}, 'Cost per click'), o.global_volume ? h('span.fnt.text-xs', {}, `${num(o.global_volume)} worldwide`) : ''))
          : h('p.sub', {}, 'Ahrefs has no data for that exact phrase in this country — the ideas below may still help.'),
        h('div.ahx-grid', {},
          h('div.card', {}, h('strong', {}, 'Phrases containing it'), kwTable(d.matching)),
          h('div.card', {}, h('strong', {}, 'Questions people ask'), kwTable(d.questions)),
          h('div.card', {}, h('strong', {}, 'Related searches'), kwTable(d.related))),
        h('div.card.mt-4', {},
          h('div.card-head', {}, h('strong', {}, 'Who ranks for it now'),
            h('button.btn.ghost.small', { onclick: e => {
              e.currentTarget.remove()
              serpHolder.replaceChildren(report(f => quiet(`${X}/serp?q=${encodeURIComponent(q)}&country=${country}${f ? '&fresh=1' : ''}`), (s, r2) => h('div', {},
                freshness(s, r2),
                table([
                  { label: '#', num: true, cell: r => String(r.position) },
                  { label: 'Page', cell: r => h('div', {}, h('strong', {}, r.title || host(r.url)), h('div.row-sub', {}, r.url ? extLink(r.url, host(r.url) + pathOf(r.url).slice(0, 50)) : (r.type || []).join(', '))) },
                  { label: 'DR', num: true, cell: r => String(r.domain_rating ?? '—') },
                  { label: 'Linking sites', num: true, cell: r => num(r.refdomains) },
                  { label: 'Traffic', num: true, cell: r => num(r.traffic) },
                ], s.rows))))
            } }, 'Show the top 10')),
          serpHolder))
    }))
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
  const el = h('div', {},
    h('div.ahx-bar', {},
      input, countrySelect(country, e => { country = e.target.value }),
      h('button.btn.primary', { onclick: () => go() }, iconEl('search', 14), 'Research')),
    h('p.fnt.text-s', {}, 'How many people search for something, how hard it is to rank, and what else they search for. Each search uses API units; repeats within the cache time are free.'),
    out)
  if (initial) go()
  return el
}

function projectsTab(cfg) {
  if (!cfg.projectId) {
    return emptyState(icon('folder', 24), 'No Ahrefs project chosen',
      'Site Audit, Rank Tracker and Web Analytics live in an Ahrefs project. Pick yours under Setup.',
      h('button.btn.primary.small', { onclick: () => hooks.ahrefsTab?.('setup') }, 'Open setup'))
  }
  let sub = prefs().ahrefsProject || 'audit'
  const body = h('div.mt-3')
  const paint = () => {
    if (sub === 'audit') {
      body.replaceChildren(report(f => quiet(`${X}/audit${f ? '?fresh=1' : ''}`), (d, reload) => {
        const hs = d.health
        const groups = { Error: d.issues.filter(i => i.importance === 'Error'), Warning: d.issues.filter(i => i.importance === 'Warning'), Notice: d.issues.filter(i => i.importance === 'Notice') }
        return h('div', {},
          freshness(d, reload),
          hs ? h('div.cards.mb-4', {},
            h('div.card.stat', {}, h('span.n', {}, hs.health_score == null ? '—' : `${hs.health_score}`), h('span.l', {}, 'Health score (of 100)'), h('span.fnt.text-xs', {}, `crawled ${shortDate(hs.date)}`)),
            h('div.card.stat', {}, h('span.n', {}, num(hs.urls_with_errors)), h('span.l', {}, 'Pages with errors')),
            h('div.card.stat', {}, h('span.n', {}, num(hs.urls_with_warnings)), h('span.l', {}, 'Pages with warnings')),
            h('div.card.stat', {}, h('span.n', {}, num(hs.total)), h('span.l', {}, 'Pages crawled'))) : '',
          ...Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => h('div.card.mb-3', {},
            h('strong', {}, k === 'Error' ? 'Errors' : k === 'Warning' ? 'Warnings' : 'Notices'),
            table([
              { label: 'Issue', cell: i => h('span', {}, i.name, h('div.row-sub', {}, i.category)) },
              { label: 'Pages', num: true, cell: i => num(i.crawled) },
              { label: 'Change', num: true, cell: i => i.change ? h('span', { class: i.change > 0 ? 'ahx-down' : 'ahx-up' }, `${i.change > 0 ? '+' : ''}${i.change}`) : '·' },
            ], v))),
          d.issues.length ? '' : emptyState(icon('check', 24), 'No issues found', 'The last Site Audit crawl found nothing to fix.'),
          h('p.fnt.text-s', {}, 'Crawls run in Ahrefs on the schedule set there. ',
            extLink(`https://app.ahrefs.com/site-audit/${cfg.projectId}`, 'Open Site Audit in Ahrefs')))
      }))
    } else if (sub === 'ranks') {
      let device = 'desktop'
      const inner = h('div')
      const load = () => inner.replaceChildren(report(f => quiet(`${X}/ranks?device=${device}${f ? '&fresh=1' : ''}`), (d, reload) => h('div', {},
        h('div.ahx-bar', {}, freshness(d, reload), csvLink('ranks', `?device=${device}`)),
        table([
          { label: 'Keyword', cell: r => h('span', {}, r.keyword, h('div.row-sub', {}, [r.location, ...(r.tags || [])].filter(Boolean).join(' · '))) },
          { label: 'Position', num: true, cell: r => h('span', {}, String(r.position ?? '—'), ' ', movement(r.position_prev, r.position)) },
          { label: 'Searches', num: true, cell: r => num(r.volume) },
          { label: 'Visits', num: true, cell: r => num(r.traffic) },
          { label: 'Page', cell: r => r.url ? h('code.text-s', {}, pathOf(r.url)) : '—' },
        ], d.rows, 'This project tracks no keywords yet — add them in Ahrefs Rank Tracker.'))))
      body.replaceChildren(
        h('p.sub.mt-0', {}, 'Positions for the keywords you track, compared with a week ago.'),
        seg([['desktop', 'Desktop'], ['mobile', 'Mobile']], device, k => { device = k; load() }, 'Device'),
        h('div.mt-3', {}, inner))
      load()
    } else {
      let days = 30
      const inner = h('div')
      const load = () => inner.replaceChildren(report(f => quiet(`${X}/visits?days=${days}${f ? '&fresh=1' : ''}`), (d, reload) => {
        const s = d.stats
        const list = (title, rows, key) => h('div.card', {}, h('strong', {}, title),
          rows.length ? h('div.mt-2', {}, ...rows.map(r => h('div.d-flex.justify-between.p-1-0.bb-soft.text-m', {},
            h('span.ovh.tov-ellipsis.nowrap', {}, r[key] || '(direct)'), h('strong', {}, num(r.visitors)))))
            : h('p.fnt.mt-2', {}, 'No visits yet.'))
        return h('div', {},
          freshness(d, reload),
          h('div.cards.mb-4', {},
            h('div.card.stat', {}, h('span.n', {}, num(s.visitors)), h('span.l', {}, 'Visitors')),
            h('div.card.stat', {}, h('span.n', {}, num(s.visits)), h('span.l', {}, 'Visits')),
            h('div.card.stat', {}, h('span.n', {}, num(s.pageviews)), h('span.l', {}, 'Page views')),
            h('div.card.stat', {}, h('span.n', {}, s.session_bounce_rate == null ? '—' : `${Math.round(s.session_bounce_rate)}%`), h('span.l', {}, 'Left after one page'))),
          h('div.card.mb-4', {}, h('strong', {}, 'Visitors'), lineChart(d.series, 'Visitors over time')),
          h('div.ahx-grid', {}, list('Top pages', d.pages, 'page'), list('Where they came from', d.sources, 'source')))
      }))
      body.replaceChildren(
        h('p.sub.mt-0', {}, cfg.loadAnalytics && cfg.analyticsKey
          ? 'From Ahrefs Web Analytics, which this site loads on every page.'
          : 'Ahrefs Web Analytics is not switched on for this site’s pages yet — turn it on under Setup to start counting.'),
        seg([[7, '7 days'], [30, '30 days'], [90, '90 days']], days, k => { days = k; load() }, 'Period'),
        h('div.mt-3', {}, inner))
      load()
    }
  }
  paint()
  return h('div', {}, seg([['audit', 'Site Audit'], ['ranks', 'Rank Tracker'], ['visits', 'Web Analytics']], sub, k => { sub = k; setPref('ahrefsProject', k); paint() }, 'Ahrefs tool'), body)
}

function setupTab(cfg, reloadPanel) {
  const v = { ...cfg, apiKey: '' }
  // Each control is named by its label (not its placeholder) for screen readers.
  let fid = 0
  const field = (label, control, help) => {
    control.id ||= `ahx-f${++fid}`
    return h('div.field', {}, h('label', { for: control.id }, h('span', {}, label), help ? h('span.help', {}, help) : ''), control)
  }
  const bind = (key, attrs = {}) => {
    const el = h('input.input', { value: v[key] ?? '', ...attrs })
    el.addEventListener('input', () => { v[key] = attrs.type === 'number' ? Number(el.value) : el.value })
    return el
  }
  const check = (key, label) => h('label.field-check', {},
    h('input', { type: 'checkbox', checked: !!v[key], onchange: e => { v[key] = e.target.checked } }), h('span', {}, label))

  const keyInput = bind('apiKey', { type: 'password', autocomplete: 'off', placeholder: cfg.hasKey ? `Saved (${cfg.keyHint}) — paste a new one to replace it` : 'Paste your Ahrefs API v3 key' })
  const usageEl = h('div.fnt.text-s')
  if (cfg.hasKey) {
    quiet(`${X}/usage`).then(({ usage: u }) => {
      const limit = u.units_limit_api_key ?? u.units_limit_workspace
      const used = u.units_usage_api_key ?? u.units_usage_workspace ?? 0
      usageEl.replaceChildren(
        h('span', {}, `${u.subscription || 'Ahrefs'} plan · ${num(used)}${limit ? ` of ${num(limit)}` : ''} API units used this cycle`),
        u.usage_reset_date ? h('span', {}, ` · resets ${shortDate(u.usage_reset_date)}`) : '',
        u.api_key_expiration_date ? h('span', {}, ` · key expires ${shortDate(u.api_key_expiration_date)}`) : '',
        h('span', {}, ` · this site: ${num(cfg.unitsThisMonth)} units in ${num(cfg.callsThisMonth)} requests this month`))
    }).catch(e => usageEl.replaceChildren(errorBox(e)))
  }

  const mode = h('select.input', { onchange: e => { v.mode = e.target.value } },
    ...[['subdomains', 'The whole domain, all subdomains'], ['domain', 'Just this domain'], ['prefix', 'This address and everything under it'], ['exact', 'Exactly this one address']]
      .map(([k, l]) => h('option', { value: k, selected: v.mode === k }, l)))

  const projectSel = h('select.input', { onchange: e => {
    v.projectId = e.target.value
    const p = projects.find(x => String(x.project_id) === v.projectId)
    if (p?.web_analytics_data_key && !v.analyticsKey) { v.analyticsKey = p.web_analytics_data_key; akInput.value = v.analyticsKey }
  } }, h('option', { value: '' }, cfg.hasKey ? 'Loading your projects…' : 'Save a key first'))
  let projects = []
  if (cfg.hasKey) {
    quiet(`${X}/projects`).then(({ rows }) => {
      projects = rows
      projectSel.replaceChildren(h('option', { value: '' }, rows.length ? 'None' : 'No projects in this Ahrefs account'),
        ...rows.map(p => h('option', { value: String(p.project_id), selected: String(p.project_id) === String(v.projectId) }, `${p.project_name} — ${p.url}`)))
    }).catch(() => projectSel.replaceChildren(h('option', { value: v.projectId }, v.projectId ? `Project ${v.projectId}` : 'Could not load projects')))
  }
  const akInput = bind('analyticsKey', { placeholder: 'Filled in from the project when it has one' })

  const save = async e => {
    const b = e.currentTarget; b.disabled = true
    try {
      await api(`${X}/config`, { method: 'PUT', body: v, quiet: true })
      toast(v.apiKey ? 'Key checked with Ahrefs and saved' : 'Ahrefs settings saved', 'ok')
      reloadPanel(v.apiKey && !cfg.hasKey ? 'overview' : 'setup')
    } catch (err) {
      toast(err.data?.error || err.message, 'err', 6000)
      b.disabled = false
    }
  }

  return h('div', {},
    h('div.card.mb-4', {},
      h('strong', {}, 'Connection'),
      h('p.sub', {}, 'An API v3 key from ', extLink('https://app.ahrefs.com/account/api-keys', 'Ahrefs → Account → API keys'),
        '. API access comes with Ahrefs Enterprise, or as an add-on. The key is checked with Ahrefs before it is kept, and stays on this server — it never reaches the site or git.'),
      field('API key', keyInput),
      cfg.hasKey ? h('div.d-flex.gap-2.items-center.wrap', {},
        usageEl,
        h('button.btn.ghost.small', { onclick: async () => {
          if (!(await confirmDialog('Remove the API key?', 'Reports stop until a new key is added. Nothing on the live site changes.', 'Remove'))) return
          await del(`${X}/config/key`); toast('Key removed', 'ok'); reloadPanel('setup')
        } }, 'Remove key')) : ''),
    h('div.card.mb-4', {},
      h('strong', {}, 'What to report on'),
      field('Site', bind('target', { placeholder: cfg.resolvedTarget || 'example.com' }), `Leave empty to use this site’s own address${cfg.resolvedTarget ? ` (${cfg.resolvedTarget})` : ''}.`),
      field('Covering', mode),
      field('Country', countrySelect(v.country, e => { v.country = e.target.value }), 'For keywords, rankings and traffic estimates.'),
      field('Ahrefs project', projectSel, 'Needed for Site Audit, Rank Tracker and Web Analytics.')),
    h('div.card.mb-4', {},
      h('strong', {}, 'On your pages'),
      field('Ahrefs verification tag', bind('verification', { placeholder: '<meta name="ahrefs-site-verification" content="…">' }),
        'Paste the tag Ahrefs Webmaster Tools gives you — the whole tag or just its code. It goes into every page’s <head>.'),
      field('Web Analytics key', akInput),
      check('loadAnalytics', 'Count visitors with Ahrefs Web Analytics (cookieless; waits for consent when the consent banner is on)')),
    h('div.card.mb-4', {},
      h('strong', {}, 'Spending API units'),
      field('Rows per report', bind('rows', { type: 'number', min: 10, max: 1000, step: 10 }),
        'The biggest lever on cost: Ahrefs charges per row. At 50 rows the Keywords report is about 1,750 units, a Backlinks list about 500.'),
      field('Keep answers for (hours)', bind('cacheHours', { type: 'number', min: 1, max: 336 }), 'Reports opened again within this time are free. Refresh always asks Ahrefs.'),
      field('Stop at (units this cycle)', bind('unitCap', { type: 'number', min: 0, step: 1000 }), '0 = no limit. Past this, reports show the last saved answer instead of asking Ahrefs.'),
      check('autoSnapshot', 'Record the headline numbers once a day, and fire “ahrefs.changed” for Automations when they move'),
      h('div.d-flex.gap-2.mt-2', {},
        h('button.btn.ghost.small', { onclick: async () => {
          const r = await post(`${X}/cache/clear`, {}); toast(`Cleared ${r.cleared} saved answers`, 'ok')
        } }, 'Forget saved answers'))),
    h('div.d-flex.gap-2', {}, h('button.btn.primary', { onclick: save }, 'Save')))
}

// ---------- the panel ----------

export async function ahrefsPanel() {
  const root = h('div.ahx')
  const TABS = [['overview', 'Overview'], ['links', 'Backlinks'], ['keywords', 'Keywords'], ['pages', 'Pages'], ['research', 'Research'], ['projects', 'Projects'], ['setup', 'Setup']]

  const build = async tab => {
    let cfg
    try { cfg = await quiet(`${X}/config`) } catch (e) { root.replaceChildren(errorBox(e)); return }
    if (!cfg.hasKey) tab = 'setup'
    tab ||= prefs().ahrefsTab || 'overview'
    const body = h('div.mt-4')
    const show = (k, arg) => {
      tab = k; setPref('ahrefsTab', k)
      for (const b of tabs.children) { const on = b.dataset.k === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)) }
      body.replaceChildren(
        k === 'overview' ? overviewTab()
          : k === 'links' ? backlinksTab()
          : k === 'keywords' ? keywordsTab()
          : k === 'pages' ? pagesTab()
          : k === 'research' ? researchTab(cfg, arg ?? prefs().ahrefsLastKeyword ?? '')
          : k === 'projects' ? projectsTab(cfg)
          : setupTab(cfg, build))
    }
    const tabs = h('div.seg.ahx-seg.ahx-tabs', { role: 'tablist', 'aria-label': 'Ahrefs reports' },
      ...TABS.map(([k, label]) => h('button', {
        role: 'tab', 'data-k': k, disabled: !cfg.hasKey && k !== 'setup',
        onclick: () => show(k),
      }, label)))
    hooks.ahrefsTab = k => show(k)
    hooks.ahrefsResearch = q => show('research', q)

    root.replaceChildren(
      h('p.sub.mt-0', {}, cfg.hasKey
        ? h('span', {}, 'Reporting on ', h('strong', {}, cfg.resolvedTarget || 'this site'), ` · ${COUNTRIES.find(c => c[0] === cfg.country)?.[1] || (cfg.country || '').toUpperCase()}`)
        : 'Connect your Ahrefs account to see who links to this site, what it ranks for, and what to write next.'),
      tabs, body)
    show(tab)
    root.closest('.main')?.scrollTo?.({ top: 0 })
  }
  await build()
  return root
}

// ---------- editor: the SEO tab's Ahrefs card ----------

/**
 * What Ahrefs knows about one page and its focus keyword. Asked for on a
 * button press, never on opening the tab — every lookup is API units.
 */
export function ahrefsPageCard(path, keyword) {
  const out = h('div.ahx-page')
  const run = async (fresh = false) => {
    out.replaceChildren(skeleton('rows', 3))
    try {
      const d = await quiet(`${X}/page?path=${encodeURIComponent(path)}&keyword=${encodeURIComponent(keyword || '')}${fresh ? '&fresh=1' : ''}`)
      const f = d.focus
      out.replaceChildren(
        h('div.ahx-kv', {},
          h('span', {}, 'Sites linking here'), h('strong', {}, num(d.backlinks.live_refdomains)),
          h('span', {}, 'Backlinks'), h('strong', {}, num(d.backlinks.live)),
          h('span', {}, 'Search visits / month'), h('strong', {}, num(d.metrics.org_traffic)),
          h('span', {}, 'Ranking keywords'), h('strong', {}, num(d.metrics.org_keywords))),
        keyword ? h('div.mt-2', {},
          h('div.fnt.text-xs', {}, `Focus keyword “${keyword}”`),
          f ? h('div.ahx-kv', {},
            h('span', {}, 'Searches / month'), h('strong', {}, num(f.volume)),
            h('span', {}, 'Difficulty'), h('strong', {}, difficulty(f.difficulty)),
            h('span', {}, 'Traffic potential'), h('strong', {}, num(f.traffic_potential)),
            f.parent_topic && f.parent_topic !== keyword ? h('span', {}, 'Parent topic') : '', f.parent_topic && f.parent_topic !== keyword ? h('strong', {}, f.parent_topic) : '')
            : h('p.fnt.text-s', {}, 'Ahrefs has no search data for that phrase.')) : '',
        d.keywords.length ? h('div.mt-2', {},
          h('div.fnt.text-xs', {}, 'This page ranks for'),
          ...d.keywords.slice(0, 6).map(k => h('div.d-flex.justify-between.text-s.gap-2', {},
            h('span.ovh.tov-ellipsis.nowrap', {}, k.keyword), h('span.nowrap', {}, `#${k.best_position ?? '?'} · ${num(k.volume)}`)))) : '',
        h('div.d-flex.gap-2.items-center.mt-2', {},
          h('span.fnt.text-xs', {}, `From Ahrefs ${ago(d.cachedAt)}`),
          h('button.btn.ghost.small', { onclick: () => run(true), title: 'Uses API units' }, 'Refresh')))
    } catch (e) {
      out.replaceChildren(h('p.fnt.text-s', {}, e.data?.error || e.message))
    }
  }
  out.append(h('button.btn.ghost.small', { onclick: () => run(false) }, iconEl('link', 13), 'Look this page up in Ahrefs'))
  return out
}
