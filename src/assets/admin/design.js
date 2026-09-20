// Design — the site's visual system in one place, with the site itself as the
// preview. Sliders inject tokens into the live iframe instantly (no reload, no
// save); nothing touches the real site until you press Save.

import { get, put, post, del } from './api.js'
import { h, debounce, toast, fitPreviewFrame, dialog, confirmDialog, unsavedDialog } from './ui.js'
import { registerView, registerGuard } from './state.js'
import { helpButton } from './help.js'
import { icon, iconEl } from './icons.js'

const TEMPLATES = [
  { name: 'aurora', title: 'Aurora', blurb: 'Bright and rounded. A good all-rounder for a company website.', hue: 275, chroma: 0.16, radius: 14, font: 'Sans', display: 'ui-sans-serif' },
  { name: 'ledger', title: 'Ledger', blurb: 'Traditional lettering with plenty of space. Suits long reading.', hue: 28, chroma: 0.11, radius: 3, font: 'Serif', display: 'Georgia, serif' },
  { name: 'atelier', title: 'Atelier', blurb: 'Big bold headings and square corners. Makes a strong first impression.', hue: 22, chroma: 0.19, radius: 0, font: 'Display', display: 'ui-sans-serif' },
  { name: 'console', title: 'Console', blurb: 'Tight and plain. Best where there is a lot of detail to show.', hue: 215, chroma: 0.13, radius: 8, font: 'Sans', display: 'ui-sans-serif' },
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
  const iframe = h('iframe.design-frame', { title: 'Site preview', src: `/?__blockhousepreview=1&__ts=${++seq}` })
  const pushTokens = debounce(() => {
    iframe.contentWindow?.postMessage({
      blockhouse: 'tokens',
      tokens: { hue: String(work.hue), 'accent-chroma': String(work.chroma), radius: `${work.radius}px` },
    }, '*')
  }, 60)
  iframe.addEventListener('load', () => pushTokens.now())

  const markDirty = () => { dirty = true; saveBtn.textContent = 'Save design •'; pushTokens() }

  // ---------- save ----------

  async function saveDesign() {
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
      iframe.src = `/?__blockhousepreview=1&__ts=${++seq}`
    toast('Design saved — the live site now matches the preview', 'ok')
  }
  const saveBtn = h('button.btn.primary', { onclick: saveDesign }, 'Save design')

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
        // Defensive: the list has served stray files (a LICENSE entry) before.
        // Anything unknown must at least carry a title of its own to be shown.
        if (!t.meta?.label) continue
        allTemplates.push({
          name: t.name, title: t.meta.label,
          blurb: t.meta?.description || 'A look installed from a theme file.',
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
        title: 'Install a theme file',
        width: 'min(30rem, 94vw)',
        body: h('div', {},
          h('p.dlg-text', {}, 'Only do this if a designer has given you a .zip theme file. Blockhouse checks the file is complete and unaltered before it installs. Your pages and content are not touched.'),
          h('div.field', {}, h('label', {}, 'Theme file (.zip)'), file),
          h('div.field', {}, h('label', {}, 'Licence key (only if the designer gave you one)'), lic)),
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
            for (const t of fresh.themes.filter(x => x.source === 'installed' && x.meta?.label)) {
              allTemplates.push({ name: t.name, title: t.meta.label, blurb: t.meta?.description || 'A look installed from a theme file.', hue: 200, chroma: 0.1, radius: 8, font: 'Custom', display: 'inherit', _pkg: t.pkg, _source: t.source })
            }
            paintTpls(); return true
          },
        }],
      })
    },
  }, iconEl('upload', 13), 'Install a theme file')

  const tplGrid = h('div.design-tpls')
  const paintTpls = () => {
    tplGrid.replaceChildren(...allTemplates.map(t => h('button.design-tpl', {
      class: pendingTemplate === t.name ? 'active' : '',
      onclick: async () => {
        if (t.name !== pendingTemplate &&
          !(await confirmDialog(`Switch to ${t.title}?`,
            'Your pages and content stay exactly as they are; only the look changes. It brings its own colour and corner settings, replacing the ones below.',
            'Switch'))) return
        pendingTemplate = t.name
        work.hue = t.hue; work.chroma = t.chroma; work.radius = t.radius
        paintTpls(); paintSliders()
        markDirty()
        // template change needs a real re-render — draft it via save-less reload:
        // preview keeps current template until Save, so make that explicit
        const cur = allTemplates.find(x => x.name === settings.template)
        note.textContent = pendingTemplate === settings.template
          ? 'Move the sliders above — the preview changes as you go.'
          : `The preview still shows “${cur?.title || settings.template}” — press Save design to switch to ${t.title}.`
      },
    },
      h('div.design-tpl-head', {},
        h('strong', { style: { fontFamily: t.display } }, t.title),
        pendingTemplate === t.name ? h('span.design-tpl-current', {}, iconEl('check', 13), 'Current') : ''),
      h('div.design-tpl-dots', {}, swatch(t.hue), swatch((t.hue + 40) % 360), h('span.design-dot', { style: { background: 'light-dark(#1d1d1f, #eee)' } })),
      h('p', {}, t.blurb),
      h('span.design-tpl-meta', {},
        t._source === 'installed'
          ? `Installed theme${t._pkg ? ` · version ${t._pkg.version}` : ''}${t._pkg?.verified === true ? ' · signature checked' : t._pkg?.verified === false ? ' · no signature' : ''}`
          : `${t.font} lettering · ${t.radius === 0 ? 'square corners' : `${t.radius}px rounded corners`}`),
      t._source === 'installed' ? h('span.mrow-tools.mt-1.d-iflex.gap-1', {},
        h('button.btn.ghost.small', { onclick: async e => {
          e.stopPropagation()
          const r = await post(`/packages/template/${t.name}/verify`, {})
          toast(r.ok ? `All ${r.checked} files are exactly as the designer supplied them` : `Something has changed since install: ${r.problems[0]}`, r.ok ? 'ok' : 'err', 5000)
        } }, 'Check files'),
        h('button.btn.ghost.small', { onclick: async e => {
          e.stopPropagation()
          if (!(await confirmDialog('Remove theme', `Delete the installed theme “${t.title}”?`, 'Remove'))) return
          await del(`/themes/${t.name}`)
          allTemplates = allTemplates.filter(x => x.name !== t.name)
          paintTpls()
        } }, 'Remove')) : '')))
  }

  const note = h('p.fnt.design-note.design-tpl-note', {}, 'Move the sliders above — the preview changes as you go.')

  const slider = (label, min, max, step, getV, setV, fmt) => {
    const out = h('output.range-out', {}, fmt(getV()))
    const input = h('input', {
      // A screen reader read these out as "slider, 275" with no word for
      // what was being moved: give each one its visible caption.
      'aria-label': label,
      type: 'range', min, max, step, value: getV(),
      oninput: e => { setV(parseFloat(e.target.value)); out.value = fmt(getV()); markDirty() },
    })
    const row = h('div.design-slider', {},
      h('label', {}, label),
      h('div.d-flex.gap-3.items-center', {}, input, out))
    row.sync = () => { input.value = getV(); out.value = fmt(getV()) }
    return row
  }

  const hueRow = slider('Main colour', 0, 360, 1, () => work.hue, v => (work.hue = v), v => `${Math.round(v)}°`)
  hueRow.querySelector('input').classList.add('hue-track')
  const chromaRow = slider('How strong the colour is', 0.01, 0.2, 0.005, () => work.chroma, v => (work.chroma = v), v => v.toFixed(3))
  const radiusRow = slider('Corner roundness', 0, 24, 1, () => work.radius, v => (work.radius = v), v => `${Math.round(v)}px`)
  const paintSliders = () => { hueRow.sync(); chromaRow.sync(); radiusRow.sync() }

  const resetLink = h('button.design-reset', {
    onclick: () => {
      const d = tplDef()
      work.hue = d.hue; work.chroma = d.chroma; work.radius = d.radius
      paintSliders(); markDirty()
    },
  }, 'Reset to the template’s defaults')

  // Light or dark — moved here from Settings so every look-and-feel choice
  // sits on one screen.
  const schemeVal = { colorScheme: theme.colorScheme || 'auto', showToggle: theme.showToggle !== false }
  const toggleRow = h('label.field-check.design-toggle-row', {},
    h('input', { type: 'checkbox', checked: schemeVal.showToggle, onchange: e => { schemeVal.showToggle = e.target.checked; dirty = true; saveBtn.textContent = 'Save design •' } }),
    h('span', {}, 'Show a light/dark switch in the header'))
  const syncToggleRow = () => { toggleRow.hidden = schemeVal.colorScheme !== 'auto' }
  const schemeRadios = h('div.design-scheme', {}, ...[
    ['auto', 'Match each visitor’s device'],
    ['light', 'Always light'],
    ['dark', 'Always dark'],
  ].map(([k, l]) => h('label.field-check', {},
    h('input', {
      type: 'radio', name: 'design-scheme', value: k, checked: schemeVal.colorScheme === k,
      onchange: () => { schemeVal.colorScheme = k; syncToggleRow(); dirty = true; saveBtn.textContent = 'Save design •' },
    }),
    h('span', {}, l))))
  syncToggleRow()

  const controls = h('div.design-controls', {},
    h('div.page-head.design-head', {},
      h('div', {}, h('h1', {}, 'Design'),
        h('p.sub', {}, 'Choose a look, then tune its colour and shape. The preview is your real site; nothing changes for visitors until you press Save.')),
      h('div.design-head-acts', {}, helpButton('design', 'Design'), saveBtn)),

    h('h2.design-h', {}, 'Colour & shape'),
    h('div.card.design-card', {},
      hueRow, chromaRow, radiusRow,
      h('p.fnt.design-note', {}, 'Two sliders drive every colour on the site: hue turns them all together, intensity sets how strong the main colour is. Both work in light and dark.'),
      resetLink),

    h('h2.design-h', {}, 'Light or dark'),
    h('div.card.design-card', {},
      schemeRadios, toggleRow,
      h('p.fnt.design-note', {}, 'Pick “Always light” or “Always dark” to show everyone the same thing.')),

    h('h2.design-h', {}, 'Template'),
    h('div.design-tpl-intro', {},
      h('p.fnt.design-note', {}, 'The template sets the shape of the pages — headings, spacing and lettering.'),
      installThemeBtn,
      h('p.fnt.design-note', {}, 'Only if a designer gave you a .zip')),
    tplGrid, note,

    h('h2.design-h', {}, 'Elsewhere'),
    h('div.card.design-card', {},
      h('a.design-more-link', { href: '#/settings' }, 'Fonts, brand values and custom code →'),
      h('p.fnt.design-note', {}, 'Custom fonts, your own reusable brand values and site-wide code live under Settings.')))

  const frameHolder = h('div.design-frame-holder', {}, iframe)
  const unfit = fitPreviewFrame(frameHolder, iframe, 1280)

  root.replaceChildren(h('div.design-studio', {},
    controls,
    h('div.design-preview', {},
      h('div.design-preview-bar', {},
        h('span.fnt.text-s.d-iflex.gap-2.items-center', {}, iconEl('eye', 13), 'Live preview'),
        h('button.btn.ghost.small', { onclick: () => (iframe.src = `/?__blockhousepreview=1&__ts=${++seq}`) }, iconEl('refresh', 13), 'Reload')),
      frameHolder)))

  paintTpls()
  paintSliders()
  // `dirty` was written in four places and read in none: every unsaved palette
  // tweak vanished on the next click with nothing said.
  const disposeGuard = registerGuard('design', async () => {
    if (!dirty) return true
    return await unsavedDialog({
      title: 'Unsaved design changes',
      body: 'The template, palette or colour scheme has changes that are not live yet.',
      saveLabel: 'Save design',
      onSave: saveDesign,
    })
  })
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  addEventListener('beforeunload', beforeUnload)
  return () => { unfit(); disposeGuard(); removeEventListener('beforeunload', beforeUnload) }
})
