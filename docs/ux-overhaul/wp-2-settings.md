# WP-2 — Settings, restructured

Owner files: NEW `src/assets/admin/settings.js` (you create it by moving the settings view and its section helpers out of `views.js` lines 517–1154: `registerView('settings'…)`, `brandSection`, `schemeSection`, `systemPagesSection`, `urlsSection`, `MODULE_LIST`, `modulesSection`, `securitySection`, `fontsSection`, `codeSection`, `buildSection`), `src/assets/admin/catalog.js` (whole, 111 lines), `src/assets/admin/concepts.js` (only to embed it — grep `registerView('concepts'` and see what it exports/needs), `src/assets/admin/main.js` (add `import './settings.js'` next to the other view imports, and route `types` → keep working), `src/assets/admin/studio.css` (settings rules at the end under `/* ==== WP-2 ==== */`).
Read `views.js` 517–1154 once, cut it, and do not read the rest of `views.js`. Read `fields.js` `renderFields` signature (grep) — do not read all of it.

## Problems (observed)

Thirteen groups (General, What the site does, Brand, Appearance, URLs & addresses, Images, Mail, Custom code, System pages, App settings, Publishing & export, Studio interface, Security). Four are single cards; "Appearance" is a card that says "go to Design". Colour scheme lives in three places. Mail options is raw JSON. Trusted-issuer Ed25519 JSON sits beside "minimum password length". Every page says "Stored in site/site.json — commit it with your content". Each card has its own Save (13+). Content types (`#/types`) is a separate rail page.

## Required outcome

### Groups (left panel, in this order)

1. **Site** (`#/settings/site`) — Name, tagline, web address (was "Canonical URL", help: "The address visitors use, starting with https://"), language (select of common codes with names, not a free text box), share defaults (title pattern with a live example line "Your browser tab will read: About | Strongman Lifts", description, share image, X handle).
2. **Content** (`#/settings/content`) — **Content types** embedded (the existing `concepts` view rendered inside this page; `#/types` continues to route to the same UI for compatibility), then **Web address style** (was URLs & paths: keep options, rewrite labels: "Page addresses look like: /about/ · /about.html · /about"; "Shortlinks" with one sentence), then **Brand variables** (keep, intro: "Things you type once and reuse everywhere — a phone number, an opening line. Type {{var.phone}} in any text and it fills in."), then **Special pages** (was System pages: 404 page, maintenance page, maintenance mode on/off with a plain warning).
3. **Email** (`#/settings/email`) — provider select; **per-provider labelled fields** instead of JSON: Resend/SendGrid/Postmark → "API key" (password input); Webhook → "URL to post to"; Console/MailChannels → no extra fields. Keep storing into `mail.options` with the same keys (`apiKey`, `url`). From address. "Send me a test email" button. Plain help: "Used for password resets, form notifications and anything an app sends."
4. **Apps** (`#/settings/apps`) — the plugin-contributed settings cards (was App settings), each with the app's name and one-line description. Link at top: "Turn apps on or off under Manage → Apps."
5. **Advanced** (`#/settings/advanced`) — with a one-line intro "You will rarely need this page." Sub-sections as cards: Site features (the switchboard, each blurb rewritten so a non-technical person understands the trade-off; group the seven into "For visitors" (theme toggle, RSS, sitemap) and "Technical" (prefetch, view transitions, analytics beacon, OpenSearch)); Images (quality, sizes, EXIF, watermark — rewrite help); Custom code (site-wide CSS/JS); Fonts (upload/roles); Build & export (trailing slash, minify, search index, base path) + Export now; Studio interface (module hiding table). Colour scheme card is **removed** from Settings — it lives in Design only (WP-8). Delete `schemeSection`.
6. **Security & access** (`#/settings/security`) — Sign-in rules (attempts, lockout, min password), Who can view the site (staging/members/everyone) + staging redirect + shareable preview link, Studio address (adminPath), Logs (audit on/off, error log on/off, error log viewer), then a collapsed **"Technical security (for developers)"** `<details>` holding CSP, frame-ancestors, HSTS, IP allowlist, trusted package issuers, the probe button.

### Behaviour

- **One Save per page.** Remove per-card Save buttons. A sticky bottom bar inside the settings main pane appears when anything is dirty: "You have unsaved changes · [Discard] [Save changes]". ⌘S saves. Saving builds one `patch` from every dirty section (each section exposes `collect()` returning its patch and `validate()`), calls `put('/settings', { patch })` once, then toasts "Saved". The existing route guard stays ("You have unsaved settings. Leave without saving?").
- Buttons that act immediately (Send test email, Export now, Create preview link, Probe, Upload font) save first if dirty, then act.
- Remove "Stored in site/site.json — commit it with your content" everywhere. Page sub-line becomes a plain sentence per group (e.g. Site: "The basics about your website.").
- Settings search: keep, but rebuild `SETTINGS_ROWS`/`GROUP_LABELS` in `catalog.js` for the six groups; every field on every page must have a row (the `?f=` landing behaviour stays). Keep `assertCatalogue`.
- The rail entry for Content types is gone (WP-1 did that); `#/types` must still work and render the Content page with the types section scrolled into view.

## Acceptance

- `#/settings` shows six groups in the order above; no card has its own Save; editing a field shows the sticky bar; Save writes one PUT; reload shows the value.
- Mail → Resend shows an "API key" field, no JSON.
- `#/types` and `#/settings/content` both show content types.
- No "site.json" text anywhere in the settings UI.
- Settings search for "EXIF" lands on the field under Advanced → Images.
- tests 48/48; typecheck count unchanged.
