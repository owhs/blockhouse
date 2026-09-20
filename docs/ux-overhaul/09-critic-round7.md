# Critic — round 7

Average: 88

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus every rail page and an editor at 1024×768, the dashboard at 1920×1080, and the shell at 390×800 and 800×800. Every rail page on both sites (strongman 8792 — 20 hashes; automatic 8793 — 18 hashes). Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jordan-racing-team-2`; automatic `#/e/d-home`, `#/e/d-about`, `#/e/p-tower-parking-system`. The settings guard was driven with **real mouse clicks and real keystrokes** (site name went from `Strongman Lifts` to `Strongman LiftsQQ`/`AA`/`BB`/`CC`, the sticky bar appeared each time, so every edit was genuine) on both sites: Cancel, Discard, same rail item twice, and A-then-B while the question was on screen. Block picker (53 entries), ⌘K "seo"/"menu" on both sites, `?` help on nine screens, light and dark studio, device segment measured through the iframe's own `innerWidth`, Publish opened and cancelled on both sites, Settings Save round-tripped (changed and changed back), stale bookmarks `#/e/nonexistent`, `#/c/nonexistent`, `#/wat`, `#/p/ghost`. Every focusable control on every page was enumerated and its accessible name computed.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 95 | — |
| 2 | Settings organisation | 95 | — |
| 3 | Help & guidance | 96 | — |
| 4 | Editor: layout, outline, inspector | 94 | — |
| 5 | Editor: block model & width | 86 | The canvas names the selected block with its raw key (`hero-slider`, `spec-table`) |
| 6 | Dashboard & content lists | 94 | — |
| 7 | Site tools | 93 | — |
| 8 | Studio admin | 92 | — |
| 9 | Feedback, errors, resilience | 55 | Widening the window after using the ☰ menu leaves the whole studio inert |
| 10 | Visual consistency & polish | 88 | One static inline style still repeated per Deploy row |
| 11 | Preview fidelity & responsiveness | 84 | The same viewport-change bug — the shell never recovers from a resize |
| 12 | Accessibility & keyboard | 78 | 100–153 icon buttons named only by an identical `title`; switches named on the wrong element |

Blockers 1 · majors 2 · minors 3.

## Round-6 re-test

**Fixed — all 7.**

R6-1 — **fixed**, and it is now correct in every branch I could invent. `main.js` `onHashChange()` was rewritten around `pendingTarget` + `guardPending`, and `route()` now sets `nav.current` itself. Measured with real clicks on both sites: Discard → `location.hash`, the rail highlight and the painted `<h1>` all agree (Settings→Deploy gave `#/deploy` + "Deploy"; Settings→People gave `#/users` + "People"). Cancel keeps you on Settings with the typed edit intact and the sticky bar up. The dialog is a real `showModal()`, so clicking a *second* rail item while it is up is impossible (the backdrop takes the click) — driven through `location.hash` instead (what Back does), a second target while the question is on screen replaces the first, exactly one dialog exists, and Discard lands on the newer target (`#/design` then `#/seo` → `#/seo` + "SEO"). No dead rail item anywhere.
R6-2 — fixed. All 17 switches on `#/plugins` carry `aria-label="Switch Forms on"` etc.; People's status switch reads `aria-label="Sign-in allowed for Critic"` **and** now shows a visible word in the cell ("Can sign in" / "Blocked"), so nothing needs hovering. (Placement nit: R7-4.)
R6-3 — fixed. The three Design sliders are `aria-label`ed "Main colour" / "How strong the colour is" / "Corner roundness"; the People role `<select>` is "Role for Critic"; the icon picker on `#/types` now reads "Page", "Pen", "Tag", "Picture", "Shopping basket", "Question mark", "Quote marks"… instead of raw glyph keys.
R6-4 — fixed for the cards: `deploy.js:40` is `button.card.card-action` with no `style` attribute. (One inline style remains — R7-5.)
R6-5 — fixed. `search.js` `fuzzy()` requires a word-prefix for queries ≤ 3 chars and caps the subsequence span. "seo" → 4 exact rows, "menu" → 2 rows on strongman ("Main menu", "Navigation") and 3 on automatic (with "Footer menu"); one active row each; no "Message" or "Residential developments".
R6-6 — fixed. `ui.js:278` picks the first non-`danger` action for guard dialogs; focus measured on **Cancel** on both sites.
R6-7 — fixed. Rows now read "Strongman Lifts · strongmanlifts.co.uk — You are here" and "Strongman Lifts · www.strongmanlifts.co.uk — Open its studio · now at localhost:8793". No registry key.

**Round-6 "verified working" re-check:** held, with one exception found by a new route (R7-1). Confirmed again: every rail page on both sites paints with zero `.spin` left behind and no horizontal scroll at 390 / 800 / 1024 / 1440 / 1920; `.main-pad` is 1152 px and centred at 1920; the three device modes give 1280 / 834 / 390 real `innerWidth` inside the iframe with matching plain-English zoom captions ("Phone width — 390px, shown full size") and the site's own mobile burger appears at 390; 53 picker entries each with an icon and a one-line description, search auto-focused; Escape closes the top-most layer only (picker over editor, publish over editor) and never leaves the editor; Publish names the document *and its address* ("“About” will go live at /about"), focuses "Publish now", Cancel and Escape both close cleanly; all four unknown-route views explain themselves in plain words; help sheets on nine screens with live, correct counts ("all 8 of your pages", "Fix the 30 pages grouped under…"); Apps capabilities in plain English with raw permission keys inside a closed "Limit what it may do (advanced)" disclosure and the restart note carrying real guidance ("ask whoever hosts your site"); Settings search for "robots" lands focus on the named checkbox on `#/settings/advanced` with the row flashed; the collapsed rail is 80 px with every item still captioned; light studio is clean on dashboard, settings and editor with no element painting text on its own colour; Save shows a "Saved" toast and clears the sticky bar; the editor keeps an auto-saved draft, so leaving with an unsaved inspector edit loses nothing (verified by reopening the document).

## Findings

**R7-1 · 9/11/12 · blocker · both · any page, narrow then widen** Set the window under 861 px, press ☰ (`aria-label="Menu"`), then widen the window back over 860 px. `main.js` `setNavOpen(true)` (~line 296) sets `inert` on `.top-brand`, `.top-mid`, `.top-end`, `viewEl` and `ribbon`, and shows `.nav-scrim`. Nothing watches the viewport, so on widening the CSS hides the scrim (`studio.css:700`, `@media (min-width:861px)`) and the drawer re-docks into a normal-looking sidebar — but `.app` keeps `nav-open` and **`#view` stays `inert`**. Measured at 1440×900 after the resize: `document.querySelector('#view').inert === true`, and `elementFromPoint` at (700,400), (200,400), (1300,600) and (100,120) all return `div.app` — every click in the studio is swallowed. A screenshot at that moment shows a perfectly normal studio: rail, topbar, editor, no scrim, no cue. The ☰ that would close it is hidden above 860 px, so there is no way out but a reload, and Tab is dead too. Reproduced deterministically from a fresh reload. Fix: listen to `matchMedia('(max-width: 860px)')` and call `setNavOpen(false)` (or at least clear `inert`) when the query stops matching.

**R7-2 · 5 · major · both · any editor, any selected block** The chip drawn on the canvas beside the selection is the raw block type key: `bridge.js:77`, `tip.textContent = el.dataset.wbType || 'block'`. Selecting the strongman home hero paints **`hero-slider`** while the outline entry and the inspector breadcrumb both say "Hero slider"; on automatic the values in play are `section`, `section-intro`, `tile-grid`, `faq-grid`, `richtext`, `spec-table`. So the studio teaches the persona two names for the same thing and the one printed on the page they are editing is the developer's. Use the same label table the picker and outline use. While in that function: the five canvas toolbar buttons built at `bridge.js:90` carry `title` only, no `aria-label`.

**R7-3 · 12 · major · both · `#/menus`, `#/types`** Icon-only buttons with no `aria-label` at all — 94 of them on strongman `#/menus`, **147** on automatic `#/menus`, 6 on `#/types`. Their only name is a `title`, and every one of those titles is identical: "Move up", "Move down", "Remove", "Remove tab", "Remove column" (`menus.js:131`, `133`, `152`, `175`), "Move up", "Move down", "Remove field" (`concepts.js:173`, `175`). A screen-reader or voice user tabbing the Navigation tree hears "Remove, button" 40-odd times with nothing saying which link. Every other list in the studio was fixed to name its row (`views.js` now does `Sign-in allowed for ${u.name}`); these need the same — `aria-label: \`Remove “${item.label}”\`` — and the undo toast text is already written that way, so the string exists.

**R7-4 · 12 · minor · both · `#/plugins`, `#/users`, `#/settings`, Automations** The fix for R6-2/R6-3 put the name on the wrapping `<label class="switch">` rather than on the `<input type="checkbox">` inside it (`views.js:613`, `views.js:868`, `views.js:1172`, `settings.js:429`). Naming a control through its label's `aria-label` is the one path assistive technology implements inconsistently — the input itself has no name, and the label's own text content is empty. Moving the attribute onto the `<input>` (and adding `role="switch"`) is a one-line change per site that removes the doubt.

**R7-5 · 10 · minor · both · `#/deploy`** The card inline styles are gone, but `deploy.js:299` still writes a **static** style attribute on every page-weight row — `style="font-size: var(--t-xs); text-align: right; color: var(--warn-ink)"` — 41 copies on automatic. Only the colour is conditional; the size and alignment belong in a class next to `.deploy-check`.

**R7-6 · 8 · minor · both · `#/tpl`** The template code editor's `<textarea class="ide-ta">` is the only control on the page with no accessible name — the sole unnamed control left in the studio outside R7-3. One `aria-label="Template code"` closes it.

## What each sub-90 category needs

**5 → 86:** R7-2. One label table for block names, used by the picker, the outline, the inspector and `bridge.js`'s canvas chip.
**9 → 55:** R7-1 alone. A `matchMedia` change listener that closes the drawer and clears `inert` when the window crosses 860 px.
**10 → 88:** R7-5 — move the static half of that one style attribute into CSS.
**11 → 84:** R7-1 again. Every *static* width behaves; it is the *transition* between widths that strands the shell.
**12 → 78:** R7-3 first (it is 100–153 controls), then R7-4 and R7-6. With those three done the studio has no unnamed and no ambiguously-named control left, and R7-1's keyboard trap is gone with it.
