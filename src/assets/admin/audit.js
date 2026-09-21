// Activity — a readable history of what happened in the studio (sign-ins,
// publishes, permission changes, exports). Gated on users.manage OR the
// narrower audit.read grant, so an account can see this without being able to
// manage users or change settings (see GRANTABLE in views.js).
//
// Every row is a sentence. The ids and the IP address are still here — they are
// what you need when something looks wrong — but behind a toggle, because
// nobody reads "userId: umsyy2c4" and learns anything from it.

import { get } from './api.js'
import { h, emptyState, skeleton, fmtDate } from './ui.js'
import { icon } from './icons.js'
import { registerView } from './state.js'
import { helpButton } from './help.js'

/** Which filter bucket an action falls into. */
const KINDS = [
  ['all', 'Everything'],
  ['content', 'Content'],
  ['people', 'People'],
  ['settings', 'Settings'],
  ['signin', 'Sign-ins'],
]
const kindOf = action =>
  action.startsWith('auth.') ? 'signin'
    : action.startsWith('user.') ? 'people'
      : action.startsWith('content.') || action.startsWith('concept.') || action.startsWith('media.') ? 'content'
        : 'settings'

/** Role and settings keys as the owner sees them elsewhere in the studio. */
const ROLE_WORDS = { owner: 'Owner', admin: 'Admin', editor: 'Editor', author: 'Author', viewer: 'Viewer' }
const SETTING_WORDS = {
  site: 'Site', urls: 'Web addresses', mail: 'Email', security: 'Security',
  seo: 'Search engines', media: 'Images', design: 'Design', plugins: 'Apps',
}

/** "About" — titles are quoted so a one-word title still reads as a thing. */
const titleOf = e => e.title ? `“${e.title}”` : 'a page'

/**
 * What actually changed on an account. The old sentence claimed a role change
 * every time, including for the sign-in toggle, which never touches the role.
 */
function userChange(e) {
  const who = e.userName || 'an account'
  const changed = Array.isArray(e.changed) ? e.changed : []
  const bits = []
  if (changed.includes('active')) bits.push(e.active ? `Let ${who} sign in again` : `Blocked ${who} from signing in`)
  if (changed.includes('role')) {
    bits.push(e.oldRole && e.newRole
      ? `Changed ${who}'s role from ${ROLE_WORDS[e.oldRole] || e.oldRole} to ${ROLE_WORDS[e.newRole] || e.newRole}`
      : `Changed ${who}'s role`)
  }
  if (changed.includes('grants')) bits.push(`Changed what ${who} is allowed to do`)
  if (changed.includes('password')) bits.push(`Set a new password for ${who}`)
  if (changed.includes('name')) bits.push(`Renamed ${who}`)
  // Rows written before the studio recorded what changed carry neither a name
  // nor a `changed` list. "Changed the account for an account" read like an
  // unfilled placeholder, so a nameless row degrades to a plain sentence.
  if (!bits.length) return e.userName ? `Changed the account for ${e.userName}` : 'Changed an account'
  return bits.join(', and ') + (e.sessionsRevoked ? ' — and signed them out of the studio' : '')
}

/**
 * A sentence per action, built from what the entry actually recorded. Anything
 * unrecognised keeps its raw name so the log never silently loses a fact.
 */
const ACTION_SENTENCES = {
  'auth.login': () => 'Signed in',
  'auth.login.failed': e => `Failed sign-in for ${e.email || 'an unknown address'}`,
  'auth.reset.requested': e => `Asked for a password reset for ${e.email || 'an account'}`,
  'auth.reset.completed': () => 'Finished a password reset',
  'user.updated': e => userChange(e),
  'user.created': e => `Created an account for ${e.userName || e.email || 'someone'}${e.role ? ` (${ROLE_WORDS[e.role] || e.role})` : ''}`,
  'content.created': e => `Started ${titleOf(e)}`,
  'content.saved': e => `Saved ${titleOf(e)}`,
  'content.deleted': e => `Deleted ${titleOf(e)}`,
  'content.published': e => `Published ${titleOf(e)}`,
  'content.unpublished': e => `Took ${titleOf(e)} off the site`,
  'menu.saved': e => `Changed the ${e.label || e.key || ''} menu`.replace(/\s+/g, ' ').trim(),
  'settings.saved': e => `Saved settings${e.keys?.length ? ` (${e.keys.map(k => SETTING_WORDS[k] || k).join(', ')})` : ''}`,
  'plugin.toggled': e => `Switched the ${e.name || e.id || ''} app ${e.enabled ? 'on' : 'off'}`.replace(/\s+/g, ' '),
  'concept.saved': e => `Changed the content type ${e.name || ''}`.trim(),
  'concept.deleted': e => `Deleted the content type ${e.name || ''}`.trim(),
  'chrome.saved': e => `Changed the header and footer${e.keys?.length ? ` (${e.keys.join(', ')})` : ''}`,
  'deploy.profile.saved': e => `Saved the ${e.target || ''} publishing target “${e.id || ''}”`.replace(/\s+/g, ' ').trim(),
  'deploy.run': e => `Published the site to ${e.target || 'its target'}${e.ms ? ` (took ${Math.round(e.ms / 1000)}s)` : ''}`,
  'export.run': e => `Exported ${e.pages ?? '?'} pages and ${e.assets ?? '?'} files to ${e.outDir || 'a folder'}`,
  'media.processed': () => 'Edited an image',
  'template.override': e => `Edited the page template ${e.rel || ''}`.trim(),
  'package.installed': e => `Installed the ${e.kind || ''} package “${e.name || ''}”${e.verified ? ' (signature checked)' : ''}`.replace(/\s+/g, ' ').trim(),
}

function sentenceFor(entry) {
  const build = ACTION_SENTENCES[entry.action]
  if (build) return h('span.act-what', {}, build(entry))
  return h('span.act-what', {}, h('code.pill-perm', {}, entry.action))
}

/** "3 minutes ago" — the exact stamp stays on hover. */
function relative(at) {
  const ms = Date.now() - new Date(at).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : fmtDate(at)
}

function technical(entry) {
  const { id, at, action, ...rest } = entry
  const parts = Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  return `${action}${parts.length ? ' · ' + parts.join(' · ') : ''}`
}

registerView('audit', async root => {
  const body = h('div.main-pad.mw-64', {})
  root.replaceChildren(h('div.main', {}, body))

  // `sub` is either a line of text or the live element that counts what the
  // filters are actually showing.
  const head = (sub) => h('div.page-head', {},
    h('div', {}, h('h1', {}, 'Activity'),
      typeof sub === 'string' ? (sub ? h('p.sub', {}, sub) : '') : (sub || '')),
    helpButton('audit', 'Activity'))

  body.replaceChildren(head('Who did what, and when.'), skeleton('rows', 8))

  let entries
  try { ({ entries } = await get('/audit')) }
  catch (e) {
    body.replaceChildren(head(''), emptyState(icon('warn', 26), 'Activity unavailable', String(e.message || e)))
    return
  }

  if (!entries.length) {
    body.replaceChildren(head(''),
      emptyState(icon('table', 26), 'Nothing recorded yet', 'Sign-ins, publishes and exports show up here as they happen.'))
    return
  }

  // Names, when this account is allowed to see them; otherwise the email or id
  // that the entry itself recorded.
  const names = {}
  const { users = [] } = await get('/users').catch(() => ({ users: [] }))
  for (const u of users) names[u.id] = u.name || u.email
  const personOf = e => e.byName || names[e.by] || names[e.userId] || e.email || e.by || e.userId || 'someone'

  const people = [...new Set(entries.map(personOf))].sort()

  let who = 'all'
  let kind = 'all'
  // "Last 30 days" and then "Nothing matches those filters" reads as a broken
  // log. If the last month is empty, arrive on All time instead, and say so.
  const within30 = entries.filter(e => Date.now() - new Date(e.at).getTime() < 30 * 86400000).length
  let days = within30 ? 30 : 0
  let showTech = false

  const subLine = h('p.sub')
  const rows = h('div')
  const filtered = () => {
    const cutoff = days ? Date.now() - days * 86400000 : 0
    return entries.filter(e =>
      (who === 'all' || personOf(e) === who) &&
      (kind === 'all' || kindOf(e.action) === kind) &&
      (!cutoff || new Date(e.at).getTime() >= cutoff))
  }
  const thing = n => `${n} thing${n === 1 ? '' : 's'} that happened`
  const paint = () => {
    const list = filtered()
    const range = days ? `the last ${days} days` : 'all time'
    subLine.textContent = list.length
      ? `Showing ${thing(list.length)} in ${range}.`
      : days ? `Nothing has happened in the last ${days} days.` : 'Nothing matches those filters.'
    rows.replaceChildren(list.length
      ? h('div.table-wrap', {}, h('table.data-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What happened'))),
        h('tbody', {}, ...list.map(e => h('tr', {},
          h('td.act-when', { title: new Date(e.at).toLocaleString() }, relative(e.at)),
          h('td.act-who', {}, personOf(e)),
          h('td', {}, sentenceFor(e),
            showTech ? h('div.act-tech', {}, technical(e)) : ''))))))
      : emptyState(icon('table', 26),
        days ? `Nothing in the last ${days} days` : 'Nothing matches those filters',
        'Widen the date range, or choose Everything.'))
  }

  // Each dropdown gets a visible caption; without one a screen reader announced
  // three unnamed combo boxes and everyone else guessed from the selected item.
  const sel = (caption, opts, value, onchange) => h('label.act-filter', {},
    h('span.act-filter-cap', {}, caption),
    h('select.input', { onchange: e => { onchange(e.target.value); paint() } },
      ...opts.map(([v, label]) => h('option', { value: v, selected: String(value) === String(v) }, label))))

  body.replaceChildren(
    head(subLine),
    h('div.act-filters', {},
      sel('Who', [['all', 'Everyone'], ...people.map(p => [p, p])], who, v => (who = v)),
      sel('What', KINDS, kind, v => (kind = v)),
      sel('When', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['0', 'All time']], days, v => (days = Number(v))),
      h('label.field-check', {},
        h('input', { type: 'checkbox', onchange: e => { showTech = e.target.checked; paint() } }),
        h('span', {}, 'Show technical details'))),
    rows)
  paint()
})
