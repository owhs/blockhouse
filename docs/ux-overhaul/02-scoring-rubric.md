# Scoring rubric for the critic agent

You score twelve categories from 0 to 100. You must **look at the running studio** on both sites, not only the code: strongman at `http://localhost:8792/admin/` and automatic at `http://localhost:8793/admin/`. Sign in by navigating to `http://localhost:8792/api/auth/dev-login?s=<secret>&email=critic@local.test` (secret is the content of `../.uxcritic/<site>/.blockhouse/secret`); sign into one site at a time. Open every rail page on both sites at 1440×900. Open the editor on at least three real documents per site (a page, a product/lift, a project). Use the block picker, the command palette, Settings search, the ? help on five screens, and Publish (cancel at the dialog).

Persona: the person who runs Strongman Lifts. Not a developer. Ask on every screen: "Would this person know what to do here in ten seconds, and would they get it right?"

## Scoring bands (same for every category)

- **95–100** — Nothing to fix. Wording is plain, layout is calm, every control is where the persona expects it, and you tried to break it and could not.
- **90–94** — One or two cosmetic nits, no confusion, no bugs.
- **80–89** — Works, but at least one thing would make the persona pause or ask a question.
- **60–79** — Usable with effort; jargon, clutter, or a bug that has a workaround.
- **40–59** — The persona would need training or would give up on part of it.
- **< 40** — Broken, misleading, or written for developers.

A category cannot score above 89 if any of these is true anywhere in it: a visible bug; developer jargon a site owner will read; an action with no feedback; a control whose purpose needs hovering to learn; layout that clips, overlaps, or scrolls sideways.

## Categories and what to check

1. **Information architecture & navigation** — rail sections and names, what is in each, badges, topbar, user menu, site switcher, ⌘K results, 404 view.
2. **Settings organisation** — groups, order, one-Save behaviour, sticky bar, search landing on fields, wording of every label and help string, Content types reachable.
3. **Help & guidance** — `#/help` structure and language, ? sheets on ≥5 screens, empty states, glossary, first-run.
4. **Editor: layout, outline, inspector** — preview scale at 1440, outline width and clipping, default selection, toolbar count and clarity, panel toggles, Page tab field layout, restore points, dialogs (Escape, stacking).
5. **Editor: block model & width** — one width vocabulary, Layout section on top-level and nested blocks, picker descriptions, field-less blocks editable, width changes visible on both templates.
6. **Dashboard & content lists** — needs-attention, continue editing, New menu, type-aware columns, filters, status wording, import/export placement.
7. **Site tools** — Navigation, Design, Header & footer, Template code, SEO: wording, structure, no raw keys.
8. **Studio admin** — People, Apps (switch + plain capabilities, no "restart the server" without guidance), Deploy (owner view vs developer details), Audit log readability, plugin panels placement and empty states.
9. **Feedback, errors, resilience** — 401 handling in place, two sites on one host, unknown panel, toasts, validation messages, unsaved guards.
10. **Visual consistency & polish** — one card pattern, one badge system, no inline layout styles in new code, spacing rhythm, light and dark studio themes both clean, no ghost elements in previews.
11. **Preview fidelity & responsiveness** — no consent banner or hidden panels in previews, device modes, behaviour at 1280 and 1024 widths, mobile drawer.
12. **Accessibility & keyboard** — no nested interactive elements, labels on icon buttons, focus visible, Escape closes the top-most layer only, tree keyboard nav, one active row in palette.

## Output format (write to `docs/ux-overhaul/NN-critic-roundN.md`)

```
# Critic — round N
Average: NN

| # | Category | Score | Blocking issues (must fix to pass 90) |
...
## Findings
For each finding: category · severity (blocker/major/minor) · site · page/hash · what you did · what happened · what should happen · file/function to look at.
```
Do not soften. Do not award ≥90 unless you personally tried to make it fail and could not. Fewer, precise findings beat a long list.
