# WP-1 — Shell & navigation

Owner files: `src/assets/admin/main.js`, `src/assets/admin/nav.js`, `src/assets/admin/search.js` (only where it consumes nav groups), `src/assets/admin/studio.css` (rail + topbar rules; grep for `.side`, `.topbar`, `.top-`, `.mbar`, `.ribbon`).
Read first: `nav.js` (whole, 154 lines), `main.js` lines 114–362 (`renderShell`) and 418–486 (`personalize`, `openSiteSwitcher`).

## Problems (observed on both real sites)

- Sections are Content / Apps / Site / Studio. "Studio" holds six unrelated jobs. Plugins are placed by a hidden table (`PLUGIN_SECTION`) and explained by tooltip.
- Site and Studio are collapsed by default; the closed header shows a count badge ("6") that reads as a notification.
- "Content types" (schema) sits among the content.
- Topbar: six icon-only buttons (view site, wide, shortcuts, personalize, theme, sign-out). Personalize is a palette icon opening a dialog.
- Rail footer has a group-by filter (section / recent / A–Z) nobody needs.
- Site switcher is glued to the brand.

## Required outcome

1. **Three sections, always open by default**, user may collapse (persisted as now):
   - `content` — **Content**: Dashboard, one item per content type, All content (when >1 type), Assets.
   - `site` — **Site**: Design, Navigation (rename of "Menus"; hash stays `#/menus`), Header & footer, SEO, plus plugin panels whose `section` is `site`.
   - `manage` — **Manage**: People, Apps (rename of "Apps & permissions"), Settings, Deploy, Audit log, Help, plus plugin panels whose `section` is `manage` (default). "Content types" moves under Settings (WP-2 owns the settings page; you only remove it from the rail and add a `settings` sub-hash link `#/settings/content` that WP-2 will honour — for now route `#/types` still works and stays reachable via ⌘K search and from Settings).
   - "Templates" (code editor) moves to Manage and is labelled **Template code** with tip "For developers — the site's page templates".
   - Remove the `apps` fallback section. Plugin placement: `PLUGIN_SECTION` becomes a default table only; a panel object may carry `section` (`'content' | 'site' | 'manage'`) and that wins. Plugins with their own records (forms, newsletter, members, commerce, data, drive, files) default to **Content**; everything else defaults to **Manage**.
   - Section titles get a hover tip in plain English: Content "The pages and things you write", Site "How the site looks and what visitors see", Manage "People, apps, settings and publishing".
2. **Closed-section badge**: remove the item count. A closed section shows only its title and chevron. The `counts` badge on an item (unpublished edits) stays, but its `title` becomes "N with changes not yet published".
3. **Rail footer**: remove the group-by control and the `groupBy` modes entirely (`navGroups` returns sections only; drop `recent`/`az`). Keep pins (right-click) and collapse. Remove `noteVisit` and `recentNav` pref.
4. **Topbar right side becomes**: `View site ↗` (keep), then a single **user menu button** showing an avatar circle (initials) + first name + chevron. Clicking opens a `contextMenu` with: Preferences…, Keyboard shortcuts (?), Light / Dark studio (toggle, shows current), separator, "Signed in as email" (disabled row), Sign out. Remove the standalone wide, shortcuts, palette, contrast and power buttons. The `?` and ⌘B/⌘. keyboard shortcuts keep working.
5. **Preferences dialog** (was `personalize`): title "Your preferences", intro line "These only change how the studio looks for you, on this browser. The website is not affected." Fields: Studio colour (swatches, keep), Light/dark (segmented: Follow system / Light / Dark — new option, `localStorage` key unchanged; "Follow system" removes the `data-theme` attribute), Layout (Sidebar / Top ribbon), Density, and "Reset sidebar pins" button. Drop the ⌘B sentence from the dialog.
6. **Site switcher**: keep, but render as its own small button after the brand: `Strongman Lifts ˅` with title "Switch site". Dialog text loses the CLI instruction; if no other sites, say "This studio only knows about this site."
7. **Mobile drawer / ribbon** must keep working unchanged (they read `navGroups()`); the ribbon gets the same three groups.
8. `search.js`: wherever it builds "Go to" rows from nav groups, confirm it still works with three sections and no `apps` group. Section names in search results must use the new titles.

## Acceptance (the critic will check)

- Rail on strongman shows exactly: Content (Dashboard, Pages, Lifts, Projects, Lift ranges, Services, All content, Assets), Site (Design, Navigation, Header & footer, SEO, Search), Manage (AI assist, People, Apps, Settings, Deploy, Audit log, Template code, Help). All three open on a fresh profile (clear `localStorage` key `blockhouse-studio-prefs` or whatever `prefs()` uses — check `state.js`).
- No number badge on a collapsed section.
- Topbar right: View site, user menu only. User menu contains the six items above.
- `?` opens shortcuts; ⌘B collapses the rail; ⌘. still toggles wide (state.js unchanged).
- `bun test` 48/48; typecheck error count unchanged (61).
