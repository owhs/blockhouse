// Who can see a document. One implementation, used by the router (direct hits),
// the renderer (listings, related, menus) and the search index, so a member-only
// page can't leak through a side door.

import type { Doc, DocAccess } from './types.ts'

export interface Viewer {
  /** Signed-in studio user — sees everything (previews, staging). */
  admin?: boolean
  /** Signed-in site visitor. */
  member?: { id: string; groups?: string[] } | null
}

export function isGated(doc: Pick<Doc, 'access'>): boolean {
  const m = doc.access?.mode
  return !!m && m !== 'public'
}

export function memberAllowed(member: Viewer['member'], access: DocAccess | undefined): boolean {
  if (!access?.mode || access.mode === 'public') return true
  if (!member) return false
  if (access.mode === 'members') return true
  const groups = access.groups || []
  return !groups.length || (member.groups || []).some(g => groups.includes(g))
}

export function canView(doc: Pick<Doc, 'access'>, viewer: Viewer = {}): boolean {
  if (!isGated(doc)) return true
  if (viewer.admin) return true
  return memberAllowed(viewer.member, doc.access)
}
