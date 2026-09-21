// Help — written for the person who runs the business, not the person who
// built the software.
//
// Two halves. The owner half is task-based: "Add a new page", "Swap a photo",
// "Publish". Every step names the button as it is actually labelled in the
// studio. The developer half keeps the technical reference (template file
// paths, Liquid tags, deploy commands, security posture) behind a divider so
// it never gets in the way of someone who just wants to change a photo.
//
// The facts are still read from THIS site's live state — your real URL, your
// real content types, your real counts — so nothing here can drift.

import type { BlockhouseEnv } from './env.ts'
import { hrefFor, shortPath } from '../core/urls.ts'
import { validateSite } from '../agent/validate.ts'
import { analyzeSeo } from '../core/seo-analyze.ts'

/**
 * The SEO screen's own arithmetic, so the help panel beside it cannot quote a
 * different number for the same thing. A page whose ONLY real issue is the
 * missing description is the one the SEO list groups into a single row — and
 * that row's count is what the owner is looking at when they open this help.
 */
const SEO_SUGGESTIONS = [
  /^Focus keyword/, /^No picture for when the page is shared/,
  /^Search-result title is very short/, /^Search-result title may be cut off/,
  /^Short description is very brief/, /^Short description may be cut off/,
  /^The web address is very long/, /^This page is deliberately hidden/,
]
const NO_DESC = 'No short description for search results'
async function missingDescriptionCount(env: BlockhouseEnv): Promise<number> {
  const site = await env.site()
  const docs = await env.content.listDocs()
  const h1Types = [...(env as any).registry.blocks.values()].filter((b: any) => b.providesH1).map((b: any) => b.type)
  let n = 0
  for (const d of docs) {
    const concept = d.concept ? await env.content.concept(d.concept) : null
    const checks = analyzeSeo(d, site, { h1Types, templateH1: !!(concept as any)?.seo?.templateH1 })
    const real = checks.filter(ch => ch.level !== 'ok' && !SEO_SUGGESTIONS.some(re => re.test(ch.label)))
    if (real.length === 1 && real[0].label === NO_DESC) n++
  }
  return n
}

/** "1 thing" / "4 things" — never "4 thing(s)" in anything an owner reads. */
const plural = (n: number, word: string, plural_?: string) => `${n} ${n === 1 ? word : plural_ || word + 's'}`

export interface HelpSection {
  id: string
  title: string
  summary: string
  /** plain paragraphs, rendered one after another */
  paras?: string[]
  /** rendered as definition rows in the studio */
  facts?: { label: string; value: string; hint?: string }[]
  steps?: string[]
  code?: { label: string; lang?: string; body: string }[]
  links?: { label: string; href: string; external?: boolean }[]
  warnings?: string[]
  /** developer sections render under a "For developers" divider */
  audience?: 'owner' | 'developer'
  /** which heading the topic list files this under */
  group?: 'start' | 'tasks' | 'reference' | 'developer'
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

  // ---------- 1. start here ----------
  sections.push({
    id: 'start-here',
    title: 'Start here',
    summary: 'A two-minute tour of the studio, and the one rule that matters: nothing visitors see changes until you press Publish.',
    group: 'start',
    audience: 'owner',
    paras: [
      `This is the studio for ${site.name}. It is where you write the pages, pick the pictures, set the menu and decide what the website shows. Your website lives at ${site.url}; the studio is the private side of it, and only people you invite can open it.`,
      'The sidebar on the left has three parts. Content is your pages and everything written on them, plus your pictures and files. Site is the look and the wrapping around every page — the menu, the header and footer, colours and fonts, and what search engines see. Manage is the housekeeping: who can sign in, add-on apps, the record of who changed what, and publishing the whole site.',
      'Saving and publishing are two different things. Saving keeps your work — press ⌘S (Ctrl+S on Windows) or the Save button, and the studio holds on to it. Publishing puts it on the website. Nothing visitors see changes until you press Publish.',
      'Every screen has a ? button at the top. Press it and a panel slides in from the right telling you what you can do on that screen, with links into this guide. You can always come back here from the sidebar.',
      'Nothing is lost. Every time you save and every time you publish, the studio keeps a copy of how the page looked at that moment. If an edit goes wrong you can open the page history and put an older copy back, so it is safe to try things.',
    ],
  })

  // ---------- 2. everyday tasks ----------
  const task = (id: string, title: string, summary: string, steps: string[]) =>
    sections.push({ id, title, summary, steps, group: 'tasks', audience: 'owner' })

  task('add-page', 'Add a new page', 'Make a new page and give it an address on the website.', [
    'In the sidebar, press ＋ New at the top.',
    'Choose what you are making — a Page, or one of your other content types.',
    'Type the title. The web address is filled in for you from the title; change it if you want a shorter one.',
    'Press Create. The page opens in the editor, ready to write.',
    'Write your page, then press Save to keep it and Publish when you want visitors to see it.',
  ])

  task('edit-text', 'Change words on a page', 'Fix a typo or rewrite a paragraph.', [
    'Open the page from Content in the sidebar.',
    'Double-click the heading or paragraph you want to change — you type straight onto the page, exactly where it will appear.',
    'Click anywhere outside the text when you are done.',
    'Press Save (⌘S / Ctrl+S) to keep the change, then Publish to put it on the website.',
  ])

  task('photos', 'Swap or add a photo', 'Put a different picture on a page, or add a new one.', [
    'Open the page and click the picture you want to change.',
    'In the panel on the right, press Choose image. Your picture library opens.',
    'Pick an existing picture, or drag a new file onto the window to upload it.',
    'Write a short description of the picture in the Description (alt text) box — that is what blind visitors hear and what search engines read.',
    'Press Save, then Publish.',
  ])

  task('add-block', 'Add a new block', 'Blocks are the building pieces of a page — a heading, a paragraph, a picture, a row of cards.', [
    'Open the page. Hover between two existing blocks: a ＋ line appears.',
    'Press it to open the block picker, and choose the kind of piece you want.',
    'The new block is added where you pressed, and is selected so you can start filling it in.',
    'Use the panel on the right for the block’s settings — spacing, width, colours.',
    'Press Save, then Publish.',
  ])

  task('move-block', 'Move or delete a block', 'Reorder the pieces of a page, or take one away.', [
    'Click the block once to select it. A small toolbar appears above it.',
    'Use the up and down arrows in that toolbar to move it, or drag it by the handle on its left edge.',
    'Use the bin icon to delete it. If that was a mistake, press ⌘Z (Ctrl+Z) to undo.',
    'Press Save, then Publish.',
  ])

  task('publish', 'Publish a page', 'Put your changes on the live website.', [
    'Open the page and check it reads the way you want.',
    'Press Publish in the toolbar at the top of the editor.',
    'The status chip next to the title changes to Published.',
    `Press View site in the top bar to see it at ${site.url}.`,
  ])

  task('unpublish', 'Take a page off the website', 'Hide a page from visitors without deleting your work.', [
    'Open the page from Content.',
    'Press the status chip next to the title and choose Draft.',
    'Press Save. The page disappears from the website but stays here, with everything on it intact.',
    'To bring it back, set the status to Published again and press Publish.',
  ])

  task('navigation', 'Change the menu', 'Add, rename, reorder or remove the links across the top of your site.', [
    'In the sidebar under Site, press Navigation.',
    'Choose the menu you want to change — the main one fills the header.',
    'Press ＋ Add item for a new link, or click an existing item to rename it or point it somewhere else.',
    'Drag items up and down to reorder them.',
    'Press Save. The preview on the right updates first; the live menu changes when you save.',
  ])

  task('header-footer', 'Change the header or footer text', 'The strip at the top and the bottom of every page.', [
    'In the sidebar under Site, press Header & footer.',
    'Each box is a place your design leaves for content — a phone number, opening hours, small print. An empty box shows nothing at all.',
    'Type or edit the content in the box you want to change.',
    'Press Save. This applies to every page on the site at once.',
  ])

  task('design', 'Change colours or fonts', 'Set the look of the whole site.', [
    'In the sidebar under Site, press Design.',
    'Move the colour and font controls — the preview updates as you go, so you can see it before you commit.',
    'Nothing changes on the live site until you press Save design.',
    'If you do not like it, leave the screen without saving and everything stays as it was.',
  ])

  task('audit', 'See who changed what', 'A dated record of every change anyone made.', [
    'In the sidebar under Manage, press Activity.',
    'Each row shows the person, what they changed and when.',
    'Use the filter box to narrow it to one person or one kind of change.',
    'To undo a change to a page, open that page and use its history to put an older copy back.',
  ])

  task('users', 'Give a colleague access', 'Let someone else sign in and help.', [
    'In the sidebar under Manage, press Users.',
    'Press ＋ Add user and enter their name and email address.',
    'Choose what they are allowed to do — an Editor can write and publish, an Admin can also change settings and add people.',
    'Press Create. Give them the sign-in link, and ask them to set their own password.',
  ])

  // ---------- 3. glossary ----------
  sections.push({
    id: 'glossary',
    title: 'Words you’ll see',
    summary: 'The handful of words the studio uses, in plain English.',
    group: 'reference',
    audience: 'owner',
    facts: [
      { label: 'Block', value: 'One piece of a page — a heading, a paragraph, a picture, a row of cards. Pages are built by stacking blocks.' },
      { label: 'Section', value: 'A block that holds other blocks, so you can give a whole band of the page its own background or spacing.' },
      { label: 'Page vs content type', value: 'A Page is a one-off, like “About us”. A content type is a repeating kind of thing that all looks the same, like a product or a news post.' },
      { label: 'Draft', value: 'Your work in progress. Saved here, not on the website.' },
      { label: 'In review', value: 'Finished, waiting for someone else to approve it before it goes live.' },
      { label: 'Published', value: 'Live on the website, and what is here matches what visitors see.' },
      { label: 'Published with changes', value: 'Live on the website, but you have edited it since. Visitors still see the older version until you press Publish.' },
      { label: 'Restore point', value: 'A saved copy of how a page looked at one moment. The studio makes one every time you save or publish, so you can go back.' },
      { label: 'Assets', value: 'Your pictures, PDFs and other files, all in one library you can reuse across pages.' },
      { label: 'Navigation', value: 'The menus — the links across the top of your site and in the footer.' },
      { label: 'Header & footer', value: 'The strip at the top and the bottom of every page, plus the content you put in them.' },
      { label: 'Design', value: 'The colours, fonts and overall look, applied to the whole site at once.' },
      { label: 'Apps', value: 'Optional extras that add a feature — a booking form, a shop. You choose what each one is allowed to do.' },
      { label: 'SEO', value: 'What search engines like Google show about your pages: the title and the short description underneath it.' },
    ],
  })

  // ---------- 4. your site at a glance ----------
  sections.push({
    id: 'overview',
    title: 'Your site at a glance',
    summary: `“${site.name}” publishes to ${site.url}.`,
    group: 'reference',
    audience: 'owner',
    facts: [
      { label: 'Website address', value: site.url },
      { label: 'Design template', value: site.template },
      {
        label: 'Light or dark',
        value: site.theme?.colorScheme === 'auto'
          ? 'Follows each visitor’s own device setting, and they can switch'
          : `Always ${site.theme?.colorScheme} — visitors cannot switch`,
      },
      { label: 'Pages', value: `${docs.length} in total · ${published.length} live · ${docs.length - published.length} not published yet` },
      { label: 'Pictures and files', value: (() => {
        const noAlt = media.filter(m => !m.alt && m.type.startsWith('image/')).length
        return `${media.length} file${media.length === 1 ? '' : 's'}${noAlt ? ` · ${noAlt} picture${noAlt === 1 ? ' still needs' : 's still need'} a description` : ''}`
      })() },
      { label: 'Apps switched on', value: enabledPlugins.length ? enabledPlugins.map(p => p.name).join(', ') : 'none yet' },
      { label: 'Building pieces available', value: `${blocks.length} kinds of block` },
    ],
  })

  // ---------- 5. your content types ----------
  const conceptFacts = await Promise.all(concepts.map(async c => {
    const sample = docs.find(d => d.concept === c.name)
    const path = sample ? await env.content.docPath(sample) : (c.urlPattern || '/{slug}').replace('{slug}', 'example')
    const count = docs.filter(d => d.concept === c.name).length
    const one = c.label || c.name
    return {
      label: `${c.labelPlural || c.label}`,
      value: `${count} so far · web address looks like ${site.url}${hrefFor(path, site)}`,
      hint: (c.indexPath ? `They are all listed together at ${site.url}${c.indexPath}. ` : 'There is no page listing them all. ') +
        (c.fields?.length ? `Each ${one} has these details you can fill in: ${c.fields.map(f => f.label || f.key).join(', ')}.` : `Each ${one} is a free-form page.`),
    }
  }))
  sections.push({
    id: 'content',
    title: 'Your content types',
    summary: 'The repeating kinds of thing on your site, and the web addresses they get.',
    group: 'reference',
    audience: 'owner',
    facts: conceptFacts,
    steps: [
      'To make a new one: press ＋ New in the sidebar and pick the type.',
      'To change one: open it from Content and edit it on the page.',
      'To put it on the website: press Publish. Drafts never appear to visitors.',
    ],
  })

  // ---------- brand variables ----------
  const vars = site.vars || {}
  if (Object.keys(vars).length || (site.varDefs || []).length) {
    sections.push({
      id: 'brand',
      title: 'Details you reuse everywhere',
      summary: 'Your phone number, address or a favourite phrase, written once here and used on any page. Change it here and it changes everywhere it appears.',
      group: 'reference',
      audience: 'owner',
      facts: Object.entries(vars).map(([k, v]) => ({ label: k, value: String(v).slice(0, 80) })),
    })
  }

  // ---------- 6. health check ----------
  const issues = await validateSite(env)
  const noAlt = media.filter(m => m.type.startsWith('image/') && !m.alt).length
  const noDesc = docs.filter(d => !d.seo?.description).length
  sections.push({
    id: 'health',
    title: 'Health check',
    summary: issues.length
      ? `${plural(issues.filter(i => i.level === 'error').length, 'thing')} to fix and ${plural(issues.filter(i => i.level === 'warn').length, 'thing')} worth a look.`
      : 'Everything checks out — no broken links or missing pieces.',
    group: 'reference',
    audience: 'owner',
    facts: [
      { label: 'Links that point nowhere', value: issues.length ? issues.slice(0, 6).map(i => `${i.where}: ${i.message}`).join(' · ') : 'none' },
      { label: 'Images without a description (alt text)', value: String(noAlt) },
      { label: 'Pages missing a description for search engines', value: String(noDesc) },
      { label: 'Pages not published yet', value: String(docs.length - published.length) },
    ],
  })

  // ---------- 7. for developers ----------
  const byGroup: Record<string, string[]> = {}
  for (const b of blocks) (byGroup[b.group] ??= []).push(b.label)
  const dir = (env as any).projectDir || 'sites/<your-site>'
  const sec = site.security || {}

  sections.push({
    id: 'dev-blocks',
    title: 'Blocks and templates',
    summary: `${blocks.length} block types are registered for this site, including any the template adds.`,
    group: 'developer',
    audience: 'developer',
    facts: Object.entries(byGroup).map(([group, list]) => ({ label: group, value: list.join(', ') })),
    steps: [
      'Container blocks (Section, Columns, FAQ, Tabs, Accordion) hold other blocks — build layout by nesting.',
      `Template blocks live in templates/${site.template}/blocks/*.json + .liquid — add a pair of files and they appear in the picker.`,
      'Any text field accepts {{var.key}} to pull a brand variable (Settings → Brand).',
      `Template files resolve from site/overrides → sites/*/templates/${site.template} → templates/${site.template}.`,
      `URL style for this site: ${urlStyleLabel}${site.urls?.layout === 'flat' ? ' · flat layout, every document sits at the root' : ''}.`,
      site.urls?.shortlinks ? `Shortlinks are on — every doc also answers at ${site.url}/${site.urls.shortlinkPrefix || 's'}/<code>.` : 'Shortlinks are off (Settings → URLs).',
    ],
  })

  sections.push({
    id: 'dev-menus',
    title: 'Navigation internals',
    summary: menus.length ? 'Menus render through {% menu \'key\' %} in your template.' : 'No menus yet — create “main” to fill the header.',
    group: 'developer',
    audience: 'developer',
    facts: menus.map(m => {
      const megas = m.items.filter(i => i.mega).length
      return {
        label: m.label || m.key,
        value: `${plural(m.items.length, 'top-level item')}${megas ? ` · ${plural(megas, 'mega panel')}` : ''}`,
        hint: m.items.map(i => i.label).join(' · ') || 'empty',
      }
    }),
    steps: [
      'Showcase mega panels take image cards with a price/sublabel and become a full-screen drill-down on mobile automatically.',
      'Column panels take link lists (with icons + descriptions) and can embed blocks.',
      'Set an item to “auto” with a concept to keep it filled with your latest content, no maintenance.',
    ],
  })

  sections.push({
    id: 'dev-deploy',
    title: 'Publishing and deployment commands',
    summary: 'Three ways to ship, all from the same content.',
    group: 'developer',
    audience: 'developer',
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

  sections.push({
    id: 'dev-security',
    title: 'Security posture',
    summary: 'What this install currently enforces.',
    group: 'developer',
    audience: 'developer',
    facts: [
      { label: 'Content-Security-Policy', value: sec.csp === 'off' ? 'disabled' : `${sec.csp || 'balanced'} (public pages)` },
      { label: 'HSTS', value: sec.hsts ? 'on (https only)' : 'off — enable once you serve HTTPS everywhere' },
      { label: 'Framing', value: `frame-ancestors ${sec.frameAncestors || "'none'"}` },
      { label: 'Login lockout', value: `${sec.maxLoginAttempts ?? 8} attempts, then ${sec.lockoutMinutes ?? 15} minutes` },
      { label: 'Admin network allowlist', value: sec.adminAllowlist?.length ? sec.adminAllowlist.join(', ') : 'open to any IP' },
      { label: 'Audit log', value: sec.auditLog === false ? 'off' : 'on — see Manage → Activity' },
      { label: 'Password minimum', value: `${sec.minPasswordLength ?? 8} characters` },
    ],
    warnings: [
      ...(site.url.startsWith('https') && !sec.hsts ? ['You publish over HTTPS but HSTS is off — turn it on in Settings → Security once you’re confident.'] : []),
      ...(!sec.adminAllowlist?.length && site.url.startsWith('https') ? ['The studio is reachable from any network. Consider an admin IP allowlist for production.'] : []),
    ],
  })

  for (const p of enabledPlugins) {
    const approved = site.plugins?.[p.id]?.approved || []
    sections.push({
      id: `plugin-${p.id}`,
      title: `${p.name} (app permissions)`,
      summary: p.description || '',
      group: 'developer',
      audience: 'developer',
      facts: [
        { label: 'Approved capabilities', value: approved.join(', ') || 'none — the plugin can’t do anything yet' },
        { label: 'Not approved', value: p.permissions.filter(x => !approved.includes(x)).join(', ') || '—' },
      ],
      warnings: approved.length < p.permissions.length
        ? [`${p.name} declared ${p.permissions.length} capabilities but only ${approved.length} are approved. Anything unapproved throws at runtime — approve it in Manage → Apps if a feature seems missing.`]
        : [],
    })
  }

  return { sections: topic ? sections.filter(s => s.id === topic || s.id.startsWith(topic)) : sections, site: { name: site.name, url: site.url, template: site.template } }
}

export interface PanelTips {
  tips: string[]
  tasks: { label: string; help: string }[]
}

/** What you can do on this screen, in plain English, plus how-tos that go deeper. */
export async function contextTips(env: BlockhouseEnv, panelSpec: string): Promise<PanelTips> {
  // The caller may name the type it is showing, e.g. `content:page`, so a
  // type-filtered list is not told how many documents the whole site has.
  const [panel, conceptName = ''] = String(panelSpec).split(':')
  const site = await env.site()
  const allDocs = await env.content.listDocs()
  const concept = conceptName
    ? (await env.content.concepts()).find(c => c.name === conceptName)
    : undefined
  const docs = conceptName ? allDocs.filter(d => d.concept === conceptName) : allDocs
  const things = concept ? String(concept.labelPlural || `${concept.label || conceptName}s`).toLowerCase() : 'pages'
  const thing = concept ? String(concept.label || conceptName).toLowerCase() : 'page'
  const noDesc = panel === 'seo' ? await missingDescriptionCount(env) : 0

  const T = (tips: string[], tasks: [string, string][]): PanelTips =>
    ({ tips, tasks: tasks.map(([label, help]) => ({ label, help })) })

  switch (panel) {
    case 'dashboard':
      return T([
        'See at a glance what changed recently and what is still waiting to be published.',
        'Press ＋ New to start a page without hunting for the right screen first.',
        'Click any recent item to jump straight back into it.',
        'Press View site in the top bar to see your website the way visitors do.',
      ], [['Start here', 'start-here'], ['Add a new page', 'add-page'], ['Publish a page', 'publish']])

    case 'content':
      return T([
        `Browse all ${docs.length} of your ${things} — the list on the left narrows them down by status (draft, published, waiting for review).`,
        `Open a ${thing} by clicking its title; everything is edited on the page itself.`,
        `Tick several ${things} and publish them together after a round of edits.`,
        `Look for the “Published · edited” chip: those ${things} have changes visitors cannot see yet.`,
      ], [['Add a new page', 'add-page'], ['Change words on a page', 'edit-text'], ['Publish a page', 'publish'], ['Take a page off the website', 'unpublish']])

    case 'editor':
      return T([
        'Click a block on the page or in the outline to change it.',
        'The panel on the right edits whatever is selected — the Page tab holds the address, publish date and details.',
        'Save keeps a restore point; Publish (or Republish) puts the page on the website.',
        'Use the three width buttons to check the page on desktop, tablet and phone.',
      ], [['Change words on a page', 'edit-text'], ['Add a new block', 'add-block'], ['Move or delete a block', 'move-block'], ['Swap or add a photo', 'photos'], ['Publish a page', 'publish']])

    case 'media':
    case 'assets':
      return T([
        'Drag files onto this page to upload them into the folder you have open.',
        'Give every picture a short description so blind visitors and search engines know what it shows.',
        'Click a picture and press Edit image to crop or resize it — your original is always kept.',
        'Set a focal point so small thumbnails keep the important part of the picture.',
      ], [['Swap or add a photo', 'photos'], ['Health check', 'health']])

    case 'menus':
      return T([
        'Add, rename or remove the links across the top of your site.',
        'Drag items up and down to change the order they appear in.',
        'Open an item to point it at a different page, or to give it a drop-down panel.',
        'Press Save when you are happy — the live menu only changes then.',
      ], [['Change the menu', 'navigation'], ['Words you’ll see', 'glossary']])

    case 'chrome':
      return T([
        'Change the wording in the strip at the top and bottom of every page.',
        'Fill in the boxes your design leaves open — a phone number, opening hours, small print.',
        'Leave a box empty and nothing at all shows there.',
        'Press Save; this applies to every page on the site at once.',
      ], [['Change the header or footer text', 'header-footer'], ['Change the menu', 'navigation']])

    case 'design':
      return T([
        'Try new colours and fonts and watch the preview change as you go.',
        'Press Save design when you like it — nothing reaches the live site before that.',
        'Leave without saving if you change your mind; your site stays exactly as it was.',
        'Switch templates without fear: your words and pictures are never touched.',
      ], [['Change colours or fonts', 'design'], ['Words you’ll see', 'glossary']])

    case 'templates':
      return T([
        'Edit the Liquid and CSS files that build every page of this site.',
        'Save a file to create a copy for this site — the original is kept untouched.',
        'Press Revert to original to throw your copy away and go back to the shipped file.',
        'Turn on Preview to see an unsaved edit rendered before you commit to it.',
      ], [['Words you’ll see', 'glossary'], ['Blocks for developers', 'dev-blocks']])

    case 'types':
      return T([
        'Set up a repeating kind of page, like a product or a news post.',
        'Add the details each one should have, so they are the same every time.',
        'Give it a page that lists them all, and new ones appear there on their own.',
        'Changes here shape how these pages are written, not how they look.',
      ], [['Your content types', 'content'], ['Add a new page', 'add-page']])

    case 'seo':
      return T([
        'Write the title and short description search engines show for each page.',
        noDesc ? `Fix the ${plural(noDesc, 'page')} grouped under “${NO_DESC}” — that is the one thing standing between ${noDesc === 1 ? 'it' : 'them'} and a clean check.` : 'Every page has a description — keep an eye on this list as you add more.',
        'Set a focus keyword on a page to see whether you have used it where it counts.',
        'Rename a page’s address safely: old links keep working automatically.',
      ], [['Health check', 'health'], ['Words you’ll see', 'glossary']])

    case 'users':
      return T([
        'Invite a colleague and choose what they are allowed to do.',
        'Make someone an Editor to write and publish, or an Admin to also change settings.',
        'Remove access the moment someone leaves — it takes effect straight away.',
        'Ask people to set their own password; nobody else should know it.',
      ], [['Give a colleague access', 'users'], ['See who changed what', 'audit']])

    case 'plugins':
      return T([
        'Switch optional extras on and off for your site.',
        'Switching an app on or off takes effect after the site is next restarted — ask whoever hosts your site.',
        'Decide what each one is allowed to touch before it can do anything.',
        'Turn one off if you are unsure — your pages are unaffected.',
        'Check here first if a feature you expected seems to be missing.',
      ], [['Words you’ll see', 'glossary'], ['Start here', 'start-here']])

    case 'audit':
      return T([
        'See who changed what, and when.',
        'Filter to one person or one kind of change to find something quickly.',
        'Use it to check a change really went out before you tell a customer.',
        'To undo something, open that page and put an older copy back from its history.',
      ], [['See who changed what', 'audit'], ['Publish a page', 'publish']])

    case 'deploy':
      return T([
        'Run the checks before you publish the whole site — they catch broken links and missing pieces.',
        `Publish everything at once to ${site.url || 'your website address'} when you are ready.`,
        'Read the result: anything marked as an error is worth fixing first.',
        'Day to day you do not need this — publishing a single page is done in the editor.',
      ], [['Publish a page', 'publish'], ['Health check', 'health']])

    case 'settings':
      return T([
        'Set your site name, website address and the basics visitors see.',
        site.theme?.colorScheme === 'auto'
          ? 'Choose whether the site follows each visitor’s light or dark setting, or always looks the same.'
          : `Your site is always ${site.theme?.colorScheme}; switch it back to following the visitor if you prefer.`,
        'Write your phone number or address once here and reuse it on any page.',
        'Press Save when you are done — some changes affect every page.',
      ], [['Start here', 'start-here'], ['Words you’ll see', 'glossary']])

    case 'help':
      return T([
        'Read the step-by-step how-tos for the everyday jobs.',
        'Search the guide by typing in the box at the top of the topic list.',
        'Check your site at a glance to see what is published and what is not.',
        'Scroll to the For developers part only if someone technical needs it.',
      ], [['Start here', 'start-here'], ['Words you’ll see', 'glossary']])

    default: {
      // An app's own page. Nothing is hand-written for these, so say what the
      // app keeps and what you can do with it, from its own declarations.
      const ap = env.registry.adminPanels.find((x: any) => x.key === panel || x.plugin === panel)
      if (!ap) return T([], [])
      const names = (ap.resources || []).map((r: any) => String(r.label || r.key).toLowerCase())
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
      const one = (ap.resources?.[0]?.labelSingular || names[0] || 'entry').toString().toLowerCase()
      return T([
        names.length
          ? `This page is where the ${ap.label} app keeps your ${list}.`
          : `This page belongs to the ${ap.label} app.`,
        names.length
          ? `Press “New ${one}” to add one, or click a row to change it.`
          : 'Everything on this page belongs to that app alone — the rest of your site is unaffected.',
        'Switch the whole app off under Manage → Apps if you no longer need it; nothing else on your site changes.',
      ], [['Words you’ll see', 'glossary'], ['Start here', 'start-here']])
    }
  }
}
