// Dynamic help — documentation generated from THIS site's live state.
//
// Everything here is derived: your concepts and the real URLs they produce,
// the blocks you actually have, your menus, the plugins you approved and what
// they can do, your deploy commands with your real URL and paths, plus health
// checks that read current content. Nothing is boilerplate.

import type { BlockhouseEnv } from './env.ts'
import { hrefFor, shortPath } from '../core/urls.ts'
import { validateSite } from '../agent/validate.ts'

export interface HelpSection {
  id: string
  title: string
  summary: string
  /** rendered as definition rows in the studio */
  facts?: { label: string; value: string; hint?: string }[]
  steps?: string[]
  code?: { label: string; lang?: string; body: string }[]
  links?: { label: string; href: string; external?: boolean }[]
  warnings?: string[]
}

export async function buildHelp(env: BlockhouseEnv, topic?: string): Promise<{ sections: HelpSection[]; site: any }> {
  const site = await env.site()
  const concepts = await env.content.concepts()
  const docs = await env.content.listDocs()
  const published = docs.filter(d => d.status === 'published')
  const menus = await env.content.menus()
  const blocks = [...env.registry.blocks.values()]
  const media = await env.media.list()
  const plugins = [...env.registry.plugins.values()]
  const enabledPlugins = plugins.filter(p => site.plugins?.[p.id]?.enabled)
  const urlStyleLabel = { directory: '/about/ (folder + index.html)', extension: '/about.html', bare: '/about' }[site.urls?.style || 'directory']

  const sections: HelpSection[] = []

  // ---------- your site at a glance ----------
  sections.push({
    id: 'overview',
    title: 'This site, right now',
    summary: `“${site.name}” runs the ${site.template} template and publishes to ${site.url}.`,
    facts: [
      { label: 'Live URL', value: site.url },
      { label: 'Template', value: site.template, hint: `files resolve from site/overrides → sites/*/templates/${site.template} → templates/${site.template}` },
      { label: 'Colour scheme', value: site.theme?.colorScheme === 'auto' ? 'Follows the visitor’s OS (toggle shown)' : `Locked to ${site.theme?.colorScheme} — the toggle is hidden`, },
      { label: 'Content', value: `${docs.length} document${docs.length === 1 ? '' : 's'} · ${published.length} published · ${concepts.length} type${concepts.length === 1 ? '' : 's'}` },
      { label: 'Assets', value: `${media.length} file${media.length === 1 ? '' : 's'}${media.filter(m => !m.alt && m.type.startsWith('image/')).length ? ` · ${media.filter(m => !m.alt && m.type.startsWith('image/')).length} image(s) missing alt text` : ''}` },
      { label: 'Plugins enabled', value: enabledPlugins.length ? enabledPlugins.map(p => p.name).join(', ') : 'none yet' },
      { label: 'Blocks available', value: `${blocks.length} (${[...new Set(blocks.map(b => b.group))].join(', ')})` },
    ],
    links: [{ label: 'Open the live site', href: site.url, external: true }],
  })

  // ---------- your content types & the URLs they make ----------
  const conceptFacts = await Promise.all(concepts.map(async c => {
    const sample = docs.find(d => d.concept === c.name)
    const path = sample ? await env.content.docPath(sample) : (c.urlPattern || '/{slug}').replace('{slug}', 'example')
    return {
      label: `${c.labelPlural || c.label} (${c.name})`,
      value: `${site.url}${hrefFor(path, site)}`,
      hint: `${docs.filter(d => d.concept === c.name).length} document(s)` +
        (c.indexPath ? ` · index at ${site.url}${c.indexPath}` : ' · no index page') +
        (c.feed ? ` · RSS at ${c.indexPath}/feed.xml` : '') +
        (c.fields?.length ? ` · extra fields: ${c.fields.map(f => f.key).join(', ')}` : ''),
    }
  }))
  sections.push({
    id: 'content',
    title: 'Your content types and their URLs',
    summary: `URL style is “${urlStyleLabel}”${site.urls?.layout === 'flat' ? ', and every document sits at the root (flat layout)' : ', following each type’s pattern'}.`,
    facts: conceptFacts,
    steps: [
      'Create: use ＋ New in the sidebar, or the ⌘K palette.',
      'Edit: double-click any text in the preview to edit it in place; use the inspector for structured fields.',
      'Publish: the button in the editor toolbar. Drafts never appear on the live site.',
      site.urls?.shortlinks ? `Shortlinks are on — every doc also answers at ${site.url}/${site.urls.shortlinkPrefix || 's'}/<code>.` : 'Shortlinks are off (turn them on in Settings → URLs to get /s/<code> links).',
    ],
  })

  // ---------- navigation ----------
  const menuFacts = menus.map(m => {
    const megas = m.items.filter(i => i.mega).length
    return {
      label: m.label || m.key,
      value: `${m.items.length} top-level item(s)${megas ? ` · ${megas} mega panel(s)` : ''}`,
      hint: m.items.map(i => i.label).join(' · ') || 'empty',
    }
  })
  sections.push({
    id: 'menus',
    title: 'Navigation',
    summary: menus.length ? 'Menus render through {% menu \'key\' %} in your template.' : 'No menus yet — create “main” to fill the header.',
    facts: menuFacts,
    steps: [
      'Showcase mega panels take image cards with a price/sublabel and become a full-screen drill-down on mobile automatically.',
      'Column panels take link lists (with icons + descriptions) and can embed blocks.',
      'Set an item to “auto” with a concept to keep it filled with your latest content, no maintenance.',
    ],
  })

  // ---------- editing blocks ----------
  const byGroup: Record<string, string[]> = {}
  for (const b of blocks) (byGroup[b.group] ??= []).push(b.label)
  sections.push({
    id: 'blocks',
    title: 'Blocks you can use here',
    summary: `${blocks.length} block types are registered for this site — including any your template adds.`,
    facts: Object.entries(byGroup).map(([group, list]) => ({ label: group, value: list.join(', ') })),
    steps: [
      'Container blocks (Section, Columns, FAQ, Tabs, Accordion) hold other blocks — build layout by nesting.',
      `Template blocks live in templates/${site.template}/blocks/*.json + .liquid — add a pair of files and they appear in the picker.`,
      'Any text field accepts {{var.key}} to pull a brand variable (Settings → Brand).',
    ],
  })

  // ---------- brand variables ----------
  const vars = site.vars || {}
  if (Object.keys(vars).length || (site.varDefs || []).length) {
    sections.push({
      id: 'brand',
      title: 'Brand variables',
      summary: 'Write these once, use them anywhere — in blocks with {{var.key}} and in templates with {{ vars.key }}.',
      facts: Object.entries(vars).map(([k, v]) => ({ label: `{{var.${k}}}`, value: String(v).slice(0, 80) })),
    })
  }

  // ---------- plugins, with what they may actually do ----------
  for (const p of enabledPlugins) {
    const approved = site.plugins?.[p.id]?.approved || []
    sections.push({
      id: `plugin-${p.id}`,
      title: `${p.name} (plugin)`,
      summary: p.description || '',
      facts: [
        { label: 'Approved capabilities', value: approved.join(', ') || 'none — the plugin can’t do anything yet' },
        { label: 'Not approved', value: p.permissions.filter(x => !approved.includes(x)).join(', ') || '—' },
      ],
      warnings: approved.length < p.permissions.length
        ? [`${p.name} declared ${p.permissions.length} capabilities but only ${approved.length} are approved. Anything unapproved throws at runtime — approve it in Studio → Plugins if a feature seems missing.`]
        : [],
    })
  }

  // ---------- deployment, with real commands ----------
  const dir = (env as any).projectDir || 'sites/<your-site>'
  sections.push({
    id: 'deploy',
    title: 'Publishing this site',
    summary: 'Three ways to ship, all from the same content.',
    code: [
      { label: 'Flat static build (Pages, Netlify, S3, nginx)', lang: 'bash', body: `blockhouse export --dir ${dir}\n# → ${dir}/dist  ·  URL style: ${urlStyleLabel}` },
      { label: 'Live server (VPS, container)', lang: 'bash', body: `BLOCKHOUSE_SITE_URL=${site.url} blockhouse serve --dir ${dir} --port 8787` },
      { label: 'Cloudflare Workers (R2 + D1)', lang: 'bash', body: `# wrangler.toml bindings: SITE (R2), DB (D1), secret BLOCKHOUSE_SECRET\nnpx wrangler deploy` },
      { label: 'Health check before shipping', lang: 'bash', body: `blockhouse check --dir ${dir}   # content integrity\nblockhouse doctor --dir ${dir}  # stack + config diagnosis` },
    ],
    facts: [
      { label: 'Canonical URL', value: site.url, hint: 'Change it in Settings → Identity, or set BLOCKHOUSE_SITE_URL' },
      { label: 'Image provider', value: site.images.provider === 'cloudflare' ? 'Cloudflare Image Resizing (/cdn-cgi/image/…)' : 'local sharp derivatives' },
      { label: 'Search index on export', value: site.build?.generateSearchIndex === false ? 'off' : 'on (x/search/index.json)' },
    ],
  })

  // ---------- security posture ----------
  const sec = site.security || {}
  sections.push({
    id: 'security',
    title: 'Security posture',
    summary: 'What this install currently enforces.',
    facts: [
      { label: 'Content-Security-Policy', value: sec.csp === 'off' ? 'disabled' : `${sec.csp || 'balanced'} (public pages)` },
      { label: 'HSTS', value: sec.hsts ? 'on (https only)' : 'off — enable once you serve HTTPS everywhere' },
      { label: 'Framing', value: `frame-ancestors ${sec.frameAncestors || "'none'"}` },
      { label: 'Login lockout', value: `${sec.maxLoginAttempts ?? 8} attempts, then ${sec.lockoutMinutes ?? 15} minutes` },
      { label: 'Admin network allowlist', value: sec.adminAllowlist?.length ? sec.adminAllowlist.join(', ') : 'open to any IP' },
      { label: 'Audit log', value: sec.auditLog === false ? 'off' : 'on — see Users → Audit' },
      { label: 'Password minimum', value: `${sec.minPasswordLength ?? 8} characters` },
    ],
    warnings: [
      ...(site.url.startsWith('https') && !sec.hsts ? ['You publish over HTTPS but HSTS is off — turn it on in Settings → Security once you’re confident.'] : []),
      ...(!sec.adminAllowlist?.length && site.url.startsWith('https') ? ['The studio is reachable from any network. Consider an admin IP allowlist for production.'] : []),
    ],
  })

  // ---------- live health checks ----------
  const issues = await validateSite(env)
  const noAlt = media.filter(m => m.type.startsWith('image/') && !m.alt).length
  const noDesc = docs.filter(d => !d.seo?.description).length
  sections.push({
    id: 'health',
    title: 'Health check (live)',
    summary: issues.length ? `${issues.filter(i => i.level === 'error').length} error(s), ${issues.filter(i => i.level === 'warn').length} warning(s) in content.` : 'Content integrity is clean.',
    facts: [
      { label: 'Broken references', value: issues.length ? issues.slice(0, 6).map(i => `${i.where}: ${i.message}`).join(' · ') : 'none' },
      { label: 'Images without alt text', value: String(noAlt) },
      { label: 'Pages without a meta description', value: String(noDesc) },
      { label: 'Unpublished drafts', value: String(docs.length - published.length) },
    ],
  })

  return { sections: topic ? sections.filter(s => s.id === topic || s.id.startsWith(topic)) : sections, site: { name: site.name, url: site.url, template: site.template } }
}

/** Short, context-aware tips shown inside individual studio panels. */
export async function contextTips(env: BlockhouseEnv, panel: string): Promise<string[]> {
  const site = await env.site()
  const docs = await env.content.listDocs()
  switch (panel) {
    case 'content':
      return [
        `${docs.length} document(s) across ${(await env.content.concepts()).length} type(s). The left rail filters; the counts are live.`,
        'Tick several rows to publish them together — useful after a round of edits.',
        'Documents with unpublished edits show an "edits" chip: the draft is newer than what visitors see.',
        'Sort by Title, Status or Updated from the column headings; the choice is remembered.',
      ]
    case 'chrome':
      return [
        'This is the CONTENT poured into the header and footer — the structure around it is a template file under Templates.',
        'Each slot is a place the template calls for content; an empty slot renders nothing at all.',
        'Changes here apply to every page on the site at once.',
      ]
    case 'deploy':
      return [
        'Run the checks before deploying — they catch missing URLs, oversized pages and insecure settings.',
        `This site is configured for ${site.url || 'no canonical URL yet'}.`,
        'A static export writes a flat site you can host anywhere; the live server is only needed for the studio.',
      ]
    case 'editor':
      return [
        'Double-click any heading or paragraph in the preview to edit it in place.',
        'Select a block and use the floating toolbar to move, duplicate or delete it.',
        `Publishing writes a snapshot; the live site at ${site.url} only serves snapshots.`,
      ]
    case 'media':
      return [
        'Drag files onto the page to upload — they land in the folder you have selected.',
        'Click an image, then “Edit image…” to crop/resize/convert. The original is kept.',
        'Set a focal point so cropped thumbnails keep the subject in frame.',
      ]
    case 'types':
      return [
        'A content type is a shape: its fields, its URL pattern, its templates. Documents are instances of it.',
        'Fields you add here appear in the editor’s Page tab and in templates as {{ fields.key }}.',
        'Give a type an index page and every published item lists there automatically — with RSS if you want it.',
      ]
    case 'design':
      return [
        'Sliders preview instantly on the real site — nothing changes until you press Save design.',
        'Hue rotates the entire palette; intensity controls how vivid the accent is. Both respect dark mode.',
        'Switching templates never touches your content — every block renders in every template.',
      ]
    case 'menus':
      return [
        'The preview renders from a draft — the live menu only changes when you press Save.',
        'Panel → Catalogue gives the full-screen tabbed layout: categories across the top, list left, detail right.',
        'Entries inside panels take an image, a category line and a description — that is the whole detail pane.',
      ]
    case 'seo':
      return [
        `${docs.filter(d => !d.seo?.description).length} page(s) still need a meta description.`,
        'Set a focus keyword on a page to unlock keyword placement checks.',
        'Slug changes create automatic 301s — old URLs keep working.',
      ]
    case 'settings':
      return [
        site.theme?.colorScheme === 'auto'
          ? 'Colour scheme follows each visitor’s OS. Lock it to light or dark if your brand needs one look.'
          : `Your site is locked to ${site.theme?.colorScheme} mode — the visitor toggle is hidden.`,
        'Brand variables become {{var.key}} anywhere in content, so a phone number or claim changes in one place.',
      ]
    default:
      return []
  }
}
