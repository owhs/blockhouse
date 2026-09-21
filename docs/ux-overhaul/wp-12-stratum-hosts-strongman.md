# WP-12 — Stratum must be able to host the strongman site

Goal: the owner switches the strongman site to the **stratum** template in Design with one click and nothing on the site goes missing. They can switch back at any time. No strongman **content** changes; all work is in `../templates/stratum/` (plus small engine touches only if unavoidable).

Working directory: `C:\projects\2026\weft\blockhouse`. Templates at `../templates/`. Git is in use (`../templates` is its own repo): do not commit; the orchestrator does.

## Test rig (already set up, both public, no sign-in needed)

- `http://localhost:8794/` — strongman content on **stratum** (`../.uxcritic/strongman-stratum`). This is what you are fixing.
- `http://localhost:8795/` — the same content on **strongman** (`../.uxcritic/strongman-ref`). This is the reference for what each page must contain.
- Start them yourself if they are not up: from `C:\projects\2026\weft` run `bun blockhouse/src/cli/index.ts dev --dir .uxcritic/strongman-stratum --port 8794` and the same with `strongman-ref --port 8795` (background). Template files are read per request in dev; engine `.ts` changes need a restart.
- Pages to check: `/`, `/about`, `/contact`, `/helmsdale`, `/bonar`, every other lift (list them from `../.uxcritic/strongman-ref/site/content/product/`), one project (`/jordan-racing-team-2`), the projects index, each range page and the ranges index, the FAQs page, a service page, `/search`, a 404.

## What is missing on stratum today

1. **Ten block types** that strongman's content uses and only `../templates/strongman/blocks/` defines: `photo-row` (53 uses), `spec-list` (35), `diagram` (26), `related-products` (12), `project-meta` (7), `tile-grid`, `section-intro`, `hero-slider`, `link-row`, `footer-column`. On stratum they render as nothing.
2. **Page layouts**: stratum has `page`, `product`, `list`, `sector`, `sector-list`, `404`. Strongman's types ask for `product`, `project`, `range`, `faqs`, `home`, `list`. Stratum's `product.liquid` is written for automatic's fields (`code`, `brand`, `category`, `tagline`, `keySpecs`, breadcrumb hard-coded to `/systems`, `partials/cat`). Strongman's product fields are `name`, `strapline`, `range`, `featured`, `liftType`, `cover`, `lede` (read `../.uxcritic/strongman-ref/site/concepts/product.json`).
3. **Footer slot**: strongman's footer content lives in `site.slots['footer.columns']` (three `footer-column` blocks) and `footer.social`. Stratum's footer renders only `footer.before` and `footer.social`.
4. **Behaviour scripts**: the hero slider cross-fade and the photo lightbox (`.sm-lb`) — find where strongman ships them (`grep -rn "data-hero-slider\|sm-lb\|data-gallery" ../templates/strongman ../sites/strongman/plugins ../blockhouse/src/assets/blockhouse`) and make sure they work under stratum too.
5. **Site plugin blocks** `faq-grid` and `range-grid` (`../sites/strongman/plugins/strongman/index.ts`) emit strongman class names; they need styling under stratum.
6. **Brand variables**: strongman defines `brandingBanner, legalName, phone, phoneHref, email, addressLines, ctaLabel, ctaHref, footerCtaHeading, footerCtaText, copyright`. Stratum's partials read their own names (e.g. `site.vars.quoteHref`). Every stratum read of a var must fall back sensibly (`quoteHref | default: site.vars.ctaHref | default: '/contact'`), and the strongman contact details must appear in the stratum footer/header where stratum shows contact details.

## Required outcome

### Blocks — port, do not copy-paste the look
For each of the ten blocks add `../templates/stratum/blocks/<name>.json` + `.liquid`:
- The **JSON manifest is identical in `type`, field keys, option values and defaults** to strongman's, so stored props work unchanged (copy the manifest; keep the plain-English labels/help it already has).
- The **Liquid markup uses stratum's design language** — read `../templates/stratum/assets/tokens.css`, the first 150 lines of `components.css`, and two existing stratum blocks (`figure`, `spec-table`, `system-grid`) first, and reuse stratum's classes, type scale, plates, rules and spacing. Where stratum already has a close block (`spec-table` ↔ `spec-list`, `figure` ↔ `diagram`, `system-grid` ↔ `related-products`, `stage` ↔ `hero-slider`/`section-intro`), share its visual treatment.
- Keep every `wbe` / `wbe_at` / `wbimg` annotation strongman's Liquid has, so inline editing keeps working.
- Widths: `photo-row`'s `width` values (`narrow|normal|wide|page|full`, legacy `entry`) must map onto stratum's `.bh-w-*` classes.
- CSS goes in `../templates/stratum/assets/components.css` under a header `/* ==== strongman-compatible blocks ==== */`, using stratum tokens only (no hard-coded colours), correct in light and dark.

### Pages
- `product.liquid` becomes **field-tolerant**: it renders well for automatic's fields AND for strongman's. Title from `doc.title`; sub-line from `fields.tagline | default: fields.strapline`; intro from `fields.lede` when present; breadcrumb from the concept's own `indexPath`/label rather than `/systems`; `partials/cat` only when `fields.category` exists; key specs bar only when `fields.keySpecs` exists. Automatic's product pages must render byte-identically to before except for whitespace — diff `http://localhost:8793`-style output is not available, so instead render automatic's product template through the test suite or reason carefully and keep every automatic branch unchanged.
- Add `project.liquid`, `range.liquid`, `faqs.liquid`, `home.liquid` to stratum, carrying the same content regions and field outputs as strongman's versions (read those four files), in stratum's language. `list.liquid` must work for strongman's projects and ranges indexes (check what fields strongman's `list.liquid` shows on cards — cover, strapline — and make stratum's list tolerant the same way).
- All `wbf` annotations preserved.

### Chrome
- Stratum's footer renders `{% slot 'footer.columns' %}` in a sensible place, and the `footer-column` block is styled for it. Nothing changes for automatic (its slot is empty).
- Header: strongman's main menu uses the catalogue mega panel — confirm it renders under stratum (automatic uses the same menu engine). The strongman logo/wordmark (`site.vars.brandingBanner` and `seo.organization.logo`) must appear; check how stratum's header picks its logo and make it fall back to those.

### Accent colour
- Stratum's `--hue` default stays as is. Confirm the Design page's hue slider (`site.theme.tokens.hue`) recolours stratum on the test copy: set `"tokens": {"hue": "150"}` in `../.uxcritic/strongman-stratum/site/site.json` and check the accent changes. Report the hue value that gives a fern green in stratum's palette.

## Acceptance (you check all of these with curl + grep before reporting)

- For every page listed above: HTTP 200 on 8794; **zero** occurrences of `wb-missing`, `Unknown block`, `Template block error`.
- For each of the ten block types, the count of rendered instances on 8794 equals the count on 8795 for the same page (grep a stable class or `data-wb-type` in editor-preview mode is not available publicly — grep your block's root class on 8794 against strongman's root class on 8795).
- Every heading and paragraph text present in `<main>` on 8795 is present in `<main>` on 8794 for `/`, `/helmsdale`, `/about`, the FAQs page and one project (write a small script: strip tags, compare sets of text lines ≥ 20 chars; list anything missing).
- Footer on 8794 contains the three footer column titles and the phone number.
- `bun test` still passes (57) and `bun run typecheck 2>&1 | grep -c "error TS"` is still 61.
- `../templates/strongman/` is untouched. No file under `../sites/` changes.

Report in under 300 words: files added/changed, the text-parity result per page, the fern-green hue value, and anything you could not make equivalent and why.
