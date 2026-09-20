# Critic — round 14

Average: 95

Method: own tab, signed into both studios as `critic@local.test`, `localStorage.clear()` per origin before judging defaults. 1440×900 sweep of every rail hash on both sites (strongman 19 + `#/plugins/nope` + `#/c/nope`; automatic 17 + `#/plugins/nope` + `#/c/nope` + `#/nowhere`), each hash probed for controls with no computed accessible name, nested interactive elements, leftover `.spin`, elements past the viewport edge and `documentElement.scrollWidth`. Editors at 1024×768 and 1280×800; dashboard, Lifts, People, Apps, Activity and SEO at 390×844; dashboard at 1920×1080 — every width change followed by `dispatchEvent(new Event('resize'))` **and a reload**. Six documents opened (strongman `d-helmsdale`, `d-home`, `d-jordan-racing-team-2`; automatic `d-about`, `d-home`, `p-tower-parking-system`). Nine `?` sheets, ⌘K, block picker, Settings search, settings guard with real typing and a real rail click, both themes on three pages. **Data-changing flows completed on real data:** an account created and then disabled on strongman People; the Forms app switched off and back on; four publishes and five saves across both sites, each verified against the live HTML `<title>`; Activity re-read afterwards. Everything I changed was put back; the one leftover is `r14probe@local.test`, disabled, on strongman (as instructed), alongside R13's `r13probe`.

Fixed-position geometry was checked by screenshot, per R13's caveat; real edits were driven with `setSelectionRange()` + `computer{type}`, and Escape with a real key press (synthetic `KeyboardEvent` is not honoured by the dialog layer).

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 96 | — |
| 2 | Settings organisation | 96 | — |
| 3 | Help & guidance | 96 | — |
| 4 | Editor: layout, outline, inspector | 94 | — |
| 5 | Editor: block model & width | 96 | — |
| 6 | Dashboard & content lists | 95 | — |
| 7 | Site tools | 95 | — |
| 8 | Studio admin | 90 | — |
| 9 | Feedback, errors, resilience | 95 | — |
| 10 | Visual consistency & polish | 95 | — |
| 11 | Preview fidelity & responsiveness | 95 | — |
| 12 | Accessibility & keyboard | 94 | — |

Blockers 0 · majors 0 · minors 4.

## Round-13 re-test — all eight fixed

**R13-1 — fixed.** `studio.css:2058–2063` adds `grid-template-columns: minmax(0, 1fr)` to `.attn-card`, `min-width: 0` on `.row-item`, and ellipsis on `.row-label`/`.row-sub` with `flex: 0 0 auto` on the chip; `:2068` gives `.table-wrap` its own `overflow-x: auto`. At 390×844 on both sites: `.app`/`.main`/`.topbar` all exactly 390, `documentElement.scrollWidth` 390, `.attn-card` 361 with `scrollWidth` 359, every `.row-item` 345/345, status chips on screen. `#/c/product` table 361 wide inside a 361 wrapper, page heading stationary. Same clean result on `#/`, `#/users`, `#/plugins`, `#/audit`, `#/seo` on both sites: zero elements past the edge.

**R13-2 — fixed.** `studio.css:2071` sets `flex: 0 0 auto` on `.searchish`, `.view-site`, `.user-btn`, and `:2081` hides the search button below 600 px. Measured at 390: `view-site` 283→319, `user-btn` 324→382, no collision, no sliced glyph. ⌘K still works from the keyboard.

**R13-3 — fixed.** `editor.js` now has `adoptVersion(fresh)` (≈`:103–116`), called from the publish and unpublish handlers, which assigns `doc.version` and `baseVersion` from the server's document. Reproduced R13's exact sequence four times — twice on strongman `d-helmsdale`, twice on automatic `d-about`: publish → accept → edit the title → Save. Result each time: `Saved`, no 409, no "Edited somewhere else" dialog.

**R13-4 — fixed.** `save()` now calls `renderStatus(); renderActions()` together (`editor.js:~118`), with the reason in a comment. After each post-publish save the button flipped to "Republish" immediately, with no reload; `.doc-status` read "Published · edited" in the same paint.

**R13-5 — fixed.** No shell command anywhere: the toast is now "Switched on. It starts working after the site is next restarted — ask whoever hosts your site." (`views.js:817–818`). A `.banner-warn` explains the restart and offers "It has been restarted" (`:800–806`), and the card carries a "Starts after restart" badge that survives a reload (`:843–846`, verified by reloading and re-reading `.badge-pending`). The Apps `?` sheet now says it too.

**R13-6 — fixed.** `src/server/api.ts` audits `content.created` (`:374`), `content.saved` (`:415`, guarded so autosaves that produce no new version are not logged), `content.published` (`:434`), `content.unpublished` (`:443`), `user.created` (`:657`) and `plugin.toggled` (`:738`); `audit.js` `userChange()` reports what actually changed. My twenty minutes now read, in order: "Switched the Forms app on / off", "Blocked Round Fourteen Probe from signing in — and signed them out of the studio", "Created an account for Round Fourteen Probe (Author)", "Published …", "Saved …". The Content filter matches.

**R13-7 — fixed.** The invite dialog's password input is `id=inv-pw` with `label[for=inv-pw]` (`views.js:707`), and the role group is `aria-labelledby=inv-role-label`. Every control in the dialog resolves to a name; the role radios are wrapped by their description cards.

**R13-8 — fixed.** One vocabulary: the chip and the toggle title both say "Can sign in" / "Cannot sign in" (`views.js:615, 626`), the toast is "Round Fourteen Probe can no longer sign in — they were signed out of the studio", and `editor.js:1549` now reads "Unpublished — visitors will see a page-not-found message instead".

**Round-13 "verified working" re-check: holds.** 36 rail hashes at 1440 across both sites: zero unnamed controls, zero nested interactive elements, zero `.spin`, `scrollWidth === 1440`; the only element past the edge is `#/tpl`'s own code scroller. Nine `?` sheets open with live counts ("all 12 of your lifts", "the 30 pages grouped under…"), focus on "Close panel", real Escape closes. ⌘K "helmsdale" → the lift first, four images after, exactly one `aria-selected`, `aria-activedescendant=pal-opt-0`. Settings guard: real typing raised "You have unsaved changes · Discard · Save changes"; a real click on the SEO rail link raised a `:modal` "Unsaved settings … Leave without saving?" focused on Cancel; Discard landed on `#/seo` with the bar cleared. Settings search lands on fields for "content types", "tab pattern", "password", "robots", and its miss state ("Try Apps for cookies and forms, or Design for colours") is helpful; there is no favicon setting, so "icon" correctly finds nothing. Block picker 49 entries, every one a sentence. One width vocabulary (Template default (Normal) / Narrow / Normal / Wide / Page width / Edge to edge) on all three automatic documents including nested blocks. At 1024 the outline and inspector park with `visibility: hidden` and are genuinely unfocusable (`el.focus()` leaves `document.activeElement` unchanged); the open inspector is captioned "The Settings panel is floating over the page — close it to see the whole page". 1920 dashboard is centred (content 527→1625 inside main 232→1920). Unknown routes are excellent on both sites: `#/nowhere`, `#/c/nope` (lists the types you do have), `#/plugins/nope`. Previews carry no consent banner. Two sites on one host: signing into 8793 does not disturb the 8792 session, and the switcher disambiguates the two identically-named sites by folder and domain. Leaving the editor with an unsaved title change saves it rather than nagging — verified by reading the document back from the API.

## Findings

**R14-1 · 8 · minor · both sites · `#/plugins` → any app → "What it can do" → "Limit what it may do (advanced)"** Every permission checkbox renders the raw capability key beside its sentence: `blocks.register`, `routes.public`, `routes.api`, `routes.root`, `secure.tables`, `settings.own`, `mail.send`, `events.listen`, `events.emit`, `net.fetch`, `files.private`, `actions.register`, `content.read`, `content.write` — 14 distinct keys across the 17 cards, as `<code class="pill-perm">` (built in `views.js` `appRow()`, the `checks` map). The sentence already says everything the key does, so the key adds only a developer word the persona will not recognise. It is two collapsed `<details>` deep and labelled "advanced", which is why this is a minor and not a major, but Activity solves the same problem better: it hides its machine detail behind a "Show technical details" toggle. Do the same here, or drop the pill.

**R14-2 · 8 · minor · both sites · `#/audit`** One publish writes two rows at the same second — "Saved “About”" immediately under "Published “About”" — because the editor saves before it publishes (`api.ts:415`) and then publishes (`:434`). Over my session automatic's log is six rows for two deliberate publishes. The persona reading "who changed what" sees one action reported twice. Suppress the `content.saved` row when a `content.published` for the same document follows within the same request chain, or fold the pair into one "Published" line.

**R14-3 · 8 · minor · strongman · `#/audit`, oldest row** A legacy `user.updated` event that predates the R13-6 fix (no `changed` array, no `userName`) renders through `audit.js` `userChange()`'s fallback as **"Changed the account for an account"**. It reads like an unfilled placeholder. Make the fallback "Changed an account" when the name is missing, so old rows degrade into a sentence rather than a stutter.

**R14-4 · 4, 12 · minor · both sites · editor at 1024×768** Open the Settings panel: a caption bar appears reading "The Settings panel is floating over the page — close it to see the whole page. Close". Press Escape (a real key press): nothing happens; the panel stays. Escape does close the Restore points dialog stacked above it, correctly, and only that. Since the studio itself calls this panel a floating layer, Escape should dismiss it once no dialog is above it — that is the rule everywhere else in the studio. `editor.js` panel toggle / the shell's Escape handler in `main.js`.

## What each sub-95 category needs

**8 → 90.** The page set is otherwise genuinely strong: the restart banner and pending badge, role blurbs, the credentials card ("Share these once, over a channel you trust"), the plain-English permission sentences, and an Activity log that now records content, people and apps in sentences a non-developer can read. Hide the raw capability keys behind the existing "Show technical details" pattern (R14-1), stop double-reporting a publish (R14-2) and fix the legacy-row fallback (R14-3) and this is 95.

**4 → 94 and 12 → 94.** Each is held only by R14-4. Layout, outline width, default selection, toolbar, panel toggles, Page tab, restore points, dialog stacking and the 1024 parking all behave; accessibility is clean across 36 hashes with zero unnamed controls and zero nested interactive elements. Make Escape close the floating panel when no dialog is above it and both reach 95.

**6, 7, 9, 10, 11 at 95.** Nothing outstanding; each survived every probe I could invent this round, including the four publish→edit→save cycles that broke round 13.
