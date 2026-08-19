---
name: blockhouse-template-authoring
description: Create or modify a Blockhouse template (theme) — from a written description, from tweaks to an existing template, or by matching the look of an existing website. Covers layout/partials, the OKLCH light-dark() token system, custom design blocks, and per-site overrides. Use when the user wants a new visual style, a new template, or to restyle a Blockhouse site.
---

# Authoring a Blockhouse template

A template is a folder under `templates/<name>/` (built-in) or `sites/<site>/templates/<name>/` (site-local). Files resolve in layers — **site/overrides/ → site-local template → built-in template** — so a site can override a single file without forking.

```
templates/<name>/
  template.json          { name, label, slots: [...], tokens: [...] }
  layout.liquid          document shell: {{ head }} {{ main }} {{ body_attrs }} + partials
  partials/header.liquid, footer.liquid
  pages/page.liquid      default: {% region 'content' %}
  pages/post.liquid, list.liquid, 404.liquid   (optional per-concept templates)
  blocks/<type>.json + <type>.liquid            designer-made blocks
  assets/tokens.css, base.css, components.css   (served at /assets/site/*)
```

## Templating language (Liquid-compatible)

Tags: `{% region 'content' %}` (doc blocks), `{% slot 'header.after' %}` (site slot injections), `{% menu 'main' %}`, plus `{% if %}/{% for %}/{% assign %}/{% include %}`.
Filters: `md`, `excerpt`, `img` (mediaId → responsive `<picture>`, e.g. `{{ fields.cover | img: sizes: '400px' }}`), `asset` (cache-busted template asset), `escape`, `date`, `default`, `truncate`, `money`, `number`.

## The token system (do this, not hard-coded colors)

Aurora's `tokens.css` is the reference. Design in **intentions**, and derive light + dark from one hue with `light-dark()` + OKLCH so both themes stay in sync:

```css
:root {
  color-scheme: light dark;
  --hue: 275; --accent-chroma: 0.16;
  --accent: oklch(58% var(--accent-chroma) var(--hue));
  --bg: light-dark(oklch(98.6% 0.004 var(--hue)), oklch(17.5% 0.014 var(--hue)));
  --ink: light-dark(oklch(24% 0.015 var(--hue)), oklch(94% 0.008 var(--hue)));
  /* fluid type: clamp(min, preferred, max) */
  --text-hero: clamp(2.5rem, 1.9rem + 3.2vw, 4.2rem);
}
```

Declare adjustable tokens in `template.json` `tokens[]` so they appear in Settings → Theme. A site overrides any token via `site.json → theme.tokens` (e.g. `{ "hue": "162" }` for evergreen) or by uploading fonts assigned to `body`/`display`/`mono` roles.

Modern CSS to lean on: `@view-transition { navigation: auto }`, container queries, `color-mix(in oklch, …)`, `:has()`, `interpolate-size: allow-keywords` for animated `<details>`. Always include `@media (prefers-reduced-motion: reduce)` fallbacks.

## Creating a template three ways

**From a description** ("a warm editorial magazine, cream & ink, serif headlines"): copy Aurora as a starting point, then rewrite `tokens.css` (hue/chroma, a serif `--font-display`, radius) and adjust `components.css` block styling. Keep the class names (`wb-*`) so all native blocks keep working.

**From tweaks**: edit only the token values or the specific `wb-*` rules the user names. For a one-file change on a live site, put it in `sites/<site>/site/overrides/assets/…` so the base template stays intact.

**Matching an existing website**: extract its palette (sample 3–5 key colors → convert to OKLCH hue/chroma), identify the type scale and font families, and note the header/nav pattern. Reproduce as tokens + header partial. Don't copy their assets or trademarked marks; match the *system* (spacing rhythm, contrast, accent behavior), not pixel-for-pixel.

## Custom design blocks

Two files give content editors a first-class block with an auto-generated inspector form:

`blocks/team-member.json`
```json
{ "type": "team-member", "label": "Team member", "group": "People",
  "fields": [
    { "key": "name", "type": "text", "label": "Name", "required": true },
    { "key": "photo", "type": "image", "label": "Photo" },
    { "key": "bio", "type": "richtext", "label": "Bio" } ] }
```

`blocks/team-member.liquid` (receives `props`, `inner`, `site`, `doc`):
```liquid
<div class="team-member">{{ props.photo | img: sizes: '160px' }}<h3>{{ props.name | escape }}</h3>{{ props.bio | md }}</div>
```

Add `"container": true` to accept nested blocks (rendered as `{{ inner }}`). Field types: `text textarea richtext markdown code svg number boolean select date color image link json table list`.

## Verify

Run `blockhouse dev` and check both themes (toggle in the header), mobile nav, and that every native block still renders. `blockhouse check` validates content against the block catalogue.


## Round-6 capabilities (v1.3)

- **Template IDE:** Site → Templates is a full editor (highlighting, liquid autocomplete, ⇧⌥F beautify, colour swatches, snippets, live preview of unsaved drafts via `?__tplpreview=1`). Cross-references at GET `/api/templates/refs`.
- **`features.*` in templates:** gate output on the switchboard — `{% if features.rss %}<link rel="alternate" …>{% endif %}`. Never hardcode feed/sitemap links unguarded.
- **Slots:** expose chrome insertion points with `{% slot 'header.announce' %}` etc.; list them in template.json `slots` so the studio labels them.
- **Theme packages:** ship as a zip with `blockhouse-package.json` `{name, kind: "template", version, files: {rel: sha256}, issuer?, signature?}` (Ed25519 over the sorted `rel:hash` lines). Installs land in `<project>/templates/<name>/`, verify against `security.trustedIssuers`, re-verify any time (POST `/api/packages/template/<name>/verify`).
- **Narrow blocks are centred:** `.wb-faq`, `.wb-testimonial`, `.wb-timeline` carry `margin-inline: auto` — keep that in new templates.
