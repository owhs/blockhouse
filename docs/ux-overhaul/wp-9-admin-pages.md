# WP-9 — Studio admin pages: People, Apps, Deploy, Audit log, plugin panels

Owner files: `src/assets/admin/views.js` — ONLY `registerView('users'…)`, `permissionNote`, `registerView('plugins'…)`, `registerView('pluginPanel'…)`, `resourceSection`, `CUSTOM_SECTIONS` (grep for line numbers; do not read the dashboard/list code above them), `deploy.js` (266), `audit.js` (63), `nav.js` (only to confirm plugin panel `section` handling from WP-1), `src/core/plugin.ts` (grep `panel` to see the panel registration shape), `src/server/api.ts` (`/plugins` PATCH handler only — grep `app.patch('/plugins`), `studio.css` at the end under `/* ==== WP-9 ==== */`.

## Problems (observed)

- Apps: cards with tags `capture` / `delivery` / `audience` nobody defined, "v0.1.0 · 0/9 perms". Opening one shows permission codes (`content.read`). Save says **"Saved — restart the server to apply."**
- Deploy: hosting-type cards (Own server / Docker / Cloudflare / Flat static), then "Deploy targets", then runtime diagnostics ("Bun 1.4.0", "SQLite (bun:sqlite)") — developer material shown to everyone.
- Audit log: detail column dumps `userId: umsyy2c4… · email: … · ip: local`.
- People: good. "Reset" and "Access" ghost buttons unexplained until clicked; Access lists permission codes.
- Plugin panels: AI assist is a settings card living as a rail page; Search is one card with Reindex; generic resource panels are bare tables (Item / ID / trash) with dialog editing.

## Required outcome

### Apps (`#/plugins`)
- Heading "Apps", sub "Extra features you can switch on. Each one says what it does and what it needs to touch."
- One **row per app** (not cards): icon · name + one-line plain description · on/off switch · "What it can do" disclosure. Remove the tag pills and the `v0.1.0 · 0/9 perms` line; show the version only inside the disclosure.
- Switching on approves **all** declared permissions by default and PATCHes immediately. The disclosure shows the permissions as plain sentences (map codes via `p.permissionInfo[perm]`, falling back to a humanised code: `content.read` → "Read your content") each with a checkbox for people who want to limit it, under a small heading "Limit what it may do (advanced)".
- The restart message: find out from the server whether a restart is actually required (grep `restart` in `src/server/api.ts`/`src/core/plugin.ts`). If plugins are loaded at boot only, the toast must say exactly what to do in plain words: "Switched on. It starts working the next time the site is restarted — ask whoever hosts your site, or run `blockhouse serve` again." and the Apps page shows a persistent banner "Changes take effect after a restart" while any pending change exists (store pending ids in `prefs()`). If the server can hot-load plugins, do that instead and drop the message.
- Install-a-package button stays, ghost, at the bottom, with help "Only if a developer gave you a .zip."
- `helpButton('plugins', 'Apps')` in the head.

### Deploy (`#/deploy`)
- Split into two zones. **Top, for owners**: "Your website is at {url}" · last export/deploy time if known (grep the deploy profile/run records) · one primary button "Publish website now" that runs the configured deploy target if one exists, else "Export site files" (POST `/export`) with a plain result toast ("Exported 38 pages to dist/. Upload that folder to your host.") · a second line "Something look wrong? Run the checks" → runs the existing checks and shows them.
- **Below, in a collapsed `<details>` "Technical details (for developers)"**: hosting-type cards, deploy targets editor, runtime/project diagnostics, page-weight toggle — everything that is there today, unchanged in function.
- `helpButton('deploy', 'Deploy')`.

### Audit log (`#/audit`)
- Rename heading to **Activity** (rail label stays "Audit log" — WP-1 named it; change the rail label to "Activity" in `nav.js` since you own the page).
- Rows: time (relative + exact on hover) · person (name, from `entry.userName` if present else email) · what happened as a sentence ("Published *About*", "Signed in", "Changed Sam's role to Editor"). Extend `ACTION_LABELS` into functions that build a sentence from the entry's data; unknown actions fall back to the raw action name in a `code` pill. Keep a "Show technical details" toggle that reveals ids/ip.
- Filter row: by person, by kind (Content / People / Settings / Sign-ins), last 7 / 30 / all days.
- `helpButton('audit', 'Activity')`.

### People (`#/users`)
- Buttons get words: "Reset password", "Extra access". Extra-access dialog lists grants as plain sentences (label first, code in a muted pill after).
- Role select shows the label ("Editor"), not the code.
- `helpButton('users', 'People')`.

### Plugin panels (`#/p/<key>`)
- Panels that are **settings only** (AI assist, Search, Analytics settings): render them under Settings → Apps instead of a rail page. Mechanism: in `nav.js`, a panel with `settingsOnly: true` (declare it in the plugin's panel registration — check `src/core/plugin.ts`, add the flag to the type; set it in `plugins/ai/index.ts` and `plugins/search/index.ts`) is not a rail item; WP-2's Apps settings page lists `state.meta.panels.filter(p => p.settingsOnly)` and renders them by calling the same `CUSTOM_SECTIONS`/`resourceSection` renderer — export a `renderPluginPanel(panel)` from views.js that `settings.js` can import. Search's "Reindex" button stays with the card.
- Generic resource tables: columns from the resource's first three fields (not "Item / ID"), a **New** button that says "New {singular}", row click edits, delete asks "Delete {title}? This can't be undone."
- Panel head gets `helpButton(panel.plugin, panel.label)`; add a generic `default` case in `contextTips()` (`src/server/help.ts`) returning three sentences built from the panel's resources (small out-of-scope edit).

## Acceptance

- Apps page on strongman: rows with switches; toggling "Forms" on shows a plain toast and the pending banner; the disclosure shows sentences, no bare codes at first glance.
- Deploy top zone shows the site URL and one primary button; developer details collapsed.
- Activity rows read as sentences; filters work.
- AI assist and Search are gone from the rail and appear under Settings → Apps.
- tests 48/48; typecheck count unchanged.
