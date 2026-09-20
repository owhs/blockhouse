# WP-3 — Help, rewritten in plain English

Owner files: `src/server/help.ts` (274 lines, read whole), `src/assets/admin/help.js` (79 lines, read whole), `src/assets/admin/sheet.js` (81 lines, read whole).
Also read `src/server/api.ts` lines that serve `/help` and `/help/tips` (grep `buildHelp` and `contextTips`).

## Problems

The handbook is a doctor report written for developers: "Menus render through {% menu 'key' %} in your template", "Template blocks live in templates/strongman/blocks/*.json + .liquid", bash deploy commands, CSP/HSTS posture. It never tells a site owner how to add a page, change a picture, edit the menu, or publish. Per-screen "?" tips are 2–4 sentences of implementation trivia ("Publishing writes a snapshot; the live site only serves snapshots").

## Required outcome

### A. Help page (`#/help`) becomes task-based

`buildHelp()` returns sections in this order. Text is written for a non-technical business owner. Every step names the exact button or panel label as it appears in the studio (after WP-1: sections are Content / Site / Manage; "Menus" is called "Navigation"; "Apps & permissions" is "Apps").

1. **Start here** — five short paragraphs: what the studio is; the three sidebar sections and what lives in each; the difference between *saved* and *published* ("Saving keeps your work. Publishing puts it on the website. Nothing visitors see changes until you press Publish."); where to get help on any screen (the ? button); that nothing is lost (every publish and every save with ⌘S keeps a copy you can go back to).
2. **Everyday tasks** — each is a `steps` list of 3–6 numbered steps. Include at least: Add a new page · Change words on a page · Swap or add a photo · Add a new block (and what a block is, one sentence) · Move or delete a block · Publish a page · Take a page off the website · Change the menu · Change the header or footer text · Change colours or fonts · See who changed what · Give a colleague access.
3. **Words you'll see** — a glossary as `facts` rows: Block, Section, Page vs Content type, Draft / In review / Published / Published with changes, Restore point, Assets, Navigation, Header & footer, Design, Apps, SEO. One plain sentence each.
4. **Your site at a glance** — the existing live facts (URL, template, counts, apps on) — keep the derived data, drop the file-path hints (`files resolve from site/overrides → …`).
5. **Your content types** — keep, but the `hint` loses "extra fields: …" jargon; say "Each Lift has these details you can fill in: …".
6. **Health check** — keep, reword: "Pages missing a description for search engines", "Images without a description (alt text)", "Links that point nowhere".
7. **For developers** — one section, clearly titled, holding what used to be Blocks (template blocks path), Navigation's Liquid note, Publishing commands, Security posture, and per-plugin permission tables. Move the existing content here; do not delete it.

`HelpSection` gets an optional `audience?: 'owner' | 'developer'`; the client renders developer sections under a divider "For developers".

### B. Per-screen tips (`contextTips`)

Rewrite every panel's tips as *what you can do here* in plain English, 3–4 bullets, each starting with a verb. Add panels that have none: `dashboard`, `users`, `plugins`, `menus` (already there, rewrite), `chrome`, `assets` (alias `media`), `audit`, `help`, `seo`, `design`, `types`. Each panel also returns a `tasks` array: `{ label, help: '<section id>' }` links into the Help page's relevant section (`#/help/<id>`), so the sheet shows "Related: Add a new page →".

Change the signature to return `{ tips: string[]; tasks: { label: string; help: string }[] }` and update the `/help/tips` route and `help.js` `helpButton` accordingly.

### C. Help page UI (`help.js`)

- Left panel: topic list grouped "Start here", "Everyday tasks", "Reference", "For developers". Selecting a topic scrolls to it (keep) and highlights the row.
- A search box at the top of the panel that filters sections by title/summary/steps text (client-side).
- Sections render with a clear heading, the summary in normal-size text (not muted), steps as an ordered list with the step number in an accent circle, facts as a two-column definition list, code blocks only inside developer sections.
- Remove the "Open the live site" link from the top card; the topbar already has View site.

### D. `helpButton` sheet

Title "Help with {screen}" → sub "What you can do here". Bullets, then "Related how-tos" list linking into `#/help/<id>`, then a ghost button "Open the help guide". Remove "Written from this site's live configuration".

## Acceptance

- `#/help` on strongman opens on "Start here"; no Liquid, CLI, or file path appears above the "For developers" divider.
- Every rail page's ? button shows ≥3 verb-first bullets and ≥1 related how-to link that lands on the right help section.
- `GET /api/help/tips?panel=editor` returns `{tips:[…], tasks:[…]}`.
- typecheck error count unchanged; tests pass.
