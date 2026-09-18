// One core for every block mutation.
//
// These operations used to be open-coded in five places — the canvas toolbar,
// the tree context menu, the inspector trash, the key handler and the picker —
// each with slightly different behaviour and its own idea of what counted as
// undoable. Every surface now calls the same functions, so a keyboard shortcut,
// a drag, a right-click and a command-palette entry all do exactly the same
// thing and all land in the same undo history with the same label.

export const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export function reId(node) {
  node.id = uid()
  for (const c of node.children || []) reId(c)
  return node
}

/** Find a node plus its parent chain and sibling array. */
export function findNode(id, blocks, parents = []) {
  for (const b of blocks) {
    if (b.id === id) return { node: b, parents, siblings: blocks }
    if (b.children) {
      const r = findNode(id, b.children, [...parents, b])
      if (r) return r
    }
  }
  return null
}

/** Depth-first list of every node, in the order the outline shows them. */
export function flatten(blocks, parentId = '', depth = 0, out = []) {
  blocks.forEach((n, index) => {
    out.push({ node: n, parentId, index, depth })
    if (n.children) flatten(n.children, n.id, depth + 1, out)
  })
  return out
}

export function isDescendant(ancestorId, id, blocks) {
  const found = findNode(ancestorId, blocks)
  if (!found) return false
  return !!findNode(id, found.node.children || [])
}

/** A short human name for a block, for undo labels and outline rows. */
export function labelOf(node, def) {
  const p = node.props || {}
  const text = String(p.title || p.text || p.question || p.label || p.md || '')
    .replace(/[#*_>`]/g, '').trim().slice(0, 28)
  return text || def?.label || node.type
}

/**
 * makeOps({ doc, byType, snapshot, markDirty, onTreeChange, onSelect, toast })
 * Every op returns a short description of what it did, for the undo toast.
 */
export function makeOps(ctx) {
  const blocksOf = () => ctx.doc.blocks

  const childrenFor = parentId => {
    if (!parentId) return blocksOf()
    const f = findNode(parentId, blocksOf())
    if (!f) return null
    return (f.node.children ??= [])
  }

  const ops = {
    find: id => findNode(id, blocksOf()),

    insert(node, parentId, index) {
      const arr = childrenFor(parentId)
      if (!arr) return null
      ctx.snapshot(`Add ${ctx.byType[node.type]?.label || node.type}`)
      arr.splice(index ?? arr.length, 0, node)
      ctx.markDirty({ structural: true })
      ctx.onTreeChange()
      return node
    },

    remove(id) {
      const f = findNode(id, blocksOf())
      if (!f) return null
      const name = labelOf(f.node, ctx.byType[f.node.type])
      ctx.snapshot(`Delete ${name}`)
      f.siblings.splice(f.siblings.indexOf(f.node), 1)
      ctx.markDirty({ structural: true })
      ctx.onTreeChange()
      return name
    },

    duplicate(id) {
      const f = findNode(id, blocksOf())
      if (!f) return null
      const name = labelOf(f.node, ctx.byType[f.node.type])
      ctx.snapshot(`Duplicate ${name}`)
      const copy = reId(JSON.parse(JSON.stringify(f.node)))
      f.siblings.splice(f.siblings.indexOf(f.node) + 1, 0, copy)
      ctx.markDirty({ structural: true })
      ctx.onTreeChange()
      ctx.onSelect?.(copy.id)
      return name
    },

    /**
     * Move a block anywhere, including into a different container. The old
     * per-level sortables could only ever reorder within one parent — and, as
     * it turned out, could not even do that.
     */
    move(id, parentId, index) {
      const f = findNode(id, blocksOf())
      if (!f) return null
      if (id === parentId || isDescendant(id, parentId, blocksOf())) return null
      const target = childrenFor(parentId)
      if (!target) return null
      const name = labelOf(f.node, ctx.byType[f.node.type])
      ctx.snapshot(`Move ${name}`)
      const from = f.siblings.indexOf(f.node)
      // removing first shifts later indices in the same array
      f.siblings.splice(from, 1)
      let at = index ?? target.length
      if (f.siblings === target && from < at) at--
      target.splice(Math.max(0, Math.min(at, target.length)), 0, f.node)
      ctx.markDirty({ structural: true })
      ctx.onTreeChange()
      return name
    },

    nudge(id, dir) {
      const f = findNode(id, blocksOf())
      if (!f) return null
      const i = f.siblings.indexOf(f.node)
      const j = i + dir
      if (j < 0 || j >= f.siblings.length) return null
      const name = labelOf(f.node, ctx.byType[f.node.type])
      ctx.snapshot(`Move ${name}`)
      f.siblings.splice(i, 1)
      f.siblings.splice(j, 0, f.node)
      ctx.markDirty({ structural: true })
      ctx.onTreeChange()
      return name
    },

    /** Where a new sibling should go, given what is selected. */
    siteFor(selectedId) {
      if (!selectedId) return { parentId: '', index: blocksOf().length }
      const f = findNode(selectedId, blocksOf())
      if (!f) return { parentId: '', index: blocksOf().length }
      const def = ctx.byType[f.node.type]
      if (def?.container && !(f.node.children || []).length) return { parentId: f.node.id, index: 0 }
      const parentId = f.parents.length ? f.parents[f.parents.length - 1].id : ''
      return { parentId, index: f.siblings.indexOf(f.node) + 1 }
    },
  }
  return ops
}

// ---------- clipboard ----------
// localStorage carries blocks between documents in this browser;
// navigator.clipboard carries them between tabs, windows and people.

const CLIP_KEY = 'blockhouse-block-clipboard'
const SENTINEL = 'blockhouse/block+json'

export async function copyBlocks(nodes) {
  const payload = { [SENTINEL]: 1, blocks: JSON.parse(JSON.stringify(nodes)) }
  const text = JSON.stringify(payload)
  try { localStorage.setItem(CLIP_KEY, text) } catch {}
  try { await navigator.clipboard?.writeText(text) } catch {}
  return nodes.length
}

export async function readClipboard() {
  // the system clipboard wins when it holds blocks — it is the more recent act
  try {
    const text = await navigator.clipboard?.readText()
    const j = text && JSON.parse(text)
    if (j && j[SENTINEL] && Array.isArray(j.blocks)) return j.blocks
  } catch {}
  try {
    const j = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null')
    if (j && j[SENTINEL] && Array.isArray(j.blocks)) return j.blocks
  } catch {}
  return null
}

export function hasClipboard() {
  try { return !!localStorage.getItem(CLIP_KEY) } catch { return false }
}
