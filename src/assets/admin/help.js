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
    h('h2', { style: { fontSize: 'var(--t-xl)', marginBottom: 'var(--s1)' } }, s.title),
    s.summary ? h('p.sub', { style: { marginBottom: 'var(--s4)' } }, s.summary) : '',
    ...(s.warnings || []).map(w => h('div.wb-warn', { style: { display: 'flex', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-s)', background: 'color-mix(in oklch, var(--warn) 12%, transparent)', color: 'var(--warn-ink)', marginBottom: 'var(--s3)', fontSize: 'var(--t-m)' } }, iconEl('warn', 16), h('span', {}, w))),
    s.facts?.length ? h('div.card', { style: { marginBottom: 'var(--s4)', padding: 'var(--s1) var(--s4)' } },
      ...s.facts.map(f2 => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(9rem, 14rem) 1fr', gap: 'var(--s4)', padding: 'var(--s3) 0', borderBottom: '1px solid var(--line-soft)' } },
        h('span', { style: { fontSize: 'var(--t-s)', fontWeight: 'var(--fw-semi)', color: 'var(--mut)' } }, f2.label),
        h('span', {}, h('span', { style: { fontSize: 'var(--t-m)' } }, f2.value),
          f2.hint ? h('div.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s0)' } }, f2.hint) : '')))) : '',
    s.steps?.length ? h('ul', { style: { margin: '0 0 var(--s4) var(--s5)', display: 'grid', gap: 'var(--s1)', fontSize: 'var(--t-m)', color: 'var(--mut)' } },
      ...s.steps.map(st => h('li', {}, st))) : '',
    ...(s.code || []).map(cd => h('div', { style: { marginBottom: 'var(--s3)' } },
      h('div.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s1)', display: 'flex', justifyContent: 'space-between' } },
        h('span', {}, cd.label),
        h('button.btn.ghost.small', { onclick: () => { navigator.clipboard?.writeText(cd.body); toast('Copied', 'ok') } }, 'Copy')),
      h('pre.code-out', { style: { whiteSpace: 'pre-wrap' } }, cd.body))),
    s.links?.length ? h('p', {}, ...s.links.map(l => h('a.btn.ghost.small', { href: l.href, target: l.external ? '_blank' : undefined, style: { marginRight: 'var(--s2)' } }, l.label, l.external ? iconEl('external', 12) : ''))) : '')

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

/**
 * A "?" for the current screen, opening its tips beside the work rather than
 * routing you away to Help. The server has produced these tips all along; until
 * now nothing in the studio rendered them.
 */
export function helpButton(panel, title) {
  return h('button.icon-btn', {
    title: `Help with ${title || panel}`, 'aria-label': `Help with ${title || panel}`,
    onclick: async () => {
      const { openSheet } = await import('./sheet.js')
      openSheet({
        title: `About ${title || panel}`,
        sub: 'Written from this site’s live configuration',
        body: async () => {
          const { tips } = await get(`/help/tips?panel=${encodeURIComponent(panel)}`).catch(() => ({ tips: [] }))
          return h('div', {},
            tips.length
              ? h('ul', { style: { margin: '0 0 var(--s4) var(--s5)', display: 'grid', gap: 'var(--s2)', fontSize: 'var(--t-m)', color: 'var(--mut)' } },
                ...tips.map(t => h('li', {}, t)))
              : h('p.mut', { style: { marginBottom: 'var(--s4)' } }, 'No tips for this screen yet.'),
            h('a.btn.ghost.small', { href: `#/help`, onclick: async () => (await import('./sheet.js')).closeSheet() },
              iconEl('book', 13), 'Open the full handbook'))
        },
      })
    },
  }, iconEl('help', 15))
}

