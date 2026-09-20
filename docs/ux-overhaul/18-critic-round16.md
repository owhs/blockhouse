# Critic — round 16

Average: 94

Method: my own tab, signed into both studios as `critic@local.test`, `localStorage.clear()` per origin before judging defaults. 1440×900 sweep of every rail hash on both sites (strongman 20 + `#/c/nope`, `#/plugins/nope`, `#/nowhere`; automatic 17 + the same three), each probed for controls with no accessible name, truly nested interactive elements (`a[href],button,input,select,textarea,[role=button],[role=switch]` inside one another), leftover `.spin`, elements past the viewport edge and `documentElement.scrollWidth`. 1024×768 editor, 390×844 People/SEO/dashboard/drawer, 1920×1080 dashboard — every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Seven documents opened (strongman `d-car-lift-buying-guide`, `d-about`, `d-bonar`, `d-jzm`; automatic `p-tower-parking-system`, `d-planning`, `d-services`, `d-downloads`, `p-shuttle-parking-system`, `s-hotels`). Six `?` sheets, ⌘K, block picker (49 entries, 49 descriptions), Settings search, the settings guard with **real** typing and a **real** rail click, restore points, dialog stacking and Escape with real key events, both studio themes measured for contrast on three pages each (oklch converted through a canvas), device modes, mobile drawer, 1920 centring. **Data-changing flows completed on real data:** an account invited and then disabled on automatic; the File delivery app switched on and back off on strongman; a real title edit → Save → Republish → revert → Republish on automatic `d-downloads`, verified against the served HTML; six no-edit Saves. Everything I dirtied was republished — both dashboards are back to their pre-round needs-attention sentences (strongman "1 page and 1 project", automatic "1 page and 1 system"). The one leftover is `r16probe@local.test`, disabled, on automatic.

Harness caveats, so the next round does not chase them: (a) a programmatic `element.click()` on a rail link **bypasses the settings guard** — with a real mouse click the guard fires correctly, so this is a tool artifact, not a studio bug; (b) `computer{key}` still synthesises insertions but not `Backspace`; (c) the pane scales the emulated viewport, so `computer` coordinates must be multiplied by (frame width ÷ emulated width).

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 96 | — |
| 4 | Editor: layout, outline, inspector | 88 | R16-1 |
| 5 | Editor: block model & width | 96 | — |
| 6 | Dashboard & content lists | 89 | R16-1 |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 94 | — |
| 9 | Feedback, errors, resilience | 89 | R16-1 |
| 10 | Visual consistency & polish | 96 | — |
| 11 | Preview fidelity & responsiveness | 95 | — |
| 12 | Accessibility & keyboard | 93 | — |

Blockers 0 · majors 1 · minors 3.

## Round-15 re-test

**R15-1 — not fixed.** Narrowed, not closed. See R16-1.

**R15-2 — fixed.** Strongman `#/plugins`. Switched **File delivery** on: badge "Starts after restart", banner "Waiting for a restart: File delivery…". Switched it straight back off: badge `""`, banner `""`, and after a full reload still no badge and no banner. `views.js:793` now derives pending from `!!p.state.enabled !== !!p.running` instead of a stored list, and `/plugins` serves `running` per app. The two toasts are right too — "Switched off. It was not running anyway, so there is nothing else to do."

**R15-3 — fixed.** `#/users` and `#/seo` at 390×844 on strongman: `documentElement.scrollWidth` 390, `.data-table.cards-sm` is `display:block` at 361 px (People) and 319 px (SEO) inside its wrapper, `thead` collapsed to 1 px, and every row is a card with visible ROLE / LAST SIGN-IN / STATUS labels above each value — the role select and the "Can sign in" switch are both on screen without scrolling sideways. Zero elements past the edge.

**Round-15 "verified working" re-check: holds.** 46 rail hashes across both sites at 1440: zero controls without an accessible name, **zero** nested interactive elements, zero `.spin`, `scrollWidth === 1440`, and the only element past the right edge is `#/tpl`'s own code scroller. Unknown routes still excellent. Six `?` sheets are plain English and open focused on "Close panel"; Escape closes them. ⌘K "tower" → the two systems first, then images, exactly one `aria-selected`, `aria-activedescendant=pal-opt-0`. Settings guard with a real click: `:modal` "Unsaved settings · You have unsaved settings. Leave without saving?", focused on Cancel; Discard left `/api/settings` untouched. Settings search "content types" lands on the Content types row. Block picker 49 entries, all with a sentence; Escape closes it. One width vocabulary (Template default (Normal) / Narrow / Normal / Wide / Page width / Edge to edge). Editor at 1024 parks both panels (`visibility:hidden`, `aria-pressed=false`) and the Settings panel floats with the caption "The Settings panel is floating over the page — close it to see the whole page"; one Escape closes it. Previews carry no consent banner; device modes are captioned ("Phone width — 390px, shown full size"). Mobile drawer opens, moves focus inside, closes on Escape and returns focus to the toggle. 1920 dashboard centred (527→1625 inside main 232→1920). Activity is written in sentences with no raw keys. Deploy keeps developer detail behind "Technical details (for developers)". Both studio themes: worst text contrast measured 5.35:1 (dark, Settings example line) and 6.0:1 (light) — comfortably above 4.5:1. The invite flow is strong: focus lands on Email, roles carry plain blurbs, and the credentials step says the password is shown only once. Disabling an account gives "r16probe can no longer sign in — they were signed out of the studio" and repaints the row to "Cannot sign in".

## Findings

**R16-1 · 4, 6, 9 · major · both sites · editor, published documents whose first block is a richtext/stage/section-with-width** Open a published document, change nothing, press **Save**. On strongman `d-about` and `d-car-lift-buying-guide`, and on automatic `d-planning` and `d-services`, the status flips "Published" → "Published · edited", the button becomes "Republish", `version` goes 1 → 2, a restore point is created, an Activity row "Saved “About”" is written, and the dashboard needs-attention count rises (automatic went from "1 page and 1 system" to "3 pages and 1 system"). The persona is told to republish a page nobody edited. The round-15 fix is real but incomplete: `storage/content.ts:284` `docFingerprint(prev) === docFingerprint(doc)` works — pressing Save a **second** time is a true no-op (version stayed 2), and documents whose selected block does not reach the width branch are clean on the first Save too (`d-bonar`, `p-shuttle-parking-system`, `s-hotels` all stayed "Published" at version 1). The residual cause is in the editor, not storage: `src/assets/admin/editor.js:1003` `found.node.layout = found.node.layout || {}` **mutates the document while merely rendering the inspector**, so the default-selected block silently gains `layout: {}` and the serialised document genuinely differs from the stored one. I diffed the PUT body against the stored doc: the only change is `"layout": {}` on the selected block. Fix: do not write `layout` into the node on render — read it with a local default and only assign when the owner actually changes the width field (or strip empty `layout` objects in `docFingerprint`/`saveDoc`). `src/assets/admin/editor.js` around line 1003.

**R16-2 · 4 · minor · both sites · editor → "Restore points for this page"** On automatic `p-tower-parking-system` the dialog lists nine entries reading "1st restore point · saved at 03:28", "2nd restore point · saved at 03:28" … all with the same clock time and the same "5h ago". There is nothing to choose between them, so the only safe move is not to restore at all. Give each entry something the owner can recognise — the action that made it (Saved / Published), the title at that moment, or "no visible change" — and collapse runs made inside the same minute. `src/assets/admin/editor.js`, the restore-points dialog.

**R16-3 · 12 · minor · both sites · editor preview toolbar and the 390-width topbar** Two toggles expose their state only as a CSS class. The device-mode buttons are `aria-label="Preview at desktop/tablet/mobile width"` with `class="active"` on the current one and **no** `aria-pressed` or `aria-current`; the mobile navigation button is `aria-label="Menu"` with **no** `aria-expanded`, unchanged after the drawer opens. Sighted users see both states; a screen-reader user hears three identical buttons and a menu button that never says whether the menu is open. Add `aria-pressed` to the device group and `aria-expanded` to `.nav-toggle`. `src/assets/admin/editor.js` (preview toolbar) and the shell's `.nav-toggle`.

**R16-4 · 8 · minor · both sites · `#/users`, your own row** Your own "Can sign in" switch is `disabled` — correct, you should not be able to lock yourself out — but it renders greyed as though it were off, its wrapper still reads `title="Can sign in — click to stop them signing in"`, and nothing on screen says why it will not move. On the 390 card layout this is worse, because the greyed switch sits directly under the word STATUS. Show the own-row state as plain text ("Can sign in — this is you") instead of a dead control, or keep the switch and replace the title with the reason. `src/assets/admin/views.js`, the `users` view row builder.

## What each sub-95 category needs

**4, 6 and 9 → 95.** All three are held by R16-1 and nothing else; category 4 also carries R16-2. Editor layout, outline, default selection, panel toggles, Page/SEO tabs, dialog stacking, the 1024 parking and the layered Escape all behave; the dashboard's needs-attention sentence, New menu, type-aware columns and filters are right; the guards, unknown routes, toasts and validation are right. Stop the inspector writing `layout: {}` on render and all three are clean.

**8 → 95.** People, the invite and credentials flow, the disable toast, the hidden capability keys, the pending-restart logic and an Activity log written in sentences are all strong. Only R16-4 remains.

**11 → 95.** Previews, device captions, 1024 parking, 1280, the mobile drawer, 1920 centring and the new phone card layouts are all clean; the score is held only by R16-1's "Published · edited" appearing in the editor chrome.

**12 → 95.** Zero nested interactive elements, zero unnamed controls, focus visible, Escape layering correct, one active palette row, focus returned on drawer close. Add the two missing ARIA states (R16-3).
