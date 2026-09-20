# WP-7 — Dashboard & content lists

Owner files: `src/assets/admin/views.js` — ONLY `newDocWizard` (lines ~12–35), `registerView('dashboard'…)` (~37–95) and `registerView('contentList'…)` (~96–270) plus `exportCsv`/`importCsv` (~295–360). Grep for current line numbers; WP-2 may have removed the settings section. `studio.css` rules at the end under `/* ==== WP-7 ==== */`. Read `fields.js` only via grep for the `list`/`select` field types if you need option labels. Read `src/server/api.ts` `GET /content` (grep `app.get('/content'`) to see which fields a list row already carries; you may add fields to that response (small out-of-scope edit) if a type-aware column needs them.

## Problems (observed on both sites)

- Dashboard is greeting + four stat cards + "Recently edited". Nothing says what needs doing (in review, unpublished edits, scheduled, SEO errors, images without alt text).
- The two primary buttons are "New Page" / "New Lift" — the first two types by array order.
- Content list rows: title, `type · path · date`, then chips "edits" and "Published" side by side. "edits" is not a word the persona uses. Sort is by clicking the header words with a tick.
- Lists ignore the type's own fields (Lifts has range, strapline, featured, lift type). "All content" cannot filter by type. Sub-line shows `/{slug}` pattern tokens ("8 of 8 · /{slug}").
- CSV / Import sit in the page head of every list.
- The left "filters" panel is five status rows with counts. Fine, keep, but label the panel "Show".

## Required outcome

### Dashboard (`#/`)

Top to bottom:
1. Page head: "Good morning/afternoon/evening, {first name}" (by local hour), sub: site name + link. One primary button **"New ˅"** that opens a `contextMenu` listing every content type ("New page", "New lift", …). Mount `helpButton('dashboard', 'the dashboard')` (import from `./help.js`).
2. **Needs attention** card — a list of rows, each with an icon, one plain sentence and a button:
   - "{n} pages have changes that are not on the website yet" → `#/c/all?filter=stale` (button "Review")
   - "{n} pages are waiting for review" → `#/c/all?filter=review` (only if publish perm)
   - "{n} pages are scheduled to go live" (publishAt in future) → filter `scheduled` (add this filter to the list view)
   - "{n} images have no description for screen readers" → `#/media` (needs `GET /media` count; fetch it in parallel)
   - "{n} pages have search-engine problems" → `#/seo` (count docs whose `seo` checks contain `level === 'error'` — if the list endpoint lacks this, add `seoErrors: number` to the `/content` list response server-side)
   If nothing needs attention: a single calm row "Everything is published and up to date." with a check icon.
3. **Continue editing** — the user's last 5 edited documents (by `updatedAt`, filtered to `author === me` if the doc carries an author; else the 5 most recent). Row = status icon, title, `Type · edited 2 hours ago` (relative time helper; add `fmtRelative` to `ui.js` if missing — small out-of-scope edit).
4. **Your site** — the four counts as compact stat tiles in one row (keep the link behaviour).

Remove the "Getting started" card unless there are zero docs, in which case show it as the only card with two steps.

### Content lists (`#/c/<type>`, `#/c/all`)

- Head: type name (plural), sub in plain English: "{n} {plural}. Click one to edit it." — no URL pattern. Actions: **New {type}** primary, a **⋯** menu holding "Export as spreadsheet (CSV)" and "Import from a spreadsheet", and `helpButton('content', plural)`.
- Left panel titled **Show**: All · Drafts · Waiting for review · Published · With unpublished changes · Scheduled. Counts stay. On `all`, a second group **Type** with one row per content type (multi-select toggles) — filter param `type=a,b`.
- Main list becomes a **table** (`table.data-table`, exists in css): checkbox · Title (with path underneath) · type-specific columns · Updated (relative) · Status. Type-specific columns: up to three fields from the concept definition whose type is `text`, `select`, or `boolean`, preferring fields flagged `listColumn: true` in the concept if present, else the first three. Boolean shows a tick. On `all`, the extra column is Type.
- Status is **one word or phrase, never two chips**: "Draft", "In review", "Published", "Published · edited" (stale), "Scheduled · 12 Oct". Use the existing `.chip` classes for colour; stale gets the amber chip with the combined text.
- Sortable column headers with an arrow, click toggles direction; remembered as today.
- Search box placeholder "Search {plural}…" and it also matches type-specific column values.
- Bulk bar: keep; add "Unpublish" when every selected is published (POST `/content/:id/unpublish` exists).
- Empty states: keep the existing wording style.
- Row click still opens the editor and pushes the return label.

### New document wizard

Title "New {type}", one field "Title" with the help "You can change this later.", plus, when the type has a `required` field, those fields. Button "Create and open".

## Acceptance

- Dashboard on strongman shows Needs attention first with correct counts (compare to list filters), Continue editing, then stats. "New ˅" lists all five types.
- Lifts list shows Range / Featured / Lift type columns; sorting by Range works; All content has a Type filter; status is a single chip per row.
- CSV/import under ⋯; no `/{slug}` text.
- Scheduled filter works on a doc with a future `publishAt` (set one in the editor Page tab, then check).
- tests 48/48; typecheck count unchanged.
