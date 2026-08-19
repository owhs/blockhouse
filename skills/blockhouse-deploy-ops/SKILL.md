---
name: blockhouse-deploy-ops
description: Deploy, run and operate a Blockhouse site — local dev, a server behind a proxy, Docker, Cloudflare Workers, or a flat static build. Covers the layered config system (site.json → site.<env>.json → .blockhouse/local.json → BLOCKHOUSE_* vars), security hardening, `blockhouse doctor`, page-weight budgets, backups, and what breaks on each target. Use when the user wants to ship a site, harden an install, set up staging, debug a deployment, or choose between hosting options.
---

# Deploying and running Blockhouse

Start with `blockhouse doctor --dir <site>` — it inspects the live install (runtime, config layers, secrets, security posture, plugin grants, content integrity, deploy readiness) and prints a fix for each problem. Add `--env production` for the stricter deploy-readiness pass, `--target cloudflare|docker|static|server` for target-specific checks, `--deep` to include page weight, `--json` for CI.

## Choosing a target

| | Server (Bun/Node) | Docker | Cloudflare Workers | Flat export |
|---|---|---|---|---|
| Forms, members, file delivery | ✅ | ✅ | ✅ | ❌ |
| Server-side search, analytics | ✅ | ✅ | ✅ | index-only |
| Image processing | sharp | sharp | CF Image Resizing | pre-generated |
| Secure store | SQLite | SQLite (volume) | D1 | n/a |
| Storage | filesystem | volume | R2 | n/a |

A common split: publish the public site flat to a CDN, keep a small server running the studio on an internal hostname.

`blockhouse deploy:init <docker|systemd|caddy|nginx|cloudflare|pages|github>` writes the files for each, filled in from the project's own config. They are starting points — read them before committing.

## Layered configuration

Lowest priority first:

```
DEFAULT_CONFIG  →  site/site.json  →  site/site.<BLOCKHOUSE_ENV>.json  →  .blockhouse/local.json  →  BLOCKHOUSE_* vars
```

`site/site.json` is committed and shared. `site/site.production.json` is committed and holds per-environment overrides (real URL, mail driver, `security.hsts`). `.blockhouse/local.json` is gitignored and holds machine-local tweaks. `BLOCKHOUSE_*` vars win over everything, which is what containers and CI want. `blockhouse doctor` prints which layers are actually in play, so a surprising value is traceable.

Recognised vars: `BLOCKHOUSE_ENV`, `BLOCKHOUSE_SECRET`, `BLOCKHOUSE_SITE_URL`, `BLOCKHOUSE_SITE_NAME`, `BLOCKHOUSE_TEMPLATE`, `BLOCKHOUSE_MAIL_DRIVER`, `BLOCKHOUSE_MAIL_FROM`, `BLOCKHOUSE_MAIL_OPTIONS` (JSON), `BLOCKHOUSE_HSTS`, `BLOCKHOUSE_CSP`, `BLOCKHOUSE_ADMIN_ALLOWLIST`.

## State that must survive a restart

`.blockhouse/secret` signs session cookies — losing it logs everyone out; committing it lets anyone forge a session. In containers set `BLOCKHOUSE_SECRET` instead so it lives with your secrets manager. `.blockhouse/secure.db` holds users, sessions, tokens and plugin tables; it needs a volume. `site/` and `media/` are the content — back them up with git plus a media sync, or snapshot the whole project directory.

## Hardening

`security` in site.json: `csp` (`balanced` allows first-party inline scripts, `strict` uses nonces), `hsts`, `frameAncestors`, `referrerPolicy`, `permissionsPolicy`, `pbkdf2Iterations` (≥210,000), `maxLoginAttempts` + `lockoutMinutes`, `adminAllowlist` (IPv4 CIDRs — the studio becomes unreachable from anywhere else), `auditLog`, `minPasswordLength`.

Site-side: pages can be gated with `access` (`public`/`members`/`groups`) enforced in the router, excluded from exports, sitemap, feeds and search. Gating fails closed — if the Members plugin is disabled, a member-only page 404s rather than opening up.

Studio-side: plugin permissions are approved individually and `blockhouse doctor` reports drift between what a plugin requests and what it was granted. Modules can be hidden per role under Settings → Interface.

## Cloudflare specifics

Two settings must change: `images.provider` = `"cloudflare"` (sharp is a native module and cannot run in a Worker) and `mail.driver` must be HTTP-based (resend, postmark) since there are no raw sockets. `wrangler.toml` needs an R2 binding named `SITE` and a D1 binding named `DB`; put the secret in with `wrangler secret put BLOCKHOUSE_SECRET`, never in `[vars]`. Push `site/`, `media/` and `templates/` into the bucket with any S3-compatible sync.

## Publishing and staging

The live site renders only from `site/content/.published/`. `blockhouse export --stage` builds drafts included; without it, only published documents. Scheduled documents (`publishAt` in the future) need a nudge: run `blockhouse publish:due` from cron every few minutes.

## Page weight

`blockhouse budget --dir <site>` renders every published page and measures HTML, CSS, JS, images and request count against `build.budget` in site.json. `--fail` makes it a CI gate. The same report is in the studio under Deploy. A stock Blockhouse page including a full mega menu lands around 80 kB total.

## When something is wrong

`blockhouse doctor` first. Then: `/healthz` returns JSON without touching auth, so orchestrators and uptime checks can use it. `blockhouse check` validates content integrity alone. The dev server watches the project and pushes reloads over SSE — behind nginx that needs `proxy_buffering off`.


## Round-6 capabilities (v1.3)

- **Deploy targets:** saved staging/production profiles with AES-GCM-sealed credentials, per-role gates, Test + one-click runs (Deploy view). Staging exports include drafts into `<out>-staging`.
- **Security hardening:** `security.adminPath` renames the studio path (old /admin 404s); `security.private: "staging"` hides the whole site from anonymous visitors (redirect via `privateRedirect`) while the studio stays reachable — the safety net for staging boxes; `security.errorLog` (default on) writes `.blockhouse/logs/error.log`, tail at Settings → Security.
- **Self-probe:** Settings → Security → "Probe my public URL" (or `POST /api/security/probe`) fetches /.blockhouse/secret, /.git/config, /.env, site JSON and private media from the outside — everything must be non-200. `blockhouse doctor` warns when a dev-mode instance carries a public URL.
- **Password recovery:** `blockhouse user:reset --email x` (CLI) or the login page's "Forgot password?" (emailed one-time link). Never delete `.blockhouse/` to get back in.
- **Trusted issuers:** pin sellers' Ed25519 public keys in `security.trustedIssuers` so theme/plugin packages verify origin at install.
