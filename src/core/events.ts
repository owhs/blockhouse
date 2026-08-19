// Async event bus. Plugins and automations hook site lifecycle events:
// content.saved, content.published, form.submitted, media.uploaded, user.created,
// newsletter.subscribed, data.row.created, webhook.received, file.downloaded, ...

import type { EventHandler } from './types.ts'

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  /** Fire handlers for `event` and wildcard '*'. Errors are logged, never thrown. */
  async emit(event: string, payload: Record<string, any> = {}): Promise<void> {
    const sets = [this.handlers.get(event), this.handlers.get('*')]
    for (const set of sets) {
      if (!set) continue
      for (const h of set) {
        try { await h(payload, event) } catch (e) {
          console.error(`[blockhouse] event handler failed for "${event}":`, e)
        }
      }
    }
  }

  /** Fire-and-forget; on Workers pass executionCtx.waitUntil. */
  emitBg(event: string, payload: Record<string, any> = {}, waitUntil?: (p: Promise<any>) => void) {
    const p = this.emit(event, payload)
    if (waitUntil) waitUntil(p)
    else p.catch(() => {})
  }
}
