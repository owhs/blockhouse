// One width model. Every block that can choose how wide it runs uses these five
// values — stored verbatim in documents, rendered as `.bh-w-<value>` classes that
// every template implements (plus `.container.w-<value>` for Section).
//
// `entry` was strongman's old name for the reading column; it stays readable
// forever through normalizeWidth rather than being rewritten in stored data.

export interface LayoutWidth {
  value: string
  label: string
  hint: string
}

export const LAYOUT_WIDTHS: LayoutWidth[] = [
  { value: 'narrow', label: 'Narrow', hint: 'A comfortable reading column.' },
  { value: 'normal', label: 'Normal', hint: "The page's standard content width." },
  { value: 'wide', label: 'Wide', hint: 'Breaks out a little either side.' },
  { value: 'page', label: 'Page width', hint: 'As wide as the page allows, keeping the page margins.' },
  { value: 'full', label: 'Edge to edge', hint: 'Touches both edges, no margins.' },
]

export const LAYOUT_WIDTH_VALUES = LAYOUT_WIDTHS.map(w => w.value)

const ALIASES: Record<string, string> = { entry: 'normal' }

/** Map any stored width onto a canonical value. Unknown values return ''. */
export function normalizeWidth(v: unknown): string {
  if (typeof v !== 'string' || !v) return ''
  const key = ALIASES[v] || v
  return LAYOUT_WIDTH_VALUES.includes(key) ? key : ''
}

/** True when a block's own `width` field speaks the canonical vocabulary. */
export function isCanonicalWidthField(field: any): boolean {
  if (!field || field.key !== 'width') return false
  if (field.canonicalWidth) return true
  if (!Array.isArray(field.options) || !field.options.length) return false
  return field.options.every((o: any) => !!normalizeWidth(typeof o === 'string' ? o : o?.value))
}
