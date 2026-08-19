/* Dev live-reload client (SSE).
 *
 * A dropped connection is not a reason to reload: EventSource reconnects by
 * itself, and reloading on every hiccup pulls the page out from under whoever
 * is reading it. The page reloads when the server says so, or when it comes
 * back with a different boot id — which means it really did restart. */
const es = new EventSource('/api/dev/events')
let boot = null

//es.addEventListener('reload', () => location.reload())
es.addEventListener('hello', e => {
  if (boot === null) boot = e.data
  else if (e.data !== boot) location.reload()
})
