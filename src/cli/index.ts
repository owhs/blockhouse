// blockhouse CLI — dev/serve/export/init/seed/user management.

import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const HELP = `
  blockhouse — a modular, git-friendly site builder

  usage: blockhouse <command> [options]

  commands
    dev            run the live server with reload      --dir <site> --port 8787
    serve          run the production server            --dir <site> --port 8787
    export         build a flat static site             --dir <site> --out dist [--stage]
    init <name>    scaffold a fresh site folder
    seed           load the demo content into --dir
    check          validate content integrity (CI)      --dir <site>
    doctor         diagnose runtime, config, security   --dir <site> [--target docker|cloudflare|static|server] [--deep] [--json]
    budget         measure page weight against budgets  --dir <site> [--fail] [--json]
    deploy:init    write deployment files               <docker|systemd|caddy|nginx|cloudflare|pages|github> --dir [--force]
    mcp            run the MCP server for AI agents      --dir <site>
    sites          multi-site registry: sites add|list|remove   --dir <site> --port
    user:add       create a user                        --dir --email --password --name --role
    user:reset     reset a studio password safely       --dir --email [--password]
    security:preview-link   print/rotate the staging bypass link   --dir <site> [--rotate]
    publish:due    publish docs whose publishAt has passed

  environment
    BLOCKHOUSE_ENV       selects the site.<env>.json overlay (dev · staging · production)
    BLOCKHOUSE_SECRET    cookie signing secret (generated into .blockhouse/secret when unset)
    BLOCKHOUSE_SITE_URL  overrides the public URL — see \`blockhouse doctor\` for every layer
`

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: '.' },
      port: { type: 'string' },
      out: { type: 'string', default: 'dist' },
      stage: { type: 'boolean', default: false },
      email: { type: 'string' }, password: { type: 'string' },
      name: { type: 'string' }, role: { type: 'string', default: 'editor' },
      target: { type: 'string' }, deep: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false }, fail: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false }, env: { type: 'string' },
      rotate: { type: 'boolean', default: false },
    },
  })
  const dir = resolve(values.dir!)

  switch (cmd) {
    case 'dev':
    case 'serve': {
      requireSite(dir)
      const { serve } = await import('../server/node.ts')
      await serve(dir, { dev: cmd === 'dev', port: values.port ? parseInt(values.port, 10) : undefined })
      break
    }
    case 'export': {
      requireSite(dir)
      const { createNodeEnv } = await import('../server/node.ts')
      const { exportStatic } = await import('../export/static.ts')
      const env = await createNodeEnv(dir)
      const res = await exportStatic(env, { outDir: resolve(dir, values.out!), stage: values.stage })
      console.log(`  ✓ exported ${res.pages} pages, ${res.assets} assets, ${res.variants} image variants → ${res.outDir}`)
      process.exit(0)
    }
    case 'init': {
      const name = positionals[0]
      if (!name) fail('usage: blockhouse init <folder>')
      const { initSite } = await import('./init.ts')
      await initSite(resolve(name!))
      console.log(`  ✓ created ${name}\n    next: blockhouse dev --dir ${name}`)
      break
    }
    case 'seed': {
      const { seedDemo } = await import('./seed.ts')
      await seedDemo(dir)
      console.log(`  ✓ demo content seeded into ${dir}`)
      process.exit(0)
    }
    case 'user:add': {
      requireSite(dir)
      if (!values.email || !values.password) fail('--email and --password required')
      const { createNodeEnv } = await import('../server/node.ts')
      const { hashPassword } = await import('../auth/hash.ts')
      const env = await createNodeEnv(dir)
      if (await env.secure.userByEmail(values.email!)) fail('email already registered')
      const site = await env.site()
      const u = await env.secure.createUser({
        email: values.email!, name: values.name || values.email!.split('@')[0],
        role: values.role!, pass: await hashPassword(values.password!, site.security?.pbkdf2Iterations),
      })
      console.log(`  ✓ ${u.role} account created: ${u.email}`)
      process.exit(0)
    }
    case 'user:reset': {
      // The sanctioned way back in — no more deleting .blockhouse/ to start over.
      requireSite(dir)
      if (!values.email) fail('--email required')
      const { createNodeEnv } = await import('../server/node.ts')
      const { hashPassword } = await import('../auth/hash.ts')
      const { randomToken } = await import('../core/util.ts')
      const env = await createNodeEnv(dir)
      const u = await env.secure.userByEmail(values.email!)
      if (!u) fail(`no account for ${values.email}`)
      const pw = values.password || randomToken(12)
      const site = await env.site()
      await env.secure.updateUser(u!.id, { pass: await hashPassword(pw, site.security?.pbkdf2Iterations), active: true })
      await env.secure.log('audit', { event: 'auth.reset.cli', userId: u!.id }).catch(() => {})
      console.log(`  ✓ password reset for ${u!.email}`)
      if (!values.password) console.log(`    temporary password: ${pw}\n    (sign in and change it — or use the studio's Forgot password flow)`)
      process.exit(0)
    }
    case 'security:preview-link': {
      requireSite(dir)
      const { readFileSync, writeFileSync } = await import('node:fs')
      const { randomToken } = await import('../core/util.ts')
      const siteJsonPath = resolve(dir, 'site/site.json')
      const site = JSON.parse(readFileSync(siteJsonPath, 'utf8'))
      const existing = site.security?.previewToken
      if (existing && !values.rotate) {
        console.log(`  existing preview link — add this to any URL on the site:\n    ?preview=${existing}`)
      } else {
        const token = randomToken(20)
        site.security = { ...(site.security || {}), previewToken: token }
        writeFileSync(siteJsonPath, JSON.stringify(site, null, 2) + '\n')
        console.log(`  ✓ ${existing ? 'rotated' : 'created'} preview link — add this to any URL on the site:\n    ?preview=${token}\n    (works once, then remembers via cookie — the site must be restarted to pick this up)`)
      }
      process.exit(0)
    }
    case 'check': {
      requireSite(dir)
      const { createNodeEnv } = await import('../server/node.ts')
      const { validateSite } = await import('../agent/validate.ts')
      const env = await createNodeEnv(dir)
      const issues = await validateSite(env)
      const errors = issues.filter(i => i.level === 'error')
      for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} [${i.where}] ${i.message}`)
      if (!issues.length) console.log('  ✓ no issues found')
      console.log(`\n  ${errors.length} error(s), ${issues.length - errors.length} warning(s)`)
      process.exit(errors.length ? 1 : 0)
    }
    case 'doctor': {
      requireSite(dir)
      const { createNodeEnv } = await import('../server/node.ts')
      const { doctor, printChecks } = await import('./doctor.ts')
      // Default to checking the dev environment; `--env production` (or
      // BLOCKHOUSE_ENV) switches to the stricter deploy-readiness pass.
      const envName = values.env || process.env.BLOCKHOUSE_ENV || 'dev'
      const env = await createNodeEnv(dir, { envName, dev: envName === 'dev' })
      const checks = await doctor(env, dir, { target: values.target, deep: values.deep })
      if (values.json) {
        console.log(JSON.stringify({ checks }, null, 2))
        process.exit(checks.some(c => c.level === 'fail') ? 1 : 0)
      }
      console.log(`\n  ⌁ blockhouse doctor — ${(await env.site()).name} · ${env.envName}`)
      const { fails } = printChecks(checks)
      process.exit(fails ? 1 : 0)
    }
    case 'budget': {
      requireSite(dir)
      const { createNodeEnv } = await import('../server/node.ts')
      const { measureSite, kb } = await import('../export/budget.ts')
      const env = await createNodeEnv(dir, { envName: values.env })
      const res = await measureSite(env)
      if (values.json) {
        console.log(JSON.stringify(res, null, 2))
        process.exit(values.fail && res.failures ? 1 : 0)
      }
      const b = res.budget
      console.log(`\n  page weight — budget: html ${kb(b.html)} · css ${kb(b.css)} · js ${kb(b.js)} · total ${kb(b.total)} · ${b.requests} requests\n`)
      console.log(`    ${'page'.padEnd(34)}${'html'.padStart(9)}${'css'.padStart(9)}${'js'.padStart(9)}${'total'.padStart(10)}${'img'.padStart(10)}${'req'.padStart(5)}`)
      for (const p of res.pages) {
        const flag = p.over.length ? ' ✗ ' + p.over.join(',') : ''
        console.log(`    ${p.path.slice(0, 33).padEnd(34)}${kb(p.html).padStart(9)}${kb(p.css).padStart(9)}${kb(p.js).padStart(9)}${kb(p.total).padStart(10)}${kb(p.images).padStart(10)}${String(p.requests).padStart(5)}${flag}`)
      }
      console.log(`\n  median page ${kb(res.median)} · ${res.failures} over budget\n`)
      process.exit(values.fail && res.failures ? 1 : 0)
    }
    case 'deploy:init': {
      requireSite(dir)
      const { deployInit, TARGETS } = await import('./deploy-init.ts')
      const target = (positionals[0] || values.target) as any
      if (!target || !TARGETS.includes(target)) fail(`usage: blockhouse deploy:init <${TARGETS.join('|')}>`)
      const { createNodeEnv } = await import('../server/node.ts')
      const env = await createNodeEnv(dir, { envName: values.env })
      const written = deployInit(dir, target, await env.site(), { force: values.force })
      for (const w of written) console.log(`  ${w.skipped ? '·' : '✓'} ${w.file}${w.skipped ? '  (exists — pass --force to overwrite)' : ''}`)
      console.log(`\n  next: blockhouse doctor --dir ${values.dir} --target ${target === 'pages' ? 'static' : target}\n`)
      process.exit(0)
    }
    case 'sites': {
      const { homedir } = await import('node:os')
      const { readFileSync, writeFileSync, existsSync: ex } = await import('node:fs')
      const regPath = `${homedir()}/.blockhouse-projects.json`
      const load = () => { try { return JSON.parse(readFileSync(regPath, 'utf8')) } catch { return { projects: [] } } }
      const saveReg = (r: any) => writeFileSync(regPath, JSON.stringify(r, null, 2))
      const sub = positionals[0]
      const reg = load()
      if (sub === 'add') {
        requireSite(dir)
        const site = JSON.parse(readFileSync(resolve(dir, 'site/site.json'), 'utf8'))
        reg.projects = reg.projects.filter((p: any) => p.dir !== dir)
        reg.projects.push({ dir, label: values.name || site.name || dir, url: `http://localhost:${values.port || 8787}` })
        saveReg(reg)
        console.log(`  ✓ registered ${dir} (${reg.projects.length} site(s) in ~/.blockhouse-projects.json)`)
      } else if (sub === 'remove') {
        reg.projects = reg.projects.filter((p: any) => p.dir !== dir)
        saveReg(reg)
        console.log('  ✓ removed')
      } else {
        for (const p of reg.projects) console.log(`  ${p.label.padEnd(24)} ${p.dir}  ${p.url || ''}`)
        if (!reg.projects.length) console.log('  no sites registered — blockhouse sites add --dir <site> --port 8787')
      }
      process.exit(0)
    }
    case 'mcp': {
      requireSite(dir)
      const { runMcp } = await import('../agent/mcp.ts')
      await runMcp(dir)
      break // keep process alive on stdin
    }
    case 'publish:due': {
      requireSite(dir)
      const { createNodeEnv } = await import('../server/node.ts')
      const env = await createNodeEnv(dir)
      let n = 0
      for (const d of await env.content.listDocs()) {
        if (d.status !== 'published' && d.publishAt && new Date(d.publishAt).getTime() <= Date.now()) {
          await env.content.publish(d.id); n++
        }
      }
      console.log(`  ✓ published ${n} scheduled doc(s)`)
      process.exit(0)
    }
    default:
      console.log(HELP)
      process.exit(cmd ? 1 : 0)
  }
}

function requireSite(dir: string) {
  if (!existsSync(resolve(dir, 'site', 'site.json'))) {
    fail(`no site found at ${dir} (missing site/site.json) — run: blockhouse init <name>`)
  }
}
function fail(msg: string): never { console.error(`  ✗ ${msg}`); process.exit(1) }

main().catch(e => { console.error(e); process.exit(1) })
