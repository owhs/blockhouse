# Let an AI assistant work on the website

Anyone with a studio login can let an AI app — Claude, Cursor, VS Code,
opencode — read and edit the website for them. The app signs in **as that
person**, with a private key they make themselves.

## What you need

- A login to the studio (ask the site owner to add you under **People**).
- An AI app that supports "MCP" connections. Claude desktop, Claude Code,
  Cursor, VS Code and opencode all do.

## Set it up (two minutes)

1. Open the studio, e.g. `https://strongman.owhs.uk/admin`, and sign in.
2. Click **your name** (top right) → **Connect an AI assistant…**
3. Give the connection a name you will recognise, e.g. *Claude on my laptop*.
4. Leave **Allow it to publish** off unless you really want the AI to put
   things live by itself. Off means it can only prepare drafts, and you press
   Publish after reading them.
5. Press **Make a connection**. You are shown two things:
   - the **address** — `https://<your site>/mcp`
   - the **key** — starts with `bhai_`. **It is shown once.** Copy it now.
6. Paste them into your AI app:

   **Claude Code** — run once in a terminal:

   ```bash
   claude mcp add --transport http strongman https://strongman.owhs.uk/mcp --header "Authorization: Bearer bhai_YOUR_KEY"
   ```

   **Claude desktop, Cursor, VS Code, opencode** — add to the app's MCP
   settings file (the studio gives you this ready-filled, with a Copy button):

   ```json
   {
     "mcpServers": {
       "strongman": {
         "type": "http",
         "url": "https://strongman.owhs.uk/mcp",
         "headers": { "Authorization": "Bearer bhai_YOUR_KEY" }
       }
     }
   }
   ```

7. Ask the AI something like *"List the pages on the strongman site"* to check
   it works.

## What the AI can do

| It can | It cannot |
| --- | --- |
| Read pages, content types and the list of blocks; search the site | See or change settings, people, passwords, plugins or server files |
| Start new pages and edit existing ones (always as a draft, with a restore point) | Do anything your own account is not allowed to do |
| Check the site for broken links | Publish — unless you ticked the box for that connection |
| Read form submissions — **only** if you are an owner or admin | |

An **author** account's AI can only change pages that author wrote. A
**viewer** account's AI is read-only.

## Staying safe

- Every change the AI makes appears in **Activity** as
  *Your Name (AI assistant: connection name)*.
- Anything it changed can be rolled back from the page's **History**.
- Lost the key, or finished with it? **Your name → Connect an AI assistant →
  Remove**. The app is cut off immediately. Owners can remove anyone's.
- There is no way in without a key: no anonymous access, and a studio browser
  session cannot be used by another web page to reach it.
- Each connection is limited to 120 requests a minute, and each person to 10
  connections.
- Never paste a key into a chat, an email or a shared document. Treat it like
  your password.

## For developers

`POST /mcp`, JSON-RPC 2.0, `Authorization: Bearer bhai_…`. Methods:
`initialize`, `tools/list`, `tools/call`, `ping`. Batches are accepted.
Source: `src/server/mcp-http.ts` (auth, limits, audit) and `src/agent/mcp.ts`
(the tools, shared with the local `blockhouse mcp --dir <site>` stdio server).
