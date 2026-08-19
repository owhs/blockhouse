# Architecture

Blockhouse is a set of small modules assembled into a `BlockhouseEnv` per running app. Nothing global; everything reachable from the env.

```
┌ storage/driver  StorageDriver: fs · memory · R2 · FSA(browser, experimental)
├ storage/content ContentStore: docs/concepts/menus/redirects as flat JSON,
│                 publish snapshots (.published), versions, path index
├ secure/         SecureStore over a tiny SQL adapter: bun:sqlite · node:sqlite ·
│                 D1 · JSON fallback — users, sessions, tokens, kv, rows, logs
├ core/           types · events (async bus) · permissions (roles+grants) ·
│                 registry (blocks/actions/mail/resources) · plugin kernel ·
│                 safe expressions · sanitizer · markdown
├ render/         engine (Liquid-lite + tags/filters) · block renderer (+editor
│                 annotations) · menus/mega · seo head+jsonld+sitemap+rss · <picture>
├ images/         MediaStore: upload pipeline, on-demand variants, watermark
├ server/         vendor/http router → app.ts composes: session/CSRF middleware,
│                 studio shell, preview, REST API, plugin routes, public site
├ export/         static.ts: render published pages → dist/ (+_redirects, variants)
└ cli/            init · dev(watch+SSE reload) · serve · export · seed · user:add
```

## Requests

**Live site** — `GET /*` → redirects → concept index pages → path index (publish snapshots only) → slug-history 301 → 404. Rendering: concept template (Liquid) produces the main region; `layout.liquid` wraps it; the head builder injects SEO/JSON-LD collected during block rendering; tokens/theme boot/speculation rules are appended.

**Preview** — `/preview/:id` renders the *working copy* for signed-in users; `?editor=1` annotates each block's root element with `data-wb` and injects the bridge script so the studio can select blocks in place.

**Studio** — one HTML shell + ES modules, no build step. All state flows through `/api/*` (session cookie + `x-blockhouse-csrf` double-submit header).

## Storage decisions

Content is deliberately boring: one JSON file per document, pretty-printed, stable ordering — designed for git diffs. Publishing copies the file into `site/content/.published/`; the live site *only* reads snapshots, so drafts are never leakable. Versions are capped copies under `site/.versions/<docId>/`.

The secure store handles the few things that don't belong in git (credentials, sessions, tokens — stored hashed — submissions, plugin rows). The same `SqlAdapter` interface runs on `bun:sqlite`, `node:sqlite`, or D1.

## Runtime portability

Everything speaks `fetch(Request) → Response` (vendored router), WebCrypto (PBKDF2, HMAC, SHA-256), and the StorageDriver interface. That is the whole trick behind "runs on Bun, Node, and Workers from one codebase". sharp is the only native/optional dependency, used solely for image derivatives, with graceful degradation without it.

## Events

Everything interesting emits: `content.saved/published`, `form.submitted`, `media.uploaded`, `newsletter.subscribed`, `data.row.created`, `file.downloaded`, `webhook.received`, `user.created`. The automations plugin subscribes with `*` and matches recipes; other plugins can subscribe with the `events.listen` permission.
