#!/usr/bin/env node
// Blockhouse CLI launcher — runs TS directly via Bun when available, else via tsx on Node.
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const cli = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url))
if (typeof Bun !== 'undefined') {
  await import(cli)
} else {
  const r = spawnSync(process.execPath, ['--import', 'tsx', cli, ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(r.status ?? 0)
}
