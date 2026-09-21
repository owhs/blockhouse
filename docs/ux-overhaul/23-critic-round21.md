# Critic — round 21

Average: 94

Method: my own tab (`tab-21`), `localStorage.clear()` per origin after sign-in, signed into both studios as `critic@local.test`. Full 1440×900 rail sweep on both sites (strongman 23 hashes, automatic 20, including `#/c/nope`, `#/plugins/nope`, `#/nowhere`), each probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the right edge and `documentElement.scrollWidth`; a 24-term jargon regex over every rail page with `<code>`/`<pre>`/`<details>` stripped. 390×844, 768×900, 1024×768 and 1920×1080, every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Documents opened: strongman `d-bonar`, `d-about`, `d-helmsdale`; automatic `d-about`, `d-services`, `p-tower-parking-system`. Seven `?` sheets on automatic, ⌘K with a real query, the block picker (50 buttons, 49 described), restore-point dialogs on both sites, the settings guard with real typing and a real rail click, both studio themes through the user-menu toggle, real `Tab` / `Ctrl+K` / `Escape` key presses throughout.

**Data-changing flows completed on real data:** title edit → autosave → explicit Save → restore point verified → title restored → Publish dialog read and cancelled on automatic `p-tower-parking-system` (left byte-identical to live; the dialog itself confirms "changes nothing for visitors"). `r21probe@local.test` invited on automatic, credentials panel read, **Extra access** popover read, then disabled. Settings dirtied on automatic and **Discard**ed, confirmed against `/api/settings`. Everything I dirtied is restored. Leftover: `r21probe@local.test`, disabled, on automatic.

Harness caveats: `getBoundingClientRect()` on the drawer reports the closed offset while it is visibly open, so drawer position was judged from screenshots; the pane's screenshot frame drifts from the emulated viewport, so clicks used `ref`s, not coordinates; one earlier `?`-sheet probe closed sheets with `close()` rather than the Close button and left `.app` inert — **a real Escape clears it correctly**, so that was my artifact, not a defect.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 97 | — |
| 4 | Editor: layout, outline, inspector | 89 | R21-2 |
| 5 | Editor: block model & width | 97 | — |
| 6 | Dashboard & content lists | 96 | — |
| 7 | Site tools | 96 | — |
| 8 | Studio admin | 96 | — |
| 9 | Feedback, errors, resilience | 89 | R21-2 |
| 10 | Visual consistency & polish | 95 | — |
| 11 | Preview fidelity & responsiveness | 89 | R21-1 |
| 12 | Accessibility & keyboard | 89 | R21-1 |

Blockers 0 · majors 2 · minors 2.

## Round-20 re-test

**R20-1 — fixed.** At 390×844 on strongman `d-bonar`, every `.editor-top` control now measures inside the window: Back 10→42, title 46→277, Restore points 348→380 on row one; Help 10→42, Outline 46→78, Settings panel 82→114, Save 118→168, Publish again 172→274, **More document actions 278→310** on row two. `documentElement.scrollWidth === 390`, no group exceeds its container, and the one group that can overflow carries `overflow-x: auto`. The status line and the three device-width modes have been folded into the **More document actions** menu, which opens with 19 items spanning 15→379 and ending at y=722 inside an 844-px window — Undo, Redo, Unpublish, Make this the homepage, Delete document, the four quick-edits and "Open preview in a new tab" are all reachable on a phone. Screenshot confirms a clean two-row toolbar with nothing cut.

**R20-2 — fixed.** With the drawer closed at 390 and at 768, on both sites, `nav.side` is `inert`, `aria-hidden="true"` and `visibility: hidden`. Real `Tab` presses from the **Menu** button at 390 go Switch site → View site → Critic → Back → Document title → Restore points; at 768, Switch site → Search everything → View site → Critic. Zero off-screen focus stops where round 20 counted 24. (The same technique is used for the editor's closed settings panel at 1024: `aside.inspector` sits at 1024→1328 but is `visibility: hidden`, so its 14 controls are out of the tab order — clean.)

**R20-3 — fixed, but the fix introduced R21-2.** On a clean strongman `d-about` and a clean automatic `p-tower-parking-system`, pressing **Save** now raises the toast **"Nothing to save — already up to date"** within ~300 ms, exactly as asked, with no phantom restore point.

**R20-4 — not fixed.** Automatic `#/e/p-tower-parking-system` → Restore points still shows twelve legacy rows reading "Saved · Tower Parking System" separated only by seconds (03:28:08…03:27:37) with no "no visible change" annotation. Confirmed it is legacy data only: the save I made this round appears as "Latest · Saved · Tower Parking System X · Saved at 10:45", correctly naming the title it would restore. Fades with time; no code needed.

**Round-20 "verified working" re-check: holds.** 43 rail hashes across both sites at 1440: zero controls without an accessible name, zero nested interactive elements, zero `.spin`, `scrollWidth === 1440` everywhere, nothing past either edge. The jargon regex returns nothing outside `#/tpl` and the **FOR DEVELOPERS** chapters of `#/help`; no literal `undefined`/`null` renders anywhere (the `#/tpl` hits are inside the code editor's own horizontally-scrollable pane). Unknown-route views are excellent — `#/people` (the real route is `#/users`) gives "Nothing lives at #/people · Did you mean one of these? **People**" with a working suggestion button. Seven `?` sheets on automatic are plain and count-aware ("Browse all 6 of your pages", "Help with Deploy", "Publish everything at once to https://www.strongmanlifts.co.uk"). ⌘K opens focused on "Search the studio", and "tower" narrows to 5 results with exactly one active row, each described. The invite dialog lands focus on Email, its five role radios are properly labelled by wrapping `<label>`s, and the credentials panel reads "Sign-in address: … Email: … Password: …" under "Share these once, over a channel you trust." **Extra access** explains grants in prose and keeps the raw codes (`content.publish`, `plugin:*`) at `display: none` until "Show codes". Disabling toasts "R21 Probe can no longer sign in — they were signed out of the studio" and flips the row to "Cannot sign in". The settings guard fires on a real rail click ("Unsaved settings · You have unsaved settings. Leave without saving?", focused on Cancel) and **Discard** left `/api/settings` untouched. The block picker offers 50 entries, 49 described in a sentence. Publish wording stays content-aware. The dark→light toggle repaints the rail, cards and Settings cleanly with no element keeping the old ground.

## Findings

**R21-1 · 11, 12 · major · both sites · every screen at ≤768, drawer open.** Regression introduced by the R20-2 fix. Opening the drawer with a real click on **Menu** (390 and 768, strongman and automatic): `aria-expanded` goes `true` and `nav.side` loses `inert`, but **focus stays on the Menu button and never enters the drawer**, and **a real `Escape` does nothing** — `aria-expanded` is still `true` and the drawer is still on screen in the screenshot. Pressing `Tab` from there moves focus to **Switch site**, a topbar control sitting *behind* the open drawer and its `.nav-scrim`: the keyboard user is tabbing through controls they cannot see or click. Round 20 measured the opposite behaviour ("opens, takes focus, and a real Escape closes it and returns focus to Menu"), so the focus-move and the Escape handler were lost when the drawer was made `inert` while closed — most likely they were bound to the drawer, which is now unfocusable at bind time. Mouse users are fine (the scrim and a second Menu press both close it and restore `inert`). Restore the focus move into the drawer on open, and bind Escape at document level while `aria-expanded` is true. `src/assets/admin/studio.js` — the `nav-toggle` / drawer open-close handler.

**R21-2 · 4, 9 · major · both sites · `#/e/<any document>`, edit then wait then Save.** Regression introduced by the R20-3 fix. On automatic `p-tower-parking-system` I appended " X" to the title, saw the chip read "Unsaved…", waited, then pressed **Save**. The toast said **"Nothing to save — already up to date"**, **no restore point was created**, and the restore-point list showed nothing newer than the 03:28 legacy block — yet the edit *had* reached the server: a full reload came back titled "Tower Parking System X". So the persona who edits, pauses, then presses Save is told their change does not exist and silently gets no restore point, while the Restore points dialog two clicks away promises "A restore point is kept every time you press Save (Ctrl+S) or publish." Pressing Save *immediately* after the edit behaves correctly and does write a named restore point, which is what makes this easy to miss. The "nothing to save" test compares against the last **autosave**; it must compare against the last **restore point**. `src/assets/admin/studio.js` — the Save handler's dirty check added for R20-3.

**R21-3 · 4 · minor · automatic · `#/e/p-tower-parking-system` → Restore points.** R20-4 unchanged: twelve legacy rows distinguishable only by a second hand. Data, not code.

**R21-4 · 8 · minor · automatic · housekeeping.** Earlier rounds left live data dirty: the site **Tagline** on automatic reads "Automatic parking systems, parking lifts and car elevators **ZQ**" in `/api/settings`, and the People list carries `15probe@local.test`, `r20probe@local.test` and now my `r21probe@local.test`. The tagline is visitor-facing. I did not edit it (a keystroke probe risked dirtying the wrong field, and I discarded rather than guess); it needs one deliberate Settings save by a maintainer.

## What each sub-95 category needs

**11 and 12 → 95.** Everything else is right: the closed drawer and the closed inspector are both properly removed from the tab order, no nested interactives, every icon button named, one tabbable and one selected item in the outline tree, one active row in ⌘K, previews free of consent banners and ghost panels, device captions plain, and 768 / 1024 / 1920 clean on both sites. R21-1 alone.

**4 → 95.** Toolbar, outline, default selection, panel toggles, dialog stacking and Escape, restore-point naming for new saves, and the whole 390 layout are now correct. R21-2, with R21-3 behind it.

**9 → 95.** 401 handling, unknown panel and unknown route views, publish and disable toasts, the unsaved-settings guard and Discard are all correct, and the no-edit Save toast asked for in R20-3 now exists with the right wording. R21-2 alone — the same toast firing when there *is* something to save.
