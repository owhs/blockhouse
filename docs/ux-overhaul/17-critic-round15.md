# Critic — round 15

Average: 93

Method: my own tab, signed into both studios as `critic@local.test`, `localStorage.clear()` per origin before judging defaults. 1440×900 sweep of every rail hash on both sites (strongman 21 incl. `#/p/forms`, `#/plugins/nope`, `#/c/nope`, `#/nowhere`; automatic 21), each hash probed for controls with no accessible name, nested interactive elements, leftover `.spin`, elements past the viewport edge and `documentElement.scrollWidth`. Editor at 1024×768 and 1440; dashboard, Lifts, People, Apps, Activity, SEO and Settings at 390×844; dashboard at 1920×1080 — every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Six documents opened (strongman `d-glenfinnan`, `d-bonar`, `d-home`, `d-jordan-racing-team-2`; automatic `d-about`, `d-home`, `p-tower-parking-system`). Five `?` sheets read in full, ⌘K, block picker (49 entries), Settings search, the settings guard with real typing and a real rail click, both studio themes on three pages, site switcher, device modes, mobile drawer. **Data-changing flows completed on real data:** an account created and then disabled on automatic People; the Forms app switched on and back off; three publishes and five saves across both sites, each verified against the live HTML `<title>`; Activity re-read afterwards. Everything I changed was put back — titles reverted, both documents republished, the Forms app returned to off, the restart banner cleared, the needs-attention card back to its pre-round `1 page and 1 project`. The one leftover is `r15probe@local.test`, disabled, on automatic.

Caveat on the harness, so the next round does not chase it: the pane's `computer{key}` synthesises *insertions* but not deletions — `Backspace` deletes nothing in **any** input, including the ⌘K palette, so it is a tool artifact and not a studio bug. Real edits were driven with `setSelectionRange()` + `computer{type}`; `Escape` and arrow keys are honoured (`ArrowDown`, not `Down`).

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 96 | — |
| 4 | Editor: layout, outline, inspector | 88 | R15-1 |
| 5 | Editor: block model & width | 96 | — |
| 6 | Dashboard & content lists | 89 | R15-1 |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 89 | R15-2 |
| 9 | Feedback, errors, resilience | 88 | R15-1 |
| 10 | Visual consistency & polish | 95 | — |
| 11 | Preview fidelity & responsiveness | 94 | — |
| 12 | Accessibility & keyboard | 95 | — |

Blockers 0 · majors 1 · minors 2.

## Round-14 re-test — all four fixed

**R14-1 — fixed.** `#/plugins`, both sites. I opened all 17 "What it can do" disclosures and all 17 "Limit what it may do (advanced)" panels: 106 `code.perm-key` pills exist and **0 are visible**. Each panel leads with a `Show technical details` checkbox (`views.js:861`, `hidden: true`); ticking it revealed exactly the 9 keys in that panel, unticking hid them again. The permission sentences alone are what the persona reads.

**R14-2 — fixed.** `api.ts:419` now skips the `content.saved` row when the editor's pre-publish save carries `?publishing=1`, and `editor.js` `save(explicit, publishing)` sets it. Measured: audit length 29 before a real Republish on `d-glenfinnan`, 30 after — **exactly one row**, `content.published`. The `content.saved` row above it was my own typing a minute earlier, correctly its own action.

**R14-3 — fixed.** Strongman `#/audit`, oldest row now reads **"Changed an account"**. `audit.js:60` falls back to that sentence when `userName` is missing instead of the old "Changed the account for an account".

**R14-4 — fixed.** Editor at 1024×768, real key presses. Settings panel open, caption "The Settings panel is floating over the page — close it to see the whole page": one Escape closes it. Stacking is right too — with Restore points open above the panel, the first Escape closed only the dialog (panel still on), the second closed the panel.

**Round-14 "verified working" re-check: holds.** 42 rail hashes across both sites at 1440: zero unnamed controls, zero nested interactive elements, zero `.spin`, `scrollWidth === 1440`; the only element past the edge is `#/tpl`'s own code scroller. Unknown routes still excellent (`#/edit/…` → "Nothing lives at #/edit", `#/c/nope`, `#/plugins/nope`, `#/nowhere`). Five `?` sheets are plain English and open focused on "Close panel". ⌘K "tower" → the system first, then images, exactly one `aria-selected`, `aria-activedescendant=pal-opt-0`. Settings guard: real typing raised "You have unsaved changes · Discard · Save changes"; a real click on the SEO rail item raised a `:modal` "Unsaved settings … Leave without saving?" focused on Cancel; Discard dropped the edit. Settings search "content types" lands on `#/settings/content` and flashes the card. Block picker 49 entries, every one a sentence. One width vocabulary (Template default (Normal) / Narrow / Normal / Wide / Page width / Edge to edge) on all three automatic documents; nested blocks get "Width: set by the Section around it — Normal · Select the Section", which is better than hiding the field. Tree keyboard nav moves selection one row at a time with one `.selected`. Mobile drawer opens, traps focus, closes on Escape and returns focus to the toggle. 1920 dashboard centred (580→1572 inside main 232→1920). Previews carry no consent banner; device modes are captioned ("Phone width — 390px, shown full size"). Deploy keeps developer detail behind "Technical details (for developers)". The switcher disambiguates the two identically-named sites by folder and domain. `PUT`/`POST` from a page script are refused 403 — the write guard is real. Save gives feedback: `.save-state` goes "Saving…" → "Saved" with a `Saved at 08:29:56 · restore point at…` title.

## Findings

**R15-1 · 4, 6, 9 · major · both sites · editor, any published document** Open a published document and change nothing. Press **Save**. The status flips to "Published · edited" and the button to "Republish"; the dashboard then counts the document under "have changes that are not on the website yet"; Activity gains a "Saved “…”" row; Restore points gains another entry. Nothing was edited. Reproduced cold on strongman `d-bonar` (untouched, straight from a reload: status "Published" → "Published · edited", dashboard went from "1 page and 1 project" to "2 lifts, 1 page and 1 project") and again on automatic `d-about` — five consecutive identical "Saved “About”" rows in Activity and six restore points inside one minute, each labelled only "Nth restore point · saved at 08:29", so the persona cannot tell them apart either. Cause: `content.saveDoc` bumps `version` on every write, and `storage/content.ts:304` `hasUnpublishedChanges` compares `pub.version !== doc.version` — a version number, not content. The persona is told to republish a page that is already live, and is sent to the dashboard's needs-attention list for work that does not exist. Fix in `saveDoc`: leave the version (and the snapshot, and the `content.saved` audit) alone when the serialised document is byte-identical to what is stored; or compare content in `hasUnpublishedChanges`. `src/storage/content.ts`, with `src/server/api.ts:419`.

**R15-2 · 8 · minor · both sites · `#/plugins`** Switch an app on, then switch it straight back off. Its running state is now exactly what it was, but the card keeps the "Starts after restart" badge and the page keeps the "Changes take effect after a restart — ask whoever hosts your site" banner, and both survive a reload (`blockhouse-studio-prefs` → `pendingPlugins: ["forms"]`). Verified on automatic Forms: `enabled: false` on the server, badge still "Starts after restart". The persona is told to go and ask their host for a restart that will change nothing, and the only way out is to press "It has been restarted" — a claim that is not true. `views.js` `pendingPlugins()` / `paintPending()` should remember the state the running site was loaded with and drop the app from the pending list when the switch returns to it.

**R15-3 · 11 · minor · both sites · `#/users` and `#/seo` at 390×844** The page itself never scrolls sideways (`scrollWidth` 390) — `.table-wrap` correctly keeps its own `overflow-x: auto`. But `.data-table` is 858 px inside a 361 px wrapper, so on a phone the Status column and the "Can sign in" switch — the two things you open People on a phone to check — are two-thirds of a screen off to the right, with no hint they are there. The dashboard's `.row-item` cards reflow properly at this width; People and the SEO page list should do the same below ~600 px rather than staying a wide table.

## What each sub-95 category needs

**4, 6 and 9 → 95.** All three are held by R15-1 alone and nothing else. Editor layout, outline width, default selection, toolbar, panel toggles, Page tab, restore-point dialog, dialog stacking, the 1024 parking and the layered Escape all behave; the dashboard's needs-attention sentence, New menu, type-aware columns and filters are right; the guards, 403 write protection, unknown routes, toasts and validation are right. Make a save that changes nothing a no-op and all three are clean.

**8 → 95.** People, the credentials card, the role blurbs, the hidden capability keys and an Activity log written in sentences are all strong now. Clear the pending marker when a switch returns to where it started (R15-2).

**11 → 95.** Reflow the People and SEO tables into cards below ~600 px (R15-3). Everything else — previews with no consent banner, device modes, 1024 parking, 1280, the mobile drawer, 1920 centring — is clean.
