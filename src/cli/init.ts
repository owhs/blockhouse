// `blockhouse init` — a fresh site that already looks designed: a real homepage
// (hero, features, split, testimonial, FAQ, CTA), an about + contact page,
// two content types, and a menu with a dropdown. Blank-page paralysis is a
// worse default than opinionated starter content you delete.

import { FsDriver } from '../storage/fs.ts'
import { id, now, stringify } from '../core/util.ts'

export async function initSite(dir: string) {
  const d = new FsDriver(dir)
  const homeId = id('d'), aboutId = id('d'), contactId = id('d')
  const b = () => id('b')
  const stamp = { createdAt: now(), updatedAt: now(), version: 1 }

  await d.write('site/site.json', stringify({
    name: 'My Blockhouse site',
    tagline: 'Built with Blockhouse',
    url: 'http://localhost:8787',
    template: 'aurora',
    seo: { titlePattern: '{title} — {site}', description: 'A new site, built with Blockhouse.' },
    homeDocId: homeId,
    plugins: {},
  }))

  await d.write('site/concepts/page.json', stringify({
    name: 'page', label: 'Page', labelPlural: 'Pages', icon: 'page',
    urlPattern: '/{slug}', template: 'page',
    fields: [],
  }))
  await d.write('site/concepts/post.json', stringify({
    name: 'post', label: 'Post', labelPlural: 'Blog posts', icon: 'pen',
    urlPattern: '/blog/{slug}', indexPath: '/blog', perPage: 9, feed: true,
    seo: { titlePattern: '{title} — {site}', schema: 'article' },
    fields: [
      { key: 'lede', type: 'textarea', label: 'Lede', help: 'One-sentence summary shown in lists' },
      { key: 'cover', type: 'image', label: 'Cover image' },
    ],
  }))

  const homeDoc = {
    id: homeId, concept: 'page', slug: 'home', title: 'Home', status: 'published',
    fields: {}, seo: { description: 'A new site, built with Blockhouse.' },
    blocks: [
      {
        id: b(), type: 'section', props: { width: 'normal', padding: 'spacious' }, children: [{
          id: b(), type: 'hero', props: {
            eyebrow: 'A fresh start', title: 'Say something worth building a site for',
            text: 'This whole page is starter content — open the studio, click anything, and make it yours. About and Contact are waiting as drafts.',
            layout: 'center',
            buttons: [
              { label: 'Open the studio', link: { href: '/admin/' }, style: 'primary' },
              { label: 'Read the guide', link: { href: '/about' }, style: 'ghost' },
            ],
          },
        }],
      },
      {
        id: b(), type: 'section', props: { background: 'subtle' }, children: [
          { id: b(), type: 'heading', props: { text: 'Why Blockhouse', level: 2, align: 'center', eyebrow: 'The short version' } },
          {
            id: b(), type: 'columns', props: { cols: 3, gap: 'normal' }, children: [
              { id: b(), type: 'feature-card', props: { icon: 'sparkle', title: 'Blocks, not templates', text: 'Compose pages from real components — heroes, FAQs, pricing, galleries — and rearrange them any time.' } },
              { id: b(), type: 'feature-card', props: { icon: 'bolt', title: 'Fast by default', text: 'No framework on the page. Prefetching, view transitions and image variants come built in.' } },
              { id: b(), type: 'feature-card', props: { icon: 'shield', title: 'Yours to keep', text: 'Content is flat JSON in git. Run it on your laptop, a server, or Cloudflare — no lock-in.' } },
            ],
          },
        ],
      },
      {
        id: b(), type: 'section', props: {}, children: [{
          id: b(), type: 'feature-split', props: {
            eyebrow: 'The design system',
            title: 'Design without redesigning',
            text: 'Change the palette with two sliders under **Design** — hue and intensity — and the whole site follows, light and dark alike.\n\nSwap templates whenever; your content never changes shape.',
            side: 'right',
            buttons: [{ label: 'Open Design', link: { href: '/admin/#/design' }, style: 'ghost' }],
          },
        }],
      },
      {
        id: b(), type: 'section', props: { background: 'subtle' }, children: [
          { id: b(), type: 'testimonial', props: { quote: 'Replace this with something a real person said about you. Short quotes read better than long ones.', name: 'A happy client', role: 'Their company' } },
        ],
      },
      {
        id: b(), type: 'section', props: {}, children: [
          { id: b(), type: 'heading', props: { text: 'Quick answers', level: 2, align: 'center' } },
          {
            id: b(), type: 'faq', props: { single: true }, children: [
              { id: b(), type: 'faq-item', props: { question: 'How do I edit this page?', open: true }, children: [{ id: b(), type: 'richtext', props: { md: 'Open **/admin**, sign in, and double-click any text — or use the block tree on the left.' } }] },
              { id: b(), type: 'faq-item', props: { question: 'How do I add a new type of content?' }, children: [{ id: b(), type: 'richtext', props: { md: 'Sidebar → **New content type**. Products, projects, recipes — define the fields and it appears in the sidebar.' } }] },
              { id: b(), type: 'faq-item', props: { question: 'How do I go live?' }, children: [{ id: b(), type: 'richtext', props: { md: 'Publish your pages, then check **Deploy** — it diagnoses your setup and writes the config for your host.' } }] },
            ],
          },
        ],
      },
      {
        id: b(), type: 'section', props: {}, children: [{
          id: b(), type: 'cta', props: {
            title: 'Ready when you are', text: 'Delete what you don’t need, keep what you do, and ship it.',
            buttons: [{ label: 'Get in touch', link: { href: '/contact' }, style: 'primary' }],
          },
        }],
      },
    ],
    ...stamp,
  }
  // Home ships published (working copy + snapshot) so a fresh site renders
  // immediately; About and Contact stay drafts to teach the publish flow.
  await d.write('site/content/page/home.json', stringify(homeDoc))
  await d.write('site/content/.published/page/home.json', stringify(homeDoc))

  await d.write('site/content/page/about.json', stringify({
    id: aboutId, concept: 'page', slug: 'about', title: 'About', status: 'draft',
    fields: {}, seo: {},
    blocks: [
      { id: b(), type: 'section', props: { width: 'normal' }, children: [
        { id: b(), type: 'hero', props: { title: 'About this site', text: 'Use this page to say who you are and why you do what you do.', layout: 'left' } },
        { id: b(), type: 'richtext', props: { md: 'Write like you talk. Two or three honest paragraphs beat a page of corporate filler.\n\n- What you make\n- Who it is for\n- Why you care' } },
      ] },
    ],
    ...stamp,
  }))

  await d.write('site/content/page/contact.json', stringify({
    id: contactId, concept: 'page', slug: 'contact', title: 'Contact', status: 'draft',
    fields: {}, seo: {},
    blocks: [
      { id: b(), type: 'section', props: { width: 'normal' }, children: [
        { id: b(), type: 'hero', props: { title: 'Get in touch', text: 'Enable the Forms plugin and drop a form block here — spam protection included.', layout: 'left' } },
        { id: b(), type: 'richtext', props: { md: 'Or just list an email address. Simple works.' } },
      ] },
    ],
    ...stamp,
  }))

  await d.write('site/menus/main.json', stringify({
    key: 'main', label: 'Main menu',
    items: [
      { id: id('mi'), label: 'Home', type: 'link', href: '/' },
      {
        id: id('mi'), label: 'About', type: 'doc', docId: aboutId,
        children: [
          { id: id('mi'), label: 'Our story', type: 'doc', docId: aboutId },
          { id: id('mi'), label: 'Contact', type: 'doc', docId: contactId },
        ],
      },
      { id: id('mi'), label: 'Blog', type: 'link', href: '/blog' },
      { id: id('mi'), label: 'Contact', type: 'doc', docId: contactId },
    ],
  }))
  await d.write('site/menus/footer.json', stringify({
    key: 'footer', label: 'Footer',
    items: [
      { id: id('mi'), label: 'About', type: 'doc', docId: aboutId },
      { id: id('mi'), label: 'Contact', type: 'doc', docId: contactId },
    ],
  }))

  await d.write('.gitignore', '.blockhouse/\nmedia/_var/\ndist/\nnode_modules/\n')
}
