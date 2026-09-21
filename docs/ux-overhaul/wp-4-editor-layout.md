# WP-4 — Editor layout & interaction

Owner files: `src/assets/admin/editor.js`, `src/assets/admin/docops.js`, `src/assets/admin/ui.js` (only the `dialog()` function, lines ~170–250), `src/assets/admin/studio.css` (editor rules: grep `.editor`, `.outline`, `.inspector`, `.insp-`, `.tree`, `.preview-`, `.doc-title`, `--insp-w`, `--outline-w`).
Read in `editor.js`: lines 182–240 (preview + scale), 473–600 (outline rail + tree), 597–722 (inspector + block tab), 1020–1163 (topbar + actions), 1163–1310 (layout), 1419–1465 (keyboard). Skip the rest.
Also read `ui.js` `fitPreviewFrame` (grep it) and `dialog`.

## Problems (observed at 1440×900 on strongman)

1. Preview is scaled to 81% with the outline closed and 65% with it open. Body text is illegible. The badge says "81% · widen".
2. Outline column (`--outline-w: 14rem`) clips row labels from the **left** ("dale Mid Rise Sciss") with a horizontal scrollbar: the `.tree` is wider than the column.
3. Opening a document selects nothing; inspector shows "Nothing selected".
4. Clicking a tree row label sometimes fails to select. `.tree-item` is a `<button>` containing another `<button>` (actions) — invalid nesting.
5. "Add a block" picker does not close on Escape. Pressing ⌘K while it is open opens the palette on top, both visible.
6. Toolbar has 14 controls: back, outline, title, status, save-state, 3 devices, wand, help, inspector-toggle, Wide, inspector-drawer, Save, Publish, more. Title truncates to "The Helmsdale:" as soon as the outline opens.
7. Three ways to hide panels (outline toggle, inspector toggle, Wide) plus "Swap inspector side" plus a resize handle.
8. The site rail is force-collapsed on editor open (`appEl.classList.add('side-collapsed')`).
9. Page tab: concept fields render in a two-column grid where the label cell holds a full sentence of help beside a narrow input.
10. Restore points are buried at the bottom of the Page tab.
11. Command palette shows two highlighted rows.

## Required outcome

### Layout
- Grid: `outline (15rem) | preview (minmax(0,1fr)) | inspector (var(--insp-w, 22rem))`. Rail stays whatever the user had (remove the forced collapse and the `railWasOpen` restore).
- **Preview never scales below 100% while the available width ≥ 1000px.** Below that, `fitPreviewFrame` may scale, and the badge reads "Shown at 82% to fit. Hide the outline or inspector for full size." (plain sentence, not "widen"). At ≥1000px the iframe is 100% wide and the *site* handles its own responsiveness (that is what visitors see at that width anyway). Device buttons: Desktop = fill; Tablet = 834px centred; Phone = 390px centred, both with a subtle device frame.
- Outline: rows must never overflow horizontally. `.tree` gets `min-width: 0; width: 100%`, rows `overflow: hidden`, label `text-overflow: ellipsis` on the **right**, depth indent capped at 5 levels. Remove the horizontal scrollbar.
- Outline default: open at ≥1200px, closed below; remember the user's choice.

### Selection
- On open: select the first top-level block (so the inspector has content). If the page is empty, the **canvas** (not the inspector) shows a centred starter card: "This page is empty" + starter layout buttons + "Add a block". The inspector then shows the Page tab.
- Tree rows: `div[role=treeitem]` with a single click handler; the actions button is a sibling positioned absolutely at the row end, `tabindex=-1`, revealed on hover/focus-within. Keyboard behaviour unchanged.

### Toolbar (left → right)
`←` back · title input (flex, min 12rem, ellipsis) · status chip · save-state · | · device segment (3) · panel toggles: two icon buttons with labels on hover **"Outline"** and **"Inspector"** (`aria-pressed`) · | · Save · Publish · `⋯`.
- Remove: wand button, help button, "Wide" button, the separate inspector-drawer toggle. Move into `⋯`: Quick edits submenu items (colour, menu links, announcement bar, footer), Help with the editor, Hide/Show header & footer, Open preview in new tab, Swap inspector side, Unpublish, Make homepage, Delete.
- Keep ⌘. as "toggle both panels" (calls the two toggles; `toggleWide` in state.js untouched).
- Save-state gets a small clock icon after "Saved"; clicking opens a popover listing the last 10 restore points with Restore buttons (reuse `versionsPanel()`), and a line "A restore point is kept every time you press Save (⌘S) or publish."

### Inspector
- Page tab concept fields: render with `renderFields` in single-column mode (label above input, help below input). Check `fields.js` for a `width` option; if the concept field defs carry `width:'half'`, keep halves but the help text goes **below** the input, never beside it. If `fields.js` needs a tweak for help placement, make it there (report as out-of-scope edit).
- Order in Page tab: Publishing (slug, publish at) → Restore points (moved up, open by default if ≥1 exists) → {Type} details → Appearance (template) → Addresses & redirects → Who can see this page → Custom code (closed).
- Block tab for a field-less block: instead of "This block's text is edited straight on the page", show its text in a `richtext`/`textarea` editor bound to the block's primary text prop (find it in `docops.js` `labelOf` — the prop used for the label is the primary text). If the block truly has no text props, say "This block has no settings. Its content comes from the template."

### Dialogs
- `ui.js` `dialog()`: Escape must close a dismissable dialog even when focus is inside an input (the picker's `pal-input` keydown handler must not swallow Escape). Opening the command palette while a dialog is open first closes the top-most open `dialog.dlg`. Only one `.active` row in the palette at any time (this lives in `search.js` — grep `.active` there; fix is allowed as an out-of-scope edit, keep it minimal).

## Acceptance

- At 1440×900 with outline and inspector open, the preview iframe `getBoundingClientRect().width` equals its holder width and `transform` is none (100%).
- Outline shows full labels, no horizontal scrollbar, ellipsis on the right.
- Opening `#/e/d-home` on strongman shows the first block selected in the outline and its fields in the inspector.
- Escape closes the block picker; ⌘K with the picker open closes it and opens the palette alone.
- Toolbar control count ≤ 12 including title; title shows at least 20 characters at 1440px with both panels open.
- tests 48/48; typecheck error count unchanged.
