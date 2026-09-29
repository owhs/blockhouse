// Page assembly: concept template → layout, plus head/SEO, theme tokens,
// runtime script, speculation rules, and (in editor preview) the bridge script.

import type { ConceptDef, Doc, RenderCtx, SiteConfig, User } from '../core/types.ts'
import type { BlockhouseEnv } from '../server/env.ts'
import { headHtml } from './seo.ts'
import { escapeHtml } from '../core/util.ts'
import { canView, isGated } from '../core/access.ts'

export interface RenderOpts {
  mode: 'live' | 'preview' | 'export'
  /** Hide site chrome (header/footer) — the editor's focused mode. */
  bare?: boolean
  /** Canonical URL of the document when serving it at a mirrored alias. */
  canonicalPath?: string
  /** Menu key whose studio draft should render instead of the saved menu. */
  menuDraft?: string
  user?: User | null
  /** Signed-in site visitor, when the members plugin is active. Used to decide
   *  whether member-only documents appear in listings. */
  member?: { id: string; groups?: string[] } | null
  annotate?: boolean
  /** Rendered inside a studio preview frame (Design, Header & footer, Menus).
   *  Live content, but none of the first-visit furniture. */
  studioPreview?: boolean
  path: string
}

/** True when this viewer may see the document at all (listings + direct hits). */
export function docVisibleTo(doc: Doc, opts: RenderOpts): boolean {
  if (opts.mode === 'export') return !isGated(doc)   // flat builds never include gated pages
  return canView(doc, { admin: opts.mode === 'preview' || !!opts.user, member: opts.member })
}

function makeCtx(env: BlockhouseEnv, site: SiteConfig, opts: RenderOpts, doc?: Doc): RenderCtx {
  return {
    site, doc, mode: opts.mode, annotate: !!opts.annotate, user: opts.user ?? null, member: opts.member ?? null,
    canonicalPath: opts.canonicalPath, menuDraft: opts.menuDraft, bare: !!opts.bare,
    studioPreview: opts.mode === 'preview' || !!opts.annotate || !!opts.menuDraft || !!opts.studioPreview,
    collect: { jsonld: [], variants: new Set(), enhancers: new Set(), headExtra: [] },
    path: opts.path, baseUrl: '', env,
  }
}

async function templateFor(env: BlockhouseEnv, doc: Doc, concept: ConceptDef | null): Promise<string> {
  const wanted = [doc.template, concept?.template, concept?.name, 'page'].filter(Boolean) as string[]
  for (const t of wanted) {
    if (await env.resolver.stat(`pages/${t}.liquid`)) return `pages/${t}.liquid`
  }
  return 'pages/page.liquid'
}

export async function renderDocPage(env: BlockhouseEnv, doc: Doc, opts: RenderOpts): Promise<string> {
  const site = await env.site()
  const concept = await env.content.concept(doc.concept)
  const ctx = makeCtx(env, site, opts, doc)
  const tpl = await templateFor(env, doc, concept)
  const main = await env.liquid.renderFile(tpl, {
    __ctx: ctx, site, doc, concept, fields: doc.fields, path: opts.path,
  })
  return assemble(env, ctx, main, { doc, concept })
}

export async function renderListPage(env: BlockhouseEnv, concept: ConceptDef, page: number, opts: RenderOpts): Promise<{ html: string; pages: number } | null> {
  const site = await env.site()
  const ctx = makeCtx(env, site, opts)
  const all = await env.content.listDocs(concept.name, { published: opts.mode !== 'preview' })
  const visible = all.filter(d => (opts.mode === 'preview' || d.status === 'published') && docVisibleTo(d, opts))
    .sort((a, b) => (b.publishAt || b.createdAt).localeCompare(a.publishAt || a.createdAt))
  const perPage = concept.perPage || 9
  const pages = Math.max(1, Math.ceil(visible.length / perPage))
  if (page > pages) return null
  const docs = visible.slice((page - 1) * perPage, page * perPage)
  const withPaths = []
  for (const d of docs) withPaths.push({ ...d, path: await env.content.docPath(d, concept) })
  const tplName = (await env.resolver.stat(`pages/${concept.indexTemplate || 'list'}.liquid`)) ? `pages/${concept.indexTemplate || 'list'}.liquid` : 'pages/list.liquid'
  const main = await env.liquid.renderFile(tplName, {
    __ctx: ctx, site, concept, docs: withPaths, page, pages,
    prevUrl: page > 2 ? `${concept.indexPath}/page/${page - 1}` : page === 2 ? concept.indexPath : null,
    nextUrl: page < pages ? `${concept.indexPath}/page/${page + 1}` : null,
  })
  const html = await assemble(env, ctx, main, { concept, titleOverride: concept.labelPlural || concept.label })
  return { html, pages }
}

export async function render404(env: BlockhouseEnv, opts: RenderOpts): Promise<string> {
  return renderSystemPage(env, '404', opts, {
    title: 'Not found',
    fallback: `<section class="wb-section pad-spacious"><div class="container w-normal" style="text-align:center"><h1>Page not found</h1><p>The page you're looking for doesn't exist. <a href="/">Back home →</a></p></div></section>`,
  })
}

/**
 * System pages ('404', 'maintenance', 'search', …). Resolution order:
 *   a document assigned in site.systemPages  →  pages/<key>.liquid in the
 *   template layers  →  a hard-coded fallback. Assigning a document means these
 *   pages get the whole block editor, not a template file you have to hand-edit.
 */
export async function renderSystemPage(
  env: BlockhouseEnv,
  key: string,
  opts: RenderOpts,
  o: { title: string; fallback: string },
): Promise<string> {
  const site = await env.site()
  const docId = site.systemPages?.[key]
  if (docId) {
    const doc = await env.content.getDoc(docId)
    if (doc) {
      // Published snapshot when there is one, so drafts of the 404 don't go live.
      const live = (await env.content.getBySlug(doc.concept, doc.slug, true)) || (opts.mode === 'preview' ? doc : null)
      if (live) {
        const ctx = makeCtx(env, site, opts, live)
        const concept = await env.content.concept(live.concept)
        const tpl = await templateFor(env, live, concept)
        const main = await env.liquid.renderFile(tpl, { __ctx: ctx, site, doc: live, concept, fields: live.fields, path: opts.path })
        return assemble(env, ctx, main, { doc: live, concept, titleOverride: live.title })
      }
    }
  }
  const ctx = makeCtx(env, site, opts)
  let main: string
  try {
    main = await env.liquid.renderFile(`pages/${key}.liquid`, { __ctx: ctx, site })
  } catch {
    main = o.fallback
  }
  return assemble(env, ctx, main, { titleOverride: o.title })
}

async function assemble(env: BlockhouseEnv, ctx: RenderCtx, main: string, meta: { doc?: Doc; concept?: ConceptDef | null; titleOverride?: string }): Promise<string> {
  const site = ctx.site
  const head = await headHtml(ctx, meta.doc ?? null, meta.concept ?? null, { titleOverride: meta.titleOverride })

  const tokens: Record<string, string> = { ...(site.theme?.tokens || {}) }
  // custom fonts assigned to a role become body/display/mono token overrides
  for (const f of site.fonts || []) {
    const fam = `'${String(f.family).replace(/['"]/g, '')}'`
    if (f.role === 'body') tokens['font-body-custom'] = fam
    if (f.role === 'display') tokens['font-display-custom'] = fam
    if (f.role === 'mono') tokens['font-mono'] = fam
  }
  const tokenCss = Object.keys(tokens).length
    ? `<style id="blockhouse-tokens">:root{${Object.entries(tokens).map(([k, v]) => `--${k.replace(/^--/, '')}:${String(v).replace(/[;{}]/g, '')}`).join(';')}}</style>`
    : ''

  // custom fonts (@font-face + preloads) and global/per-page custom code
  const fontCss = buildFontCss(site)
  const globalCss = site.customCss ? `<style id="blockhouse-global-css">${stripCssTags(site.customCss)}</style>` : ''
  const pageCss = meta.doc?.custom?.css ? `<style id="blockhouse-page-css">${stripCssTags(meta.doc.custom.css)}</style>` : ''
  const globalJs = site.customJs && ctx.mode !== 'preview' ? `<script type="module" id="blockhouse-global-js">${stripScriptTag(site.customJs)}</script>` : ''
  const pageJs = meta.doc?.custom?.js && ctx.mode !== 'preview' ? `<script type="module" id="blockhouse-page-js">${stripScriptTag(meta.doc.custom.js)}</script>` : ''

  // Colour scheme: 'auto' follows the OS + remembers a visitor's toggle;
  // 'light'/'dark' locks the public site (and the editor preview) to one scheme.
  const scheme = site.theme?.colorScheme || 'auto'
  const locked = scheme === 'light' || scheme === 'dark'
  const bareCss = ctx.bare ? `<style id="blockhouse-bare">.site-header,.site-footer{display:none!important}</style>` : ''
  // A studio preview is a picture of the page, not a visit to it. Anything a
  // template hides with opacity alone (some navigation panels animate open that
  // way) would otherwise hang translucent over the page inside the frame, so
  // every closed panel is held properly shut here.
  // The Navigation page is the exception: its whole job is to show the panel
  // you are editing, already open — so it never gets the closing rule.
  // Scroll-reveal animations hide a block until it scrolls into view. The
  // preview frame is scaled and often taller than the canvas, so half the page
  // sat faded or invisible in the editor. In the preview everything is shown
  // as it ends up; the visitor's page is untouched.
  const revealOff = ctx.studioPreview
    ? `html[data-bh-preview] .anim-hidden,html[data-bh-preview] .reveal,` +
      `html[data-bh-preview] [data-reveal]{opacity:1!important;transform:none!important;translate:none!important;visibility:visible!important}`
    : ''
  const closedPanels = ctx.studioPreview && !ctx.menuDraft
    ? `html[data-bh-preview="1"] .nav-item:not(.open):not(.drilled) > .drop-panel,` +
      `html[data-bh-preview="1"] .nav-item:not(.open):not(.drilled) > .mega-panel{` +
      `opacity:0!important;visibility:hidden!important;pointer-events:none!important}`
    : ''
  // Visitor overlays (an enlarged-image viewer, the search overlay, a popup)
  // belong to a visit, not to editing. Opened inside the editor canvas one of
  // them covers the whole page, swallows every click and cannot be closed from
  // the studio chrome. Held shut at the source so no site script can raise one.
  const overlaysOff = ctx.studioPreview && !ctx.menuDraft
    ? `html[data-bh-preview="1"] .sm-lb,html[data-bh-preview="1"] .lightbox-overlay,` +
      `html[data-bh-preview="1"] .search-overlay,html[data-bh-preview="1"] [data-bh-overlay]{display:none!important}`
    : ''
  const previewCss = revealOff || closedPanels || overlaysOff
    ? `<style id="blockhouse-preview">${closedPanels}${overlaysOff}${revealOff}</style>`
    : ''
  const vtOff = (site.features?.viewTransitions === false) ? `<style id="blockhouse-vt-off">@view-transition{navigation:none}</style>` : ''
  const schemeCss = locked
    ? `<style id="blockhouse-scheme">:root{color-scheme:${scheme}}</style>`
    : ''
  const themeBoot = locked
    ? `<script>document.documentElement.dataset.theme=${JSON.stringify(scheme)}</script>`
    : `<script>(function(){try{var t=localStorage.getItem('blockhouse-theme');if(t&&t!=='auto')document.documentElement.dataset.theme=t}catch(e){}})()</script>`
  const feats = site.features || {}
  const spec = ctx.mode === 'live' && feats.prefetch !== false
    ? `<script type="speculationrules">{"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/admin/*"}},{"not":{"href_matches":"/api/*"}}]},"eagerness":"moderate"}]}</script>`
    : ''
  const enhancers = [...ctx.collect.enhancers]
  const consentOn = !!site.plugins?.consent?.enabled
  let consentBanner = ''
  if (consentOn && ctx.mode === 'live' && !ctx.studioPreview && !ctx.bare) {
    const { consentHtml } = await import('../../../plugins/consent/index.ts')
    consentBanner = consentHtml(site.plugins!.consent!.settings || {}, {
      beacon: !!site.plugins?.analytics?.enabled && feats.analyticsBeacon !== false,
    })
  }
  const beacon = ctx.mode === 'live' && site.plugins?.analytics?.enabled && feats.analyticsBeacon !== false
    ? `<script>(function(){try{if(location.pathname.startsWith('/admin'))return;${consentOn ? "var c=(document.cookie.match(/(?:^|; )blockhouse_consent=([^;]*)/)||[])[1];if(!c||c.indexOf('analytics')<0)return;" : ''}var b=function(){navigator.sendBeacon('/x/analytics/hit',JSON.stringify({p:location.pathname,r:document.referrer}))};if(document.readyState!=='loading')b();else addEventListener('DOMContentLoaded',b)}catch(e){}})()</script>`
    : ''
  // Ahrefs: the site-verification tag and (when switched on) Web Analytics.
  let ahrefsHead = ''
  if (site.plugins?.ahrefs?.enabled && !ctx.studioPreview && !ctx.bare) {
    const { headHtml } = await import('../../../plugins/ahrefs/index.ts')
    // The verification tag must be on every rendering Ahrefs might fetch; the
    // analytics script only on live pages, so the studio never counts itself.
    const s = (site.plugins.ahrefs as any).settings || {}
    // productionHost: analytics only ever counts on the site's real address,
    // never on a staging hostname serving the same pages.
    ahrefsHead = headHtml(ctx.mode === 'live' ? s : { ...s, loadAnalytics: false }, { consentGate: consentOn, productionHost: site.url || '' })
  }
  const runtime = `<script type="module" src="/assets/blockhouse/runtime.js?v=${(env as any).assetVersion || '1'}"></script>${beacon}`
  const adminP = String(site.security?.adminPath || 'admin').replace(/[^a-zA-Z0-9_-]/g, '') || 'admin'
  const bridge = ctx.annotate ? `<script src="/${adminP}/assets/bridge.js"></script>` : ''
  const devReload = env.dev && ctx.mode === 'live' ? `<script type="module" src="/assets/blockhouse/dev-reload.js"></script>` : ''

  const html = await env.liquid.renderFile('layout.liquid', {
    __ctx: ctx, site, doc: ctx.doc, main, head,
    vars: site.vars || {},
    features: resolvedFeatures(site),
    lang: site.language || 'en',
    scheme_locked: locked,
    show_theme_toggle: !locked && site.theme?.showToggle !== false && feats.themeToggle !== false,
    body_attrs: `data-blockhouse-enhance="${enhancers.join(' ')}"${ctx.annotate ? ' data-blockhouse-editing="1"' : ''}${locked ? ` data-scheme-locked="${scheme}"` : ''}`,
  })

  // late head injections (kept out of template authors' way)
  const headInject = `${fontCss}\n${schemeCss}\n${bareCss}\n${previewCss}\n${vtOff}\n${tokenCss}\n${globalCss}\n${pageCss}\n${themeBoot}\n${spec}\n${ahrefsHead}\n${runtime}\n${bridge}\n${devReload}`
  let out = html
    .replace('</head>', `${headInject}\n</head>`)
  // The marker goes on <html> so the CSS above and runtime.js can both see it
  // before anything paints — a body class would be too late for the banner.
  if (ctx.studioPreview) out = out.replace(/<html\b/i, `<html data-bh-preview="${ctx.menuDraft ? 'menu' : '1'}"`)
  out = out.replace('</body>', `${globalJs}\n${pageJs}\n${consentBanner}\n</body>`)
  // Off means off: with RSS disabled, no template or content may leave a dead
  // feed link behind — head alternates are removed, body anchors unwrap to text
  // (menus already drop feed items at the source). Same for the sitemap.
  if (feats.rss === false) out = stripDeadLinks(out, /\/feed\.xml$/)
  if (feats.sitemap === false) out = stripDeadLinks(out, /\/sitemap\.xml$/)
  return out
}

/** The features switchboard with defaults applied — what templates see as `features.*`. */
export function resolvedFeatures(site: SiteConfig) {
  const f = site.features || {}
  return {
    rss: f.rss !== false,
    sitemap: f.sitemap !== false,
    prefetch: f.prefetch !== false,
    viewTransitions: f.viewTransitions !== false,
    themeToggle: f.themeToggle !== false,
    analyticsBeacon: f.analyticsBeacon !== false,
    searchOpenSearch: f.searchOpenSearch !== false,
  }
}

/** Remove head alternate links and unwrap body anchors whose href matches. */
function stripDeadLinks(html: string, hrefEnd: RegExp): string {
  return html
    .replace(/<link\b[^>]*rel="alternate"[^>]*>\s*/gi, m => {
      const href = m.match(/href="([^"]*)"/i)?.[1] || ''
      return hrefEnd.test(href.split('?')[0]) ? '' : m
    })
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) =>
      hrefEnd.test(String(href).split('?')[0]) ? inner : m)
}

function stripCssTags(css: string): string {
  return String(css).replace(/<\/?(style|script)[^>]*>/gi, '').replace(/<\/?[a-z]/gi, '')
}
function stripScriptTag(js: string): string {
  return String(js).replace(/<\/script/gi, '<\\/script')
}
function buildFontCss(site: SiteConfig): string {
  const fonts = site.fonts || []
  if (!fonts.length) return ''
  const faces = fonts.map(f =>
    `@font-face{font-family:'${String(f.family).replace(/['"]/g, '')}';src:url('/media/${f.file}') format('${f.format || 'woff2'}');font-weight:${f.weight || 400};font-style:${f.style || 'normal'};font-display:swap;}`
  ).join('')
  const preloads = fonts.filter(f => f.preload).map(f => `<link rel="preload" as="font" type="font/${f.format || 'woff2'}" href="/media/${f.file}" crossorigin>`).join('')
  return `${preloads}<style id="blockhouse-fonts">${faces}</style>`
}

export function errorPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#111;color:#eee}main{text-align:center;padding:2rem}h1{font-weight:600}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
}
