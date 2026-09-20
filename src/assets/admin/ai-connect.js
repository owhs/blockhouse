// Connect an AI assistant — each person makes their own connection to the site.
//
// A connection is a private key for one AI app (Claude, ChatGPT, Cursor…). The
// app then works on the website as that person: it can read everything they
// can, change what they can change, and — only if they tick the box — publish.
// The key is shown once. Removing a connection cuts that app off at once.

import { get, post, del } from './api.js'
import { h, toast, confirmDialog, dialog, emptyState, skeleton, fmtDate } from './ui.js'
import { icon, iconEl } from './icons.js'
import { registerView, state } from './state.js'

const address = () => `${location.origin}/mcp`

function copyRow(label, value) {
  const input = h('input.input.mono', { readonly: true, value, onclick: e => e.target.select(), 'aria-label': label })
  return h('div.ai-copy', {},
    h('label.ai-copy-label', {}, label),
    h('div.ai-copy-row', {}, input,
      h('button.btn.ghost.small', {
        onclick: async () => {
          try { await navigator.clipboard.writeText(value); toast('Copied') }
          catch { input.select(); toast('Press Ctrl+C to copy', 'info') }
        },
      }, 'Copy')))
}

function showKey(name, token) {
  const claudeCode = `claude mcp add --transport http ${slug()} ${address()} --header "Authorization: Bearer ${token}"`
  const json = JSON.stringify({ mcpServers: { [slug()]: { type: 'http', url: address(), headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
  dialog({
    title: `“${name}” is ready`,
    width: 640,
    body: h('div.ai-key', {},
      h('p.ai-warn', {}, iconEl('warn', 16), h('span', {}, 'Copy the key now. For safety it is never shown again — if you lose it, remove this connection and make a new one.')),
      copyRow('Address', address()),
      copyRow('Key', token),
      h('h4', {}, 'Claude desktop'),
      h('p.sub', {}, 'Claude desktop: Settings → Developer → Edit Config, and paste the settings below (they are the same for every app). Restart Claude and the website appears in its tools list.'),
      h('h4', {}, 'Claude Code'),
      copyRow('Run this once in a terminal', claudeCode),
      h('h4', {}, 'Cursor, VS Code, opencode and others'),
      h('p.sub', {}, 'Add this to the app’s MCP settings file:'),
      h('pre.ai-json', {}, json),
      h('button.btn.ghost.small', { onclick: async () => { try { await navigator.clipboard.writeText(json); toast('Copied') } catch { toast('Select the text and press Ctrl+C', 'info') } } }, 'Copy settings')),
    actions: [{ label: 'I have copied it', kind: 'primary' }],
    dismissable: false,
  })
}

const slug = () => (state.meta?.site?.name || 'website').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website'

registerView('ai', async root => {
  const body = h('div.main-pad.mw-64', {})
  root.replaceChildren(h('div.main', {}, body))
  const head = h('div.page-head', {},
    h('div', {}, h('h1', {}, 'Connect an AI assistant'),
      h('p.sub', {}, 'Let an AI app such as Claude work on this website for you — read pages, draft new ones, fix wording. It signs in as you, so it can only do what you can do, and everything it changes is listed under your name in Activity.')))
  body.replaceChildren(head, skeleton('rows', 3))

  async function paint() {
    const { connections, canPublish, canWrite } = await get('/me/ai-connections')

    const name = h('input.input', { placeholder: 'e.g. Claude on my laptop', maxlength: 60, id: 'ai-name' })
    const publish = h('input', { type: 'checkbox', id: 'ai-publish' })
    const make = h('button.btn.primary', {
      onclick: async () => {
        make.disabled = true
        try {
          const label = name.value.trim() || 'My AI assistant'
          const res = await post('/me/ai-connections', { name: label, allowPublish: publish.checked })
          await paint()
          showKey(label, res.token)
        } catch (e) { toast(e.message || 'Could not make the connection', 'error') }
        finally { make.disabled = false }
      },
    }, 'Make a connection')

    const form = h('div.card.ai-new', {},
      h('h3', {}, 'New connection'),
      h('label.field-label', { for: 'ai-name' }, 'A name, so you can tell your connections apart'),
      name,
      canPublish
        ? h('label.ai-check', { for: 'ai-publish' }, publish,
          h('span', {}, h('strong', {}, 'Allow it to publish'),
            h('span.sub', {}, ' Leave this off and the assistant can only prepare drafts — you press Publish yourself after reading them.')))
        : h('p.sub', {}, canWrite
          ? 'Your account cannot publish, so the assistant cannot either: it prepares drafts for an editor to check.'
          : 'Your account can read the site but not change it, so the assistant will be read-only too.'),
      h('div.ai-actions', {}, make))

    const list = connections.length
      ? h('div.card.ai-list', {},
        h('h3', {}, 'Your connections'),
        ...connections.map(c => h('div.ai-row', {},
          h('div.ai-row-main', {},
            h('strong', {}, c.name),
            h('span.sub', {}, `Made ${fmtDate(c.createdAt)} · ${c.uses ? `used ${c.uses} time${c.uses === 1 ? '' : 's'}` : 'not used yet'} · ${c.allowPublish ? 'can publish' : 'drafts only'}`)),
          h('button.btn.ghost.small.danger', {
            onclick: async () => {
              if (!await confirmDialog(`Remove “${c.name}”?`, 'The AI app using this key will be cut off straight away. Nothing it already changed is undone.', 'Remove')) return
              await del(`/me/ai-connections/${c.id}`)
              toast('Removed'); paint()
            },
          }, 'Remove'))))
      : emptyState(icon('plug', 28) || '', 'No connections yet', 'Make one above, then paste the address and key into your AI app.')

    const what = h('div.card.ai-what', {},
      h('h3', {}, 'What it can and cannot do'),
      h('ul', {},
        h('li', {}, 'Read your pages, content types and the blocks available, and search the site.'),
        h('li', {}, 'Start new pages and change existing ones — as drafts, with a restore point each time, so anything can be undone from the page’s history.'),
        h('li', {}, 'Publish, only if you ticked the box for that connection.'),
        h('li', {}, 'It cannot see or change settings, people, passwords, plugins, files on the server, or anything your own account cannot.')))

    body.replaceChildren(head, form, list, what)
  }
  await paint()
})
