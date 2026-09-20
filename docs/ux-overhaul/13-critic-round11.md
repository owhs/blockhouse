# Critic — round 11

Average: 93

Method: signed in to both studios as `critic@local.test`; `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus the editor at 1024×768 and the dashboard at 1920×1080; every width change followed by `dispatchEvent(new Event('resize'))` **and a reload** before a default layout was judged. Every rail page on both sites (strongman 8792 — 19 hashes; automatic 8793 — 17 hashes) swept for controls with no computed accessible name (aria-label → aria-labelledby → `label[for]` → ancestor `<label>` → text → title → placeholder → alt), leftover `.spin`, horizontal overflow, and any element whose right edge passes 1440 px. Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jordan-racing-team-2`; automatic `#/e/d-home`, `#/e/d-about`, `#/e/p-tower-parking-system`. Contrast measured per text node with round 10's corrected compositor (the whole translucent stack folded down to the first opaque layer). Both themes on fourteen pages each site. Settings guard driven with a **real click, real End key and real typing** (`Strongman Lifts` → `Strongman LiftsQQ`). Block picker (53 entries), ⌘K "helmsdale", six `?` sheets, Publish opened and cancelled, restore dialog opened and read, Navigation tree walked with Arrow/Home/End, stale bookmarks `#/wat`, `#/e/ghost`, `#/c/nosuch`, `#/plugins/nope`, jargon regex sweep over `.main-pad` on every page of both sites.

*One measuring caveat, recorded so the next round does not chase it:* in this preview engine `getComputedStyle(el).backgroundColor` on `.btn.ghost` returns the **dark** branch of `light-dark(#ffffff, …)` while `color` returns the light branch, even with `color-scheme: light` computed on the element and every ancestor. The button paints white with dark ink on screen (screenshot confirmed). `.view-site` at "1.02:1" and `.top-brand .mark` at "1.01:1" are both engine/gradient artefacts, not defects.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 93 | — |
| 4 | Editor: layout, outline, inspector | 88 | The Images list in the inspector runs 96 px off the window; its remove button cannot be reached |
| 5 | Editor: block model & width | 95 | — |
| 6 | Dashboard & content lists | 95 | — |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 95 | — |
| 9 | Feedback, errors, resilience | 93 | — |
| 10 | Visual consistency & polish | 88 | The same overflow: content crossing the window edge with nothing to scroll |
| 11 | Preview fidelity & responsiveness | 94 | — |
| 12 | Accessibility & keyboard | 93 | — |

Blockers 0 · majors 1 · minors 3.

## Round-10 re-test

**Fixed — all 6, plus the tree `aria-expanded` note.**

R10-1 — **fixed.** `studio.css:1986–1994` re-orders the toolbar. At `innerWidth` 1024 on strongman `#/e/d-home`: `.doc-title-input` **143 px** (renders "Car Parking & …" with a real ellipsis), `.save-state` **56 px** showing the word **Saved**, `.doc-status` display:none below 1100 px, restore button intact, group `245/245` — no overflow. Screenshot confirms. The publish state is not lost when the chip hides: the primary button still reads **Republish**.

R10-2 — **fixed.** `studio.css:2000–2001` replaces `color: inherit` with `var(--badge-ink)` on both rules. Dark studio, measured: strongman `#/c/page` active count **7.91:1** (was 3.85), automatic `#/c/page` active count **7.91:1**, idle count 10.12:1. A full dark-theme text sweep over 16 pages (strongman) and 14 (automatic) returned **zero** failures.

R10-3 — **fixed.** `studio.css:2006–2008` adds `grid-template-columns: minmax(0, 1fr)`, `min-width: 0` and `flex-wrap`. `#/tpl` at 1440: `.tpl-shell` and `.tpl-bar` both `944/944`; the bar wraps to two rows and **Save** sits at x 606–656, fully on screen, on both sites.

R10-4 — **fixed.** `studio.css:2013–2016`. `.help-nav` is `248/248` on both sites; every `.row-label` is `w175 sw175` — no clipping, no sideways scrollbar, long entries wrap ("Change the header or footer text" is whole).

R10-5 — **fixed for the accessible name.** `editor.js:1345–1349` (`ordinal()`) and `1363–1371`. The ten rows on `#/e/d-home` now yield **21 distinct button names** — "Preview/Restore the 4th restore point, saved at 03:28". The visible column is unchanged; see R11-2.

R10-6 — **fixed.** `main.js:598–612`. The switcher now reads "Strongman Lifts · **the strongman folder** · strongmanlifts.co.uk — You are here" against "Strongman Lifts · **the automatic folder** · www.strongmanlifts.co.uk — the other studio on this computer". No port number anywhere.

**Tree `aria-expanded` note — fixed.** `menus.js:159` spreads `...(hasKids ? { expanded: true } : {})`. On `#/menus`: 35 treeitems, **0** orphans (every parent is `tree` or `group`), **7** rows carry `aria-expanded`, and exactly the rows that own children. Arrow Down/Up, Home and End all move focus correctly.

**Round-10 "verified working" re-check: held.** Zero unnamed controls across 36 rail hashes and six editors on both sites (round 10's "unnamed INPUT" ghosts I saw were my own helper omitting `label[for]`; re-run with the full algorithm returns nothing). Zero `.spin`; `documentElement.scrollWidth` is exactly the viewport on every page of both sites at 1440 and 1920. `.main-pad` 1152 px at 1920. ⌘K "helmsdale" → the lift first, four images below, exactly one `aria-selected` row, `aria-activedescendant` tracking. Six `?` sheets (`aside.sheet[role=dialog][aria-modal=true]` — note they are not `<dialog>`) on `#/`, `#/c/product`, `#/menus`, `#/seo`, `#/design`, `#/deploy`: focus lands inside on "Close panel", Escape closes each, live counts present ("Browse all 12 of your lifts…", "Fix the 30 pages grouped under…"). Settings guard: real typing raised "You have unsaved changes · Discard · Save changes"; leaving to `#/seo` opened "Unsaved settings … Leave without saving?" focused on **Cancel**; Discard landed on `#/seo` with the bar cleared. Settings search "robots" → two hits; clicking one focuses `#fld-17` (Description shown in search results) with one flash highlight. Publish: *"“The Helmsdale…” will go live at /helmsdale"*, native `:modal`, focus on "Publish now", Cancel closes. Block picker 53 entries, **0** without a description sentence. `#/wat`, `#/e/ghost`, `#/c/nosuch` all answer in plain words. Apps and Deploy keep their developer text behind closed `<details>` ("What it can do", "Limit what it may do (advanced)", "Technical details (for developers)") — `systemd`, `env-file`, `sharp cannot run in a Worker` are all inside the closed Deploy disclosure. Help topics are grouped under **Start here / Everyday tasks / Reference / For developers**, so `templates/strongman/blocks/*.json` sits where it belongs.

## Findings

**R11-1 · 4 and 10 · major · strongman · `#/e/d-helmsdale` at 1440×900, inspector → Photo row** `.list-rows` (`studio.css:303`) is `display: grid` with a gap and **no column track** — the same defect R10-3 fixed on `.tpl-shell`, one rule below it in the same file. Its single implicit column therefore sizes to `max-content`, and the intrinsic width of a long item label wins over the inspector. Measured: the `.field` holding **Images** is `416/306`; `.list-rows`, `.list-row` and `.list-row-head` all span **x 1119 → 1536**, i.e. 96 px past a 1440 px window. The row's remove button (`button.icon-btn` "✕") sits at **x 1495–1527 — entirely off screen**, and `button.tree-add` "＋ Add item" ends at 1536 so only its left half is visible. `document.documentElement.scrollWidth` is **1440**: nothing scrolls, so neither control can be reached at all. `.lr-label` already carries `text-overflow: ellipsis` (`studio.css:307`) but it never applies, because its flex parent lives in a max-content track. Reproduced on screenshot. It does not fire on automatic's three documents or on strongman `#/e/d-home` only because those list labels are short — the Hero slider's five slides fit — so it is data-dependent, not site-dependent, and every long image alt text triggers it. Fix: `.list-rows { grid-template-columns: minmax(0, 1fr) }` plus `.list-row, .list-row-head { min-width: 0 }`. Built in `fields.js:338` (`h('div.list-rows', …)`).

**R11-2 · 4 · minor · both · any editor → Restore points** R10-5 is fixed for the accessible name but the *visible* rows are unchanged: on `#/e/d-home` the ten rows read "Saved at 03:29 · 4h ago" ×3 and "Saved at 03:28 · 4h ago" ×7 (`editor.js:1364–1366`). A sighted persona choosing which version to bring back is offered seven identical rows and a sub-line ("4h ago", same date) that does not separate them either. The ordinal already exists in `ordinal()` and is already in the `aria-label`; put it in `.row-label` too ("2nd restore point · saved at 03:28"), or add the author, or drop to seconds.

**R11-3 · 9 · minor · both · `#/plugins/nope`** Every other stale address in this studio is answered by name — `#/wat` → "Nothing lives at #/wat", `#/e/ghost` → "That page no longer exists… the link is just out of date", `#/c/nosuch` → "There is no content type called “nosuch”" and then lists the real ones. `#/plugins/nope` instead renders the **Apps index unchanged**, with the bad hash still in the address bar and no `[role=status]`, `[role=alert]`, `.notice` or toast anywhere on the page. A person who bookmarked an app panel that has since been switched off is told nothing; they see a list and assume they mis-clicked. Give the unknown panel the same sentence the unknown content type gets, naming the panel and the apps that do exist.

**R11-4 · 3 and 12 · minor · both · `#/help`** The four captions that partition the topic list — "Start here", "Everyday tasks", "Reference", **"For developers"** — are bare `<div class="help-group">` with no `role`, no heading level and no `role="group"`/`aria-labelledby` around the buttons they head. A screen-reader or keyboard user tabbing the column meets **27 undifferentiated buttons**; "Blocks and templates" and "Navigation internals" arrive with nothing to say they are the developer set, and their bodies then read `templates/strongman/blocks/*.json + .liquid` and `site/overrides → sites/*/templates/strongman`. The rail solves exactly this problem one panel to the left with `button.side-title[aria-expanded]`, so the pattern already exists in the codebase. Make each caption an `<h2>` (or `role="heading" aria-level="2"`) and wrap its buttons in a `role="group"` pointing at it.

## What each sub-95 category needs

**4 → 88 and 10 → 88:** R11-1 is the cap trigger for both — a clip that crosses the window edge *and* a control that cannot be reached. It is one grid-track declaration on `.list-rows` (`studio.css:303`), the same one-liner that fixed `.tpl-shell` last round. With it done, category 10 has nothing left (one card pattern, one badge system, zero contrast failures in either theme on 28 page-visits, no ghosts in the previews I opened) and is 95; category 4 then needs R11-2 as well to reach 95.

**3 → 93:** R11-4 only. The language, the grouping, the `?` sheets and the empty states are all right; the group captions just need to be headings.

**9 → 93:** R11-3 only. Everything else — the unsaved guards, the two-site host, the toasts, the validation, the three other stale bookmarks — answered correctly.

**12 → 93:** R11-4 and R11-2. With those two done I could not find an unnamed, unreachable, mis-structured or ambiguously-named control anywhere on either site: the tree is correct, focus is visible, Escape closes only the top layer, the palette keeps one active row, and every icon button on 36 hashes has a real name.

**11 → 94:** no defect I could find. The 1024 default shows the whole canvas, the floating-panel caption is still there, the readability floor steps the preview down rather than shrinking text, and no consent banner or studio chrome leaked into a preview. 95 needs a device-mode and mobile-drawer pass below 768 px, which this round's brief does not cover.

**1, 2, 5, 6, 7, 8 at 95–96:** clean this round. The remaining gap to 100 is that I exercised them without changing real data — I did not invite a person, switch an app on, or complete a publish.
