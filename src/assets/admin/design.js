// Design — the site's visual system in one place, with the site itself as the
// preview. Sliders inject tokens into the live iframe instantly (no reload, no
// save); nothing touches the real site until you press Save.

import { get, put, post, del } from './api.js'
import { h, debounce, toast, fitPreviewFrame, dialog, confirmDialog } from './ui.js'
import { registerView } from './state.js'
import { icon, iconEl } from './icons.js'

const TEMPLATES = [
  { name: 'aurora', title: 'Aurora', blurb: 'Luminous and rounded — product sites, studios, SaaS marketing.', hue: 275, chroma: 0.16, radius: 14, font: 'Sans', display: 'ui-sans-serif' },
  { name: 'ledger', title: 'Ledger', blurb: 'Editorial serif — journals, essays, considered brands.', hue: 28, chroma: 0.11, radius: 3, font: 'Serif', display: 'Georgia, serif' },
  { name: 'atelier', title: 'Atelier', blurb: 'Square, loud display type — portfolios and statement sites.', hue: 22, chroma: 0.19, radius: 0, font: 'Display', display: 'ui-sans-serif' },
  { name: 'console', title: 'Console', blurb: 'Compact and cool — documentation, dashboards, dev tools.', hue: 215, chroma: 0.13, radius: 8, font: 'Sans', display: 'ui-sans-serif' },
]

registerView('design', async root => {
  const { settings } = await get('/settings')
  const theme = settings.theme || {}
  const tokens = { ...(theme.tokens || {}) }

  let pendingTemplate = settings.template || 'aurora'
  const tplDef = () => TEMPLATES.find(t => t.name === pendingTemplate) || TEMPLATES[0]

  // working values: explicit token override, else the template default
  const val = (key, fallback) => {
    const v = tokens[key]
    if (v === undefined || v === '') return fallback
    return parseFloat(String(v))
  }
  const work = {
    hue: val('hue', tplDef().hue),
    chroma: val('accent-chroma', tplDef().chroma),
    radius: val('radius', tplDef().radius),
  }
  let dirty = false

  // ---------- live preview ----------

  let seq = 0
  const iframe = h('iframe.design-frame', { title: 'Site preview', src: `/?__ts=${++seq}` })
  const pushTokens = debounce(() => {
    iframe.contentWindow?.postMessage({
      blockhouse: 'tokens',
      tokens: { hue: String(work.hue), 'accent-chroma': String(work.chroma), radius: `${work.radius}px` },
    }, '*')
  }, 60)
  iframe.addEventListener('load', () => pushTokens.now())

  const markDirty = () => { dirty = true; saveBtn.textContent = 'Save design •'; pushTokens() }

  // ---------- save ----------

  const saveBtn = h('button.btn.primary', {
    onclick: async () => {
      const nextTokens = { ...tokens }
      const d = tplDef()
      // only persist tokens that differ from the template's own defaults —
      // keeps site.json minimal and lets a template switch bring its palette
      const setOrClear = (key, value, def) => {
        if (Math.abs(value - def) < 0.0001) delete nextTokens[key]
        else nextTokens[key] = key === 'radius' ? `${value}px` : String(value)
      }
      setOrClear('hue', work.hue, d.hue)
      setOrClear('accent-chroma', work.chroma, d.chroma)
      setOrClear('radius', work.radius, d.radius)
      await put('/settings', {
        patch: {
          template: pendingTemplate,
          theme: { ...theme, tokens: nextTokens, colorScheme: schemeVal.colorScheme, showToggle: schemeVal.showToggle },
        },
      })
      Object.assign(tokens, nextTokens)
      dirty = false
      saveBtn.textContent = 'Saved ✓'
      setTimeout(() => (saveBtn.textContent = 'Save design'), 1400)
      iframe.src = `/?__ts=${++seq}`
      toast('Design saved — the live site now matches the preview', 'ok')
    },
  }, 'Save design')

  // ---------- controls ----------

  const swatch = hue => h('span.design-dot', { style: { background: `oklch(58% 0.14 ${hue})` } })

  // merge built-in metadata with installed theme packages
  let allTemplates = [...TEMPLATES]
  get('/themes').then(({ themes }) => {
    for (const t of themes) {
      if (allTemplates.some(x => x.name === t.name)) {
        const known = allTemplates.find(x => x.name === t.name)
        known._pkg = t.pkg; known._source = t.source
      } else {
        allTemplates.push({
          name: t.name, title: t.meta?.label || t.name,
          blurb: t.meta?.description || 'Installed theme package.',
          hue: 200, chroma: 0.1, radius: 8, font: 'Custom', display: 'inherit',
          _pkg: t.pkg, _source: t.source,
        })
      }
    }
    paintTpls()
  }).catch(() => {})

  const installThemeBtn = h('button.btn.ghost.small', {
    onclick: () => {
      const file = h('input', { type: 'file', accept: '.zip' })
      const lic = h('input.input', { placeholder: 'Licence key (optional)' })
      dialog({
        title: 'Install a theme',
        width: 'min(30rem, 94vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'A theme package is a zip with layout.liquid at its root and a blockhouse-package.json manifest. Checksums verify on install; signed themes verify against your trusted issuers.'),
          h('div.field', {}, h('label', {}, 'Theme (.zip)'), file),
          h('div.field', {}, h('label', {}, 'Licence key'), lic)),
        actions: [{
          label: 'Install', kind: 'primary', onClick: async () => {
            if (!file.files[0]) { toast('Choose a theme zip', 'err'); return false }
            const fd = new FormData()
            fd.append('file', file.files[0])
            if (lic.value) fd.append('licenseKey', lic.value)
            const r = await post('/themes/install', fd)
            toast(r.problems?.length ? `Installed with warnings: ${r.problems[0]}` : `Installed “${r.name}” — pick it below`, r.problems?.length ? 'err' : 'ok', 6000)
            const fresh = await get('/themes')
            allTemplates = allTemplates.filter(t => t._source !== 'installed')
            for (const t of fresh.themes.filter(x => x.source === 'installed')) {
              allTemplates.push({ name: t.name, title: t.meta?.label || t.name, blurb: t.meta?.description || 'Installed theme package.', hue: 200, chroma: 0.1, radius: 8, font: 'Custom', display: 'inherit', _pkg: t.pkg, _source: t.source })
            }
            paintTpls(); return true
          },
        }],
      })
    },
  }, iconEl('upload', 13), 'Install theme')

  const tplGrid = h('div.design-tpls')
  const paintTpls = () => {
    tplGrid.replaceChildren(...allTemplates.map(t => h('button.design-tpl', {
      class: pendingTemplate === t.name ? 'active' : '',
      onclick: () => {
        pendingTemplate = t.name
        work.hue = t.hue; work.chroma = t.chroma; work.radius = t.radius
        paintTpls(); paintSliders()
        markDirty()
        // template change needs a real re-render — draft it via save-less reload:
        // preview keeps current template until Save, so make that explicit
        note.textContent = pendingTemplate === settings.template
          ? 'Adjust the palette below — the preview updates instantly.'
          : `Preview still shows “${settings.template}” — press Save design to apply ${t.title}.`
      },
    },
      h('div.design-tpl-head', {},
        h('strong', { style: { fontFamily: t.display } }, t.title),
        pendingTemplate === t.name ? iconEl('check', 14) : ''),
      h('div.design-tpl-dots', {}, swatch(t.hue), swatch((t.hue + 40) % 360), h('span.design-dot', { style: { background: 'light-dark(#1d1d1f, #eee)' } })),
      h('p', {}, t.blurb),
      h('span.design-tpl-meta', {},
        t._source === 'installed'
          ? `installed${t._pkg ? ` · v${t._pkg.version}` : ''}${t._pkg?.verified === true ? ' · ✓ signed' : t._pkg?.verified === false ? ' · unsigned' : ''}`
          : `${t.font} · radius ${t.radius}px`),
      t._source === 'installed' ? h('span.mrow-tools', { style: { marginTop: '0.3rem', display: 'inline-flex', gap: '0.3rem' } },
        h('button.btn.ghost.small', { onclick: async e => {
          e.stopPropagation()
          const r = await post(`/packages/template/${t.name}/verify`, {})
          toast(r.ok ? `Verified — ${r.checked} files intact` : `Changed since install: ${r.problems[0]}`, r.ok ? 'ok' : 'err', 5000)
        } }, 'Verify'),
        h('button.btn.ghost.small', { onclick: async e => {
          e.stopPropagation()
          if (!(await confirmDialog('Remove theme', `Delete the installed theme “${t.title}”?`, 'Remove'))) return
          await del(`/themes/${t.name}`)
          allTemplates = allTemplates.filter(x => x.name !== t.name)
          paintTpls()
        } }, 'Remove')) : '')))
  }

  const note = h('p.fnt', { style: { fontSize: '0.76rem', margin: '0.4rem 0 0' } }, 'Adjust the palette below — the preview updates instantly.')

  const slider = (label, min, max, step, getV, setV, fmt) => {
    const out = h('output', { style: { font: '600 0.78rem var(--mono)', minWidth: '3.4rem', textAlign: 'right' } }, fmt(getV()))
    const input = h('input', {
      type: 'range', min, max, step, value: getV(),
      oninput: e => { setV(parseFloat(e.target.value)); out.value = fmt(getV()); markDirty() },
    })
    const row = h('div.design-slider', {},
      h('label', {}, label),
      h('div', { style: { display: 'flex', gap: '0.7rem', alignItems: 'center' } }, input, out))
    row.sync = () => { input.value = getV(); out.value = fmt(getV()) }
    return row
  }

  const hueRow = slider('Accent hue', 0, 360, 1, () => work.hue, v => (work.hue = v), v => `${Math.round(v)}°`)
  hueRow.querySelector('input').classList.add('hue-track')
  const chromaRow = slider('Colour intensity', 0.01, 0.2, 0.005, () => work.chroma, v => (work.chroma = v), v => v.toFixed(3))
  const radiusRow = slider('Corner radius', 0, 24, 1, () => work.radius, v => (work.radius = v), v => `${Math.round(v)}px`)
  const paintSliders = () => { hueRow.sync(); chromaRow.sync(); radiusRow.sync() }

  const schemeVal = { colorScheme: theme.colorScheme || 'auto', showToggle: theme.showToggle !== false }
  const schemeSeg = h('div.seg', {}, ...[['auto', 'Auto'], ['light', 'Light only'], ['dark', 'Dark only']].map(([k, l]) =>
    h('button', {
      class: schemeVal.colorScheme === k ? 'active' : '',
      onclick: e => {
        schemeVal.colorScheme = k
        schemeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'))
        e.currentTarget.classList.add('active')
        dirty = true; saveBtn.textContent = 'Save design •'
      },
    }, l)))

  const controls = h('div.design-controls', {},
    h('div.page-head', { style: { marginBottom: '0.8rem' } },
      h('div', {}, h('h1', {}, 'Design'), h('p.sub', {}, 'Template, palette and scheme — previewed on the real site.')),
      saveBtn),

    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
      h('h2.design-h', {}, 'Template'), installThemeBtn),
    tplGrid, note,

    h('h2.design-h', {}, 'Palette'),
    h('div.card', { style: { padding: '0.9rem 1rem', display: 'grid', gap: '0.8rem' } },
      hueRow, chromaRow, radiusRow,
      h('p.fnt', { style: { fontSize: '0.74rem', margin: 0 } }, 'Two numbers drive the whole palette: hue rotates every colour together, intensity sets how vivid the accent is. Both work in light and dark automatically.')),

    h('h2.design-h', {}, 'Colour scheme'),
    h('div.card', { style: { padding: '0.9rem 1rem', display: 'grid', gap: '0.55rem' } },
      schemeSeg,
      h('label.field-check', {},
        h('input', { type: 'checkbox', checked: schemeVal.showToggle, onchange: e => { schemeVal.showToggle = e.target.checked; dirty = true; saveBtn.textContent = 'Save design •' } }),
        h('span', {}, 'Show the visitor theme toggle (auto mode)')),
      h('p.fnt', { style: { fontSize: '0.74rem', margin: 0 } }, 'Locking to one scheme pins the public site and the editor preview to it.')),

    h('h2.design-h', {}, 'More'),
    h('div.card', { style: { padding: '0.7rem 1rem', display: 'grid', gap: '0.35rem' } },
      h('a', { href: '#/settings', style: { fontSize: '0.83rem', fontWeight: 600 } }, 'Fonts, brand variables, custom CSS/JS →'),
      h('p.fnt', { style: { fontSize: '0.74rem', margin: 0 } }, 'Custom fonts, {{var.…}} brand values and global code live under Settings.')))

  const frameHolder = h('div.design-frame-holder', {}, iframe)
  const unfit = fitPreviewFrame(frameHolder, iframe, 1280)

  root.replaceChildren(h('div.design-studio', {},
    controls,
    h('div.design-preview', {},
      h('div.design-preview-bar', {},
        h('span.fnt', { style: { fontSize: '0.76rem', display: 'inline-flex', gap: '0.4rem', alignItems: 'center' } }, iconEl('eye', 13), 'Live preview'),
        h('button.btn.ghost.small', { onclick: () => (iframe.src = `/?__ts=${++seq}`) }, iconEl('refresh', 13), 'Reload')),
      frameHolder)))

  paintTpls()
  paintSliders()
  return () => unfit()
})
