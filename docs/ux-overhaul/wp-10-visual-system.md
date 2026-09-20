# WP-10 — Visual system pass

Owner files: `src/assets/admin/studio.css` (whole — you are the only agent in it this round) and **inline `style:` objects in every `src/assets/admin/*.js` file** (grep `style: {`). You may edit any admin JS file, but only to replace an inline style with a class or to fix a spacing/colour token. No behaviour changes.

Read `studio.css` fully once (~1200 lines after earlier rounds). Then `grep -n "style: {" src/assets/admin/*.js | wc -l` and work through them.

## Problems

- Hundreds of inline `style: { … }` objects define margins, grids, font sizes and colours ad hoc.
- Five different "card with a heading and actions" constructions; six badge styles (`.chip`, `.mrow-tag`, `.pill-perm`, `.multi-tag`, `.count`, `.sec-count`).
- Section headings inside panels: `insp-section-title`, `fg-title`, `picker-group-title`, `panel-title`, `<strong>` in `page-head`.
- Dead rules left by WP-1 (`.sec-count`, `.nav-tools`) and any others orphaned by rounds A–D.
- The rail at 900px tall overflows past "Help" and the Collapse control.

## Required outcome

1. **Components** (define once, use everywhere):
   - `.card` + `.card-head` (title, sub, actions slot) + `.card-body`; replace every ad-hoc `div.page-head` inside a card with `.card-head`.
   - `.badge` with modifiers `.badge-ok | .badge-warn | .badge-err | .badge-muted | .badge-accent`; migrate `.chip.*`, `.mrow-tag`, `.pill-perm` (keep a `.badge-code` monospace modifier for codes), `.multi-tag`. Keep the old class names as aliases in CSS for one round (`.chip, .badge { … }`) so nothing breaks, but the JS should use `.badge`.
   - `.section-title` (small caps label used above groups) replacing `insp-section-title`, `fg-title`, `picker-group-title` — alias the old names.
   - `.stack-1 … .stack-4` (vertical gap utilities), `.row` (flex, gap s2, align center), `.grow`, `.mt-1…4`, `.mb-1…4`, `.text-s`, `.text-xs`, `.muted` — a small utility set so JS never needs inline margins.
2. **Inline styles**: reduce `grep -c "style: {" src/assets/admin/*.js` total to under 40 (the remainder must be genuinely dynamic values such as computed widths, background images, colours from data). Every replacement uses the components/utilities above.
3. **Rail density**: at 900px tall with three open sections the whole rail including Collapse must fit without scrolling on strongman (18 items). Reduce item height/padding via tokens, not per-item hacks; keep the Compact density preference working.
4. **Dead CSS**: remove rules no JS references (grep each class name across `src/assets/admin/*.js`; be careful with classes set via string templates — grep the bare word too).
5. **Both studio themes**: check every new/changed rule under `[data-theme="light"]` and dark; contrast of muted text ≥ 4.5:1 on its background in both.
6. Do not change layout dimensions decided by other packages (editor grid, panel widths).

## Acceptance

- `grep -c "style: {" src/assets/admin/*.js` summed < 40.
- Only one badge component and one card pattern in CSS (aliases allowed, documented at the top of the block).
- Rail fits at 1440×900 with all sections open.
- Visual diff of every page (orchestrator will screenshot) shows no regression.
- tests 48/48; typecheck count unchanged.
