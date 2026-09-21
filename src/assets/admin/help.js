// Help view — task-based guidance for the person who runs the business, with
// the technical reference kept behind a "For developers" divider.
//
// The topic list on the left is grouped and searchable; the URL fragment
// (#/help/add-page) selects a topic and scrolls to it rather than hiding the
// rest, so you can always read on.

import { get } from './api.js'
import { h, emptyState, toast } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView } from './state.js'

const GROUPS = [
  ['start', 'Start here'],
  ['tasks', 'Everyday tasks'],
  ['reference', 'Reference'],
  ['developer', 'For developers'],
]

const groupOf = s => s.group || (s.audience === 'developer' ? 'developer' : 'reference')

registerView('help', async (root, [topic]) => {
  const { sections } = await get('/help')

  const nav = h('div.panel-body.help-nav')
  const body = h('div.main-pad.help-main')
  const search = h('input.input.help-search', { type: 'search', placeholder: 'Search help…', 'aria-label': 'Search help' })

  const haystack = s => [s.title, s.summary, ...(s.paras || []), ...(s.steps || []), ...(s.facts || []).flatMap(f => [f.label, f.value, f.hint])]
    .filter(Boolean).join(' ').toLowerCase()

  const select = id => {
    for (const b of nav.querySelectorAll('.row-item')) b.classList.toggle('active', b.dataset.help === id)
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const renderSection = s => h('section.help-sec', { id: `help-${s.id}` },
    h('h2.help-sec-title', {}, s.title),
    s.summary ? h('p.help-sec-sum', {}, s.summary) : '',
    ...(s.paras || []).map(p => h('p.help-para', {}, p)),
    ...(s.warnings || []).map(w => h('div.help-warn', {}, iconEl('warn', 16), h('span', {}, w))),
    s.steps?.length ? h('ol.help-steps', {}, ...s.steps.map(st => h('li.help-step', {}, h('span.help-step-n', {}), h('span', {}, st)))) : '',
    s.facts?.length ? h('dl.help-facts', {}, ...s.facts.flatMap(f => [
      h('dt.help-fact-k', {}, f.label),
      h('dd.help-fact-v', {}, h('span', {}, f.value), f.hint ? h('div.help-fact-hint', {}, f.hint) : ''),
    ])) : '',
    ...(s.audience === 'developer' ? (s.code || []) : []).map(cd => h('div.help-code', {},
      h('div.help-code-head', {},
        h('span', {}, cd.label),
        h('button.btn.ghost.small', { onclick: () => { navigator.clipboard?.writeText(cd.body); toast('Copied', 'ok') } }, 'Copy')),
      h('pre.code-out', {}, cd.body))),
    s.links?.length ? h('p', {}, ...s.links.map(l => h('a.btn.ghost.small.help-link', { href: l.href, target: l.external ? '_blank' : undefined }, l.label, l.external ? iconEl('external', 12) : ''))) : '')

  const drawNav = q => {
    const term = (q || '').trim().toLowerCase()
    const hits = term ? sections.filter(s => haystack(s).includes(term)) : sections
    const out = []
    for (const [key, label] of GROUPS) {
      const rows = hits.filter(s => groupOf(s) === key)
      if (!rows.length) continue
      // A bare <div> caption left 27 undifferentiated buttons in the tab order,
      // so nothing told a screen-reader user that "Navigation internals" was
      // the developer set (R11-4). The caption is a heading and the buttons it
      // heads are a group that points back at it.
      const capId = `help-group-${key}`
      out.push(h('h2.help-group', { id: capId }, label))
      out.push(h('div.help-group-rows', { role: 'group', 'aria-labelledby': capId },
        ...rows.map(s => h('button.row-item', { 'data-help': s.id, onclick: () => select(s.id) },
          h('span.row-ico', { html: icon(sectionIcon(s.id), 14) }), h('span.row-label', {}, s.title)))))
    }
    if (!out.length) out.push(h('p.mut.help-none', {}, 'Nothing matches that.'))
    nav.replaceChildren(...out)
  }

  search.addEventListener('input', () => drawNav(search.value))
  drawNav('')

  const ordered = GROUPS.flatMap(([key]) => sections.filter(s => groupOf(s) === key))
  const rendered = []
  let dividerDone = false
  for (const s of ordered) {
    if (groupOf(s) === 'developer' && !dividerDone) {
      dividerDone = true
      rendered.push(h('div.help-divider', { id: 'help-developers' },
        h('h2', {}, 'For developers'),
        h('p.sub', {}, 'Technical reference for whoever builds and hosts the site. You do not need any of this to run yours.')))
    }
    rendered.push(renderSection(s))
  }

  body.replaceChildren(
    h('div.page-head', {}, h('div', {}, h('h1', {}, 'Help'), h('p.sub', {}, 'How to do the everyday jobs on your website.'))),
    ...(sections.length ? rendered : [emptyState(icon('book', 26), 'No help yet', '')]))

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, 'Topics')),
      h('div.help-search-wrap', {}, search),
      nav),
    h('div.main', {}, body)))

  if (topic) requestAnimationFrame(() => select(topic))
})

function sectionIcon(id) {
  if (id.startsWith('plugin-')) return 'plug'
  return {
    'start-here': 'compass', 'add-page': 'plus', 'edit-text': 'pen', photos: 'image', 'add-block': 'layout',
    'move-block': 'grip', publish: 'rocket', unpublish: 'eye', navigation: 'menu', 'header-footer': 'columns',
    design: 'palette', audit: 'clock', users: 'users', glossary: 'book', overview: 'home', content: 'page',
    brand: 'tag', health: 'check', 'dev-blocks': 'code', 'dev-menus': 'code', 'dev-deploy': 'server', 'dev-security': 'shield',
  }[id] || 'book'
}

/**
 * A "?" for the current screen: what you can do here, and the how-tos that go
 * with it, opened beside the work instead of routing you away.
 */
/**
 * Screens whose "?" must be named after the rail entry, whatever the caller
 * passes. Settings used to say "Help with Site" — the name of the open section,
 * not of the screen — while the rail, the topbar and the address all say
 * Settings.
 */
const PANEL_TITLES = { settings: 'Settings', media: 'Assets' }

export function helpButton(panelSpec, title) {
  // `panel` may carry the type being shown, e.g. `content:page`, so the tips
  // can count that type instead of every document on the site.
  const [panel, concept = ''] = String(panelSpec).split(':')
  const name = PANEL_TITLES[panel] || title || panel
  return h('button.icon-btn', {
    title: `Help with ${name}`, 'aria-label': `Help with ${name}`,
    onclick: async () => {
      const { openSheet, closeSheet } = await import('./sheet.js')
      openSheet({
        title: `Help with ${name}`,
        sub: 'What you can do here',
        body: async () => {
          const { tips = [], tasks = [] } = await get(`/help/tips?panel=${encodeURIComponent(concept ? `${panel}:${concept}` : panel)}`).catch(() => ({}))
          return h('div', {},
            tips.length
              ? h('ul.help-tips', {}, ...tips.map(t => h('li', {}, t)))
              : h('p.mut.help-tips-none', {}, 'No tips for this screen yet.'),
            tasks.length
              ? h('div.help-related', {},
                h('h3.help-related-title', {}, 'Related how-tos'),
                ...tasks.map(t => h('a.help-related-row', { href: `#/help/${t.help}`, onclick: () => closeSheet() },
                  h('span', {}, t.label), iconEl('fwd', 13))))
              : '',
            h('a.btn.ghost.small.help-open', { href: '#/help', onclick: () => closeSheet() },
              iconEl('book', 13), 'Open the help guide'))
        },
      })
    },
  }, iconEl('help', 15))
}
