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
import { renderBlocks } from './blocks.ts'
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
    return renderBlocks({ ...rctx, annotate: false }, blocks)
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

  return liquid
}
