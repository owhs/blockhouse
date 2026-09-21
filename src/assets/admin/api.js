// Studio API client — CSRF header + friendly errors.
import { toast } from './ui.js'

// Each site gets its own cookie name (`blockhouse_c_<suffix>`) so two sites on
// the same host do not overwrite each other's sign-in — see src/auth/session.ts.
// Match on the prefix, not an exact name.
const CSRF_PREFIX = 'blockhouse_c'
function csrf() {
  // Prefer the per-site name (`blockhouse_c_<suffix>`); a stale legacy
  // `blockhouse_c` cookie from an older build must never win over it.
  // Two sites on one host both leave a `blockhouse_c_<suffix>` cookie, so the
  // shell names its own (meta bh-csrf-cookie); the prefix scan is the fallback.
  const named = document.querySelector('meta[name="bh-csrf-cookie"]')?.content
  const hits = document.cookie.split('; ').filter(c => c.startsWith(CSRF_PREFIX) && c.includes('='))
  const hit = (named && hits.find(c => c.startsWith(named + '='))) || hits.find(c => c.startsWith(CSRF_PREFIX + '_')) || hits[0]
  return hit ? hit.slice(hit.indexOf('=') + 1) : ''
}

// One 401 signs you out once. Several views can fail at the same moment, and
// three copies of the same sign-in prompt is not three times as helpful.
let signedOutPending = false
/** Call when a sign-in has succeeded, so the next 401 is announced again. */
export function clearSignedOut() { signedOutPending = false }

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
    const err = new Error(explain(res.status, json, path))
    err.status = res.status
    err.data = json
    err.raw = json?.error
    if (res.status === 401) {
      // The shell puts a sign-in card in the view area; a toast saying the same
      // thing would be the second half of a duplicated message.
      if (!signedOutPending) {
        signedOutPending = true
        dispatchEvent(new CustomEvent('bh:signedout'))
      }
    } else if (res.status !== 409 && !opts.quiet) toast(err.message, 'err')
    throw err
  }
  return json
}

/**
 * Say what happened, why, and what to do about it. A toast reading
 * "404 Not Found" is an error message that has given up.
 */
function explain(status, json, path) {
  const raw = json?.error
  if (status === 401) return 'You’ve been signed out. Sign in again to carry on where you were.'
  if (status === 403) return raw || 'Your account does not have permission for that. An owner or admin can grant it under Apps & permissions.'
  if (status === 404) return raw || `That is no longer there (${path}). It may have been deleted — try reloading.`
  if (status === 413) return 'That file is too large for this site’s upload limit.'
  if (status === 422 || status === 400) return raw || 'Some of those values were not accepted — check the highlighted fields.'
  if (status === 429) return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500) return raw ? `The server failed: ${raw}` : 'The server failed to handle that. Check the server log, then try again.'
  return raw || `${status} ${path}`
}

export const get = p => api(p)
export const post = (p, body) => api(p, { method: 'POST', body })
export const put = (p, body) => api(p, { method: 'PUT', body })
export const patch = (p, body) => api(p, { method: 'PATCH', body })
export const del = p => api(p, { method: 'DELETE' })
