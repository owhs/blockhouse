// Block tree → HTML. In editor mode every block's root element is annotated
// with data-wb="<id>" so the studio preview can select blocks in place.

import type { BlockNode, RenderCtx } from '../core/types.ts'
import { escapeHtml } from '../core/util.ts'
import { LAYOUT_WIDTHS, normalizeWidth, isCanonicalWidthField } from './layout.ts'

export { LAYOUT_WIDTHS, normalizeWidth, isCanonicalWidthField }
export type { LayoutWidth } from './layout.ts'

export async function renderBlocks(ctx: RenderCtx, blocks: BlockNode[] | undefined, depth = 0): Promise<string> {
  if (!blocks?.length) return ''
  const parts: string[] = []
  for (const node of blocks) parts.push(await renderBlock(ctx, node, depth))
  return parts.join('\n')
}

export async function renderBlock(ctx: RenderCtx, node: BlockNode, depth = 0): Promise<string> {
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
  if (def.container && node.children?.length) inner = await renderBlocks(ctx, node.children, depth + 1)
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
  // Width is only meaningful for a block sitting directly on the page: inside a
  // Section or Columns the container owns the measure, and a block claiming a
  // grid column it is not a child of would land nowhere.
  // A container that already renders its own width wrapper (Section: `.container
  // w-<width>`) must not also be squeezed at its root, or its background stops
  // bleeding. Everything else gets the class.
  const own = def.fields?.find((fd: any) => isCanonicalWidthField(fd))
  if (depth === 0 && !(own && def.container)) {
    const w = normalizeWidth(node.layout?.width ?? (own ? node.props?.width : undefined))
    if (w) html = addRootClass(html, `bh-w-${w}`)
  }
  return annotate(html, node, ctx.annotate, !!def.container, def.label)
}

/** Add a class to the opening tag of an HTML fragment's root element. */
function addRootClass(html: string, cls: string): string {
  const trimmed = html.trimStart()
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)([\s>])/.exec(trimmed)
  if (!m) return html
  const end = trimmed.indexOf('>')
  if (end < 0) return html
  const open = trimmed.slice(0, end + 1)
  const rest = trimmed.slice(end + 1)
  // The class attribute may be one of several written back-to-back, so rewrite
  // just its quoted value in place rather than the whole tag.
  const attr = /\sclass\s*=\s*"([^"]*)"|\sclass\s*=\s*'([^']*)'/.exec(open)
  if (attr) {
    const q = attr[1] != null ? '"' : "'"
    const value = attr[1] != null ? attr[1] : attr[2]
    return open.slice(0, attr.index) + ` class=${q}${value} ${cls}${q}` + open.slice(attr.index + attr[0].length) + rest
  }
  return `<${m[1]} class="${cls}"${m[2] === '>' ? '>' : ' '}${trimmed.slice(m[0].length)}`
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

function annotate(html: string, node: BlockNode, on: boolean, container = false, label?: string): string {
  if (!on || !html) return html
  // draggable + a container marker so the preview can offer drag-and-drop on the
  // page itself, not only in the studio's outline rail.
  // data-wb-label carries the block's human name ("Hero slider") so the canvas
  // chip can say the same thing the outline and the inspector say, instead of
  // printing the developer's key.
  const human = label ? ` data-wb-label="${escapeHtml(label)}"` : ''
  const attrs = `data-wb="${node.id}" data-wb-type="${node.type}"${human}${container ? ' data-wb-container="1"' : ''} draggable="true"`
  const trimmed = html.trimStart()
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)([\s>])/.exec(trimmed)
  if (m) {
    const rest = trimmed.slice(m[0].length)
    // only annotate if this looks like a single root element (heuristic is fine for editor UX)
    return `<${m[1]} ${attrs}${m[2] === '>' ? '>' : ' '}${rest}`
  }
  return `<div ${attrs} style="display:contents">${html}</div>`
}
