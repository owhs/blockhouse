# Critic — round 5

Average: 83

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus every rail page at 1024×768 and the dashboard at 1920×1080. Every rail page on both sites (strongman 8792, automatic 8793). Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`; automatic `#/e/d-home`, `#/e/p-tower-parking-system`, `#/e/d-about`. Collapsed rail measured label-by-label; block picker (53 entries); ⌘K for "seo" and "menu" on both sites; ? help on six screens including two type lists; light and dark on dashboard/settings/editor; site switcher; settings guard with the address bar; Publish (cancelled); real click-select in the preview and clicks on every photo in a gallery page; device modes; restore points; 404 and unknown-document routes.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 88 | Site switcher's purpose lives only in `title=`; it also cannot reach the second studio |
| 2 | Settings organisation | 86 | Content page ends in a raw `{{var.*}}` token list with unnamed ✕ buttons |
| 3 | Help & guidance | 92 | — |
| 4 | Editor: layout, outline, inspector | 93 | — |
| 5 | Editor: block model & width | 94 | — |
| 6 | Dashboard & content lists | 60 | Assets renders nothing but a spinner, for ever, on strongman |
| 7 | Site tools | 92 | — |
| 8 | Studio admin | 90 | — |
| 9 | Feedback, errors, resilience | 55 | The unsaved-settings guard closes itself; navigation is then silently refused |
| 10 | Visual consistency & polish | 87 | A dead page (Assets) and a text stub where the Map block's icon belongs |
| 11 | Preview fidelity & responsiveness | 85 | Tablet and Mobile render identically at 1440 |
| 12 | Accessibility & keyboard | 72 | 42 settings switches and 15 ✕ buttons have no accessible name |

Blockers 2 · majors 3 · minors 5.

## Round-4 re-test

**Fixed (10 of 12).** F2 (`bridge.js:205` `stopImmediatePropagation` on `img, picture, figure`; clicked all 13 photos on `#/e/d-helmsdale`, no `.sm-lb` ever appears, and the click still selects — outline moved to "Photo row", `data-wb=b077`). F3 (`editor.js:602 disclosure('outline', innerWidth > 1400)`; cleared storage gives `240px 784px 336px`, both toggles read "Outline" and "Settings panel" at `opacity: 1`). F4 (Addresses is now "Address / Short link / Old addresses"; slug, canonical, 301 and mirror are gone, the export file and address style sit under "Technical details"). F5 (`studio.css:1795-1815`; collapsed rail is 80px, every one of 20 `.side-label` has `scrollWidth === clientWidth`, and "Header & footer" / "Template code" wrap to two clamped lines inside a 52px row). F6 (Pages sheet says "all 8 of your pages" over an 8-row list; Lifts says 12; the chip is quoted as "Published · edited"). F7 (rows read Fine / Could be better, matching the summary; Redirects reads "Permanent (301)" with a plain sentence above). F8 (dashboard "1 lift and 1 page…", "2 pages and 1 system…"; one chip, `chip stale` "Published · edited", in list, editor and dashboard). F9 ("menu" returns "Main menu / Navigation" — no doubled word, no `dist/`, no HSTS, no mime types). F10 (`.main` centres; at 1920 the 1152px column has 344px of margin each side). F11 ("SVG" → "Drawing or icon"; no two-up, frosted or label/value left).

**Not fixed: F1** — see R5-1. It is worse than round 4: the dialog now appears and then destroys itself.

**Partly: F12** — a dead studio is correctly shown as plain text with "Not running right now"; but the entry still points at `localhost:57002` while that studio is live on 8793, so the switcher can never reach it (R5-7).

**Round-4 "verified working" re-check:** all held. Click-to-select, breadcrumb and nested Layout → Width, one width vocabulary, 53 picker entries each with a description, Escape from the picker, tree keyboard nav, Publish naming the document and focusing "Publish now", security wording, no horizontal scroll at 1024/1440/1920 on any page of either site, light and dark clean on all three pages. Two claims no longer hold: "no unlabelled controls anywhere I looked" (R5-3, R5-4) and "unknown routes explain themselves" (R5-8).

## Findings

**R5-1 · 9 · blocker · both · `#/settings`, type into Site name, click any rail item** The guard dialog opens and closes itself 221 ms later with nothing clicked (measured with a MutationObserver: `opened 13ms, closed 234ms`), `confirmDialog`'s `onClose(undefined)` resolves `false`, and you stay on Settings. Every rail click is now a flash and nothing else; the only way off the page is the sticky Discard/Save bar (which does work). Cause: `main.js:636` calls `history.replaceState` to put the address back, that fires the echo hashchange, and the listener registered earlier at `main.js:352` runs `closeOpenDialogs()` on it. `ui.js:289` exempts dialogs with `dataset.guard === '1'`, but `ui.js:294 confirmDialog` never sets it (only `dialog({dismissable:false})` does, `ui.js:260`). Mark the guard's dialog, or make the echo skip the close listener.

**R5-2 · 6/10 · blocker · strongman · `#/media` (rail "Assets")** The page is `<main><div class="spin"></div></main>` and stays that way indefinitely — verified after a hard reload at 1440 and at 1024, with `/api/media?q=` and `/api/media/index` both returning 200 in ~120 ms and no console errors. A whole rail page renders nothing. Cause: `assets.js:211` paints synchronously and `assets.js:224` then awaits `refresh()`; `main.js` `route()` arms `setTimeout(() => viewEl.replaceChildren(spinner()), 180)` and clears it only after the view resolves, so a view that paints first and finishes after 180 ms has its own DOM thrown away and never repaints. Automatic survives only because its two calls total ~105 ms. Cancel the spinner on first paint (or have views return before their data).

**R5-3 · 12/2 · major · both · `#/settings/advanced`** 42 of 46 checkboxes on the page have an empty accessible name. `settings.js:402 row()` builds `<label class="switch"><input type=checkbox><span class="switch-track"></span></label>` and puts the visible words in a sibling `<div><strong>`, so `input.labels[0].innerText` is `''`. Settings search lands focus on one of these (search "robots" → "Give search engines a page list" → focus goes to an unnamed checkbox). Put the text inside the label, or add `aria-label: label` to the input.

**R5-4 · 2/12 · major · both · `#/types` (Settings → Content), bottom of "Brand variables"** Under fifteen properly-labelled fields the same fifteen values are listed again as raw tokens — `{{var.company}}`, `{{var.legalName}}`, `{{var.phoneHref}}`, `{{var.navBackdrop}}` — each with a bare `<button><svg/></button>` that deletes it. No accessible name, no `title`, no heading over the row (`.set-tags` in `fields.js`'s multi-tag field). The persona sees developer tokens and fifteen unexplained crosses that remove site-wide values.

**R5-5 · 11 · major · both · editor, device segment** At 1440 with both panels open (canvas 632px on automatic) "Preview at tablet width" and "Preview at mobile width" both give an iframe of exactly 612px — identical output from two buttons. `studio.css:1106-1107` asks for 834px and 390px, but the holder is capped by the canvas, and nothing tells you the width was clamped. Either shrink-to-fit the requested width (as the desktop mode already does with `transform: scale`) or say "too narrow to show phone width — hide a panel".

**R5-6 · 1/12 · minor · both · topbar** The site switcher is `<button class="top-site site-switch" title="Switch site">` with no `aria-label`, no `aria-expanded` and no visible word: its accessible name is just the site name, and its purpose is learnable only by hovering.

**R5-7 · 8/1 · minor · both · site switcher → the other site** The second entry says "Not running right now — start it on that machine first · localhost:57002" while that studio is live on 8793. The registry `url` (`api.ts:231`) is stale, so the honest new message is honestly wrong and the switcher can never reach the other studio.

**R5-8 · 9 · minor · both · `#/e/<deleted-or-unknown-id>`** Renders "This view failed to load / **not found** / Try again" — a lowercase API string and a button that can never succeed. `main.js` route() catch. A stale bookmark deserves "That page no longer exists" and a link to the list. (`#/c/<unknown-type>` silently redirects to the dashboard with no word about why.)

**R5-9 · 1/3 · minor · both · ⌘K and the Assets screen** "seo" returns 21 rows on strongman and 26 on automatic; the matcher is a subsequence match, so "Messages come from", "Closed for maintenance" and `sherwoods.png` all rank as hits for three letters (`search.js`). Separately, `#/media` is the only rail page with no `?` button (`helpButton('media', …)` exists at `assets.js:218` but the view never paints — see R5-2; on automatic, where it paints, the button is there), and both list help sheets say "the list on the left narrows them down **by kind**" when that list filters by status (`help.ts`).

**R5-10 · 10/5 · minor · both · block picker, "Map"** Its icon tile shows the two letters "lo" (`<span class="ico-txt" aria-hidden="true">lo</span>`) where the other 52 entries have a drawn icon — `icons.js` has no glyph for that name and the fallback prints a stub.

## What each sub-90 category needs

1 → R5-6 (hover-only purpose caps it at 89) and R5-7. 2 → R5-4. 6 → R5-2. 9 → R5-1 and R5-8. 10 → R5-2 and R5-10. 11 → R5-5. 12 → R5-3 and R5-4 (and give the 91 identical "Fix" links on `#/seo` names that say which page and which problem).

## Verified working (tried to break, could not)

Collapsed rail at 80px with all twenty labels intact; outline open by default at 1440 with the first block selected and both panel toggles labelled; preview click-to-select with no visitor lightbox, no consent banner and no search overlay; one width vocabulary and a full Layout section on nested blocks; 53 picker entries each with a plain description; Escape closes the top-most layer only (restore points, picker, help sheet, palette) and never leaves the editor; Publish dialog names document and address, focuses "Publish now", Cancel closes cleanly; the editor autosaves the draft, so navigating away with an "Unsaved" chip loses nothing (verified against `/api/content/d-about`); settings sticky Discard restores the field and then lets you leave; type-aware help counts and status wording everywhere; People, Apps, Deploy, Activity, Navigation, Header & footer free of raw keys; no horizontal scroll on any page of either site at 1024, 1440 or 1920; light and dark equally clean on dashboard, settings and editor.
