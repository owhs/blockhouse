// SEO suite view: site-wide audit with broken-link detection + redirects manager.

import { get, put } from './api.js'
import { h, toast, emptyState, fmtDate } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state } from './state.js'

registerView('seo', async root => {
  const main = h('div.main-pad', { style: { maxWidth: '72rem' } })
  root.replaceChildren(h('div.main', {}, main))

  main.append(h('div.page-head', {},
    h('div', {}, h('h1', {}, 'SEO'), h('p.sub', {}, 'Site-wide audit, internal link checks and redirect management. Per-page controls live in each document’s SEO tab.')),
    h('div', { style: { display: 'flex', gap: '0.5rem' } },
      h('a.btn.ghost.small', { href: '/sitemap.xml', target: '_blank' }, 'sitemap.xml'),
      h('a.btn.ghost.small', { href: '/robots.txt', target: '_blank' }, 'robots.txt'))))

  // ---------- feeds & sitemap (the switchboard's neighbours, managed here) ----------
  const feedsHolder = h('div')
  const paintFeeds = async () => {
    const feats = state.meta.features || {}
    const { concepts } = await get('/concepts')
    feedsHolder.replaceChildren(
      h('div', { style: { display: 'grid', gap: '0.3rem' } },
        h('div', { style: { display: 'flex', gap: '0.6rem', alignItems: 'baseline', fontSize: '0.84rem' } },
          h('strong', {}, 'Sitemap:'),
          feats.sitemap === false
            ? h('span', {}, 'off — ', h('a', { href: '#/settings/features' }, 'turn on in Features'))
            : h('span', {}, 'on · ', h('a', { href: '/sitemap.xml', target: '_blank' }, 'view'), ' · robots.txt points at it. Gated and unpublished pages never appear.')),
        h('div', { style: { display: 'flex', gap: '0.6rem', alignItems: 'baseline', fontSize: '0.84rem' } },
          h('strong', {}, 'RSS:'),
          feats.rss === false
            ? h('span', {}, 'off site-wide — ', h('a', { href: '#/settings/features' }, 'turn on in Features'), '. Blockhouse also removes feed links from menus, templates and content.')
            : h('span', {}, 'on for the types ticked below:')),
        ...(feats.rss === false ? [] : concepts.filter(c2 => c2.indexPath).map(c2 =>
          h('label.field-check', { style: { marginLeft: '0.5rem' } },
            h('input', { type: 'checkbox', checked: !!c2.feed, onchange: async e => {
              await put(`/concepts/${c2.name}`, { concept: { ...c2, feed: e.target.checked } })
              toast(e.target.checked ? `Feed on — ${c2.indexPath}/feed.xml` : 'Feed off (link removed everywhere)', 'ok')
            } }),
            h('span', {}, `${c2.labelPlural || c2.label} — `, h('code.pill-perm', {}, `${c2.indexPath}/feed.xml`)))))))
  }
  main.append(h('div.card', { style: { marginBottom: '1rem' } },
    h('div.page-head', { style: { marginBottom: '0.5rem' } }, h('strong', {}, 'Feeds & sitemap')),
    feedsHolder))
  paintFeeds()

  // ---------- audit ----------
  const auditHolder = h('div', {}, h('div.spin'))
  main.append(h('div.card', { style: { marginBottom: '1rem' } },
    h('div.page-head', { style: { marginBottom: '0.5rem' } }, h('strong', {}, 'Content audit'), h('span.fnt', { id: 'audit-sum' })),
    auditHolder))

  get('/seo/audit').then(({ docs, total }) => {
    const sum = document.getElementById('audit-sum')
    const clean = docs.filter(d => !d.errors && !d.warns).length
    if (sum) sum.textContent = `${total} documents · ${clean} clean`
    if (!docs.length) { auditHolder.replaceChildren(emptyState(icon('check', 26), 'Nothing to audit yet', '')); return }
    auditHolder.replaceChildren(h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Document'), h('th', {}, 'Health'), h('th', {}, 'Issues'))),
      h('tbody', {}, ...docs.map(d => {
        const dots = [
          d.errors ? h('span', { style: { color: 'var(--err)', fontWeight: 700, marginRight: '0.6rem' } }, `${d.errors} `, 'error' + (d.errors > 1 ? 's' : '')) : '',
          d.warns ? h('span', { style: { color: 'var(--warn)', fontWeight: 700 } }, `${d.warns} `, 'warning' + (d.warns > 1 ? 's' : '')) : '',
          !d.errors && !d.warns ? h('span', { style: { color: 'var(--ok)', fontWeight: 700, display: 'inline-flex', gap: '0.3rem', alignItems: 'center' } }, iconEl('check', 13), 'clean') : '',
        ]
        return h('tr', { onclick: () => (location.hash = `#/e/${d.id}`) },
          h('td', {}, h('strong', {}, d.title), h('div.row-sub', {}, `${d.concept} · ${d.path}`)),
          h('td', {}, ...dots),
          h('td', { style: { maxWidth: '28rem' } }, ...(d.issues.slice(0, 3).map(i =>
            h('div.seo-check', { class: i.level, style: { padding: '0.15rem 0' } }, h('span.dot'), h('span', {}, i.label)))),
            d.issues.length > 3 ? h('span.fnt', {}, `+${d.issues.length - 3} more…`) : ''))
      })))))
  }).catch(() => auditHolder.replaceChildren(emptyState(icon('warn', 26), 'Audit failed', '')))

  // ---------- redirects ----------
  const { redirects } = await get('/redirects')
  const rows = [...redirects]
  const list = h('div')
  const render = () => {
    list.replaceChildren(
      rows.length ? h('div.table-wrap', {}, h('table.data-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'From'), h('th', {}, 'To'), h('th', {}, 'Code'), h('th'))),
        h('tbody', {}, ...rows.map((r, i) => h('tr', { style: { cursor: 'default' } },
          h('td.mono', { style: { fontSize: '0.78rem' } }, r.from),
          h('td.mono', { style: { fontSize: '0.78rem' } }, r.to),
          h('td', {}, String(r.code || 301)),
          h('td', { style: { textAlign: 'right' } }, h('button.icon-btn', { onclick: () => { rows.splice(i, 1); render(); save() } }, iconEl('trash', 14))))))))
        : h('p.mut', {}, 'No redirects yet. Slug changes create automatic 301s on top of these.'))
  }
  const save = async () => { await put('/redirects', { redirects: rows }); toast('Redirects saved', 'ok') }

  const from = h('input.input', { placeholder: '/old-path', style: { maxWidth: '14rem' } })
  const to = h('input.input', { placeholder: '/new-path or https://…', style: { maxWidth: '16rem' } })
  const code = h('select.input', { style: { maxWidth: '7rem' } }, h('option', { value: '301' }, '301'), h('option', { value: '302' }, '302'))

  main.append(h('div.card', {},
    h('div.page-head', { style: { marginBottom: '0.6rem' } }, h('strong', {}, 'Redirects'),
      h('span.fnt', {}, 'exported to _redirects on static builds')),
    h('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' } },
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
