# Critic — round 20

Average: 94

Method: my own tab (`tab-20`), `localStorage.clear()` per origin before judging defaults, signed into both studios as `critic@local.test`. Full 1440×900 rail sweep on both sites (strongman 20 hashes, automatic 17, plus `#/c/nope`, `#/plugins/nope`, `#/nowhere`, `#/edit/d-about`), each probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the right edge and `documentElement.scrollWidth`; a 25-term jargon regex over every rail page with `<details>`/`<code>`/`<pre>` stripped. 390×844, 768×900, 1024×768 and 1920×1080, every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Documents opened: strongman `d-bonar`, `d-about`, `d-helmsdale`; automatic `d-about`, `d-services`, `p-tower-parking-system`, `p-shuttle-parking-system`. Seven `?` sheets on strongman, ⌘K, the block picker (55 buttons, 54 described), restore-point dialogs on two sites, the settings guard with real typing and a real rail click, Settings search landing, both studio themes through the **user-menu toggle in both directions** with alpha layers composited (and a canvas parse-failure guard, since `color-mix()` backgrounds silently read as black without one), real `Tab` / `Ctrl+K` / `?` / `Escape` key presses.

**Data-changing flows completed on real data:** title edit-and-exact-restore on strongman `d-bonar` (twice, verified character-for-character, badge returned to "Publish again"); tagline edited on strongman Settings, guard fired, **Discard** confirmed against `/api/settings`; `r20probe@local.test` invited, credentials panel read, then disabled; a real **Republish** of automatic `p-tower-parking-system` (was stale since round 18 — now clean); edit → autosave → **Publish again** on automatic `d-services`, title restored first. Everything I dirtied is restored. Leftover: `r20probe@local.test`, disabled, on automatic.

Harness caveats: `checkVisibility()` returns false for every `.editor-top` child, so toolbar clipping was judged from measured rects plus screenshots, not from that API; synthetic Escape does not close `<dialog>`s, so every Escape claim used a real key press.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 97 | — |
| 4 | Editor: layout, outline, inspector | 89 | R20-1 |
| 5 | Editor: block model & width | 97 | — |
| 6 | Dashboard & content lists | 96 | — |
| 7 | Site tools | 96 | — |
| 8 | Studio admin | 96 | — |
| 9 | Feedback, errors, resilience | 93 | — |
| 10 | Visual consistency & polish | 95 | — |
| 11 | Preview fidelity & responsiveness | 89 | R20-1, R20-2 |
| 12 | Accessibility & keyboard | 89 | R20-2 |

Blockers 0 · majors 2 · minors 2.

## Round-19 re-test

**R19-1 — fixed.** Using the user-menu **Light studio / Dark studio** entry, with no reload: strongman dark → light left `.view-site` at bg `255,255,255` / **16.85:1**, `.side-item.active` at `223,242,232` / **6.84:1**; light → dark returned them to `26,32,29` / **13.52:1** and `22,53,39` / **4.52:1**. Reproduced on automatic. No control keeps the old theme's background in either direction; a screenshot immediately after the toggle shows the rail, the View-site pill and the topbar all correct.

**R19-2 — partly fixed; the residual is R20-1.** `.editor-top` now wraps (`flex-wrap: wrap`) at 390, and **Save, Outline, Settings panel and "Help with the editor" are reachable**, which they were not in round 19. But the second row is still 424–435 px wide inside 390 with `overflow: visible` and no scroll. See R20-1.

**R19-3 — fixed.** At 768×900 the editor on strongman `d-bonar` shows zero visible controls past either edge; every toolbar control fits (rightmost edge 758 of 768). 1024×768 and 1920×1080 are clean on the editor and on every rail page tested.

**R19-4 — fixed.** The credentials panel now reads "**Sign-in address:** http://localhost:8793/admin/ · Email: … · Password: …", under "Share these once, over a channel you trust." No developer word left in the dialog.

**R19-5 — fixed.** Topbar reads "Strongman Lifts · strongman" against "Strongman Lifts · automatic"; tab titles are "Strongman Lifts (strongman) · Blockhouse Studio" and "Strongman Lifts (automatic) · Blockhouse Studio". The two tabs are now tellable apart at a glance. (The server-rendered title still carries the host for the fraction of a second before hydration — not worth a finding.)

**Round-19 "verified working" re-check: holds.** 37 rail hashes across both sites at 1440: zero controls without an accessible name, zero nested interactive elements, zero `.spin`, `scrollWidth === 1440` everywhere, nothing past either edge. The jargon regex returns nothing outside `#/tpl` (the Template code surface) and the explicitly-labelled **FOR DEVELOPERS** chapters of `#/help` — every hit I traced (`nginx`, `blocks.register`, `liquid`, `folder + index.html`) sits under that heading. Unknown-route views excellent on both sites, and `#/edit/d-about` still echoes its whole hash. Seven `?` sheets are plain, type- and count-aware ("Browse all 12 of your lifts", "Help with Deploy"), open focused on **Close panel**. Settings search for "cookie" narrows the section list and lands **focus on the "Count visits" input itself**. The guard fires on a real rail click ("Unsaved settings · You have unsaved settings. Leave without saving?", focused on Cancel); real Escape closes only the dialog; Discard reverted the field and the server tagline was untouched. Block picker: 55 buttons, 54 described entries, every one a sentence. Outline is `role="tree"` labelled "Page outline" with exactly 1 tabbable and 1 selected item. Device modes caption plainly ("Phone width — 390px, shown full size"); no consent banner or hidden panel in the preview. Publish wording is still content-aware in both directions and the publish toast reads "**Published — it is live now**". Invite lands focus on Email, roles carry plain blurbs, disabling toasts "R20 Probe can no longer sign in — they were signed out of the studio" and flips the row to "Cannot sign in". Restore-point rows on strongman now name the title they would restore and annotate "no visible change" (R18-2 closed for new saves). Mobile drawer opens, takes focus, and a real Escape closes it and returns focus to **Menu**.

## Findings

**R20-1 · 4, 11 · major · both sites · `#/e/<any document>` at 390×844.** The editor toolbar wraps now, but the second `editor-top-group` measures **424 px inside a 390 px window** with `overflow: visible` and `documentElement.scrollWidth === 390`, so the overflow is clipped, not scrollable. Measured identically on strongman `d-bonar` and automatic `d-about`: "Publish again" spans 294→**395** (its right edge cut) and "**More document actions**" spans 403→435, entirely off-screen. That menu is the only route to **Undo, Redo, Unpublish, Make this the homepage, Delete document**, the quick-edit shortcuts and "Open preview in a new tab" — all unreachable on a phone. The status line in the same row, "Shown narrower to keep text readable — the page is wider than the window", is also cut mid-word at the right edge (screenshot confirms). Wrap that group on to its own row below ~480 px, or let it scroll. `src/assets/admin/studio.css` — the `.editor-top` / `.editor-top-group` rules around line 920.

**R20-2 · 11, 12 · major · both sites · every screen at ≤768 with the drawer closed.** `nav.side` is `position: fixed` at `left: -240` when the drawer is closed, but it is **not `inert`, not `aria-hidden`, `visibility: visible`, and every one of its links keeps `tabIndex 0`** — 24 of them on strongman, 21 on automatic. Starting from the **Menu** button and pressing **Tab six times** (real key presses) put focus on "Pages" with `left = -230`, fully off-screen, focus ring and all. A keyboard user at phone or tablet width walks through two dozen invisible stops before reaching the page, and a screen reader announces the whole rail twice. Mark the closed drawer `inert` (or `visibility: hidden` until it opens) and drop it from the tab order.

**R20-3 · 9 · minor · both sites · editor, pressing Save with nothing changed.** On automatic `d-services` (clean, "Published / Saved") I clicked **Save** and polled the DOM every 150 ms for two seconds: the `.save-state` chip never changed, no toast appeared, and nothing else moved. The behaviour is right — no phantom restore point, the document stays "Published" rather than going stale — but the persona who presses a button and sees nothing will press it again. A one-second "Nothing to save — already up to date" would close it.

**R20-4 · 4 · minor · automatic · `#/e/p-tower-parking-system` → Restore points.** Expanding "Latest · 6 saves at 03:28" still gives six rows reading "Saved · Tower Parking System" separated only by seconds (03:28:08, :06, :05, :04, :02, :01), with none of the "no visible change" annotation the strongman rows now carry. These are legacy saves written before the fingerprint existed — new saves annotate correctly — so this fades with time rather than needing code, but today the owner choosing among them has only a second hand.

## What each sub-95 category needs

**4 and 11 → 95.** Everything else in both categories is right: outline, default selection, toolbar wording, panel toggles, dialog stacking and Escape, restore-point wording, device captions, no consent banner or ghost panels in previews, and 768 / 1024 / 1920 all clean on both sites. R20-1 alone is the gap, with R20-4 behind it in category 4.

**12 → 95.** No nested interactives, every icon button named, focus ring is a visible 2 px accent outline, Escape closes only the top layer, the tree exposes one tabbable and one selected item, the palette one active row. R20-2 alone.

**9 → 95.** 401 handling, two sites on one host, unknown panel and unknown route views, publish and disable toasts, the unsaved-settings guard and Discard are all correct. R20-3 alone.

**10 → 95+.** One card pattern, one badge system, tidy spacing, no ghost elements, worst composited text contrast **4.81:1 light / 4.68:1 dark** (the ⌘K chip) across dashboard, a content list and Settings, and the theme toggle now repaints cleanly in both directions.
