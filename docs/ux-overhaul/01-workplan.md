# UX overhaul — work plan and rules for repair agents

Read this whole file, then ONLY your own work-package file (`wp-N-*.md`). Do not read the critique or other packages unless your package tells you to.

## Ground rules (every agent)

1. **Scope is the package.** Touch only the files your package lists. If a fix genuinely needs a change elsewhere, make the smallest possible change there and list it in your report under "Out-of-scope edits".
2. **Read narrowly.** Your package names the files and line ranges that matter. Read those. Use Grep to find anything else. Do not read `views.js` (2195 lines) or `editor.js` (1520 lines) end to end unless the package says so.
3. **Plain English for anything a site owner will read.** The people using this run a lift-installation company. No "slot", "concept", "Liquid", "CSP", "snapshot", "restore point" without an explanation on first use. Prefer verbs: "Change the menu", not "Navigation structure".
4. **No regressions.** Baseline before this overhaul: `bun run typecheck` reports 61 errors (all pre-existing, none in `src/assets/admin`), `bun test` passes 48/48. You must not add typecheck errors or break a test. Run both before reporting.
5. **No inline `style: {}` objects for layout you introduce.** Add a class to `src/assets/admin/studio.css` under a comment header `/* ==== WP-N: <name> ==== */` at the end of the file. Existing inline styles in code you are rewriting should be converted to classes as you go.
6. **Keep the `h()` DOM helper pattern** (`src/assets/admin/ui.js`). No frameworks, no new dependencies, no build step. Everything is plain ES modules served as-is.
7. **Do not break other packages' territory in `studio.css`.** Add rules at the end under your header; edit existing rules only when they are the direct cause of your bug.
8. **Verify what you can.** The studio for the strongman copy is on `http://localhost:8792/admin/` and automatic on `http://localhost:8793/admin/` (dev servers already running; they hot-serve `src/assets/admin/*` files — a browser reload picks up your change). You may fetch `http://localhost:8792/admin/` and the API with curl to confirm nothing 500s. The orchestrator does the visual pass; do not open the in-app browser.
9. **Report in under 300 words**: what changed (file:line), what you verified, anything you could not do and why. No preamble, no restating the package.
10. **Do not create git commits.** This directory is not a git repository. A baseline copy of `src/` and `templates/` exists at `../.uxcritic/baseline-r0/` if you need to diff (`diff -r`).

## Packages and order

| Round | Package | Files owned |
|-------|---------|-------------|
| A | WP-1 Shell & navigation | `main.js`, `nav.js`, `search.js` (nav rows only), `studio.css` (rail/topbar rules) |
| A | WP-3 Help rewrite | `src/server/help.ts`, `src/assets/admin/help.js`, `sheet.js` |
| A | WP-4 Editor layout & interaction | `editor.js`, `docops.js`, `ui.js` (dialog Escape only), `studio.css` (editor rules) |
| A | WP-6 Resilience & preview fidelity | `api.js`, `src/auth/session.ts`, `src/assets/blockhouse/runtime.js`, `src/render/page.ts`, `design.js` (template list only), `src/server/api.ts` (`/themes` only) |
| B | WP-2 Settings restructure | new `settings.js` (extracted from `views.js` lines 517–1154), `catalog.js`, `studio.css` (settings rules) |
| B | WP-5 One width model | `src/render/*`, `templates/*/components.css`, `templates/*/blocks/section.json`, `editor.js` `renderBlockTab` layout section only |
| B | WP-8 Site tools | `menus.js`, `design.js`, `chrome.js`, `templates.js`, `seo.js`, `quick.js` |
| C | WP-7 Dashboard & lists | `views.js` (dashboard + contentList + newDocWizard), `studio.css` (list rules) |
| D | WP-9 Studio admin pages | `views.js` (users, plugins, pluginPanel, CUSTOM_SECTIONS), `deploy.js`, `audit.js`, `nav.js` plugin placement hook |
| E | WP-10 Visual system pass | `studio.css` consolidation, remaining inline styles across all admin files |

After each round the orchestrator reloads both studios, screenshots every affected page, and checks acceptance items. After round E an independent critic agent re-scores every category using `02-scoring-rubric.md`.

## Hard rule added after round 7
11. **Never `import` anything from `main.js` in a view module.** The shell is loaded as `main.js?v=…`; a bare `./main.js` import creates a second module instance that boots a second shell (found in round 7: the settings guard painted into an orphaned view element). Shared state and helpers go in `state.js` or `ui.js`.
