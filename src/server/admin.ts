// Studio shell — a single server-rendered page; all panels are ES modules.

import type { BlockhouseEnv } from './env.ts'
import { cookieNames } from '../auth/session.ts'

export async function adminShell(env: BlockhouseEnv, adminPath = 'admin'): Promise<string> {
  const site = await env.site()
  // In dev the studio's own assets are read straight off disk, so bust the
  // cache per request — otherwise editing a panel needs a server restart.
  const csrfCookie = (await cookieNames(env.secret)).csrf
  const v = env.dev ? Date.now().toString(36) : ((env as any).assetVersion || '1')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="bh-csrf-cookie" content="${csrfCookie}">
<title>${escape(titleOf(site.name, site.url))}</title>
<link rel="stylesheet" href="/${adminPath}/assets/studio.css?v=${v}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2f7a63"/><path d="M11 23V9h6a3.5 3.5 0 0 1 0 7h-6m0 0h6.8a3.5 3.5 0 0 1 0 7H11" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>')}">
</head>
<body data-app="blockhouse-studio">
<div id="app"><div class="boot"><div class="boot-mark">B</div><p>Loading studio…</p></div></div>
<script>window.__blockhouse = { dev: ${env.dev}, v: ${JSON.stringify(v)}, adminPath: ${JSON.stringify(adminPath)} }</script>
<script type="module" src="/${adminPath}/assets/main.js?v=${v}"></script>
</body>
</html>`
}

/**
 * Two sites can share a name (a staging copy of a live site), and then two
 * studio tabs read identically. Add the site's own web address, host only, so
 * the tab strip always tells them apart.
 */
function titleOf(name: string, url: unknown): string {
  const raw = String(url || '').trim()
  let host = ''
  try { host = raw ? new URL(raw.includes('://') ? raw : `https://${raw}`).host : '' } catch { host = '' }
  return `${name}${host ? ` (${host})` : ''} · Blockhouse Studio`
}

function escape(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]) }
