# WP-6 — Resilience & preview fidelity

Owner files: `src/assets/admin/api.js` (53 lines), `src/auth/session.ts` (105 lines), `src/assets/blockhouse/runtime.js` (524 lines — read lines 1–60 and grep the rest), `src/render/page.ts` (grep `preview`, `editor`, `bare`), `src/assets/admin/design.js` (only the template list, grep `TEMPLATES` and where the list is painted), `src/server/api.ts` (only the `/themes` handler at ~line 853), `src/assets/admin/main.js` (only `route()` and `render404`, lines 540–590), `src/assets/admin/views.js` (only `registerView('pluginPanel'…)` at ~line 1251).

## Problems (observed)

1. **Session expiry** renders every view as "This view failed to load — Your session has expired" inside a stretched full-height `.empty` block with a tall skinny "Try again" button. The user must guess to reload.
2. **Two studios on localhost** on different ports share the session cookie name, so signing into 8793 signs you out of 8792. The site-switcher feature (`blockhouse sites add --port`) makes this a normal setup.
3. **Ghost mega-menu panels** render translucent over the hero in every preview iframe (editor, header & footer, navigation) on strongman. Hidden `.mega`/dropdown panels are visible in preview mode.
4. **Cookie consent banner** appears inside the Design preview and the editor preview.
5. **Design page lists "LICENSE"** as an installed theme ("Installed theme package · Custom · radius 8px").
6. `#/p/forms` on a site without that panel silently redirects to the dashboard.

## Required outcome

1. `api.js`: on any 401 from an admin API call, dispatch one `bh:signedout` event (deduplicated while one is pending). `main.js` listens: it renders the sign-in card **in place of the current view only**, keeps the rail, and after a successful sign-in re-runs `route()` for the current hash instead of `location.reload()`. The failed-view fallback in `route()` must be laid out like other empty states (wrap in `div.main > div.main-pad`), and its message for a 401 is "You've been signed out. Sign in again to carry on where you were." with a Sign in button that opens the same in-place card. Remove the "session expired" toast duplication (one message, not two).
2. `session.ts`: the session and CSRF cookie names include a short stable per-site suffix derived from the project secret (e.g. first 6 hex chars of SHA-256 of `env.secret`) so two sites on the same host never collide. Keep the existing names as the prefix. Check `getCookie/setCookie` call sites (grep `SESSION_COOKIE`, `CSRF_COOKIE`) including the client-side CSRF read in `api.js` (it must discover the cookie by prefix, not exact name).
3. Preview mode: when the page is rendered with `?editor=1` or `?__blockhousepreview=1` (see `page.ts` for how preview is detected — it already supports `bare`), add `data-bh-preview` on `<html>`. `runtime.js`: in preview, (a) do not show the consent banner, theme-toggle onboarding, or any timed popups; (b) ensure mega/dropdown panels are fully hidden until opened — audit the CSS rule that hides `.has-mega .mega` in the strongman template (`templates/strongman/components.css`, grep `.mega`) and any other templates that use `opacity` without `visibility:hidden`/`pointer-events:none`, and fix the CSS. The fix must not change visitor-facing behaviour except removing a visible bug.
4. `/themes` handler (and `design.js` if it filters client-side): only list directories that contain a template manifest (`template.json` or whatever `templates/<name>/` uses — check `templates/aurora/`). Files like `LICENSE` never appear.
5. `pluginPanel` view: when the panel does not exist, render an empty state "This app isn't switched on for this site" with a button to `#/plugins` (Apps), instead of redirecting.

## Acceptance

- With a valid session, delete the session cookie in devtools and click a rail item: the sign-in card appears inside the view area with the rail intact; after dev-login the same hash renders.
- Sign into 8792 then 8793 in the same browser: both stay signed in.
- Editor preview on strongman shows no translucent mega panels over the hero, no cookie banner.
- Design page lists templates only; no "LICENSE".
- `#/p/forms` on automatic shows the empty state.
- tests 48/48; typecheck error count unchanged (61).
