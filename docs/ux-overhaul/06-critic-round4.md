# Critic — round 4

Average: 86.5

Method: signed in to both studios as `critic@local.test`, `localStorage.clear()` on each origin before judging defaults. 1440×900 throughout, plus dashboard + editor at 1024×768 and dashboard at 1920×1080. Every rail page on both sites (strongman 8792, automatic 8793). Editors: strongman `#/e/d-home`, `#/e/d-helmsdale`; automatic `#/e/d-home`, `#/e/p-tower-parking-system`, `#/e/d-about`. Block picker (54 entries), ⌘K, Settings search, ? help on six screens, light and dark on dashboard/settings/editor, site switcher, settings guard, Publish (cancelled), real click-select and double-click inline editing in the preview, tree keyboard nav.

| # | Category | Score | Blocking issues (must fix to pass 90) |
|---|----------|------:|---------------------------------------|
| 1 | Information architecture & navigation | 84 | Two rail labels clip mid-word; ⌘K returns file names and `dist/` jargon |
| 2 | Settings organisation | 93 | — |
| 3 | Help & guidance | 86 | Pages sheet counts 39 on a 6-page list |
| 4 | Editor: layout, outline, inspector | 82 | Outline hidden by default and its toggle is hover-only; "Inspector" |
| 5 | Editor: block model & width | 90 | — |
| 6 | Dashboard & content lists | 88 | "N pages" counts Lifts and Systems; two status vocabularies |
| 7 | Site tools | 86 | SEO says "0 need attention" over four rows that need attention |
| 8 | Studio admin | 91 | — |
| 9 | Feedback, errors, resilience | 80 | Discard on the unsaved guard discards but does not leave |
| 10 | Visual consistency & polish | 85 | Rail clipping; content column stranded left at 1920 |
| 11 | Preview fidelity & responsiveness | 82 | The site's own lightbox opens inside the editor canvas |
| 12 | Accessibility & keyboard | 91 | — |

**Round-3 re-test — fixed (9 of 9 as written):** R1 (`studio.css:1781 .editor:has(> .outline.closed){--outline-col:0rem}` — the track, not the panel, now animates; toggling at 1440 gives `240px 796px 336px`, `.closed` gives `0px`), R2 (0 of 7 Page-tab controls unlabelled; `el.labels.length === 1` on each), R3 ("Page address", "The last part of the web address…", "Switch on the Members **app**"), R4 (`/api/projects` returns `current:true` for the studio you are in; the dialog renders "You are here"), R5 (no bare "—"; the list opens "Default for Page (Standard page)"), R6 (page and sheet both say 30), R7 (`editor.js:281 FLOOR = 0.6` steps the frame down to 1024/834 instead of shrinking; worst observed 62%), R8 (`main.js:614` puts the address back *before* asking — hash stays `#/settings`, Cancel leaves it there), R9 (the rail toggle now reads "Expand", `aria-label="Expand sidebar"`, "Widen the sidebar ⌘B").

**Round-3 "verified working" re-check:** all held except two. ⌘K's "sensible hits for seo" no longer holds on automatic (F2 below). "All 53 picker entries plain English" — "SVG" is a block name (F11).

## Findings

**F1 · 9/2 · major · both · `#/settings`, real typed edit, click a rail item, press Discard** The guard asks correctly, but Discard discards the edit and *stays on Settings*. Instrumented on both sites: the sequence is `hashchange(#/design)` → `replaceState('#/settings')` → **a second `hashchange` fires for that replaceState** → `navSeq` increments, the first navigation is abandoned by `if (my !== navSeq) return`, and the surviving one routes to its own target, `#/settings`. `main.js:607 onHashChange` — the restore introduced in the R8 fix re-enters its own handler. Guard the restore with a flag (or compare `target` against `from` and ignore the echo) so the user's destination survives. The persona clicks Pages, says "yes, throw it away", and nothing moves.

**F2 · 11/4 · major · both · editor, any document with photos** Clicked a gallery image in the preview at `#/e/d-helmsdale`. The site's visitor lightbox opens *inside the canvas*: `<div class="sm-lb" role="dialog" aria-modal="true" aria-label="Image viewer">`, 1265×1296, covering the whole preview. While it is up, clicks no longer select blocks and the outline still highlights whatever was selected before. Escape closes it, but only because focus happened to be inside the frame — nothing in the studio chrome says so. The preview is served as `/preview/:id?editor=1`; that flag already exists, so suppress visitor-facing overlays (lightbox, search overlay, consent) in editor mode, or let a click in the canvas win over site JS. `src/server/site.ts` preview render / `bridge.js`.

**F3 · 4/3 · major · both · entering any editor with cleared storage** The outline still defaults closed at 1440 (`editor.js:599 disclosure('outline', false)`), so a new person's first editor on `p-tower-parking-system` shows 44 blocks with no list of them. The only way back is a 32px icon button whose text label is `opacity: 0` until hover (`studio.css:1090 .panel-btn-label`, `:1096` reveals it on `:hover`/`:focus-visible`). Its sibling is labelled **"Inspector"** (`editor.js:1586`) — a devtools word for the panel that holds every setting the owner uses. Default the outline open above 1400px, show both labels, and call the right-hand panel "Settings for this block" or similar.

**F4 · 4/3 · major · both · editor → Page tab → Addresses & redirects** One panel, six developer terms: "Canonical URL", "Changing the **slug** adds an automatic redirect", "Static file / index.html", "URL style: directory · layout: pattern", "Mirror instead of redirect", "Each address **301-redirects** to the canonical URL", "Stable even if the slug changes". `editor.js:1179-1200`. Round 3 cleared "Slug" from the top of the tab; this is the same word two sections down, with worse company.

**F5 · 1/10 · major · both · collapsed rail (1024×768, and every editor at any width)** `.side-label` is a 52px box, `nowrap`, `overflow:hidden`. Measured at its own `550 10.5px` font: "Header & footer" needs 77px and "Template code" 70px, so both render cut mid-word with no ellipsis visible. Two of twenty labels are wrong wherever the rail is collapsed — which is every editor. Shorten those two names, allow two lines, or widen the collapsed rail.

**F6 · 3 · major · both · `#/c/page` → ? Help with Pages** The list says "6 pages. Click one to edit it."; the help sheet opened on the same screen says "Browse all **39** of your pages". `src/server/help.ts:429` uses `docs.length` (every document on the site) on a type-filtered list. Same sheet: "Look for the “**edits**” chip" — the chip actually reads "Published · edited".

**F7 · 7 · minor · both · `#/seo`** The summary reads "4 pages are fine · **0 need attention** · 34 could be better" directly above four rows each marked "1 to look at" / "2 to look at". Two words for one state. Also the Redirects block offers the bare buttons **301** and **302**.

**F8 · 6/10 · minor · both · dashboard and editor** Needs-attention says "**2 pages** have changes that are not on the website yet" (`views.js:145`) — on strongman one of the two is a Lift, on automatic two of three are Systems. And the same state is spelled three ways: list chip "Published · edited", editor chips "published" + "unpublished edits" (lower case, two chips), dashboard "Unpublished edits".

**F9 · 1 · minor · automatic · ⌘K** Typing "seo" returns 28 rows, most unrelated: four asset rows shown as "**sys-wide-iso.svg / image/svg+xml**", "Export static site / Build a flat site into **dist/**", "Sector guides / Browse · **/sectors/{slug}**", "Send **HSTS** (only once HTTPS is everywhere)" (correctly buried under "Technical security (for developers)" on the Settings page, surfaced bare here). Typing "menu" returns "**Main menu menu**" and "**Footer menu menu**". `search.js` matcher and row formatters.

**F10 · 10/11 · minor · both · dashboard at 1920×1080** `main` is 1688px; the content column is capped at 938px and left-aligned, leaving ~750px of empty grey to the right of every card. Centre the column or let the cards grow.

**F11 · 5 · minor · both · block picker** "**SVG**" is a block name (the description explains it; the name does not). Several descriptions are written for a designer: "the **two-up** opener above a tile or card grid", "a **frosted panel** of copy", "Ruled **label/value data sheet**", "curated by an editor, not auto-generated".

**F12 · 8/9 · minor · both · site switcher → "Open its studio"** The link is built from the registry's `url` (`api.ts:231`) and points at `http://localhost:57002/admin/`, which is not listening; the browser shows a connection error with nothing from the studio. No liveness check and no fallback text.

## What each sub-90 category needs

1 → fix F5 (clipping caps it at 89) and F9. 3 → fix F6. 4 → fix F3 (hover-only control caps it at 89) and F4. 6 → fix F8. 7 → fix F7. 9 → fix F1. 10 → fix F5 and F10. 11 → fix F2.

## Verified working (tried to break, could not)

Click-to-select and double-click-to-edit in the preview both work (`wb-richtext … wb-selected wb-live` becomes `contenteditable`); breadcrumb "Page › Section › Columns" and a full Layout → Width section on nested blocks; one width vocabulary (Template default / Narrow / Normal / Wide / Page width / Edge to edge) on every block of both templates; 54 picker entries all carry a description; Escape from the picker restores focus to "Add block"; tree keyboard nav (↑↓/Home/End) moves and selects; Publish dialog names the document and address and focuses "Publish now"; Settings security wording is exemplary and all developer material sits behind "(for developers)"; Apps permission keys are collapsed behind "Limit what it may do (advanced)"; People, Deploy, Activity, Navigation, Header & footer free of raw keys; no unlabelled controls anywhere I looked; light and dark identical in quality on dashboard, settings and editor; no horizontal scroll on any page of either site at 1024, 1440 or 1920; unknown routes explain themselves.
