// node:http → fetch adapter (used when running on Node without Bun).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export function serve(opts: { fetch: (req: Request) => Promise<Response>; port: number }, onListen?: () => void) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = `http://${req.headers.host || 'localhost'}${req.url}`
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        headers.set(k, Array.isArray(v) ? v.join(', ') : v)
      }
      const ac = new AbortController()
      req.on('close', () => ac.abort())
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      const request = new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as any) : undefined,
        signal: ac.signal,
        // @ts-expect-error node needs this for streamed bodies
        duplex: hasBody ? 'half' : undefined,
      })
      const response = await opts.fetch(request)
      const outHeaders: Record<string, string | string[]> = {}
      const setCookies = (response.headers as any).getSetCookie?.() ?? []
      response.headers.forEach((v, k) => { if (k !== 'set-cookie') outHeaders[k] = v })
      if (setCookies.length) outHeaders['set-cookie'] = setCookies
      res.writeHead(response.status, outHeaders)
      if (response.body) {
        for await (const chunk of response.body as any) res.write(chunk)
      }
      res.end()
    } catch (e) {
      console.error('[blockhouse node-server]', e)
      if (!res.headersSent) res.writeHead(500)
      res.end('Internal error')
    }
  })
  server.listen(opts.port, onListen)
  return server
}
