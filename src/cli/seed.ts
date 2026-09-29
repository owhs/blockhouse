// Demo site generator: "Meridian Studio" — showcases blocks, mega menus,
// forms→data→automations flows, newsletter, SEO and publishing.

import { FsDriver } from '../storage/fs.ts'
import { stringify, now } from '../core/util.ts'
import { imageDimensions } from '../images/exif.ts'
import type { Doc } from '../core/types.ts'
import { builtinPlugins } from '../../../plugins/index.ts'

const T = now()
let bi = 0
const b = (type: string, props: any = {}, children?: any[]) =>
  ({ id: `b${(++bi).toString(36).padStart(4, '0')}`, type, props, ...(children ? { children } : {}) })

export async function seedDemo(dir: string) {
  const d = new FsDriver(dir)
  const w = (key: string, v: any) => d.write(key, stringify(v))

  // Approve exactly what each plugin's manifest declares. This used to be a
  // hand-copied list per plugin, which silently drifted: `files` gained a
  // routes.public route but the seed never granted it, so every seeded site
  // threw a PermissionError for `files` on boot.
  const ALL = (pid: keyof typeof builtinPlugins) =>
    ({ enabled: true, approved: [...builtinPlugins[pid].manifest.permissions] })

  // register generated placeholder SVGs (in media/library/) as media entries
  const MEDIA: Record<string, string> = {}
  for (const name of ['rover-flagship', 'rover-sv', 'rover-sport', 'rover-electric', 'rover-compact', 'showroom-hero']) {
    const file = `library/${name}.svg`
    const bytes = await d.read(`media/${file}`)
    if (!bytes) continue
    const dims = imageDimensions(bytes, 'image/svg+xml')
    const id = `m-${name}`
    MEDIA[name] = id
    await w(`media/_meta/${id}.json`, {
      id, file, name: `${name}.svg`, alt: name.replace(/-/g, ' '),
      type: 'image/svg+xml', size: bytes.length, width: dims?.width, height: dims?.height,
      createdAt: T,
    })
  }

  await w('site/site.json', {
    name: 'Meridian Studio',
    tagline: 'A small studio for weighty ideas',
    url: 'http://localhost:8787',
    language: 'en',
    template: 'aurora',
    homeDocId: 'd-home',
    seo: {
      titlePattern: '{title} — Meridian Studio',
      description: 'Meridian is a design studio crafting calm, durable digital products. This demo site is built with Blockhouse.',
      robots: 'index,follow',
      organization: { name: 'Meridian Studio' },
    },
    images: {
      provider: 'local', sizes: [320, 640, 960, 1280, 1920], formats: ['webp', 'original'],
      quality: 82, stripExif: true, renamePattern: '{slug}-{w}', watermark: null,
    },
    theme: { tokens: { hue: '158', 'accent-chroma': '0.09' } },   // evergreen — calm, premium, not-blue
    slots: {
      'footer.social': [b('richtext', { md: '[RSS](/blog/feed.xml) · [GitHub](https://github.com)' })],
    },
    mail: { driver: 'console', from: 'hello@meridian.example' },
    plugins: {
      forms: ALL('forms'),
      files: ALL('files'),
      newsletter: ALL('newsletter'),
      automations: ALL('automations'),
      data: ALL('data'),
      search: ALL('search'),
      analytics: ALL('analytics'),
      ai: ALL('ai'),
    },
  })

  // ---------- concepts ----------

  await w('site/concepts/page.json', {
    name: 'page', label: 'Page', labelPlural: 'Pages', icon: '▢',
    urlPattern: '/{slug}', template: 'page', fields: [],
  })
  await w('site/concepts/post.json', {
    name: 'post', label: 'Post', labelPlural: 'Blog posts', icon: '✎',
    urlPattern: '/blog/{slug}', indexPath: '/blog', template: 'post',
    perPage: 9, feed: true,
    seo: { titlePattern: '{title} — Meridian Journal', schema: 'article' },
    fields: [
      { key: 'lede', type: 'textarea', label: 'Lede', help: 'One-sentence standfirst under the title', rows: 2 },
      { key: 'cover', type: 'image', label: 'Cover image' },
    ],
  })

  // ---------- docs ----------

  const doc = (id: string, concept: string, slug: string, title: string, blocks: any[], extra: Partial<Doc> = {}): Doc => ({
    id, concept, slug, title, status: 'published', fields: {}, blocks,
    seo: {}, createdAt: T, updatedAt: T, version: 1, ...extra,
  } as Doc)

  const home = doc('d-home', 'page', 'home', 'Home', [
    b('section', { width: 'wide', padding: 'none' }, [
      b('hero', {
        eyebrow: 'Design · Engineering · Strategy',
        title: 'Software that feels inevitable',
        text: 'Meridian is a small studio crafting calm, durable digital products. We sweat the details so your users never notice them.',
        layout: 'center',
        buttons: [
          { label: 'Start a project', link: { href: '/contact' }, style: 'primary' },
          { label: 'Read the journal', link: { href: '/blog' }, style: 'ghost' },
        ],
      }),
    ]),
    b('section', { background: 'subtle' }, [
      b('heading', { text: 'What we do', level: '2', align: 'center', eyebrow: 'Capabilities' }),
      b('columns', { cols: '3', gap: 'normal' }, [
        b('feature-card', { icon: '◐', title: 'Product design', text: 'Interfaces that stay out of the way — researched, prototyped, and tested until they disappear.' }),
        b('feature-card', { icon: '⚙', title: 'Engineering', text: 'Fast, accessible builds on boring, proven technology. Performance budgets are contracts.' }),
        b('feature-card', { icon: '◈', title: 'Brand systems', text: 'Identities that flex across product, print and pitch deck without losing their voice.' }),
      ]),
    ]),
    b('section', {}, [
      b('columns', { cols: '2', align: 'center' }, [
        b('richtext', { md: '## Built calm, built to last\n\nWe are deliberately small. Every engagement gets a partner-level team of three, a **fixed weekly cadence**, and one shared definition of done:\n\n- Ships fast on real devices\n- Reads clearly in every language\n- Survives its first redesign' }),
        b('svg', {
          align: 'center', maxWidth: 320, animate: true,
          source: '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" fill="none"><circle cx="100" cy="100" r="86" stroke="currentColor" stroke-width="2" opacity="0.25"/><circle cx="100" cy="100" r="58" stroke="currentColor" stroke-width="2" opacity="0.5"/><circle cx="100" cy="100" r="30" stroke="currentColor" stroke-width="2.5"/><line x1="100" y1="14" x2="100" y2="186" stroke="currentColor" stroke-width="1.5" opacity="0.3"/><line x1="14" y1="100" x2="186" y2="100" stroke="currentColor" stroke-width="1.5" opacity="0.3"/><circle cx="100" cy="42" r="6" fill="currentColor"><animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="14s" repeatCount="indefinite"/></circle></svg>',
        }),
      ]),
    ]),
    b('section', { background: 'subtle' }, [
      b('heading', { text: 'Questions, answered', level: '2', align: 'center', eyebrow: 'FAQ' }),
      b('faq', { single: true }, [
        b('faq-item', { question: 'How do engagements usually start?', open: true }, [
          b('richtext', { md: 'With a two-week **discovery sprint**: interviews, a systems map, and one clickable prototype. You keep everything, whatever happens next.' }),
        ]),
        b('faq-item', { question: 'What does a typical project cost?' }, [
          b('richtext', { md: 'Discovery is fixed-price. Build phases run in four-week cycles — see [pricing](/pricing) for the honest numbers.' }),
        ]),
        b('faq-item', { question: 'Do you work with in-house teams?' }, [
          b('richtext', { md: 'Constantly. Half our work is pairing with internal designers and engineers to raise the ceiling, not replace anyone.' }),
        ]),
      ]),
    ]),
    b('section', {}, [
      b('cta', {
        title: 'Have something weighty in mind?',
        text: 'Tell us where it hurts. We reply within two working days, with opinions.',
        buttons: [{ label: 'Start the conversation', link: { href: '/contact' }, style: 'primary' }],
      }),
      b('newsletter-signup', { listId: 'updates', title: 'The Meridian letter', text: 'One thoughtful email a month. No launches-you-don’t-care-about.', buttonLabel: 'Subscribe' }),
    ]),
  ])
  home.seo = { description: 'Meridian is a small design studio crafting calm, durable digital products — product design, engineering and brand systems.' }

  const pricing = doc('d-pricing', 'page', 'pricing', 'Pricing', [
    b('section', {}, [
      b('heading', { text: 'Honest, boring pricing', level: '1', align: 'center', eyebrow: 'Pricing' }),
      b('richtext', { md: 'Every engagement is a four-week cycle with the same senior team. No juniors billed as seniors, no surprise line items.' }),
      b('pricing', {
        plans: [
          { name: 'Discovery', price: '£9k', period: 'fixed', features: 'Two-week sprint\nResearch + systems map\nClickable prototype\nYours to keep', ctaLabel: 'Book discovery', link: { href: '/contact' } },
          { name: 'Build cycle', price: '£24k', period: '4 weeks', features: 'Partner-level team of 3\nWeekly shipped increments\nPerformance budgets\nAccessibility as default', ctaLabel: 'Start building', link: { href: '/contact' }, featured: true },
          { name: 'Advisory', price: '£3k', period: 'month', features: 'Fortnightly reviews\nAsync design critique\nHiring support\nCancel anytime', ctaLabel: 'Ask about advisory', link: { href: '/contact' } },
        ],
      }),
    ]),
    b('section', { background: 'subtle' }, [
      b('faq', {}, [
        b('faq-item', { question: 'What happens if a cycle finishes early?' }, [b('richtext', { md: 'We pull work forward from the backlog — cycles are time-boxed, never padded.' })]),
        b('faq-item', { question: 'Do you offer equity arrangements?' }, [b('richtext', { md: 'Occasionally, for products we can’t stop thinking about. Ask.' })]),
      ]),
    ]),
  ])

  const about = doc('d-about', 'page', 'about', 'About', [
    b('section', {}, [
      b('heading', { text: 'A studio the size of a dinner table', level: '1', eyebrow: 'About' }),
      b('richtext', { md: 'Meridian is six people in Bristol and Porto. We\'ve shipped design systems for banks, reading apps for kids, and telemetry dashboards for wind farms.\n\nWe believe **small teams with sharp tools** beat big teams with dull ones — which is why this very site runs on Blockhouse, a site engine we can bend without breaking.' }),
      b('quote', { text: 'The work is never just the artefact. It\'s the clarity the artefact leaves behind.', cite: 'Ana Ferreira, founding partner' }),
      b('divider', { style: 'dots' }),
      b('table', {
        caption: 'The shape of a typical build cycle',
        headerRow: true, striped: true,
        data: [
          ['Week', 'Focus', 'Output'],
          ['1', 'Frame', 'Cycle brief + success metrics'],
          ['2–3', 'Build', 'Shipped increments behind flags'],
          ['4', 'Harden', 'Perf pass, a11y audit, docs'],
        ],
      }),
    ]),
  ])

  const contact = doc('d-contact', 'page', 'contact', 'Contact', [
    b('section', {}, [
      b('columns', { cols: '2', gap: 'loose' }, [
        b('richtext', { md: '## Start the conversation\n\nTell us what you\'re making and where it hurts. We reply to everything within **two working days** — usually with more questions.\n\nPrefer email? [hello@meridian.example](mailto:hello@meridian.example)' }),
        b('form', { formId: 'contact' }),
      ]),
    ]),
  ])

  const post1 = doc('d-post-dark', 'post', 'designing-for-light-and-dark', 'Designing once for light and dark', [
    b('section', {}, [
      b('richtext', { md: 'Dark mode stopped being a feature in about 2020 — now it\'s just **a second rendering target** your design either survives or doesn\'t. The trick is to stop designing "a dark theme" and start designing *relationships*.\n\n## Name intentions, not colors\n\nA token called `gray-100` is a trap. A token called `bg-raise` is a promise. Aurora (the template rendering this page) keeps its entire palette in intentions:' }),
      b('code', {
        lang: 'css', filename: 'tokens.css',
        code: ':root {\n  color-scheme: light dark;\n  --bg: light-dark(oklch(98.6% 0.004 275), oklch(17.5% 0.014 275));\n  --ink: light-dark(oklch(24% 0.015 275), oklch(94% 0.008 275));\n  --accent: oklch(58% 0.16 var(--hue));\n}',
      }),
      b('richtext', { md: 'One declaration, both themes. `light-dark()` plus OKLCH means the accent keeps identical *perceived* punch on both backgrounds — no more hand-tuned `-dark` variants drifting out of sync.\n\n## Test the awkward middles\n\nScreenshots below are staged at the two moments themes usually break: translucent headers over imagery, and code blocks (which should stay dark in both modes — terminals have opinions).' }),
      b('tabs', {}, [
        b('tab', { label: 'Do' }, [b('richtext', { md: '- Derive **both** themes from one hue\n- Keep code blocks dark everywhere\n- Let users override the OS choice — and remember it' })]),
        b('tab', { label: 'Don\'t' }, [b('richtext', { md: '- Invert shadows (they become glows)\n- Use pure black backgrounds with pure white text\n- Forget `color-scheme`, then wonder why scrollbars glow' })]),
      ]),
      b('embed', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A talk that is definitely about color systems' }),
    ]),
  ], { fields: { lede: 'Stop shipping a dark theme. Ship one palette that knows how to be two.' } })
  post1.seo = { description: 'Designing one token system that renders beautifully in light and dark — light-dark(), OKLCH, and the awkward middles where themes break.' }

  const post2 = doc('d-post-blockhouse', 'post', 'why-we-built-on-blockhouse', 'Why this site runs on Blockhouse', [
    b('section', {}, [
      b('richtext', { md: 'We wanted three things from a site engine: **content in git**, a studio our clients could actually use, and the option to deploy as plain files when a project doesn\'t need a server.\n\n## Flat files, real diffs\n\nEvery page on this site is a JSON document. Reviews happen in pull requests; rollbacks are `git revert`. The only database holds users and form submissions — things that don\'t belong in git anyway.' }),
      b('quote', { text: 'The CMS you can diff is the CMS you can trust.', cite: 'someone on our team, probably' }),
      b('richtext', { md: '## One engine, three deployments\n\nThe same site runs three ways: `blockhouse dev` locally, a live server on a VPS or Cloudflare Workers (R2 + D1), or `blockhouse export` producing a flat build for Pages.\n\nThat last one matters more than it sounds: most sites are static *almost* all the time. Being able to choose per-project — without changing CMS — is the whole point.' }),
      b('button', { label: 'Read the Blockhouse docs', link: { href: 'https://github.com' }, style: 'soft', align: 'left' }),
    ]),
  ], { fields: { lede: 'Content you can diff, a studio clients can use, and the freedom to ship flat files.' } })

  for (const dd of [home, pricing, about, contact, post1, post2]) {
    await w(`site/content/${dd.concept}/${dd.slug}.json`, dd)
    await w(`site/content/.published/${dd.concept}/${dd.slug}.json`, dd)
  }

  // ---------- menus ----------

  await w('site/menus/main.json', {
    key: 'main', label: 'Main menu',
    items: [
      {
        // JLR-style showcase mega menu: card rail → detail pane, tiles, brand bar
        id: 'mi-work', label: 'Our work', type: 'link',
        mega: {
          layout: 'showcase', wide: true,
          items: [
            { id: 'mw1', label: 'Atlas Flagship', type: 'doc', docId: 'd-about', sublabel: 'From £107,530', note: 'Finance available', image: MEDIA['rover-flagship'], description: 'Our defining commission — a wealth platform rebuilt from the studs.' },
            { id: 'mw2', label: 'Aurelius SV', type: 'doc', docId: 'd-about', sublabel: 'From £164,150', note: 'Bespoke', image: MEDIA['rover-sv'], description: 'Limitless individuality: a configurator with a million valid states.' },
            { id: 'mw3', label: 'Velvet Sport', type: 'doc', docId: 'd-pricing', sublabel: 'From £77,620', note: 'Finance available', image: MEDIA['rover-sport'], description: 'A fitness brand’s coaching app, tuned to sub-second interactions.' },
            { id: 'mw4', label: 'Ampere EV', type: 'doc', docId: 'd-post-dark', sublabel: 'From £55,460', note: 'Electric', image: MEDIA['rover-electric'], description: 'Grid telemetry made legible — dark-mode-native from day one.' },
            { id: 'mw5', label: 'Compass', type: 'doc', docId: 'd-post-blockhouse', sublabel: 'From £44,430', note: 'Open source', image: MEDIA['rover-compact'], description: 'The engine behind this very site.' },
          ],
          tiles: [
            { icon: 'compare', label: 'Compare work', href: '/pricing' },
            { icon: 'bespoke', label: 'Bespoke', href: '/contact' },
            { icon: 'classic', label: 'Case studies', href: '/blog' },
            { icon: 'electric', label: 'Open source', href: '/blog' },
          ],
          footerTitle: 'Elsewhere:',
          footer: [
            { label: 'Journal', href: '/blog' },
            { label: 'Pricing', href: '/pricing' },
            { label: 'Contact', href: '/contact' },
          ],
        },
      },
      {
        id: 'mi-studio', label: 'Studio', type: 'link',
        mega: {
          layout: 'columns',
          columns: [
            {
              title: 'Practice',
              items: [
                { id: 'mi-s1', label: 'About the studio', type: 'doc', docId: 'd-about', description: 'Six people, two cities, one cadence', icon: 'building' },
                { id: 'mi-s2', label: 'Pricing', type: 'doc', docId: 'd-pricing', description: 'Fixed cycles, honest numbers', icon: 'tag' },
                { id: 'mi-s3', label: 'Contact', type: 'doc', docId: 'd-contact', description: 'Start a conversation', icon: 'mail' },
              ],
            },
            {
              title: 'From the journal',
              items: [{ id: 'mi-auto', label: 'Latest posts', type: 'auto', concept: 'post', limit: 4 }],
            },
            {
              blocks: [
                { id: 'mb1', type: 'cta', props: { title: 'Office hours', text: 'Free 30-minute crits, every Friday.', buttons: [{ label: 'Book a slot', link: { href: '/contact' }, style: 'primary' }] } },
              ],
            },
          ],
        },
      },
      { id: 'mi-journal', label: 'Journal', type: 'link', href: '/blog' },
      { id: 'mi-pricing', label: 'Pricing', type: 'doc', docId: 'd-pricing' },
      { id: 'mi-contact', label: 'Contact', type: 'doc', docId: 'd-contact' },
    ],
  })
  await w('site/menus/footer.json', {
    key: 'footer', label: 'Footer',
    items: [
      { id: 'fi-1', label: 'About', type: 'doc', docId: 'd-about' },
      { id: 'fi-2', label: 'Journal', type: 'link', href: '/blog' },
      { id: 'fi-3', label: 'Pricing', type: 'doc', docId: 'd-pricing' },
      { id: 'fi-4', label: 'Contact', type: 'doc', docId: 'd-contact' },
      { id: 'fi-5', label: 'RSS', type: 'link', href: '/blog/feed.xml' },
    ],
  })

  await w('site/redirects.json', [{ from: '/old-studio', to: '/about', code: 301 }])

  // ---------- plugin content ----------

  await w('site/forms/forms/contact.json', {
    id: 'contact', label: 'Contact form',
    fields: [
      { key: 'name', label: 'Your name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'budget', label: 'Rough budget', type: 'select', options: 'Under £10k|£10–50k|£50k+|No idea yet' },
      { key: 'message', label: 'What are you making?', type: 'textarea', required: true },
    ],
    actions: [
      { type: 'store', options: {} },
      { type: 'email', options: { to: 'hello@meridian.example', subject: 'New enquiry from {data.name}', body: 'From: {data.name} <{data.email}>\nBudget: {data.budget}\n\n{data.message}' } },
      { type: 'data.insert', options: { table: 'enquiries', map: { name: '{data.name}', email: '{data.email}', budget: '{data.budget}', qty: '1', unit: '0', discount: '0' } } },
    ],
    successMessage: 'Thanks — we\'ll reply within two working days.',
    minSeconds: 3,
  })

  await w('site/newsletter/lists/updates.json', { id: 'updates', label: 'Studio updates', description: 'Monthly letter' })

  await w('site/automations/recipes/announce-publish.json', {
    id: 'announce-publish', label: 'Log every publish', on: 'content.published',
    actions: [{ type: 'log', options: { note: 'published {docId}' } }],
    enabled: true,
  })
  await w('site/automations/recipes/enquiry-followup.json', {
    id: 'enquiry-followup', label: 'Auto-reply to enquiries', on: 'form.submitted',
    filter: { formId: 'contact' },
    actions: [{ type: 'email', options: { to: '{data.email}', subject: 'We got your message', body: 'Hi {data.name},\n\nThanks for writing to Meridian — a human will reply within two working days.\n\n— The studio' } }],
    enabled: true,
  })

  await w('site/data/tables/enquiries.json', {
    id: 'enquiries', label: 'Enquiries', titleField: 'name',
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'budget', label: 'Budget', type: 'select', options: 'Under £10k|£10–50k|£50k+|No idea yet' },
    ],
    workflow: {
      states: [
        { key: 'new', label: 'New' },
        { key: 'qualified', label: 'Qualified', color: '#3e7d5f' },
        { key: 'won', label: 'Won', color: '#2fac68' },
        { key: 'lost', label: 'Lost', color: '#b45' },
      ],
      transitions: [
        { from: 'new', to: 'qualified' }, { from: 'new', to: 'lost' },
        { from: 'qualified', to: 'won' }, { from: 'qualified', to: 'lost' },
      ],
    },
    publicRead: false, publicWrite: false,
  })

  // Advanced quote calculator: line-items → subtotal → VAT → grand total,
  // conditional deposit, workflow, and a printable report template.
  await w('site/data/tables/quotes.json', {
    id: 'quotes', label: 'Quotes', labelSingular: 'Quote', titleField: 'client',
    fields: [
      { key: 'client', label: 'Client', type: 'text', required: true, group: 'Client' },
      { key: 'email', label: 'Email', type: 'text', group: 'Client', validate: 'len(email) == 0 || len(concat(email)) > 4' },
      { key: 'reference', label: 'Reference', type: 'text', group: 'Client', default: 'Q-' },
      {
        key: 'lines', label: 'Line items', type: 'lineitems', group: 'Scope',
        item: [
          { key: 'desc', label: 'Description', type: 'text' },
          { key: 'qty', label: 'Qty', type: 'number' },
          { key: 'price', label: 'Unit price', type: 'currency' },
          { key: 'total', label: 'Line total', type: 'currency', computed: 'qty * price' },
        ],
      },
      { key: 'subtotal', label: 'Subtotal', type: 'currency', computed: 'round(sum(lines, "total"), 2)', group: 'Totals' },
      { key: 'discountPct', label: 'Discount %', type: 'number', default: 0, group: 'Totals' },
      { key: 'net', label: 'Net', type: 'currency', computed: 'round(subtotal * (1 - discountPct / 100), 2)', group: 'Totals' },
      { key: 'vatable', label: 'Add VAT (20%)', type: 'boolean', default: true, group: 'Totals' },
      { key: 'vat', label: 'VAT', type: 'currency', computed: 'round(if(vatable, net * 0.2, 0), 2)', group: 'Totals' },
      { key: 'total', label: 'Grand total', type: 'currency', computed: 'round(net + vat, 2)', group: 'Totals' },
      { key: 'depositRequired', label: 'Require deposit', type: 'boolean', group: 'Terms' },
      { key: 'deposit', label: 'Deposit', type: 'currency', computed: 'round(if(depositRequired, total * 0.3, 0), 2)', group: 'Terms', showIf: 'depositRequired' },
    ],
    workflow: {
      states: [
        { key: 'draft', label: 'Draft' },
        { key: 'sent', label: 'Sent', color: '#c9930d' },
        { key: 'accepted', label: 'Accepted', color: '#2fac68' },
        { key: 'declined', label: 'Declined', color: '#b45' },
      ],
      transitions: [
        { from: 'draft', to: 'sent' },
        { from: 'sent', to: 'accepted', roles: ['editor', 'admin', 'owner'] },
        { from: 'sent', to: 'declined' },
        { from: 'sent', to: 'draft' },
      ],
    },
    report: QUOTE_REPORT,
    publicRead: false, publicWrite: false,
  })

  // Project tracker: workflow (kanban) + dates (gantt)
  await w('site/data/tables/tasks.json', {
    id: 'tasks', label: 'Project tracker', labelSingular: 'Task', titleField: 'title',
    dateField: 'start', endDateField: 'due',
    fields: [
      { key: 'title', label: 'Task', type: 'text', required: true },
      { key: 'owner', label: 'Owner', type: 'select', options: 'Ana|Bruno|Cai|Devi' },
      { key: 'tags', label: 'Tags', type: 'multiselect', options: 'design|build|research|content' },
      { key: 'estimate', label: 'Estimate (days)', type: 'number' },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'due', label: 'Due', type: 'date' },
    ],
    workflow: {
      states: [
        { key: 'todo', label: 'To do' },
        { key: 'doing', label: 'In progress', color: '#c9930d' },
        { key: 'review', label: 'Review', color: '#6d8' },
        { key: 'done', label: 'Done', color: '#2fac68' },
      ],
    },
    publicRead: false, publicWrite: false,
  })

  // seed a couple of quotes + tasks so the dashboards aren't empty is done at runtime
  await w('site/automations/recipes/quote-accepted.json', {
    id: 'quote-accepted', label: 'Log accepted quotes', on: 'data.state.changed',
    filter: { to: 'accepted' },
    actions: [{ type: 'log', options: { note: 'quote accepted' } }],
    enabled: true,
  })

  await d.write('media/private/welcome-pack.md', '# Meridian welcome pack\n\nThanks for working with us. This file was delivered through a Blockhouse magic link.\n')
  await d.write('.gitignore', '.blockhouse/\nmedia/_var/\ndist/\n')

  // seed some data rows into the secure store so dashboards/kanban are populated
  await seedRows(dir)
}

async function seedRows(dir: string) {
  const { join } = await import('node:path')
  const { openSqlite, jsonFallback, privateStateDir } = await import('../secure/sql.ts')
  const { SecureStore } = await import('../secure/store.ts')
  const stateDir = join(dir, '.blockhouse')
  await privateStateDir(stateDir)
  const sql = (await openSqlite(join(stateDir, 'secure.db'))) ?? jsonFallback(new FsDriver(dir))
  const secure = new SecureStore(sql)
  await secure.migrate()

  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
  const line = (desc: string, qty: number, price: number) => ({ desc, qty, price, total: qty * price })
  const quote = (client: string, ref: string, lines: any[], state: string, opts: any = {}) => {
    const subtotal = lines.reduce((t, l) => t + l.total, 0)
    const net = subtotal * (1 - (opts.discountPct || 0) / 100)
    const vat = opts.vatable === false ? 0 : net * 0.2
    const total = net + vat
    return {
      client, reference: ref, email: opts.email || '', lines,
      subtotal: r2(subtotal), discountPct: opts.discountPct || 0, net: r2(net),
      vatable: opts.vatable !== false, vat: r2(vat), total: r2(total),
      depositRequired: !!opts.depositRequired, deposit: r2(opts.depositRequired ? total * 0.3 : 0),
      _state: state,
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  const existing = await secure.rowsList('data:t:quotes', 1)
  if (!existing.length) {
    await secure.rowInsert('data:t:quotes', quote('Atlas Bank', 'Q-1042', [line('Discovery sprint', 1, 9000), line('Design system', 3, 8000)], 'accepted', { email: 'procurement@atlas.example', depositRequired: true }))
    await secure.rowInsert('data:t:quotes', quote('Velvet Fitness', 'Q-1043', [line('Build cycle', 2, 24000)], 'sent', { discountPct: 10 }))
    await secure.rowInsert('data:t:quotes', quote('Ampere Energy', 'Q-1044', [line('Advisory', 3, 3000)], 'draft', { vatable: false }))
  }
  const existingT = await secure.rowsList('data:t:tasks', 1)
  if (!existingT.length) {
    const tasks = [
      ['Kickoff & systems map', 'Ana', ['research'], 3, day(-4), day(-1), 'done'],
      ['Design language v1', 'Bruno', ['design'], 5, day(-1), day(4), 'doing'],
      ['Auth + sessions', 'Cai', ['build'], 4, day(0), day(5), 'doing'],
      ['Editorial pass', 'Devi', ['content'], 2, day(3), day(6), 'todo'],
      ['Perf & a11y audit', 'Cai', ['build', 'research'], 2, day(6), day(9), 'todo'],
    ]
    for (const [title, owner, tags, estimate, start, due, _state] of tasks) {
      await secure.rowInsert('data:t:tasks', { title, owner, tags, estimate, start, due, _state })
    }
  }
}

// Printable quote report (Liquid) — rendered at /x/data/report/quotes/<id>
const QUOTE_REPORT = `<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>Quote</h1><p class="muted">{{ row.reference }}</p></div>
  <div class="right"><strong>{{ site.name }}</strong><br><span class="muted">hello@meridian.example</span></div>
</div>
<h2>Prepared for {{ row.client }}</h2>
{% if row.email %}<p class="muted">{{ row.email }}</p>{% endif %}
<table>
  <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
  <tbody>
  {% for line in row.lines %}
    <tr><td>{{ line.desc }}</td><td class="num">{{ line.qty }}</td><td class="num">{{ line.price | money }}</td><td class="num">{{ line.total | money }}</td></tr>
  {% endfor %}
  </tbody>
</table>
<table class="totals">
  <tr><td class="right">Subtotal</td><td class="num">{{ row.subtotal | money }}</td></tr>
  {% if row.discountPct %}<tr><td class="right">Discount ({{ row.discountPct }}%)</td><td class="num">−{{ row.subtotal | minus: row.net | money }}</td></tr>{% endif %}
  <tr><td class="right">Net</td><td class="num">{{ row.net | money }}</td></tr>
  {% if row.vatable %}<tr><td class="right">VAT (20%)</td><td class="num">{{ row.vat | money }}</td></tr>{% endif %}
  <tr class="grand"><td class="right">Total</td><td class="num">{{ row.total | money }}</td></tr>
  {% if row.depositRequired %}<tr><td class="right muted">Deposit due (30%)</td><td class="num">{{ row.deposit | money }}</td></tr>{% endif %}
</table>
<p class="muted" style="margin-top:2rem">Valid for 30 days. Prepared by {{ site.name }}.</p>`
