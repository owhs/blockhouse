# Critic — round 17

Average: 94

Method: my own tab, signed into both studios as `critic@local.test`, `localStorage.clear()` per origin before judging defaults. 1440×900 sweep of every rail hash on both sites (strongman 20 + `#/c/nope`, `#/plugins/nope`, `#/nowhere`; automatic 17 + the same three), each probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the viewport edge and `documentElement.scrollWidth`. 1024×768 editor, 390×844 People/SEO/dashboard/drawer on both sites, 1920×1080 dashboard — every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Documents opened: strongman `d-about`, `d-car-lift-buying-guide`, `d-helmsdale`, `d-bonar`; automatic `d-planning`, `d-services`, `p-tower-parking-system`, `d-about`. Nine `?` sheets, ⌘K on both sites, the block picker (49/54 entries, every one with a sentence), Settings search, the settings guard with **real** typing and a **real** rail click, restore-point dialogs on three documents, dialog stacking and Escape with real key events, both studio themes measured for contrast on three pages per site (oklch through a canvas, with alpha layers composited). **Data-changing flows completed on real data:** four no-edit Saves on the four documents named in the brief; Newsletter switched on and back off on strongman; `r17probe@local.test` invited and then disabled on automatic; a real title edit → autosave → Republish → revert → Republish on strongman `d-bonar` and automatic `d-about`. Everything I dirtied was republished — both dashboards are back to their pre-round sentences ("1 page and 1 project", "1 page and 1 system"). Leftovers: `r17probe@local.test`, disabled, on automatic.

Harness caveats unchanged: `computer{key}` still does not synthesise `Backspace`/`Delete`; a synthetic `keydown` Escape closes some layers but not `<dialog>`s, so every Escape claim below was made with a real key press.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 92 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 96 | — |
| 4 | Editor: layout, outline, inspector | 91 | — |
| 5 | Editor: block model & width | 96 | — |
| 6 | Dashboard & content lists | 89 | R17-2 |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 94 | — |
| 9 | Feedback, errors, resilience | 89 | R17-2 |
| 10 | Visual consistency & polish | 96 | — |
| 11 | Preview fidelity & responsiveness | 96 | — |
| 12 | Accessibility & keyboard | 95 | — |

Blockers 0 · majors 1 · minors 4.

## Round-16 re-test

**R16-1 — fixed.** The four documents named in the brief, opened and Saved with no edits: strongman `d-about` and `d-car-lift-buying-guide`, automatic `d-planning` and `d-services`. In all four the chip stayed **Published**, `/api/content/<id>/versions` still returned **one** entry (no restore point), and the Activity log gained **no** row — its newest entries are still round 16's. The stale lists are unchanged on both sites. `editor.js` now builds a local `const layout = { ...found.node.layout }` and deletes the key when empty instead of writing `layout: {}` onto the node while rendering.

**R16-2 — mostly fixed.** Restore points now carry the cause, the title at the time, and folding: strongman `d-helmsdale` reads "1st restore point · Saved · The Helmsdale… / Saved at 08:04 · 2 saves in the same minute · no visible change". But on automatic `p-tower-parking-system` — the exact doc in the finding — ten rows still read "Nth restore point · Saved · Tower Parking System / Saved at 03:28" with no differentiator, because folding requires an identical fingerprint. See R17-3.

**R16-3 — fixed.** The preview group is `role="radiogroup"` `aria-label="Preview width"` with three `role="radio"` children carrying `aria-checked` — the correct pattern, and ArrowRight moves both focus and selection. `.nav-toggle` at 390 is `aria-expanded="false"`, `"true"` once the drawer opens, back to `"false"` on Escape, with focus returned to the toggle.

**R16-4 — fixed.** Your own row's STATUS cell is now plain text "Can sign in — this is you"; there is no dead switch and no misleading `title`. One residual, R17-5.

**Round-16 "verified working" re-check: holds.** 43 rail hashes across both sites at 1440: zero controls without an accessible name (the handful my probe flagged were hidden nodes or nodes whose text it could not read — each inspected by hand and named), zero nested interactive elements, zero `.spin`, `scrollWidth === 1440`, and the only element past the right edge is `#/tpl`'s own code scroller. Unknown routes still excellent ("Nothing lives at #/activity · Did you mean one of these?"). Nine `?` sheets are plain English, type-aware ("Help with Systems", "Open a system by clicking its title"), open focused on Close panel and close on Escape. Settings: every visible input has a label; search lands on Content types; the guard fired on a real rail click with "Unsaved settings · You have unsaved settings. Leave without saving?" focused on Cancel, and Discard left `/api/settings` byte-identical. Block picker: 49 entries on automatic, 54 on strongman's richer set, every one with a sentence. One width vocabulary on both templates. Dialog stacking is right: with the picker open over the restore-points dialog, the first Escape closed the picker and the second closed the dialog and returned focus to its trigger. Editor at 1024 parks both panels (`visibility:hidden`, `aria-pressed=false`, not focusable) and the floating Settings panel carries its caption. Device captions read "Tablet width — 834px, shown at 92%", "Phone width — 390px, shown full size", "74% — the page is wider than the window"; no consent or cookie nodes in any preview. People and SEO at 390 on both sites: `scrollWidth` 390, nothing past the edge, card rows with visible labels. 1920 dashboard centred (527→805 heading inside main 232→1920). Apps: every switch named "Switch X on/off"; Newsletter on gave "Switched on. It starts working after the site is next restarted — ask whoever hosts your site." plus the banner, off gave "Switched off. It was not running anyway…" and a reload showed no badge and no banner. Invite lands focus on Email, roles carry plain blurbs, credentials say the password is shown once; disabling gave "R17 Probe can no longer sign in — they were signed out of the studio". Deploy keeps `dist` and friends inside "Technical details". Worst measured text contrast: 4.81:1 light / 4.52:1 dark (strongman), 4.81:1 / 4.52:1 (automatic) — all above 4.5:1.

## Findings

**R17-1 · 1 · minor · both sites · ⌘K results** Typing "tower" on automatic returns "Tower Parking System · /systems/tower-parking-system · **published**". That document is one of the two the same studio flags as having unpublished changes, and the palette is the fastest way the owner reaches it. Two problems in one string: the status is the raw lower-case key rather than the studio's own wording ("Published", "Published · edited", "Draft", "Awaiting review"), and it is not stale-aware, so it tells the owner a page is live when the live copy is older. `src/assets/admin/search.js:56` — `sub: \`${d.path} · ${d.status}\`` should use the same label function the lists use, fed by `d.stale`.

**R17-2 · 4, 6, 9 · major · both sites · editor → dashboard** Make an edit and then undo it, which is what a mistyped title looks like. On automatic `d-about` I appended a character, let autosave run, put the title back, and let autosave run again, then compared the stored document with the one I started from: **identical apart from `version` and `updatedAt`**. The chip nonetheless reads "Published · edited", the button becomes Republish, and the dashboard counts the page under "have changes that are not on the website yet". The same happened on strongman `d-bonar`. The owner is told to republish a page that matches the live one exactly, and the only way out is to republish it. The cause is `src/storage/content.ts:375` `hasUnpublishedChanges`, which returns `pub.version !== doc.version`; `docFingerprint` — already used two dozen lines away to make a no-op Save a true no-op — is the comparison this needs.

**R17-3 · 4 · minor · automatic · editor → "Restore points for this page"** `p-tower-parking-system` lists ten rows reading "Nth restore point · Saved · Tower Parking System / Saved at 03:28" — six of them share the same minute. The new folding only collapses rows with an identical fingerprint, so a run of genuinely different saves inside one minute still gives the owner nothing to choose between. Either show what changed (the block or field touched), or group a same-minute run under one expandable row. `src/assets/admin/editor.js` around line 1427. Smaller nit in the same list: "1st restore point" heads the **newest** entry, which reads backwards.

**R17-4 · 4, 7 · minor · both sites · editor toolbar** The button and dialog say "Restore points for this **page**" on a Lift and on a System. Every `?` sheet is type-aware in the same session ("Help with Systems", "Open a system by clicking its title"), so this one reads as an oversight. `src/assets/admin/editor.js` line 1795 onwards.

**R17-5 · 8 · minor · both sites · `#/users`, your own row** R16-4 fixed the switch but not its neighbour: your own Role dropdown is still `disabled` with no explanation, rendering as a greyed select showing "Owner". The STATUS cell beside it now explains itself ("Can sign in — this is you"); the role cell should do the same — plain text "Owner — this is you" rather than a control that will not move. `src/assets/admin/views.js`, the `users` row builder.

## What each sub-95 category needs

**6 and 9 → 95.** Both are held by R17-2 alone. The needs-attention sentence, New menu, type-aware columns, filters, status wording, import/export placement, the guards, unknown routes, toasts and validation are all right. Compare fingerprints instead of version numbers in `hasUnpublishedChanges` and both clear.

**1 → 95.** Rail sections, names, badges, topbar, user menu, site switcher and the 404 view are all strong. Only the palette subtitle (R17-1).

**4 → 95.** Layout, outline, default selection, toolbar, panel toggles, Page/SEO tabs, dialog stacking and the 1024 parking all behave. R17-3 and R17-4 are the whole gap.

**8 → 95.** People, invite, credentials, disable, hidden capability keys, pending-restart logic and a sentence-written Activity log are all strong. Only R17-5.
