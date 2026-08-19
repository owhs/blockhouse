---
name: blockhouse-design-system
description: Shape the visual system of a Blockhouse site — the OKLCH token palette, fluid type scale, custom fonts, spacing and radius, light/dark or single-scheme output, per-page and global CSS, brand variables, and the design-level decisions that separate a stock template from a designer-grade site. Use when the user wants to restyle a site, build a brand palette, adjust typography, tune spacing/rhythm, or make a template feel bespoke without forking it.
---

# Designing with Blockhouse's token system

Blockhouse templates are built entirely from CSS custom properties in OKLCH with `light-dark()`, so a whole site can be re-skinned by overriding tokens rather than editing CSS. Reach for a fork only when the *structure* changes; reach for tokens when the *look* changes.

## The layers, cheapest first

1. **`theme.tokens` in site.json** — a flat map of token → value, injected as `:root{}` after the template's own tokens. Editable in the studio under Settings → Brand & theme. This is where 90% of restyling belongs.
2. **`site/overrides/assets/*.css`** — files that shadow the template's own assets by name. Use for component-level tweaks the token map cannot express.
3. **`customCss` in site.json** — global CSS injected after the theme, editable in the studio. Good for one-off marketing pages and campaign styling.
4. **Per-page `custom.css`** — on the document, under the editor's Page tab. Scoped to that page only.
5. **A new template** — only when the layout, partials or block markup differ. See the `blockhouse-template-authoring` skill.

## The token vocabulary

Colour is driven by two knobs plus derived ramps. Set `--hue` (0–360) and `--accent-chroma` (0.02 muted → 0.20 vivid) and the entire palette moves with them:

```
--accent --accent-strong --accent-soft --accent-contrast
--bg --bg-subtle --bg-raise --bg-contrast
--ink --ink-mute --ink-faint --ink-contrast
--line --line-soft
--shadow-1 --shadow-2
```

Every one is defined with `light-dark(lightValue, darkValue)`, so overriding a token means supplying both halves unless the site is locked to one scheme. A three-token override — `--hue`, `--accent-chroma`, `--radius` — already reads as a different brand.

Type is a fluid `clamp()` scale: `--text-s --text-base --text-l --text-xl --text-2xl --text-hero`. Overriding the whole scale is usually wrong; override `--text-hero` and `--text-2xl` for a louder or quieter display voice and leave body text alone. `--font-body`, `--font-display` and `--font-mono` accept any stack; custom fonts assigned a role in Settings → Fonts populate them automatically.

Rhythm: `--space` (fluid base unit), `--container` (72rem default), `--container-narrow` (46rem, used for prose), `--radius` and `--radius-s`.

## Choosing colours that survive dark mode

Work in OKLCH lightness, not hex. Backgrounds sit at 96–99% light / 17–24% dark; ink at 22–26% light / 92–96% dark; lines at 88–92% light / 26–32% dark. Keep chroma low on surfaces (≤0.02) and let the accent carry saturation — high-chroma backgrounds are what make dark themes look muddy. A quick check: swap only the lightness values between the light and dark halves and the design should still read.

## Single-scheme sites

Settings → Colour scheme locks the public site to `light` or `dark`. The lock is real: `color-scheme` is pinned, the theme toggle disappears, the visitor's stored preference is ignored, and the editor preview matches so what you design is what ships. Use it when a brand has one look; leave it on `auto` when you want the OS preference respected.

## Brand variables

`vars` + `varDefs` in site.json define typed, named values (`text`, `image`, `colour`, `link`, `email`) editable in one place under Settings → Brand. Reference them anywhere in block props as `{{var.key}}` or `{{brand.key}}` and they resolve at render time. Use them for the things that appear in twenty places and change once a year: company name, support email, phone, legal entity, primary CTA label, hero image.

## Making it feel designed rather than templated

The differences that read as craft: a display font paired with a plain body font, not two personalities; one accent colour used sparingly rather than three competing ones; generous `--space` on marketing pages and tighter on documentation; `--radius` consistent across buttons, cards and inputs (mixing 4px buttons with 20px cards looks accidental); and real content width discipline — prose in `--container-narrow`, full-bleed media outside it.

For layout variety, prefer composing existing blocks (`feature-split`, `spotlight`, `stats`, `timeline`, `logos`, `steps`) over new CSS. They already respect the token system, so they restyle with the palette instead of drifting from it.

## Verifying

`blockhouse budget` shows CSS weight per page — token overrides cost nothing, but stacked `customCss` blocks add up. Check both schemes before shipping: in the studio the preview honours the lock, and on an `auto` site the header toggle flips it live. Contrast at `--ink` on `--bg` and `--accent-contrast` on `--accent` are the two pairs worth measuring.
