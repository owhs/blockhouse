# Critic — round 18

Average: 95

Method: my own tab, `localStorage.clear()` per origin before judging defaults, signed into both studios as `critic@local.test`. Full 1440×900 rail sweep on both sites (strongman 20 hashes + `#/c/nope`, `#/plugins/nope`, `#/nowhere`; automatic 17 + the same three), each probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the right edge (visibility-filtered) and `documentElement.scrollWidth`. 390×844 on five views per site, 1024×768 editor, 1920×1080 dashboard — every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Documents opened: strongman `d-bonar`, `d-about`, `d-helmsdale`; automatic `p-tower-parking-system`, `d-about`, `d-services`. Six `?` sheets, ⌘K on both sites, the block picker (50 buttons, 49 entries, every one with a sentence), the settings guard with real typing and a real rail click, restore-point dialogs on three documents, both studio themes measured for contrast on three pages per site (oklch through a canvas, alpha layers composited), tree keyboard nav and roving tabindex with real key presses. **Data-changing flows completed on real data:** the title edit-and-exact-restore on strongman `d-bonar` and automatic `d-about` (value compared character-for-character against the original before judging); a no-edit Save on strongman `d-about`; Analytics switched on and back off on strongman; `r18probe@local.test` invited and then disabled on automatic; a real ⌘S → Republish → revert → Republish cycle on automatic `d-about`. Everything I dirtied is restored: both dashboards read their pre-round sentences, and `d-about`/`d-bonar` hold their original titles. Leftover: `r18probe@local.test`, disabled, on automatic.

Harness caveats unchanged: synthetic `keydown` Escape does not close `<dialog>`s or the mobile drawer, so every Escape claim below was made with a real key press; `computer{key}` still cannot synthesise Backspace, so exact restores were done by selecting the field's whole value and typing the original over it.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 93 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 97 | — |
| 4 | Editor: layout, outline, inspector | 89 | R18-1 |
| 5 | Editor: block model & width | 97 | — |
| 6 | Dashboard & content lists | 96 | — |
| 7 | Site tools | 96 | — |
| 8 | Studio admin | 96 | — |
| 9 | Feedback, errors, resilience | 92 | — |
| 10 | Visual consistency & polish | 96 | — |
| 11 | Preview fidelity & responsiveness | 97 | — |
| 12 | Accessibility & keyboard | 96 | — |

Blockers 0 · majors 0 · minors 4.

## Round-17 re-test

**R17-1 — fixed.** ⌘K on strongman for "car parking" returns "Car Parking & Vehicle Lifts UK · / · **Published · edited**" beside four plain "Published" rows. `search.js` now carries its own `statusLabel`, stale-aware and kept in step with `statusChip`, including "Scheduled · 12 Sep" and "In review".

**R17-2 — fixed, the major is gone.** On strongman `d-bonar` I clicked into the title, typed a stray run of characters, let autosave write, then selected the whole value and typed the original back — verified `value === "The Bonar: Four Post Car Parking"` exactly. The chip went "Published · edited" → **"Published"**, the button went Republish → Published, `stale` returned `false`, and the dashboard's needs-attention sentence stayed "1 page has changes that are not on the website yet" (the pre-existing `d-home`), with `d-bonar` absent. Identical result on automatic `d-about` ("Aboutq" → "About"): chip back to Published, `stale: false`, dashboard still "1 page and 1 system". `hasUnpublishedChanges` now compares `publishFingerprint(pub)` with `publishFingerprint(doc)` instead of version numbers.

**R17-3 — mostly fixed.** Ordinals are gone; the newest group is "Latest" and the rest are named by clock time. Same-minute runs fold whether or not they are identical, so `p-tower-parking-system` — the doc in the finding — now opens as three readable rows instead of ten. On strongman `d-helmsdale` the expanded rows carry the title at the time and "no visible change", which is exactly what was asked for. The residual is R18-2.

**R17-4 — fixed.** "Restore points for this **lift**" on `d-helmsdale`, "Restore points for this **system**" on `p-tower-parking-system`, button `title` and `aria-label` both.

**R17-5 — fixed.** The own row's role cell is plain text "Owner — this is you" beside "Can sign in — this is you". A sweep of `#/users` on both sites found **zero** disabled controls of any kind.

**Round-17 "verified working" re-check: holds.** 40 rail hashes across both sites at 1440: zero controls without an accessible name, zero nested interactive elements, zero `.spin`, `scrollWidth === 1440` everywhere, and the only elements past the right edge are `#/tpl`'s code surface (which does scroll — the textarea inside drives it) and, at 1024, the parked `.inspector` (`visibility: hidden`, zero focusable descendants). Unknown routes still excellent, and a deleted document now gets its own view ("That page no longer exists · It may have been deleted. Nothing here is broken — the link is just out of date."). Six `?` sheets are plain, type-aware and count-aware ("Help with Lifts · Browse all 12 of your lifts", "Fix the 30 pages grouped under…"), open focused on Close panel, close on a real Escape and return focus to the trigger. Settings guard: real typing in Tagline then a real click on the Activity rail gave "Unsaved settings · You have unsaved settings. Leave without saving?" focused on Cancel; Discard navigated and left `/api/settings` byte-identical. Block picker: 49 entries on automatic, every one with a sentence. One width vocabulary (Template default (Normal) / Narrow / Normal / Wide / Page width / Edge to edge), and a nested block's Layout section reads "Width: set by the Section around it — Normal" with a "Select the Section" jump — the best thing in the editor. Device captions: "Tablet width — 834px, shown at 73%", "Phone width — 390px, shown full size", and at desktop "Shown narrower to keep text readable · hide a panel for desktop width". No consent or cookie nodes in any preview. Apps: Analytics on gave "Switched on. It starts working after the site is next restarted — ask whoever hosts your site."; off gave "Switched off. It was not running anyway, so there is nothing else to do."; a reload showed it off with no banner. Invite lands focus on Email, roles carry plain blurbs, credentials say the password is shown once; disabling flipped the row to "Cannot sign in". Publish dialog reads "Republish changes · "About Us" will go live at /about", focuses Publish now, and toasts "Published — it is live now". Deploy keeps everything technical inside "Technical details (for developers)"; a regex sweep for twenty developer terms across every rail page of automatic returned **nothing** outside `<details>`. Worst measured text contrast: 5.28:1 light / 4.52:1 dark on both sites. Tree: `role="tree"` labelled "Page outline", 1 of 28 items tabbable, real ArrowDown moves focus and selection, focus outline solid 2px.

## Findings

**R18-1 · 4 · minor · both sites · editor toolbar** On a published page with nothing to publish, the primary toolbar button reads **"Published"** — a state, not an action — and is fully enabled. The persona reads it as a status badge; nothing tells them it is clickable or what it would do. Clicking it (strongman `d-bonar`, no pending changes) opens a dialog headed **"Republish changes"** saying the page "will go live at /bonar", which asserts changes that do not exist — the very confusion R17-2 was fixed to remove, now moved into the dialog. Either disable the button with a short reason, or label it for the action it performs ("Publish again") and head the dialog honestly when `stale` is false. `src/assets/admin/editor.js:1645` (`renderActions`) and `publishFlow` at line 1556.

**R18-2 · 4 · minor · automatic · editor → "Restore points for this system"** Residual of R17-3. `p-tower-parking-system` groups correctly into "Latest · 6 saves at 03:28", "6 saves at 03:27" and one older row, but expanding a group gives six rows all reading "Saved · Tower Parking System / Saved at 03:28" with nothing to choose between. `noteOf` only marks a row when its stored `fingerprint` equals the next one's; these versions carry no fingerprint, so every row comes out bare. Fall back to a stored size or block count when the fingerprint is missing, or say "made before this studio recorded what changed". `src/assets/admin/editor.js` around line 1443.

**R18-3 · 1, 9 · minor · both sites · topbar and tab title** Both studios show "Strongman Lifts" in the topbar and "Strongman Lifts · Blockhouse Studio" as the browser tab title, because both sites carry that name. The switcher handles it beautifully — "Strongman Lifts · the strongman folder · strongmanlifts.co.uk" against "Strongman Lifts · the automatic folder · www.strongmanlifts.co.uk · You are here" — but the chrome does not, so with both open the owner cannot tell which studio a tab is, and the rubric's two-sites-on-one-host case is exactly this. Carry the same folder or domain hint into the topbar label and `document.title`.

**R18-4 · 1 · minor · both sites · unknown routes** `#/edit/d-bonar` (a plausible hand-typed or stale address) renders "Nothing lives at **#/edit**" — the address is truncated at the first segment, so the sentence does not match what the owner pasted. `#/nowhere` is correct because it has one segment. Echo the whole hash.

## What each sub-95 category needs

**4 → 95.** Layout, outline, default selection, toolbar, panel toggles, the 1024 parking, dialog stacking, Escape, restore-point grouping and the type-aware wording are all right. R18-1 is the whole gap — it trips the "a control whose purpose needs hovering to learn" cap, and R18-2 sits behind it.

**1 → 95.** Rail sections, names, badges, user menu, ⌘K and the three unknown-route views are strong. R18-3 and R18-4.

**9 → 95.** 401 handling, toasts, validation, the settings guard, the unknown-panel view and the deleted-document view all behave. Only the two-sites-on-one-host ambiguity (R18-3).
