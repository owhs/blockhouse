# Blockhouse Studio — UX evaluation rubric

A fixed lens for judging the studio. Every review pass scores the same ten
categories against the same tests, so scores are comparable across passes and a
regression is visible as a dropped score, not a vibe.

## Mindset

Judge the studio as **an instrument, not a form**. The question is never "can
this be done" — almost everything can. The question is:

> **Can a person do the thing at the speed they thought of it, without leaving
> the place they were standing?**

Three personas, all of whom must be served *by the same screen*:

- **Mara (first week).** Runs a small business site. Knows what she wants to
  change, not what it is called. Must never be shown a wall of options she
  cannot evaluate. Must never be *punished* for exploring.
- **Tom (daily driver).** Publishes 5–20 documents a week. Lives in the editor.
  Cares about keystrokes, muscle memory, and not re-finding the same control.
- **Priya (builds the site).** Templates, types, redirects, deploys. Needs every
  lever reachable, but never at Mara's expense.

The failure mode we are correcting is **"2015 admin panel"**: capable, honest,
and organised by *where the data lives* rather than by *what the person is
trying to do*. Symptoms: features scattered by implementation boundary; the same
list rendered twice; navigation that grows a row per feature forever; nothing
findable except by reading every label; no motion, so nothing feels causal.

## Scoring

Each category scores **0–100**. A category is a weighted set of atomic checks;
each check is pass (full), partial (half), or fail (zero). **95 is the bar.**

A score is only valid if the check was **exercised in a running studio** — code
reading finds candidates, the browser confirms them. Anything unverified is
recorded as a finding, not a score.

**Regression rule:** a later pass may not lower any earlier category score. If it
does, the change that caused it is wrong, not the rubric.

---

### 1. Findability — "where is that?"
Can a person locate a control they have never used, in under ~10 seconds,
without a manual?

- Every setting, action and view is reachable from **one** search that covers
  settings fields, not just view names.
- The command palette returns *destinations inside views* (a settings group, a
  block type, a document), not only top-level routes.
- No control exists in exactly one place with no pointer from the place a person
  would first look.
- Navigation does not require scrolling to see the whole of it at 900px tall.
- Related things that were split for implementation reasons carry a visible
  cross-link ("palette lives in Design →").

### 2. Information architecture — "why is it *there*?"
Is the grouping defensible to someone who does not know the codebase?

- Groups are named for jobs, not subsystems.
- No item is plausibly in two groups without a cross-reference.
- Depth ≤ 2 to reach any control from the shell.
- The same concept has one name everywhere (no Assets/Media/media drift).
- Grouping is *inspectable* — a person can re-group or pin to suit their work.

### 3. Flow & continuity — "did I have to leave?"
Does completing a task keep you in place?

- Common edits (a menu link, a footer row, a colour) do not require a full
  route change away from the preview.
- Returning from a detour restores where you were (scroll, selection, tab).
- No task requires remembering a value across two screens.
- Destructive or slow actions report progress in place, not by reloading.
- `location.reload()` is never used as a state-management strategy.

### 4. Editor power — "can I work fast?"
The editor is the most-used screen; judge it hardest.

- Keyboard: save, undo/redo, delete, duplicate, add-after, move, select parent,
  next/prev block, command palette — all bound, all discoverable.
- Block insertion is ≤ 2 actions from anywhere, including from the canvas.
- Copy/paste of blocks, including across documents.
- The preview is the primary surface, not a squeezed third column.
- Multi-select and bulk ops where lists exist.

### 5. Feedback & state — "what just happened?"
Every action visibly changes something within 100ms.

- Save state is always truthful and always visible.
- Errors say what to do next, not just what failed.
- Long actions show determinate or at least honest progress.
- Optimistic UI where safe; rollback where not.
- Nothing silently succeeds.

### 6. Progressive disclosure — "am I drowning?"
Mara sees a clean screen; Priya's levers are one deliberate step away.

- Advanced/rare controls are behind a disclosure, not absent and not default.
- Defaults are good enough that a beginner never opens the disclosure.
- Disclosure state persists per person.
- Empty states teach the next action rather than apologising.
- No screen presents more than ~7 primary choices at once.

### 7. Consistency & craft — "is this one product?"
- One spacing scale, one radius scale, one type scale — used.
- Buttons of the same weight look and behave the same everywhere.
- Icons are drawn from one set at one weight.
- Lists, panels and cards share one structure.
- No duplicated rendering of the same data in one view.

### 8. Motion & responsiveness — "does it feel alive?"
- State changes animate: 120–220ms, eased, and reduced-motion respected.
- Nothing janks or reflows on open.
- Perceived latency covered by skeletons, not spinners, where the shape is known.
- Hover/focus/active are distinct and instant.
- The studio is usable at tablet width and does not break at phone width.

### 9. Accessibility & input — "can everyone drive it?"
- Full keyboard reachability; visible focus ring everywhere.
- Dialogs trap focus and restore it on close.
- Landmarks, labels and live regions present.
- Colour is never the only carrier of meaning.
- Contrast passes AA in both themes and all palettes.

### 10. Trust & safety — "can I explore without fear?"
- Destructive actions are undoable or confirmed with the real consequence named.
- Unsaved work survives navigation and reload.
- Conflicts are explained in terms of people, not versions.
- Nothing is lost by pressing the wrong thing once.
- Permission-gated controls are explained, not hidden without trace.

---

## Test protocol

Each pass runs these **task walkthroughs** in a live studio and records the
number of clicks, the number of route changes, and any dead end:

| # | Task | Persona |
|---|------|---------|
| T1 | Change the site's accent colour and see it | Mara |
| T2 | Add a link to the main menu | Mara |
| T3 | Change the text in the footer | Mara |
| T4 | Create a page, add a hero + two columns, publish | Mara |
| T5 | Find where to turn off the sitemap | Priya |
| T6 | Duplicate a block and move it into another section | Tom |
| T7 | Write a post, set its share image and description, schedule it | Tom |
| T8 | Find every page with unpublished edits and publish them | Tom |
| T9 | Add a new content type with two fields, then create one | Priya |
| T10 | Set a redirect from an old URL | Priya |
| T11 | Recover from an accidental block deletion | Mara |
| T12 | Do T1–T4 on a 1024px-wide window | any |

A task fails the pass if it needs a manual, more than 2 route changes, or any
backtracking caused by the interface rather than the person changing their mind.
