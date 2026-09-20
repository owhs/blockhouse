# Critic — round 9

Average: 92

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus an editor at 1024×768 and 1280×800 and the dashboard at 1920×1080; every width change followed by `dispatchEvent(new Event('resize'))`. Every rail page on both sites (strongman 8792 — 22 hashes; automatic 8793 — 19 hashes) swept for controls with no computed accessible name (aria-label → aria-labelledby → `label[for]` → ancestor `<label>` → text → title → placeholder), leftover `.spin`, and horizontal overflow. Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jordan-racing-team-2`; automatic `#/e/d-home`, `#/e/d-about`, plus the Tower Parking entry via the Navigation tree. Contrast was measured per text node with a **hand-written oklch→sRGB conversion in JS** (round 8's canvas route silently fails: this engine's `canvas.fillStyle` does not parse `oklch()`, so every oklch colour was being compared as black — that method's numbers were wrong), alpha-composited against the nearest opaque ancestor, both themes, eight pages. Navigation tree driven with real ArrowDown/Enter keystrokes on both sites; settings guard driven with a real click and real typing (`Strongman Lifts` → `Strongman LiftsQQ`, sticky bar appeared, so the edit was genuine); block picker (53 entries); ⌘K "helmsdale"; `?` help on six screens; Settings search "sitemap"; Publish opened and cancelled; stale bookmarks `#/wat`, `#/nope`, `#/e/nonexistent`, `#/e/ghost`.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 93 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 95 | — |
| 4 | Editor: layout, outline, inspector | 87 | Toolbar text overlaps at 1024; the zoom badge is a dead button once both panels are hidden |
| 5 | Editor: block model & width | 93 | — |
| 6 | Dashboard & content lists | 94 | — |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 94 | — |
| 9 | Feedback, errors, resilience | 95 | — |
| 10 | Visual consistency & polish | 88 | The same 1024 overlap; dark-theme badge text at 3.85:1 |
| 11 | Preview fidelity & responsiveness | 88 | At 1024 two fixed panels cover the canvas, leaving a 168 px strip |
| 12 | Accessibility & keyboard | 90 | — |

Blockers 0 · majors 2 · minors 5.

## Round-8 re-test

**Fixed — 6 of 7. R8-3 fixed only halfway.**

R8-1 — **fixed.** `menus.js:97–137`: `.menu-tree` is `role="tree"`, rows are `div[role=treeitem]` with `aria-level`, `aria-selected` and a roving tabindex, and `rowKeys()` handles ArrowUp/Down/Home/End/Enter/Space. Driven with real keys on both sites: strongman `#/menus`, focus row 1 → ArrowDown ×3 → focus on "Car Parking"; Enter → `aria-selected="true"`, `.mrow.active` set, inspector switched from "Choose an item on the left" to the editable fields. Same on automatic (53 rows, Enter selected "Tower Parking System"). The page is fully operable from the keyboard.

R8-2 — **fixed.** `studio.css:100` is now `a { color: light-dark(var(--acc-strong), var(--acc-bright)); text-decoration: underline; text-underline-offset: .15em; }` — colour *and* an underline. Re-measured in the light studio on `#/`, `#/seo`, `#/deploy`, `#/menus`, `#/help`, `#/c/product`, `#/users`: **zero** failures. (The single hit my sweep reports on every page — `.top-brand .mark`, 1.01:1 — is a false positive: `studio.css:128` paints it on a `linear-gradient`, which a computed-style walk cannot see.)

R8-4 — **fixed.** Zero unnamed controls across **41 hashes on both sites**. The four named fields now read "Search assets", "Search apps", "Redirect from (old address)", "Redirect to (new address)" (`assets.js:206`, `views.js:889`, `seo.js:233–234`).

R8-5 — **fixed in `deploy.js`**: `grep 'style="'` returns nothing and the three `style: {}` objects that remain (lines 50, 77–78, 198) are purely data (`LEVEL[c.level].colour`, `--card-accent`, the error tint). Residue elsewhere: R9-5.

R8-6 — **fixed.** A "Help with the editor" button sits in the editor toolbar on both sites (`editor.js:1323`). It opens `role="dialog" aria-modal="true"`, focus lands inside on Close, Escape closes it and leaves the editor intact. Text: "Click a block on the page or in the outline to change it… Save keeps a restore point; Publish (or Republish) puts the page on the website." Exactly the gap R8 named.

R8-7 — **fixed.** `search.js:181,212` damps assets to `0.55×` and weights `doc: 34` over `asset: 12`. ⌘K "helmsdale" on strongman now returns **"The Helmsdale: Unobstructed Centre - Midrise Scissor" first**, the four images below it, and exactly one active row.

R8-3 — **half fixed.** `editor.js:1301` now emits `aria-label="Restore the version from ${fmtDate(v.savedAt)}"`, but on `#/e/d-helmsdale` six of the seven rows resolve to the *identical* string "Restore the version from 4h ago". Seven ambiguous targets became six. See R9-4.

**Round-8 "verified working" re-check:** held, with the two exceptions below. Re-confirmed on both sites: zero `.spin` and no horizontal scroll on any rail page; `.main-pad` is 1152 px, centred, at 1920; the editor outline is a real tree with roving tabindex; Escape closes only the top layer; the `?` sheet is modal with focus trapped; six `?` sheets carry live counts and plain language ("Browse all 12 of your lifts…", "Fix the 30 pages grouped under…"); Settings search "sitemap" lands on the field **and focuses it** (`activeElement` = the input named "Give search engines a page list"); the guard focuses **Cancel**, and Discard after `#/design` then `#/seo` lands on `#/seo` with the rail and title correct and the bar cleared; Publish reads "“Henry's Car Barn” will go live at /jordan-racing-team-2", focuses "Publish now", Cancel closes; the site switcher rows read "You are here" / "Open its studio · now at localhost:8793"; `#/nope` → "Nothing lives at #/nope", `#/e/ghost` → "That page no longer exists… the link is just out of date"; no developer jargon in the `#/settings`, `#/plugins`, `#/deploy` or `#/audit` text (20-term scan). **Not held:** the 1024-width claim (R9-1, R9-2) and the light-theme contrast *method* (see Method).

## Findings

**R9-1 · 4/10 · major · both · any editor at 1024×768** The zoom badge is painted **on top of the save indicator**. Measured on `#/e/d-home`, both sites, `innerWidth` 1024, both panels open: `.preview-zoom` occupies x 436–608 and `.save-state` ("Saved") x 462–529 — text over text, the word "Saved" unreadable (visible in a screenshot as `ted4%Save…`). Mechanism: `.editor-top-group.grow` (`studio.css:735`) is `flex: 1; min-width: 0` with **no `overflow`**, so between ~1001 px (where `@media (max-width: 1000px) { .preview-zoom { display: none } }`, `studio.css:1647`, would have hidden the badge) and ~1100 px the group shrinks below its contents and its children spill over the next flex group. Clean at 1280 (badge 692–864, state 462–529) and at 1440. The 620 px rule at `studio.css:931` already anticipates this shrink; the 1024 case was missed.

**R9-2 · 4/11 · major · both · any editor** Two faults in the same control, `editor.js:227–234` and `setZoomNote()` at `editor.js:320–326`. (a) **Dead button.** At 1440 on `#/e/d-home` I hid the Settings panel, then the Outline. Both `aria-pressed` went `false`, `outline w=0`, `inspector w=0` — and the badge still reads **"94% · hide a panel for full size"**, `title="Hide a side panel so the page is shown at full size"`. It is a `<button>`; I clicked it and the text, the scale and the layout were byte-identical afterwards. An instruction that cannot be followed, on a control that does nothing. When no panel is open the badge should say what is actually true ("94% — the page is wider than the window") or hide itself. (b) **At 1024 the panels eat the canvas.** `.outline` and `.inspector` become `position: fixed` overlays sitting *over* the preview (measured: outline x 312–552, inspector x 720–1024, canvas 232–1024), leaving a **168 px** strip of a page rendered at 1280 and scaled to 62%. The badge's advice — hide a panel — is the only way out, and nothing on screen says the panels are covering the page rather than sitting beside it.

**R9-3 · 10 · minor · both · dark studio** `studio.css:1385–1391` gives `.badge, .chip, .mrow-tag, .multi-tag, .count` `color: var(--mut)` on `background: var(--bg-hover)`. In the **dark** studio that is **3.85:1** (rail count "1") and **3.91:1** ("12" on `#/c/product`) at 12 px bold — below AA's 4.5:1. The light studio is clean at the same rule, so only the dark token pair needs lifting. This is the only contrast failure left on either theme across the eight pages measured.

**R9-4 · 12/4 · minor · both · any editor → "Restore points for this page"** Six of the seven Restore buttons compute the same name, "Restore the version from 4h ago" (`editor.js:1301`). A voice user now has six identical targets instead of seven. The visible column still reads `v7 v6 v5 v4 v3 v2 v1` and the confirm dialog says "Restore v7 from 4h ago" — developer numbering the site owner has no use for. Use the clock time the header already knows (`aria-label="Restore the version saved at 14:12"`), and drop `v7` from the owner-facing strings.

**R9-5 · 10 · minor · both · `#/media`, `#/users` → Automations, `#/plugins`** R8-5's pattern survives outside `deploy.js`: `assets.js:21` is a pure static-layout inline style (`display; gap; alignItems; marginBottom; flexWrap`) with no data in it at all, and `views.js:1302` and `views.js:1551` mix constants (`fontSize`, `margin`, `fontWeight`) into the conditional `color: r.ok ? …`. Same fix as before: keep the conditional half, move the constant half into a class.

**R9-6 · 12 · minor · both · `#/menus`** The new tree is `.menu-tree[role=tree] > div.mlevel > div[role=treeitem]` (`menus.js:97,151`). `.mlevel` carries **no role**, so every nested level's `treeitem`s are orphaned from their owning tree in the accessibility tree — a screen reader gets "1 of 1" instead of the real position. One attribute: `role="group"` on `.mlevel` (or `aria-owns` on the parent row). Keyboard behaviour itself is correct.

**R9-7 · 1/6 · minor · both · rail** The count beside each content type (`#/c/product` shows **1**, while the list holds **12**) is a needs-publishing count, not a total — and the only thing that says so is a `title` tooltip, "1 with changes not yet published". The persona reads a list of 12 lifts under a rail entry badged "1". Either put the meaning on screen (a legend in the rail's Content heading, or the ✎ pencil glyph the dashboard uses for unpublished work) or drop the badge.

## What each sub-95 category needs

**4 → 87:** R9-1 and R9-2a are the two cap triggers (an overlap, and an action with no feedback). Fix `.editor-top-group.grow`'s overflow and make `setZoomNote()` branch on whether a panel is actually open; then R9-4. That is 95.
**10 → 88:** R9-1 again (it is a layout overlap), then R9-3's dark-theme badge pair, then R9-5.
**11 → 88:** R9-2b. Either dock the panels at 1024 the way they dock at 1280, or say on screen that they are floating over the page and can be closed — right now 168 px of a 1280 px page is not a preview.
**12 → 90:** R9-6 and R9-4 — both one-line fixes. With those done I could not find an unnamed, unreachable, ambiguously-named or mis-structured control anywhere on either site.
**1 → 93 / 5 → 93 / 6 → 94 / 8 → 94:** 1 and 6 both need R9-7. 5 needs the Layout section on nested blocks — a level-2 block ("Section intro" inside a Section, `#/e/d-home`) has **no** Layout group and no width control at all, so the persona who wants that one intro narrower has to select its parent and guess. 8 has no defect I could find this round; 95 needs a pass I could not make without changing data (inviting a person, switching an app on).
