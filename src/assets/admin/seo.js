// SEO suite view: site-wide audit with broken-link detection + redirects manager.

import { get, put } from './api.js'
import { h, toast, undoToast, confirmDialog, emptyState, fmtDate, skeleton } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state, hooks } from './state.js'
import { helpButton } from './help.js'

/**
 * Three tiers, not two. Every check used to arrive as a "suggestion:" and a
 * page with four polish notes looked exactly as broken as a page with no title
 * — so an owner reading this concluded the whole site was in trouble.
 *
 *   problem      something is missing or broken. Fix it.
 *   worth a look something real but not urgent.
 *   suggestion   polish. Folded away until somebody asks for it.
 *
 * The check text itself is written in src/core/seo-analyze.ts, in the same
 * words the editor's SEO tab uses, so nothing has to be translated twice.
 */
const SUGGESTIONS = [
  /^Focus keyword/,
  /^No picture for when the page is shared/,
  /^Search-result title is very short/,
  /^Search-result title may be cut off/,
  /^Short description is very brief/,
  /^Short description may be cut off/,
  /^The web address is very long/,
  /^This page is deliberately hidden/,
]
/** "33 pages have no short description for search results" */
const groupLabel = g => /^No /.test(g.issue.label)
  ? `${g.docs.length} pages have ${g.issue.label[0].toLowerCase()}${g.issue.label.slice(1)}`
  : `${g.docs.length} pages: ${g.issue.label}`

const tierOf = issue =>
  issue.level === 'error' ? 'problem'
    : SUGGESTIONS.some(re => re.test(issue.label)) ? 'suggestion' : 'look'

/** { problem: [...], look: [...], suggestion: [...] } for one page. */
const sortIssues = (issues = []) => {
  const out = { problem: [], look: [], suggestion: [] }
  for (const i of issues) out[tierOf(i)].push(i)
  return out
}

registerView('seo', async root => {
  const main = h('div.main-pad.mw-72', {})
  root.replaceChildren(h('div.main', {}, main))

  main.append(h('div.page-head', {},
    h('div', {}, h('h1', {}, 'SEO'), h('p.sub', {}, 'How your pages look to search engines and social sites.')),
    h('div.seo-head-acts', {},
      helpButton('seo', 'SEO'),
      h('a.btn.ghost.small', { href: '/sitemap.xml', target: '_blank' }, 'sitemap.xml'),
      h('a.btn.ghost.small', { href: '/robots.txt', target: '_blank' }, 'robots.txt'))))

  // ---------- feeds & sitemap (the switchboard's neighbours, managed here) ----------
  const feedsHolder = h('div')
  const paintFeeds = async () => {
    const feats = state.meta.features || {}
    const { concepts } = await get('/concepts')
    feedsHolder.replaceChildren(
      h('div.stack-1', {},
        h('div.d-flex.gap-3.items-baseline.text-m', {},
          h('strong', {}, 'Sitemap:'),
          feats.sitemap === false
            ? h('span', {}, 'off — ', h('a', { href: '#/settings/advanced' }, 'turn on in Settings'))
            : h('span', {}, 'on · ', h('a', { href: '/sitemap.xml', target: '_blank' }, 'view'), ' · robots.txt points at it. Gated and unpublished pages never appear.')),
        h('div.d-flex.gap-3.items-baseline.text-m', {},
          h('strong', {}, 'News feeds (RSS):'),
          feats.rss === false
            ? h('span', {}, 'off site-wide — ', h('a', { href: '#/settings/advanced' }, 'turn on in Settings'), '. Feed links are removed from menus, templates and content too.')
            : h('span', {}, 'on for the kinds of page ticked below:')),
        ...(feats.rss === false ? [] : concepts.filter(c2 => c2.indexPath).map(c2 =>
          h('label.field-check.ml-2', {},
            h('input', { type: 'checkbox', checked: !!c2.feed, onchange: async e => {
              await put(`/concepts/${c2.name}`, { concept: { ...c2, feed: e.target.checked } })
              toast(e.target.checked ? `Feed on — ${c2.indexPath}/feed.xml` : 'Feed off (link removed everywhere)', 'ok')
            } }),
            h('span', {}, `${c2.labelPlural || c2.label} — `, h('code.pill-perm', {}, `${c2.indexPath}/feed.xml`)))))))
  }
  main.append(h('div.card.mb-4', {},
    h('div.card-head.mb-2', {}, h('strong', {}, 'Sitemap and news feeds')),
    feedsHolder))
  paintFeeds()

  // ---------- audit ----------
  // Every issue is listed. "+2 more…" hid exactly the problems someone came
  // here to find, and there was no way to see them without opening the page.
  const summaryEl = h('div.seo-summary')
  const auditHolder = h('div', {}, skeleton('rows', 6))
  main.append(h('div.card.seo-audit-card', {},
    h('div.card-head.mb-2', {}, h('strong', {}, 'Your pages')),
    summaryEl, auditHolder))

  let onlyProblems = false
  get('/seo/audit').then(({ docs }) => {
    if (!docs.length) {
      summaryEl.remove()
      auditHolder.replaceChildren(emptyState(icon('check', 26), 'Nothing to check yet', 'Add a page and it will be checked here.'))
      return
    }
    // A page whose only notes are suggestions is a fine page.
    const tiers = new Map(docs.map(d => [d.id, sortIssues(d.issues)]))
    // Three ranks, so a site whose only fault is missing descriptions does not
    // read as a broken site: a real problem needs attention, a "to look at"
    // note only means the page could be better.
    const rankOf = d => {
      const t = tiers.get(d.id)
      return t.problem.length ? 'attention' : t.look.length ? 'better' : 'fine'
    }
    const needsAttention = d => rankOf(d) !== 'fine'
    const attention = docs.filter(d => rankOf(d) === 'attention').length
    const better = docs.filter(d => rankOf(d) === 'better').length
    const clean = docs.length - attention - better

    const onlyToggle = h('label.field-check.seo-only', {},
      h('input', { type: 'checkbox', onchange: e => { onlyProblems = e.target.checked; paintRows() } }),
      h('span', {}, 'Show only pages with something to do'))
    summaryEl.replaceChildren(
      h('p.seo-summary-line', {},
        h('strong', {}, `${clean} page${clean === 1 ? '' : 's'} ${clean === 1 ? 'is' : 'are'} fine`), ' · ',
        h('strong', { class: attention ? 'seo-needy' : '' }, `${attention} need${attention === 1 ? 's' : ''} attention`), ' · ',
        h('strong', {}, `${better} could be better`)),
      attention + better ? onlyToggle : '')

    // 91 links all reading "Fix" tell a screen reader (and a hovering mouse)
    // nothing. Same text in aria-label and title: which page, which problem.
    const fixLink = (d, i) => {
      const name = `Fix: ${d.title} — ${i?.label || 'this page'}`
      return h('a.btn.ghost.small.seo-fix', {
        href: `#/e/${d.id}/seo`,
        'aria-label': name,
        title: name,
        onclick: () => hooks.pushReturn?.('SEO', location.hash),
      }, 'Fix')
    }

    const checkLine = (d, i, tier) => h('div.seo-check', { class: tier },
      h('span.seo-ico', { html: icon(tier === 'problem' ? 'warn' : 'info', 12), 'aria-hidden': 'true' }),
      h('span.seo-issue-text', {}, i.label,
        i.detail ? h('span.seo-issue-detail', {}, ` ${i.detail}`) : ''),
      fixLink(d, i))

    // ≥5 pages whose only note is the same one thing collapse into a single
    // row with an expander, so 33 identical lines do not bury the real faults.
    const GROUP_MIN = 5
    const soleIssue = d => {
      const t = tiers.get(d.id)
      return t.problem.length + t.look.length === 1 ? (t.problem[0] || t.look[0]) : null
    }
    const groups = new Map()
    for (const d of docs) {
      const only = soleIssue(d)
      if (!only) continue
      if (!groups.has(only.label)) groups.set(only.label, { issue: only, docs: [] })
      groups.get(only.label).docs.push(d)
    }
    for (const [label, g] of [...groups]) if (g.docs.length < GROUP_MIN) groups.delete(label)
    const groupedIds = new Set([...groups.values()].flatMap(g => g.docs.map(d => d.id)))

    const paintRows = () => {
      const shown = (onlyProblems ? docs.filter(needsAttention) : docs).filter(d => !groupedIds.has(d.id))
      const groupRows = [...groups.values()].map(g => h('tr.seo-row.seo-group-row', {},
        h('td', { colspan: '3' },
          h('details.seo-group', {},
            h('summary', {},
              h('span.seo-ico', { html: icon(tierOf(g.issue) === 'problem' ? 'warn' : 'info', 12), 'aria-hidden': 'true' }),
              h('span.seo-group-label', {}, groupLabel(g))),
            h('div.seo-group-list', {}, ...g.docs.map(d =>
              h('div.seo-group-item', {},
                h('a.seo-doc-link', {
                  href: `#/e/${d.id}/seo`,
                  onclick: () => hooks.pushReturn?.('SEO', location.hash),
                }, d.title),
                h('span.row-sub', {}, d.path))))))))
      // cards-sm: one card per page on a phone (see studio.css R16).
      auditHolder.replaceChildren(h('div.table-wrap', {}, h('table.data-table.cards-sm', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Page'), h('th', {}, 'How it looks'), h('th', {}, 'What needs doing'))),
        h('tbody', {}, ...shown.map(d => {
          const t = tiers.get(d.id)
          return h('tr.seo-row', {},
            h('td', { 'data-label': '' },
              h('a.seo-doc-link', {
                href: `#/e/${d.id}/seo`,
                onclick: () => hooks.pushReturn?.('SEO', location.hash),
              }, d.title),
              h('div.row-sub', {}, `${d.concept} · ${d.path}`)),
            h('td', { 'data-label': 'How it looks' },
              // The same three words the summary line above uses — one state,
              // one name for it.
              t.problem.length ? h('span.seo-count.err', {}, 'Needs attention') : '',
              !t.problem.length && t.look.length ? h('span.seo-count.warn', {}, 'Could be better') : '',
              !t.problem.length && !t.look.length ? h('span.seo-count.ok', {}, iconEl('check', 13), 'Fine') : ''),
            h('td.seo-issues', { 'data-label': 'What needs doing' },
              ...t.problem.map(i => checkLine(d, i, 'problem')),
              ...t.look.map(i => checkLine(d, i, 'look')),
              !t.problem.length && !t.look.length ? h('span.fnt', {}, 'Nothing needs doing.') : '',
              // polish, on request only
              t.suggestion.length
                ? h('details.seo-suggestions', {},
                  h('summary', {}, `Show suggestions (${t.suggestion.length})`),
                  h('div', {}, ...t.suggestion.map(i => checkLine(d, i, 'suggestion'))))
                : ''))
        }), ...groupRows))))
    }
    paintRows()
  }).catch(() => auditHolder.replaceChildren(emptyState(icon('warn', 26), 'The check could not run', 'Reload the page to try again.')))

  // ---------- redirects ----------
  const { redirects } = await get('/redirects')
  const rows = [...redirects]
  const list = h('div')
  const render = () => {
    list.replaceChildren(
      rows.length ? h('div.table-wrap', {}, h('table.data-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'From'), h('th', {}, 'To'), h('th', {}, 'Kind'), h('th'))),
        h('tbody', {}, ...rows.map((r, i) => h('tr.cursor-default', {},
          h('td.mono.text-s', {}, r.from),
          h('td.mono.text-s', {}, r.to),
          h('td', {}, +r.code === 302 ? 'Temporary (302)' : 'Permanent (301)'),
          h('td.ta-r', {}, h('button.icon-btn', { onclick: async () => {
            const gone = rows[i]
            if (!(await confirmDialog('Delete redirect',
              `Stop redirecting ${gone.from} to ${gone.to}? Anyone following an old link will get a “not found” instead.`))) return
            rows.splice(i, 1); render(); save()
            undoToast(`Deleted the redirect from ${gone.from}`, () => { rows.splice(i, 0, gone); render(); save() })
          } }, iconEl('trash', 14))))))))
        : h('p.mut', {}, 'No redirects yet. Renaming a page’s address sets one up on its own, on top of any you add here.'))
  }
  const save = async () => { await put('/redirects', { redirects: rows }); toast('Redirects saved', 'ok') }

  const from = h('input.input.mw-14', { 'aria-label': 'Redirect from (old address)', placeholder: '/old-path' })
  const to = h('input.input.mw-16', { 'aria-label': 'Redirect to (new address)', placeholder: '/new-path or https://…' })
  const code = h('select.input.mw-14', { 'aria-label': 'Kind of redirect' },
    h('option', { value: '301' }, 'Permanent (301)'),
    h('option', { value: '302' }, 'Temporary (302)'))

  main.append(h('div.card', {},
    h('div.card-head.mb-3', {}, h('strong', {}, 'Redirects'),
      h('span.fnt', {}, 'Old web addresses that should send visitors somewhere new')),
    h('p.fnt.r5b-redirect-help', {}, 'Permanent tells search engines the page has moved for good; temporary says it will come back.'),
    h('div.d-flex.gap-2.mb-4.wrap', {},
      from, to, code,
      h('button.btn.primary.small', {
        onclick: () => {
          if (!from.value.startsWith('/') || !to.value) return toast('From must start with /', 'err')
          rows.push({ from: from.value.trim(), to: to.value.trim(), code: +code.value })
          from.value = ''; to.value = ''
          render(); save()
        },
      }, 'Add redirect')),
    list))
  render()
})
