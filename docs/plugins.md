# Plugins & the permission model

A plugin is a folder with a manifest and a register function:

```ts
export const manifest = {
  id: 'greeter', name: 'Greeter', version: '0.1.0',
  permissions: ['blocks.register', 'routes.public', 'secure.tables'],
}
export function register(ctx: PluginContext) { /* … */ }
```

Register it in `plugins/index.ts` (or pass via `buildEnv({ pluginModules })`).

## Authorization flow

1. The manifest **declares** permissions — the full list it could ever use.
2. An admin **enables** the plugin and **approves** permissions in Studio → Plugins (stored in `site.json → plugins[id].approved`, so approvals are gittable and reviewable).
3. The kernel builds the plugin's context **capability-style**: each API namespace checks its permission at call time. An unapproved capability throws `PermissionError` — there is no way to reach stores, mail, or network except through the granted surface.

This is stronger than "hooks + trust": a forms plugin that never asked for `net.fetch` cannot exfiltrate submissions, even if compromised.

## The context surface

| Capability | API |
| --- | --- |
| `blocks.register` | `ctx.blocks.register(def)` — appears in the editor picker |
| `actions.register` | `ctx.actions.register({type, run})` — usable by automations *and* form actions |
| `routes.public` / `routes.root` / `routes.api` | mount routers at `/x/<id>`, `/` (short links), `/api/x/<id>` (session + `plugin:<id>.manage` guarded) |
| `secure.tables` | namespaced kv + row tables in the secure store |
| `settings.own` + `ctx.json.*` | gittable JSON documents under `site/<id>/…` |
| `mail.send` | configured mail driver (console/webhook/resend) |
| `net.fetch` | outbound HTTP |
| `events.listen/emit` | the event bus (emits are namespaced `<id>.<event>`) |
| `content.read/write` | ContentStore access |

## Instant admin UIs

`ctx.resources.register({ key, label, fields, storage: 'json'|'secure' })` gives a plugin a full CRUD panel in the studio (list + auto-form dialogs) and REST endpoints at `/api/res/<plugin>/<key>` — including **computed fields** evaluated with the safe expression engine. The data plugin's quote calculator is exactly this: `round(qty * unit * (1 - discount/100), 2)`.

Field definitions support `optionsSource: 'res:<plugin>/<key>'` so a block's select can list the plugin's own documents (that's how the Form block lists forms).

## User-facing permissions

Plugin admin routes default to `plugin:<id>.manage`, which editors have via `plugin:*`. Grant finer scopes per user with `grants: ["plugin:data.manage"]`.
