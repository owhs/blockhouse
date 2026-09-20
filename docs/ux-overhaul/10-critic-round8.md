# Critic — round 8

Average: 92

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus an editor and every rail page at 1024×768, the dashboard at 1920×1080, and the shell at 800×800 and 390×800. Every rail page on both sites (strongman 8792 — 20 hashes; automatic 8793 — 18 hashes), each swept for controls with no computed accessible name (aria-label → aria-labelledby → `label[for]` → ancestor `<label>` → text → title → placeholder), for leftover `.spin`, and for horizontal overflow. Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jordan-racing-team-2`; automatic `#/e/d-home`, `#/e/d-about`, `#/e/p-tower-parking-system`. Because the in-app pane's viewport emulation fires neither `resize` nor media-query change events, every width change was followed by `dispatchEvent(new Event('resize'))` before reading `#view.inert` / `.nav-open`. The settings guard was driven with **real mouse clicks and real keystrokes** on both sites (site name → `Strongman LiftsQQ` on 8792, `…BB` on 8793; the sticky bar appeared each time, so the edits were genuine): Cancel, Discard, and A-then-B while the question was on screen. Contrast was measured per text node with a canvas-based oklch→sRGB conversion against the nearest opaque ancestor background, in both themes, on seven pages. Block picker (53 / 49 entries), ⌘K on both sites, `?` help on six screens, light and dark studio, the three device modes measured through the iframe's own `innerWidth`, Publish opened and cancelled on both sites, stale bookmarks `#/wat`, `#/e/nonexistent`, `#/c/nonexistent`, `#/p/ghost`.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 94 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 93 | — |
| 4 | Editor: layout, outline, inspector | 93 | — |
| 5 | Editor: block model & width | 92 | — |
| 6 | Dashboard & content lists | 94 | — |
| 7 | Site tools | 93 | — |
| 8 | Studio admin | 93 | — |
| 9 | Feedback, errors, resilience | 95 | — |
| 10 | Visual consistency & polish | 86 | Every link in the **light** studio is 2.6–3.0:1 and carries no underline |
| 11 | Preview fidelity & responsiveness | 94 | — |
| 12 | Accessibility & keyboard | 84 | Navigation rows cannot be reached, let alone selected, from the keyboard |

Blockers 0 · majors 2 · minors 5.

## Round-7 re-test

**Fixed — all 6.**

R7-1 — **fixed**, and it is the reason the round-7 blocker is gone. `main.js` now carries three belts: `narrow.addEventListener('change', …)` (line 340), a plain `addEventListener('resize', …)` that closes the drawer whenever `!narrow.matches && .nav-open` (line 343), and Escape (line 346). Driven on **both** sites from a fresh reload: at 800 px, ☰ gives `app nav-open` + `#view.inert === true`; widen to 1440 and dispatch `resize` and it is back to `class="app"`, `inert === false`, and `elementFromPoint` at (700,400), (200,400), (1300,600), (100,120) returns real rows and rail items, not `div.app`. No path I tried left the shell stranded.

R7-2 — fixed at the source rather than in the chip. `render/blocks.ts:107` `annotate()` now emits `data-wb-label`, and `bridge.js:81` reads `el.dataset.wbLabel || el.dataset.wbType`. Measured inside the iframe: strongman `hero-slider` → chip **"Hero slider"**, `tile-grid` → "Image tiles", `faq-grid` → "FAQ grid", `section-intro` → "Section intro"; automatic `stage` → "Opening banner". Chip, outline row and inspector heading now agree everywhere I clicked. The five canvas toolbar buttons also gained `aria-label` (`bridge.js:95`).

R7-3 — fixed. `#/menus` and `#/types` on **both** sites now return **zero** unnamed controls; every row button reads `Move “Systems” up`, `Remove “Systems”`, `Add an entry to “Guides”`, `Remove column “…”` (`menus.js:131–175`, `concepts.js`). The icon picker is `Use the Page icon` etc.

R7-4 — fixed. The name sits on the `<input>` with `role="switch"` and a kept-in-sync `aria-checked`, not on the wrapping label — People (`views.js:620`), Apps, Automations (`views.js:1178`), Settings features (`settings.js:429`), with comments explaining why.

R7-5 — fixed for the page-weight rows; the `font-size / text-align / color` attribute is gone. Residue elsewhere: R8-5.

R7-6 — fixed. `templates.js:67` sets `aria-label="Template code"` on `.ide-ta`.

**Round-7 "verified working" re-check:** held. Re-confirmed: zero leftover `.spin` and no horizontal scroll on any rail page at 390 / 800 / 1024 / 1440 / 1920; `.main-pad` is 1152 px and centred at 1920; device modes give real `innerWidth` 1280 / 834 / 390 with `role="radio"` + `aria-checked`, honest captions ("Tablet width — 834px, shown at 92%"), and where the canvas is too narrow for 1280 the preview steps to 1024 and *says so* ("Shown narrower to keep text readable · hide a panel for desktop width", `editor.js:288–323`); the editor outline is a real tree (`role="treeitem"`, `aria-level`, roving tabindex — ArrowDown/Up moved focus correctly through 16 rows); Escape closes only the top layer (picker over editor, publish over editor) and never leaves the editor; the `?` sheet is `role="dialog" aria-modal="true"`, focus lands on Close and Tab is trapped; Publish names document *and* address ("“About” will go live at /about"), focuses "Publish now", Cancel and Escape both close; ⌘K keeps exactly one active row and its empty state is plain ("Nothing matches zzzz — try a page title, a setting like “sitemap”…"); the settings guard focuses **Cancel**, keeps the typed edit on Cancel, lands on the *newest* target on Discard (`#/design` then `#/seo` → `#/seo` + "SEO" + SEO highlighted) and clears the bar; the site switcher rows read "…co.uk — You are here" / "…— Open its studio · now at localhost:8793"; Apps capabilities are plain sentences with raw permission keys folded into "Limit what it may do (advanced)"; Deploy's developer paragraph is folded under "Technical details (for developers)"; the 401 path exists and is plainly worded (`api.js:43,62`, `main.js:106,757`); the dark studio scored **zero** contrast failures on five pages.

## Findings

**R8-1 · 12/7 · major · both · `#/menus`** The Navigation tree's rows are `<div class="mrow" draggable="true">` with a click handler and **no `tabindex`, no `role`, no `aria-selected`** (`menus.js` `paintTree()`, row built around line 120). Tab through the page and you reach only the three icon buttons inside each row — never the row itself — so the one thing the page exists for, *selecting a link to change its label or where it points*, cannot be done without a mouse; the inspector on the right can never be filled from the keyboard. This is not a missing feature elsewhere in the studio: the editor outline does it correctly three files away (`role="treeitem"`, `aria-level`, `aria-selected`, roving `tabindex` 0/-1, ArrowUp/ArrowDown handlers — verified working on 16 rows). Give `.mrow` the same treatment; the row labels already exist, the sibling buttons quote them.

**R8-2 · 10/12 · major · both · light studio, everywhere** `studio.css:97` is `a { color: var(--acc-bright); text-decoration: none; }`. `--acc-bright` is the *dark-theme* accent — `oklch(66% 0.11 162)` — and it is applied unconditionally, so in the light studio every link is painted mid-green on white. Measured: **2.95:1** on white (`#/seo` — all ten page-title links, "view", "turn on in Settings"; `#/deploy` — the site address) and **2.60:1** on the dashboard's `.sub` band. WCAG AA wants 4.5:1. Because `text-decoration` is `none`, colour is the *only* thing marking these as links, which makes the low contrast a comprehension problem as well as a legibility one. Every other accent use in this file already does the right thing — `light-dark(var(--acc-strong), var(--acc-bright))`, used at lines 142, 174, 192, 199, 261, 275, 292, 308, 340, 419, 472, 513. Line 97 is the one that was missed. The dark studio is clean (0 failures on five pages).

**R8-3 · 4/12 · minor · both · any editor → "Restore points for this page"** The dialog lists seven rows and every Restore button's accessible name is the bare word **"Restore"** — the same ambiguity R7-3 removed from the Navigation and Content pages, left behind in this dialog. A voice user saying "click Restore" has seven identical targets. The version column reads `v7`, `v6`, `v5`… — a developer's numbering; the adjacent "3h ago" is the part a site owner will actually use. `aria-label="Restore the version from 3h ago"` fixes both. (Focus lands on Close and Escape closes cleanly — those are right.)

**R8-4 · 12 · minor · both · `#/media`, `#/plugins`, `#/seo`** Four fields have no name but a placeholder: "Search name, alt, tags…" (Assets), "Search apps…" (Apps), and the redirect row's "/old-path" and "/new-path or https://…" (SEO). A placeholder is a weak last-resort name and it disappears the moment something is typed, which is exactly when the redirect fields matter. These are the only four controls left in the whole studio, across both sites and 38 hashes, without a proper name — everything else now computes one.

**R8-5 · 10 · minor · both · `#/deploy`** R7-5's row style is gone but three static-layout inline style attributes remain in the same file: `deploy.js:50` (`display: flex; padding-top: var(--s0)`), `deploy.js:198` (`font-size; margin; white-space` on the check output `<pre>`), `deploy.js:298` (`height; border-radius` on the weight bar — only `width` and `background` are data). Same treatment as before: keep the conditional half, move the constant half into a class.

**R8-6 · 3 · minor · both · any editor** Every rail page has a `?` sheet with live counts; the **editor** — the screen the persona spends most of the day in, with an outline, an inspector, three device modes, restore points and a Publish button — has none. Its only help is the rail's "Help" link, which leaves the document. A sheet here ("Click a block on the page or in the outline to change it. The panel on the right edits whatever is selected. Save keeps a restore point; Republish puts it on the website.") is the single largest remaining gap in category 3.

**R8-7 · 1 · minor · strongman · ⌘K** Typing "helmsdale" returns `helmsdale.jpg`, `sm-helmsdale.png`, `sm-helmsdale-plan.svg`, `sm-helmsdale-iso.svg` *before* "The Helmsdale: Unobstructed Centre - Midrise Scissor" — four images above the lift page the persona was plainly looking for. Documents should outrank assets on an equal-quality match (`search.js`, the scoring that feeds `fuzzy()`).

## What each sub-90 category needs

**10 → 86:** R8-2. Change `studio.css:97` to `color: light-dark(var(--acc-strong), var(--acc-bright))` — the pattern the rest of the file already uses — and give links an underline or another non-colour cue. R8-5 after that.
**12 → 84:** R8-1 first (it is the only mouse-only primary action left in the studio; copy the editor outline's tree code), then R8-2's contrast, then R8-3 and R8-4. With those four done I could not find an unnamed, unreachable or ambiguously-named control anywhere on either site.
