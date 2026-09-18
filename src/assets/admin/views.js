// Studio views: dashboard, content lists, media library, users, settings,
// plugins (permission approval) and generic plugin panels.

import { get, post, put, patch, del } from './api.js'
import { h, dialog, confirmDialog, promptDialog, toast, fmtDate, emptyState, spinner, skeleton } from './ui.js'
import { renderFields } from './fields.js'
import { registerView, state, DATA_SECTIONS, prefs, setPref, hooks, registerGuard, refreshMeta } from './state.js'
import { icon, iconEl } from './icons.js'
import { SETTINGS_ROWS, assertCatalogue } from './catalog.js'
import { helpButton } from './help.js'

// ---------- new doc wizard ----------

async function newDocWizard(conceptName) {
  const meta = state.meta
  const concept = meta.concepts.find(c => c.name === conceptName) || meta.concepts[0]
  const vals = { concept: concept?.name, title: '' }
  const title = h('input', { placeholder: `${concept?.label || 'Document'} title…`, autofocus: true })
  dialog({
    title: `New ${concept?.label || 'document'}`,
    body: h('div', {},
      meta.concepts.length > 1 ? renderFields([{ key: 'concept', type: 'select', label: 'Type', options: meta.concepts.map(c => ({ value: c.name, label: c.label })), required: true }], vals, () => {}) : '',
      h('div.field', {}, h('label', {}, 'Title'), title)),
    actions: [{
      label: 'Create draft', kind: 'primary', onClick: async () => {
        if (!title.value.trim()) { title.focus(); return false }
        const r = await post('/content', { concept: vals.concept, title: title.value.trim() })
        location.hash = `#/e/${r.doc.id}`
        return true
      },
    }],
  })
  title.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('dialog').querySelector('.btn.primary').click() })
}
registerView('newDoc', async (_root, [concept]) => { newDocWizard(concept) })

// ---------- dashboard ----------

registerView('dashboard', async root => {
  const meta = state.meta
  const { docs } = await get('/content')
  const published = docs.filter(d => d.status === 'published')
  const inReview = docs.filter(d => d.status === 'review')
  const stale = docs.filter(d => d.stale)

  const onboarding = []
  if (!docs.length) onboarding.push(['Create your first page', () => newDocWizard('page')])
  if (docs.length && !published.length) onboarding.push(['Publish your first page', () => (location.hash = `#/e/${docs[0].id}`)])

  // Each number is the answer to a question, so each number is a way in.
  const stat = (n, label, hash, hint) => {
    if (!hash || !n) return h('div.card.stat', {}, h('span.n', {}, String(n)), h('span.l', {}, label))
    return h('button.card.stat.link', { onclick: () => (location.hash = hash), title: hint },
      h('span.n', {}, String(n)), h('span.l', {}, label, ' ', h('span', { html: icon('chevR', 11) })))
  }

  root.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.page-head', {},
      h('div', {}, h('h1', {}, `Hello, ${state.user.name.split(' ')[0]}`),
        h('p.sub', {}, meta.site.name, ' · ', h('a', { href: meta.site.url, target: '_blank', rel: 'noopener' }, meta.site.url))),
      h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
        ...meta.concepts.slice(0, 2).map(c => h('button.btn.primary', { onclick: () => newDocWizard(c.name) }, iconEl('plus', 13), `New ${c.label}`)))),

    onboarding.length ? h('div.card', { style: { marginBottom: 'var(--s4)', borderColor: 'var(--acc)' } },
      h('strong', {}, 'Getting started'),
      ...onboarding.map(([label, fn]) => h('p', { style: { marginTop: 'var(--s2)' } }, h('a', { href: '#', onclick: e => { e.preventDefault(); fn() } }, `→ ${label}`)))) : '',

    h('div.cards', {},
      stat(docs.length, 'Documents', '#/c/all', 'Browse everything, of every type'),
      stat(published.length, 'Published', '#/c/all?filter=published', 'Live on the site'),
      stat(inReview.length, 'Awaiting review', '#/c/all?filter=review', 'Submitted and waiting for you'),
      stat(stale.length, 'Unpublished edits', '#/c/all?filter=stale', 'Drafts newer than what visitors see')),

    inReview.length && meta.perms.publish ? h('div', {},
      h('h2', { style: { fontSize: 'var(--t-l)', margin: 'var(--s6) 0 var(--s3)' } }, 'Waiting for review'),
      ...inReview.map(d => docRow(d, 'Dashboard'))) : '',

    h('h2', { style: { fontSize: 'var(--t-l)', margin: 'var(--s6) 0 var(--s3)' } }, 'Recently edited'),
    ...(docs.slice(0, 8).map(d => docRow(d, 'Dashboard'))),
    !docs.length ? emptyState(icon('page', 26), 'Nothing here yet', 'Create your first document to get going.') : '',
  )))
})

function docRow(d, from) {
  return h('button.row-item', {
    onclick: () => { if (from) hooks.pushReturn?.(from, location.hash); location.hash = `#/e/${d.id}` },
  },
    h('span.row-ico', { html: icon(STATUS_ICON[d.status] || 'page', 15) }),
    h('span.row-label', {}, d.title, h('div.row-sub', {}, `${d.concept} · ${d.path} · ${fmtDate(d.updatedAt)}`)),
    d.stale ? h('span.chip.stale', {}, 'edits') : '',
    h('span.chip', { class: d.status }, d.status))
}

const STATUS_ICON = { published: 'check', draft: 'pen', review: 'clock' }

// ---------- content list ----------
// One list, not two. The left rail filters and groups; the main pane is the
// single source of truth, with sort, multi-select and bulk actions.

registerView('contentList', async (root, [conceptName], query) => {
  const meta = state.meta
  // `all` is a real destination, not a concept: the dashboard counts every
  // type, so the list it links to has to show every type too.
  const isAll = conceptName === 'all'
  const concept = isAll
    ? { name: 'all', label: 'Document', labelPlural: 'All content', urlPattern: '', fields: [] }
    : meta.concepts.find(c => c.name === conceptName)
  if (!concept) { location.hash = '#/'; return }
  if (query?.get('new')) { newDocWizard(isAll ? meta.concepts[0]?.name : conceptName); history.replaceState(null, '', `#/c/${conceptName}`) }

  let docs = (await get(isAll ? '/content' : `/content?concept=${conceptName}`)).docs
  let filter = query?.get('filter') || 'all'
  let sort = prefs().listSort || 'updated'
  let q = ''
  const selected = new Set()

  const FILTERS = [
    ['all', 'All', d => true],
    ['draft', 'Drafts', d => d.status === 'draft'],
    ['review', 'In review', d => d.status === 'review'],
    ['published', 'Published', d => d.status === 'published'],
    ['stale', 'Unpublished edits', d => d.stale],
  ]

  const visible = () => {
    const pred = (FILTERS.find(f => f[0] === filter) || FILTERS[0])[2]
    const ql = q.toLowerCase()
    const out = docs.filter(pred).filter(d => !ql || d.title.toLowerCase().includes(ql) || d.slug.includes(ql) || (d.path || '').includes(ql))
    const by = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => a.status.localeCompare(b.status) || a.title.localeCompare(b.title),
    }
    return out.sort(by[sort] || by.updated)
  }

  const listEl = h('div')
  const bulkEl = h('div')
  const countEl = h('p.sub')

  const setFilter = k => {
    filter = k
    selected.clear()
    const base = `#/c/${conceptName}`
    history.replaceState(null, '', k === 'all' ? base : `${base}?filter=${k}`)
    paintRail(); paintList()
  }

  const railEl = h('div.panel-body')
  function paintRail() {
    railEl.replaceChildren(
      ...FILTERS.map(([k, label, pred]) => {
        const n = docs.filter(pred).length
        return h('button.row-item', {
          class: k === filter ? 'active' : '', 'aria-current': k === filter ? 'true' : null,
          onclick: () => setFilter(k),
        },
          h('span.row-ico', { html: icon(k === 'stale' ? 'pen' : k === 'published' ? 'check' : k === 'review' ? 'clock' : 'list', 14) }),
          h('span.row-label', {}, label),
          h('span.count', {}, String(n)))
      }))
  }

  function paintList() {
    const items = visible()
    countEl.textContent = `${items.length} of ${docs.length} · ${concept.urlPattern || ''}`

    const allChecked = items.length > 0 && items.every(d => selected.has(d.id))
    const head = h('div.list-head', {},
      h('span.row-check', {}, h('input', {
        type: 'checkbox', checked: allChecked, 'aria-label': 'Select all shown',
        onchange: e => { items.forEach(d => e.target.checked ? selected.add(d.id) : selected.delete(d.id)); paintList() },
      })),
      h('button', { onclick: () => { sort = 'title'; setPref('listSort', sort); paintList() } }, 'Title', sort === 'title' ? iconEl('check', 11) : ''),
      h('button', { style: { marginLeft: 'auto' }, onclick: () => { sort = 'status'; setPref('listSort', sort); paintList() } }, 'Status', sort === 'status' ? iconEl('check', 11) : ''),
      h('button', { onclick: () => { sort = 'updated'; setPref('listSort', sort); paintList() } }, 'Updated', sort === 'updated' ? iconEl('check', 11) : ''))

    listEl.replaceChildren(
      items.length ? head : '',
      ...items.map(d => h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s1)' } },
        h('span.row-check', {}, h('input', {
          type: 'checkbox', checked: selected.has(d.id), 'aria-label': `Select ${d.title}`,
          onchange: e => { e.target.checked ? selected.add(d.id) : selected.delete(d.id); paintBulk() },
        })),
        h('button.row-item', {
          style: { flex: 1 },
          onclick: () => { hooks.pushReturn?.(concept.labelPlural || concept.label, location.hash); location.hash = `#/e/${d.id}` },
        },
          h('span.row-ico', { html: icon(STATUS_ICON[d.status] || 'page', 15) }),
          h('span.row-label', {}, d.title,
            h('div.row-sub', {}, isAll ? `${d.concept} · ${d.path} · ${fmtDate(d.updatedAt)}` : `${d.path} · ${fmtDate(d.updatedAt)}`)),
          d.stale ? h('span.chip.stale', {}, 'edits') : '',
          h('span.chip', { class: d.status }, d.status)))),
      !items.length
        ? emptyState(icon('page', 26),
          q ? 'No matches' : filter === 'stale' ? 'Everything is published' : `No ${concept.labelPlural || concept.label} yet`,
          q ? `Nothing in ${concept.labelPlural || concept.label} matches “${q}”.`
            : filter === 'stale' ? 'Nothing is waiting to go live.'
              : 'Create the first one and it will show up here.',
          q ? h('button.btn.ghost.small', { onclick: () => { q = ''; search.value = ''; paintList() } }, 'Clear the filter')
            : h('button.btn.primary', { onclick: () => newDocWizard(isAll ? meta.concepts[0]?.name : conceptName) }, iconEl('plus', 13), `New ${concept.label}`))
        : '')
    paintBulk()
  }

  function paintBulk() {
    if (!selected.size) { bulkEl.replaceChildren(); return }
    const ids = [...selected]
    const staleSel = ids.filter(id => docs.find(d => d.id === id)?.stale || docs.find(d => d.id === id)?.status !== 'published')
    bulkEl.replaceChildren(h('div.bulk-bar', {},
      h('strong', {}, `${ids.length} selected`),
      meta.perms.publish ? h('button.btn.primary.small', {
        onclick: async e => {
          const btn = e.currentTarget; btn.classList.add('busy'); btn.disabled = true
          const failed = []
          for (const id of ids) {
            try { await post(`/content/${id}/publish`) }
            catch { failed.push(docs.find(d => d.id === id)?.title || id) }
          }
          const n = ids.length - failed.length
          toast(failed.length
            ? `Published ${n} of ${ids.length}. Could not publish: ${failed.join(', ')}`
            : `Published ${n} document${n === 1 ? '' : 's'}`, failed.length ? 'err' : 'ok')
          docs = (await get(isAll ? '/content' : `/content?concept=${conceptName}`)).docs
          selected.clear(); paintRail(); paintList()
          hooks.refreshCounts?.()
        },
      }, `Publish ${staleSel.length || ids.length}`) : '',
      h('button.btn.ghost.small', { onclick: () => { selected.clear(); paintList() } }, 'Clear selection')))
  }

  const search = h('input.input', {
    placeholder: isAll ? 'Filter every document…' : `Filter ${concept.labelPlural || concept.label}…`,
    'aria-label': 'Filter documents',
    style: { width: '100%' },
    oninput: e => { q = e.target.value; paintList() },
  })

  root.replaceChildren(h('div.split', {},
    h('div.panel', {},
      h('div.panel-head', {}, h('span.panel-title', {}, concept.labelPlural || concept.label),
        h('button.btn.primary.small', { onclick: () => newDocWizard(isAll ? meta.concepts[0]?.name : conceptName) }, iconEl('plus', 12), 'New')),
      railEl),
    h('div.main', {}, h('div.main-pad', {},
      h('div.page-head', {},
        h('div', {},
          h('h1', {}, concept.labelPlural || concept.label),
          countEl),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost.small.panel-toggle', {
            'aria-label': 'Filters', onclick: () => root.querySelector('.split').classList.toggle('panel-open'),
          }, iconEl('filter', 12), 'Filters'),
          isAll ? '' : h('button.btn.ghost.small', { onclick: () => exportCsv(concept, docs) }, iconEl('download', 12), 'CSV'),
          isAll ? '' : h('button.btn.ghost.small', { onclick: () => importCsv(concept) }, iconEl('upload', 12), 'Import'),
          helpButton('content', concept.labelPlural || concept.label))),
      h('div', { style: { marginBottom: 'var(--s3)' } }, search),
      listEl,
      bulkEl))))

  hooks.reloadList = async () => {
    docs = (await get(isAll ? '/content' : `/content?concept=${conceptName}`)).docs
    selected.clear(); paintRail(); paintList()
  }

  paintRail()
  paintList()
  return () => { hooks.reloadList = null }
})

// ---------- media ----------

// (media/assets view lives in assets.js)

/** Minimal CSV codec — quotes, commas, newlines handled; no dependencies. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

async function exportCsv(concept, docs) {
  // full docs for field values
  const full = []
  for (const d of docs) full.push((await get(`/content/${d.id}`)).doc)
  const fieldKeys = (concept.fields || []).map(f => f.key)
  const esc = v => { const s2 = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2 }
  const lines = [['title', 'slug', 'status', ...fieldKeys].join(',')]
  for (const d of full) lines.push([esc(d.title), esc(d.slug), d.status, ...fieldKeys.map(k => esc(d.fields?.[k]))].join(','))
  const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `${concept.name}.csv` })
  a.click()
}

function importCsv(concept) {
  const file = h('input', { type: 'file', accept: '.csv,text/csv' })
  const preview = h('div')
  let rows = null, headers = null, mapping = {}
  file.addEventListener('change', async () => {
    const text = await file.files[0].text()
    const all = parseCsv(text)
    headers = all[0].map(x => x.trim())
    rows = all.slice(1)
    const fieldKeys = ['title', 'slug', ...(concept.fields || []).map(f => f.key)]
    mapping = {}
    for (const fk of fieldKeys) {
      const hit = headers.findIndex(h2 => h2.toLowerCase() === fk.toLowerCase())
      if (hit >= 0) mapping[fk] = hit
    }
    preview.replaceChildren(
      h('p.dlg-text', {}, `${rows.length} row(s). Map columns:`),
      ...fieldKeys.map(fk => h('div', { style: { display: 'grid', gridTemplateColumns: '8rem 1fr', gap: 'var(--s3)', alignItems: 'center', marginBottom: 'var(--s1)' } },
        h('code.pill-perm', {}, fk),
        h('select.input', {
          onchange: e => { const v = e.target.value; if (v === '') delete mapping[fk]; else mapping[fk] = +v },
        },
          h('option', { value: '' }, '— skip —'),
          ...headers.map((h2, i) => h('option', { value: i, selected: mapping[fk] === i }, h2))))))
  })
  dialog({
    title: `Import ${concept.labelPlural || concept.label} from CSV`,
    width: 'min(32rem, 94vw)',
    body: h('div', {},
      h('p.dlg-text', {}, 'First row = headers. Rows become drafts — nothing publishes automatically.'),
      h('div.field', {}, h('label', {}, 'CSV file'), file),
      preview),
    actions: [{
      label: 'Import as drafts', kind: 'primary', onClick: async () => {
        if (!rows?.length || mapping.title === undefined) { toast('Choose a file and map the title column', 'err'); return false }
        const docs = rows.map(r => ({
          title: r[mapping.title],
          slug: mapping.slug !== undefined ? r[mapping.slug] : undefined,
          fields: Object.fromEntries((concept.fields || []).map(f => [f.key, mapping[f.key] !== undefined ? r[mapping[f.key]] : undefined]).filter(([, v]) => v !== undefined && v !== '')),
        })).filter(d => d.title)
        const res = await post('/content/bulk', { concept: concept.name, docs })
        // repaint the list we are already looking at, rather than rebooting the
        // studio and dumping the user back on the dashboard
        hooks.invalidateSearch?.()
        hooks.refreshCounts?.()
        hooks.reloadList?.()
        toast(`Imported ${res.created} draft${res.created === 1 ? '' : 's'} — they are in Drafts, nothing is live yet`, 'ok', 6000)
        return true
      },
    }],
  })
}

function humanSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

// ---------- users ----------

registerView('users', async root => {
  const me = state.user
  const ROLES = [
    ['viewer', 'Read-only', 'Can browse content and media in the studio. Cannot change anything.'],
    ['author', 'Author', 'Writes and edits their own drafts, uploads media, submits for review. Cannot publish.'],
    ['editor', 'Editor', 'Edits and publishes any content, manages menus, media and SEO, uses every plugin.'],
    ['admin', 'Admin', 'Everything — settings, users, plugins, deploys.'],
    ['owner', 'Owner', 'Same as admin, and only owners can create or modify other owners.'],
  ]
  const GRANTABLE = [
    ['content.publish', 'Publish content'], ['content.write', 'Edit anyone’s content'],
    ['content.delete', 'Delete content'], ['menus.write', 'Edit menus'],
    ['seo.tools', 'SEO tools'], ['media.manage', 'Manage the asset library'],
    ['plugin:*', 'Use every plugin'], ['users.manage', 'Manage users'],
    ['settings.write', 'Change site settings'], ['plugins.manage', 'Approve plugins'],
    ['deploy.export', 'Run diagnostics & export'], ['audit.read', 'Read the audit log'],
    ['plugin:ops.manage', 'Sync to git & manage backups'],
  ]
  const genPass = () => 'blockhouse-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 8)
  const initials = n => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const canTouch = u => !(u.role === 'owner' && me.role !== 'owner')

  const holder = h('div')
  const refresh = async () => {
    const { users } = await get('/users')
    holder.replaceChildren(h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Role'), h('th', {}, 'Last sign-in'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, ...users.map(u => {
        const roleSel = h('select.input', {
          disabled: !canTouch(u) || u.id === me.id,
          style: { fontSize: 'var(--t-s)', width: 'auto', padding: 'var(--s1) var(--s2)' },
          onchange: async e => {
            if (e.target.value === 'owner' && me.role !== 'owner') { toast('Only owners can promote to owner', 'err'); e.target.value = u.role; return }
            await patch(`/users/${u.id}`, { role: e.target.value })
            toast(`${u.name} is now ${e.target.value} — their other sessions were signed out`, 'ok', 4000)
            refresh()
          },
        }, ...ROLES.map(([r]) => h('option', { value: r, selected: u.role === r, disabled: r === 'owner' && me.role !== 'owner' }, r)))

        return h('tr', {},
          h('td', {}, h('div', { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'center' } },
            h('span.avatar', {}, initials(u.name)),
            h('div', {}, h('strong', { style: { fontSize: 'var(--t-m)' } }, u.name, u.id === me.id ? h('span.fnt', { style: { fontWeight: 'var(--fw-regular)' } }, '  (you)') : ''),
              h('div.mut', { style: { fontSize: 'var(--t-s)' } }, u.email)))),
          h('td', {}, roleSel),
          h('td.fnt', { style: { fontSize: 'var(--t-s)' } }, u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'never'),
          h('td', {}, h('label.switch', { title: u.active ? 'Active — click to disable' : 'Disabled — click to enable' },
            h('input', {
              type: 'checkbox', checked: !!u.active, disabled: !canTouch(u) || u.id === me.id,
              onchange: async e => { await patch(`/users/${u.id}`, { active: e.target.checked }); toast(e.target.checked ? 'Account enabled' : 'Account disabled — sessions revoked', 'ok'); refresh() },
            }), h('span.switch-track'))),
          h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            h('button.btn.ghost.small', { disabled: !canTouch(u), onclick: () => resetPassword(u) }, iconEl('key', 12), 'Reset'),
            ' ',
            h('button.btn.ghost.small', { disabled: !canTouch(u), onclick: () => editGrants(u) }, iconEl('shield', 12), 'Access')))
      })))))
  }

  const credentialsCard = (email, password) => {
    const text = `URL: ${location.origin}/admin/\nEmail: ${email}\nPassword: ${password}`
    return h('div', {},
      h('p.dlg-text', {}, 'Share these once, over a channel you trust. The password is not stored anywhere readable — this is the only time it is shown.'),
      h('pre.code-out', { style: { userSelect: 'all' } }, text),
      h('button.btn.ghost.small', { onclick: () => { navigator.clipboard?.writeText(text); toast('Copied', 'ok') } }, iconEl('copy', 13), 'Copy credentials'))
  }

  const resetPassword = u => {
    const pw = genPass()
    dialog({
      title: `Reset password — ${u.name}`,
      body: h('div', {},
        h('p.dlg-text', {}, 'A new password is generated below. Saving signs them out everywhere.'),
        credentialsCard(u.email, pw)),
      actions: [{
        label: 'Set this password', kind: 'primary', onClick: async () => {
          await patch(`/users/${u.id}`, { password: pw })
          toast('Password reset — their sessions were signed out', 'ok')
          return true
        },
      }],
    })
  }

  const editGrants = u => {
    const set = new Set(u.grants || [])
    dialog({
      title: `Extra access — ${u.name}`,
      width: 'min(30rem, 94vw)',
      body: h('div', {},
        h('p.dlg-text', {}, `On top of what “${u.role}” already allows. Useful for one-off needs — an author who can publish, a viewer who can run SEO audits.`),
        h('div', { style: { display: 'grid', gap: 'var(--s0)' } },
          ...GRANTABLE.map(([perm, label]) => h('label.field-check', {},
            h('input', { type: 'checkbox', checked: set.has(perm), onchange: e => e.target.checked ? set.add(perm) : set.delete(perm) }),
            h('span', {}, label, ' ', h('code.pill-perm', {}, perm)))))),
      actions: [{
        label: 'Save access', kind: 'primary', onClick: async () => {
          await patch(`/users/${u.id}`, { grants: [...set] })
          toast('Access updated — their other sessions were signed out', 'ok')
          refresh(); return true
        },
      }],
    })
  }

  const invite = () => {
    const vals = { email: '', name: '', role: 'author' }
    let pw = genPass()
    const pwInput = h('input.input', { value: pw, oninput: e => (pw = e.target.value) })
    const roleCards = h('div', { style: { display: 'grid', gap: 'var(--s1)' } },
      ...ROLES.filter(([r]) => r !== 'owner' || me.role === 'owner').map(([r, label, blurb]) =>
        h('label.role-card', { class: vals.role === r ? 'active' : '' },
          h('input', { type: 'radio', name: 'inv-role', checked: vals.role === r, onchange: () => { vals.role = r; roleCards.querySelectorAll('.role-card').forEach(x => x.classList.remove('active')); event.target.closest('.role-card').classList.add('active') } }),
          h('div', {}, h('strong', { style: { fontSize: 'var(--t-m)' } }, label), h('p', {}, blurb)))))
    dialog({
      title: 'Invite someone',
      width: 'min(32rem, 94vw)',
      body: h('div', {},
        renderFields([
          { key: 'email', type: 'text', label: 'Email', required: true, width: 'half' },
          { key: 'name', type: 'text', label: 'Name', width: 'half' },
        ], vals, () => {}),
        h('div.field', {}, h('label', {}, h('span', {}, 'Role')), roleCards),
        h('div.field', {}, h('label', {}, h('span', {}, 'Temporary password'), h('span.help', {}, 'Generated — edit if you prefer')), pwInput)),
      actions: [{
        label: 'Create account', kind: 'primary', onClick: async () => {
          if (!vals.email) { toast('Email required', 'err'); return false }
          await post('/users', { ...vals, password: pw })
          refresh()
          dialog({ title: 'Account created', body: credentialsCard(vals.email, pw), actions: [{ label: 'Done', kind: 'primary', onClick: () => true }] })
          return true
        },
      }],
    })
  }

  root.replaceChildren(h('div.main', {}, h('div.main-pad', { style: { maxWidth: '62rem' } },
    h('div.page-head', {},
      h('div', {}, h('h1', {}, 'People'), h('p.sub', {}, 'Studio accounts — people who edit this site. Site visitors live under Members.')),
      h('button.btn.primary', { onclick: invite }, '＋ Invite')),
    h('details.card', { style: { marginBottom: 'var(--s4)', padding: 'var(--s3) var(--s4)' } },
      h('summary', { style: { cursor: 'pointer', fontSize: 'var(--t-m)', fontWeight: 'var(--fw-semi)', color: 'var(--mut)' } }, 'What can each role do?'),
      h('div', { style: { marginTop: 'var(--s3)', display: 'grid', gap: 'var(--s2)' } },
        ...ROLES.map(([r, label, blurb]) => h('div', { style: { display: 'grid', gridTemplateColumns: '6rem 1fr', gap: 'var(--s4)', fontSize: 'var(--t-m)' } },
          h('strong', {}, label), h('span.mut', {}, blurb))))),
    holder)))
  refresh()
})

// ---------- settings ----------

registerView('settings', async (root, [groupKey], query) => {
  const { settings } = await get('/settings')
  const s = settings
  s.seo ??= {}; s.images ??= {}; s.theme ??= {}; s.theme.tokens ??= {}; s.mail ??= {}; s.features ??= {}; s.plugins ??= {}
  const dirtyCards = new Set()
  const save = async patchObj => { await put('/settings', { patch: patchObj }); toast('Saved', 'ok') }

  const siteVals = { name: s.name || '', url: s.url || '', tagline: s.tagline || '', language: s.language || 'en' }
  const seoVals = { titlePattern: s.seo.titlePattern || '{title} — {site}', description: s.seo.description || '', twitter: s.seo.twitter || '', image: s.seo.image || '' }
  const imgVals = {
    provider: s.images.provider || 'local',
    sizes: (s.images.sizes || [320, 640, 960, 1280, 1920]).join(', '),
    quality: s.images.quality ?? 82, stripExif: s.images.stripExif !== false,
    watermarkMedia: s.images.watermark?.media || '', watermarkOpacity: s.images.watermark?.opacity ?? 0.5,
  }
  const mailVals = { driver: s.mail.driver || 'console', from: s.mail.from || '', options: s.mail.options || {} }

  const card = (title2, sub, body, onSave) => {
    const dot = h('span.dirty-dot', { hidden: true, title: 'Unsaved changes' })
    const btn = onSave ? h('button.btn.ghost.small', {
      onclick: async e => {
        const b = e.currentTarget
        b.classList.add('busy'); b.disabled = true
        try {
          await onSave()
          dirtyCards.delete(title2); dot.hidden = true
          b.textContent = 'Saved'; setTimeout(() => { b.textContent = 'Save' }, 1400)
        } finally { b.classList.remove('busy'); b.disabled = false }
      },
    }, 'Save') : ''
    const el = h('div.card', { style: { marginBottom: 'var(--s4)' } },
      h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
        h('div', {}, h('strong', {}, title2, dot), sub ? h('p.sub', {}, sub) : ''), btn),
      body)
    // any edit inside the card marks it dirty, so the route guard knows
    const mark = () => { dirtyCards.add(title2); dot.hidden = false }
    el.addEventListener('input', mark)
    el.addEventListener('change', mark)
    return el
  }

  // ----- Features: one switchboard for the batteries -----
  const featuresCard = () => {
    const f = s.features
    const FEATURES = [
      ['prefetch', 'Speculative prefetch', 'Preloads likely next pages — snappier navigation, slightly more bandwidth.'],
      ['viewTransitions', 'View transitions', 'Cross-page fade/morph animation in supporting browsers.'],
      ['themeToggle', 'Visitor theme toggle', 'The light/dark switch in the header (auto scheme only).'],
      ['rss', 'RSS feeds', 'Per-type feeds at <index>/feed.xml for types that enable them.'],
      ['sitemap', 'sitemap.xml', 'The machine-readable page list search engines read.'],
      ['analyticsBeacon', 'Analytics beacon', 'The privacy-friendly hit counter (needs the Analytics plugin).'],
      ['searchOpenSearch', 'OpenSearch', 'Lets browsers register this site as a search engine.'],
    ]
    return card('Site features', 'Core behaviours, one switchboard. Off means off — nothing ships to the page.',
      h('div', { style: { display: 'grid', gap: 'var(--s0)' } }, ...FEATURES.map(([key, label, blurb]) =>
        h('div', { style: { display: 'flex', gap: 'var(--s4)', alignItems: 'center', padding: 'var(--s2) 0', borderBottom: '1px solid var(--line-soft)' } },
          h('label.switch', {},
            h('input', {
              type: 'checkbox',
              checked: key === 'themeToggle' ? s.theme.showToggle !== false : f[key] !== false,
              onchange: async e => {
                if (key === 'themeToggle') { s.theme.showToggle = e.target.checked; await save({ theme: { ...s.theme } }) }
                else { f[key] = e.target.checked ? true : false; await save({ features: { ...f } }) }
              },
            }), h('span.switch-track')),
          h('div', {}, h('strong', { style: { fontSize: 'var(--t-m)' } }, label),
            h('p.fnt', { style: { fontSize: 'var(--t-s)', margin: 0 } }, blurb))))))
  }

  // ----- plugin-contributed sections (registered via ctx.settingsSection) -----
  const pluginCards = () => {
    const secs = state.meta.settingsSections || []
    if (!secs.length) return [h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'No plugin settings sections — plugins registering one appear here automatically.')]
    return secs.map(sec => {
      const store = ((s.plugins[sec.plugin] ??= { enabled: true, approved: [] }).settings ??= {})
      const vals = {}
      for (const f of sec.fields) vals[f.key] = store[f.key] ?? f.default ?? ''
      return card(`${sec.label}`, sec.description || `From the ${sec.plugin} plugin.`,
        renderFields(sec.fields.map(f => ({ ...f, type: f.type || 'text' })), vals, () => {}),
        async () => {
          Object.assign(store, vals)
          await save({ plugins: s.plugins })
        })
    })
  }

  const GROUPS = [
    { key: 'general', label: 'General', icon: 'home', body: () => [
      card('Identity', null, renderFields([
        { key: 'name', type: 'text', label: 'Site name' },
        { key: 'url', type: 'text', label: 'Canonical URL', help: 'https://example.com' },
        { key: 'tagline', type: 'text', label: 'Tagline' },
        { key: 'language', type: 'text', label: 'Language code', width: 'half' },
      ], siteVals, () => {}), () => save(siteVals)),
      card('SEO defaults', 'Per-page overrides live in each document’s SEO tab.', renderFields([
        { key: 'titlePattern', type: 'text', label: 'Title pattern', help: '{title} and {site} are replaced' },
        { key: 'description', type: 'textarea', label: 'Default meta description', rows: 2 },
        { key: 'twitter', type: 'text', label: 'X / Twitter handle', width: 'half' },
        { key: 'image', type: 'image', label: 'Default share image' },
      ], seoVals, () => {}), () => save({ seo: { ...s.seo, ...seoVals } })),
    ]},
    { key: 'features', label: 'What the site does', icon: 'bolt', body: () => [featuresCard()] },
    { key: 'brand', label: 'Brand', icon: 'star', body: () => [brandSection(s, save)] },
    { key: 'appearance', label: 'Appearance', icon: 'palette', body: () => [
      h('div.card', { style: { marginBottom: 'var(--s4)', padding: 'var(--s4) var(--s4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s4)' } },
        h('div', {},
          h('strong', {}, 'Template, palette and colour scheme'),
          h('p.sub', {}, `Edited in Design, with the site itself as the preview. Currently: ${s.template || 'aurora'} · ${s.theme.colorScheme || 'auto'} scheme.`)),
        h('a.btn.primary.small', { href: '#/design' }, 'Open Design')),
      fontsSection(s, save),
    ]},
    { key: 'urls', label: 'URLs & addresses', icon: 'link', body: () => [urlsSection(s, save)] },
    { key: 'images', label: 'Images', icon: 'image', body: () => [
      card('Images', 'Applied on upload and on-demand variant generation.', renderFields([
        { key: 'provider', type: 'select', label: 'Provider', options: [{ value: 'local', label: 'Local (sharp)' }, { value: 'cloudflare', label: 'Cloudflare Image Resizing' }], width: 'half' },
        { key: 'quality', type: 'number', label: 'Quality', width: 'half' },
        { key: 'sizes', type: 'text', label: 'Sizes (px, comma-separated)' },
        { key: 'stripExif', type: 'boolean', label: 'Strip EXIF metadata on upload' },
        { key: 'watermarkMedia', type: 'image', label: 'Watermark image (optional)' },
        { key: 'watermarkOpacity', type: 'number', label: 'Watermark opacity (0–1)', width: 'half' },
      ], imgVals, () => {}), () => save({
        images: {
          ...s.images, provider: imgVals.provider, quality: +imgVals.quality || 82,
          sizes: imgVals.sizes.split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean),
          stripExif: !!imgVals.stripExif,
          watermark: imgVals.watermarkMedia ? { media: imgVals.watermarkMedia, opacity: +imgVals.watermarkOpacity || 0.5, gravity: 'southeast' } : null,
        },
      })),
    ]},
    { key: 'mail', label: 'Mail', icon: 'mail', body: () => [
      card('Mail', 'How the site sends email — receipts, magic links, notifications. Save, then send yourself a test.', h('div', {},
        renderFields([
          { key: 'driver', type: 'select', label: 'Provider', options: [
            { value: 'console', label: 'Console (dev — logs to the server)' },
            { value: 'resend', label: 'Resend' },
            { value: 'sendgrid', label: 'SendGrid' },
            { value: 'postmark', label: 'Postmark' },
            { value: 'mailchannels', label: 'MailChannels (Cloudflare)' },
            { value: 'webhook', label: 'Webhook (POST JSON anywhere)' },
          ], width: 'half' },
          { key: 'from', type: 'text', label: 'From address', width: 'half' },
          { key: 'options', type: 'json', label: 'Provider options', help: '{"apiKey":"…"} for Resend/SendGrid/Postmark · {"url":"…"} for webhook · {} for console/MailChannels' },
        ], mailVals, () => {}),
        h('div', { style: { display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' } },
          h('button.btn.soft.small', { onclick: async () => {
            await save({ mail: mailVals })
            const r = await post('/mail/test', {}).catch(e => ({ error: e.message }))
            toast(r.ok ? `Test sent to ${r.to} via ${mailVals.driver}` : `Send failed: ${r.error}`, r.ok ? 'ok' : 'err', 6000)
          } }, iconEl('send', 13), 'Save & send me a test'))),
        () => save({ mail: mailVals })),
    ]},
    { key: 'code', label: 'Custom code', icon: 'code', body: () => [codeSection(s, save)] },
    { key: 'system', label: 'System pages', icon: 'page', body: () => [systemPagesSection(s, save)] },
    { key: 'pluginsx', label: 'App settings', icon: 'plug', body: () => pluginCards() },
    { key: 'build', label: 'Publishing & export', icon: 'box', body: () => [
      buildSection(s, save),
      h('div.card', {},
        h('div.page-head', { style: { marginBottom: 'var(--s2)' } }, h('div', {}, h('strong', {}, 'Static export'), h('p.sub', {}, 'Build a flat site into dist/ — deploy anywhere static.')),
          h('button.btn.primary.small', {
            onclick: async e => {
              e.currentTarget.disabled = true
              const r = await post('/export').finally(() => (e.currentTarget.disabled = false))
              toast(`Exported ${r.pages} pages, ${r.variants} image variants → ${r.outDir}`, 'ok', 6000)
            },
          }, 'Export now'))),
    ]},
    { key: 'interface', label: 'Studio interface', icon: 'layout', body: () => [modulesSection(s, save)] },
    { key: 'security', label: 'Security', icon: 'shield', body: () => [securitySection(s, save)] },
  ]

  let active = GROUPS.find(g => g.key === groupKey) || GROUPS[0]
  const nav = h('div.panel-body')
  const main = h('div.main-pad', { style: { maxWidth: '54rem' } })
  let search = ''
  assertCatalogue(GROUPS.map(g => g.key))

  // Searching settings has to reach FIELDS, not only group names — nobody
  // guesses that "strip EXIF" lives under Images.
  const hits = () => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    return SETTINGS_ROWS.filter(r =>
      r.label.toLowerCase().includes(q) || (r.keywords || '').includes(q) || (r.sub || '').toLowerCase().includes(q))
  }

  const goGroup = (g, fieldKey) => {
    active = g
    // swapping the panel in place instead of pushing a hash keeps every other
    // view's state alive, and keeps back/forward meaningful
    history.replaceState(null, '', `#/settings/${g.key}`)
    paintNav2(); paintMain2(fieldKey)
  }

  const paintNav2 = () => {
    const found = hits()
    nav.replaceChildren(
      h('div.set-search', {}, h('input.input', {
        placeholder: 'Search every setting...', 'aria-label': 'Search settings', value: search,
        oninput: e => { search = e.target.value; paintNav2() },
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
          : [h('p.mut', { style: { padding: 'var(--s3) var(--s3)', fontSize: 'var(--t-m)' } }, 'No setting matches that.')])
        : GROUPS.map(g =>
          h('button.row-item', {
            class: g.key === active.key ? 'active' : '',
            'aria-current': g.key === active.key ? 'true' : null,
            onclick: () => goGroup(g),
          }, h('span.row-ico', { html: icon(g.icon, 15) }), h('span.row-label', {}, g.label)))))
  }

  const paintMain2 = (fieldKey) => {
    main.replaceChildren(
      h('div.page-head', {},
        h('div', {},
          h('h1', {}, active.label),
          h('p.sub', {}, 'Stored in site/site.json - commit it with your content.')),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost.small.panel-toggle', {
            'aria-label': 'All settings', onclick: () => root.querySelector('.split').classList.toggle('panel-open'),
          }, iconEl('list', 12), 'All settings'),
          helpButton('settings', active.label))),
      ...active.body())
    if (fieldKey) {
      // a search hit should land ON the control, not merely near it
      requestAnimationFrame(() => {
        const want = fieldKey.toLowerCase()
        const label = [...main.querySelectorAll('.field label span:first-child, .field-check span')]
          .find(el => el.textContent.toLowerCase().replace(/[^a-z]/g, '').includes(want.replace(/[^a-z]/g, '')))
        const field = label?.closest('.field') || main.querySelector('.card')
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        field?.classList.add('flash')
        setTimeout(() => field?.classList.remove('flash'), 1900)
      })
    }
  }

  root.replaceChildren(h('div.split', {},
    h('div.panel', {}, h('div.panel-head', {}, h('span.panel-title', {}, 'Settings')), nav),
    h('div.main', {}, main)))
  paintNav2()
  paintMain2(query?.get('f'))

  // Every card has its own Save; leaving with one untouched used to discard it
  // in silence. One guard, in one place, for the whole view.
  const disposeGuard = registerGuard('settings', async () => {
    if (!dirtyCards.size) return true
    return await confirmDialog('Unsaved settings',
      `${dirtyCards.size} card${dirtyCards.size > 1 ? 's have' : ' has'} changes you have not saved. Leave and discard them?`, 'Discard')
  })
  return () => disposeGuard()
})

// ---------- brand variables, colour scheme, URLs, modules, security ----------

function brandSection(s, save) {
  const defs = s.varDefs ? JSON.parse(JSON.stringify(s.varDefs)) : []
  const vals = s.vars ? JSON.parse(JSON.stringify(s.vars)) : {}
  const holder = h('div')

  const render = () => {
    const groups = {}
    for (const d of defs) (groups[d.group || ''] ??= []).push(d)
    holder.replaceChildren(
      ...Object.entries(groups).map(([g, list]) => {
        const inner = h('div')
        inner.appendChild(renderFields(list.map(d => ({
          key: d.key, label: d.label || d.key, type: d.type || 'text', help: d.help,
          options: d.options, width: ['color', 'number', 'boolean'].includes(d.type) ? 'half' : undefined,
        })), vals, () => {}))
        return g ? h('div.field-group', { style: { marginBottom: 'var(--s4)' } }, h('div.fg-title', {}, g), inner) : inner
      }),
      defs.length ? '' : h('p.mut', { style: { marginBottom: 'var(--s3)' } }, 'No variables yet. Add one below — then use it anywhere in content as {{var.key}} or in templates as {{ vars.key }}.'),
      h('div', { style: { display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' } },
        ...defs.map((d, i) => h('span.multi-tag', {}, `{{var.${d.key}}}`,
          h('button', { onclick: () => { defs.splice(i, 1); delete vals[d.key]; render() }, html: icon('x', 11) })))))
  }
  render()

  const addVar = () => {
    const nv = { key: '', label: '', type: 'text', group: '' }
    dialog({
      title: 'New brand variable',
      body: renderFields([
        { key: 'key', type: 'text', label: 'Key', help: 'lowercase, no spaces — used as {{var.key}}', required: true },
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'type', type: 'select', label: 'Type', options: ['text', 'textarea', 'color', 'image', 'link', 'number', 'boolean'].map(v => ({ value: v })), width: 'half' },
        { key: 'group', type: 'text', label: 'Group', width: 'half' },
      ], nv, () => {}),
      actions: [{ label: 'Add', kind: 'primary', onClick: () => {
        if (!/^[a-z][\w-]*$/.test(nv.key)) { toast('Key must start with a letter, no spaces', 'err'); return false }
        defs.push({ ...nv, label: nv.label || nv.key }); render(); return true
      } }],
    })
  }

  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Brand variables'),
        h('p.sub', {}, 'Define once, reuse everywhere. Editors type {{var.phone}} in any text field and it resolves site-wide.')),
      h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
        h('button.btn.ghost.small', { onclick: addVar }, iconEl('plus', 14), 'Add variable'),
        h('button.btn.ghost.small', { onclick: () => save({ vars: vals, varDefs: defs }) }, 'Save'))),
    holder)
}

function schemeSection(s, save) {
  const theme = s.theme || {}
  const vals = { colorScheme: theme.colorScheme || 'auto', showToggle: theme.showToggle !== false }
  const note = h('p.fnt', { style: { fontSize: 'var(--t-s)' } })
  const sync = () => {
    note.textContent = vals.colorScheme === 'auto'
      ? 'Visitors get their OS preference, and can flip it with the header toggle.'
      : `Every visitor sees ${vals.colorScheme} mode. The toggle is hidden, and the editor preview matches.`
  }
  sync()
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Colour scheme'), h('p.sub', {}, 'Some brands want one look only — lock it here.')),
      h('button.btn.ghost.small', { onclick: () => save({ theme: { ...theme, ...vals } }) }, 'Save')),
    renderFields([
      { key: 'colorScheme', type: 'select', label: 'Public site renders in', required: true, options: [
        { value: 'auto', label: 'Auto — follow the visitor’s device' },
        { value: 'light', label: 'Light only' },
        { value: 'dark', label: 'Dark only' }] },
      { key: 'showToggle', type: 'boolean', label: 'Show the theme toggle (auto mode only)' },
    ], vals, () => sync()),
    note)
}

/* System pages — the 404, the maintenance screen and anything else that isn't
   reachable by URL. Assigning a document means you build them with the same
   blocks as any other page, instead of editing a template file. */
function systemPagesSection(s, save) {
  const sys = { ...(s.systemPages || {}) }
  const m = { enabled: false, message: '', retryAfter: 600, allow: [], ...(s.maintenance || {}) }
  const holder = h('div', {}, skeleton('rows', 5))

  get('/content').then(({ docs }) => {
    const options = [{ value: '', label: 'Use the template file' },
      ...docs.map(d => ({ value: d.id, label: `${d.title}  (${d.path})` }))]
    const allowVal = { allow: (m.allow || []).join(', ') }
    holder.replaceChildren(
      renderFields([
        { key: '404', type: 'select', label: 'Not found (404)', options, help: 'Shown for any unknown URL' },
        { key: 'maintenance', type: 'select', label: 'Maintenance', options, help: 'Shown while maintenance mode is on' },
      ], sys, () => {}),
      h('div.insp-section-title', { style: { marginTop: 'var(--s3)' } }, 'Maintenance mode'),
      renderFields([
        { key: 'enabled', type: 'boolean', label: 'Maintenance mode is on' },
        { key: 'message', type: 'text', label: 'Fallback message', help: 'Used when no maintenance document is chosen' },
        { key: 'retryAfter', type: 'number', label: 'Retry-After (seconds)', width: 'half' },
      ], m, () => {}),
      renderFields([
        { key: 'allow', type: 'text', label: 'Paths that stay open', help: 'Comma separated, e.g. /status, /contact' },
      ], allowVal, (k, v) => { m.allow = String(v).split(',').map(x => x.trim()).filter(Boolean) }),
      h('p.fnt', { style: { fontSize: 'var(--t-s)' } },
        'While maintenance mode is on the public site answers 503 with a Retry-After header, so search engines wait rather than de-indexing you. Signed-in studio users, assets and /healthz keep working.'))
  }).catch(() => holder.replaceChildren(h('p.mut', {}, 'Could not load documents.')))

  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'System pages'), h('p.sub', {}, 'The 404, the maintenance screen — built from blocks like everything else.')),
      h('button.btn.ghost.small', {
        onclick: () => {
          const clean = {}
          for (const [k, v] of Object.entries(sys)) if (v) clean[k] = v
          save({ systemPages: clean, maintenance: m })
        },
      }, 'Save')),
    holder)
}

function urlsSection(s, save) {
  const u = s.urls || {}
  const vals = {
    style: u.style || 'directory', layout: u.layout || 'pattern',
    lowercase: u.lowercase !== false, shortlinks: !!u.shortlinks, shortlinkPrefix: u.shortlinkPrefix || 's',
  }
  const preview = h('p.fnt', { style: { fontSize: 'var(--t-s)', fontFamily: 'var(--mono)' } })
  const sync = () => {
    const p = vals.layout === 'flat' ? '/about' : '/blog/my-post'
    const shown = vals.style === 'extension' ? `${p}.html` : vals.style === 'bare' ? p : `${p}/`
    const file = vals.style === 'directory' ? `${p.slice(1)}/index.html` : `${p.slice(1)}.html`
    preview.textContent = `URL: ${shown}   ·   static file: ${file}` + (vals.shortlinks ? `   ·   short: /${vals.shortlinkPrefix}/ab12cd` : '')
  }
  sync()
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'URLs & paths'), h('p.sub', {}, 'How addresses are generated and what a static build writes to disk.')),
      h('button.btn.ghost.small', { onclick: () => save({ urls: vals }) }, 'Save')),
    renderFields([
      { key: 'style', type: 'select', label: 'URL style', options: [
        { value: 'directory', label: 'Folders — /about/ (index.html)' },
        { value: 'extension', label: 'Files — /about.html' },
        { value: 'bare', label: 'Bare — /about' }] },
      { key: 'layout', type: 'select', label: 'Path layout', options: [
        { value: 'pattern', label: 'Per-type pattern (e.g. /blog/{slug})' },
        { value: 'flat', label: 'Flat — everything at the root' }] },
      { key: 'lowercase', type: 'boolean', label: 'Force lowercase paths' },
      { key: 'shortlinks', type: 'boolean', label: 'Enable shortlinks (/s/<code> → the page)' },
      { key: 'shortlinkPrefix', type: 'text', label: 'Shortlink prefix', width: 'half' },
    ], vals, () => sync()),
    preview,
    h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s2)' } },
      'Per-page aliases and mirrors live in the editor’s Page tab. Slug changes keep 301-ing automatically.'))
}

const MODULE_LIST = [
  ['media', 'Assets'], ['menus', 'Menus'], ['seo', 'SEO'], ['help', 'Help'],
  ['users', 'Users'], ['plugins', 'Plugins'], ['settings', 'Settings'],
]
function modulesSection(s, save) {
  const mods = s.modules || {}
  const hidden = new Set(mods.hidden || [])
  const perRole = JSON.parse(JSON.stringify(mods.hiddenForRole || {}))
  const roles = ['viewer', 'author', 'editor', 'admin']

  const grid = h('div.table-wrap', {}, h('table.data-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Module'), h('th', {}, 'Hidden for everyone'), ...roles.map(r => h('th', {}, r)))),
    h('tbody', {}, ...MODULE_LIST.map(([key, label]) => h('tr', { style: { cursor: 'default' } },
      h('td', {}, label),
      h('td', {}, h('input', { type: 'checkbox', checked: hidden.has(key), onchange: e => e.target.checked ? hidden.add(key) : hidden.delete(key) })),
      ...roles.map(r => h('td', {}, h('input', {
        type: 'checkbox', checked: (perRole[r] || []).includes(key),
        onchange: e => {
          perRole[r] = perRole[r] || []
          if (e.target.checked) perRole[r].push(key)
          else perRole[r] = perRole[r].filter(k => k !== key)
        },
      }))))))))

  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Interface modules'),
        h('p.sub', {}, 'Hide what a team doesn’t need. Hidden modules disappear from the rail, ribbon and command palette.')),
      h('button.btn.ghost.small', { onclick: () => save({ modules: { hidden: [...hidden], hiddenForRole: perRole } }) }, 'Save')),
    grid)
}

function securitySection(s, save) {
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
  const doSave = () => save({
    security: { ...sec, ...vals, maxLoginAttempts: +vals.maxLoginAttempts || 8, lockoutMinutes: +vals.lockoutMinutes || 15, minPasswordLength: +vals.minPasswordLength || 8,
      adminAllowlist: vals.adminAllowlist.split(',').map(x => x.trim()).filter(Boolean),
      adminPath: String(vals.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin',
      trustedIssuers: (() => { try { return JSON.parse(vals.trustedIssuers || '{}') } catch { return sec.trustedIssuers || {} } })() },
  })

  const previewOut = h('div', { style: { marginTop: 'var(--s2)' } })
  const renderPreviewLink = token => {
    if (!token) { previewOut.replaceChildren(h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'No link yet — visitors get the plain sign-in wall.')); return }
    const url = `${location.origin}/?preview=${token}`
    previewOut.replaceChildren(h('input', {
      type: 'text', readonly: true, value: url,
      style: { width: '100%', fontFamily: 'var(--mono)', fontSize: 'var(--t-s)' },
      onclick: e => e.target.select(),
    }))
  }
  renderPreviewLink(sec.previewToken)

  const probeOut = h('pre.code-out', { hidden: true })
  const logsOut = h('div')
  const loadLogs = async () => {
    const { lines } = await get('/logs/errors')
    logsOut.replaceChildren(lines.length
      ? h('div', {}, ...lines.slice(0, 20).map(l => h('div', { style: { fontSize: 'var(--t-xs)', fontFamily: 'var(--mono)', padding: 'var(--s0) 0', borderBottom: '1px solid var(--line-soft)' } },
        h('span.fnt', {}, `${(l.at || '').slice(5, 19)} `), h('strong', {}, l.path || ''), ` — ${l.error || l.raw || ''}`)))
      : h('p.mut', {}, 'No server errors logged. Good.'))
  }

  return h('div', {},
    h('div.card', { style: { marginBottom: 'var(--s4)' } },
      h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
        h('div', {}, h('strong', {}, 'Security'), h('p.sub', {}, 'Applied to every response. Balanced CSP suits most sites; strict switches inline scripts to nonces.')),
        h('button.btn.ghost.small', { onclick: doSave }, 'Save')),
      renderFields([
        { key: 'csp', type: 'select', label: 'Content-Security-Policy', options: [{ value: 'balanced' }, { value: 'strict' }, { value: 'off' }], width: 'half' },
        { key: 'frameAncestors', type: 'text', label: 'frame-ancestors', width: 'half' },
        { key: 'hsts', type: 'boolean', label: 'Send HSTS (only once HTTPS is everywhere)' },
        { key: 'auditLog', type: 'boolean', label: 'Keep an audit log of admin actions' },
        { key: 'errorLog', type: 'boolean', label: 'Log server errors to .blockhouse/logs (easier bug reports)' },
        { key: 'maxLoginAttempts', type: 'number', label: 'Failed logins before lockout', width: 'half' },
        { key: 'lockoutMinutes', type: 'number', label: 'Lockout minutes', width: 'half' },
        { key: 'minPasswordLength', type: 'number', label: 'Minimum password length', width: 'half' },
        { key: 'adminAllowlist', type: 'text', label: 'Admin IP allowlist', help: 'Comma-separated IPs or CIDRs. Blank = any network.' },
      ], vals, () => {})),

    h('div.card', { style: { marginBottom: 'var(--s4)' } },
      h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
        h('div', {}, h('strong', {}, 'Exposure'), h('p.sub', {}, 'Rename the studio path, lock a staging instance down, and self-check that nothing sensitive is reachable.')),
        h('button.btn.ghost.small', { onclick: doSave }, 'Save')),
      renderFields([
        { key: 'adminPath', type: 'text', label: 'Studio path', width: 'half', help: 'Default: admin. Rename to starve bots that hammer /admin — you sign in at /<path>/ after saving.' },
        { key: 'private', type: 'select', label: 'Who can view the site', options: [
          { value: 'off', label: 'Everyone (normal)' },
          { value: 'members', label: 'Members only (whole site behind sign-in)' },
          { value: 'staging', label: 'Staging — studio users only' },
        ], width: 'half', help: 'Staging keeps the studio reachable and hides everything else' },
        { key: 'privateRedirect', type: 'text', label: 'Staging: send visitors to', width: 'half', help: "e.g. https://www.example.com — blank shows the sign-in wall instead" },
      ], vals, () => {}),
      h('div', { style: { marginTop: 'var(--s3)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('strong', { style: { fontSize: 'var(--t-m)' } }, 'Shareable preview link'),
          h('button.btn.ghost.small', { onclick: async () => {
            const r = await post('/security/preview-link', {})
            renderPreviewLink(r.token)
          } }, iconEl('link', 13), sec.previewToken ? 'Rotate' : 'Create')),
        h('p.fnt', { style: { fontSize: 'var(--t-s)', margin: 'var(--s0) 0 var(--s2)' } },
          'Lets anyone with the link view a Staging-gated site without signing in — for handing to a client, or a tool that just needs to fetch a page once. Rotating invalidates the old one immediately.'),
        previewOut),
      h('div', { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center', marginTop: 'var(--s4)' } },
        h('button.btn.soft.small', { onclick: async e => {
          probeOut.hidden = false; probeOut.textContent = 'Probing…'
          const r = await post('/security/probe', {})
          probeOut.textContent = r.results.map(x => `${x.ok ? '✓' : '✗'} ${x.path} → ${x.status || x.error}`).join('\n') + `\n\n${r.advice}`
          probeOut.style.color = r.ok ? '' : 'var(--err-ink)'
        } }, iconEl('shield', 13), 'Probe my public URL for exposed files'),
        h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, 'Checks .blockhouse/, secure.db, site JSON, .git and .env from the outside.')),
      probeOut,
      h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s3)' } },
        'Running behind Cloudflare? Pair this with an Access rule on the studio path and a WAF rule blocking /.blockhouse* and /.git* — blockhouse already refuses to serve them, the rules are belt and braces.')),

    h('div.card', { style: { marginBottom: 'var(--s4)' } },
      h('div.page-head', { style: { marginBottom: 'var(--s2)' } },
        h('div', {}, h('strong', {}, 'Signed packages'), h('p.sub', {}, 'Ed25519 public keys of theme/plugin sellers you trust — installs verify against these.')),
        h('button.btn.ghost.small', { onclick: doSave }, 'Save')),
      renderFields([{ key: 'trustedIssuers', type: 'json', label: 'Trusted issuers', help: '{"studio.example": "<base64 public key>"}' }], vals, () => {})),

    h('div.card', {},
      h('div.page-head', { style: { marginBottom: 'var(--s2)' } },
        h('div', {}, h('strong', {}, 'Server error log')),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost.small', { onclick: loadLogs }, iconEl('refresh', 13), 'Refresh'),
          h('button.btn.ghost.small', { onclick: async () => { await del('/logs/errors'); loadLogs() } }, 'Clear'))),
      logsOut,
      (loadLogs(), '')))
}

// ---------- fonts / code / build sub-sections ----------

function fontsSection(s, save) {
  const fonts = s.fonts ? JSON.parse(JSON.stringify(s.fonts)) : []
  const list = h('div', { style: { display: 'grid', gap: 'var(--s2)', marginBottom: 'var(--s3)' } })
  const render = () => {
    list.replaceChildren(...fonts.map((f, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr 0.9fr auto', gap: 'var(--s2)', alignItems: 'center' } },
      h('input.input', { value: f.family || '', placeholder: 'Family name', style: { fontSize: 'var(--t-s)' }, oninput: e => (f.family = e.target.value) }),
      h('select.input', { style: { fontSize: 'var(--t-s)' }, onchange: e => (f.role = e.target.value || undefined) },
        h('option', { value: '' }, 'no role'),
        ...['body', 'display', 'mono'].map(r => h('option', { value: r, selected: f.role === r }, r))),
      h('input.input', { value: f.weight || 400, placeholder: 'weight', style: { fontSize: 'var(--t-s)' }, oninput: e => (f.weight = e.target.value) }),
      h('label.field-check', { style: { margin: 0 } }, h('input', { type: 'checkbox', checked: !!f.preload, onchange: e => (f.preload = e.target.checked) }), h('span', { style: { fontSize: 'var(--t-xs)' } }, 'preload')),
      h('button.icon-btn', { onclick: () => { fonts.splice(i, 1); render() }, html: icon('trash', 14) }))))
  }
  render()
  const fileInput = h('input', { type: 'file', accept: '.woff2,.woff,.ttf,.otf', style: { display: 'none' } })
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files[0]) return
    const fd = new FormData(); fd.append('file', fileInput.files[0])
    toast('Uploading font…')
    const r = await post('/fonts', fd)
    const fmt = /\.woff2$/i.test(r.name) ? 'woff2' : /\.woff$/i.test(r.name) ? 'woff' : 'truetype'
    fonts.push({ family: r.name.replace(/\.[^.]+$/, ''), file: r.file, weight: 400, style: 'normal', format: fmt, role: fonts.length ? undefined : 'display' })
    render(); toast('Font added — set a role and save', 'ok')
  })
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Fonts'), h('p.sub', {}, 'Upload woff2/woff/ttf — assign body/display/mono roles. Preloaded fonts avoid layout shift.')),
      h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
        h('button.btn.ghost.small', { onclick: () => fileInput.click() }, iconEl('upload', 14), 'Upload'),
        h('button.btn.ghost.small', { onclick: () => save({ fonts }) }, 'Save'))),
    list, fileInput)
}

function codeSection(s, save) {
  const vals = { customCss: s.customCss || '', customJs: s.customJs || '' }
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Custom code (site-wide)'), h('p.sub', {}, 'Injected on every page. Per-page code lives in the editor’s Page tab.')),
      h('button.btn.ghost.small', { onclick: () => save(vals) }, 'Save')),
    renderFields([
      { key: 'customCss', type: 'code', label: 'Global CSS', rows: 5 },
      { key: 'customJs', type: 'code', label: 'Global JavaScript (module)', rows: 5, help: 'Runs on the live site, not in preview' },
    ], vals, () => {}))
}

function buildSection(s, save) {
  const b = s.build || {}
  const vals = {
    trailingSlash: b.trailingSlash !== false, minify: !!b.minify,
    basePath: b.basePath || '', generateSearchIndex: b.generateSearchIndex !== false,
  }
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, 'Build & export')),
      h('button.btn.ghost.small', { onclick: () => save({ build: vals }) }, 'Save')),
    renderFields([
      { key: 'trailingSlash', type: 'boolean', label: 'Trailing-slash URLs (/about/)' },
      { key: 'minify', type: 'boolean', label: 'Minify exported HTML' },
      { key: 'generateSearchIndex', type: 'boolean', label: 'Generate search index on export' },
      { key: 'basePath', type: 'text', label: 'Base path', help: 'Deploy under a sub-path, e.g. /docs', width: 'half' },
    ], vals, () => {}))
}

// ---------- plugins (permission approval) ----------

/** What a role may not do, said out loud rather than left as an absence. */
export function permissionNote(what) {
  return h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s2)' } },
    `Your account (${state.user.role}) cannot ${what}. An owner or admin can change that under Apps & permissions.`)
}

registerView('plugins', async root => {
  const holder = h('div.cards', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(19rem, 1fr))' } })
  let all = []
  let q = ''
  const PLUGIN_TAGS = { forms: 'capture', files: 'delivery', drive: 'delivery', newsletter: 'audience', automations: 'glue', data: 'apps', search: 'site', analytics: 'insight', ai: 'assist', integrations: 'glue', members: 'audience', consent: 'compliance', commerce: 'selling', mdsync: 'content' }

  const openPlugin = p => {
    const enabled = h('input', { type: 'checkbox', checked: p.state.enabled })
    const permChecks = p.permissions.map(perm => {
      const cb = h('input', { type: 'checkbox', checked: p.state.approved.includes(perm) || p.state.approved.includes('*') })
      return { perm, cb, row: h('label.field-check', { title: perm }, cb, h('span', {}, h('code.pill-perm', {}, perm), ' ', p.permissionInfo[perm] || '')) }
    })
    dialog({
      title: p.name,
      width: 'min(36rem, 94vw)',
      body: h('div', {},
        h('p.dlg-text', {}, p.description || '', ` · v${p.version}`),
        h('label.field-check', { style: { margin: 'var(--s2) 0' } }, enabled, h('span', {}, h('strong', {}, 'Enabled'))),
        h('div.insp-section-title', {}, `Permissions — approve only what it should touch`),
        ...permChecks.map(x => x.row),
        h('button.btn.ghost.small', { style: { marginTop: 'var(--s2)' }, onclick: () => permChecks.forEach(x => (x.cb.checked = true)) }, 'Approve all')),
      actions: [{
        label: 'Save', kind: 'primary', onClick: async () => {
          await patch(`/plugins/${p.id}`, { enabled: enabled.checked, approved: permChecks.filter(x => x.cb.checked).map(x => x.perm) })
          toast('Saved — restart the server to apply', 'ok', 4500)
          refresh(); return true
        },
      }],
    })
  }

  const paint = () => {
    const needle = q.trim().toLowerCase()
    const list = all.filter(p => !needle || `${p.id} ${p.name} ${p.description} ${PLUGIN_TAGS[p.id] || ''}`.toLowerCase().includes(needle))
    holder.replaceChildren(...list.map(p => h('button.card.plug-card', { onclick: () => openPlugin(p) },
      h('div', { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'center', marginBottom: 'var(--s1)' } },
        h('span.row-ico', { html: icon(p.state.enabled ? 'plug' : 'lock', 17) }),
        h('strong', {}, p.name),
        h('span', { style: { flex: 1 } }),
        p.state.enabled
          ? h('span.mrow-tag', { style: { background: 'color-mix(in oklch, var(--ok) 18%, transparent)' } }, 'on')
          : h('span.mrow-tag', {}, 'off')),
      h('p.fnt', { style: { fontSize: 'var(--t-s)', minHeight: '2.2em' } }, p.description || ''),
      h('div', { style: { display: 'flex', gap: 'var(--s1)', alignItems: 'center', marginTop: 'var(--s2)' } },
        h('span.pill-perm', {}, PLUGIN_TAGS[p.id] || 'plugin'),
        h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, `v${p.version} · ${p.state.approved.length}/${p.permissions.length} perms`))),
    ), list.length ? '' : emptyState(icon('plug', 24), 'No plugins match', 'Clear the search, or install one below.'))
  }
  const refresh = async () => { ;({ plugins: all } = await get('/plugins')); paint() }

  const search = h('input.input', { type: 'search', placeholder: 'Search plugins…', style: { width: '15rem' }, oninput: e => { q = e.target.value; paint() } })
  const installBtn = h('button.btn.ghost.small', {
    onclick: () => {
      const file = h('input', { type: 'file', accept: '.zip' })
      const lic = h('input.input', { placeholder: 'Licence key (if the seller gave you one)' })
      dialog({
        title: 'Install a plugin package',
        width: 'min(30rem, 94vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'A blockhouse package is a zip with an index.ts and a blockhouse-package.json manifest. Checksums are verified on install; signed packages verify against your trusted issuers (Settings → Security).'),
          h('div.field', {}, h('label', {}, 'Package (.zip)'), file),
          h('div.field', {}, h('label', {}, 'Licence key'), lic)),
        actions: [{
          label: 'Install', kind: 'primary', onClick: async () => {
            if (!file.files[0]) { toast('Choose a package zip', 'err'); return false }
            const fd = new FormData()
            fd.append('file', file.files[0])
            if (lic.value) fd.append('licenseKey', lic.value)
            const r = await post('/pluginpkgs/install', fd)
            toast(r.problems?.length ? `Installed with warnings: ${r.problems[0]}` : 'Installed — restart the server, then approve its permissions', r.problems?.length ? 'err' : 'ok', 6000)
            return true
          },
        }],
      })
    },
  }, iconEl('upload', 13), 'Install plugin')

  root.replaceChildren(h('div.main', {}, h('div.main-pad', {},
    h('div.page-head', {},
      h('div', {}, h('h1', {}, 'Apps & permissions'), h('p.sub', {}, 'An ecosystem, not a wall of switches: search, click a card for details, approve only the capabilities it should have. Installed packages are checksum-verified.')),
      h('div', { style: { display: 'flex', gap: 'var(--s2)' } }, search, installBtn)),
    holder)))
  refresh()
})

// ---------- generic plugin panel (resources + custom sections) ----------

registerView('pluginPanel', async (root, [panelKey]) => {
  const meta = state.meta
  const panel = meta.panels.find(p => p.key === panelKey)
  if (!panel) { location.hash = '#/'; return }
  const main = h('div.main-pad', { style: { maxWidth: '72rem' } })

  main.appendChild(h('div.page-head', {}, h('div', {}, h('h1', {}, panel.label))))

  const custom = CUSTOM_SECTIONS[panel.plugin]
  if (!custom?.replaces) {
    for (const res of panel.resources || []) main.appendChild(await resourceSection(panel, res))
  }
  if (custom) main.appendChild(await custom())

  root.replaceChildren(h('div.main', {}, main))
})

async function resourceSection(panel, res) {
  const base = `/res/${panel.plugin}/${res.key}`
  const holder = h('div')
  const refresh = async () => {
    const { items } = await get(base)
    holder.replaceChildren(items.length ? h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, res.labelSingular || 'Item'), h('th', {}, 'ID'), h('th', {}, ''))),
      h('tbody', {}, ...items.map(item => h('tr', { onclick: () => editItem(item) },
        h('td', {}, String(item[res.titleField || 'label'] || item.id)),
        h('td.mut.mono', { style: { fontSize: 'var(--t-xs)' } }, item.id),
        h('td', { style: { textAlign: 'right' } }, h('button.icon-btn', {
          onclick: async e => { e.stopPropagation(); if (await confirmDialog('Delete', `Delete ${item.id}?`)) { await del(`${base}/${item.id}`); refresh() } },
        }, iconEl('trash', 14))))))))
      : emptyState(icon('folder', 26), `No ${res.label.toLowerCase()} yet`, ''))
  }
  const editItem = (item = null) => {
    const vals = item ? JSON.parse(JSON.stringify(item)) : {}
    dialog({
      title: item ? `Edit ${res.labelSingular || 'item'}` : `New ${res.labelSingular || 'item'}`,
      width: 'min(38rem, 94vw)',
      body: renderFields(res.fields, vals, () => {}),
      actions: [{
        label: 'Save', kind: 'primary', onClick: async () => {
          if (item) await put(`${base}/${item.id}`, vals)
          else await post(base, vals)
          refresh(); return true
        },
      }],
    })
  }
  refresh()
  return h('div.card', { style: { marginBottom: 'var(--s4)' } },
    h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
      h('div', {}, h('strong', {}, res.label)),
      h('button.btn.primary.small', { onclick: () => editItem(null) }, `＋ New`)),
    holder)
}

// custom per-plugin sections that go beyond generic CRUD
const CUSTOM_SECTIONS = {
  drive: Object.assign(async () => {
    const wrap = h('div')
    const draw = async () => {
      const [{ areas }, { requests }, { recent, top }] = await Promise.all([
        get('/x/drive/areas'), get('/x/drive/requests'), get('/x/drive/activity')])
      const pending = requests.filter(r => r.status === 'pending')
      const groups = state.meta.memberGroups || []
      const editArea = (a = null) => {
        const vals = a ? { ...a, groups: (a.groups || []).join(', ') } : { id: '', label: '', description: '', groups: '', requestable: true }
        dialog({
          title: a ? `Edit ${a.label}` : 'New document area',
          body: renderFields([
            { key: 'id', type: 'text', label: 'Id (slug)', width: 'half', help: a ? 'Cannot change' : 'e.g. technical' },
            { key: 'label', type: 'text', label: 'Label', width: 'half' },
            { key: 'description', type: 'textarea', label: 'Description', rows: 2 },
            { key: 'groups', type: 'text', label: 'Member groups with access', help: groups.length ? `Blank = any signed-in member. Available: ${groups.map(g => g.id || g).join(', ')}` : 'Blank = any signed-in member' },
            { key: 'requestable', type: 'boolean', label: 'Visitors may request access' },
          ], vals, () => {}),
          actions: [{ label: 'Save', kind: 'primary', onClick: async () => {
            const id = (a?.id || vals.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!id) { toast('Give the area an id', 'err'); return false }
            await put(`/x/drive/areas/${id}`, { ...vals, groups: String(vals.groups).split(',').map(s => s.trim()).filter(Boolean) })
            draw(); return true
          } }],
        })
      }
      wrap.replaceChildren(
        pending.length ? h('div.card', { style: { marginBottom: 'var(--s4)', borderColor: 'var(--warn)' } },
          h('strong', {}, `Access requests (${pending.length})`),
          ...pending.map(r => h('div', { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'center', padding: 'var(--s2) 0', borderBottom: '1px solid var(--line-soft)', fontSize: 'var(--t-m)' } },
            h('div', { style: { flex: 1 } }, h('strong', {}, r.email), ` · ${r.role || '—'}${r.company ? ` @ ${r.company}` : ''} → ${r.areaLabel}`,
              r.note ? h('div.fnt', { style: { fontSize: 'var(--t-s)' } }, `“${r.note}”`) : ''),
            h('button.btn.primary.small', { onclick: async () => { await post(`/x/drive/requests/${r.id}/approve`, {}); toast('Approved — they can sign in now', 'ok'); draw() } }, 'Approve'),
            h('button.btn.ghost.small', { onclick: async () => { await post(`/x/drive/requests/${r.id}/decline`, {}); draw() } }, 'Decline')))) : '',
        h('div.card', { style: { marginBottom: 'var(--s4)' } },
          h('div.page-head', { style: { marginBottom: 'var(--s2)' } }, h('strong', {}, 'Document areas'),
            h('button.btn.ghost.small', { onclick: () => editArea() }, iconEl('plus', 13), 'New area')),
          ...areas.map(a => h('div', { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'center', padding: 'var(--s2) 0', borderBottom: '1px solid var(--line-soft)', fontSize: 'var(--t-m)' } },
            h('span.row-ico', { html: icon('folder', 15) }),
            h('div', { style: { flex: 1 } }, h('strong', {}, a.label),
              h('div.fnt', { style: { fontSize: 'var(--t-s)' } }, `${a.fileCount} files · ${a.groups.length ? `groups: ${a.groups.join(', ')}` : 'any signed-in member'} · upload under Assets → private/drive/${a.id}`)),
            h('button.btn.ghost.small', { onclick: () => editArea(a) }, 'Edit'),
            h('button.icon-btn', { onclick: async () => { if (await confirmDialog('Delete area', `Remove “${a.label}”? Files stay on disk.`)) { await del(`/x/drive/areas/${a.id}`); draw() } } }, iconEl('trash', 13)))),
          h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s2)' } }, 'Put a “Document portal” block on a page (e.g. /downloads) — visitors request access there, members see their files.')),
        h('div.cards', {},
          h('div.card', {}, h('strong', {}, 'Most downloaded'),
            top.length ? h('div', { style: { marginTop: 'var(--s2)' } }, ...top.map(t => h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--t-s)', padding: 'var(--s0) 0' } }, h('span', {}, t.file), h('strong', {}, String(t.n))))) : h('p.mut', {}, 'No downloads yet.')),
          h('div.card', {}, h('strong', {}, 'Recent activity'),
            recent.length ? h('div', { style: { marginTop: 'var(--s2)' } }, ...recent.slice(0, 8).map(r => h('div', { style: { fontSize: 'var(--t-s)', padding: 'var(--s0) 0' } }, `${r.email} ↓ ${r.file}`))) : h('p.mut', {}, 'Quiet so far.'))))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  commerce: Object.assign(async () => {
    const wrap = h('div')
    const CHIP = { new: 'draft', 'awaiting-payment': 'review', paid: 'published', fulfilled: 'published', cancelled: 'draft', refunded: 'draft' }
    const draw = async () => {
      const [{ orders }, sum] = await Promise.all([get('/x/commerce/orders'), get('/x/commerce/summary')])
      wrap.replaceChildren(
        h('div.cards', { style: { marginBottom: 'var(--s4)' } },
          h('div.card.stat', {}, h('span.n', {}, String(sum.orders)), h('span.l', {}, 'Orders')),
          h('div.card.stat', {}, h('span.n', {}, String(sum.paid)), h('span.l', {}, 'Paid')),
          h('div.card.stat', {}, h('span.n', {}, `${sum.currency === 'GBP' ? '£' : sum.currency === 'EUR' ? '€' : '$'}${sum.revenue.toLocaleString()}`), h('span.l', {}, 'Revenue'))),
        h('div.card', {},
          h('div.page-head', { style: { marginBottom: 'var(--s2)' } }, h('strong', {}, 'Orders'),
            h('a.btn.ghost.small', { href: '#/settings/pluginsx' }, 'Commerce settings')),
          orders.length ? h('div.table-wrap', {}, h('table.data-table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Customer'), h('th', {}, 'Items'), h('th.num', {}, 'Total'), h('th', {}, 'Status'), h('th'))),
            h('tbody', {}, ...orders.map(o => h('tr', {},
              h('td.mono', { style: { fontSize: 'var(--t-xs)' } }, o.id.slice(-6)),
              h('td', {}, o.email, o.company ? h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, o.company) : ''),
              h('td', {}, (o.lines || []).map(l => `${l.qty}× ${l.title}`).join(', ').slice(0, 60)),
              h('td.num', {}, `${o.currency === 'GBP' ? '£' : ''}${o.total}`),
              h('td', {}, h('span.chip', { class: CHIP[o.status] || 'draft' }, o.status)),
              h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
                ...['paid', 'fulfilled', 'cancelled'].filter(s2 => s2 !== o.status).map(s2 =>
                  h('button.btn.ghost.small', { style: { marginLeft: 'var(--s1)' }, onclick: async () => { await post(`/x/commerce/orders/${o.id}/status`, { to: s2 }); draw() } }, s2))))))))
            : emptyState(icon('cart', 24), 'No orders yet', 'Put “Add to cart” blocks on product pages and a “Cart & checkout” block on /cart.')),
        h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s3)' } },
          'Orders fire commerce.order.created / .paid / .fulfilled — point Automations at them for receipts, CRM sync or fulfilment. Stripe webhook endpoint: /x/commerce/stripe.'))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  mdsync: Object.assign(async () => {
    const wrap = h('div')
    const draw = async () => {
      const { last, tracked } = await get('/x/mdsync/status')
      const file = h('input', { type: 'file', accept: '.zip' })
      const out = h('pre.code-out', { hidden: true })
      const runSync = async fd => {
        out.hidden = false; out.textContent = 'Syncing…'
        try {
          const r = await post('/x/mdsync/sync', fd || {})
          if (r.error) { out.textContent = `✗ ${r.error}`; return }
          out.textContent = ['created', 'updated', 'unchanged', 'pruned', 'skipped']
            .map(k => `${k}: ${r.report[k].length}${r.report[k].length && k !== 'unchanged' ? ' — ' + r.report[k].slice(0, 5).join(', ') : ''}`).join('\n')
          toast('Sync finished', 'ok'); draw()
        } catch (e) { out.textContent = `✗ ${e.message}` }
      }
      wrap.replaceChildren(
        h('div.card', {},
          h('strong', {}, 'Markdown → site'),
          h('p.fnt', { style: { fontSize: 'var(--t-s)', margin: 'var(--s1) 0 var(--s3)' } },
            `Tracking ${tracked} file(s). ${last ? `Last sync ${fmtDate(last.at)} — ${Object.entries(last.report).map(([k, v]) => `${v} ${k}`).join(', ')}.` : 'Never synced.'} Frontmatter (title, slug, category…) becomes fields; the body becomes the page. Configure the folder + content type under Settings → Plugin settings.`),
          h('div', { style: { display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center' } },
            h('button.btn.primary.small', { onclick: () => runSync() }, iconEl('refresh', 13), 'Sync configured folder'),
            h('span.fnt', {}, 'or'),
            file,
            h('button.btn.ghost.small', { onclick: () => {
              if (!file.files[0]) { toast('Choose a zip of .md files', 'err'); return }
              const fd = new FormData(); fd.append('file', file.files[0]); runSync(fd)
            } }, iconEl('upload', 13), 'Sync from zip')),
          out))
    }
    await draw()
    return wrap
  }, { replaces: true }),

  automations: Object.assign(async () => {
    const EVENTS = [
      ['form.submitted', 'A form was submitted', '{"formId":"contact","data":{"email":"jane@example.com","message":"Hello"}}'],
      ['content.published', 'Content was published', '{"docId":"d-home","concept":"page"}'],
      ['content.created', 'Content was created', '{"docId":"d-new","concept":"post","user":"u1"}'],
      ['member.registered', 'A member signed up', '{"memberId":"m1","email":"new@example.com"}'],
      ['newsletter.subscribed', 'Newsletter signup', '{"email":"reader@example.com","listId":"default"}'],
      ['commerce.order.created', 'An order was placed', '{"orderId":"o1","email":"buyer@example.com","total":890,"currency":"GBP"}'],
      ['commerce.order.paid', 'An order was paid', '{"orderId":"o1","email":"buyer@example.com","total":890,"currency":"GBP"}'],
      ['drive.access.requested', 'Drive access requested', '{"email":"arch@firm.example","area":"technical","role":"Architect"}'],
      ['drive.download', 'A portal file was downloaded', '{"email":"arch@firm.example","area":"technical","file":"spec.pdf"}'],
      ['data.row.created', 'A data row was added', '{"table":"quotes","id":"r1"}'],
      ['data.state.changed', 'A workflow moved', '{"table":"quotes","id":"r1","from":"review","to":"approved"}'],
      ['file.downloaded', 'A delivery link was used', '{"file":"welcome-pack.md"}'],
      ['webhook.received', 'An inbound webhook fired', '{"key":"crm","body":{"lead":"Jane"}}'],
      ['media.uploaded', 'An asset was uploaded', '{"mediaId":"m1","name":"hero.jpg"}'],
      ['user.created', 'A studio user was created', '{"userId":"u2","role":"author"}'],
    ]
    const { actions } = await get('/x/automations/actions').catch(() => ({ actions: [] }))
    const wrap = h('div')

    const listHolder = h('div', {}, skeleton('rows', 5))
    const runsHolder = h('div', {}, skeleton('rows', 4))

    const refreshList = async () => {
      const { items } = await get('/res/automations/recipes')
      listHolder.replaceChildren(
        items.length ? h('div', { style: { display: 'grid', gap: 'var(--s2)' } }, ...items.map(r => h('div.card', { style: { padding: 'var(--s3) var(--s4)', display: 'flex', alignItems: 'center', gap: 'var(--s4)' } },
          h('label.switch', { title: r.enabled ? 'On' : 'Off' },
            h('input', { type: 'checkbox', checked: !!r.enabled, onchange: async e => { await post('/res/automations/recipes', { ...r, enabled: e.target.checked }); toast(e.target.checked ? 'Recipe on' : 'Recipe off', 'ok') } }),
            h('span.switch-track')),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('strong', { style: { fontSize: 'var(--t-m)' } }, r.label || r.id),
            h('div.fnt', { style: { fontSize: 'var(--t-s)' } }, 'when ', h('code.pill-perm', {}, r.on || '—'), ` → ${(r.actions || []).length} step(s): `, (r.actions || []).map(a => a.type).join(' → ') || 'none')),
          h('button.btn.ghost.small', { onclick: () => openBuilder(r) }, 'Edit'),
          h('button.icon-btn', { title: 'Delete', onclick: async () => { if (await confirmDialog('Delete recipe?', `“${r.label}” stops running immediately.`)) { await del(`/res/automations/recipes/${r.id}`); refreshList() } }, html: icon('trash', 13) }))))
          : emptyState(icon('bolt', 26), 'No recipes yet', 'When something happens on the site, do something about it — automatically.'))
    }

    const refreshRuns = async () => {
      const { items } = await get('/x/automations/runs').catch(() => ({ items: [] }))
      runsHolder.replaceChildren(items.length
        ? h('div', { style: { display: 'grid', gap: 'var(--s1)' } }, ...items.slice(0, 30).map(row => {
          const run = row.data || row
          const failed = (run.steps || []).some(st => st.error)
          return h('details.card', { style: { padding: 'var(--s2) var(--s4)' } },
            h('summary', { style: { cursor: 'pointer', display: 'flex', gap: 'var(--s3)', alignItems: 'center', fontSize: 'var(--t-s)' } },
              h('span', { style: { color: failed ? 'var(--err-ink)' : 'var(--ok-ink)', display: 'inline-flex' }, html: icon(failed ? 'x' : 'check', 13) }),
              h('strong', {}, run.label || run.recipe || 'run'),
              run.test ? h('span.mrow-tag', {}, 'test') : '',
              h('code.pill-perm', {}, run.event || ''),
              h('span.fnt', { style: { marginLeft: 'auto', fontSize: 'var(--t-xs)' } }, `${run.ms ?? '—'}ms · ${fmtDate(row.createdAt)}`)),
            h('div', { style: { marginTop: 'var(--s2)', display: 'grid', gap: 'var(--s1)' } },
              ...(run.steps || []).map(st => h('div', { style: { fontSize: 'var(--t-s)', display: 'flex', gap: 'var(--s2)', alignItems: 'baseline' } },
                h('code.pill-perm', {}, st.type),
                st.error ? h('span', { style: { color: 'var(--err-ink)' } }, st.error)
                  : h('span.mut', {}, st.result ? JSON.stringify(st.result).slice(0, 160) : 'ok')))))
        }))
        : h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'No runs yet — they appear here the moment a recipe fires (test runs included).'))
    }

    function openBuilder(existing) {
      const r = existing ? JSON.parse(JSON.stringify(existing)) : { label: '', on: 'form.submitted', filter: '', actions: [], enabled: true }
      r.actions ??= []
      let payloadText = (EVENTS.find(ev => ev[0] === r.on)?.[2]) || '{}'
      const stepsHolder = h('div', { style: { display: 'grid', gap: 'var(--s2)' } })
      const testOut = h('div')

      const paintSteps = () => {
        stepsHolder.replaceChildren(
          ...r.actions.map((a, i) => {
            const def = actions.find(x => x.type === a.type)
            const opts = typeof a.options === 'string' ? (JSON.parse(a.options || '{}') || {}) : (a.options ??= {})
            a.options = opts
            return h('div.card', { style: { padding: 'var(--s3) var(--s4)' } },
              h('div', { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center', marginBottom: 'var(--s2)' } },
                h('span.step-n', {}, String(i + 1)),
                h('select.input', {
                  style: { flex: 1, fontSize: 'var(--t-m)' },
                  onchange: e => { a.type = e.target.value; a.options = {}; paintSteps() },
                }, ...actions.map(x => h('option', { value: x.type, selected: a.type === x.type }, x.label))),
                h('button.icon-btn', { title: 'Move up', onclick: () => { if (i > 0) { r.actions.splice(i - 1, 0, r.actions.splice(i, 1)[0]); paintSteps() } }, html: icon('back', 12, 'rot90') }),
                h('button.icon-btn', { title: 'Remove step', onclick: () => { r.actions.splice(i, 1); paintSteps() }, html: icon('trash', 13) })),
              def?.fields?.length
                ? renderFields(def.fields.map(f => ({ ...f, type: f.type === 'json' ? 'json' : f.type || 'text' })), opts, () => {})
                : renderFields([{ key: '__json', type: 'json', label: 'Options (JSON)' }], { __json: opts }, (k, v) => { if (v && typeof v === 'object') a.options = v }))
          }),
          h('button.tree-add', { onclick: () => { r.actions.push({ type: actions[0]?.type || 'log', options: {} }); paintSteps() } }, '＋ Add step'))
      }

      // variable chips — click to drop {{event.x}} into the last-focused input.
      // The whole point: nobody should have to guess what the payload holds.
      let lastInput = null
      stepsHolder.addEventListener('focusin', e => {
        if (e.target.matches('input[type=text], input:not([type]), textarea')) lastInput = e.target
      })
      const varChips = h('div', { style: { display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', marginTop: 'var(--s2)' } })
      const paintVars = () => {
        let payload = {}
        try { payload = JSON.parse(payloadText || '{}') } catch {}
        const paths = []
        const walk = (obj, prefix) => {
          for (const [k, v] of Object.entries(obj || {})) {
            const p2 = prefix ? `${prefix}.${k}` : k
            if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p2)
            else paths.push(p2)
          }
        }
        walk(payload, '')
        varChips.replaceChildren(
          h('span.fnt', { style: { fontSize: 'var(--t-xs)' } }, 'Insert into a step: '),
          ...paths.slice(0, 12).map(p2 => h('button.pill-perm', {
            style: { cursor: 'pointer' },
            title: `Insert {{event.${p2}}} into the focused field`,
            onclick: () => {
              const token = `{{event.${p2}}}`
              if (lastInput) {
                const st = lastInput.selectionStart ?? lastInput.value.length
                lastInput.value = lastInput.value.slice(0, st) + token + lastInput.value.slice(lastInput.selectionEnd ?? st)
                lastInput.dispatchEvent(new Event('input', { bubbles: true }))
                lastInput.focus()
              } else { navigator.clipboard?.writeText(token); toast(`Copied ${token}`, 'ok', 1500) }
            },
          }, `{{event.${p2}}}`)))
      }

      const payloadArea = h('textarea.input.mono', { rows: 5, value: payloadText, oninput: e => { payloadText = e.target.value; paintVars() } })
      const evSelect = h('select.input', {
        style: { fontSize: 'var(--t-m)' },
        onchange: e => {
          r.on = e.target.value
          const sample = EVENTS.find(ev => ev[0] === r.on)?.[2]
          if (sample) { payloadText = sample; payloadArea.value = sample }
          paintVars()
        },
      },
        ...EVENTS.map(([ev, label]) => h('option', { value: ev, selected: r.on === ev }, `${label}  (${ev})`)),
        h('option', { value: r.on, selected: !EVENTS.some(ev => ev[0] === r.on), hidden: EVENTS.some(ev => ev[0] === r.on) }, r.on))

      const doDry = async () => {
        let payload
        try { payload = JSON.parse(payloadText || '{}') } catch { toast('Sample payload is not valid JSON', 'err'); return }
        const res = await post('/x/automations/dryrun', { recipe: r, payload })
        testOut.replaceChildren(
          h('p', { style: { fontSize: 'var(--t-s)', margin: 'var(--s2) 0 var(--s1)' } },
            'Condition: ', res.condition ? h('strong', { style: { color: 'var(--ok-ink)' } }, 'matches — recipe would run') : h('strong', { style: { color: 'var(--warn-ink)' } }, 'does not match — recipe would be skipped')),
          ...res.steps.map((st, i) => h('div.card', { style: { padding: 'var(--s2) var(--s3)', marginBottom: 'var(--s1)' } },
            h('div', { style: { fontSize: 'var(--t-s)', fontWeight: 'var(--fw-semi)', marginBottom: 'var(--s0)' } }, `${i + 1}. ${st.label}`, st.known ? '' : h('span', { style: { color: 'var(--err-ink)' } }, '  (unknown action!)')),
            h('pre.code-out', { style: { fontSize: 'var(--t-xs)', margin: 0, whiteSpace: 'pre-wrap' } }, JSON.stringify(st.resolved, null, 1)))))
      }
      const doTest = async () => {
        let payload
        try { payload = JSON.parse(payloadText || '{}') } catch { toast('Sample payload is not valid JSON', 'err'); return }
        testOut.replaceChildren(h('div.spin'))
        const { run } = await post('/x/automations/testrun', { recipe: r, payload })
        const failed = (run.steps || []).some(st => st.error)
        testOut.replaceChildren(
          h('p', { style: { fontSize: 'var(--t-m)', margin: 'var(--s2) 0 var(--s1)', fontWeight: 'var(--fw-semi)', color: failed ? 'var(--err-ink)' : 'var(--ok-ink)' } },
            failed ? 'Ran with errors' : `Ran clean in ${run.ms}ms`),
          ...(run.steps || []).map(st => h('div', { style: { fontSize: 'var(--t-s)', display: 'flex', gap: 'var(--s2)' } },
            h('code.pill-perm', {}, st.type),
            st.error ? h('span', { style: { color: 'var(--err-ink)' } }, st.error) : h('span.mut', {}, st.result ? JSON.stringify(st.result).slice(0, 140) : 'ok'))))
        refreshRuns()
      }

      paintVars()
      dialog({
        title: existing ? 'Edit recipe' : 'New recipe',
        width: 'min(46rem, 96vw)',
        body: h('div', {},
          renderFields([{ key: 'label', type: 'text', label: 'Name', required: true }], r, () => {}),
          h('div.field', {}, h('label', {}, h('span', {}, 'When this happens'), h('span.help', {}, 'The trigger event')), evSelect, varChips),
          renderFields([{ key: 'filter', type: 'json', label: 'Only if (filter)', help: 'Payload must match, e.g. {"formId":"contact"} — blank runs always' }], r, () => {}),
          h('div.insp-section-title', { style: { marginTop: 'var(--s4)' } }, 'Do these steps'),
          stepsHolder,
          h('details', { style: { marginTop: 'var(--s4)' } },
            h('summary', { style: { cursor: 'pointer', fontSize: 'var(--t-m)', fontWeight: 'var(--fw-semi)', color: 'var(--mut)' } }, 'Test before saving'),
            h('div.field', { style: { marginTop: 'var(--s2)' } }, h('label', {}, h('span', {}, 'Sample payload'), h('span.help', {}, 'What the event would deliver')), payloadArea),
            h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
              h('button.btn.ghost.small', { onclick: doDry }, iconEl('eye', 13), 'Preview steps (no side effects)'),
              h('button.btn.soft.small', { onclick: doTest }, iconEl('play', 13), 'Run for real')),
            testOut)),
        actions: [{
          label: 'Save recipe', kind: 'primary', onClick: async () => {
            if (!r.label) { toast('Give the recipe a name', 'err'); return false }
            await post('/res/automations/recipes', r)
            refreshList(); return true
          },
        }],
      })
      paintSteps()
    }

    const hooksHolder = h('div')
    const refreshHooks = async () => {
      const { hooks } = await get('/x/automations/hooks').catch(() => ({ hooks: {} }))
      const entries = Object.entries(hooks || {})
      hooksHolder.replaceChildren(
        h('p.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s2)' } }, 'Inbound URLs — POST JSON at them from anywhere (Zapier, CRMs, CI) to fire ', h('code.pill-perm', {}, 'webhook.received'), ' recipes.'),
        ...entries.map(([k, secret]) => h('div', { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center', fontSize: 'var(--t-s)', marginBottom: 'var(--s1)' } },
          h('code.pill-perm', {}, k),
          h('code', { style: { fontSize: 'var(--t-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, `${state.meta.site.url}/x/automations/hook/${k}?s=${secret}`),
          h('button.icon-btn', { title: 'Copy URL', onclick: () => { navigator.clipboard?.writeText(`${state.meta.site.url}/x/automations/hook/${k}?s=${secret}`); toast('Copied', 'ok') }, html: icon('copy', 13) }))),
        h('button.btn.ghost.small', {
          onclick: async () => {
            const key = prompt('Hook key (a-z, 0-9, dashes):', 'crm')
            if (!key) return
            await post('/x/automations/hooks', { key })
            refreshHooks()
          },
        }, '＋ New inbound hook'))
    }

    wrap.replaceChildren(
      h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
        h('div', {}, h('p.sub', {}, 'When something happens on the site, do something about it. Preview any recipe against a sample payload before it ever runs for real.')),
        h('button.btn.primary', { onclick: () => openBuilder(null) }, '＋ New recipe')),
      listHolder,
      h('h2', { style: { fontSize: 'var(--t-l)', margin: 'var(--s5) 0 var(--s2)' } }, 'Inbound webhooks'),
      h('div.card', { style: { padding: 'var(--s4) var(--s4)' } }, hooksHolder),
      h('h2', { style: { fontSize: 'var(--t-l)', margin: 'var(--s5) 0 var(--s2)' } }, 'Recent runs'),
      runsHolder)
    refreshList(); refreshRuns(); refreshHooks()
    return wrap
  }, { replaces: true }),

  forms: async () => {
    const holder = h('div')
    const { items } = await get('/x/forms/submissions').catch(() => ({ items: [] }))
    holder.replaceChildren(items.length ? h('div.table-wrap', {}, h('table.data-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Form'), h('th', {}, 'Data'), h('th', {}, 'When'))),
      h('tbody', {}, ...items.slice(0, 100).map(sItem => h('tr', {},
        h('td', {}, sItem.form), h('td.mono', { style: { fontSize: 'var(--t-s)', whiteSpace: 'pre-wrap' } }, JSON.stringify(sItem.data)),
        h('td.fnt', {}, fmtDate(sItem.createdAt)))))))
      : emptyState(icon('form', 26), 'No submissions yet', ''))
    return h('div.card', {}, h('strong', {}, 'Submissions'), h('div', { style: { marginTop: 'var(--s3)' } }, holder))
  },

  files: async () => {
    const list = h('div')
    const linkOut = h('div')
    const refresh = async () => {
      const [{ files }, { links }] = await Promise.all([get('/x/files/files'), get('/x/files/links')])
      list.replaceChildren(
        h('p.sub', { style: { marginBottom: 'var(--s2)' } }, 'Files in the private area (upload via Media with “private”, or drop into media/private/):'),
        files.length ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Size'), h('th', {}, ''))),
          h('tbody', {}, ...files.map(f => h('tr', {},
            h('td.mono', { style: { fontSize: 'var(--t-s)' } }, f.key), h('td.mut', {}, humanSize(f.size)),
            h('td', { style: { textAlign: 'right' } }, h('button.btn.soft.small', { onclick: () => issue(f.key) }, 'Create link')))))))
          : emptyState(icon('download', 26), 'No private files yet', 'Upload to media/private/ to deliver files securely.'),
        links.length ? h('div', { style: { marginTop: 'var(--s4)' } }, h('strong', {}, 'Active links'),
          h('div.table-wrap', { style: { marginTop: 'var(--s2)' } }, h('table.data-table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Label'), h('th', {}, 'Uses'), h('th', {}, 'Signatures'), h('th', {}, ''))),
            h('tbody', {}, ...links.map(l => h('tr', {},
              h('td', {}, l.label, h('div.row-sub', {}, l.file)),
              h('td', {}, `${l.uses}${l.maxUses ? `/${l.maxUses}` : ''}`),
              h('td.mut', {}, (l.signatures || []).map(sg => sg.name).join(', ') || '—'),
              h('td', { style: { textAlign: 'right' } }, h('button.icon-btn', { onclick: async () => { await del(`/x/files/links/${l.id}`); refresh() } }, iconEl('trash', 14))))))))) : '')
    }
    const issue = file => {
      const vals = { file, label: file, oneTime: false, expiresDays: 7, requireSignature: false, email: '' }
      dialog({
        title: 'Create delivery link',
        body: [renderFields([
          { key: 'label', type: 'text', label: 'Label' },
          { key: 'expiresDays', type: 'number', label: 'Expires (days)', width: 'half' },
          { key: 'oneTime', type: 'boolean', label: 'One-time link', width: 'half' },
          { key: 'requireSignature', type: 'boolean', label: 'Require name + signature before download' },
          { key: 'email', type: 'text', label: 'Email it to (optional)' },
        ], vals, () => {}), linkOut],
        actions: [{
          label: 'Create link', kind: 'primary', onClick: async () => {
            const r = await post('/x/files/links', vals)
            linkOut.replaceChildren(h('p.dlg-text', {}, 'Share this URL:'), h('div.code-out', {}, r.url))
            refresh()
            return false // keep dialog open so the URL can be copied
          },
        }],
      })
    }
    refresh()
    return h('div.card', {}, h('strong', {}, 'Private files & delivery links'), h('div', { style: { marginTop: 'var(--s3)' } }, list))
  },

  newsletter: async () => {
    const listSel = h('select.input', { style: { maxWidth: '14rem' } })
    const out = h('div')
    const { items: lists } = await get('/res/newsletter/lists').catch(() => ({ items: [] }))
    listSel.replaceChildren(...lists.map(l => h('option', { value: l.id }, l.label)))
    const refresh = async () => {
      if (!listSel.value) { out.replaceChildren(emptyState(icon('mail', 26), 'Create a list above first', '')); return }
      const { items } = await get(`/x/newsletter/subscribers?list=${listSel.value}`)
      out.replaceChildren(h('div.table-wrap', {}, h('table.data-table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Status'), h('th', {}, 'Since'))),
        h('tbody', {}, ...items.map(sub => h('tr', {},
          h('td', {}, sub.email), h('td', {}, h('span.chip', { class: sub.status === 'confirmed' ? 'published' : 'draft' }, sub.status)),
          h('td.fnt', {}, fmtDate(sub.createdAt))))))))
    }
    listSel.addEventListener('change', refresh)
    refresh()
    const campaign = () => {
      const vals = { subject: '', md: '', test: '' }
      dialog({
        title: 'Send campaign',
        width: 'min(38rem, 94vw)',
        body: renderFields([
          { key: 'subject', type: 'text', label: 'Subject', required: true },
          { key: 'md', type: 'markdown', label: 'Body (markdown)', rows: 8 },
          { key: 'test', type: 'text', label: 'Send test to (optional)', help: 'If set, only this address receives it' },
        ], vals, () => {}),
        actions: [{
          label: 'Send', kind: 'primary', onClick: async () => {
            const r = await post('/x/newsletter/campaign', { listId: listSel.value, ...vals })
            toast(`Sent to ${r.sent}/${r.of}`, 'ok'); return true
          },
        }],
      })
    }
    return h('div.card', {},
      h('div.page-head', { style: { marginBottom: 'var(--s2)' } }, h('strong', {}, 'Subscribers'),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } }, listSel, h('button.btn.primary.small', { onclick: campaign }, 'Send campaign…'))),
      out)
  },

  data: async () => (DATA_SECTIONS.data ? DATA_SECTIONS.data() : h('div.card', {}, emptyState(icon('db', 26), 'Data module loading…', ''))),

  ai: async () => {
    const cfg = await get('/x/ai/config').catch(() => ({}))
    const vals = { endpoint: cfg.endpoint || '', model: cfg.model || '', apiKey: '' }
    const test = h('div')
    return h('div.card', {},
      h('strong', {}, 'Endpoint'),
      h('p.sub', { style: { margin: 'var(--s0) 0 var(--s3)' } }, 'Any OpenAI-compatible API (OpenAI, Anthropic gateways, Ollama, LM Studio, your own agent). Powers ✦ buttons in the editor and the ai.generate automation action.'),
      renderFields([
        { key: 'endpoint', type: 'text', label: 'Base URL', help: 'e.g. https://api.openai.com/v1 or http://localhost:11434/v1' },
        { key: 'model', type: 'text', label: 'Model', width: 'half' },
        { key: 'apiKey', type: 'text', label: cfg.hasKey ? 'API key (set — enter to replace)' : 'API key', width: 'half' },
      ], vals, () => {}),
      h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
        h('button.btn.primary.small', { onclick: async () => { await put('/x/ai/config', vals); toast('Saved', 'ok') } }, 'Save'),
        h('button.btn.ghost.small', {
          onclick: async () => {
            test.replaceChildren(spinner())
            try { const r = await post('/x/ai/assist', { task: 'improve', text: 'blockhouse is site builder which am good' }); test.replaceChildren(h('p.dlg-text', {}, '✓ ', r.result)) }
            catch (e) { test.replaceChildren(h('p.dlg-text', { style: { color: 'var(--err-ink)' } }, String(e.message))) }
          },
        }, 'Test')),
      test)
  },

  search: async () => {
    const out = h('div')
    const refresh = async () => {
      const s = await get('/x/search/stats').catch(() => ({ entries: 0 }))
      out.replaceChildren(h('div.stat', {}, h('span.n', {}, String(s.entries)), h('span.l', {}, 'Indexed pages')))
    }
    refresh()
    return h('div.card', {},
      h('div.page-head', { style: { marginBottom: 'var(--s2)' } },
        h('div', {}, h('strong', {}, 'Search index'), h('p.sub', {}, 'Rebuilds automatically on publish. Drop a Search block on any page, or export a static index.json for flat builds.')),
        h('button.btn.ghost.small', { onclick: async () => { const r = await post('/x/search/reindex'); toast(`Reindexed ${r.entries} pages`, 'ok'); refresh() } }, iconEl('refresh', 14), 'Reindex')),
      out)
  },

  integrations: async () => {
    const holder = h('div', {}, skeleton('rows', 5))
    const refresh = async () => {
      const { connectors } = await get('/x/integrations/connectors')
      holder.replaceChildren(...connectors.map(cn => {
        const vals = {}
        for (const st of cn.settings) vals[st.key] = st.value
        const status = h('span.chip', { class: cn.connected ? 'published' : 'draft' }, cn.connected ? 'connected' : 'not connected')
        const testOut = h('div.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s2)' } })

        const runAction = a => {
          const opts = {}
          const out = h('div')
          dialog({
            title: `Run ${a.label}`,
            width: 'min(34rem, 94vw)',
            body: h('div', {},
              h('p.dlg-text', {}, 'Executes for real against the connected account — a live test bench for this action.'),
              (a.fields || []).length
                ? renderFields(a.fields.map(f => ({ ...f, type: f.type || 'text' })), opts, () => {})
                : h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'This action takes no options.'),
              out),
            actions: [{
              label: 'Run now', kind: 'primary', onClick: async () => {
                out.replaceChildren(h('div.spin'))
                const r = await post(`/x/integrations/connectors/${cn.id}/run`, { action: a.key.split('.').pop(), options: opts })
                out.replaceChildren(
                  h('p', { style: { fontWeight: 'var(--fw-semi)', fontSize: 'var(--t-m)', color: r.ok ? 'var(--ok-ink)' : 'var(--err-ink)', margin: 'var(--s2) 0 var(--s1)' } },
                    r.ok ? `✓ Succeeded in ${r.ms}ms` : `✗ ${r.error}`),
                  r.result !== undefined ? h('pre.code-out', { style: { fontSize: 'var(--t-xs)', maxHeight: '12rem', overflow: 'auto', whiteSpace: 'pre-wrap' } }, JSON.stringify(r.result, null, 1)) : '')
                return false   // keep the dialog open to read the result
              },
            }],
          })
        }
        const actionsList = cn.actions.length
          ? h('details', { style: { marginTop: 'var(--s3)' } },
            h('summary', { style: { cursor: 'pointer', fontSize: 'var(--t-s)', color: 'var(--mut)' } }, `${cn.actions.length} automation action(s) — click to test any of them`),
            h('div', { style: { marginTop: 'var(--s2)' } }, ...cn.actions.map(a =>
              h('div', { style: { padding: 'var(--s1) 0', borderBottom: '1px solid var(--line-soft)', display: 'flex', gap: 'var(--s2)', alignItems: 'center' } },
                h('code.pill-perm', {}, a.key),
                h('span.fnt', { style: { fontSize: 'var(--t-s)', flex: 1 } }, a.description || a.label),
                h('button.btn.ghost.small', { onclick: () => runAction(a) }, iconEl('play', 12), 'Run…')))))
          : ''

        return h('div.card', { style: { marginBottom: 'var(--s4)' } },
          h('div.page-head', { style: { marginBottom: 'var(--s2)' } },
            h('div', { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' } },
              h('span', { style: { color: 'var(--acc)', marginTop: 'var(--s0)' } }, iconEl(cn.icon || 'plug', 20)),
              h('div', {}, h('strong', {}, cn.name, cn.custom ? h('span.mrow-tag', { style: { marginLeft: 'var(--s2)' } }, 'custom') : ''),
                h('p.sub', {}, cn.description),
                cn.identity ? h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, `Signed in as ${cn.identity}`) : '')),
            h('div', { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center' } },
              cn.custom ? h('button.icon-btn', { title: 'Edit definition', onclick: () => editCustom(cn.id), html: icon('pen', 14) }) : '',
              cn.custom ? h('button.icon-btn', { title: 'Delete connector', onclick: async () => { if (await confirmDialog('Delete connector?', `“${cn.name}” and its actions are removed.`)) { await del(`/x/integrations/custom/${cn.id}`); refresh() } }, html: icon('trash', 14) }) : '',
              status)),
          cn.docs ? h('p.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s2)' } }, cn.docs) : '',
          cn.auth === 'oauth2' ? h('div', { style: { marginBottom: 'var(--s2)' } },
            h('span.fnt', { style: { fontSize: 'var(--t-s)' } }, 'Redirect URI: '), h('code.pill-perm', {}, cn.redirectUri)) : '',
          renderFields(cn.settings.map(st => ({
            key: st.key, label: st.label, type: st.type === 'select' ? 'text' : 'text', help: st.help,
            width: cn.settings.length > 2 ? 'half' : undefined,
          })), vals, () => {}),
          cn.scopes?.length ? h('p.fnt', { style: { fontSize: 'var(--t-xs)', marginBottom: 'var(--s2)' } }, 'Scopes: ', ...cn.scopes.map(sc => h('code.pill-perm', {}, sc.replace('https://www.googleapis.com/auth/', '')))) : '',
          h('div', { style: { display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' } },
            h('button.btn.ghost.small', { onclick: async () => { await put(`/x/integrations/connectors/${cn.id}`, vals); toast('Saved', 'ok'); refresh() } }, 'Save settings'),
            cn.auth === 'oauth2'
              ? (cn.connected
                ? h('button.btn.ghost.small', { onclick: async () => { await post(`/x/integrations/connectors/${cn.id}/disconnect`); toast('Disconnected', 'ok'); refresh() } }, 'Disconnect')
                : h('button.btn.primary.small', { onclick: async () => {
                  await put(`/x/integrations/connectors/${cn.id}`, vals)
                  try {
                    const r = await post(`/x/integrations/connectors/${cn.id}/connect`)
                    window.open(r.url, '_blank', 'width=560,height=720')
                    toast('Complete the sign-in in the popup, then refresh', 'ok', 6000)
                  } catch {}
                } }, iconEl('link', 13), 'Connect'))
              : '',
            h('button.btn.ghost.small', { onclick: async () => {
              testOut.textContent = 'Testing…'
              const r = await post(`/x/integrations/connectors/${cn.id}/test`).catch(() => ({ ok: false, detail: 'request failed' }))
              testOut.textContent = (r.ok ? '✓ ' : '✗ ') + r.detail
              testOut.style.color = r.ok ? 'var(--ok-ink)' : 'var(--err-ink)'
            } }, 'Test')),
          testOut, actionsList)
      }))
    }
    async function editCustom(id) {
      const { defs } = await get('/x/integrations/custom')
      openCustomBuilder(defs.find(d => d.id === id))
    }

    function openCustomBuilder(existing) {
      const def = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: '', name: '', description: '', icon: 'plug', auth: 'apikey', settings: [], actions: [],
      }
      def.actions ??= []
      const actionsHolder = h('div', { style: { display: 'grid', gap: 'var(--s2)' } })
      const paintActs = () => actionsHolder.replaceChildren(
        ...def.actions.map((a, i) => h('details.card', { open: !a.key, style: { padding: 'var(--s3) var(--s4)' } },
          h('summary', { style: { cursor: 'pointer', fontSize: 'var(--t-m)', fontWeight: 'var(--fw-semi)', display: 'flex', gap: 'var(--s2)', alignItems: 'center' } },
            a.label || a.key || 'New action',
            h('span', { style: { flex: 1 } }),
            h('button.icon-btn', { onclick: e => { e.preventDefault(); def.actions.splice(i, 1); paintActs() }, html: icon('trash', 12) })),
          renderFields([
            { key: 'key', type: 'text', label: 'Key', required: true, width: 'half', help: 'becomes <id>.<key> in automations' },
            { key: 'label', type: 'text', label: 'Label', width: 'half' },
            { key: 'method', type: 'select', label: 'Method', options: [{ value: 'POST' }, { value: 'GET' }, { value: 'PUT' }, { value: 'PATCH' }, { value: 'DELETE' }], width: 'half' },
            { key: 'url', type: 'text', label: 'URL template', required: true, help: '{opts.x} · {payload.x} · {config.x} interpolate' },
            { key: 'headers', type: 'json', label: 'Headers (JSON)', help: '{"content-type":"application/json"}' },
            { key: 'body', type: 'textarea', label: 'Body template', rows: 3, help: 'Same placeholders. Blank sends no body.' },
            { key: 'fields', type: 'json', label: 'Option fields (JSON)', help: '[{"key":"text","label":"Message","required":true}] — becomes the form in Automations' },
          ], a, () => {}))),
        h('button.tree-add', { onclick: () => { def.actions.push({ key: '', label: '', method: 'POST', url: '' }); paintActs() } }, '＋ Add action'))

      dialog({
        title: existing ? `Edit ${def.name || def.id}` : 'New custom connector',
        width: 'min(44rem, 96vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'Point Blockhouse at any HTTP API. Auth is applied for you; each action becomes an automation step and gets a test bench above.'),
          renderFields([
            { key: 'id', type: 'text', label: 'ID', required: true, width: 'half', help: 'lowercase — cannot change later' },
            { key: 'name', type: 'text', label: 'Name', required: true, width: 'half' },
            { key: 'description', type: 'text', label: 'Description' },
            { key: 'auth', type: 'select', label: 'Authentication', required: true, options: [
              { value: 'apikey', label: 'API key (bearer / header / basic)' },
              { value: 'webhook', label: 'Webhook URL (no auth headers)' },
              { value: 'none', label: 'None (public API)' },
            ], width: 'half' },
            { key: 'testUrl', type: 'text', label: 'Test URL (optional)', width: 'half', help: 'GET this to verify the connection' },
            { key: 'docs', type: 'text', label: 'Setup note shown on the card' },
          ], def, (k, v) => { if (k === 'id' && !existing) def.id = String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-') }),
          h('div.insp-section-title', { style: { marginTop: 'var(--s3)' } }, 'Actions'),
          actionsHolder),
        actions: [{
          label: 'Save connector', kind: 'primary', onClick: async () => {
            if (!def.id || !def.name) { toast('ID and name are required', 'err'); return false }
            for (const a of def.actions) {
              if (typeof a.headers === 'string') { try { a.headers = JSON.parse(a.headers || '{}') } catch { toast(`Action ${a.key}: headers are not valid JSON`, 'err'); return false } }
              if (typeof a.fields === 'string') { try { a.fields = JSON.parse(a.fields || '[]') } catch { toast(`Action ${a.key}: fields are not valid JSON`, 'err'); return false } }
            }
            await put(`/x/integrations/custom/${def.id}`, { def })
            toast('Connector saved — its actions are live in Automations', 'ok', 4000)
            refresh(); return true
          },
        }],
      })
      paintActs()
    }

    refresh()
    return h('div', {},
      h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
        h('div', {}, h('p.sub', {}, 'Connect once here; every connector’s actions then appear in Automations recipes as ', h('code.pill-perm', {}, 'connector.action'), ' — and each has a live test bench.')),
        h('button.btn.primary', { onclick: () => openCustomBuilder(null) }, '＋ Custom connector')),
      holder)
  },

  members: async () => {
    const listHolder = h('div', {}, skeleton('rows', 5))
    const refresh = async () => {
      const [{ members }, { items: groups }] = await Promise.all([
        get('/x/members/list'),
        get('/res/members/groups').catch(() => ({ items: [] })),
      ])
      listHolder.replaceChildren(members.length
        ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Member'), h('th', {}, 'Groups'), h('th', {}, 'Status'), h('th', {}, 'Joined'), h('th'))),
          h('tbody', {}, ...members.map(m => h('tr', { onclick: () => editMember(m, groups) },
            h('td', {}, h('strong', {}, m.name || '—'), h('div.row-sub', {}, m.email)),
            h('td', {}, (m.groups || []).map(g => h('span.multi-tag', { style: { marginRight: 'var(--s0)' } }, g))),
            h('td', {}, h('span.chip', { class: m.status === 'active' ? 'published' : m.status === 'pending' ? 'review' : 'err' }, m.status)),
            h('td.fnt', {}, fmtDate(m.createdAt)),
            h('td', { style: { textAlign: 'right' } }, h('button.icon-btn', {
              onclick: async e => { e.stopPropagation(); if (await confirmDialog('Remove member', `Delete ${m.email}?`)) { await del(`/x/members/${m.id}`); refresh() } },
            }, iconEl('trash', 14)))))
          )))
        : emptyState(icon('users', 26), 'No members yet', 'Add a “Sign in / register” block to a page — /account is a good home.'))
    }
    const editMember = (m, groups) => {
      const vals = { name: m.name || '', status: m.status, groups: (m.groups || []).join(', '), password: '' }
      dialog({
        title: m.email,
        body: renderFields([
          { key: 'name', type: 'text', label: 'Name' },
          { key: 'status', type: 'select', label: 'Status', options: [{ value: 'active' }, { value: 'pending' }, { value: 'blocked' }], width: 'half' },
          { key: 'groups', type: 'text', label: 'Groups (comma separated)', help: groups.length ? `Available: ${groups.map(g => g.id).join(', ')}` : 'Create groups above first' },
          { key: 'password', type: 'text', label: 'Set a new password' },
        ], vals, () => {}),
        actions: [{ label: 'Save', kind: 'primary', onClick: async () => {
          await patch(`/x/members/${m.id}`, { name: vals.name, status: vals.status, groups: vals.groups.split(',').map(g => g.trim()).filter(Boolean), ...(vals.password ? { password: vals.password } : {}) })
          refresh(); return true
        } }],
      })
    }
    refresh()

    const settings = await get('/x/members/settings').catch(() => ({}))
    const sVals = { allowSignup: settings.allowSignup !== false, requireApproval: !!settings.requireApproval, loginPath: settings.loginPath || '/account' }
    return h('div', {},
      h('div.card', { style: { marginBottom: 'var(--s4)' } },
        h('div.page-head', { style: { marginBottom: 'var(--s3)' } },
          h('div', {}, h('strong', {}, 'Membership settings')),
          h('button.btn.ghost.small', { onclick: async () => { await put('/x/members/settings', sVals); toast('Saved', 'ok') } }, 'Save')),
        renderFields([
          { key: 'allowSignup', type: 'boolean', label: 'Allow public sign-ups' },
          { key: 'requireApproval', type: 'boolean', label: 'New accounts need approval' },
          { key: 'loginPath', type: 'text', label: 'Account page path', help: 'Where gated pages send visitors, and where sign-in lands', width: 'half' },
        ], sVals, () => {}),
        h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'Gate a page in the editor: Page tab → Access. Members are separate from studio users — they never see the admin.')),
      h('div.card', {}, h('strong', {}, 'Members'), h('div', { style: { marginTop: 'var(--s3)' } }, listHolder)))
  },

  analytics: async () => {
    const holder = h('div', {}, skeleton('rows', 5))
    let days = 30

    const load = () => {
      get(`/x/analytics/summary?days=${days}`).then(data => {
        const maxV = Math.max(1, ...data.series.map(d => d.views))
        const w = 640, chartH = 150, n = data.series.length, bw = w / n
        const bars = data.series.map((d, i) => {
          const bh = (d.views / maxV) * chartH
          const x = i * bw
          return `<rect x="${x + 1}" y="${chartH - bh}" width="${Math.max(bw - 2, 1)}" height="${Math.max(bh, 1)}" rx="2" fill="var(--acc)" opacity="0.85"><title>${d.day}: ${d.views} views</title></rect>`
        }).join('')
        const chart = h('div', { style: { marginTop: 'var(--s2)' } })
        chart.innerHTML = `<svg viewBox="0 0 ${w} ${chartH + 18}" width="100%" role="img" aria-label="Views over time"><g>${bars}</g><text x="0" y="${chartH + 14}" font-size="11" fill="var(--fnt)">${data.series[0]?.day || ''}</text><text x="${w}" y="${chartH + 14}" font-size="11" fill="var(--fnt)" text-anchor="end">${data.series[n - 1]?.day || ''}</text></svg>`

        const list = (title, rows, fmt) => h('div.card', {}, h('strong', {}, title),
          rows.length ? h('div', { style: { marginTop: 'var(--s2)' } }, ...rows.map(r => h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: 'var(--s1) 0', borderBottom: '1px solid var(--line-soft)', fontSize: 'var(--t-m)' } }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fmt(r.k)), h('strong', {}, String(r.n)))))
            : h('p.mut', { style: { marginTop: 'var(--s2)' } }, 'No data yet.'))

        const avg = n ? Math.round(data.totalViews / n) : 0
        const best = data.series.reduce((a, b) => (b.views > (a?.views || 0) ? b : a), null)
        holder.replaceChildren(
          h('div.cards', { style: { marginBottom: 'var(--s4)' } },
            h('div.card.stat', {}, h('span.n', {}, String(data.totalViews)), h('span.l', {}, `Views (${days}d)`)),
            h('div.card.stat', {}, h('span.n', {}, String(data.totalVisitors)), h('span.l', {}, `Visitors (${days}d)`)),
            h('div.card.stat', {}, h('span.n', {}, String(avg)), h('span.l', {}, 'Avg / day')),
            h('div.card.stat', {}, h('span.n', {}, String(best?.views || 0)), h('span.l', {}, best ? `Best day · ${best.day.slice(5)}` : 'Best day'))),
          h('div.card', { style: { marginBottom: 'var(--s4)' } }, h('strong', {}, 'Views over time'), chart),
          h('div.cards', {},
            list('Top pages', data.topPages, k => k),
            list('Referrers', data.topReferrers, k => k)))
      }).catch(() => holder.replaceChildren(h('p.mut', {}, 'No analytics yet — the beacon records views on the live site.')))
    }
    load()

    const seg = h('div.seg', {}, ...[7, 30, 90].map(d => h('button', {
      class: d === days ? 'active' : '',
      onclick: e => {
        days = d
        for (const b of seg.children) b.classList.toggle('active', b === e.currentTarget)
        holder.replaceChildren(skeleton('rows', 5)); load()
      },
    }, `${d} days`)))

    return h('div', {},
      h('div.page-head', { style: { marginBottom: 'var(--s4)' } },
        h('p.sub', {}, 'Cookieless and privacy-first: no cross-site identifiers, no PII — just salted daily counts.'),
        h('div', { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center' } }, seg,
          h('a.btn.ghost.small', { href: `/api/x/analytics/export.csv?days=90`, download: 'analytics.csv' }, iconEl('download', 13), 'CSV'))),
      holder)
  },

  ops: Object.assign(async () => {
    const statusHolder = h('div', {}, skeleton('rows', 3))
    const branchesHolder = h('div', {}, skeleton('rows', 3))
    const backupsHolder = h('div', {}, skeleton('rows', 4))
    const canRestore = state.user.role === 'admin' || state.user.role === 'owner' || (state.user.grants || []).includes('settings.write')
    const syncMessage = h('input.input', { placeholder: 'Commit message (optional)', style: { marginBottom: 'var(--s2)', width: '100%' } })

    const refreshStatus = async () => {
      const s = await get('/x/ops/status').catch(() => ({ git: false }))
      statusHolder.replaceChildren(
        s.git
          ? h('div', {},
              h('p.sub', {}, s.branch ? `On branch ${s.branch}. ` : '', s.lastCommit
                ? `Last synced: ${s.lastCommit.message} (${s.lastCommit.hash}, ${s.lastCommit.date})`
                : 'Git repository detected — nothing synced yet.'),
              s.dirty ? h('p.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s0)' } }, `${s.dirty} file(s) changed since last sync.`) : '')
          : emptyState(icon('warn', 22), 'No git repository', 'This site’s directory (or a parent of it) needs its own .git for sync to work.'),
        h('div', { style: { marginTop: 'var(--s3)' } },
          syncMessage,
          h('button.btn.primary', { disabled: !s.git, onclick: async () => {
            const message = syncMessage.value.trim()
            const res = await post('/x/ops/sync', message ? { message } : {})
            toast(res.synced ? `Synced — ${res.hash}` : 'Nothing to sync', res.synced ? 'ok' : undefined)
            syncMessage.value = ''
            refreshStatus(); refreshBranches()
          } }, iconEl('refresh', 14), 'Sync now')))
    }

    // ----- branches: "cancel without losing it" is a checkout, not a deletion -----
    const refreshBranches = async () => {
      const b = await get('/x/ops/branches').catch(() => ({ git: false, branches: [] }))
      if (!b.git) { branchesHolder.replaceChildren(''); return }

      const saveCheckpoint = async () => {
        const nameInput = h('input.input', { placeholder: 'e.g. redesign-hero, try-new-copy', autofocus: true })
        dialog({
          title: 'Save checkpoint',
          body: h('div', {},
            h('p.dlg-text', {}, 'Labels the current state of this site as a branch you can come back to. Nothing on the live site changes.'),
            h('div.field', {}, h('label', {}, 'Branch name'), nameInput)),
          actions: [{ label: 'Save', kind: 'primary', onClick: async () => {
            const name = nameInput.value.trim()
            if (!name) { nameInput.focus(); return false }
            const res = await post('/x/ops/branches', { name }).catch(e => ({ error: e.message }))
            if (res.error) { toast(res.error, 'err'); return false }
            toast(`Saved as "${res.branch}"`, 'ok'); refreshBranches(); refreshStatus(); return true
          } }],
        })
      }

      const cancelWork = async () => {
        const others = b.branches.filter(x => !x.current).map(x => x.name)
        const revertTo = others.includes('master') ? 'master' : (others[0] || 'master')
        const msg = b.dirty
          ? `Saves your current changes to a new branch first (so nothing's lost), then switches the live site back to "${revertTo}".`
          : `Switches the live site back to "${revertTo}". Nothing is currently uncommitted, so there's nothing to lose.`
        if (!(await confirmDialog('Cancel these changes?', msg))) return
        const res = await post('/x/ops/branches/cancel', { revertTo }).catch(e => ({ error: e.message }))
        if (res.error) { toast(res.error, 'err'); return }
        toast(res.savedBranch ? `Saved as "${res.savedBranch}" — now on ${res.revertedTo}` : `Now on ${res.revertedTo}`, 'ok', 5000)
        refreshBranches(); refreshStatus()
      }

      branchesHolder.replaceChildren(
        b.branches.length > 1 ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'branch'), h('th', {}, 'last commit'), h('th', {}, ''))),
          h('tbody', {}, ...b.branches.map(br => h('tr', {},
            h('td', {}, br.current ? h('span.badge.ok', {}, br.name) : br.name),
            h('td.mut', { style: { fontSize: 'var(--t-s)' } }, `${br.message} (${br.date})`),
            h('td', { style: { textAlign: 'right' } },
              br.current ? '' : h('button.btn.ghost.small', { onclick: async () => {
                const res = await post(`/x/ops/branches/${encodeURIComponent(br.name)}/checkout`, {}).catch(e => ({ error: e.message }))
                if (res.error) toast(res.error, 'err'); else { toast(`Switched to ${res.branch}`, 'ok'); refreshBranches(); refreshStatus() }
              } }, 'Switch to')))))))
          : h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'Just the one branch so far — save a checkpoint before trying something you might want to back out of.'),
        h('div', { style: { marginTop: 'var(--s3)', display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost.small', { onclick: saveCheckpoint }, iconEl('plus', 13), 'Save checkpoint'),
          b.dirty || b.branches.length > 1 ? h('button.btn.ghost.small', { onclick: cancelWork }, iconEl('undo', 13), 'Cancel & revert') : ''))
    }

    const humanSizeMB = n => `${(n / (1024 * 1024)).toFixed(1)} MB`
    const backupLabel = h('input.input', { placeholder: 'Label (optional) — e.g. before-redesign', style: { width: '100%' } })

    const refreshBackups = async () => {
      const { backups, settings } = await get('/x/ops/backups').catch(() => ({ backups: [], settings: {} }))
      backupsHolder.replaceChildren(
        !settings.enabled ? h('p.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s2)' } },
          'Backups are disabled — turn them on in Settings → Plugin settings → Backups.') : '',
        h('div', { style: { marginBottom: 'var(--s3)', display: 'flex', gap: 'var(--s2)' } },
          backupLabel,
          h('button.btn.ghost', { onclick: async () => {
            const label = backupLabel.value.trim()
            const res = await post('/x/ops/backups/run', label ? { label } : {}).catch(e => ({ error: e.message }))
            if (res.error) toast(res.error, 'err')
            else if (res.skipped) toast('Nothing changed — skipped', undefined, 4000)
            else { toast('Backup created', 'ok'); backupLabel.value = ''; refreshBackups() }
          } }, iconEl('download', 14), 'Back up now')),
        backups.length ? h('div.table-wrap', {}, h('table.data-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'kind'), h('th', {}, 'when'), h('th', {}, 'size'), h('th', {}, ''))),
          h('tbody', {}, ...backups.map(b => h('tr', {},
            h('td', {}, b.kind === 'prerestore' ? h('span.badge.warn', {}, 'pre-restore') : 'backup'),
            h('td.mut', {}, new Date(b.at).toLocaleString()),
            h('td.mut', {}, humanSizeMB(b.sizeBytes)),
            h('td', { style: { textAlign: 'right' } },
              canRestore
                ? h('button.btn.soft.small', { onclick: async () => {
                    if (!(await confirmDialog('Restore', `This overwrites this site’s current users/sessions and media with "${b.name}". A safety snapshot of the current state is taken first.`))) return
                    const res = await post('/x/ops/backups/restore', { name: b.name }).catch(e => ({ error: e.message }))
                    if (res.error) toast(res.error, 'err'); else { toast('Restored', 'ok'); refreshStatus(); refreshBranches(); refreshBackups() }
                  } }, 'Restore')
                : ''))))))
          : emptyState(icon('db', 22), 'No backups yet', settings.enabled ? 'Hit "Back up now" above.' : 'Backups are disabled.'))
    }

    refreshStatus(); refreshBranches(); refreshBackups()
    return h('div', {},
      h('div.card', { style: { marginBottom: 'var(--s4)' } }, h('strong', {}, 'Git sync'), statusHolder),
      h('div.card', { style: { marginBottom: 'var(--s4)' } }, h('strong', {}, 'Branches'), h('p.sub', {}, 'Did some work, want to cancel it without losing it? Save a checkpoint, or just hit cancel — it branches automatically.'), branchesHolder),
      h('div.card', {}, h('strong', {}, 'Backups'), backupsHolder))
  }, { replaces: true }),
}
