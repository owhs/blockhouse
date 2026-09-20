# Critic — round 1

Average: 80

Method: signed in to both studios as `critic@local.test`, 1440×900 (plus 1280, 1024, 800). Every rail page on both sites; strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/p-…`; automatic `#/e/d-home`, `#/e/p-tower-parking-system`, `#/e/d-about`. Block picker, ⌘K, Settings search, ? sheet on six screens, inline double-click editing on a template heading and on a product spec value, menu-item editing, Publish (cancelled). Scored on what is running, not on round 0.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 88 | Rail collapses to icon-only in the editor (purpose needs hovering); icon-initial fallbacks leak into labels |
| 2 | Settings organisation | 86 | Developer strings still on Security and in the Page tab; search misses common words |
| 3 | Help & guidance | 91 | — |
| 4 | Editor: layout, outline, inspector | 72 | Outline click does not open the Block tab; preview at 63%; persistent toast over the preview |
| 5 | Editor: block model & width | 68 | Four of five widths render identically; picker descriptions are developer jargon; raw keys in Section options |
| 6 | Dashboard & content lists | 88 | Rail number badge still ambiguous (count vs needs-attention) |
| 7 | Site tools | 74 | Navigation preview escapes the draft on any link click; SEO reads as "everything is broken" |
| 8 | Studio admin | 70 | App descriptions and capability lines are developer text; Activity contradicts itself on arrival |
| 9 | Feedback, errors, resilience | 86 | Activity's empty state; 401 path untested |
| 10 | Visual consistency & polish | 84 | Raw-key selects; toast overlapping preview content |
| 11 | Preview fidelity & responsiveness | 72 | 63% desktop preview; scaling behaviour differs between documents; consent banner reachable in preview |
| 12 | Accessibility & keyboard | 80 | Glyph-only rich-text toolbar with `title` only; focus drops to `<body>` on outline click |

Verified working (tried to break, could not): Escape closes the picker and only the top layer; ⌘K over an open picker replaces it instead of stacking; one active row in the palette; tree `role=treeitem` with roving tabindex and working ArrowDown; unsaved-settings guard fires and restores the hash on Cancel; web-address validation blocks Save with an inline message and a toast; unknown route and unknown app panel both explain themselves; no horizontal scroll at 1280/1024/800; light and dark studio both clean; double-click editing works on a heading and on a spec value (flashes the field, switches to the Page tab).

## Findings

**1 · major · both · editor `#/e/d-home` → outline** Clicked "Heavy-Duty Recommendation" in the outline. The row selects (`aria-selected` moves, preview highlights) but the inspector stays on whichever tab was last open — I was on **Page**, so after clicking a block I was still looking at Slug and Publish-at. The block's fields are there, one click further, under **Block**. Selecting a block must activate the Block tab. `editor.js` — the outline `select()` path (the preview double-click path does switch tabs correctly).

**2 · major · both · editor at 1440×900** Default layout puts the preview at **63%** ("Shown at 63% to fit. Hide the outline or inspector for full size."). Body copy is unreadable. At 1024 the same page shows at 76% — the bigger the window, the smaller the type. On other documents (strongman `d-home` after a panel toggle, automatic `d-home`) the frame renders unscaled at 810–872 CSS px instead, i.e. the site's tablet layout. Two different fidelity behaviours, neither showing a desktop page. `editor.js` preview sizing / `.preview-wrap`.

**3 · major · both · editor → Block → Layout → Width** Cycled all five widths on strongman (`d-helmsdale` rich text, `d-home` hero) and automatic (`d-home` stage). Measured widths: strongman narrow/wide/page/full all 777 px, only normal differs (710); automatic narrow/normal/wide/page all 824 px, only full differs (862). The vocabulary is now one (`src/render/layout.ts`, good) but inside the editor's narrow preview four of the five choices do nothing visible, so the owner cannot tell what they picked. Either widen the preview or show the chosen width as a labelled ruler/outline in the canvas.

**4 · major · both · Add a block** Descriptions are written for developers: "Wrapper with width, background and anchor controls", "Responsive grid — each child block becomes a cell", "WYSIWYG text, stored as markdown", "Inline vector art — theme-aware via currentColor", "Accessible accordion + automatic FAQ structured data", "YouTube/Vimeo with a privacy-friendly click-to-load facade". Roughly half the blocks (Hero, Divider, Spacer, Heading, Quote, Image, Gallery, Button…) have no description at all. Block manifests + picker in `editor.js`.

**5 · major · automatic · `#/e/p-tower-parking-system` → Section** Background offers `none / subtle / accent / contrast` and Vertical padding `normal / compact / spacious / none` — raw stored keys as visible option text, directly above Width which is properly labelled ("Page width", "Edge to edge"). Also "Anchor id — Link to this section with #anchor". Section block schema / field renderer.

**6 · major · strongman · `#/menus`** Clicked "About" in the live preview. The iframe navigated from `/?__menudraft=main&__open=m-about` to `/about/` — the draft preview is gone, the cookie-consent banner appears over the page, and there is no way back except reloading the view. The panel still says "Live preview — draft only". Links in preview iframes must be intercepted (open the matching item, or do nothing). `menus.js` preview frame; same guard the editor preview already has.

**7 · major · both · `#/plugins`** App one-liners and the "What it can do" lists are developer text: "Form builder with spam protection, storage, email/webhook actions", "Event-driven recipes: webhooks, emails, content ops, inbound triggers", "live index + static search-index.json for flat builds", and inside: "Register public site routes under /x/<plugin>", "Register authenticated admin API routes", "Register short root-level routes (e.g. /f/:token)", "Emit custom events". `src/core/permissions.ts` (capability labels) + each plugin manifest's description.

**8 · major · both · `#/audit`** On arrival the page says "The **1** most recent things that happened." and immediately below "Nothing matches those filters". The only record is from 19 Aug and the default range is Last 30 days. Choosing "All time" shows it. The heading counts unfiltered records, the table counts filtered ones; the grammar is wrong for 1; and a first-time visitor concludes the log is broken. Widen the default (or count what is shown).

**9 · major · both · `#/seo`** "**0 pages have no problems · 39 need attention**" — every page on both sites is flagged, most with 3–5 rows, and each row is prefixed with the raw severity key "suggestion:". The site-wide page calls it your *focus word*, the editor's SEO tab calls it *Focus keyword*. An owner reads this as "my whole site is broken". Rank and cap the list, drop the key prefix, use one name.

**10 · minor · both · editor → rich text** Toolbar is glyph-only — `‹›`, `¶`, `❝`, `⌫`, `✦`, `MD` — with `title` and no `aria-label`. "Clear formatting", "AI: improve selection" and "Toggle markdown source" cannot be guessed without hovering, and screen readers get the glyph. `richtext.js`.

**11 · minor · both · editor outline** A mouse click on a tree row moves selection but leaves `document.activeElement` on `<body>`, so arrow-key navigation is dead until the user Tabs back into the tree. Focus the clicked `treeitem`.

**12 · minor · both · Publish dialog** Opening it focuses the **Close (×)** button rather than the dialog or its primary action. Same dialog helper used everywhere.

**13 · minor · both · rail and outline** Where a concept or block has no icon, the fallback initials are rendered as text nodes and read out with the label: rail shows "laLifts", "grLift ranges"; the palette shows "Main menu menu"; outline rows show "Section Section". Mark the fallback `aria-hidden` and stop appending the type when it equals the label.

**14 · minor · both · Width select** There is no "use the template's default". Once a width is chosen the block can never go back to unstyled — my test block on `d-helmsdale` had no width class and could only be returned to "Normal".

**15 · minor · both · Settings search** "logo" returns only "Watermark to stamp on pictures" (not the site logo or share picture); "cookie" and "robots" return "No setting matches that" although both exist as behaviour on other screens. Hand-maintained `catalog.js` will keep drifting.

**16 · minor · strongman · editor → Page tab** "Page template — *Add pages/<name>.liquid under Templates and it appears here*" is a developer instruction in the owner's field list. Concept schema help string.

**17 · minor · both · People → Extra access** Each row prints the permission code beside the plain label: "Publish content content.publish", "Use every plugin plugin:\*", "Sync to git & manage backups plugin:ops.manage". Hide codes behind a developer disclosure.

**18 · minor · both · editor** The "Shown at 63% to fit…" strip is pinned over the bottom-right of the preview permanently, covering page content on every document. Make it dismissible, or move it beside the device buttons.

**19 · minor · both · rail** Rail entries are `<button>`s with no `href`, so an owner cannot middle-click or ⌘-click a section into a new tab, and nothing is copyable as a link. `nav.js`.

## Not tested
- **Sign-out / 401 in place** — skipped as instructed (logout is a POST; the session cookie is HttpOnly).
- **Settings-search landing on the field** — `settings.js paintMain()` schedules the scroll/flash inside `requestAnimationFrame`, which never fires in this headless pane, so I could not observe it. Worth a manual check; note that an rAF-scheduled effect also no-ops when the studio tab is backgrounded at that moment.
