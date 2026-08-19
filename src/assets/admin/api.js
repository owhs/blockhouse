// Studio API client — CSRF header + friendly errors.
import { toast } from './ui.js'

function csrf() {
  return document.cookie.split('; ').find(c => c.startsWith('blockhouse_c='))?.slice(7) || ''
}

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      'x-blockhouse-csrf': csrf(),
      ...(opts.headers || {}),
    },
    body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string'
      ? JSON.stringify(opts.body) : opts.body,
  })
  let json = null
  try { json = await res.json() } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `${res.status} ${res.statusText}`)
    err.status = res.status
    err.data = json
    if (res.status !== 409 && !opts.quiet) toast(err.message, 'err')
    throw err
  }
  return json
}

export const get = p => api(p)
export const post = (p, body) => api(p, { method: 'POST', body })
export const put = (p, body) => api(p, { method: 'PUT', body })
export const patch = (p, body) => api(p, { method: 'PATCH', body })
export const del = p => api(p, { method: 'DELETE' })
