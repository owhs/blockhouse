# Critic — round 10

Average: 92

Method: signed in to both studios as `critic@local.test`; `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus the editor at 1024×768 and 1280×800 and the dashboard at 1920×1080; every width change followed by `dispatchEvent(new Event('resize'))` and, where a default layout was being judged, a reload. Every rail page on both sites (strongman 8792 — 19 hashes; automatic 8793 — 17 hashes) swept for controls with no computed accessible name (aria-label → aria-labelledby → `label[for]` → ancestor `<label>` → text → title → placeholder → alt), leftover `.spin`, and horizontal overflow. Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jordan-racing-team-2`; automatic `#/e/d-home`, `#/e/d-about`, `#/e/p-tower-parking-system`. Contrast measured per text node with a hand-written oklch→sRGB conversion in JS; **round 9's compositor was wrong** — it returned the first non-transparent ancestor background even when that background was `color-mix(… , transparent)`, so every `.chip` and `.count` was scored against an undiluted accent. This round the whole translucent stack is composited down to the first opaque layer; the corrected numbers exonerate every `.chip` and confirm exactly one real failure (R10-2). Both themes on fourteen pages. Navigation tree read for role structure; settings guard driven with a **real click and real typing** (`Strongman Lifts` → `Strongman LiftsQQ`, sticky bar appeared); block picker (49 entries); ⌘K "helmsdale"; six `?` sheets; Publish opened and cancelled; restore dialog opened; stale bookmarks `#/wat`, `#/e/ghost`, `#/c/nosuch`, `#/plugins/nope`.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 94 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 89 | The Help topics column scrolls sideways and cuts labels mid-word |
| 4 | Editor: layout, outline, inspector | 88 | At 1024 the title clips to 3 characters and "Saved" is 0 px wide |
| 5 | Editor: block model & width | 95 | — |
| 6 | Dashboard & content lists | 95 | — |
| 7 | Site tools | 88 | Template code: the Save button runs past the window edge |
| 8 | Studio admin | 94 | — |
| 9 | Feedback, errors, resilience | 94 | — |
| 10 | Visual consistency & polish | 87 | The three clips above; active-rail badge at 3.85:1 in dark |
| 11 | Preview fidelity & responsiveness | 94 | — |
| 12 | Accessibility & keyboard | 92 | — |

Blockers 0 · majors 2 · minors 4.

## Round-9 re-test

**Fixed — 6 of 7, plus the category-5 note. R9-3 fixed only for the resting state; R9-4 half fixed.**

R9-1 — **fixed.** `studio.css:1937–1940` clips `.editor-top-group.grow` and gives the title and save-state flex bases. At 1024 on `#/e/d-home` the save-state now ends at x 334 and the zoom holder starts at 368 — no overlap, on either site. (The cure introduced R10-1.)

R9-2a — **fixed.** `editor.js:338–351` branches on `anyPanelOpen()`. At 1440 on `#/e/d-home` I hid both panels: scale went to 100 %, `scaleBadge.hidden` and `scaleNote.hidden` both true, no button left to click. With one panel open the button reappears and its advice is true. `.preview-zoom-flat` (`studio.css:1945`) renders the no-panel case as plain text with `cursor: default`.

R9-2b — **fixed, and better than asked.** At 1024 with cleared storage both panels now default to closed, so the canvas is the full 944 px. Opening the Outline paints a caption above the canvas: *"The Outline is floating over the page — close it to see the whole page."* with a working **Close** link (`.canvas-overlay-note`, `studio.css:1950`). Measured on both sites.

R9-4 — **half fixed.** `savedWhen()` (`editor.js:1333`) replaced the version numbers with clock times: rows read "Saved at 03:29 / 3h ago", the button label is "Restore the version saved at 03:29", and `v7` is gone from every owner-facing string. But on `#/e/d-home` the ten rows still resolve to only **two** distinct names (three "at 03:29", seven "at 03:28"). See R10-5.

R9-5 — **fixed.** `assets.js:21` is `h('div.bulk-bar', …)` and `views.js:1302,1551` keep only the conditional colour; `.bulk-bar` / `.runout-line` carry the constants (`studio.css:1966–1968`).

R9-6 — **fixed.** `menus.js:154` emits `h('div.mlevel', { role: 'group' })`. Live on both sites: `.menu-tree[role=tree]`, every `.mlevel` `role="group"`, and **0 of 35** treeitems have a parent that is neither tree nor group.

R9-7 — **fixed as recommended.** The rail count is now `<span class="count count-unpub">` with a pencil SVG (`aria-hidden`) and `<span class="sr-only"> with unpublished changes</span>`. Visible glyph on screen, real name for a screen reader, same pencil the dashboard uses.

**Category-5 nested-block note — fixed.** `#/e/d-home` → "Section intro" (aria-level 2) now shows a **Layout** group: *"Width: set by the Section around it — Normal"* plus a **Select the Section** button. I pressed it; the inspector switched to the parent Section with the full Width control (Template default / Narrow / Normal / Wide / Page width / Edge to edge). Same on automatic `#/e/p-tower-parking-system` → "Columns" (level 2).

**Round-9 "verified working" re-check:** held. Zero unnamed controls across **36 hashes plus six editors** on both sites; zero `.spin`; no document-level horizontal scroll anywhere. ⌘K "helmsdale" returns the lift first, four images below, exactly one active row. Six `?` sheets (`Help with the dashboard / Lifts / Navigation / SEO / Deploy / Design`) are `role="dialog" aria-modal="true"`, focus lands inside, Escape closes each, and each carries live counts ("Browse all 12 of your lifts…", "Fix the 30 pages grouped under…"). Settings guard: real typing raised "You have unsaved changes · Discard · Save changes"; leaving to `#/seo` opened "Unsaved settings … Leave without saving?" with focus on **Cancel**; Discard landed on `#/seo` with the rail, the title and a cleared bar. Publish reads *"“Henry's Car Barn” will go live at /jordan-racing-team-2"*, focuses "Publish now", Cancel closes. `#/wat` → "Nothing lives at #/wat"; `#/e/ghost` → "That page no longer exists… the link is just out of date"; `#/c/nosuch` lists the real types. The restore dialog is a native `<dialog>` whose backdrop blocks the toolbar, so it cannot be stacked by a real user. `.main-pad` is 1152 px at 1920. Light theme: **zero** contrast failures on fourteen pages (`.top-brand .mark` at 1.01:1 remains the known gradient false positive).

## Findings

**R10-1 · 4/10 · major · both · any editor at 1024×768** R9-1's clip rule has no priority order, so the wrong child wins. Measured on strongman `#/e/d-home` and automatic `#/e/p-tower-parking-system`, `innerWidth` 1024: `.editor-top-group.grow` is 88 px wide against a 240 px `scrollWidth`; inside it the status chip `Published · edited` keeps its full **122 px** (it is a bare `<span>` with no class, so no rule reaches it), the title input is squeezed to **64 px** — "Car Parking & Vehicle Lifts UK" renders as `Car ...` — and `.save-state` is squeezed to **0 px**, so the word "Saved" is not on screen at all. The persona at 1024 cannot see which page they are editing and gets no confirmation that Save worked. Clean at 1280 (title 205, save 32) and 1440. Fix in `studio.css:1937–1940`: give the chip `flex: 0 1 auto; min-width: 0` (or hide it below ~1100 px the way `.preview-zoom-holder` is hidden at `studio.css:1652`) and give `.save-state` a `flex-basis` it may not shrink below; the title should be the last thing to lose width, not the first.

**R10-2 · 10/12 · minor · both · dark studio, any rail page** R9-3 was fixed only for the resting badge: `--badge-ink` (`studio.css:27`) puts an idle `.count` at **10.15:1**. But `studio.css` still carries `.side-item.active .count { background: color-mix(in oklch, var(--acc) 20%, transparent); color: inherit; }` — on the active row the badge inherits the row's `oklch(0.66 0.11 162)` over the row's own accent tint and measures **3.85:1** (strongman `#/c/page`, count "1"; automatic `#/c/page`, count "2") and **3.91:1** on `#/c/product`. Those are round 9's exact numbers, on the row the persona is always looking at. The sibling rule `.row-item.active .count, .row-item.active .badge, .side-item.active .badge { … color: inherit }` has the same defect. Replace `color: inherit` with `--badge-ink`.

**R10-3 · 7/10 · major · both · `#/tpl` at 1440×900** `.tpl-shell` (`studio.css:556`) is `display: grid` with `grid-template-rows` only and no column track, so its items size to `max-content`: `.tpl-bar` and `.tpl-main` are **1470 px** wide inside a 944 px shell. The toolbar's last control, **Save**, occupies x 1405–1456 in a 1440 px window — its right half is off screen and the label reads `Sav`. `document.documentElement.scrollWidth` is 1440, so nothing scrolls to reveal it. Reproduced on automatic (`.tpl-shell` 968/944, Save at 1400–1450). The page's primary action is cut off. Add `grid-template-columns: minmax(0, 1fr)` to `.tpl-shell` (and `min-width: 0` to `.tpl-bar`).

**R10-4 · 3/10 · minor · both · `#/help` at 1440×900** The topics column `.panel-body.help-nav` has `scrollWidth` 311 against `clientWidth` 248; its parent `.panel` is `overflow-x: auto`, so a horizontal scrollbar sits under the topic list and the longest entries are cut mid-word — "Change the header or footer text" renders as "Change the header or footer te" with no ellipsis. The rubric names sideways scrolling as a cap trigger, and this is the one screen whose whole job is to reassure. Let the rows wrap (or ellipsis them) instead of widening the column.

**R10-5 · 12/4 · minor · both · any editor → Restore points** The clock times R9-4 asked for are in place, but at minute resolution ten rows collapse to two names: three buttons read "Restore the version saved at 03:29" and seven read "…at 03:28" (`editor.js:1333–1343`, `1357`). A voice user saying "click restore the version saved at 03:28" has seven targets. The rows are already ordered; add the ordinal to the accessible name only ("the 2nd restore point, saved at 03:28") or include seconds.

**R10-6 · 1/9 · minor · both · site switcher** Both studios appear in the switcher as **"Strongman Lifts"**, one at `strongmanlifts.co.uk` and one at `www.strongmanlifts.co.uk`; the only thing separating them is "You are here" and "now at localhost:8792". The names come from site data (automatic's `#/settings` → Site name is literally "Strongman Lifts"), but the studio offers the persona no other handle — and a port number is the one piece of developer text left in the switcher. Fall back to the studio's own folder/site id, or show the port as a plain label ("the other studio on this computer").

## What each sub-95 category needs

**3 → 89:** R10-4 alone. Stop the Help topics column from scrolling sideways and clipping labels; nothing else on that screen has a flaw, so that single fix is 95.
**4 → 88:** R10-1 is the cap trigger (a clip *and* an action with no feedback). Order the toolbar's flex priorities so the chip and the save state yield before the title, then R10-5. That is 95.
**7 → 88:** R10-3 only. One grid-track declaration on `.tpl-shell`. Every other site tool (Navigation, Design, Header & footer, SEO) swept clean in both themes.
**10 → 87:** R10-1, R10-3, R10-4 (three clips) and R10-2 (the active-row badge pair). All four are one-rule fixes.
**12 → 92:** R10-5, and `aria-expanded` on the Navigation tree's parent rows (`menus.js:151`) — the level-1 rows that own a `role="group"` declare neither expanded nor collapsed. With those two done I could not find an unnamed, unreachable, ambiguously-named or mis-structured control anywhere on either site.
**1 → 94 / 8 → 94 / 9 → 94 / 11 → 94:** 1 and 9 both need R10-6. 11 has no defect I could find — the 1024 default now shows the whole canvas, the caption explains a floating panel, and the 60 % readability floor steps the preview down to a real 1024 width rather than shrinking text; 95 needs a device-mode and mobile-drawer pass at a width below 768, which the rubric does not ask for. 8 again has no defect I could reach without changing data (inviting a person, switching an app on).
