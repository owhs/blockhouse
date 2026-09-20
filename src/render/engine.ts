// Templating over the layered resolver (site overrides → site template →
// built-in template), with Blockhouse's tags and filters:
//   {% region 'content' %}    doc block regions
//   {% slot 'header.after' %}  site-level block injections on template slots
//   {% menu 'main' %}          menus incl. mega panels
//   filters: md, excerpt, img, asset, json, slug, icon, docpath (+ escape/date/… built-ins)

import { LiquidLite } from '../vendor/liquid.ts'
import type { BlockhouseEnv } from '../server/env.ts'
import type { RenderCtx } from '../core/types.ts'
import { mdToHtml, mdExcerpt } from '../core/markdown.ts'
import { renderBlocks, renderBlock } from './blocks.ts'
import { renderMenu } from './menus.ts'
import { pictureHtml } from './imgtag.ts'
import { escapeHtml, slugify } from '../core/util.ts'
import { siteIcon } from '../core/icons.ts'

export function createEngine(env: BlockhouseEnv): LiquidLite {
  const liquid = new LiquidLite({
    read: file => env.resolver.readText(file),
    cache: !env.dev,
  })

  // ---------- tags ----------

  liquid.registerTag('region', async (name, scope) => {
    const rctx: RenderCtx = scope.__ctx
    if (!rctx?.doc) return ''
    const blocks = name === 'content' ? rctx.doc.blocks : rctx.doc.regions?.[String(name)]
    const html = await renderBlocks(rctx, blocks)
    return name === 'content' && rctx.annotate
      ? `<div data-wb-region="content" style="display:contents">${html}</div>`
      : html
  })

  liquid.registerTag('slot', async (name, scope) => {
    const rctx: RenderCtx = scope.__ctx
    const blocks = rctx?.site.slots?.[String(name)]
    if (!blocks?.length) return ''
    const inner: RenderCtx = { ...rctx, annotate: false }
    if (!rctx.annotate) return renderBlocks(inner, blocks)
    // In the editor, a header/footer block is not part of this page's content —
    // it is on every page. Mark each one so a click can open the header/footer
    // panel at the right block instead of shrugging.
    const parts: string[] = []
    for (const b of blocks) {
      parts.push(`<div data-wb-slot="${escapeHtml(String(name))}" data-wb-slot-block="${escapeHtml(String(b.id))}" style="display:contents">${await renderBlock(inner, b)}</div>`)
    }
    return parts.join('\n')
  })

  liquid.registerTag('menu', async (key, scope) => {
    const rctx: RenderCtx = scope.__ctx
    const k = String(key)
    const menu = (rctx?.menuDraft === k && env.menuDrafts.get(k)) || await env.content.menu(k)
    return menu && rctx ? renderMenu(rctx, menu) : ''
  })

  // ---------- filters ----------

  liquid.registerFilter('md', v => mdToHtml(String(v ?? '')))
  liquid.registerFilter('excerpt', (v, [words]) => mdExcerpt(String(v ?? ''), Number(words) || 32))
  liquid.registerFilter('slug', v => slugify(String(v ?? '')))
  // {{ props.icon | icon: 22 }} — a name from the site icon set becomes inline
  // SVG. Anything unrecognised passes through escaped, so a literal character
  // still works but never silently renders as a tofu box in a serif template.
  liquid.registerFilter('icon', (v, [size]) => {
    const name = String(v ?? '').trim()
    if (!name) return ''
    return siteIcon(name, Number(size) || 22) || escapeHtml(name)
  })
  liquid.registerFilter('json', v => JSON.stringify(v))
  liquid.registerFilter('img', async (mediaId, _args, kwargs, scope) => {
    const rctx: RenderCtx = scope.__ctx
    if (!mediaId || !rctx) return ''
    return pictureHtml(rctx, String(mediaId), kwargs as any)
  })
  liquid.registerFilter('asset', v =>
    `/assets/site/${String(v ?? '').replace(/^\/+/, '')}?v=${(env as any).assetVersion || '1'}`)
  liquid.registerFilter('docpath', async v => (v ? env.content.docPath(v as any) : '#'))

  // ---------- "edit this on the page" annotations ----------
  // These emit nothing on the live site. In the editor preview they mark which
  // bit of HTML came from which block prop / content field, so double-clicking
  // the words on the page edits the real value.
  //
  //   <h2{{ 'heading' | wbe }}>            block prop `heading`, plain text
  //   <div{{ 'body' | wbe: 'md' }}>        block prop `body`, markdown
  //   <figure{{ 'image' | wbe: 'img' }}>   block prop `image`, a picture
  //   <h3{{ 'tiles' | wbe_at: forloop.index0, 'title' }}>   tiles[0].title
  //   <p{{ 'strapline' | wbf }}>           this page's `strapline` content field
  //
  // Documented in docs/blocks-and-templates.md.
  const key = (v: unknown) => String(v ?? '').replace(/[^\w.\-]/g, '')
  const annotating = (scope: any) => !!(scope?.__ctx as RenderCtx | undefined)?.annotate
  const mark = (prop: string, mode?: unknown): string => {
    if (!prop) return ''
    const m = key(mode)
    if (m === 'img') return ` data-wbe-img="${prop}"`
    return ` data-wbe="${prop}"${m ? ` data-wbe-mode="${m}"` : ''}`
  }

  liquid.registerFilter('wbe', (v, [mode], _kw, scope) =>
    annotating(scope) ? mark(key(v), mode) : '')
  liquid.registerFilter('wbe_at', (v, [index, k, mode], _kw, scope) =>
    annotating(scope) ? mark(`${key(v)}.${key(index)}.${key(k)}`, mode) : '')
  liquid.registerFilter('wbimg', (v, _a, _kw, scope) =>
    annotating(scope) ? mark(key(v), 'img') : '')
  liquid.registerFilter('wbf', (v, [mode], _kw, scope) => {
    if (!annotating(scope)) return ''
    const k = key(v)
    if (!k) return ''
    const m = key(mode)
    return ` data-wbf="${k}"${m ? ` data-wbf-mode="${m}"` : ''}`
  })

  return liquid
}
