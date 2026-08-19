---
name: blockhouse-site-editing
description: Modify an existing Blockhouse site — edit page content and blocks, create/update documents, adjust menus (including mega menus), tune SEO, and manage redirects. Use when the user wants to change copy, add pages, restructure navigation, or fix content on a site built with Blockhouse. Works by editing flat JSON under site/ and validating with `blockhouse check`.
---

# Editing a Blockhouse site

Blockhouse stores all content as pretty-printed JSON you can edit directly and validate. Prefer the MCP tools (`blockhouse mcp`) when available; otherwise edit the JSON files and run `blockhouse check`.

## Project layout

```
site/site.json                 config: name, url, theme.tokens, fonts, customCss/Js, plugin approvals
site/concepts/<name>.json      content types (fields, urlPattern, template)
site/content/<concept>/<slug>.json   working copy (draft)
site/content/.published/**     what the live site serves (created on publish)
site/menus/<key>.json          navigation (dropdowns, mega menus)
site/redirects.json            [{from,to,code}]
media/                         images (originals; _var/ derivatives are generated)
```

**Golden rule:** the live site only renders from `site/content/.published/`. Editing a working copy changes the draft; you must publish to change the live site.

## A document

```json
{
  "id": "d-home", "concept": "page", "slug": "home", "title": "Home",
  "status": "published",
  "fields": { "lede": "..." },
  "blocks": [ { "id": "b1", "type": "hero", "props": { "title": "..." }, "children": [] } ],
  "seo": { "title": "...", "description": "...", "keyword": "...", "image": "<mediaId>", "noindex": false },
  "createdAt": "...", "updatedAt": "...", "version": 3
}
```

- Every block needs a **unique `id`** (any short string) and a valid **`type`** (run `blockhouse mcp` → `list_blocks`, or read the block catalogue). `props` must match that block's field schema.
- Container blocks (`section`, `columns`, `hero` has none, `faq`, `tabs`) hold `children`.
- Links in props are `{ "docId": "<id>" }` (internal, survives slug changes) or `{ "href": "/path" }`.

## Workflow

1. **Find** the doc: `blockhouse mcp` `get_doc {concept, slug}` or open `site/content/<concept>/<slug>.json`.
2. **Edit** blocks/props/seo. Keep block ids stable where possible so editor selections and diffs stay clean.
3. **Validate**: `blockhouse check --dir <site>` — fails on unknown block types, broken doc links, duplicate paths.
4. **Publish** if the change should go live: `blockhouse mcp` `publish_doc {id}`, or copy the file into `site/content/.published/<concept>/<slug>.json` and set `status: "published"`.

## Menus & mega menus

`site/menus/main.json` items support `type: link|doc|auto|heading|divider`. Add a `mega` object for a mega panel:

- `layout: "columns"` — `columns[]` each with `title` + `items[]` (link lists, optional `icon`, `description`).
- `layout: "showcase"` — `items[]` render as cards (`label`, `sublabel` e.g. "From £55,460", `note`, `image` mediaId) driving a detail pane; add `tiles[]` (icon shortcuts) and a `footer[]` brand bar. This is the JLR-style menu; it automatically becomes an app-style drill-down on mobile.

Icon names for tiles/links: `compare bespoke classic electric tag bolt mail globe star doc building phone calendar key`.

## SEO

Per-doc `seo` overrides site defaults. Set a `keyword` to unlock keyword checks. `blockhouse mcp validate_site` and the studio SEO view flag broken internal links, missing alt text, thin content, and duplicate paths. Add redirects in `site/redirects.json`; old slugs already 301 automatically via `slugHistory`.

## Don't

- Don't hand-edit `.blockhouse/` (sqlite, secrets) — it's not content.
- Don't invent block types; only use ones from the catalogue (custom blocks live in `templates/<name>/blocks/` — see the blockhouse-template-authoring skill to add one).
- Don't forget to publish; a draft edit won't appear on the live site.


## Round-6 capabilities (v1.3)

- **Site chrome (slots):** header/footer content lives in `site/site.json → slots` (`header.announce`, `header.after`, `footer.before`, `footer.social`), each an array of blocks. Studio: Site → Header & footer. Templates render them with `{% slot 'key' %}`.
- **Features switchboard:** `site.json → features` (`rss`, `sitemap`, `prefetch`, `viewTransitions`, `themeToggle`, `analyticsBeacon`, `searchOpenSearch`). `false` is OFF everywhere — blockhouse also strips feed/sitemap links from menus, templates and content (menus drop them, anchors unwrap to text).
- **Feeds:** per-concept `feed: true` on concepts with an `indexPath`. Managed in SEO → Feeds & sitemap.
- **Markdown sync:** the mdsync plugin turns a folder/zip of .md files into documents (frontmatter → fields, body → a richtext block). `POST /api/x/mdsync/sync`.
