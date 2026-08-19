// Mail drivers. `console` for dev, `webhook` posts JSON to any HTTP mailer or
// automation endpoint, `resend` speaks the Resend API (works from Workers too).

import type { Registry } from '../core/registry.ts'

export function registerMailDrivers(registry: Registry) {
  registry.registerMailDriver({
    id: 'console',
    async send(msg) {
      console.log(`\n[blockhouse mail] to: ${msg.to}\n  subject: ${msg.subject}\n  ${(msg.text || msg.html || '').slice(0, 500).replace(/\n/g, '\n  ')}\n`)
    },
  })

  registry.registerMailDriver({
    id: 'webhook',
    async send(msg, options) {
      if (!options.url) throw new Error('mail.options.url required for webhook driver')
      const res = await fetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        body: JSON.stringify(msg),
      })
      if (!res.ok) throw new Error(`mail webhook failed: ${res.status}`)
    },
  })

  registry.registerMailDriver({
    id: 'resend',
    async send(msg, options) {
      if (!options.apiKey) throw new Error('mail.options.apiKey required for resend driver')
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ from: msg.from || options.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      })
      if (!res.ok) throw new Error(`resend failed: ${res.status} ${await res.text()}`)
    },
  })

  registry.registerMailDriver({
    id: 'sendgrid',
    async send(msg, options) {
      if (!options.apiKey) throw new Error('mail.options.apiKey required for sendgrid driver')
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to }] }],
          from: { email: msg.from || options.from || 'no-reply@example.com' },
          subject: msg.subject,
          content: [
            ...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []),
            ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
          ],
        }),
      })
      if (!res.ok && res.status !== 202) throw new Error(`sendgrid failed: ${res.status} ${await res.text()}`)
    },
  })

  // MailChannels — free relay for sites running on Cloudflare Workers
  registry.registerMailDriver({
    id: 'mailchannels',
    async send(msg, options) {
      const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to }], ...(options.dkim ? { dkim_domain: options.dkim.domain, dkim_selector: options.dkim.selector, dkim_private_key: options.dkim.key } : {}) }],
          from: { email: msg.from || options.from || 'no-reply@example.com' },
          subject: msg.subject,
          content: [
            ...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []),
            ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
          ],
        }),
      })
      if (!res.ok && res.status !== 202) throw new Error(`mailchannels failed: ${res.status} ${await res.text()}`)
    },
  })

  // Postmark — a favourite for transactional deliverability
  registry.registerMailDriver({
    id: 'postmark',
    async send(msg, options) {
      if (!options.apiKey) throw new Error('mail.options.apiKey required for postmark driver')
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-postmark-server-token': options.apiKey },
        body: JSON.stringify({ From: msg.from || options.from, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html }),
      })
      if (!res.ok) throw new Error(`postmark failed: ${res.status} ${await res.text()}`)
    },
  })
}
