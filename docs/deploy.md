# Deploying and operating Blockhouse

Run `blockhouse doctor --dir <site>` before anything else. It inspects the live install and prints a fix for every finding. `--env production` switches to the stricter deploy-readiness pass, `--target docker|cloudflare|static|server` adds target-specific checks, `--deep` includes page weight, `--json` is for CI. The same report is in the studio under **Deploy**.

## Picking a target

Blockhouse is the same `fetch(Request) → Response` application everywhere; what changes is the storage driver, the secure store and whether native image processing is available.

**Own server (Bun or Node).** Everything works. Put Caddy or nginx in front for TLS. State lives in `.blockhouse/` and `media/`.

**Docker.** Same as above, containerised. `.blockhouse/` and `media/` must be volumes or you lose users, sessions and uploads on every rebuild. Set `BLOCKHOUSE_SECRET` rather than relying on the generated `.blockhouse/secret`, so sessions survive a fresh container.

**Cloudflare Workers.** Content in R2 (`SITE` binding), users and sessions in D1 (`DB` binding). Two settings must change: `images.provider` to `"cloudflare"` because sharp is a native module that cannot run in a Worker, and `mail.driver` to something HTTP-based (resend, postmark) because there are no raw sockets. Put the secret in with `wrangler secret put BLOCKHOUSE_SECRET`, never in `[vars]`.

**Flat export.** `blockhouse export` writes plain HTML, generated image variants, sitemap, robots, RSS, a `_redirects` file and (with the search plugin on) a prebuilt JSON index. Forms, members, file delivery, server-side search and analytics all need a server; blocks that require one degrade to plain markup, and member-only pages are skipped entirely — a static host cannot check a cookie, so exporting them would publish them.

A common arrangement is to publish the public site flat to a CDN and keep a small server running the studio on an internal hostname.

`blockhouse deploy:init <docker|systemd|caddy|nginx|cloudflare|pages|github>` writes the files for each of these, interpolated from the project's own config. Existing files are never overwritten unless you pass `--force`.

## Configuration layers

```
DEFAULT_CONFIG → site/site.json → site/site.<BLOCKHOUSE_ENV>.json → .blockhouse/local.json → BLOCKHOUSE_* vars
```

Each layer deep-merges over the one before it, so a `site.production.json` containing only `{"url": "…", "security": {"hsts": true}}` inherits every other default rather than replacing the security block wholesale.

`site/site.json` is the shared committed config. `site/site.production.json` (or `.staging.json`, or any `BLOCKHOUSE_ENV` value) is committed and holds per-environment differences. `.blockhouse/local.json` is gitignored and holds machine-local tweaks that should never reach anyone else. `BLOCKHOUSE_*` variables win over all of it, which is what containers, CI and Worker bindings want.

Recognised variables: `BLOCKHOUSE_ENV`, `BLOCKHOUSE_SECRET`, `BLOCKHOUSE_SITE_URL`, `BLOCKHOUSE_SITE_NAME`, `BLOCKHOUSE_TEMPLATE`, `BLOCKHOUSE_MAIL_DRIVER`, `BLOCKHOUSE_MAIL_FROM`, `BLOCKHOUSE_MAIL_OPTIONS` (JSON), `BLOCKHOUSE_HSTS`, `BLOCKHOUSE_CSP`, `BLOCKHOUSE_ADMIN_ALLOWLIST`.

## State and backups

`site/` and `media/` are your content. `site/` is flat JSON, so git is a real backup with a real history; `media/` needs a file sync. `media/_var/` holds generated derivatives and is safe to delete — it rebuilds on demand.

`.blockhouse/secure.db` holds users, sessions, tokens, form submissions and plugin tables. It is not in git and must be backed up separately. `.blockhouse/secret` signs session cookies: losing it logs everyone out, committing it lets anyone forge a session. In any environment where the filesystem is ephemeral, set `BLOCKHOUSE_SECRET` instead.

## Hardening

Under `security` in site.json:

`csp` — `off`, `balanced` (allows first-party inline scripts, which is what most sites need) or `strict` (nonces only; verify custom JS still runs). `hsts` — turn on once every subdomain serves https. `frameAncestors`, `referrerPolicy`, `permissionsPolicy` — sent on every response. `pbkdf2Iterations` — 210,000 by default, per OWASP. `maxLoginAttempts` + `lockoutMinutes` — throttles credential stuffing. `adminAllowlist` — IPv4 CIDRs; when set, the studio is unreachable from anywhere else. `auditLog` — records logins, publishes and permission changes. `minPasswordLength`.

On the site side, documents carry an `access` mode (`public`, `members`, or specific groups) enforced in the router and honoured by listings, menus, related blocks, search, sitemaps, feeds and exports. Gating **fails closed**: if the Members plugin is disabled while pages are still marked member-only, those pages return 404 rather than quietly becoming public, and `blockhouse doctor` flags it.

On the studio side, plugin permissions are approved one by one and `doctor` reports drift between what a plugin requests and what it was granted. Modules can be hidden globally or per role under Settings → Interface.

## Publishing

The live site renders only from `site/content/.published/`. Editing a working copy changes the draft; publishing writes the snapshot. `blockhouse export --stage` includes drafts; without it, only published documents.

Documents with a future `publishAt` need something to notice they are due:

```
*/5 * * * * cd /srv/site && bun src/cli/index.ts publish:due --dir /srv/site
```

## Page weight

`blockhouse budget` renders every published page and measures the document plus the CSS, JS and images it references, against `build.budget` in site.json (defaults: 100 kB HTML, 120 kB CSS, 100 kB JS, 300 kB total excluding images, 30 requests). `--fail` turns it into a CI gate; the generated GitHub Actions workflow already runs it that way.

## Maintenance mode

Settings → System pages. When on, the public site answers 503 with `Retry-After` (so search engines wait rather than de-indexing), while the studio, its API, assets, `/healthz` and any allow-listed paths keep working. Assign a document as the maintenance page and it is built from blocks like anything else; otherwise a plain message is used.

## Health checks

`/healthz` returns `{ok, name, env, mode}` as JSON. It is registered before authentication and before the security middleware, touches nothing sensitive, and returns 503 if the site config fails to load — which is exactly what an orchestrator or uptime monitor wants.
