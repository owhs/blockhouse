# Blockhouse Studio — UX critique, round 1

Reviewer: orchestrator (Fable), 2026-09-19.
Method: read every studio module under `src/assets/admin/` plus `src/server/help.ts`, then drove the real studio against read-only copies of **strongman** (`.uxcritic/strongman`, port 8792) and **automatic** (`.uxcritic/automatic`, port 8793) at 1440×900 in the in-app browser. Every page was opened. Nothing below is inferred from code alone unless marked *(code)*.

The brief from the owner: slick, intuitive, clean, not clunky; plain-English help; settings in logical places; every page, every aspect. This is an overhaul, not a patch list.

## Scores (out of 100)

| # | Category | Score | One-line verdict |
|---|----------|------:|------------------|
| 1 | Information architecture & navigation | 45 | Four rail sections with vague names, "Site" and "Studio" shut by default, plugins scattered by a hidden table, badges nobody understands. |
| 2 | Settings organisation | 38 | Twelve groups, four of which are one card each; things that belong together are split across Settings, Design, Content types, Apps and the editor Page tab. |
| 3 | Help & guidance | 32 | A "handbook" written for developers (Liquid tags, file paths, CSP nonces). Per-screen "?" opens three bullet points. No first-run guidance, no explanation of what a block/slot/concept is. |
| 4 | Editor: layout, outline, inspector | 42 | Canvas 65–82% scaled at 1440px; outline clips labels from the left; nothing selected on open; picker won't close on Escape; ⌘K stacks on top of the picker. |
| 5 | Editor: block model & width | 38 | Three width vocabularies; Section is not what real docs use; strongman CSS ignores `w-wide`/`w-full`; "Wrap in a Section" advice is wrong for 90% of real content. |
| 6 | Dashboard & content lists | 58 | Works, but the dashboard is a stat strip plus a list; no "what needs doing"; list rows waste space; concept lists hide their own type's fields. |
| 7 | Site tools: Menus, Design, Header/footer, Templates, SEO | 52 | Powerful but opaque. Design shows "LICENSE" as a theme; header/footer uses developer slot names; templates is a raw code editor with no explanation of what is safe. |
| 8 | Studio admin: People, Apps, Deploy, Audit, plugin panels | 54 | Plugin panels are either bare tables or one settings card living where content should be; "restart the server to apply" after toggling an app. |
| 9 | Feedback, errors, resilience | 44 | Session expiry blows up every view into a broken full-height layout; unknown plugin panel silently bounces to dashboard; "Saved" toasts for things that are not visibly saved. |
| 10 | Visual consistency & polish | 55 | Good token base, but inline `style:` objects everywhere, five different card header patterns, chips vs tags vs pills, ghost mega-menus bleeding through the preview. |
| 11 | Preview fidelity & responsiveness | 46 | Cookie banner inside the Design preview, hidden mega panels rendered translucent over the hero, preview scaled so type is illegible. |
| 12 | Accessibility & keyboard | 62 | Genuinely decent ARIA work in the rail and tree; let down by focus loss after dialogs, nested modal stacking, and icon-only toolbars with no labels. |

**Average: 47.** Target: every category ≥ 90, average ≥ 95.

---

## 1. Information architecture & navigation (45)

Evidence:
- Rail sections are **Content / Apps / Site / Studio**. "Studio" contains Deploy, Settings, Help, People, Audit, Apps & permissions — six unrelated jobs. "Site" contains Menus, Header & footer, Design, Templates, SEO, Search. A new user cannot predict which section holds "change the phone number in the footer" (answer: Site → Header & footer, or Settings → Brand, or the editor's wand menu — three places).
- Site and Studio are **collapsed by default** (`nav.js` `DEFAULT_CLOSED`). The collapsed header shows a number badge ("6", "7") which reads as a notification count, not "6 items inside". Screenshot: dashboard, strongman.
- Plugin panels are filed by a hidden lookup table (`PLUGIN_SECTION` in `nav.js`). AI assist lands in Studio, Search lands in Site, Forms would land in "Apps". The tooltip explains this ("From the ai app · filed under Studio") which is an admission the placement is not self-evident.
- "Content types" sits in Content beside the content itself. Editing a schema is a site-structure job, not a writing job.
- Rail footer has a filter icon whose only job is "group by section / recent / A–Z". Nobody asked for three nav orderings; it is one more thing to learn.
- Topbar has **six icon-only buttons** (view site, wide, shortcuts, personalize, theme, sign-out). Sign-out is a power icon next to a contrast icon.
- "Personalize studio" (accent colour, ribbon vs sidebar, density, reset pins) is a dialog off a palette icon. These are preferences; they belong in one Preferences place, with the user's own name on it.
- The site switcher is `· Strongman Lifts ˅` inside the brand; it opens a dialog listing sites registered by a CLI command nobody will run.

What good looks like:
- Three sections, named by what the person is doing: **Content** (Dashboard, each type, All content, Assets), **Site** (Design, Navigation, Header & footer, SEO, any plugin that changes what visitors see), **Manage** (People, Apps, Settings, Deploy, Audit, Help). Content types move to Manage → Settings → Content types (schema is configuration).
- All sections open by default; user can collapse; badge only ever means "needs attention".
- One user menu at the top-right (avatar + name) holding Preferences, Keyboard shortcuts, Sign out. Theme and accent live inside Preferences.
- Plugins declare their own section in their manifest (`panel.section: 'site' | 'manage' | 'content'`), default Manage. No hidden table.

## 2. Settings organisation (38)

Evidence (strongman, `#/settings`):
- Groups: General, What the site does, Brand, Appearance, URLs & addresses, Images, Mail, Custom code, System pages, App settings, Publishing & export, Studio interface, Security. Thirteen entries. "Appearance" is a single card that says *go to Design*. "Brand" is one card. "Custom code" is one card. "Publishing & export" duplicates Deploy.
- "What the site does" is a switchboard mixing visitor-facing features (theme toggle, RSS) with technical ones (speculative prefetch, OpenSearch). A site owner does not know what OpenSearch is; the blurb "Lets browsers register this site as a search engine" does not help.
- The Identity card says "Stored in site/site.json — commit it with your content" under every page heading. Owners of Strongman Lifts do not commit things.
- Mail provider options is a raw JSON field: `{"apiKey":"…"} for Resend/SendGrid/Postmark`.
- Security has a "Trusted issuers" JSON field for Ed25519 keys on the same page as "minimum password length".
- Colour scheme lives in Settings → Brand (`schemeSection`) *and* Design *and* the features switchboard ("Visitor theme toggle"). Three places for one decision.
- Per-card Save buttons (13+ of them) with a dirty dot; leaving asks "3 cards have changes". A settings page should save as one form, or autosave with an undo.
- Settings search is good in intent but only searches a hand-maintained catalogue (`catalog.js`) that has to be kept in sync by hand (`assertCatalogue`).

What good looks like:
- Six groups, each a full page: **Site** (name, URL, tagline, language, logo, social/SEO defaults, share image), **Design** (moves out of settings entirely, already exists), **Content** (content types, URL style, system pages, brand variables), **Email** (provider picker with per-provider labelled fields, test button), **Advanced** (custom code, images pipeline, build/export, features that need explaining, studio interface), **Security & access** (login rules, staging/private, studio path, error log). Everything technical gets a one-sentence plain-English "what this does" and, where it matters, "leave it alone unless…".
- One Save bar per page (sticky bottom), enabled only when dirty, with ⌘S. Leaving prompts once.

## 3. Help & guidance (32)

Evidence (`#/help`, `src/server/help.ts`, `help.js`):
- Handbook sections: "This site, right now", "Your content types and their URLs", "Navigation", "Blocks you can use here", "Brand variables", per-plugin sections, "Publishing this site" (bash commands, wrangler), "Security posture" (CSP, HSTS, frame-ancestors), "Health check". This is a doctor report, not help. It never explains how to add a page, change a picture, edit the menu, or publish.
- Sentences like "Menus render through {% menu 'key' %} in your template", "Template blocks live in templates/strongman/blocks/*.json + .liquid", "files resolve from site/overrides → sites/*/templates/…".
- Per-screen "?" opens a side sheet with 2–4 tips from `contextTips()`. Editor tips: "Publishing writes a snapshot; the live site only serves snapshots." That is implementation, not guidance.
- There is no first-run walkthrough, no empty-state guidance beyond "Nothing here yet", no glossary (block, section, slot, concept, restore point, stale, chip "edits"), no inline "what is this?" on fields.
- The users page has "What can each role do?" — that is the model to copy everywhere.

What good looks like:
- Help becomes **task-based, plain English**, written for the person who runs Strongman Lifts: "Add a page", "Change the words on the homepage", "Swap a photo", "Change the menu", "Publish and un-publish", "Who can see the site", "Get someone else access". Each is 3–6 numbered steps with the exact button names, plus one "why this matters".
- The live facts (URLs, counts, plugin states) stay as a collapsed "Your site at a glance" card at the bottom, not the front page.
- Every field with a non-obvious effect gets a `help:` string in plain English (the field renderer already supports it). A glossary of the studio's nouns lives in Help and each noun's first use in any panel links to it.
- Developer material (Liquid, CLI, CSP) moves to a "For developers" page that is clearly signposted as such.

## 4. Editor: layout, outline, inspector (42)

Evidence (strongman `#/e/d-home`, `#/e/…helmsdale`, 1440×900):
- Preview scale badge reads **81%** with outline closed, **65%** with outline open. Body text in the preview is illegible at 65%. The badge's advice is "widen", i.e. hide the tools you came to use.
- Outline column (`--outline-w: 14rem`) shows labels clipped **from the left** ("dale Mid Rise Sciss", "y Recommendation") with a horizontal scrollbar. The tree is wider than the column and scrolled. Screenshot taken.
- Opening a document selects nothing; the inspector says "Nothing selected — pick a block in the outline, or click one in the preview." The first thing a user sees is an empty panel.
- Clicking a tree row label did not select it in my test (inspector stayed on "Nothing selected"). Needs a reliable repro, but the tree row is a `<button>` containing a fold span, grip span, label span and a nested `<button>` — nested interactive content inside a button is invalid HTML and explains flaky clicks.
- "Add a block" picker: Escape does not close it. Pressing ⌘K while it is open stacks the command palette **inside** the still-open picker (two dialogs, both showing). Screenshot taken.
- Command palette shows two rows highlighted at once (Publish this document + Add block: Rich text), so keyboard focus is ambiguous.
- Editor toolbar at 1440px: back, outline, title (truncated to "The Helmsdale:" as soon as the outline opens), status chip, save-state, three device buttons, wand, help, inspector toggle, "Wide", inspector-drawer toggle, Save, Publish, more. Fourteen controls in one row, seven of them icon-only.
- Three separate controls hide panels: outline toggle, inspector toggle, and "Wide". Plus "Swap inspector side" in the more-menu. Plus a resize handle.
- The site rail collapses to icons when the editor opens (`side-collapsed` forced), so the user loses their bearings and gets the pixels back only partly.
- Inspector Page tab: concept fields are rendered in a two-column grid where the *label* column carries a full sentence of help text next to a narrow input ("Model name — Just the model, e.g. 'The Donnington' — this is the page heading" beside a 9-character-wide box). Screenshot taken.
- Page tab groups (Addresses & redirects, Who can see this page, Custom code, Restore points) are `<details>` with persisted disclosure — fine — but "Restore points" (versions) is the second most important thing after Publish and is buried at the bottom of the third tab.
- No breadcrumbs from the editor back to the list except a back arrow whose target depends on a hidden return stack.

What good looks like:
- **Default layout**: rail stays as it was; outline and inspector as fixed columns; preview never scaled below 100% at ≥1440px (`--outline-w: 15rem`, `--insp-w: 20rem`, preview column `minmax(0,1fr)` at 100% with horizontal scroll inside the frame if the template is wider). Scale down only when the window is genuinely too small, and say so in words ("Preview is shrunk to fit. Hide the outline for full size.").
- **One panel control**: a segmented "Outline | Inspector" pair of toggles in the toolbar; "Wide" removed (it is both toggles at once, plus rail-collapse, which is what the rail's own collapse does). Keep ⌘. as a shortcut that toggles both.
- **On open, select the first block** and show its inspector. An empty page shows starter layouts in the canvas, not the inspector.
- Tree rows become `<div role="treeitem">` with one click target; actions button is a sibling, not a child.
- Picker: Escape closes; ⌘K while a dialog is open closes the dialog first.
- Toolbar reduced to: back · title · status · save-state · [device] · [Outline][Inspector] · Save · Publish · ⋯. Wand ("quick edits") and help move into ⋯ and the inspector's Page tab.
- Restore points get a clock icon in the toolbar next to save-state ("Saved 2 min ago ˅" opens versions).

## 5. Editor: block model & width vocabulary (38)

Evidence *(code + real docs)*:
- Across 38 strongman docs, `section` appears twice; real vocabulary is richtext (252), heading (79), photo-row (53), faq-item (37), diagram (26). On automatic, section appears 262 times. The inspector's "width lives on the Section; wrap in a Section" advice is therefore wrong for strongman and would nest every block on automatic.
- Three vocabularies: `section.width` = normal/wide/full; `photo-row.width` = entry/wide/page/full; strongman CSS implements only `w-normal`/`w-narrow`. Choosing "wide" on strongman changes markup and nothing visible.
- Block picker groups: Layout, Text, Media, Actions, Interactive, Marketing, Advanced, Editorial, Strongman — 53 blocks with one-line descriptions like "Wrapper with width, background and anchor controls".
- Blocks with no fields say "This block's text is edited straight on the page" with a "Show it in the preview" button. No way to edit the text from the inspector.

What good looks like:
- **One width vocabulary** across every template and block: `narrow | normal | wide | full`, defined once in `src/render/` as `LAYOUT_WIDTHS` and mapped to CSS classes `bh-w-narrow … bh-w-full` that every template's `components.css` must implement (add the four rules to the eight templates that lack any of them; strongman gets all four).
- Width is a **block-level layout prop** available on every top-level block (rendered by the engine as a wrapper class), not a Section-only field. Section keeps background/padding. The "Layout" inspector section shows width for the selected block itself, plus the enclosing container's width if any, with one sentence: "This block's width. Its container is set to Wide."
- Picker descriptions rewritten in plain English with a use-case ("Section — a band across the page: give it a background colour and put blocks inside").
- Field-less blocks get an inline text editor in the inspector (richtext/markdown already exists in `richtext.js`).

## 6. Dashboard & content lists (58)

Evidence:
- Dashboard: greeting, four stat cards, "Recently edited" (8 rows). No "what needs doing today" (unpublished edits, scheduled, in review, broken links from the SEO audit, images missing alt). The stat cards link to filters, which is good.
- Two "New Page / New Lift" primary buttons pick the first two concepts by array order, not by frequency of use.
- Content list: left rail is status filters with counts; main list rows are title + path + date + status chip. The "edits" chip and "Published" chip sit side by side, both green-ish; "edits" is not a word anyone uses for "has unpublished changes".
- Concept lists ignore concept fields: Lifts has range, strapline, featured, lift type — none shown or filterable. "All content" cannot filter by type.
- CSV/Import buttons are on the page head for every concept list; most owners never use them.
- Pages list shows "8 of 8 · /{slug}" under the heading — a URL pattern token exposed to the user.

What good looks like:
- Dashboard: "Needs attention" list first (in review, unpublished edits, scheduled soon, SEO errors, missing alt), then "Continue editing" (your last 5), then a small "Site at a glance". One primary "New ˅" button that lists all types.
- Lists: table view with type-aware columns (Lifts: Model, Range, Featured, Updated, Status), sortable, with type filter on All content; row status as one clear word: Draft / In review / Published / Published · edited.
- Import/export under a ⋯ menu.

## 7. Site tools (52)

Menus (`#/menus`): structure tree on the left, live preview above an empty "Select something in the structure to edit it here." The preview is a fixed-width 1280 frame scaled down; catalogue mega panels look right. Field labels in the item editor include "Panel → Catalogue" jargon. The tree shows "CATALOGUE" as a tag on the Lift Ranges item without saying what it means. No drag affordance explanation until you hover.

Design (`#/design`): template cards include **"LICENSE"** ("Installed theme package … Custom · radius 8px") because the templates directory listing is not filtered (`/themes` in `api.ts:853` or `TEMPLATES` in `design.js`). The live preview shows the site's cookie-consent banner over the hero. "Install theme" is a zip upload. Palette/hue/intensity sliders are further down and were not visible above the fold.

Header & footer (`#/chrome`): slot list uses raw keys where `NICE` has no entry: "footer.columns" is shown verbatim with "Rendered wherever the template puts {% slot 'footer.columns' %}". Three "Footer column" rows with no indication of what each contains; you must expand each. Preview underneath is the whole site again (with the ghost mega panels).

Templates (`#/tpl`): a file tree (layout, pages, partials, blocks) and a code editor. The heading says "strongman / layout.liquid BUILT-IN". No sentence explaining that editing creates a safe override, what Liquid is, or that this is a developer area. Should be under Manage → Advanced, labelled "Template code (for developers)".

SEO & redirects (`#/seo`): an audit table plus sitemap/robots links. Good content, but every row says "5 warnings" with "+2 more…" and no way to fix from here; click goes to the editor SEO tab. "Description may truncate (166 chars)" is fine; "Keyword missing from H1" without a keyword set is noise.

## 8. Studio admin (54)

- People: solid. Role explainer is the model. But "Reset" and "Access" are ghost buttons with no explanation until clicked; "Access" opens a checklist of `content.publish`-style codes.
- Apps & permissions: cards with `capture`/`delivery`/`audience` tags nobody defined, "v0.1.0 · 0/9 perms". Clicking a card opens a dialog of permission codes. Saving says **"Saved — restart the server to apply."** A non-developer cannot restart the server.
- Deploy: "Own server / Docker / Cloudflare Workers / Flat static" cards, then "Deploy targets", then a diagnostics list with "Bun 1.4.0", "SQLite (bun:sqlite)". This is a developer page presented to everyone.
- Audit log: one table, fine; the detail column dumps `userId: umsyy2c4gecb42j9 · email: … · ip: local`.
- Plugin panels: AI assist is one settings card (base URL / model / API key) that lives as a *page* in the Studio section instead of under Settings → Apps. Search is one card with a Reindex button. `#/p/forms` on automatic silently redirects to the dashboard because the panel does not exist there — no message.

What good looks like:
- Apps page: each app is a row with a plain description, an on/off switch, and "What it can do" written as sentences ("Read and write form submissions"). Permissions approved by default when the owner switches it on; an "Advanced: limit what this app may do" disclosure keeps the fine-grained list. If a restart is genuinely needed, the studio should do it or say exactly what to do.
- Deploy: for owners, "Your site is published at … · last export …" and a Publish/Export button; the runtime diagnostics behind "Technical details (for developers)".
- App settings live in Settings → Apps, never as rail pages, unless the app has records (forms submissions, orders) — those get a page under Content or Site.

## 9. Feedback, errors, resilience (44)

- **Session expiry**: every view renders "This view failed to load — Your session has expired — reload the page and sign in again" in a broken layout (the `.empty` block is stretched to full height, the Try again button is a tall skinny column at the bottom). Screenshot taken. The correct behaviour: detect 401 once, in `api.js`, show the sign-in card in place, and return the user to the same hash afterwards.
- Two studios on `localhost` different ports share the session cookie name, so signing into one signs you out of the other. The site switcher actively encourages this setup. Cookie name should include the site id or the port (`SESSION_COOKIE` in `auth/session.ts`).
- Toasts: "Saved" after a settings card save is the only confirmation; the card's own button flips to "Saved" for 1.4s. Both are fine, but Save on the Brand card does not go through `card()` so it has no dirty tracking and no validation.
- Unknown routes get a 404 with guesses (good). Unknown plugin panel bounces to `#/` with nothing said (bad).
- Publishing dialog lists SEO errors with "Publishing is not blocked — click one to go and fix it", but clicking closes the dialog and switches the inspector tab, losing the publish intent.

## 10. Visual consistency & polish (55)

- Tokens (`--s*`, `--t-*`, `--r-*`, oklch palettes) are a good base; density and accent choices work.
- But: hundreds of inline `style: { … }` objects in `views.js`, `editor.js`, `chrome.js` define margins, grids, font sizes and colours ad hoc. Five different "card with a header and a Save button" constructions. Tags: `.chip`, `.mrow-tag`, `.pill-perm`, `.multi-tag`, `.count`, `.sec-count` — six badge styles.
- Section headings inside panels vary: `insp-section-title`, `fg-title`, `picker-group-title`, `panel-title`, `<strong>` in `page-head`.
- Ghost mega-menu panels render translucent over the hero in every preview iframe (editor, chrome, menus). This is the template's `.mega` panel being shown with `opacity` but no `visibility:hidden`/`display:none` in preview mode, or the runtime not initialising inside `?editor=1`. It makes the product look broken on its most important screen.
- Empty states are consistent (icon, h3, p) — keep.

## 11. Preview fidelity & responsiveness (46)

- Editor preview is a 1280px frame scaled to fit; at 1440px window it is 65–82%. Desktop mode has no fixed width, so "Desktop" means "whatever is left".
- Design preview shows the consent banner; chrome/menus previews show ghost mega panels; none suppress runtime widgets that only matter for visitors.
- At 860px the rail becomes a modal drawer (done well). Between 861 and 1400 the outline is an overlay drawer and the inspector a column; between 1400 and 1600 the outline is a column but closed by default. Four breakpoints of behaviour for one panel.

## 12. Accessibility & keyboard (62)

- Good: rail `aria-current`, tree `role=tree` with roving tabindex, dialogs are `<dialog>`, radiogroups for device/segments, focus trap in the drawer, skip link.
- Bad: nested `<button>` inside `.tree-item` buttons; icon-only topbar with `title` only; colour-only status distinction between "Published" and "edits" chips; two focus highlights in the palette; Escape swallowed by the block picker; `contextMenu` positioned at click point with no keyboard route except Shift+F10 on tree rows.

---

## Priorities for round 1 of repairs

Work packages are in `01-workplan.md`. Order: WP-1 shell & navigation, WP-2 settings restructure, WP-3 help rewrite, WP-4 editor layout, WP-5 width model, WP-6 resilience & preview fidelity, WP-7 lists & dashboard, WP-8 site tools, WP-9 admin pages, WP-10 visual system. Each package has an owner agent, a strict file scope, and acceptance checks the critic agent will run.
