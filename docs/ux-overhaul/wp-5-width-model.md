# WP-5 — One width model for every block and template

Owner files: `src/render/blocks.ts` (whole, ~100 lines), `src/render/native-blocks.ts` (Section def ~line 30–50, Image def ~line 105–115 only), `src/core/types.ts` (BlockNode — grep `interface BlockNode`), `templates/*/assets/base.css` and `templates/strongman/assets/base.css` + `components.css` (only the container/width rules — grep `\.w-` and `content__body`), `templates/strongman/blocks/photo-row.json` + `.liquid` (width field), `src/assets/admin/editor.js` `renderBlockTab` only (grep `containerForm` / `wrapForm` / `wrapInSection` — replace that layout section), `src/assets/admin/docops.js` (only if a helper is needed).
Also read `docs/blocks-and-templates.md` (grep "width") to keep docs true.

## Facts (measured on the real sites)

- strongman: 38 docs, `section` used 2 times. Real blocks: richtext 252, heading 79, photo-row 53, faq-item 37, diagram 26. Stored widths: `entry` 26, `page` 40, `wide` 44 (all on photo-row).
- automatic: `section` 262 times; stored widths: `normal` 524.
- Vocabularies today: Section `normal|wide|full` (all templates except strongman implement `.container.w-*`); strongman implements `.w-normal|.w-narrow` on section containers and a named-line content grid (`entry|wide|full` columns) for top-level blocks; photo-row `entry|wide|page|full`.
- The editor tells users width "belongs to the Section around this block" and offers "Wrap in a Section". On strongman that is wrong; on automatic it nests everything.

## Required outcome

### Canonical vocabulary (five values, never renamed in stored data)

| value | label shown to users | meaning |
|---|---|---|
| `narrow` | Narrow | a comfortable reading column (≈52rem) |
| `normal` | Normal | the page's standard content width (default) |
| `wide` | Wide | breaks out a little either side |
| `page` | Page width | as wide as the page allows, keeps the page margins |
| `full` | Edge to edge | touches both edges, no margins |

Legacy alias: `entry` → `normal`. Nothing else changes meaning: strongman's existing `page`/`wide`/`full` and other templates' `normal`/`wide`/`full` keep their current rendering.

Export `LAYOUT_WIDTHS` (array of `{ value, label, hint }`) and `normalizeWidth(v)` from `src/render/blocks.ts` (or a new tiny `src/render/layout.ts`), and expose the same list to the studio via `/meta` (grep `app.get('/meta'` in `src/server/api.ts`; add `layoutWidths`) so the inspector never hard-codes it.

### Engine

- `BlockNode` gains optional `layout?: { width?: string }`.
- `renderBlock`: compute `w = normalizeWidth(node.layout?.width ?? (def.fields has key 'width' with canonical options ? node.props.width : undefined))`. If `w` and the node is **top-level** (renderBlocks must pass `depth`), add class `bh-w-${w}` to the block's root element (extend `annotate()` — it already rewrites the root element's opening tag; if `annotate` only runs in editor mode, split it so class injection runs in every mode).
- Section keeps rendering `container w-${width}`; its field options become the five canonical values.
- photo-row keeps its own class mapping in Liquid but its JSON `width` options become the canonical five (labels as above; `entry` stays accepted via `normalizeWidth` in the Liquid: `{% assign w = props.width | default: 'normal' %}` and map `entry` like `normal`).

### Templates — every template must implement all five

Add to each template's base.css (grep where `.w-normal` lives):
```
.bh-w-narrow { … } .bh-w-normal { … } .bh-w-wide { … } .bh-w-page { … } .bh-w-full { … }
```
Semantics per template: narrow = max-width 52rem centred; normal = the template's container width; wide = container + ~6rem each side (cap at 96rem); page = `width: 100%; max-width: none` inside the page padding; full = negative page margins / `grid-column: full` so it touches the edges. For strongman map onto the named grid: narrow → `grid-column: entry; max-width: 52rem; justify-self: center`, normal → entry, wide → wide, page → `grid-column: full` + `is-contained` padding, full → `grid-column: full`. Also make strongman's section container honour `w-wide`/`w-page`/`w-full` (add rules next to `.wb-section > .container.w-narrow`).
Keep `[data-wb-region] >` duplicates where strongman's base.css needs them (read its comment at line ~192).

### Inspector (editor.js `renderBlockTab`)

Replace `containerForm`/`wrapForm` with one **Layout** section:
- For a **top-level** block: a select "Width" bound to `node.layout.width` (default shown as Normal), options from `meta.layoutWidths`, help "How wide this block runs across the page." If the block has its own canonical `width` prop (section, photo-row), bind to `props.width` instead and do not show two controls.
- For a **nested** block: one line "Width is set on the {Container label} around this block." with a button "Select the {Container}". No "Wrap in a Section" anywhere. Delete `wrapInSection`.
- Changing width is structural for the preview (`markDirty({ structural: true })`) so the iframe reloads.

### Docs

Update `docs/blocks-and-templates.md`: one short "Widths" section listing the five values and the `.bh-w-*` classes a template must implement.

## Acceptance

- `grep -c "bh-w-" templates/*/assets/*.css` ≥ 5 for all nine templates.
- On strongman `#/e/d-home`, select the first top-level block: the inspector shows Layout → Width with five options; choosing "Wide" reloads the preview and the block's root element carries `bh-w-wide` and visibly widens.
- On automatic, selecting a rich text inside a Section shows the one-line "Width is set on the Section…" with a select button; selecting the Section shows Width with five options and Edge to edge visibly bleeds.
- Existing docs render identically to before for stored `entry/page/wide/full/normal` (spot-check `/helmsdale` on strongman before and after with `curl` and diff the HTML minus the added class attribute).
- tests 48/48; typecheck count unchanged (61).
