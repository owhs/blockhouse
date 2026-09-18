// Audit log view — read-only history of admin actions (logins, publishes,
// permission changes, exports). Gated on users.manage OR the narrower
// audit.read grant, so an account can see this without being able to manage
// users or change settings (see GRANTABLE in views.js).

import { get } from './api.js'
import { h, emptyState } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView } from './state.js'

const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.login.failed': 'Failed sign-in',
  'user.updated': 'User updated',
  'concept.saved': 'Content saved',
  'concept.deleted': 'Content deleted',
  'deploy.profile.saved': 'Deploy target saved',
  'deploy.run': 'Deploy run',
  'export.run': 'Export run',
  'template.override': 'Template overridden',
  'package.installed': 'Package installed',
  'chrome.saved': 'Header/footer saved',
}

function detailText(entry) {
  const { id, at, action, ...rest } = entry
  const parts = Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  return parts.join(' · ')
}

registerView('audit', async root => {
  const body = h('div.main-pad', { style: { maxWidth: '64rem' } })
  root.replaceChildren(h('div.main', {}, body))

  body.replaceChildren(
    h('div.page-head', {}, h('div', {}, h('h1', {}, 'Audit log'), h('p.sub', {}, 'What happened, when, and who did it.'))),
    h('div.spin'))

  let entries
  try { ({ entries } = await get('/audit')) }
  catch (e) {
    body.replaceChildren(
      h('div.page-head', {}, h('div', {}, h('h1', {}, 'Audit log'))),
      emptyState(icon('warn', 26), 'Audit log unavailable', String(e.message || e)))
    return
  }

  if (!entries.length) {
    body.replaceChildren(
      h('div.page-head', {}, h('div', {}, h('h1', {}, 'Audit log'))),
      emptyState(icon('table', 26), 'Nothing recorded yet', 'Actions like sign-ins, publishes and exports will show up here.'))
    return
  }

  body.replaceChildren(
    h('div.page-head', {}, h('div', {}, h('h1', {}, 'Audit log'), h('p.sub', {}, `${entries.length} most recent entries.`))),
    h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Action'), h('th', {}, 'Detail'))),
      h('tbody', {}, ...entries.map(e => h('tr', {},
        h('td', { style: { whiteSpace: 'nowrap', color: 'var(--mut)', fontSize: '0.8rem' } }, new Date(e.at).toLocaleString()),
        h('td', { style: { fontWeight: 600 } }, ACTION_LABELS[e.action] || e.action),
        h('td.fnt', { style: { fontSize: '0.8rem' } }, detailText(e))))))))
})
