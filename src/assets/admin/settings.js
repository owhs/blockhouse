// Settings — six groups, one Save per page.
//
// Every card used to carry its own Save button (thirteen groups, thirteen-plus
// buttons) and every page repeated "Stored in site/site.json". This file owns
// the whole settings surface now: each card is a *section* exposing
// `collect()` (the patch it wants written) and `validate()` (what is wrong),
// and the page saves all of them in a single PUT when the sticky bar's Save
// is pressed.

import { get, put, post, del } from './api.js'
import { h, dialog, confirmDialog, toast, skeleton, debounce } from './ui.js'
import { renderFields, validateFields } from './fields.js'
import { registerView, registerGuard, state, VIEWS } from './state.js'
import { icon, iconEl } from './icons.js'
import { SETTINGS_ROWS, assertCatalogue } from './catalog.js'
import { helpButton } from './help.js'
import { noteHash } from './state.js'

// Languages people actually pick, by name — a free text box invited "english"
// and "EN-gb", neither of which is a valid lang attribute.
const LANGUAGES = [
  ['en', 'English'], ['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)'],
  ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'],
  ['fi', 'Finnish'], ['cs', 'Czech'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
  ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh', 'Chinese'], ['zh-Hant', 'Chinese (traditional)'],
]

const MODULE_LIST = [
  ['media', 'Files and images'], ['menus', 'Menus'], ['seo', 'Search listing'], ['help', 'Help'],
  ['users', 'People'], ['plugins', 'Apps'], ['settings', 'Settings'],
]

/** Deep-merge plain objects, so two sections can both contribute to `theme`. */
function mergePatch(target, add) {
  for (const [k, v] of Object.entries(add || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergePatch(target[k], v)
    } else target[k] = v
  }
  return target
}

/** A settings card. No Save button — the page has one. */
function card(title, sub, ...body) {
  return h('div.set-card', {},
    h('div.set-card-head', {},
      h('strong', {}, title),
      sub ? h('p.sub', {}, sub) : ''),
    ...body)
}

/** A titled block inside a card body. */
function subhead(text, note) {
  return h('div.set-sub', {}, h('div.set-sub-title', {}, text), note ? h('p.fnt.set-sub-note', {}, note) : '')
}

/** Passwords are not text. fields.js has no password type, so build one. */
function secretField(label, help, value, onInput) {
  const input = h('input', { type: 'password', value: value || '', autocomplete: 'off', spellcheck: 'false' })
  input.addEventListener('input', () => onInput(input.value))
  const reveal = h('button.btn.ghost.small', {
    type: 'button',
    onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; reveal.textContent = input.type === 'password' ? 'Show' : 'Hide' },
  }, 'Show')
  return h('div.field', {},
    h('label', {}, h('span', {}, label), help ? h('span.help', {}, help) : ''),
    h('div.set-secret', {}, input, reveal))
}

// ---------------------------------------------------------------- sections

const SITE_FIELDS = [
  { key: 'name', type: 'text', label: 'Site name', required: true, keywords: 'title brand company business logo' },
  { key: 'tagline', type: 'text', label: 'Tagline', help: 'One line describing the business.', keywords: 'strapline slogan subtitle' },
  { key: 'url', type: 'text', label: 'Web address', format: 'url', help: 'The address visitors use, starting with https://', keywords: 'domain url canonical https hostname' },
]
const LANGUAGE_FIELD = {
  key: 'language', type: 'select', label: 'Language', width: 'half', required: true,
  help: 'The language the site is written in.',
  keywords: 'locale lang code translation english',
}

function siteSection(s) {
  const DEFS = SITE_FIELDS
  const vals = { name: s.name || '', url: s.url || '', tagline: s.tagline || '', language: s.language || 'en' }
  return {
    el: card('The basics', null,
      renderFields(DEFS, vals, () => {}),
      renderFields([{ ...LANGUAGE_FIELD, options: LANGUAGES.map(([v, l]) => ({ value: v, label: `${l} (${v})` })) }], vals, () => {})),
    collect: () => ({ name: vals.name, url: vals.url, tagline: vals.tagline, language: vals.language }),
    validate: () => validateFields(DEFS, vals),
  }
}

const TAB_PATTERN_FIELDS = [
  { key: 'titlePattern', type: 'text', label: 'Browser tab pattern', help: '{title} is the page name, {site} is the site name.', keywords: 'seo title suffix template tab' },
]
const SHARE_FIELDS = [
  { key: 'description', type: 'textarea', label: 'Description shown in search results', rows: 2, help: 'Shown under the link in search results, when a page has none of its own.', keywords: 'seo snippet meta google robots search engines sitemap' },
  { key: 'image', type: 'image', label: 'Picture used when a link is shared', keywords: 'og opengraph social preview thumbnail card image logo share' },
  { key: 'twitter', type: 'text', label: 'X (Twitter) handle', width: 'half', help: 'e.g. @strongmanlifts', keywords: 'social account twitter' },
]

function shareSection(s) {
  const vals = {
    titlePattern: s.seo.titlePattern || '{title} — {site}',
    description: s.seo.description || '', twitter: s.seo.twitter || '', image: s.seo.image || '',
  }
  const example = h('p.fnt.set-example')
  const sync = () => {
    const shown = String(vals.titlePattern || '{title} — {site}')
      .replace(/\{title\}/g, 'About').replace(/\{site\}/g, s.name || 'Strongman Lifts')
    example.textContent = `Your browser tab will read: ${shown}`
  }
  sync()
  return {
    el: card('How the site looks when shared',
      'Used for the browser tab, Google results and the preview card when somebody pastes a link into a chat.',
      renderFields(TAB_PATTERN_FIELDS, vals, () => sync()),
      example,
      renderFields(SHARE_FIELDS, vals, () => {})),
    collect: () => ({ seo: { ...s.seo, ...vals } }),
    validate: () => [],
  }
}

/** Content types, rendered in place by reusing the existing concepts view. */
function typesSection() {
  const holder = h('div.set-embed', { id: 'settings-types' }, skeleton('rows', 4))
  // Content types save themselves; their edits must not light up the settings
  // page's "you have unsaved changes" bar.
  for (const ev of ['input', 'change']) holder.addEventListener(ev, e => e.stopPropagation())
  const view = VIEWS.concepts
  if (view) Promise.resolve(view(holder, [], new URLSearchParams())).catch(e =>
    holder.replaceChildren(h('p.mut', {}, `Could not load content types: ${e.message}`)))
  else holder.replaceChildren(h('p.mut', {}, 'Content types are unavailable.'))
  return {
    el: card('Content types',
      'The kinds of thing this site holds — pages, posts, projects — and the fields each one asks for.',
      holder),
    collect: () => ({}),
    validate: () => [],
  }
}

const ADDRESS_FIELDS = [
  { key: 'style', type: 'select', label: 'Page addresses look like', keywords: 'url style trailing slash pretty extension html permalink', options: [
    { value: 'directory', label: '/about/' },
    { value: 'extension', label: '/about.html' },
    { value: 'bare', label: '/about' }] },
  { key: 'layout', type: 'select', label: 'Where pages sit', keywords: 'permalink pattern structure path flat', options: [
    { value: 'pattern', label: 'Grouped by type - /blog/my-post' },
    { value: 'flat', label: 'All at the top - /my-post' }] },
  { key: 'lowercase', type: 'boolean', label: 'Always use lower-case addresses', keywords: 'case url' },
  { key: 'shortlinks', type: 'boolean', label: 'Short links', keywords: 'shortlink redirect tiny qr' },
  { key: 'shortlinkPrefix', type: 'text', label: 'Short link prefix', width: 'half', keywords: 'shortlink' },
]

function addressStyleSection(s) {
  const u = s.urls || {}
  const vals = {
    style: u.style || 'directory', layout: u.layout || 'pattern',
    lowercase: u.lowercase !== false, shortlinks: !!u.shortlinks, shortlinkPrefix: u.shortlinkPrefix || 's',
  }
  const preview = h('p.fnt.set-example')
  const sync = () => {
    const p = vals.layout === 'flat' ? '/about' : '/blog/my-post'
    const shown = vals.style === 'extension' ? `${p}.html` : vals.style === 'bare' ? p : `${p}/`
    preview.textContent = `A page address will look like ${shown}` + (vals.shortlinks ? `   ·   short link: /${vals.shortlinkPrefix}/ab12cd` : '')
  }
  sync()
  return {
    el: card('Web address style', 'How page addresses are written.',
      renderFields(ADDRESS_FIELDS, vals, () => sync()),
      preview,
      h('p.fnt.set-note', {}, 'Short links give every page a tiny address like /s/ab12cd that you can print or text to someone. Renaming a page keeps the old address working.')),
    collect: () => ({ urls: { ...vals } }),
    validate: () => [],
  }
}

function brandSection(s, markDirty) {
  const defs = s.varDefs ? JSON.parse(JSON.stringify(s.varDefs)) : []
  const vals = s.vars ? JSON.parse(JSON.stringify(s.vars)) : {}
  const holder = h('div')

  const render = () => {
    const groups = {}
    for (const d of defs) (groups[d.group || ''] ??= []).push(d)
    holder.replaceChildren(
      ...Object.entries(groups).map(([g, list]) => {
        const inner = h('div')
        const grid = renderFields(list.map(d => ({
          key: d.key, label: d.label || d.key, type: d.type || 'text', help: d.help,
          options: d.options, width: ['color', 'number', 'boolean'].includes(d.type) ? 'half' : undefined,
        })), vals, () => {})
        // The remove control belongs on the row it removes, named after the
        // thing it removes — not in a strip of raw {{var.x}} tokens carrying
        // fifteen unlabelled crosses.
        for (const d of list) {
          const label = d.label || d.key
          const row = grid.querySelector(`[data-field-key="${CSS.escape(d.key)}"]`)
          if (!row) continue
          row.appendChild(h('button.brandvar-remove', {
            type: 'button',
            'aria-label': `Remove ${label}`,
            onclick: async () => {
              const ok = await confirmDialog('Remove ' + label + '?',
                `Remove ${label}? Anywhere it is used will show nothing.`, 'Remove')
              if (!ok) return
              const at = defs.findIndex(x => x.key === d.key)
              if (at >= 0) defs.splice(at, 1)
              delete vals[d.key]
              render(); markDirty()
            },
          }, 'Remove'))
        }
        inner.appendChild(grid)
        return g ? h('div.field-group', {}, h('div.fg-title', {}, g), inner) : inner
      }),
      defs.length ? '' : h('p.mut.set-note', {}, 'Nothing here yet. Add one below.'),
      defs.length ? h('details.brandvar-tokens', {},
        h('summary', {}, 'For designers: how to use these in templates'),
        h('p.fnt', {}, 'Type one of these into any page text or template and it fills in with the value above.'),
        h('ul.brandvar-token-list', {},
          ...defs.map(d => h('li', {},
            h('code', {}, `{{var.${d.key}}}`),
            h('span.mut', {}, ` ${d.label || d.key}`))))) : '')
  }
  render()

  const addVar = () => {
    const nv = { key: '', label: '', type: 'text', group: '' }
    dialog({
      title: 'New thing to reuse',
      body: renderFields([
        { key: 'key', type: 'text', label: 'Short name', help: 'lower-case, no spaces — you type it as {{var.shortname}}', required: true },
        { key: 'label', type: 'text', label: 'What to call it here' },
        { key: 'type', type: 'select', label: 'Kind', options: ['text', 'textarea', 'color', 'image', 'link', 'number', 'boolean'].map(v => ({ value: v })), width: 'half' },
        { key: 'group', type: 'text', label: 'Group it under', width: 'half' },
      ], nv, () => {}),
      actions: [{ label: 'Add', kind: 'primary', onClick: () => {
        if (!/^[a-z][\w-]*$/.test(nv.key)) { toast('Short name must start with a letter and have no spaces', 'err'); return false }
        defs.push({ ...nv, label: nv.label || nv.key }); render(); markDirty(); return true
      } }],
    })
  }

  return {
    el: card('Brand variables',
      'Things you type once and reuse everywhere — a phone number, an opening line. Type {{var.phone}} in any text and it fills in.',
      h('div.set-card-actions', {}, h('button.btn.ghost.small', { onclick: addVar }, iconEl('plus', 14), 'Add one')),
      holder),
    collect: () => ({ vars: vals, varDefs: defs }),
    validate: () => [],
  }
}

const SPECIAL_PAGE_FIELDS = [
  { key: '404', type: 'select', label: 'Page not found (404)', help: 'Shown when somebody follows a link to a page that does not exist.', keywords: '404 missing error broken link' },
  { key: 'maintenance', type: 'select', label: 'Closed for maintenance', help: 'Shown to visitors while the site is closed, below.', keywords: 'maintenance offline holding page 503' },
]
const MAINTENANCE_FIELDS = [
  { key: 'enabled', type: 'boolean', label: 'Close the site to visitors now', keywords: 'maintenance offline 503' },
  { key: 'message', type: 'text', label: 'Message', help: 'Used if you have not chosen a page above.', keywords: 'maintenance' },
  { key: 'retryAfter', type: 'number', label: 'Tell visitors to come back in (seconds)', width: 'half', keywords: 'maintenance retry' },
]
const MAINTENANCE_ALLOW_FIELDS = [
  { key: 'allow', type: 'text', label: 'Addresses that stay open', help: 'Separate with commas, e.g. /status, /contact', keywords: 'maintenance allow exception' },
]

function specialPagesSection(s) {
  const sys = { ...(s.systemPages || {}) }
  const m = { enabled: false, message: '', retryAfter: 600, allow: [], ...(s.maintenance || {}) }
  const holder = h('div', {}, skeleton('rows', 5))

  get('/content').then(({ docs }) => {
    const options = [{ value: '', label: 'Use the built-in one' },
      ...docs.map(d => ({ value: d.id, label: `${d.title}  (${d.path})` }))]
    const allowVal = { allow: (m.allow || []).join(', ') }
    holder.replaceChildren(
      renderFields(SPECIAL_PAGE_FIELDS.map(f => ({ ...f, options })), sys, () => {}),
      subhead('Close the site temporarily'),
      renderFields(MAINTENANCE_FIELDS, m, () => {}),
      renderFields(MAINTENANCE_ALLOW_FIELDS, allowVal, (k, v) => { m.allow = String(v).split(',').map(x => x.trim()).filter(Boolean) }),
      h('p.fnt.set-note', {}, 'While the site is closed, visitors see your message instead of the site, and search engines are told to come back later rather than dropping you from results. You and anyone else signed in to the studio still see everything.'))
  }).catch(() => holder.replaceChildren(h('p.mut', {}, 'Could not load pages.')))

  return {
    el: card('Special pages', 'The two pages nobody navigates to on purpose.', holder),
    collect: () => {
      const clean = {}
      for (const [k, v] of Object.entries(sys)) if (v) clean[k] = v
      return { systemPages: clean, maintenance: m }
    },
    validate: () => [],
  }
}

// ----- email -------------------------------------------------------------

const MAIL_PROVIDERS = [
  { value: 'console', label: 'None — just write it to the server log (for testing)' },
  { value: 'resend', label: 'Resend' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'postmark', label: 'Postmark' },
  { value: 'mailchannels', label: 'MailChannels (Cloudflare)' },
  { value: 'webhook', label: 'Send it to a web address of my own' },
]

const EMAIL_DRIVER_FIELDS = [
  { key: 'driver', type: 'select', label: 'Send email through', required: true, keywords: 'mail smtp resend sendgrid postmark webhook provider api key' },
]
const EMAIL_FROM_FIELDS = [
  { key: 'from', type: 'text', label: 'Messages come from', width: 'half', help: 'e.g. hello@strongmanlifts.co.uk', keywords: 'sender from reply address' },
]

function emailSection(s, markDirty, saveIfDirty) {
  const vals = { driver: s.mail.driver || 'console', from: s.mail.from || '' }
  const options = { ...(s.mail.options || {}) }
  const extra = h('div')

  const paintExtra = () => {
    if (['resend', 'sendgrid', 'postmark'].includes(vals.driver)) {
      extra.replaceChildren(secretField('API key',
        `Copy it from your ${MAIL_PROVIDERS.find(p => p.value === vals.driver).label} account.`,
        options.apiKey || '', v => { options.apiKey = v; markDirty() }))
    } else if (vals.driver === 'webhook') {
      const input = h('input', { type: 'text', value: options.url || '', placeholder: 'https://…' })
      input.addEventListener('input', () => { options.url = input.value; markDirty() })
      extra.replaceChildren(h('div.field', {},
        h('label', {}, h('span', {}, 'URL to post to'), h('span.help', {}, 'Each message is sent to this address as JSON.')),
        input))
    } else extra.replaceChildren()
  }
  paintExtra()

  const testBtn = h('button.btn.soft.small', {
    onclick: async e => {
      const b = e.currentTarget
      b.disabled = true
      try {
        await saveIfDirty()
        const r = await post('/mail/test', {}).catch(err => ({ error: err.message }))
        toast(r.ok ? `Test sent to ${r.to}` : `Could not send: ${r.error}`, r.ok ? 'ok' : 'err', 6000)
      } finally { b.disabled = false }
    },
  }, iconEl('send', 13), 'Send me a test email')

  return {
    el: card('Sending email',
      'Used for password resets, form notifications and anything an app sends.',
      renderFields(EMAIL_DRIVER_FIELDS.map(f => ({ ...f, options: MAIL_PROVIDERS })), vals, () => { paintExtra() }),
      extra,
      renderFields(EMAIL_FROM_FIELDS, vals, () => {}),
      h('div.set-card-actions', {}, testBtn)),
    collect: () => ({ mail: { ...s.mail, driver: vals.driver, from: vals.from, options } }),
    validate: () => [],
  }
}

// ----- apps --------------------------------------------------------------

// Apps whose whole panel is a settings card live here rather than owning a rail
// page of their own (WP-9). They render through the same code the app's own
// page uses, so nothing about them changes except where they sit.
function settingsOnlyPanels() {
  return (state.meta.panels || []).filter(p => p.settingsOnly).map(panel => {
    const holder = h('div', {})
    import('./views.js')
      .then(m => m.renderPluginPanel(panel))
      .then(el => holder.replaceChildren(el))
      .catch(e => holder.replaceChildren(h('p.fnt', {}, String(e.message || e))))
    return {
      el: h('div.set-card', {},
        h('div.set-card-head', {}, h('strong', {}, panel.label)),
        holder),
      collect: () => ({}), validate: () => [],
    }
  })
}

function appSections(s) {
  const secs = state.meta.settingsSections || []
  const panels = settingsOnlyPanels()
  if (!secs.length) {
    if (panels.length) return panels
    return [{
      el: card('No app settings yet',
        'Apps that have settings of their own add them to this page. Turn apps on or off under Manage → Apps.'),
      collect: () => ({}), validate: () => [],
    }]
  }
  return [...panels, ...secs.map(sec => {
    const store = ((s.plugins[sec.plugin] ??= { enabled: true, approved: [] }).settings ??= {})
    const vals = {}
    for (const f of sec.fields) vals[f.key] = store[f.key] ?? f.default ?? ''
    return {
      el: card(sec.label, sec.description || `Part of the ${sec.plugin} app.`,
        renderFields(sec.fields.map(f => ({ ...f, type: f.type || 'text' })), vals, () => {})),
      // no mutation here: collect() is called to take the baseline too, and a
      // section that edits live state while being measured is never stable
      collect: () => ({ plugins: { ...s.plugins, [sec.plugin]: { ...s.plugins[sec.plugin], settings: { ...store, ...vals } } } }),
      validate: () => [],
    }
  })]
}

// ----- advanced ----------------------------------------------------------

const VISITOR_FEATURES = [
  ['themeToggle', 'Let visitors switch to dark mode', 'Adds a small light/dark button to the site header. Turn it off if you only ever want one look.'],
  ['rss', 'Offer a subscribe feed', 'Lets people follow your news in a reader app. Harmless to leave on; nobody sees it unless they look for it.'],
  ['sitemap', 'Give search engines a page list', 'Helps Google find every page. Leave this on unless you are deliberately hiding the site.'],
]
const TECHNICAL_FEATURES = [
  ['prefetch', 'Load the next page early', 'Pages open faster because the browser fetches them before the click. Costs a little extra data on mobile.'],
  ['viewTransitions', 'Fade between pages', 'A soft cross-fade when moving between pages, in browsers that support it. Purely cosmetic.'],
  ['analyticsBeacon', 'Count visits', 'A small privacy-friendly counter of page views. Needs the Analytics app installed to show you anything.'],
  ['searchOpenSearch', 'Let browsers search your site directly', 'Lets a visitor type your site name in their address bar and search it from there. Rarely used.'],
]

function featuresSection(s, markDirty) {
  const f = { ...s.features }
  const theme = { ...s.theme }
  const row = ([key, label, blurb]) => h('div.set-switch-row', {},
    h('label.switch', {},
      h('input', {
        type: 'checkbox',
        checked: key === 'themeToggle' ? theme.showToggle !== false : f[key] !== false,
        role: 'switch',
        'aria-checked': String(key === 'themeToggle' ? theme.showToggle !== false : f[key] !== false),
        onchange: e => {
          e.target.setAttribute('aria-checked', String(e.target.checked))
          if (key === 'themeToggle') theme.showToggle = e.target.checked
          else f[key] = !!e.target.checked
          markDirty()
        },
        // The visible words sit in a sibling div, so the input's own label was
        // empty and every switch on this page announced itself as nothing.
        'aria-label': label,
      }), h('span.switch-track')),
    h('div', {}, h('strong', {}, label), h('p.fnt.set-switch-note', {}, blurb)))

  return {
    el: card('Site features', 'Things the site can do. Off means off — nothing is sent to the page.',
      subhead('For visitors'),
      h('div.set-switches', {}, ...VISITOR_FEATURES.map(row)),
      subhead('Technical'),
      h('div.set-switches', {}, ...TECHNICAL_FEATURES.map(row))),
    collect: () => ({ features: { ...f }, theme: { ...s.theme, showToggle: theme.showToggle } }),
    validate: () => [],
  }
}

const IMAGE_FIELDS = [
  { key: 'quality', type: 'number', label: 'Picture quality', width: 'half', help: '1–100. 82 looks the same as 100 to most eyes at a fraction of the size.', keywords: 'image compression jpeg size' },
  { key: 'provider', type: 'select', label: 'Resized by', width: 'half', keywords: 'image cloudflare resize', options: [
    { value: 'local', label: 'This server' },
    { value: 'cloudflare', label: 'Cloudflare' }] },
  { key: 'sizes', type: 'text', label: 'Widths to prepare', help: 'In pixels, separated by commas. The browser picks the smallest one that still looks sharp.', keywords: 'image responsive srcset sizes variants breakpoints' },
  { key: 'stripExif', type: 'boolean', label: 'Strip EXIF metadata from photos on upload', keywords: 'exif privacy gps location camera metadata' },
  { key: 'watermarkMedia', type: 'image', label: 'Watermark to stamp on pictures (optional)', keywords: 'watermark overlay stamp' },
  { key: 'watermarkOpacity', type: 'number', label: 'How solid the watermark is (0–1)', width: 'half', keywords: 'watermark opacity' },
]

function imagesSection(s) {
  const vals = {
    provider: s.images.provider || 'local',
    sizes: (s.images.sizes || [320, 640, 960, 1280, 1920]).join(', '),
    quality: s.images.quality ?? 82, stripExif: s.images.stripExif !== false,
    watermarkMedia: s.images.watermark?.media || '', watermarkOpacity: s.images.watermark?.opacity ?? 0.5,
  }
  return {
    el: card('Images', 'Applied to every picture you upload.',
      renderFields(IMAGE_FIELDS, vals, () => {})),
    collect: () => ({
      images: {
        ...s.images, provider: vals.provider, quality: +vals.quality || 82,
        sizes: String(vals.sizes).split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean),
        stripExif: !!vals.stripExif,
        watermark: vals.watermarkMedia ? { media: vals.watermarkMedia, opacity: +vals.watermarkOpacity || 0.5, gravity: 'southeast' } : null,
      },
    }),
    validate: () => [],
  }
}

const CODE_FIELDS = [
  { key: 'customCss', type: 'code', label: 'Custom styles (CSS)', rows: 5, keywords: 'css stylesheet override custom code' },
  { key: 'customJs', type: 'code', label: 'Custom script (JavaScript)', rows: 5, help: 'Runs on the live site, not in the editor preview.', keywords: 'js javascript snippet tracking tag custom code' },
]

function codeSection(s) {
  const vals = { customCss: s.customCss || '', customJs: s.customJs || '' }
  return {
    el: card('Custom code', 'Added to every page of the site. Code for a single page lives in that page’s own Page tab.',
      renderFields(CODE_FIELDS, vals, () => {})),
    collect: () => ({ customCss: vals.customCss, customJs: vals.customJs }),
    validate: () => [],
  }
}

function fontsSection(s, markDirty, saveIfDirty) {
  const fonts = s.fonts ? JSON.parse(JSON.stringify(s.fonts)) : []
  const list = h('div.set-fonts')
  const render = () => {
    list.replaceChildren(...fonts.map((f, i) => h('div.set-font-row', {},
      h('input.input', { value: f.family || '', placeholder: 'Font name', oninput: e => { f.family = e.target.value; markDirty() } }),
      h('select.input', { 'aria-label': 'Where this font is used', onchange: e => { f.role = e.target.value || undefined; markDirty() } },
        h('option', { value: '' }, 'not used'),
        ...[['body', 'body text'], ['display', 'headings'], ['mono', 'code']].map(([r, l]) => h('option', { value: r, selected: f.role === r }, l))),
      h('input.input', { value: f.weight || 400, placeholder: 'weight', oninput: e => { f.weight = e.target.value; markDirty() } }),
      h('label.field-check', {}, h('input', { type: 'checkbox', 'aria-label': `Load ${f.family || 'this font'} early`, checked: !!f.preload, onchange: e => { f.preload = e.target.checked; markDirty() } }), h('span', {}, 'load early')),
      h('button.icon-btn', { 'aria-label': `Remove ${f.family || 'this font'}`, title: 'Remove', onclick: () => { fonts.splice(i, 1); render(); markDirty() }, html: icon('trash', 14) }))),
      fonts.length ? '' : h('p.mut.set-note', {}, 'No fonts of your own yet — the template’s fonts are used.'))
  }
  render()
  const fileInput = h('input', { type: 'file', accept: '.woff2,.woff,.ttf,.otf', style: { display: 'none' } })
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files[0]) return
    await saveIfDirty()
    const fd = new FormData(); fd.append('file', fileInput.files[0])
    toast('Uploading font…')
    const r = await post('/fonts', fd)
    const fmt = /\.woff2$/i.test(r.name) ? 'woff2' : /\.woff$/i.test(r.name) ? 'woff' : 'truetype'
    fonts.push({ family: r.name.replace(/\.[^.]+$/, ''), file: r.file, weight: 400, style: 'normal', format: fmt, role: fonts.length ? undefined : 'display' })
    render(); markDirty(); toast('Font added — say where to use it, then save', 'ok')
  })
  return {
    el: card('Fonts', 'Upload a font file and say where it is used. “Load early” stops the page jumping as the font arrives.',
      h('div.set-card-actions', {}, h('button.btn.ghost.small', { onclick: () => fileInput.click() }, iconEl('upload', 14), 'Upload a font')),
      list, fileInput),
    collect: () => ({ fonts }),
    validate: () => [],
  }
}

const BUILD_FIELDS = [
  { key: 'trailingSlash', type: 'boolean', label: 'Addresses end with a slash (/about/)', keywords: 'trailing slash build export' },
  { key: 'minify', type: 'boolean', label: 'Squeeze the exported files to make them smaller', keywords: 'minify build export smaller' },
  { key: 'generateSearchIndex', type: 'boolean', label: 'Build the search index when exporting', keywords: 'search index export build' },
  { key: 'basePath', type: 'text', label: 'Base path', width: 'half', help: 'Only if the site lives under a sub-folder, e.g. /docs', keywords: 'subfolder subpath deploy docs' },
]

function buildSection(s, saveIfDirty) {
  const b = s.build || {}
  const vals = {
    trailingSlash: b.trailingSlash !== false, minify: !!b.minify,
    basePath: b.basePath || '', generateSearchIndex: b.generateSearchIndex !== false,
  }
  const exportBtn = h('button.btn.primary.small', {
    onclick: async e => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        await saveIfDirty()
        const r = await post('/export')
        toast(`Exported ${r.pages} pages and ${r.variants} image sizes to ${r.outDir}`, 'ok', 6000)
      } finally { btn.disabled = false }
    },
  }, 'Export now')
  return {
    el: card('Build and export',
      'Turn the site into plain files you can host anywhere.',
      renderFields(BUILD_FIELDS, vals, () => {}),
      h('div.set-card-actions', {}, exportBtn)),
    collect: () => ({ build: { ...vals } }),
    validate: () => [],
  }
}

function modulesSection(s, markDirty) {
  const mods = s.modules || {}
  const hidden = new Set(mods.hidden || [])
  const perRole = JSON.parse(JSON.stringify(mods.hiddenForRole || {}))
  const roles = ['viewer', 'author', 'editor', 'admin']

  const grid = h('div.table-wrap', {}, h('table.data-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', {}, 'Hide from everyone'), ...roles.map(r => h('th', {}, `Hide from ${r}s`)))),
    h('tbody', {}, ...MODULE_LIST.map(([key, label]) => h('tr.set-module-row', {},
      h('td', {}, label),
      // A grid of bare checkboxes has no label of its own: the meaning is the
      // row it is in and the column it is under, and a screen reader gets
      // neither. Spell the whole cell out on each input.
      h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Hide ${label} from everyone`, checked: hidden.has(key), onchange: e => { e.target.checked ? hidden.add(key) : hidden.delete(key); markDirty() } })),
      ...roles.map(r => h('td', {}, h('input', {
        type: 'checkbox', 'aria-label': `Hide ${label} from ${r}s`, checked: (perRole[r] || []).includes(key),
        onchange: e => {
          perRole[r] = perRole[r] || []
          if (e.target.checked) perRole[r].push(key)
          else perRole[r] = perRole[r].filter(k => k !== key)
          markDirty()
        },
      }))))))))

  return {
    el: card('Studio interface',
      'Hide parts of this studio your team never uses. Hidden sections disappear from the sidebar, the ribbon and search.',
      grid),
    collect: () => ({ modules: { hidden: [...hidden], hiddenForRole: perRole } }),
    validate: () => [],
  }
}

// ----- security ----------------------------------------------------------

const SIGNIN_FIELDS = [
  { key: 'maxLoginAttempts', type: 'number', label: 'Wrong passwords before locking out', width: 'half', keywords: 'login attempts lockout brute force' },
  { key: 'lockoutMinutes', type: 'number', label: 'Locked out for (minutes)', width: 'half', keywords: 'lockout minutes login' },
  { key: 'minPasswordLength', type: 'number', label: 'Shortest password allowed', width: 'half', keywords: 'minimum password length' },
]
const VISIBILITY_FIELDS = [
  { key: 'private', type: 'select', label: 'Who can see the site', width: 'half', keywords: 'private staging members visibility password protect', options: [
    { value: 'off', label: 'Everyone (normal)' },
    { value: 'members', label: 'Only people who sign in' },
    { value: 'staging', label: 'Only the people who edit it' },
  ] },
  { key: 'privateRedirect', type: 'text', label: 'Send other visitors to', width: 'half', help: 'e.g. https://www.example.com — leave blank to show a sign-in box instead.', keywords: 'staging redirect' },
]
const STUDIO_ADDRESS_FIELDS = [
  { key: 'adminPath', type: 'text', label: 'Studio lives at /', width: 'half', help: 'Normally "admin". Change it and you sign in at /<your word>/ after saving.', keywords: 'admin path url login address studio' },
]
const LOG_FIELDS = [
  { key: 'auditLog', type: 'boolean', label: 'Keep a record of who changed what in the studio', keywords: 'audit log history activity' },
  { key: 'errorLog', type: 'boolean', label: 'Keep a note when something goes wrong on the server', keywords: 'error log server problems' },
]
const TECHNICAL_SECURITY_FIELDS = [
  { key: 'csp', type: 'select', label: 'Content-Security-Policy', width: 'half', keywords: 'csp headers policy technical', options: [{ value: 'balanced' }, { value: 'strict' }, { value: 'off' }] },
  { key: 'frameAncestors', type: 'text', label: 'frame-ancestors', width: 'half', keywords: 'iframe embedding clickjacking technical' },
  { key: 'hsts', type: 'boolean', label: 'Send HSTS (only once HTTPS is everywhere)', keywords: 'https strict transport security technical' },
  { key: 'adminAllowlist', type: 'text', label: 'Studio IP allowlist', help: 'Comma-separated IPs or CIDRs. Blank means any network.', keywords: 'ip cidr network restrict technical' },
  { key: 'trustedIssuers', type: 'json', label: 'Trusted package issuers', help: 'Ed25519 public keys of theme and app sellers you trust: {"studio.example": "<base64 public key>"}', keywords: 'ed25519 signing keys plugins themes technical' },
]

function securitySections(s, saveIfDirty) {
  const sec = s.security || {}
  const vals = {
    csp: sec.csp || 'balanced', hsts: !!sec.hsts,
    frameAncestors: sec.frameAncestors || "'none'",
    maxLoginAttempts: sec.maxLoginAttempts ?? 8, lockoutMinutes: sec.lockoutMinutes ?? 15,
    minPasswordLength: sec.minPasswordLength ?? 8,
    adminAllowlist: (sec.adminAllowlist || []).join(', '),
    auditLog: sec.auditLog !== false,
    adminPath: sec.adminPath || 'admin',
    private: sec.private || 'off',
    privateRedirect: sec.privateRedirect || '',
    errorLog: sec.errorLog !== false,
    trustedIssuers: JSON.stringify(sec.trustedIssuers || {}),
  }
  const collect = () => ({
    security: {
      ...sec, ...vals,
      maxLoginAttempts: +vals.maxLoginAttempts || 8,
      lockoutMinutes: +vals.lockoutMinutes || 15,
      minPasswordLength: +vals.minPasswordLength || 8,
      adminAllowlist: String(vals.adminAllowlist).split(',').map(x => x.trim()).filter(Boolean),
      adminPath: String(vals.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin',
      trustedIssuers: (() => { try { return JSON.parse(vals.trustedIssuers || '{}') } catch { return sec.trustedIssuers || {} } })(),
    },
  })

  // --- sign-in rules
  const signIn = {
    el: card('Sign-in rules', 'How the studio behaves when somebody gets their password wrong.',
      renderFields(SIGNIN_FIELDS, vals, () => {})),
    collect, validate: () => [],
  }

  // --- who can see the site
  const previewOut = h('div.set-preview-link')
  const renderPreviewLink = token => {
    if (!token) { previewOut.replaceChildren(h('p.fnt.set-note', {}, 'No link yet — visitors get the sign-in wall.')); return }
    previewOut.replaceChildren(h('input.input.set-link-input', {
      type: 'text', readonly: true, value: `${location.origin}/?preview=${token}`,
      onclick: e => e.target.select(),
    }))
  }
  renderPreviewLink(sec.previewToken)

  const visibility = {
    el: card('Who can see the site', 'Useful while you are still building it.',
      renderFields(VISIBILITY_FIELDS, vals, () => {}),
      subhead('Share a private preview', 'Gives anyone with the link a look at the hidden site without signing in — handy for a client. Making a new link stops the old one working straight away.'),
      h('div.set-card-actions', {},
        h('button.btn.ghost.small', {
          onclick: async () => { await saveIfDirty(); const r = await post('/security/preview-link', {}); renderPreviewLink(r.token) },
        }, iconEl('link', 13), sec.previewToken ? 'Make a new link' : 'Create a link')),
      previewOut),
    collect, validate: () => [],
  }

  const address = {
    el: card('Studio address', 'Where you sign in to edit this site.',
      renderFields(STUDIO_ADDRESS_FIELDS, vals, () => {})),
    collect, validate: () => [],
  }

  // --- logs
  const logsOut = h('div')
  const loadLogs = async () => {
    const { lines } = await get('/logs/errors')
    logsOut.replaceChildren(lines.length
      ? h('div', {}, ...lines.slice(0, 20).map(l => h('div.set-log-line', {},
        h('span.fnt', {}, `${(l.at || '').slice(5, 19)} `), h('strong', {}, l.path || ''), ` — ${l.error || l.raw || ''}`)))
      : h('p.mut', {}, 'Nothing has gone wrong. Good.'))
  }
  loadLogs().catch(() => logsOut.replaceChildren(h('p.mut', {}, 'Could not read the log.')))

  const logs = {
    el: card('Records', 'What the site keeps a note of.',
      renderFields(LOG_FIELDS, vals, () => {}),
      subhead('Recent problems'),
      h('div.set-card-actions', {},
        h('button.btn.ghost.small', { onclick: () => loadLogs() }, iconEl('refresh', 13), 'Refresh'),
        h('button.btn.ghost.small', { onclick: async () => { await del('/logs/errors'); loadLogs() } }, 'Clear')),
      logsOut),
    collect, validate: () => [],
  }

  // --- the developer drawer
  const probeOut = h('pre.code-out', { hidden: true })
  const technical = {
    el: h('details.set-card.set-details', {},
      h('summary', {}, 'Technical security (for developers)'),
      h('div.set-details-body', {},
        renderFields(TECHNICAL_SECURITY_FIELDS, vals, () => {}),
        h('div.set-card-actions', {},
          h('button.btn.soft.small', {
            onclick: async () => {
              await saveIfDirty()
              probeOut.hidden = false; probeOut.textContent = 'Checking…'
              const r = await post('/security/probe', {})
              probeOut.textContent = r.results.map(x => `${x.ok ? '✓' : '✗'} ${x.path} → ${x.status || x.error}`).join('\n') + `\n\n${r.advice}`
              probeOut.style.color = r.ok ? '' : 'var(--err-ink)'
            },
          }, iconEl('shield', 13), 'Check my public site for exposed files')),
        probeOut)),
    collect, validate: () => [],
  }

  return [signIn, visibility, address, logs, technical]
}

// ---------------------------------------------------------------- the index

/**
 * Every setting on this page, for the studio's search (catalog.js).
 *
 * It is built from the very field definitions the cards are rendered from, so
 * a setting cannot exist on screen and be missing from search: the hand-kept
 * list in catalog.js drifted the moment anybody added a field.
 *
 * `label` is what the person sees — the settings view finds the control by
 * matching that text — and `keywords` are the other words people type for it.
 * Cards that are not a field list (content types, brand variables, fonts…)
 * appear as one entry each, because that is how you reach them.
 */
const CARD_ENTRIES = {
  content: [
    { key: 'Content types', label: 'Content types', help: 'The kinds of thing your site holds.', keywords: 'concepts kinds page post project fields schema types' },
    { key: 'Brand variables', label: 'Brand variables', help: 'Type once, reuse everywhere.', keywords: 'var tokens phone email address reusable values' },
  ],
  apps: [
    { key: 'App settings', label: 'App settings', help: 'Settings belonging to the apps you have installed.', keywords: 'plugin extension addon configure cookie consent forms' },
  ],
  advanced: [
    { key: 'Fonts', label: 'Fonts', help: 'Upload a font and say where it is used.', keywords: 'typeface typography family webfont woff upload' },
    { key: 'Studio interface', label: 'Studio interface', help: 'Hide parts of this studio your team never uses.', keywords: 'modules hide simplify roles interface sections' },
  ],
}

// The switches on Advanced are (key, label, blurb) triples rather than fields;
// these are the other words people type when looking for one.
const FEATURE_KEYWORDS = {
  themeToggle: 'dark light theme toggle',
  rss: 'rss atom feed xml subscribe syndication',
  sitemap: 'sitemap robots search engines google index crawl',
  prefetch: 'prefetch speculative speed performance',
  viewTransitions: 'view transitions animation fade morph',
  analyticsBeacon: 'analytics beacon stats tracking hits visits cookie',
  searchOpenSearch: 'opensearch browser search engine',
}

export function settingsIndex() {
  const featureEntry = ([key, label, blurb]) =>
    ({ key: label, label, help: blurb, keywords: `${key} ${FEATURE_KEYWORDS[key] || ''}` })
  const byGroup = {
    site: [...SITE_FIELDS, LANGUAGE_FIELD, ...TAB_PATTERN_FIELDS, ...SHARE_FIELDS],
    content: [...CARD_ENTRIES.content, ...ADDRESS_FIELDS, ...SPECIAL_PAGE_FIELDS, ...MAINTENANCE_FIELDS, ...MAINTENANCE_ALLOW_FIELDS],
    email: [...EMAIL_DRIVER_FIELDS, ...EMAIL_FROM_FIELDS],
    apps: CARD_ENTRIES.apps,
    advanced: [
      ...VISITOR_FEATURES.map(featureEntry), ...TECHNICAL_FEATURES.map(featureEntry),
      ...IMAGE_FIELDS, ...CODE_FIELDS, ...BUILD_FIELDS, ...CARD_ENTRIES.advanced,
    ],
    security: [...SIGNIN_FIELDS, ...VISIBILITY_FIELDS, ...STUDIO_ADDRESS_FIELDS, ...LOG_FIELDS, ...TECHNICAL_SECURITY_FIELDS],
  }
  return Object.entries(byGroup).flatMap(([group, fields]) =>
    fields.map(f => ({ group, key: f.key, label: f.label, help: f.help || '', keywords: f.keywords || '' })))
}

// ---------------------------------------------------------------- the view

async function settingsView(root, [groupKey], query, opts = {}) {
  const { settings } = await get('/settings')
  const s = settings
  s.seo ??= {}; s.images ??= {}; s.theme ??= {}; s.theme.tokens ??= {}; s.mail ??= {}; s.features ??= {}; s.plugins ??= {}

  let dirty = false
  let sections = []
  const bar = h('div.set-savebar', { hidden: true })

  // The bar must mean "you changed something", not "the page rendered".
  // Two independent conditions, because either alone was not enough:
  //   1. a real user gesture happened in this pane — mounting a select, an
  //      image picker, the code editor or the embedded types view fires
  //      change/input events of its own, and those are never isTrusted;
  //   2. what the sections would save differs from the snapshot taken once
  //      painting (including each section's async load) had settled.
  let touched = false
  let baseline = null
  let rebaseTimers = []
  // key order must not count as a change, or a section that rebuilds an
  // object after its fetch resolves reads as an edit
  const stable = v => JSON.stringify(v, (_k, val) =>
    (val && typeof val === 'object' && !Array.isArray(val))
      ? Object.fromEntries(Object.keys(val).sort().map(k2 => [k2, val[k2]]))
      : val)
  const snapshot = () => { try { return stable(collectPatch()) } catch { return null } }
  const setBaseline = () => { baseline = snapshot(); dirty = false; bar.hidden = true }
  const recheck = () => {
    if (baseline === null) return
    const now = snapshot()
    dirty = touched && now !== null && now !== baseline
    bar.hidden = !dirty
  }
  // fields.js debounces text input by 350ms, so look again after it lands
  const later = debounce(recheck, 420)
  const markDirty = () => { touched = true; later() }
  // sections load their options asynchronously (/content, /media, the types
  // view); keep re-taking the baseline until the user actually touches
  // something, so a late re-render is never mistaken for an edit
  const armBaseline = () => {
    rebaseTimers.forEach(clearTimeout); rebaseTimers = []
    baseline = null
    touched = false
    for (const ms of [0, 250, 800, 2000]) rebaseTimers.push(setTimeout(() => { if (!touched) setBaseline() }, ms))
  }

  const GROUPS = [
    { key: 'site', label: 'Site', icon: 'home', sub: 'The basics about your website.',
      build: () => [siteSection(s), shareSection(s)] },
    { key: 'content', label: 'Content', icon: 'page', sub: 'What this site holds and how its addresses are written.',
      build: () => [typesSection(), addressStyleSection(s), brandSection(s, markDirty), specialPagesSection(s)] },
    { key: 'email', label: 'Email', icon: 'mail', sub: 'How the site sends messages.',
      build: () => [emailSection(s, markDirty, saveIfDirty)] },
    { key: 'apps', label: 'Apps', icon: 'plug', sub: 'Settings belonging to the apps you have installed.',
      build: () => appSections(s) },
    { key: 'advanced', label: 'Advanced', icon: 'gauge', sub: 'You will rarely need this page.',
      build: () => [featuresSection(s, markDirty), imagesSection(s), codeSection(s), fontsSection(s, markDirty, saveIfDirty), buildSection(s, saveIfDirty), modulesSection(s, markDirty)] },
    { key: 'security', label: 'Security & access', icon: 'shield', sub: 'Who gets in, and what is written down.',
      build: () => securitySections(s, saveIfDirty) },
  ]
  assertCatalogue(GROUPS.map(g => g.key))

  let active = GROUPS.find(g => g.key === groupKey) || GROUPS[0]

  const collectPatch = () => {
    const patch = {}
    for (const sec of sections) mergePatch(patch, sec.collect?.() || {})
    return patch
  }

  const doSave = async () => {
    const bad = sections.flatMap(sec => sec.validate?.() || [])
    if (bad.length) {
      toast(`${bad[0].label}: ${bad[0].message}`, 'err', 5200)
      main.querySelector('[aria-invalid="true"]')?.focus()
      return false
    }
    const patch = collectPatch()
    await put('/settings', { patch })
    // keep the in-memory copy current, so a later Discard reverts to what was
    // last saved rather than to what the page loaded with
    mergePatch(s, patch)
    setBaseline()
    toast('Saved', 'ok')
    return true
  }

  // Buttons that act on the server (test email, export, preview link, probe,
  // font upload) must not act on a version of the settings the server has
  // never seen.
  async function saveIfDirty() { recheck(); if (dirty) await doSave() }

  const paintBar = () => {
    bar.replaceChildren(
      h('span.set-savebar-text', {}, 'You have unsaved changes'),
      h('div.set-savebar-btns', {},
        h('button.btn.ghost.small', { onclick: () => { dirty = false; bar.hidden = true; paintMain() } }, 'Discard'),
        h('button.btn.primary.small', { onclick: async e => { e.currentTarget.disabled = true; try { await doSave() } finally { e.currentTarget.disabled = false } } }, 'Save changes')))
  }
  paintBar()

  const nav = h('div.panel-body')
  const main = h('div.main-pad.set-main')
  let search = ''

  const hits = () => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    return SETTINGS_ROWS.filter(r =>
      r.label.toLowerCase().includes(q) || (r.keywords || '').includes(q) || (r.sub || '').toLowerCase().includes(q))
  }

  const goGroup = async (g, fieldKey) => {
    recheck()
    if (g.key !== active.key && dirty) {
      const ok = await confirmDialog('Unsaved settings', 'You have unsaved settings. Leave without saving?', 'Discard', { guard: true })
      if (!ok) return
      dirty = false; bar.hidden = true
    }
    active = g
    history.replaceState(null, '', `#/settings/${g.key}`)
    noteHash()   // so a cancelled navigation comes back to THIS group
    paintNav(); paintMain(fieldKey)
  }

  const paintNav = () => {
    const found = hits()
    nav.replaceChildren(
      h('div.set-search', {}, h('input.input', {
        placeholder: 'Search every setting...', 'aria-label': 'Search settings', value: search,
        oninput: e => { search = e.target.value; paintNav() },
      })),
      ...(found
        ? (found.length
          ? found.map(r => h('button.row-item', {
            onclick: () => {
              const key = r.hash.split('/')[2].split('?')[0]
              const fieldKey = new URLSearchParams(r.hash.split('?')[1] || '').get('f')
              const g = GROUPS.find(x => x.key === key)
              if (g) { search = ''; goGroup(g, fieldKey) }
            },
          }, h('span.row-ico', { html: icon('search', 14) }),
            h('span.row-label', {}, r.label, h('div.row-sub', {}, r.sub))))
          : [h('div.set-nohit', {},
            h('p.mut.m-0', {}, 'No setting matches that.'),
            h('p.fnt.m-0', {}, 'Try ', h('a', { href: '#/plugins' }, 'Apps'),
              ' for cookies and forms, or ', h('a', { href: '#/design' }, 'Design'), ' for colours.'))])
        : GROUPS.map(g =>
          h('button.row-item', {
            class: g.key === active.key ? 'active' : '',
            'aria-current': g.key === active.key ? 'true' : null,
            onclick: () => goGroup(g),
          }, h('span.row-ico', { html: icon(g.icon, 15) }), h('span.row-label', {}, g.label)))))
  }

  const flash = (el, { focus = false } = {}) => {
    if (!el) return
    // a hit inside the collapsed developer drawer has to open it first
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1900)
    if (focus) el.querySelector('input:not([type=hidden]), textarea, select, button')?.focus({ preventScroll: true })
  }

  const paintMain = (fieldKey) => {
    sections = active.build()
    main.replaceChildren(
      h('div.page-head', {},
        h('div', {}, h('h1', {}, active.label), h('p.sub', {}, active.sub)),
        h('div.set-head-btns', {},
          h('button.btn.ghost.small.panel-toggle', {
            'aria-label': 'All settings', onclick: () => root.querySelector('.split').classList.toggle('panel-open'),
          }, iconEl('list', 12), 'All settings'),
          helpButton('settings', active.label))),
      ...sections.map(sec => sec.el))
    if (fieldKey) {
      // Clicking a search result has to land you ON the setting: scrolled to
      // the middle, flashing, with the cursor already in it. A single
      // requestAnimationFrame did none of that reliably — some groups build
      // their cards asynchronously, so the field did not exist yet, and rAF
      // does not run at all in a background tab. Look immediately, then twice
      // more as the group settles.
      const want = fieldKey.toLowerCase().replace(/[^a-z]/g, '')
      const findTarget = () => {
        const label = [...main.querySelectorAll('.field label span:first-child, .field-check span, .set-card-head strong, .set-sub-title, .set-switch-row strong')]
          .find(el => el.textContent.toLowerCase().replace(/[^a-z]/g, '').includes(want))
        return label?.closest('.field, .set-switch-row, .set-card') || null
      }
      let landed = null
      const tryLand = last => {
        if (landed?.isConnected) { flash(landed, { focus: true }); return }
        const el = findTarget()
        if (el) { landed = el; flash(el, { focus: true }) }
        else if (last) flash(main.querySelector('.set-card'))
      }
      setTimeout(() => tryLand(false), 0)
      setTimeout(() => tryLand(false), 160)
      setTimeout(() => tryLand(true), 500)
    }
    if (opts.scrollToTypes) requestAnimationFrame(() => flash(main.querySelector('#settings-types')?.closest('.set-card')))
    // re-arm after the browser has settled the freshly mounted controls
    armBaseline()
  }

  root.replaceChildren(h('div.split', {},
    h('div.panel', {}, h('div.panel-head', {}, h('span.panel-title', {}, 'Settings')), nav),
    h('div.main', {}, main, bar)))

  // Any edit anywhere in the pane is an unsaved change; sections that build
  // their own controls call markDirty() directly.
  const onEdit = e => { if (e.isTrusted) touched = true; later() }
  main.addEventListener('input', onEdit)
  main.addEventListener('change', onEdit)

  paintNav()
  paintMain(query?.get('f'))

  const onKey = e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      recheck()
      if (dirty) doSave()
    }
  }
  document.addEventListener('keydown', onKey)

  const disposeGuard = registerGuard('settings', async () =>
    (recheck(), !dirty) || await confirmDialog('Unsaved settings', 'You have unsaved settings. Leave without saving?', 'Discard', { guard: true }))

  return () => {
    rebaseTimers.forEach(clearTimeout)
    disposeGuard()
    document.removeEventListener('keydown', onKey)
  }
}

registerView('settings', settingsView)

// #/types kept working after the rail entry went: it is the Content page with
// the content-types card brought into view.
registerView('settingsTypes', (root, _rest, query) =>
  settingsView(root, ['content'], query, { scrollToTypes: true }))
