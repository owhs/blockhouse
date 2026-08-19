// Studio shell — a single server-rendered page; all panels are ES modules.

import type { BlockhouseEnv } from './env.ts'

export async function adminShell(env: BlockhouseEnv, adminPath = 'admin'): Promise<string> {
  const site = await env.site()
  const v = (env as any).assetVersion || '1'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(site.name)} · Blockhouse Studio</title>
<link rel="stylesheet" href="/${adminPath}/assets/studio.css?v=${v}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#6d5df6"/><path d="M8 11l4 10 4-8 4 8 4-10" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>')}">
</head>
<body data-app="blockhouse-studio">
<div id="app"><div class="boot"><div class="boot-mark">W</div><p>Loading studio…</p></div></div>
<script>window.__blockhouse = { dev: ${env.dev}, v: ${JSON.stringify(v)}, adminPath: ${JSON.stringify(adminPath)} }</script>
<script type="module" src="/${adminPath}/assets/main.js?v=${v}"></script>
</body>
</html>`
}

function escape(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]) }
