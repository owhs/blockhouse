// Help view — renders the server-generated, site-specific documentation.
// Every fact here is read from the live site, so it can't drift from reality.

import { get } from './api.js'
import { h, emptyState, toast } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView } from './state.js'

registerView('help', async (root, [topic]) => {
  const { sections, site } = await get('/help' + (topic ? `?topic=${encodeURIComponent(topic)}` : ''))
  const nav = h('div.panel-body')
  const body = h('div.main-pad', { style: { maxWidth: '58rem' } })

  const renderSection = s => h('section', { id: `help-${s.id}`, style: { marginBottom: '2rem', scrollMarginTop: '1rem' } },
    h('h2', { style: { fontSize: '1.05rem', marginBottom: '0.3rem' } }, s.title),
    s.summary ? h('p.sub', { style: { marginBottom: '0.9rem' } }, s.summary) : '',
    ...(s.warnings || []).map(w => h('div.wb-warn', { style: { display: 'flex', gap: '0.6rem', padding: '0.7rem 0.9rem', borderRadius: '8px', background: 'color-mix(in oklch, var(--warn) 12%, transparent)', color: 'var(--warn)', marginBottom: '0.7rem', fontSize: '0.85rem' } }, iconEl('warn', 16), h('span', {}, w))),
    s.facts?.length ? h('div.card', { style: { marginBottom: '0.9rem', padding: '0.3rem 1rem' } },
      ...s.facts.map(f2 => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(9rem, 14rem) 1fr', gap: '0.9rem', padding: '0.6rem 0', borderBottom: '1px solid var(--line-soft)' } },
        h('span', { style: { fontSize: '0.8rem', fontWeight: 650, color: 'var(--mut)' } }, f2.label),
        h('span', {}, h('span', { style: { fontSize: '0.87rem' } }, f2.value),
          f2.hint ? h('div.fnt', { style: { fontSize: '0.76rem', marginTop: '0.15rem' } }, f2.hint) : '')))) : '',
    s.steps?.length ? h('ul', { style: { margin: '0 0 0.9rem 1.1rem', display: 'grid', gap: '0.35rem', fontSize: '0.87rem', color: 'var(--mut)' } },
      ...s.steps.map(st => h('li', {}, st))) : '',
    ...(s.code || []).map(cd => h('div', { style: { marginBottom: '0.7rem' } },
      h('div.fnt', { style: { fontSize: '0.76rem', marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between' } },
        h('span', {}, cd.label),
        h('button.btn.ghost.small', { onclick: () => { navigator.clipboard?.writeText(cd.body); toast('Copied', 'ok') } }, 'Copy')),
      h('pre.code-out', { style: { whiteSpace: 'pre-wrap' } }, cd.body))),
    s.links?.length ? h('p', {}, ...s.links.map(l => h('a.btn.ghost.small', { href: l.href, target: l.external ? '_blank' : undefined, style: { marginRight: '0.4rem' } }, l.label, l.external ? iconEl('external', 12) : ''))) : '')

  nav.replaceChildren(...sections.map(s =>
    h('button.row-item', { onclick: () => document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      h('span.row-ico', { html: icon(sectionIcon(s.id), 14) }), h('span.row-label', {}, s.title))))

  body.replaceChildren(
    h('div.page-head', {}, h('div', {},
      h('h1', {}, 'Help'),
      h('p.sub', {}, `Written from this site’s live configuration — ${site.name} on the ${site.template} template.`))),
    ...(sections.length ? sections.map(renderSection) : [emptyState(icon('book', 26), 'No help yet', '')]))

  root.replaceChildren(h('div.split', {},
    h('div.panel', {}, h('div.panel-head', {}, h('span.panel-title', {}, 'Topics')), nav),
    h('div.main', {}, body)))
})

function sectionIcon(id) {
  if (id.startsWith('plugin-')) return 'plug'
  return { overview: 'home', content: 'page', menus: 'menu', blocks: 'layout', brand: 'palette', deploy: 'rocket', security: 'key', health: 'check' }[id] || 'book'
}

/** Small contextual tips block other views can drop in. */
export async function tipsFor(panel) {
  const { tips } = await get(`/help/tips?panel=${panel}`).catch(() => ({ tips: [] }))
  if (!tips.length) return h('span')
  return h('details.card', { style: { marginBottom: '1rem', padding: '0.7rem 0.9rem' } },
    h('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: 'var(--mut)', display: 'flex', gap: '0.45rem', alignItems: 'center' } },
      iconEl('info', 14), 'Tips for this screen'),
    h('ul', { style: { margin: '0.5rem 0 0 1.1rem', display: 'grid', gap: '0.3rem', fontSize: '0.83rem', color: 'var(--mut)' } },
      ...tips.map(t => h('li', {}, t))))
}
