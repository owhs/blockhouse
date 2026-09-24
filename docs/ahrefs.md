# Ahrefs

The Ahrefs app (`plugins/ahrefs`) puts a site's Ahrefs data in the studio, under **Site → Ahrefs**, and next to each page in the editor's SEO tab.

## Setting it up

1. Studio → Apps → switch on **Ahrefs** and approve its permissions.
2. Ahrefs → **Setup** → paste an API v3 key (Ahrefs → Account → API keys). API access needs Ahrefs Enterprise or the API add-on. The key is tested with Ahrefs before it is kept, and it lives in the secure store: never in `site.json`, never in git.
3. Optional, on the same screen:
   - **Site**: leave it empty to report on the site's own address, or give a domain or URL.
   - **Ahrefs project**: needed for Site Audit, Rank Tracker and Web Analytics. Picking one fills in the Web Analytics key.
   - **Verification tag**: paste the whole `<meta name="ahrefs-site-verification" …>` tag from Ahrefs Webmaster Tools. It goes into every page's `<head>`.
   - **Count visitors with Ahrefs Web Analytics**: loads Ahrefs' cookieless script on live pages and adds `analytics.ahrefs.com` to the CSP. When the consent banner is on, the script waits until the visitor accepts analytics.

## What's in it

| Tab | Shows | Ahrefs endpoint(s) |
| --- | --- | --- |
| Overview | DR, referring domains, backlinks, search traffic, a year of history, the site's own daily record | `site-explorer/domain-rating`, `backlinks-stats`, `metrics`, `*-history` |
| Backlinks | New / lost (30 days), best links, referring domains, anchor text, **broken backlinks** | `all-backlinks`, `refdomains`, `anchors`, `broken-backlinks` |
| Keywords | What the site ranks for, with 30-day movement | `organic-keywords` |
| Pages | Top pages by search traffic, linked to their studio page; competing sites | `top-pages`, `organic-competitors` |
| Research | Volume, difficulty, traffic potential, CPC, related phrases, questions, current top 10 | `keywords-explorer/*`, `serp-overview` |
| Projects | Site Audit health and issues, Rank Tracker positions, Web Analytics | `site-audit/*`, `rank-tracker/overview`, `web-analytics/*` |

**Broken backlinks → redirects.** Each address other sites link to that no longer exists gets a **Redirect…** button. It writes a 301 to the same redirects list that SEO → Redirects manages, so the link lands on a working page again.

**Editor.** In the SEO tab, *Look this page up in Ahrefs* shows the page's linking sites, backlinks, search traffic and top keywords, plus volume and difficulty for its focus keyword.

## Cost control

Ahrefs charges `max(50, rows × the sum of the column costs)` units per request, and some columns cost 10 units each. The app keeps spend down by:

- selecting only the columns the studio shows (none of the 10-unit extras it doesn't need);
- fetching **Rows per report** rows (50 by default). At 50 rows the Keywords report costs about 1,750 units and a backlinks list about 500;
- caching every answer (24 h by default). Reopening a report is free, and so is its CSV export. Only **Refresh** asks Ahrefs again;
- an optional **Stop at** cap. Once the key's usage for the cycle passes the cap, reports serve saved answers only;
- never fetching until a report is opened; the editor card waits for a button press too.

Every report shows what it cost, using Ahrefs' `x-api-units-cost-total-actual` header, and Setup shows the plan's usage and this site's total for the month. Rank Tracker calls are free.

## Automations

- Events: `ahrefs.snapshot` fires with each daily record. `ahrefs.changed` fires when DR, referring domains, traffic, keywords or top-3 count moves meaningfully; its `summary` reads e.g. "Domain Rating rose from 30 to 34". The daily record is taken by an hourly in-process check, and also whenever the Overview is opened, which covers hosts without long-lived timers.
- Actions: `ahrefs.snapshot`, `ahrefs.keyword` (volume, difficulty and traffic potential for `{data.keyword}`), and `ahrefs.domainRating` (DR of any domain, e.g. to score a form lead's website).

## Testing locally

`AHREFS_API_BASE` (environment only, no studio setting) points the client at a mock server. `tests/ahrefs.test.ts` covers the client, cache, cap, routes and head tags with a stubbed fetch.
