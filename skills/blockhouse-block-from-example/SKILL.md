---
name: blockhouse-block-from-example
description: Generate a custom Blockhouse content block from an example — a snippet of HTML, a screenshot/image of a component, or a link to a design. Produces the block's JSON field schema plus its Liquid template so content editors get an inspector form and the designer owns the markup. Use when the user says "make this into a block", "turn this component into an editable block", or supplies a design to reproduce.
---

# Turning an example into a Blockhouse block

Goal: given a concrete component example, output two files —
`templates/<tpl>/blocks/<type>.json` (schema) and `<type>.liquid` (markup) — so it becomes an editable block.

## Method

1. **Identify the variable parts.** Look at the example and separate *content* (text, images, links, repeated items) from *structure* (layout, styling). Each variable becomes a field; structure stays in the Liquid.

2. **Choose field types** for each variable part:
   - short text → `text`; multi-line → `textarea`; formatted → `richtext` (stored as markdown)
   - image → `image` (stores a media id; render with `| img`)
   - a URL/CTA → `link` (`{docId}` or `{href}`)
   - a fixed set of choices → `select` with `options`
   - a repeating group (cards, rows, logos, stats) → `list` with an `item: [...]` sub-schema
   - on/off → `boolean`; a number → `number`; raw vector → `svg`

3. **Write the schema** (`.json`): `type` (kebab-case, unique), `label`, `group`, `icon` (a name like `layout`, `star`, `columns`), `fields[]`, optional `defaults`, and `"container": true` if it wraps other blocks.

4. **Write the template** (`.liquid`): reproduce the example markup, replacing variable parts with `{{ props.<key> }}` (always `| escape` untrusted text; `| md` for richtext; `| img: sizes: '...'` for images). Loop `list` fields with `{% for item in props.<key> %}`. Emit theme-aware classes (`wb-*` or your own) rather than inline colors so it adapts to light/dark.

5. **Style it.** Append CSS to the template's `components.css` using tokens (`var(--accent)`, `var(--ink)`, `light-dark(...)`), not fixed hex. Match spacing to the example.

6. **Validate.** `blockhouse dev`, drop the block on a page, confirm the inspector shows every field and the render matches the example in both themes.

## Worked example

Example HTML the user pasted:
```html
<div class="stat"><span class="big">98%</span><p>customer retention</p></div>
```

`blocks/stat.json`
```json
{ "type": "stat", "label": "Stat", "group": "Marketing", "icon": "chart",
  "fields": [
    { "key": "value", "type": "text", "label": "Value", "required": true, "default": "98%" },
    { "key": "label", "type": "text", "label": "Label", "default": "customer retention" } ] }
```

`blocks/stat.liquid`
```liquid
<div class="wb-stat"><span class="stat-big">{{ props.value | escape }}</span><p>{{ props.label | escape }}</p></div>
```

Append to `components.css`:
```css
.wb-stat { text-align: center; }
.wb-stat .stat-big { font-size: var(--text-2xl); font-weight: 750; color: var(--accent); display: block; }
.wb-stat p { color: var(--ink-mute); font-size: var(--text-s); }
```

## From an image or link

- **Image/screenshot:** describe the component structure first (a 3-up card grid, an icon+title+text tile, a testimonial with avatar), then follow the method. Approximate spacing/quantity as `list` fields so editors control how many.
- **Link to a live component:** reproduce the *structure and system*, not their exact assets or any trademarked content. Pull the palette into tokens; rebuild the markup cleanly.

Prefer a `list` field over hard-coding N repeats — it's what makes the block reusable. Keep the schema small: every field is a decision the editor has to make.
