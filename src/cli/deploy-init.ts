// `blockhouse deploy:init <target>` — writes the boring-but-fiddly files for each way
// of running Blockhouse, filled in from the project's own config so they work as
// written rather than needing a search-and-replace pass.
//
// Targets: docker · systemd · caddy · nginx · cloudflare · pages · github

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import type { SiteConfig } from '../core/types.ts'

export const TARGETS = ['docker', 'systemd', 'caddy', 'nginx', 'cloudflare', 'pages', 'github'] as const
export type Target = typeof TARGETS[number]

export interface Written { file: string; skipped: boolean }

export function deployInit(dir: string, target: Target, site: SiteConfig, opts: { force?: boolean } = {}): Written[] {
  const files = FILES[target](dir, site)
  const out: Written[] = []
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    if (existsSync(abs) && !opts.force) { out.push({ file: rel, skipped: true }); continue }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
    out.push({ file: rel, skipped: false })
  }
  return out
}

const host = (site: SiteConfig) => { try { return new URL(site.url).hostname } catch { return 'example.com' } }
const slug = (dir: string) => basename(dir).replace(/[^a-zA-Z0-9-]/g, '-') || 'blockhouse-site'

const FILES: Record<Target, (dir: string, site: SiteConfig) => Record<string, string>> = {

  // ---------- containers ----------
  docker: (dir, site) => ({
    'Dockerfile': `# Blockhouse has no runtime dependencies, so the image is mostly just Bun + your project.
FROM oven/bun:1-alpine AS base
WORKDIR /app

# sharp is optional: it turns on resizing, WebP and watermarking. Drop this
# stage (and the COPY below) if you pre-generate variants with \`blockhouse export\`.
FROM base AS deps
COPY package.json ./
RUN bun install --production --no-save sharp || echo "continuing without sharp"

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV BLOCKHOUSE_ENV=production
ENV PORT=8787
EXPOSE 8787

# .blockhouse holds the cookie secret and the SQLite user database — keep it on a volume.
VOLUME ["/app/.blockhouse", "/app/media"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \\
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["bun", "src/cli/index.ts", "serve", "--dir", ".", "--port", "8787"]
`,
    '.dockerignore': `.git
.blockhouse
dist
node_modules
*.log
`,
    'docker-compose.yml': `services:
  blockhouse:
    build: .
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      BLOCKHOUSE_ENV: production
      BLOCKHOUSE_SITE_URL: ${site.url}
      # Generate once with: openssl rand -hex 32
      BLOCKHOUSE_SECRET: \${BLOCKHOUSE_SECRET:?set BLOCKHOUSE_SECRET in .env}
      # BLOCKHOUSE_MAIL_DRIVER: smtp
      # BLOCKHOUSE_MAIL_FROM: hello@${host(site)}
      # BLOCKHOUSE_MAIL_OPTIONS: '{"host":"smtp.example.com","port":587,"user":"…","pass":"…"}'
    volumes:
      - blockhouse-state:/app/.blockhouse
      - ./media:/app/media
      - ./site:/app/site
volumes:
  blockhouse-state:
`,
    '.env.example': `# Copy to .env — docker compose reads it automatically. Never commit .env.
BLOCKHOUSE_SECRET=replace-with-openssl-rand-hex-32
BLOCKHOUSE_SITE_URL=${site.url}
`,
  }),

  // ---------- bare metal ----------
  systemd: (dir, site) => ({
    [`deploy/${slug(dir)}.service`]: `[Unit]
Description=Blockhouse — ${site.name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=blockhouse
Group=blockhouse
WorkingDirectory=${dir}
Environment=BLOCKHOUSE_ENV=production
Environment=PORT=8787
Environment=BLOCKHOUSE_SITE_URL=${site.url}
# systemd-creds or an EnvironmentFile keeps the secret out of the unit:
EnvironmentFile=-/etc/blockhouse/${slug(dir)}.env
ExecStart=/usr/local/bin/bun ${dir}/src/cli/index.ts serve --dir ${dir} --port 8787
Restart=on-failure
RestartSec=3

# Hardening — Blockhouse only needs to write .blockhouse/, media/ and site/.
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
ReadWritePaths=${dir}/.blockhouse ${dir}/media ${dir}/site
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
`,
    'deploy/README.md': `# Running ${site.name} with systemd

    sudo useradd --system --home ${dir} --shell /usr/sbin/nologin blockhouse
    sudo chown -R blockhouse:blockhouse ${dir}
    sudo install -d -m 750 -o root -g blockhouse /etc/blockhouse
    printf 'BLOCKHOUSE_SECRET=%s\\n' "$(openssl rand -hex 32)" | sudo tee /etc/blockhouse/${slug(dir)}.env
    sudo chmod 640 /etc/blockhouse/${slug(dir)}.env

    sudo cp deploy/${slug(dir)}.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now ${slug(dir)}

Logs: \`journalctl -u ${slug(dir)} -f\`. Then put a TLS terminator in front —
\`blockhouse deploy:init caddy\` writes a two-line Caddyfile that handles certificates
for you.

Scheduled publishing (documents with a future \`publishAt\`) needs a nudge:

    */5 * * * * cd ${dir} && /usr/local/bin/bun src/cli/index.ts publish:due --dir ${dir}
`,
  }),

  // ---------- reverse proxies ----------
  caddy: (_dir, site) => ({
    'deploy/Caddyfile': `# Caddy fetches and renews certificates automatically.
${host(site)} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787

	# Blockhouse already sets its own security headers (see settings → Security);
	# this one belongs to the terminator because only it knows TLS is on.
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"

	# Long-cache fingerprinted assets, let pages revalidate.
	@immutable path /assets/* /media/_var/*
	header @immutable Cache-Control "public, max-age=31536000, immutable"
}
`,
  }),

  nginx: (dir, site) => ({
    [`deploy/${slug(dir)}.nginx.conf`]: `server {
  listen 443 ssl http2;
  server_name ${host(site)};

  ssl_certificate     /etc/letsencrypt/live/${host(site)}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${host(site)}/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  client_max_body_size 64m;   # media uploads
  gzip on;
  gzip_types text/css application/javascript image/svg+xml application/json;

  location ~* ^/(assets|media/_var)/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_cache_valid 200 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # dev live-reload uses SSE; don't buffer it
    proxy_buffering off;
    proxy_read_timeout 120s;
  }
}

server {
  listen 80;
  server_name ${host(site)};
  return 301 https://$host$request_uri;
}
`,
  }),

  // ---------- cloudflare ----------
  cloudflare: (dir, site) => ({
    'wrangler.toml': `name = "${slug(dir)}"
main = "src/server/worker.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
BLOCKHOUSE_ENV = "production"
BLOCKHOUSE_SITE_URL = "${site.url}"

# The project layout (site/, media/, templates/) lives in R2.
[[r2_buckets]]
binding = "SITE"
bucket_name = "${slug(dir)}-content"

# Users, sessions, tokens and plugin tables.
[[d1_databases]]
binding = "DB"
database_name = "${slug(dir)}-secure"
database_id = "REPLACE_WITH_D1_ID"

# Optional second bucket for the studio's own assets; omit to embed them.
# [[r2_buckets]]
# binding = "ASSETS"
# bucket_name = "${slug(dir)}-assets"

[observability]
enabled = true

[env.staging]
name = "${slug(dir)}-staging"
[env.staging.vars]
BLOCKHOUSE_ENV = "staging"
BLOCKHOUSE_SITE_URL = "https://staging.${host(site)}"
`,
    'deploy/cloudflare.md': `# Running ${site.name} on Cloudflare Workers

    npx wrangler r2 bucket create ${slug(dir)}-content
    npx wrangler d1 create ${slug(dir)}-secure        # paste database_id into wrangler.toml
    npx wrangler secret put BLOCKHOUSE_SECRET               # openssl rand -hex 32

Push the project into the bucket (anything that speaks S3 works; rclone and the
AWS CLI both do):

    npx wrangler r2 object put ${slug(dir)}-content/site/site.json --file site/site.json
    # …or sync the whole site/, media/ and templates/ tree

Then:

    npx wrangler deploy                 # production
    npx wrangler deploy --env staging   # staging

Two settings matter on Workers:

* \`images.provider\` must be \`"cloudflare"\` — sharp is a native module and
  cannot run in a Worker. Cloudflare Image Resizing serves the same variant URLs.
* \`mail.driver\` must be an HTTP driver (resend, postmark, …). There are no raw
  sockets, so SMTP is unavailable.

For a purely static site, \`blockhouse export\` plus Cloudflare Pages is simpler and
cheaper — you lose forms, members, server-side search and analytics.
`,
  }),

  pages: (dir, site) => ({
    'deploy/pages.md': `# Static hosting for ${site.name}

    blockhouse export --dir . --out dist

\`dist/\` is a complete flat site: pre-rendered HTML, generated image variants,
sitemap, robots, RSS, a \`_redirects\` file (Cloudflare Pages and Netlify both
read it) and, if the search plugin is on, a prebuilt JSON index.

    npx wrangler pages deploy dist --project-name ${slug(dir)}

What a flat build does not include: forms, member sign-in, file downloads,
analytics collection and anything else that needs a server — those blocks
degrade to plain markup. Member-only pages are skipped entirely, since a static
host cannot check a cookie.

A common split is worth knowing about: publish the public site flat to a CDN and
keep a small server running the studio on an internal hostname.
`,
    'deploy/_headers': `# Cloudflare Pages / Netlify header rules for a flat build.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/media/_var/*
  Cache-Control: public, max-age=31536000, immutable
`,
  }),

  // ---------- CI ----------
  github: (dir, site) => ({
    '.github/workflows/blockhouse.yml': `name: blockhouse

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      # Content integrity: broken links, unknown blocks, duplicate paths.
      - run: bun src/cli/index.ts check --dir .
      # Page-weight budget — fails the build if a page gets fat.
      - run: bun src/cli/index.ts budget --dir . --fail
      - run: bun test tests/

  deploy:
    needs: check
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun src/cli/index.ts export --dir . --out dist
        env:
          BLOCKHOUSE_ENV: production
          BLOCKHOUSE_SITE_URL: ${site.url}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name ${slug(dir)}
`,
  }),
}
