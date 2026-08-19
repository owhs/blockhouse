// Role-based permissions with per-user extra grants.
// Permission strings are dot-namespaced; plugin permissions look like "plugin:forms.manage".

import type { Role, User } from './types.ts'

export const ROLE_ORDER: Role[] = ['viewer', 'author', 'editor', 'admin', 'owner']

const GRANTS: Record<Role, string[]> = {
  viewer: ['content.read', 'media.read'],
  author: ['content.read', 'media.read', 'content.write.own', 'content.submit', 'media.write', 'preview'],
  editor: [
    'content.read', 'media.read', 'content.write', 'content.write.own', 'content.submit', 'content.publish',
    'content.delete', 'media.write', 'media.manage', 'menus.write', 'preview', 'seo.tools', 'plugin:*',
  ],
  admin: ['*'],
  owner: ['*'],
}

// admin/owner wildcard excludes nothing today; kept distinct so future
// owner-only actions (billing, transfer) have a home.

export class PermissionError extends Error {
  status = 403
  constructor(perm: string) { super(`Missing permission: ${perm}`) }
}

function matches(grant: string, perm: string): boolean {
  if (grant === '*') return true
  if (grant === perm) return true
  if (grant.endsWith('*') && perm.startsWith(grant.slice(0, -1))) return true
  return false
}

export function can(user: User | null | undefined, perm: string, ctx?: { ownerId?: string }): boolean {
  if (!user || !user.active) return false
  const grants = [...(GRANTS[user.role] || []), ...(user.grants || [])]
  if (grants.some(g => matches(g, perm))) return true
  // "own" escape hatch: content.write on a doc you authored
  if (perm === 'content.write' && ctx?.ownerId && ctx.ownerId === user.id) {
    return grants.some(g => matches(g, 'content.write.own'))
  }
  return false
}

export function require_(user: User | null | undefined, perm: string, ctx?: { ownerId?: string }): void {
  if (!can(user, perm, ctx)) throw new PermissionError(perm)
}

export function roleAtLeast(user: User | null | undefined, role: Role): boolean {
  if (!user) return false
  return ROLE_ORDER.indexOf(user.role) >= ROLE_ORDER.indexOf(role)
}

/** All permissions a plugin may request, for the approval UI. */
export const PLUGIN_PERMISSION_INFO: Record<string, string> = {
  'events.listen': 'Listen to site events',
  'events.emit': 'Emit custom events',
  'content.read': 'Read site content',
  'content.write': 'Create and modify content',
  'media.read': 'Read media files and metadata',
  'media.write': 'Upload and modify media',
  'secure.tables': 'Store private data in the secure database',
  'mail.send': 'Send email through the configured mail driver',
  'routes.public': 'Register public site routes under /x/<plugin>',
  'routes.root': 'Register short root-level routes (e.g. /f/:token)',
  'routes.api': 'Register authenticated admin API routes',
  'blocks.register': 'Provide content blocks to the editor',
  'actions.register': 'Provide automation actions',
  'settings.own': 'Store its own settings',
  'net.fetch': 'Make outbound network requests',
  'files.private': 'Manage the private files area',
}
