// Deploy view — the health of this install and the files needed to run it
// somewhere else. Everything shown is computed from the live project, so it
// reflects what would actually happen, not what a README once claimed.

import { get, post, put, del } from './api.js'
import { h, emptyState, toast, dialog, confirmDialog, skeleton, fmtDate } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state, prefs, setPref } from './state.js'
import { helpButton } from './help.js'
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
  const body = h('div.main-pad.mw-64', {})
  root.replaceChildren(h('div.main', {}, body))

  const targetCards = () => h('div.deploy-targets', {},
    ...TARGETS.map(t => h('button.card.card-action', {
      class: target === t.key ? 'selected' : '',
      'aria-pressed': String(target === t.key),
      onclick: () => { target = t.key; setPref('deployTarget', t.key); draw() },
    },
      h('div.row.mb-1.fw-semi', {},
        iconEl(t.icon, 15), t.label),
      h('p.fnt.deploy-target-blurb', {}, t.blurb))))

  const checkRow = c => h('div.deploy-check', {},
    h('span.deploy-check-ico', { style: { color: LEVEL[c.level].colour }, html: icon(LEVEL[c.level].ico, 14) }),
    h('span.text-s.fw-semi.mut', {}, c.label),
    h('span', {},
      h('span.text-m', {}, c.detail),
      c.fix ? h('div.fnt.text-s.mt-0', {}, '→ ', c.fix) : ''))

  // The checks, run when someone asks for them rather than on every visit.
  async function runChecks(holder) {
    holder.replaceChildren(skeleton('rows', 4))
    let data
    try { data = await get(`/doctor?target=${target}${deep ? '&deep=1' : ''}`) }
    catch (e) {
      holder.replaceChildren(emptyState(icon('warn', 26), 'Checks unavailable', String(e.message || e)))
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

    holder.replaceChildren(
      h('div.card.card-verdict', { style: { '--card-accent': verdict.colour } },
        h('span.card-verdict-ico', { style: { color: verdict.colour }, html: icon(verdict.ico, 18) }),
        h('div', {},
          h('div.fw-semi', {}, verdict.text),
          h('div.fnt.text-s', {}, `environment: ${data.env} · ${s.ok} passing`))),
      ...groups.map(g => h('section.mb-5', {},
        h('h2.text-l.mb-1', {}, g.name),
        h('div.card.p-1-4', {}, ...g.items.map(checkRow)))))
  }

  // ---------- the part a site owner needs ----------
  function heroSection(profiles, lastRun) {
    const out = h('div.deploy-out')
    const url = state.meta?.site?.url || ''
    // The one button: run the saved publishing target if there is one this
    // person may press, otherwise write the site out as files.
    const runnable = profiles.find(p => p.target === 'production') || profiles[0]

    const publish = h('button.btn.primary', {
      onclick: async e => {
        e.target.disabled = true
        out.replaceChildren(h('div.spin'))
        try {
          if (runnable) {
            if (!(await confirmDialog('Publish the website?', `Builds the site and sends it to “${runnable.label}”.`, 'Publish'))) { out.replaceChildren(); return }
            const r = await post(`/deploy/run/${runnable.id}`)
            out.replaceChildren(h('pre.code-out.text-xs.pre-wrap', {}, (r.log || []).join('\n')))
            toast(r.ok === false ? 'It did not finish — read the log below' : 'Website published', r.ok === false ? 'err' : 'ok', 6000)
          } else {
            const r = await post('/export', {})
            out.replaceChildren()
            toast(`Exported ${r.pages} pages to ${r.outDir}/. Upload that folder to your host.`, 'ok', 8000)
          }
          setPref('lastPublishAt', new Date().toISOString())
          draw()
        } catch (err) {
          out.replaceChildren(h('p.fnt.txt-err', {}, String(err.message || err)))
          toast('It did not finish', 'err')
        } finally { e.target.disabled = false }
      },
    }, iconEl('rocket', 14), runnable ? 'Publish website now' : 'Export site files')

    return h('div.card.deploy-hero', {},
      h('h2', {}, 'Your website'),
      url
        ? h('div.deploy-url', {}, 'Your website is at ', h('a', { href: url, target: '_blank', rel: 'noopener' }, url))
        : h('div.deploy-url', {}, 'No website address is set yet — add one under Settings → Site.'),
      h('p.deploy-when', {}, lastRun ? `Last published ${fmtDate(lastRun)}.` : 'Not published from here yet.'),
      h('div.deploy-actions', {},
        publish,
        h('span.fnt.text-s', {}, runnable
          ? `Sends the site to “${runnable.label}”.`
          : 'Creates a folder of ready-to-upload website files.'),
      ),
      h('div.deploy-actions.mt-3', {},
        h('span.fnt.text-s', {}, 'Something look wrong?'),
        h('button.btn.ghost.small', { onclick: () => runChecks(out) }, iconEl('gauge', 13), 'Run the checks')),
      out)
  }

  async function draw() {
    body.replaceChildren(
      h('div.page-head', {}, h('div', {},
        h('h1', {}, 'Deploy'),
        h('p.sub', {}, 'Put your changes on the live website.')),
        helpButton('deploy', 'Deploy')),
      skeleton('rows', 3))

    const { profiles = [] } = await get('/deploy/profiles').catch(() => ({ profiles: [] }))
    // when it last went out: the activity log knows, if this account may read it
    let lastRun = prefs().lastPublishAt || null
    const { entries = [] } = await get('/audit').catch(() => ({ entries: [] }))
    const logged = entries.find(e => e.action === 'deploy.run' || e.action === 'export.run')
    if (logged && (!lastRun || new Date(logged.at) > new Date(lastRun))) lastRun = logged.at

    body.replaceChildren(
      h('div.page-head', {}, h('div', {},
        h('h1', {}, 'Deploy'),
        h('p.sub', {}, 'Put your changes on the live website.')),
        helpButton('deploy', 'Deploy')),

      heroSection(profiles, lastRun),

      h('details.deploy-tech', {},
        h('summary', {}, 'Technical details (for developers)'),
        h('div.deploy-tech-body', {},
          h('p.fnt.text-s.mt-0', {}, 'Export writes the built pages and assets into the project’s ', h('code', {}, 'dist'), ' folder.'),
          h('div.d-flex.gap-2.mb-4', {},
            h('button.btn.ghost', { onclick: () => { deep = !deep; draw() } }, iconEl(deep ? 'check' : 'gauge', 14), deep ? 'Deep checks on' : 'Include page weight'),
            h('button.btn.ghost', { onclick: draw }, iconEl('refresh', 14), 'Re-run')),
          targetCards(),
          deployTargets(),
          presetSection(),
          weightSection())))
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
          return h('div.card.p-3-4.mb-2', {},
            h('div.d-flex.items-center.gap-3.wrap', {},
              iconEl(p.kind === 'hook' ? 'link' : p.kind === 'command' ? 'code' : 'box', 16),
              h('div.grow.minw-10', {},
                h('strong.text-m', {}, p.label),
                h('div.fnt.text-xs', {}, `${p.kind} · needs ${p.minRole}+`)),
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
                  out.replaceChildren(h('pre.code-out.deploy-check-out', { style: { color: r.ok === false ? 'var(--err-ink)' : '' } }, (r.log || []).join('\n')))
                  toast(r.ok === false ? 'Deploy failed — see the log' : 'Deployed', r.ok === false ? 'err' : 'ok')
                },
              }, iconEl('rocket', 12), isProd ? 'Deploy live' : 'Deploy staging')),
            out)
        }) : [h('p.fnt.text-s', {}, 'No saved targets yet. A target bundles where a build goes (staging or production), how it gets there, and who may press the button. Credentials are stored encrypted.')]),
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
    return h('section.mb-5', {},
      h('h2.text-l.mb-1', {}, 'Deploy targets'),
      holder)
  }

  function presetSection() {
    const list = PRESETS[target] || []
    const out = h('div.stack-2', {})
    out.replaceChildren(...list.map(p => h('div.card.d-flex.items-center.justify-between.p-3-4', {},
      h('div', {},
        h('div.fw-semi.text-m', {}, p),
        h('div.fnt.text-xs', {}, PRESET_BLURB[p] || '')),
      h('button.btn.ghost.small', {
        onclick: async () => {
          const res = await get(`/deploy/preset/${p}`)
          const made = res.written.filter(w => !w.skipped).map(w => w.file)
          const kept = res.written.filter(w => w.skipped).map(w => w.file)
          await dialog({
            title: `${p} files`,
            body: h('div', {},
              made.length ? h('p', {}, 'Written:') : '',
              made.length ? h('ul.m-0-0-4-5', {}, ...made.map(f => h('li', {}, h('code', {}, f)))) : '',
              kept.length ? h('p.mut.text-m', {}, 'Left alone (already existed): ', kept.map(f => f).join(', ')) : '',
              h('p.mut.text-m', {}, 'They are written into the project folder, filled in from this site’s configuration. Review before committing.')),
            okLabel: 'Done',
          })
          toast(made.length ? `Wrote ${made.length} file${made.length === 1 ? '' : 's'}` : 'Nothing to write', 'ok')
        },
      }, iconEl('download', 13), 'Write files'))))
    return h('section.mb-5', {},
      h('h2.text-l.mb-1', {}, 'Deployment files'),
      list.length ? out : h('p.mut', {}, 'No presets for this target.'))
  }

  function weightSection() {
    const holder = h('div', {}, skeleton('rows', 4))
    get('/budget').then(({ pages, budget, median, failures }) => {
      const bar = p => {
        const pct = Math.min(100, Math.round((p.total / budget.total) * 100))
        return h('div.deploy-budget-row', {},
          h('code.text-s.ovh.tov-ellipsis.nowrap', {}, p.path),
          h('div.deploy-bar', {},
            h('div.deploy-budget-fill', { style: { width: `${pct}%`, background: p.over.length ? 'var(--warn)' : 'var(--acc)' } })),
          h('span.fnt.deploy-budget-size', { class: p.over.length ? 'over' : '' }, fmtKb(p.total)))
      }
      holder.replaceChildren(
        h('p.fnt.text-s.mb-2', {},
          `Median page ${fmtKb(median)} against a ${fmtKb(budget.total)} budget. ${failures ? `${failures} page${failures === 1 ? ' is' : 's are'} over.` : 'Every page inside budget.'} Bars show HTML + CSS + JS; images are counted separately.`),
        h('div.card.p-2-4', {}, ...pages.map(bar)))
    }).catch(e => holder.replaceChildren(h('p.mut', {}, String(e.message || e))))
    return h('section', {},
      h('h2.text-l.mb-1', {}, 'Page weight'),
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
