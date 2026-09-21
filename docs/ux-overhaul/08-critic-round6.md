# Critic — round 6

Average: 88

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus every rail page at 1024×768 and the dashboard at 1920×1080 and 390×800. Every rail page on both sites (strongman 8792, automatic 8793). Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`, `#/e/d-jzm`; automatic `#/e/d-home`, `#/e/d-about`, `#/e/p-tower-parking-system`. Settings guard exercised with **real clicks and real keystrokes** into Site name (the field went dirty and the sticky bar appeared, so the edit was genuine), Cancel and Discard both taken, on both sites. ⌘K "seo"/"menu" on both sites; `?` help on seven screens; light and dark on dashboard/settings/editor; block picker (53 entries); device segment measured through the iframe's own `innerWidth`; Publish opened and cancelled; stale bookmarks `#/e/nonexistent`, `#/c/nonexistent`, `#/wat`; every checkbox on Settings → Advanced enumerated by accessible name.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 86 | Discard leaves the address on the new page and the old screen on show; that rail item is then unclickable |
| 2 | Settings organisation | 93 | — |
| 3 | Help & guidance | 95 | — |
| 4 | Editor: layout, outline, inspector | 94 | — |
| 5 | Editor: block model & width | 95 | — |
| 6 | Dashboard & content lists | 93 | — |
| 7 | Site tools | 93 | — |
| 8 | Studio admin | 86 | 16 app switches and every person's account switch say what they do only in `title=` |
| 9 | Feedback, errors, resilience | 58 | The unsaved-settings guard's Discard does not take you anywhere |
| 10 | Visual consistency & polish | 88 | Inline layout styles on the Deploy cards |
| 11 | Preview fidelity & responsiveness | 94 | — |
| 12 | Accessibility & keyboard | 80 | ~21 live controls with no accessible name; 22 icon buttons named only by `title` |

Blockers 1 · majors 2 · minors 4.

## Round-5 re-test

**Fixed (9 of 10).**
R5-1 — the guard dialog now survives the echo hashchange (`ui.js:260` sets `dataset.guard`, `ui.js:294 confirmDialog({guard})`). Measured with a MutationObserver: opened once and stayed until clicked. Cancel keeps you on Settings with the typed edit intact; the sticky Discard reverts the field and then lets you leave. **But Discard inside the dialog is still broken — see R6-1.**
R5-2 — `#/media` on strongman paints in full (118 KB of DOM, no `.spin`) at 1440 and 1024, and carries its `?` button.
R5-3 — all 46 checkboxes on `#/settings/advanced` have an accessible name ("Give search engines a page list", "Hide Apps from editors", …). Settings search for "robots" lands focus on a named checkbox with the row flashed.
R5-4 — `#/types` "Brand variables" is now a documented reference list (`<li><code>{{var.company}}</code><span class="mut"> Company name</span></li>`) under "Type `{{var.phone}}` in any text and it fills in". No bare ✕ buttons.
R5-5 — desktop/tablet/mobile now give three different previews at 1440 with both panels open: 1024 CSS px at `scale(0.617)`, 834 at `scale(0.734)`, 390 unscaled.
R5-6 — `<button class="top-site site-switch" aria-label="Switch site" aria-haspopup="dialog">` with a visible "Switch" word.
R5-7 — the second entry reads "Open its studio · now at localhost:8793" and links to `http://localhost:8793/admin/`.
R5-8 — "That page no longer exists… Go to All content"; "There is no content type called “nonexistent”" over the five real types; "Nothing lives at #/wat".
R5-9 — ⌘K "seo" returns 3 exact rows with one active row (was 21); both list help sheets now say "narrows them down **by status** (draft, published, waiting for review)"; `#/seo` has 7 Fix links, each `aria-label="Fix: Contact Us — No short description for search results"` (was 91 identical).
R5-10 — the Map tile has a drawn icon; all 53 picker entries have an icon and a one-line description, no `.ico-txt` stub anywhere.

**Round-5 "verified working" re-check:** all held. Outline 240 / canvas 632 / inspector 336 on all six documents, no horizontal scroll on any page of either site at 390, 1024, 1440 or 1920, `.main-pad` 1152 px centred at 1920, Escape closes the top-most layer only (picker over editor, publish dialog over editor) and never leaves the editor, Publish names the document and its address and focuses "Publish now", light studio applies cleanly on dashboard/settings/editor, help sheets on seven screens with correct live counts ("all 8 of your pages", "all 12 of your lifts", "the 30 pages grouped under…"), Apps capabilities in plain English with the raw permission keys kept inside a closed "Limit what it may do (advanced)" disclosure.

## Findings

**R6-1 · 9/1 · blocker · both · `#/settings` → type into Site name → click any rail item → Discard** The dialog asks "You have unsaved settings. Leave without saving?"; press Discard and `location.hash` becomes the target (`#/` on strongman, `#/deploy` on automatic) while the Settings screen stays painted and the rail still highlights Settings. Still true after 4 s. Clicking that same rail item again does nothing at all — the hash already matches, so no `hashchange` fires and the page is unreachable; only clicking a *different* rail item recovers (verified: `#/deploy` dead, `#/users` then worked). The persona answered the question correctly and is left looking at the screen they asked to leave, with one menu item permanently dead. Cause is the bookkeeping in `main.js` `onHashChange()`: on the accepted branch it sets `lastHash = target`, `restoring = true`, `history.replaceState(…, target)` and then `route(my)`, but the echo from the *first* `replaceState` (the one that put `from` back before asking) arrives after `lastHash` has moved, so it no longer matches the `restoring` test, bumps `navSeq`, and the real `route(my)` bails at `if (my !== navSeq) return`. Sequence the two replaceStates, or route from a stored token instead of `navSeq`.

**R6-2 · 8/12 · major · both · `#/plugins`, `#/users`** Every on/off switch built as `h('label.switch', { title: … }, input, span.switch-track)` has an empty accessible name and no visible word; its meaning lives only in the tooltip. 16 of these are the *primary* control of the Apps page (`views.js:863`, `title="Off — click to switch on"`), one per person is the STATUS column on People (`views.js:613`, `title="Active — click to disable"` — the only thing telling you a tick means "this person can sign in"), and the Automations recipe list repeats it (`views.js:1164`, `title="On"`). `settings.js:440` already solved this with `'aria-label': label`; apply the same there, and give the People column a word in the cell rather than a tooltip.

**R6-3 · 12 · major · both · `#/design`, `#/users`, `#/types`** Controls with no programmatic name: the three Design sliders (`design.js` ~200, `hue-track` plus the chroma and radius ranges) show only "275°", "0.160", "14px" to a screen reader — their visible captions "Main colour", "How strong the colour is", "Corner roundness" are not associated; the per-person Role `<select>` on People (`views.js:598 roleSel`) has neither label nor `aria-label`; and the 22 icon-picker buttons on `#/types` are named only by their raw glyph key (`title="page"`, `"pen"`, `"tag"`, `"folder"`…). Keyboard-only and screen-reader users get "slider", "combo box" and "page" where the sighted user reads a sentence.

**R6-4 · 10 · minor · both · `#/deploy`** Four cards are `<button class="card" style="text-align: left; padding: var(--s4); cursor: pointer; border-color: …">` — the only inline layout styles left in the studio outside dynamic values (the `padding-left` depth indents on `#/menus` and the `display:none` toggles are legitimate). Move to a `.card-action` class so the card pattern stays in one place.

**R6-5 · 1 · minor · both · ⌘K "menu"** The first three rows are right ("Main menu / Navigation", "Footer menu / Navigation", "Navigation"), but three more follow that contain no menu at all — "Message", "Residential developments", "Where it is used". The fuzzy matcher in `search.js` still scores loose letter runs; require a word-prefix hit before a scattered one.

**R6-6 · 9/12 · minor · both · the unsaved-settings dialog** Focus lands on **Discard**, the destructive choice — `ui.js` `dialog()` picks `kind === 'danger'` as the landing target — so Enter throws the work away. On a "do you want to lose this?" question the safe answer should hold focus.

**R6-7 · 1 · minor · both · site switcher** Both rows are titled "Strongman Lifts" and are told apart only by a raw registry folder key in brackets — "Strongman Lifts**(strongman)**", "Strongman Lifts**(automatic)**" — with no space before the bracket. Show the address or a chosen nickname instead (`main.js` ~590).

## What each sub-90 category needs

**1 → 86:** fix R6-1; a rail item that stops responding is a navigation bug, and R6-5/R6-7 are the cosmetic remainder.
**8 → 86:** fix R6-2 — until then the main switch on Apps and the account switch on People are controls whose purpose needs hovering to learn, which the rubric caps at 89.
**9 → 58:** R6-1 alone. Discard must repaint the target view (and R6-6 should move focus to Cancel).
**10 → 88:** R6-4 — remove the four inline layout style attributes on Deploy.
**12 → 80:** R6-2 and R6-3 — roughly 21 live controls with no accessible name plus 22 title-only icon buttons.

## Verified working (tried to break, could not)

Every rail page on both sites paints at 1440 and 1024 with no spinner left behind and no horizontal scroll at 390/1024/1440/1920; Assets on strongman renders 108+ files with its `?` button; the guard's Cancel preserves a real typed edit and the sticky Discard reverts it; three genuinely different device previews; 53 picker entries each with icon and description; Escape closes the top-most layer only; Publish names the document and its address, focuses "Publish now" and Escape cancels cleanly; all three unknown-route views explain themselves in plain words; ⌘K "seo" is exact with exactly one active row; 46 named switches on Settings → Advanced and Settings search landing on the right one; light and dark studio equally clean on dashboard, settings and editor with no element rendering text on its own colour; Apps capabilities in plain English with developer keys behind an "advanced" disclosure; help sheets on seven screens with live, correct counts.
