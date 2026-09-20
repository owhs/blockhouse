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

## Widths

Every block that sits directly on a page can choose how wide it runs, from one shared list of five values (`src/render/layout.ts`):

| value | shown as | meaning |
|---|---|---|
| `narrow` | Narrow | a comfortable reading column (~52rem) |
| `normal` | Normal | the page's standard content width (default) |
| `wide` | Wide | breaks out a little either side |
| `page` | Page width | as wide as the page allows, keeping the page margins |
| `full` | Edge to edge | touches both edges, no margins |

`entry` is an old name for `normal` and is still read (`normalizeWidth`); nothing rewrites stored documents.

The value lives on `node.layout.width`, unless the block has its own `width` field marked `"canonicalWidth": true` (Section, Photo row) — then that prop is the one control, and the inspector shows no second one. The renderer puts `bh-w-<value>` on the root element of every top-level block; Section instead puts `w-<value>` on its own `.container`.

**Every template must implement all five** `.bh-w-narrow .bh-w-normal .bh-w-wide .bh-w-page .bh-w-full` in its `assets/base.css`, plus `.container.w-*` for Section. A block inside a Section or Columns takes its container's width and gets no class of its own.

## Field types

`text · textarea · richtext (WYSIWYG↔markdown) · code · markdown · svg (sanitized, live preview) · number · boolean · select (static or optionsSource) · date · color · image (media picker) · link (URL or document picker with slug-proof doc refs) · json · table (grid editor) · list (repeatable groups, drag-sortable)`

## Editing template text from the page

Everything a template prints should be editable by clicking it in the editor
preview. Four filters put that annotation on the markup. They render as an
empty string on the live site — they only produce anything when the page is
being drawn inside the studio, so they are safe to leave in place.

| Filter | Writes | Use it for |
|---|---|---|
| `{{ 'heading' \| wbe }}` | `data-wbe="heading"` | a block prop printed as plain text |
| `{{ 'body' \| wbe: 'md' }}` | `data-wbe="body" data-wbe-mode="md"` | a block prop run through `\| md` |
| `{{ 'tiles' \| wbe_at: forloop.index0, 'title' }}` | `data-wbe="tiles.0.title"` | one field of one item in a repeatable list |
| `{{ 'image' \| wbimg }}` (or `wbe: 'img'`) | `data-wbe-img="image"` | the element wrapping a picture |
| `{{ 'strapline' \| wbf }}` | `data-wbf="strapline"` | a value from this page's own details (`fields.*`) |

`wbe_at` takes the list's prop name, the index (`forloop.index0`) and the
field inside the item; add a fourth argument for the mode (`'md'`, `'img'`).

Put the filter **inside the opening tag** of the element that holds only those
words, and nothing else:

```liquid
<h3 class="tile__title"{{ 'tiles' | wbe_at: forloop.index0, 'title' }}>{{ t.title | escape }}</h3>
<div class="tile__description"{{ 'tiles' | wbe_at: forloop.index0, 'text', 'md' }}>{{ t.text | md }}</div>
<figure class="tile__image"{{ 'tiles' | wbe_at: forloop.index0, 'image', 'img' }}>{{ t.image | img: width: 1600 }}</figure>
```

What happens in the editor:

- **Double-click** anything marked with `wbe`/`wbf` and you type straight into
  the page. It saves and undoes exactly like a change made in the inspector.
- **Single click** on a picture (`wbimg`, or `wbf: 'img'`) selects the block and
  scrolls the field that chooses the picture into view. Pictures are never
  typed into.
- **Single click** on a `wbf` value opens the Page tab with that box flashing.

Do not mark a web address, alt text, or a number that only drives layout —
those are not words a reader sees, and editing them in place would break the
page. `{{ 'doc.title' | wbf }}` is the one reserved name: it points at the
page's own title in the toolbar rather than at a field.
