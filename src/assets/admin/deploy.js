// Deploy view — the health of this install and the files needed to run it
// somewhere else. Everything shown is computed from the live project, so it
// reflects what would actually happen, not what a README once claimed.

import { get, post, put, del } from './api.js'
import { h, emptyState, toast, dialog, confirmDialog, skeleton } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state, prefs, setPref } from './state.js'
import { renderFields } from './fields.js'

const TARGETS = [
  { key: 'server', label: 'Own server', icon: 'server', blurb: 'Bun or Node behind a reverse proxy. Everything works: forms, members, files, search, analytics.' },
  { key: 'docker', label: 'Docker', icon: 'box', blurb: 'Container image plus compose file. Mount .blockhouse and media as volumes so state survives a rebuild.' },
  { key: 'cloudflare', label: 'Cloudflare Workers', icon: 'cloud', blurb: 'R2 for content, D1 for users. Set images.provider to cloudflare — sharp cannot run in a Worker.' },
  { key: 'static', label: 'Flat / static', icon: 'download', blurb: 'blockhouse export writes plain HTML. Fastest and cheapest; loses anything that needs a server.' },
]

const PRESETS = {
  server: ['systemd', 'caddy', 'nginx'],
  docker: ['docker'],
  cloudflare: ['cloudflare', 'github'],
  static: ['pages', 'github'],
}

const LEVEL = {
  ok: { ico: 'check', colour: 'var(--ok-ink)' },
  warn: { ico: 'warn', colour: 'var(--warn-ink)' },
  fail: { ico: 'x', colour: 'var(--err-ink)' },
  info: { ico: 'info', colour: 'var(--mut)' },
}

registerView('deploy', async root => {
  let target = prefs().deployTarget || 'server'
  let deep = false
  const body = h('div.main-pad', { style: { maxWidth: '64rem' } })
  root.replaceChildren(h('div.main', {}, body))

  const targetCards = () => h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' } },
    ...TARGETS.map(t => h('button.card', {
      onclick: () => { target = t.key; setPref('deployTarget', t.key); draw() },
      style: {
        textAlign: 'left', padding: 'var(--s4)', cursor: 'pointer',
        borderColor: target === t.key ? 'var(--acc)' : 'var(--line)',
        boxShadow: target === t.key ? '0 0 0 1px var(--acc) inset' : 'none',
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s1)', fontWeight: 'var(--fw-semi)' } },
        iconEl(t.icon, 15), t.label),
      h('p.fnt', { style: { fontSize: 'var(--t-s)', lineHeight: 1.45, margin: 0 } }, t.blurb))))

  const checkRow = c => h('div', { style: { display: 'grid', gridTemplateColumns: '1.2rem minmax(9rem, 13rem) 1fr', gap: 'var(--s3)', alignItems: 'start', padding: 'var(--s2) 0', borderBottom: '1px solid var(--line-soft)' } },
    h('span', { style: { color: LEVEL[c.level].colour, display: 'flex', paddingTop: 'var(--s0)' }, html: icon(LEVEL[c.level].ico, 14) }),
    h('span', { style: { fontSize: 'var(--t-s)', fontWeight: 'var(--fw-semi)', color: 'var(--mut)' } }, c.label),
    h('span', {},
      h('span', { style: { fontSize: 'var(--t-m)' } }, c.detail),
      c.fix ? h('div.fnt', { style: { fontSize: 'var(--t-s)', marginTop: 'var(--s0)' } }, '→ ', c.fix) : ''))

  async function draw() {
    body.replaceChildren(
      h('div.page-head', {}, h('div', {},
        h('h1', {}, 'Deploy'),
        h('p.sub', {}, 'Where this site runs, whether it is ready, and the files to get it there.'))),
      targetCards(),
      skeleton('rows', 4))

    let data
    try { data = await get(`/doctor?target=${target}${deep ? '&deep=1' : ''}`) }
    catch (e) {
      body.replaceChildren(
        h('div.page-head', {}, h('div', {}, h('h1', {}, 'Deploy'))),
        targetCards(),
        emptyState(icon('warn', 26), 'Diagnostics unavailable', String(e.message || e)))
      return
    }

    const groups = []
    for (const c of data.checks) {
      const last = groups[groups.length - 1]
      if (last && last.name === c.group) last.items.push(c)
      else groups.push({ name: c.group, items: [c] })
    }

    const s = data.summary
    const verdict = s.fail ? { text: `${s.fail} problem${s.fail === 1 ? '' : 's'} to fix`, colour: 'var(--err-ink)', ico: 'x' }
      : s.warn ? { text: `${s.warn} warning${s.warn === 1 ? '' : 's'}`, colour: 'var(--warn-ink)', ico: 'warn' }
        : { text: 'All checks passed', colour: 'var(--ok-ink)', ico: 'check' }

    body.replaceChildren(
      h('div.page-head', {}, h('div', {},
        h('h1', {}, 'Deploy'),
        h('p.sub', {}, 'Where this site runs, whether it is ready, and the files to get it there.')),
        h('div', { style: { display: 'flex', gap: 'var(--s2)' } },
          h('button.btn.ghost', { onclick: () => { deep = !deep; draw() } }, iconEl(deep ? 'check' : 'gauge', 14), deep ? 'Deep checks on' : 'Include page weight'),
          h('button.btn.ghost', { onclick: draw }, iconEl('refresh', 14), 'Re-run'))),

      targetCards(),
      deployTargets(),

      h('div.card', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s4) var(--s4)', marginBottom: 'var(--s4)', borderColor: verdict.colour } },
        h('span', { style: { color: verdict.colour, display: 'flex' }, html: icon(verdict.ico, 18) }),
        h('div', {},
          h('div', { style: { fontWeight: 'var(--fw-semi)' } }, verdict.text),
          h('div.fnt', { style: { fontSize: 'var(--t-s)' } }, `environment: ${data.env} · ${s.ok} passing`))),

      ...groups.map(g => h('section', { style: { marginBottom: 'var(--s5)' } },
        h('h2', { style: { fontSize: 'var(--t-l)', marginBottom: 'var(--s1)' } }, g.name),
        h('div.card', { style: { padding: 'var(--s1) var(--s4)' } }, ...g.items.map(checkRow)))),

      presetSection(),
      weightSection())
  }

  // ---------- saved deploy targets (encrypted credentials, one-click runs) ----------
  function deployTargets() {
    const holder = h('div', {}, skeleton('rows', 4))
    const paint = async () => {
      const { profiles } = await get('/deploy/profiles').catch(() => ({ profiles: [] }))
      holder.replaceChildren(
        ...(profiles.length ? profiles.map(p => {
          const out = h('div')
          const isProd = p.target === 'production'
          return h('div.card', { style: { padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s2)' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' } },
              iconEl(p.kind === 'hook' ? 'link' : p.kind === 'command' ? 'code' : 'box', 16),
              h('div', { style: { flex: 1, minWidth: '10rem' } },
                h('strong', { style: { fontSize: 'var(--t-m)' } }, p.label),
                h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, `${p.kind} · needs ${p.minRole}+`)),
              h('span.mrow-tag', { style: isProd ? { background: 'color-mix(in oklch, var(--err) 16%, transparent)', color: 'var(--err-ink)' } : { background: 'color-mix(in oklch, var(--ok) 16%, transparent)', color: 'var(--ok-ink)' } }, p.target),
              h('button.btn.ghost.small', { onclick: async () => { const r = await post(`/deploy/profiles/${p.id}/test`); toast(`${r.ok ? '✓' : '✗'} ${r.detail}`, r.ok ? 'ok' : 'err', 4500) } }, 'Test'),
              h('button.btn.ghost.small', { onclick: () => editProfile(p) }, 'Edit'),
              h('button.icon-btn', { title: 'Delete', onclick: async () => { if (await confirmDialog('Delete target?', `“${p.label}” is removed; nothing is undeployed.`)) { await del(`/deploy/profiles/${p.id}`); paint() } }, html: icon('trash', 13) }),
              h(`button.btn.${isProd ? 'primary' : 'soft'}.small`, {
                onclick: async e => {
                  if (isProd && !(await confirmDialog('Deploy to production?', 'Builds the published site and pushes it live.', 'Deploy'))) return
                  e.target.disabled = true
                  out.replaceChildren(h('div.spin'))
                  const r = await post(`/deploy/run/${p.id}`).catch(err => ({ ok: false, log: [String(err.message || err)] })).finally(() => (e.target.disabled = false))
                  out.replaceChildren(h('pre.code-out', { style: { fontSize: 'var(--t-xs)', margin: 'var(--s2) 0 0', whiteSpace: 'pre-wrap', color: r.ok === false ? 'var(--err-ink)' : '' } }, (r.log || []).join('\n')))
                  toast(r.ok === false ? 'Deploy failed — see the log' : 'Deployed', r.ok === false ? 'err' : 'ok')
                },
              }, iconEl('rocket', 12), isProd ? 'Deploy live' : 'Deploy staging')),
            out)
        }) : [h('p.fnt', { style: { fontSize: 'var(--t-s)' } }, 'No saved targets yet. A target bundles where a build goes (staging or production), how it gets there, and who may press the button. Credentials are stored encrypted.')]),
        h('button.tree-add', { onclick: () => editProfile(null) }, '＋ New deploy target'))
    }

    function editProfile(existing) {
      const p = existing ? { ...existing, url: '', command: '' } : { id: '', label: '', kind: 'hook', target: 'staging', minRole: 'editor', outDir: 'dist' }
      dialog({
        title: existing ? `Edit ${existing.label}` : 'New deploy target',
        width: 'min(30rem, 94vw)',
        body: h('div', {},
          renderProfileFields(p, !!existing)),
        actions: [{
          label: 'Save target', kind: 'primary', onClick: async () => {
            const idp = (p.id || p.label || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
            if (!idp) { toast('Name it first', 'err'); return false }
            await put(`/deploy/profiles/${idp}`, { profile: { ...p, id: idp } })
            toast('Target saved — credentials encrypted at rest', 'ok')
            paint(); return true
          },
        }],
      })
    }

    function renderProfileFields(p, isEdit) {
      const wrap = h('div')
      const paint2 = () => wrap.replaceChildren(renderFields([
        { key: 'label', type: 'text', label: 'Name', required: true, width: 'half' },
        {
          key: 'target', type: 'select', label: 'Environment', required: true, width: 'half', options: [
            { value: 'staging', label: 'Staging — includes drafts' },
            { value: 'production', label: 'Production — published only' }],
        },
        {
          key: 'kind', type: 'select', label: 'How it ships', required: true, options: [
            { value: 'hook', label: 'Deploy hook — POST a build webhook (Pages, Netlify, CI)' },
            { value: 'command', label: 'Shell command (owner-only) — rsync, wrangler, anything' },
            { value: 'export', label: 'Export only — build into a folder' }],
        },
        ...(p.kind === 'hook' ? [{ key: 'url', type: 'text', label: isEdit ? 'Hook URL (blank keeps saved)' : 'Hook URL', help: 'Stored encrypted; masked everywhere after saving' }] : []),
        ...(p.kind === 'command' ? [{ key: 'command', type: 'text', label: isEdit ? 'Command (blank keeps saved)' : 'Command', help: 'Runs in the project dir with BLOCKHOUSE_TARGET/BLOCKHOUSE_OUT set. Encrypted at rest.' }] : []),
        { key: 'outDir', type: 'text', label: 'Build folder', width: 'half', help: 'staging appends -staging' },
        {
          key: 'minRole', type: 'select', label: 'Who may deploy', required: true, width: 'half', options: [
            { value: 'editor', label: 'Editors and above' },
            { value: 'admin', label: 'Admins and above' },
            { value: 'owner', label: 'Owners only' }],
        },
      ], p, k => { if (k === 'kind') paint2() }))
      paint2()
      return wrap
    }

    paint()
    return h('section', { style: { marginBottom: 'var(--s5)' } },
      h('h2', { style: { fontSize: 'var(--t-l)', marginBottom: 'var(--s1)' } }, 'Deploy targets'),
      holder)
  }

  function presetSection() {
    const list = PRESETS[target] || []
    const out = h('div', { style: { display: 'grid', gap: 'var(--s2)' } })
    out.replaceChildren(...list.map(p => h('div.card', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s3) var(--s4)' } },
      h('div', {},
        h('div', { style: { fontWeight: 'var(--fw-semi)', fontSize: 'var(--t-m)' } }, p),
        h('div.fnt', { style: { fontSize: 'var(--t-xs)' } }, PRESET_BLURB[p] || '')),
      h('button.btn.ghost.small', {
        onclick: async () => {
          const res = await get(`/deploy/preset/${p}`)
          const made = res.written.filter(w => !w.skipped).map(w => w.file)
          const kept = res.written.filter(w => w.skipped).map(w => w.file)
          await dialog({
            title: `${p} files`,
            body: h('div', {},
              made.length ? h('p', {}, 'Written:') : '',
              made.length ? h('ul', { style: { margin: '0 0 var(--s4) var(--s5)' } }, ...made.map(f => h('li', {}, h('code', {}, f)))) : '',
              kept.length ? h('p.mut', { style: { fontSize: 'var(--t-m)' } }, 'Left alone (already existed): ', kept.map(f => f).join(', ')) : '',
              h('p.mut', { style: { fontSize: 'var(--t-m)' } }, 'They are written into the project folder, filled in from this site’s configuration. Review before committing.')),
            okLabel: 'Done',
          })
          toast(made.length ? `Wrote ${made.length} file(s)` : 'Nothing to write', 'ok')
        },
      }, iconEl('download', 13), 'Write files'))))
    return h('section', { style: { marginBottom: 'var(--s5)' } },
      h('h2', { style: { fontSize: 'var(--t-l)', marginBottom: 'var(--s1)' } }, 'Deployment files'),
      list.length ? out : h('p.mut', {}, 'No presets for this target.'))
  }

  function weightSection() {
    const holder = h('div', {}, skeleton('rows', 4))
    get('/budget').then(({ pages, budget, median, failures }) => {
      const bar = p => {
        const pct = Math.min(100, Math.round((p.total / budget.total) * 100))
        return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(8rem, 16rem) 1fr 5rem', gap: 'var(--s3)', alignItems: 'center', padding: 'var(--s1) 0' } },
          h('code', { style: { fontSize: 'var(--t-s)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.path),
          h('div', { style: { height: '7px', borderRadius: 'var(--r-pill)', background: 'var(--line-soft)', overflow: 'hidden' } },
            h('div', { style: { width: `${pct}%`, height: '100%', borderRadius: 'var(--r-pill)', background: p.over.length ? 'var(--warn)' : 'var(--acc)' } })),
          h('span.fnt', { style: { fontSize: 'var(--t-xs)', textAlign: 'right', color: p.over.length ? 'var(--warn-ink)' : 'var(--mut)' } }, fmtKb(p.total)))
      }
      holder.replaceChildren(
        h('p.fnt', { style: { fontSize: 'var(--t-s)', marginBottom: 'var(--s2)' } },
          `Median page ${fmtKb(median)} against a ${fmtKb(budget.total)} budget. ${failures ? `${failures} page(s) over.` : 'Every page inside budget.'} Bars show HTML + CSS + JS; images are counted separately.`),
        h('div.card', { style: { padding: 'var(--s2) var(--s4)' } }, ...pages.map(bar)))
    }).catch(e => holder.replaceChildren(h('p.mut', {}, String(e.message || e))))
    return h('section', {},
      h('h2', { style: { fontSize: 'var(--t-l)', marginBottom: 'var(--s1)' } }, 'Page weight'),
      holder)
  }

  draw()
})

const PRESET_BLURB = {
  systemd: 'Hardened unit file, an env-file for the secret, and cron for scheduled publishing.',
  caddy: 'Two-line Caddyfile with automatic certificates and immutable asset caching.',
  nginx: 'Server block with TLS, SSE-friendly proxying and upload limits.',
  docker: 'Dockerfile, .dockerignore, compose file with volumes, and .env.example.',
  cloudflare: 'wrangler.toml with R2 + D1 bindings, a staging environment, and setup notes.',
  pages: 'Static hosting notes plus a _headers file for caching and security.',
  github: 'CI that runs blockhouse check, the page-weight budget and the tests, then deploys.',
}

function fmtKb(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} kB`
}
