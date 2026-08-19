---
name: blockhouse-plugin-dev
description: Create or modify a Blockhouse plugin — add blocks, automation actions, admin resource panels, public/root/API routes, secure data, mail, and events, all through the capability-based permission kernel. Use when the user wants new backend functionality, an integration, a custom admin tool, or to extend an existing Blockhouse plugin.
---

# Blockhouse plugin development

A plugin is a folder with a manifest and a `register(ctx)` function. It never touches stores directly — it receives a `ctx` whose every capability is gated by a permission the admin must approve. Declare only what you need.

```ts
// plugins/my-plugin/index.ts
import type { PluginContext } from '../../src/core/plugin.ts'
import type { PluginManifest } from '../../src/core/types.ts'

export const manifest: PluginManifest = {
  id: 'my-plugin', name: 'My Plugin', version: '0.1.0',
  permissions: ['blocks.register', 'routes.public', 'secure.tables', 'settings.own'],
}

export function register(ctx: PluginContext) { /* … */ }
```

Register it in `plugins/index.ts` (or pass via `buildEnv({ pluginModules })`). Enable + approve permissions in Studio → Plugins (stored in `site.json`, so it's reviewable in git). **Permission changes apply on server restart.**

## The `ctx` surface (each key needs its permission)

| Need | Permission | API |
| --- | --- | --- |
| A content block | `blocks.register` | `ctx.blocks.register({ type, label, group, icon, fields, render(ctx,node,inner) })` |
| An automation action | `actions.register` | `ctx.actions.register({ type, label, run(opts, payload, ctx) })` |
| Admin CRUD panel | (implicit) | `ctx.resources.register({ key, label, fields, storage: 'json'|'secure', titleField })` → auto grid + forms + REST at `/api/res/<id>/<key>` |
| Public routes `/x/<id>/*` | `routes.public` | `ctx.routes.public(app => app.get('/thing', c => c.json(...)))` |
| Short root routes `/…` | `routes.root` | `ctx.routes.root(app => app.get('/s/:code', …))` |
| Guarded admin API `/api/x/<id>/*` | `routes.api` | `ctx.routes.api(app => …)` (session + `plugin:<id>.manage`) |
| Private data | `secure.tables` | `ctx.store.rows('table').{list,get,insert,update,remove}`, `ctx.store.kvGet/kvSet` |
| Gittable JSON under `site/<id>/` | `settings.own` | `ctx.json.{list,get,save,remove}` |
| Send email | `mail.send` | `ctx.mail.send({ to, subject, text, html })` |
| Outbound HTTP | `net.fetch` | `ctx.fetch(url, init)` |
| Events | `events.listen` / `events.emit` | `ctx.events.on('*', (payload, event) => …)`, `ctx.events.emit('thing', {...})` |
| Read/write content | `content.read` / `content.write` | `ctx.content.*` |

`ctx.env` exposes the full env for advanced use (content store, secure store, site config, liquid). `ctx.util.id()`, `ctx.util.now()` for ids/timestamps.

## Fields & computed values

Resource/block fields use the same schema as everywhere (`text number currency date select multiselect boolean relation computed lineitems list json image link …`). `computed` fields evaluate a **safe expression** (no eval): arithmetic, `round/floor/min/max/if/concat`, and aggregates `sum(items,'total') count(items) avg(items,'qty')`. This is how the quote calculator totals line-items.

Field `optionsSource: 'res:<plugin>/<key>'` populates a select from another resource's rows (e.g. a block that lists the plugin's own forms).

## Events you can hook

`content.saved/published/unpublished`, `form.submitted`, `media.uploaded`, `newsletter.subscribed`, `data.row.created/updated`, `data.state.changed`, `file.downloaded`, `webhook.received`, `user.created`. Emit your own as `<pluginId>.<event>`. The automations plugin listens to `*` and runs recipes, so emitting events makes your plugin scriptable by users.

## Patterns

- **Instant admin tool:** just `ctx.resources.register(...)` — you get a grid, create/edit dialogs, and a REST API with zero UI code.
- **A public form/endpoint:** `routes.public` + `secure.tables` to store, then `ctx.events.emit(...)` so automations can react.
- **An integration:** `routes.api` to expose config, `net.fetch` to call out, an `actions.register` action so it's usable in automation recipes.

## Verify

`blockhouse dev`, enable + approve the plugin, exercise its routes/blocks. Unapproved capabilities throw `PermissionError` — that's the kernel working. Add a couple of assertions to `tests/` for any pure logic (expression math, parsing).


## Round-6 capabilities (v1.3)

- **Site-local plugins:** drop `<project>/plugins/<id>/index.ts` (exports `manifest` + `register`) — loaded on boot (Bun/Node), same approval flow as built-ins. Distribute as a package zip with `blockhouse-package.json` checksums (`kind: "plugin"`); install via Plugins → Install plugin.
- **Settings sections:** `ctx.settingsSection({key, label, fields})` renders under Settings → Plugin settings; read values from `site.plugins.<id>.settings`.
- **Blocks that need JS:** call `c.collect.enhancers.add('<name>')` in render and add a `wants.has('<name>')` section to `src/assets/blockhouse/runtime.js`.
- **New built-ins to learn from:** `drive` (member-gated file areas, access requests, download tracking), `commerce` (server-priced carts, orders, stock, Stripe/manual, `commerce.order.*` events), `mdsync` (markdown import), `consent` (settings + block + assemble hook).
- **Member helpers:** `env.memberGate.resolve(c)` for sessions; `env.memberAdmin.addToGroup(email, group)` / `.byEmail(email)` to manage accounts.
- **Mail:** `ctx.mail.send()` rides the configured provider (console, resend, sendgrid, postmark, mailchannels, webhook) — test at Settings → Mail.
