// Opaque tokens: API keys (data plugin, integrations) and magic links (files,
// newsletter confirmations). Only SHA-256 hashes are stored.

import { randomToken, sha256hex } from '../core/util.ts'
import type { SecureStore } from '../secure/store.ts'

export interface IssuedToken { token: string; id: string }

export async function issueToken(
  secure: SecureStore,
  kind: string,
  opts: { userId?: string; meta?: any; ttlMs?: number; maxUses?: number } = {},
): Promise<IssuedToken> {
  const token = randomToken(32)
  const tokenId = await secure.createToken({ kind, hash: await sha256hex(token), ...opts })
  return { token, id: tokenId }
}

export async function checkToken(secure: SecureStore, kind: string, token: string) {
  if (!token || token.length < 16 || token.length > 128) return null
  return secure.findToken(kind, await sha256hex(token))
}

/** API keys are shown once as `wk_<token>`; scopes live in meta.scopes. */
export async function issueApiKey(secure: SecureStore, name: string, scopes: string[], userId?: string) {
  const { token, id } = await issueToken(secure, 'apikey', { userId, meta: { name, scopes } })
  return { key: `wk_${token}`, id }
}

export async function checkApiKey(secure: SecureStore, header: string | undefined) {
  if (!header) return null
  const m = /^Bearer\s+wk_([A-Za-z0-9_-]+)$/.exec(header)
  if (!m) return null
  return checkToken(secure, 'apikey', m[1])
}

export function hasScope(tokenRow: any, scope: string): boolean {
  const scopes: string[] = tokenRow?.meta?.scopes || []
  return scopes.some(s => s === scope || s === '*' || (s.endsWith('*') && scope.startsWith(s.slice(0, -1))))
}
