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

/**
 * All permissions a plugin may request, for the approval UI.
 *
 * Each line is what the owner of the site would say the app is allowed to do.
 * The code itself ("routes.public") is a developer's word and stays out of
 * sight unless somebody opens "Limit what it may do (advanced)".
 */
export const PLUGIN_PERMISSION_INFO: Record<string, string> = {
  'events.listen': 'Run things when something happens on the site',
  'events.emit': 'Tell other apps when something happens',
  'content.read': 'Read your pages and posts',
  'content.write': 'Write and change your pages and posts',
  'media.read': 'Look at your pictures and files',
  'media.write': 'Add and change pictures and files',
  'secure.tables': 'Store its own records, kept private',
  'mail.send': 'Send emails on your behalf',
  'routes.public': 'Add pages to your website',
  'routes.root': 'Add short web addresses, like a download link',
  'routes.api': 'Add its own screens to this studio',
  'blocks.register': 'Offer extra blocks you can put on a page',
  'actions.register': 'Offer extra steps for automations',
  'settings.own': 'Keep its own settings',
  'net.fetch': 'Talk to other services over the internet',
  'files.private': 'Look after files that are not public',
}
