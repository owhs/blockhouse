# WP-8 — Site tools: Navigation, Design, Header & footer, Template code, SEO, Quick edits

Owner files: `src/assets/admin/menus.js` (457), `design.js` (268), `chrome.js` (142), `templates.js` (237), `seo.js` (125), `quick.js` (265), `studio.css` (rules for these views at the end under `/* ==== WP-8 ==== */`).
Read each owned file whole once; they are small. Do not read views.js/editor.js.

Naming after WP-1: rail items are **Navigation** (`#/menus`), **Design**, **Header & footer**, **SEO**, and under Manage **Template code**.

## Navigation (`menus.js`)

Observed: page head "Main menu ˅" select + a "+" icon; hint "Click to select · drag to reorder · everything previews live before you save." The item tree shows tags like "CATALOGUE" with no explanation; right pane says "Select something in the structure to edit it here. For the full screen tabbed menu: select an item, then Panel → Catalogue."
Required:
- Heading "Navigation" with sub "The menus visitors use to get around. Changes go live when you press Save."
- The "+" becomes a labelled button "Add item" (adds a top-level link and selects it).
- Item type labels: "Links to" options become "A page on this site", "Another website or address", "The newest {type} (updates itself)", "Heading (not a link)", "Divider line".
- Panel modes get plain names and one sentence each in the select's help: "No dropdown", "Simple dropdown (a list of links)", "Columns (several lists side by side)", "Showcase (pictures with a short line)", "Catalogue (categories across the top, list on the left, detail on the right — best for products)". The tree tag reads the plain name, not the internal key.
- Empty right pane: "Choose an item on the left to change it." + three bullets of what you can do (rename, link, dropdown style).
- Unsaved state: Save button shows a dot and the route guard stays.

## Design (`design.js`)

Observed: template cards (a "LICENSE" card came from the server list — WP-6 fixes the server; you filter defensively client-side too: only entries that exist in `TEMPLATES` or come back with a `title`), sliders below the fold, consent banner in preview (WP-6 fixes preview mode; nothing for you).
Required:
- Page structure top-to-bottom: heading "Design" + sub "Choose a look, then tune its colour and shape. The preview is your real site; nothing changes for visitors until you press Save." · **Colour & shape** card first (hue, intensity, corner radius sliders with live preview and a "Reset to the template's defaults" link) · **Light or dark** card (moved here from Settings; radio: "Match each visitor's device", "Always light", "Always dark"; checkbox "Show a light/dark switch in the header" only when matching) · **Template** grid last, current one marked "Current", each card's blurb in plain English, "Install a theme file" as a ghost button with help "Only if a designer gave you a .zip".
- Saving sends the same `theme` patch it does today plus `colorScheme`/`showToggle` (it already does — keep) and template changes stay behind a confirm "Switch to {name}? Your pages and content stay exactly as they are; only the look changes."

## Header & footer (`chrome.js`)

Observed: slot list shows raw keys (`footer.columns`) with "Rendered wherever the template puts {% slot 'footer.columns' %}"; three "Footer column" rows with no clue what each contains; preview below.
Required:
- Every slot gets a human name and a one-line description. Extend `NICE` with `footer.columns` → ["Footer columns", "The link columns at the bottom of every page"] and a generic fallback that turns `a.b-c` into "A · B c" with the description "A spot the template leaves for your content" — never show `{% slot %}`.
- Block rows show a summary of their content: for a footer column, its title/first link; for any block, `labelOf`-style first text prop (grep how `docops.js` `labelOf` derives it and import it).
- Rows are expandable inline (keep) but the "pen" and the row label do the same thing; remove the duplicate pen icon.
- Intro sentence under the heading: "Text and links that appear on every page. The layout itself comes from the template."
- Keep the live preview; label it "Preview — every page shares this".

## Template code (`templates.js`)

Observed: file tree + code editor, "strongman / layout.liquid BUILT-IN", no explanation.
Required:
- Heading "Template code" with a persistent note card at the top: "For developers. These files control how pages are built. Editing one makes a copy for this site; the original is kept and you can revert at any time." with a "Revert to original" affordance that already exists surfaced as a labelled button when the file is overridden.
- Status chip words: "Original" / "Edited for this site".

## SEO (`seo.js`)

Observed: audit table with "5 warnings · +2 more…" per row; sitemap/RSS facts up top with "turn on in Features".
Required:
- Heading "SEO" sub "How your pages look to search engines and social sites."
- Top summary card: "X pages have no problems · Y need attention" with a "Show only pages needing attention" toggle.
- Each audit row lists **all** its issues (no "+N more"), each issue with a plain sentence and a "Fix" button that opens `#/e/<id>/seo`.
- Noise rule: do not report "keyword missing from …" checks when no focus keyword is set (this is computed server-side — grep `keyword` in `src/render/seo.ts` and gate those checks on `doc.seo.keyword`; small out-of-scope edit allowed).
- Sitemap/RSS lines link to `#/settings/advanced` after WP-2 (use that hash).

## Quick edits (`quick.js`)

These are the side-sheet editors the editor's ⋯ menu opens (colour, menu links, announcement bar, footer). Check each sheet's title and intro line reads as plain English and says where the full editor is ("Open Navigation for dropdowns and pictures"). No code changes beyond wording unless something is broken.

## Acceptance

- Navigation, Design, Header & footer, Template code, SEO pages match the structure above on strongman and automatic.
- No raw slot key, `{% … %}`, or "BUILT-IN" text visible.
- SEO on strongman: rows with a focus keyword unset show no keyword checks; every issue has a Fix button.
- tests 48/48; typecheck count unchanged.

## Also (from WP-3)
Every page you own must mount the per-screen help button: `import { helpButton } from './help.js'` and place `helpButton('<panel>', '<Title>')` in the page head actions. Panel keys that already have tips server-side: `menus`, `chrome`, `design`, `seo`. Template code: use `helpButton('templates', 'Template code')` and add a `templates` case to `contextTips()` in `src/server/help.ts` (3 verb-first bullets, developer audience) — small out-of-scope edit, allowed.
