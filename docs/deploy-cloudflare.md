# Deploying on Cloudflare (and everywhere else)

Blockhouse has three deployment shapes — pick per project, same content either way.

## 1. Flat static (Cloudflare Pages, Netlify, any host)

```
blockhouse export --dir sites/mysite        # → sites/mysite/dist
npx wrangler pages deploy sites/mysite/dist
```

The export contains every published page as plain HTML, all assets, pre-generated image variants, `sitemap.xml`, `robots.txt`, RSS feeds, `404.html`, and a `_redirects` file (explicit redirects + automatic slug-history 301s). `--stage` exports working copies for a staging preview.

Tip: add an automation recipe `on: content.published → webhook` pointing at a Pages deploy hook and publishing in the studio triggers a rebuild.

## 2. Live server (VPS / container)

`blockhouse serve --dir sites/mysite` behind any reverse proxy. Bun or Node ≥20. State: the site folder + `.blockhouse/` (SQLite + secret). Back up both; the site folder is just a git repo.

## 3. Cloudflare Workers (fully serverless live site)

`src/server/worker.ts` is the entry. Bindings:

```toml
# wrangler.toml (see wrangler.example.toml)
main = "src/server/worker.ts"
compatibility_date = "2026-01-01"

[[r2_buckets]]
binding = "SITE"          # holds the project layout: site/**, media/**, templates/**
bucket_name = "my-blockhouse-site"

[[d1_databases]]
binding = "DB"            # secure store
database_name = "blockhouse"
database_id = "…"

# npx wrangler secret put BLOCKHOUSE_SECRET
```

Upload your project folder to the bucket (`wrangler r2 object put`/rclone/S3 sync — same layout as on disk, plus `templates/<name>/**`). Set `site.json → images.provider = "cloudflare"` so `<picture>` URLs use `/cdn-cgi/image/…` transforms instead of sharp. D1 gets the schema automatically on first request.

Notes: static assets are served from R2 through the Worker (put Cloudflare cache in front, or serve `/assets/*` from Pages); the studio works against the same Worker. Because content writes go to R2 instead of git, treat Workers mode as "live-edit" hosting — or keep authoring locally and sync to R2 on publish.

## Mail

`site.json → mail`: `console` (dev), `webhook` (POST JSON to any mailer/automation), or `resend` (`options.apiKey`) — all Workers-compatible. Antispam: honeypot + minimum-fill-time are built into forms; add Cloudflare Turnstile in front at the proxy layer if you need more.
