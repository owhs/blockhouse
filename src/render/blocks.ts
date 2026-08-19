// Block tree → HTML. In editor mode every block's root element is annotated
// with data-wb="<id>" so the studio preview can select blocks in place.

import type { BlockNode, RenderCtx } from '../core/types.ts'
import { escapeHtml } from '../core/util.ts'

export async function renderBlocks(ctx: RenderCtx, blocks: BlockNode[] | undefined): Promise<string> {
  if (!blocks?.length) return ''
  const parts: string[] = []
  for (const node of blocks) parts.push(await renderBlock(ctx, node))
  return parts.join('\n')
}

export async function renderBlock(ctx: RenderCtx, node: BlockNode): Promise<string> {
  const def = ctx.env.registry.block(node.type)
  if (!def) {
    return ctx.mode === 'preview'
      ? annotate(`<div class="wb-missing">Unknown block: ${escapeHtml(node.type)}</div>`, node, true)
      : ''
  }
  if (def.enhance) ctx.collect.enhancers.add(def.enhance)
  if (node.type === 'tabs') {
    const map = ((ctx as any)._tabIndex ??= {})
    ;(node.children || []).forEach((child, i) => { map[child.id] = { parent: node.id, index: i } })
  }
  let inner = ''
  if (def.container && node.children?.length) inner = await renderBlocks(ctx, node.children)
  let html: string
  try {
    const props = interpolateVars({ ...(def.defaults || {}), ...node.props }, ctx.site.vars || {})
    html = await def.render(ctx, { ...node, props }, inner)
  } catch (e) {
    console.error(`[blockhouse] block "${node.type}" render failed:`, e)
    html = ctx.mode === 'preview' ? `<div class="wb-missing">Block error: ${escapeHtml(node.type)}</div>` : ''
  }
  if (def.jsonld) {
    const ld = def.jsonld(ctx, node)
    if (ld) ctx.collect.jsonld.push(ld)
  }
  return annotate(html, node, ctx.annotate)
}

/**
 * Brand variables: any string prop may contain {{var.key}} (or {{brand.key}}),
 * resolved from site.vars at render time. Lets editors write "Call {{var.phone}}"
 * once and change it globally in Settings → Brand.
 */
const VAR_RE = /\{\{\s*(?:var|brand)\.([\w.-]+)\s*\}\}/g
export function interpolateVars<T>(value: T, vars: Record<string, any>): T {
  if (!vars || !Object.keys(vars).length) return value
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      return VAR_RE.test(v)
        ? v.replace(VAR_RE, (_m, key) => {
          const hit = key.split('.').reduce((acc: any, k: string) => (acc == null ? acc : acc[k]), vars)
          return hit == null ? '' : String(hit)
        })
        : v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(value)
}

function annotate(html: string, node: BlockNode, on: boolean): string {
  if (!on || !html) return html
  const trimmed = html.trimStart()
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)([\s>])/.exec(trimmed)
  if (m) {
    const rest = trimmed.slice(m[0].length)
    // only annotate if this looks like a single root element (heuristic is fine for editor UX)
    return `<${m[1]} data-wb="${node.id}" data-wb-type="${node.type}"${m[2] === '>' ? '>' : ' '}${rest}`
  }
  return `<div data-wb="${node.id}" data-wb-type="${node.type}" style="display:contents">${html}</div>`
}
