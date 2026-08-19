# Blocks, templates & overrides

## Templates

A template is a folder (built-in under `templates/`, or site-local):

```
templates/aurora/
  template.json          label, slots, theme token schema
  layout.liquid          document shell — {{ head }}, {{ main }}, includes
  partials/header.liquid, footer.liquid
  pages/page.liquid      default concept template ({% region 'content' %})
  pages/post.liquid, list.liquid, 404.liquid
  blocks/*.json + *.liquid   ← designer-made custom blocks
  assets/tokens.css, base.css, components.css
```

Templating is Liquid-syntax (vendored, zero-dep; swap in LiquidJS via `render/engine.ts` if you want the full spec). Blockhouse adds:

- `{% region 'content' %}` — renders the document's block tree
- `{% slot 'header.announce' %}` — site-injected blocks (`site.json → slots`) rendered *on top of* the template without touching it
- `{% menu 'main' %}` — accessible nav incl. mega panels
- filters: `md`, `excerpt`, `img` (media id → responsive `<picture>`, kwargs like `sizes:`), `asset` (cache-busted template asset), `escape`, `date`, `default`, `truncate`, `json`, `slug`

## Layered resolution (edit without forking)

Every template file resolves through layers — first hit wins:

1. `site/overrides/…` (e.g. `site/overrides/partials/header.liquid`, `site/overrides/assets/tokens.css`)
2. the site-local template folder
3. the built-in template

So "simple mods to headers/footers on top of a template" is: copy one file into `site/overrides/partials/` and edit. Template updates keep flowing for every file you didn't touch. Theme tokens are even lighter — `site.json → theme.tokens` injects CSS custom properties (`hue`, `radius`, fonts…) after `tokens.css`, editable in Studio → Settings → Theme with live preview.

## Custom blocks for designers

Drop a pair of files in the template's `blocks/` (or `site/overrides/blocks/`):

```jsonc
// blocks/team-member.json
{ "type": "team-member", "label": "Team member", "group": "Aurora",
  "fields": [
    { "key": "name", "type": "text", "label": "Name", "required": true },
    { "key": "role", "type": "text", "label": "Role" },
    { "key": "photo", "type": "image", "label": "Photo" }
  ] }
```

```liquid
{# blocks/team-member.liquid — receives props, inner, site, doc #}
<div class="team-member">
  {{ props.photo | img: sizes: '160px' }}
  <h3>{{ props.name | escape }}</h3><p>{{ props.role | escape }}</p>
</div>
```

Editors get a normal inspector form; the designer owns the markup. Container blocks (`"container": true`) receive nested blocks as `{{ inner }}`.

## Native block conventions

Blocks render with `wb-*` classes styled by the template. Interactive blocks declare `enhance: 'tabs' | 'lightbox' | 'embed' | 'form' | 'faq' | 'reveal'`; the ~4KB runtime only activates enhancers that appear on the page (`body[data-blockhouse-enhance]`). Blocks can contribute structured data via `jsonld()` — that's how FAQ blocks emit `FAQPage` automatically.

## Field types

`text · textarea · richtext (WYSIWYG↔markdown) · code · markdown · svg (sanitized, live preview) · number · boolean · select (static or optionsSource) · date · color · image (media picker) · link (URL or document picker with slug-proof doc refs) · json · table (grid editor) · list (repeatable groups, drag-sortable)`
