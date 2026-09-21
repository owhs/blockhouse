# Critic — round 19

Average: 94

Method: my own tab, `localStorage.clear()` per origin before judging defaults, signed into both studios as `critic@local.test`. Full 1440×900 rail sweep on both sites (strongman 20 hashes, automatic 17, plus `#/c/nope`, `#/plugins/nope`, `#/nowhere`, `#/edit/<id>`), each probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the right edge and `documentElement.scrollWidth`. 390×844, 768, 1024×768 and 1920×1080, every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Documents opened: strongman `d-bonar`, `d-about`, `d-helmsdale`; automatic `p-tower-parking-system`, `d-about`, `d-services`, `p-shuttle-parking-system`. Eleven `?` sheets across the two sites, ⌘K on both, the block picker (55 buttons, 54 described entries), the settings guard with real typing and a real rail click, restore-point dialogs on three documents, both studio themes measured for contrast with alpha layers composited, tree keyboard state, real `Ctrl+K` / `?` / `Escape` key presses. **Data-changing flows completed on real data:** title edit-and-exact-restore on strongman `d-bonar` (`value === "The Bonar: Four Post Car Parking"` verified character-for-character); a no-edit Save on strongman `d-about`; Reading progress switched off and back on on strongman; `r19probe@local.test` invited then disabled on automatic; the Republish dialog opened and cancelled on automatic `p-tower-parking-system`. Everything I dirtied is restored. Leftover: `r19probe@local.test`, disabled, on automatic.

Harness caveats unchanged: synthetic `keydown` Escape does not close `<dialog>`s or the drawer, so every Escape claim was made with a real key press; exact restores were done by selecting the whole value and typing the original over it.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 94 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 97 | — |
| 4 | Editor: layout, outline, inspector | 89 | R19-2 |
| 5 | Editor: block model & width | 97 | — |
| 6 | Dashboard & content lists | 96 | — |
| 7 | Site tools | 96 | — |
| 8 | Studio admin | 94 | — |
| 9 | Feedback, errors, resilience | 94 | — |
| 10 | Visual consistency & polish | 89 | R19-1 |
| 11 | Preview fidelity & responsiveness | 89 | R19-2 |
| 12 | Accessibility & keyboard | 96 | — |

Blockers 0 · majors 2 · minors 4.

## Round-18 re-test

**R18-1 — fixed.** On a clean published page (strongman `d-bonar`, `d-about`; automatic `d-about`, `d-services`, `p-shuttle-parking-system`) the primary button now reads **"Publish again"** with the title "Already live — publishes the same content again", and the dialog is honest: "Publish again · This page is already live at /bonar with these exact contents. Publishing again changes nothing for visitors." On a stale document (`p-tower-parking-system`) the same button reads "Republish · Put your latest changes on the website" and the dialog reads "Republish changes · "Tower Parking System" will go live at /systems/tower-parking-system." Both states correct on both sites.

**R18-2 — partly fixed; minor residual.** Expanding "Latest · 6 saves at 03:28" on automatic `p-tower-parking-system` now gives six rows that differ — "Saved at 03:28:08", "03:28:06", "03:28:05"… — so they are no longer indistinguishable. But neither of the two remedies asked for landed: where the stored fingerprint is missing the row still says nothing about *what* changed, while on strongman (`d-bonar`, `d-helmsdale`) the equivalent rows do say "no visible change". The owner choosing between six same-minute saves still has only a second-hand to go on.

**R18-3 — fixed.** strongman: topbar "Strongman Lifts · strongmanlifts.co.uk", tab title "Strongman Lifts (strongmanlifts.co.uk) · Blockhouse Studio". automatic: "…· www.strongmanlifts.co.uk" and "Strongman Lifts (www.strongmanlifts.co.uk) · Blockhouse Studio". The two tabs are now distinguishable. See R19-4 for the residual nit.

**R18-4 — fixed.** `#/edit/d-bonar` renders "Nothing lives at **#/edit/d-bonar**"; `#/edit/d-bonar/extra?x=1` and `#/edit/p-x` echo their whole hash too.

**Round-18 "verified working" re-check: holds, with two exceptions.** 41 rail hashes across both sites at 1440: zero controls without an accessible name (the four flagged by the first pass were innerText artefacts of mid-render reads — all carry real text), zero nested interactive elements, zero `.spin`, `scrollWidth === 1440` everywhere, and the only elements past the right edge are `#/tpl`'s code surface. Unknown-route views excellent on both sites. Eleven `?` sheets are plain, type-aware and count-aware ("Browse all 26 of your systems", "Help with Deploy"), open focused on Close panel and close on a real Escape. The settings guard fires on a real rail click ("Unsaved settings · You have unsaved settings. Leave without saving?", focused on Cancel); Discard navigated and `/api/settings` still held the original tagline. Block picker: 54 entries, every one with a sentence. One width vocabulary everywhere, and a nested Columns inside a Section reads "Width: set by the Section around it — Normal" with a "Select the Section" jump. Deploy keeps Bun/Docker/nginx inside "Technical details (for developers)"; a twenty-term jargon regex over every rail page of automatic returned nothing outside `<details>` and the explicitly-labelled "For developers" help chapter. `?` opens the shortcut list; ⌘K carries stale-aware status labels on both sites ("Published · edited" beside "Published"). Apps toggling gives honest, restart-aware toasts in both directions. Invite lands focus on Email, roles carry plain blurbs, disabling toasts "R19 Probe can no longer sign in — they were signed out of the studio" and flips the row to "Cannot sign in". Tree: `role="tree"` labelled "Page outline", exactly 1 tabbable item and 1 selected on every document opened. Mobile drawer opens and a real Escape closes it, returning focus to Menu. **The two exceptions are the new findings below: the studio theme toggle (R19-1) and the editor at phone width (R19-2), neither of which round 18 exercised.**

## Findings

**R19-1 · 10 · major · both sites · every screen, after using "Toggle studio light / dark"** Using the studio's own command-palette entry **Toggle studio light / dark** leaves three controls stuck on the previous theme's background while their text flips to the new theme's colour. Measured on strongman: starting dark (reloaded, correct), toggling to light left `a.btn.ghost.small.view-site` at `oklab(0.235 …)` with text `oklch(0.23 …)` — **1.02:1**. Going the other way, light → dark, left it at `rgb(255,255,255)` with text `oklch(0.93 …)` — **1.05:1**. The same is true of `.side-item.active` (the *selected rail item* — the one row the owner looks at to know where they are) and a second `.btn.ghost.small`. A screenshot in toggled-dark shows a white "View site" pill and a white selected rail row against the dark chrome, both with unreadable labels. Reproduced identically on automatic (`view-site`, `side-item.active`, `btn ghost small` all held `L≈29/255` after switching to light). A reload fixes it, but nothing tells the owner to reload. Cause is almost certainly `transition: background …` on the shorthand rather than `background-color`, so the value does not re-resolve when `--bg-raise` / the active-row token changes: `src/assets/admin/studio.css:192` (`.btn`) and `:196` (`.btn.ghost`), plus the matching rules for `.side-item.active` and `.row-item.active`.

**R19-2 · 4, 11 · major · both sites · `#/e/<any document>` at 390×844** `src/assets/admin/studio.css:920` sets `.editor-top { flex-wrap: nowrap; overflow: hidden; }`. The bar's content is 903px wide in a 390px window, so everything past the title is clipped with no scroll and no overflow menu. On strongman `d-bonar` and automatic `d-about` the only reachable controls are Back, the title field and Restore points; **Save, Publish again / Republish, Outline, Settings panel, "Help with the editor" and "More document actions" are all off-screen and unreachable**, as is the selected block's own "Actions for …" menu. An owner who opens a page on their phone can type a correction and then has no way to save or publish it, and no way to get help. Either wrap the bar on to a second row below 620px, put the overflowing controls behind the existing "More document actions" menu, or allow horizontal scrolling.

**R19-3 · 11 · minor · both sites · editor at 768** The only clipped control at 768×900 is the selected block's floating **"Actions for Photo row"** button (right edge 790). The rest of the editor is clean; 1024×768 and 1920×1080 are clean on every page tested.

**R19-4 · 8 · minor · automatic · `#/users` → Invite** The credentials panel after "Create account" reads "**URL:** http://localhost:8793/admin/ · Email: … · Password: …". "URL" is the one developer word left in an otherwise exemplary dialog; "Sign-in address" would match the rest of the studio's voice.

**R19-5 · 1, 9 · minor · both sites · topbar and tab title** R18-3's fix distinguishes the two studios only by a "www." prefix — "strongmanlifts.co.uk" against "www.strongmanlifts.co.uk" — in both the topbar and the tab title, where the tab title is also truncated by the browser. The site switcher already has the clearer wording ("the strongman folder" / "the automatic folder"); carrying that into the chrome instead of, or beside, the host would make the two tabs tellable apart at a glance.

## What each sub-95 category needs

**4 → 95.** Layout, outline, default selection, toolbar wording, panel toggles, the 1024 parking, dialog stacking, Escape and the type-aware restore-point wording are all right, and R18-1 is properly closed. R19-2 is the gap; R18-2's residual sits behind it.

**11 → 95.** Previews, device captions, the drawer, 768/1024/1920 and every rail page at 390 are clean. R19-2 alone, with R19-3 behind it.

**10 → 95.** One card pattern, one badge system, tidy spacing, no ghost elements, and worst composited text contrast 5.3:1 light / 4.5:1 dark on a reloaded page. R19-1 alone.

**1, 8, 9 → 95.** Only the three minors above (R19-4, R19-5).
