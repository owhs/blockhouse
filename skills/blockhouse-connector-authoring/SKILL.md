---
name: blockhouse-connector-authoring
description: Add a new third-party service to Blockhouse's Integrations plugin — OAuth2, API key, webhook or unauthenticated. One `ConnectorDef` object yields the admin card, the OAuth authorize/callback dance, encrypted token storage with automatic refresh, a connection test, and automation actions named `<connector>.<action>`. Use when the user wants to connect a service Blockhouse doesn't ship with (Slack, HubSpot, Stripe, QuickBooks, Notion, Airtable, an internal API…) or to extend an existing connector with new actions.
---

# Writing a Blockhouse connector

Every integration in Blockhouse is one object in `plugins/integrations/connectors.ts`. The framework supplies everything around it: the settings card in the studio, the `/connect` → provider → `/callback` flow with CSRF-protected `state`, token storage, refresh 60 seconds before expiry, secret masking in API responses, and automatic registration of each action as an automation step. Ship the object; you get the system.

## The shape

```ts
export const slack: ConnectorDef = {
  id: 'slack',
  name: 'Slack',
  description: 'Post messages into a channel when something happens on the site.',
  icon: 'send',                    // any name from the studio icon set
  auth: 'oauth2',                  // 'oauth2' | 'apikey' | 'webhook' | 'none'
  docs: 'Create an app at api.slack.com/apps → OAuth & Permissions, add the redirect URI shown below, then paste the client id/secret.',

  settings: [
    { key: 'clientId',     label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
    { key: 'defaultChannel', label: 'Default channel', help: '#general' },
  ],

  oauth: {
    authUrl:  'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes:   ['chat:write', 'channels:read'],
    extraAuthParams: { user_scope: '' },
    identify: async ctx => (await (await ctx.fetch('https://slack.com/api/auth.test')).json()).team,
  },

  test: async ctx => {
    const r = await ctx.fetch('https://slack.com/api/auth.test')
    const d = await r.json()
    return { ok: !!d.ok, detail: d.ok ? `Connected to ${d.team}` : d.error || 'Connection failed' }
  },

  actions: [{
    key: 'post_message',
    label: 'Post a Slack message',
    description: 'Send a message to a channel.',
    fields: [
      { key: 'channel', label: 'Channel', help: 'Defaults to the connector setting' },
      { key: 'text',    label: 'Message', type: 'textarea', required: true,
        help: 'Supports {{payload.field}} interpolation' },
    ],
    run: async (ctx, opts, payload) => {
      const res = await ctx.fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: opts.channel || ctx.config.defaultChannel,
          text: ctx.interpolate(opts.text, payload),
        }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(`slack: ${d.error}`)
      return { ts: d.ts, channel: d.channel }
    },
  }],
}
```

Then add it to the exported registry at the bottom of the file. It appears in the studio, in the automations action list as `slack.post_message`, and in `blockhouse doctor`'s plugin report — no other wiring.

## What each auth kind gives you

**`oauth2`** — the full dance. The studio shows Connect/Disconnect, `/connect` stores a signed `state` token and redirects to `authUrl`, `/callback` exchanges the code at `tokenUrl` and persists `{access_token, refresh_token, expires_at, …}`. `ctx.fetch` attaches the bearer token and refreshes it transparently. Use `identify` to show *which* account is connected — "Connected" alone is not enough when someone is debugging.

**`apikey`** — declare the key as a `secret: true` setting. `ctx.fetch` applies it however you specify; if the service wants something unusual, do it inside `run` with `ctx.config`.

**`webhook`** — no outbound auth; the connector holds a target URL (Zapier catch hooks work this way). Still give it a `test` that posts a ping.

**`none`** — public APIs. Rare, but keeps the same action shape.

## Rules that keep connectors trustworthy

Mark every credential `secret: true`. Secrets are masked as `••••••••` in API responses and preserved when a save comes back with the mask, so an admin editing an unrelated setting cannot accidentally blank a key.

Never log tokens. `ctx.log` goes to the automation run record, which admins read.

Throw on failure with a message a non-developer can act on — `throw new Error('xero: invoice rejected — contact has no email')` beats a raw 400 body. Automations record the message against the run.

Return something useful from `run`. The return value lands in the automation payload, so a later step can use it (`{{steps.slack.ts}}`).

Keep `test` cheap and read-only. It runs whenever someone clicks Test in the studio.

Interpolate user-supplied templates with `ctx.interpolate(tpl, payload)` rather than string concatenation — it handles missing keys predictably and does not evaluate code.

## Permissions

The Integrations plugin already holds `net.fetch`, `secure.tables`, `settings.own`, `actions.register`, `routes.api` and `routes.public`. A new connector needs no new grants. If your service requires something outside that set — writing content, sending mail through Blockhouse's own driver, managing private files — that is a sign it belongs in its own plugin; see `blockhouse-plugin-dev`.

## Testing without the real service

Point `authUrl`/`tokenUrl` at a local stub and walk the flow, or set `auth: 'apikey'` temporarily and exercise `run` directly. Confirm three things before shipping: a fresh connect stores a refresh token, an expired access token refreshes silently mid-action, and Disconnect actually clears stored credentials.
