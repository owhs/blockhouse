// Custom design blocks: a designer drops <name>.json (field schema) +
// <name>.liquid (markup) into the template's blocks/ dir — or the site's
// site/overrides/blocks/ — and content editors get a first-class block.

import type { BlockhouseEnv } from '../server/env.ts'
import { tryJson } from '../core/util.ts'
import { renderBlocks } from './blocks.ts'

/** Types registered by the last pass, so files deleted from a template stop
 *  being offered instead of lingering until the process restarts. */
const registered = new WeakMap<object, Set<string>>()

export async function registerTemplateBlocks(env: BlockhouseEnv) {
  const previous = registered.get(env.registry) || new Set<string>()
  const types = new Set<string>()
  const seen = new Set<string>()
  for (const key of await env.resolver.list('blocks')) {
    if (!key.endsWith('.json')) continue
    const name = key.slice('blocks/'.length, -'.json'.length)
    if (seen.has(name)) continue
    seen.add(name)
    const def = tryJson<any>(await env.resolver.readText(key), null)
    if (!def) continue
    const liquidFile = `blocks/${name}.liquid`
    const type = def.type || name
    types.add(type)
    env.registry.registerBlock({
      type,
      label: def.label || name,
      group: def.group || 'Template',
      icon: def.icon || '❖',
      description: def.description || '',
      fields: def.fields || [],
      defaults: def.defaults || {},
      container: !!def.container,
      providesH1: !!def.providesH1,
      enhance: def.enhance,
      render: async (ctx, node, inner) => {
        try {
          return await env.liquid.renderFile(liquidFile, {
            __ctx: ctx, props: node.props, inner, block: node, site: ctx.site, doc: ctx.doc,
          })
        } catch (e) {
          console.error(`[blockhouse] template block "${name}" failed:`, e)
          return ctx.mode === 'preview' ? `<div class="wb-missing">Template block error: ${name}</div>` : ''
        }
      },
    }, { replace: true })
  }
  // a block whose files were removed should disappear, not linger until restart
  for (const gone of previous) if (!types.has(gone)) env.registry.blocks.delete(gone)
  registered.set(env.registry, types)
}

export { renderBlocks }
