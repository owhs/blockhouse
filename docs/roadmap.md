# Honest boundaries & roadmap

Everything in the README table runs today — v1.0 is a complete system, not a slice. These are the real edges, in rough priority order. Several items from the v0.1 list are now done (in-canvas editing, focal points, folders, live + static search, MCP server, member portal) and have been removed rather than left as aspirational.

**Engine**

- Liquid-lite covers the subset the shipped templates use (outputs + filters + kwargs, if/elsif/else/unless, for, assign, include, custom tags). Real LiquidJS can be swapped in behind `render/engine.ts` for full-spec needs (capture, case, cycle, `sort`/`where`). Same for `marked` behind `core/markdown.ts` if you want footnotes or tables in markdown.
- Plugin enable/permission changes apply on restart. Hot reload is a rebuild of the registry and routes — straightforward, not done.
- The path index and document listing scan flat files behind a per-request cache. Fine into the low thousands of documents; past that, an on-disk index is the fix. `getByAlias` and `getByShortCode` walk the same list, so they inherit the same ceiling.
- i18n / localised content is not started. The natural shape is per-locale files under a concept, with the URL layout gaining a locale segment.

**Studio**

- Rich text covers p / h2–h4 / bold / italic / code / links / lists / quotes, with a markdown source toggle for anything else. Tables and footnotes are markdown-only.
- The menu editor previews drafts on the real site via an in-memory draft buffer; two people editing the same menu simultaneously will race on that buffer (last save wins, as before).
- Content-type field changes are not migrations: renaming a field key leaves old values under the old key in existing documents. Add new keys rather than renaming where possible.
- Bulk alt-text across the asset library is not wired, though the AI plugin already exposes the `alt` task and the asset manager already supports multi-select.
- The block tree does not support drag-between-containers by mouse across deep nesting; use the inspector's structure panel for that.

**Members**

- Sessions are a signed cookie with no server-side revocation list, so blocking an account takes effect on the next request rather than instantly killing a live session. Adding a revocation table is a small change if you need it.
- There is no per-member content ownership model — gating is by group, not by row. For "only this customer sees this record", model it in the Data plugin with a relation and a public API key.

**Plugins**

- Newsletter sending loops through the mail driver serially. Fine for hundreds; needs batching or a queue (Workers Queues, or cron over a spool) beyond that.
- Automations run in-process at event time. Add a durable queue with retries for at-least-once delivery.
- Connectors store tokens in the secure store and refresh before expiry, but there is no background refresh — a token only renews when an action runs. A long-idle connector's first call after expiry pays a refresh round-trip.

**Static export**

- Member-only pages are deliberately excluded; there is no way to publish gated content flat, and there should not be.
- Mirrored aliases are written as real files so flat hosts work without redirect support, which means a mirrored page ships twice. That is the trade; use plain aliases (301s) if you would rather not.

**Ops**

- `blockhouse doctor` reads the local filesystem, so it is unavailable on Workers (the API endpoint returns 501 there). Run it against the project before deploying rather than against the deployed Worker.
- The page-weight budget measures what the HTML references, not what JavaScript fetches at runtime. Third-party embeds are counted as one request each, not by their real payload.

**Tests**

- Core logic is covered: expressions, sanitizer, permissions, templating, markdown, hashing, URL strategy, access control, config layering, slug/alias handling, deploy presets. API-level flows are exercised as scripted HTTP runs during development but are not yet a checked-in integration suite — that is the most valuable next addition.
