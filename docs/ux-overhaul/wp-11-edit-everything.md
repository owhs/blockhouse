# WP-11 — Everything on the page can be edited from the page

Owner files: `src/assets/admin/bridge.js` (329, read whole), `src/assets/admin/editor.js` (only: `onBridgeMsg`, `onProvenance`, `goTo`, `renderBlockTab`, `renderPageTab`, `markDirty`/`dirtyFor`, `patchPreview` — grep each), `src/assets/admin/docops.js` (grep `find`, `labelOf`), `src/assets/admin/fields.js` (grep `renderFields` signature and how a field element can be located by key — you may add a `data-field-key` attribute on each `.field`), `src/render/engine.ts` (filters, ~line 50–75), `src/render/native-blocks.ts` (the `wbe()` helper, line 28), `src/render/page.ts` (preview CSS block added by WP-6, grep `data-bh-preview`), `src/assets/blockhouse/runtime.js` (grep `anim-hidden`, `reveal`, `IntersectionObserver`), every `templates/*/blocks/*.liquid`, and the page templates `templates/strongman/pages/*.liquid` + `templates/aurora/pages/*.liquid` (grep `fields.` / `doc.fields`).
Templates live at `../templates/`. Real docs to test against: strongman `/` (d-home: hero-slider, section, section-intro, tile-grid, faq-grid), `/helmsdale` (product: photo-row, richtext, diagram, spec/fields), `/about`.

## What the owner reported

"There has been some attempt at click / take you there, but it doesn't take you there. And there's a bunch of stuff I can't edit on a page." Measured on strongman `/` in the editor: 7 top-level blocks, only 2 carry any `data-wbe` inline-editable element; 162 visible text elements (headings, paragraphs, links) are neither inside an editable element nor selectable as a block. Template blocks (`templates/*/blocks/*.liquid`) never emit `data-wbe`; only native blocks do (via `wbe()` in native-blocks.ts). Product details rendered from `doc.fields` (specs tables, straplines) are not clickable at all — clicking gives "This comes from the template".

## Required outcome

### 1. Inline editing for every template block, on every template
- Register a Liquid filter `wbe` in `engine.ts`: `{{ 'heading' | wbe }}` → ` data-wbe="heading"` when the render context is annotating (`scope.__ctx.annotate`), else empty. Second arg selects mode: `{{ 'caption' | wbe: 'md' }}` → adds `data-wbe-mode="md"`. Dotted paths address list items: `{{ forloop.index0 | prepend: 'slides.' | append: '.heading' | wbe }}` (or add a small `wbe_at` filter taking `(list, index, key)` if that reads better — document it in `docs/blocks-and-templates.md`).
- Go through **every** `templates/*/blocks/*.liquid` and mark every human-readable text output (headings, paragraphs, captions, labels, button labels, list-item text, markdown bodies via `| md` → mode `md`) with the right `wbe`. Do not mark URLs, alt text, or numbers used for layout.
- `bridge.js` + `editor.js`: `prop` may be a dotted path. `onBridgeMsg` 'edit' sets by path into `found.node.props` (create intermediate arrays/objects); `dirtyFor`/`patchPreview` work with paths; `renderInspector` after `editend` shows the new value (list items included).

### 2. Content-type fields are editable from the page
- Register filter `wbf`: `{{ 'strapline' | wbf }}` → ` data-wbf="strapline"` (annotate mode only). Mark every `fields.*` / `doc.fields.*` text output in `templates/*/pages/*.liquid` and `partials/*.liquid` (strongman product/project/range/service pages especially: model name, strapline, spec rows, lift type).
- `bridge.js`: single click on `[data-wbf]` (and not inside a `[data-wb]`) posts `{ blockhouse: 'field', key }`; the editor switches to the Page tab, scrolls the matching field into view and flashes it (add `data-field-key` on `.field` in `fields.js` to find it). Double-click on a `[data-wbf]` whose field type is text/textarea edits inline and writes `doc.fields[key]` with the same save/undo path as block edits (`snapshotOnce('Edit fields')`, `markDirty()`).
- Hover styling for `[data-wbf]` matches `[data-wbe]` (cursor text, dashed outline) so the person can see what is editable.

### 3. Pictures
- Any `<img>` (or element with a background image set from a media prop) inside a block: single click selects the block **and** focuses the matching image field in the inspector (flash + scroll). Mark image outputs with `data-wbe-img="prop"` (native blocks: extend `wbe()`; template blocks: a `wbimg` filter or `wbe: 'img'` mode). Bridge posts `{ blockhouse: 'focusprop', id, prop }`; editor `focusProp(prop)` scrolls/flashes the field (dotted paths for gallery items open the list item first if the list UI is collapsible — check `fields.js` list rendering).

### 4. "Take me there" must always land somewhere real
- Test every `onProvenance` option on strongman and automatic: menu quick-edit sheet, Navigation page, header/footer quick sheet, full header/footer editor (`#/chrome/<slot>` — the slot must exist on that template; if it does not, do not offer it), header/footer template file (`#/tpl/partials/header.liquid` must resolve — check `templates.js` route parsing), Design, page link → editor, Settings → features. Fix any that do not land on the promised screen with the promised thing visible.
- When the click hits something that truly is template markup (no options), the dialog must say, in plain words, what it is and offer the two honest routes: "Edit the template code (for developers)" (admins only) and "Ask about this in Help". Never a dead end.
- Clicking inside a header/footer **slot block** (rendered from `site.slots`, see `chrome.js`/`page.ts` for how slot blocks render — give them `data-wb-slot="<slotKey>"`) opens the header/footer quick sheet already scrolled to that block.

### 5. Preview must look like the site
- The scroll-reveal animation leaves blocks faded/hidden in the editor because the iframe is scaled (`anim-hidden` on strongman; check other templates for reveal classes). In preview (`data-bh-preview`), disable reveal: CSS `[data-bh-preview] .anim-hidden, [data-bh-preview] [data-reveal] { opacity: 1 !important; transform: none !important; }` in the preview stylesheet in `page.ts`, and skip the observer in `runtime.js` when previewing. Do not change visitor behaviour.

### 6. Inspector for list props
- The hero slider's "Slides" list shows six identical rows "We help maximise space". Rows must show a meaningful label: the first non-empty text field of the item, falling back to "Slide 1". Expanding a row edits that slide; image fields inside items show a thumbnail. (This is in `fields.js` list rendering — small, targeted change.)

## Acceptance (I will test each in the browser)

- strongman `/` in the editor: double-click the hero heading, the tile-grid titles, the section-intro paragraph, an FAQ question → each edits inline and saves; the inspector shows the change.
- `/helmsdale`: click a spec value (lifting height) → Page tab opens with that field flashed; double-click the strapline → inline edit saves to `doc.fields`.
- Click any photo in a photo row → block selected and the image field for that photo flashed.
- Every option in the "This is controlled in more than one place" dialog lands on the promised screen.
- No faded blocks in the preview at any scale.
- `bun test` 48/48; typecheck error count unchanged (61). Server restart needed for engine/template changes — say so.
