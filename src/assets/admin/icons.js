// Blockhouse icon set — hand-drawn inline SVG, 24×24 grid, stroke 1.7, currentColor.
// No font/emoji dependency, so icons render identically on every OS.

const P = {
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  page: 'M7 3h7l4 4v14H7zM14 3v4h4',
  pen: 'M4 20l1-4L16.5 4.5a1.9 1.9 0 0 1 3 3L8 19zM13 7l3.5 3.5',
  image: 'M4 5h16v14H4zM4 15.5l4.5-4.5 4 4 3-3 4.5 4.5M9 9.2a1 1 0 1 1 0 .1',
  menu: 'M4 7h16M4 12h16M4 17h10',
  users: 'M15.5 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.9a3.4 3.4 0 0 0-3.4 3.4V20M9.5 11.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM20.5 20v-1.6a3.4 3.4 0 0 0-2.5-3.3M14.5 5a3.4 3.4 0 0 1 0 6.5',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-5 5.9V21h-2v-4.1A6 6 0 0 1 6 11z',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.39 2.54a7 7 0 0 0-2.42 1.4l-2.35-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.39 2.54h3.4l.39-2.54a7 7 0 0 0 2.42-1.4l2.35.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 6a6 6 0 0 1 0 12',
  power: 'M12 3v8M6.6 6.6a8 8 0 1 0 10.8 0',
  back: 'M15 5l-7 7 7 7',
  fwd: 'M9 5l7 7-7 7',
  chevD: 'M6 9.5l6 6 6-6',
  chevR: 'M9.5 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  grip: 'M9 6.2a1 1 0 1 1 0 .1M9 12a1 1 0 1 1 0 .1M9 17.8a1 1 0 1 1 0 .1M15 6.2a1 1 0 1 1 0 .1M15 12a1 1 0 1 1 0 .1M15 17.8a1 1 0 1 1 0 .1',
  external: 'M9 5H5v14h14v-4M14 4h6v6M20 4L11 13',
  swap: 'M7 8h13M17 5l3 3-3 3M17 16H4M7 13l-3 3 3 3',
  more: 'M5.2 12a1.1 1.1 0 1 1 0 .1M12 12a1.1 1.1 0 1 1 0 .1M18.8 12a1.1 1.1 0 1 1 0 .1',
  check: 'M4.5 12.5l5 5 10-11',
  warn: 'M12 4L2.5 20h19zM12 10v4.5M12 17.4v.2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 10.5V17M12 7v.2',
  mail: 'M3.5 6h17v12h-17zM4 7l8 6.5L20 7',
  bolt: 'M13 2.5L4.5 13.5H11l-1 8L18.5 10H12z',
  db: 'M12 8.5c4.4 0 8-1.2 8-2.75S16.4 3 12 3 4 4.2 4 5.75 7.6 8.5 12 8.5zM4 5.75V18.25C4 19.8 7.6 21 12 21s8-1.2 8-2.75V5.75M4 12c0 1.55 3.6 2.75 8 2.75S20 13.55 20 12',
  download: 'M12 3v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  wand: 'M5 19L15.5 8.5M13 4l0.9 2.1L16 7l-2.1 0.9L13 10l-0.9-2.1L10 7l2.1-0.9zM18.5 12.5l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z',
  upload: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 19.5h15',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z',
  form: 'M4 5h16v5H4zM4 14h16v5H4zM7 7.5h6M7 16.5h4',
  columns: 'M4 4h7v16H4zM13 4h7v16h-7z',
  layout: 'M4 4h16v4.5H4zM4 12h7v8H4zM14.5 12H20v8h-5.5',
  video: 'M4 6h11v12H4zM15 10.5l5-3v9l-5-3',
  quote: 'M5 6.5h5.5v5.5H7A5 5 0 0 1 10 17M13.5 6.5H19v5.5h-3.5a5 5 0 0 0 3 5',
  code: 'M8.5 7l-5 5 5 5M15.5 7l5 5-5 5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3A2.6 2.6 0 0 1 14.6 10c0 1.7-2.6 2-2.6 3.6M12 17v.2',
  tabs: 'M4 8h16v11H4zM4 8V5h6.5v3M13 8V5h7v3',
  tag: 'M4 4h7l9 9-7 7-9-9zM8.5 8.3a.4.4 0 1 1 0 .1',
  play: 'M5 4.5l14 7.5-14 7.5z',
  mountain: 'M3 19h18L14 6l-4 7-2.5-3.5zM16 9.5a1.5 1.5 0 1 1 0 .1',
  minus: 'M5 12h14',
  spacer: 'M5 6h14M5 18h14M12 9v6M9.5 11.5L12 9l2.5 2.5M9.5 12.5L12 15l2.5-2.5',
  vector: 'M8 4h8M4 8v8M20 8v8M8 20h8M6 6a2 2 0 1 0 .1 0M18 6a2 2 0 1 0 .1 0M6 18a2 2 0 1 0 .1 0M18 18a2 2 0 1 0 .1 0M7.5 7.5C10 10 14 14 16.5 16.5',
  heading: 'M5 5v14M15 5v14M5 12h10M19 9v10M19 9c0-1 .7-2 2-2',
  text: 'M5 6h14M12 6v13M8.5 19h7',
  kanban: 'M4 4h4.5v16H4zM9.75 4h4.5v10h-4.5zM15.5 4H20v13h-4.5z',
  chart: 'M4 20h16M7 20v-6M12 20V9M17 20V4.5',
  gantt: 'M4 6h9M8 11h11M6 16h8M4 3v18',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7',
  filter: 'M4 5h16l-6 7v6.5l-4-1.8V12z',
  link: 'M9.5 14.5l5-5M8 16l-1.6 1.6a3.4 3.4 0 0 1-4.8-4.8L5.2 9.2M16 8l1.6-1.6a3.4 3.4 0 0 1 4.8 4.8L18.8 14.8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c-5.5 5.5-5.5 12.5 0 18M12 3c5.5 5.5 5.5 12.5 0 18',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.5.6.2 2.7-2.5 2.7zM8 10a.6.6 0 1 1 0 .1M12 7.5a.6.6 0 1 1 0 .1M16 10a.6.6 0 1 1 0 .1',
  type: 'M5 7V4.5h14V7M12 4.5V19.5M9 19.5h6',
  rocket: 'M12 15c5-4 6.5-8.5 6-12-3.5-.5-8 1-12 6l-2.5 5L8 18.5zM6 12.5l5.5 5.5M5 19c-1 1-1.5 2.5-1.5 2.5S5 21 6 20M14.5 8a1.5 1.5 0 1 1 0 .1',
  key: 'M14 10a4 4 0 1 0-4 4c.5 0 1-.1 1.4-.3L13 15.4V18h2.6v2.6H18l1.5-1.5L14 13.6c.2-.4.3-.9.3-1.4M9.8 9.8a.5.5 0 1 1 0 .1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5.5l3.5 2',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 3.5v3.9h-3.9',
  undo: 'M8 6L4 10l4 4M4 10h9a6 6 0 0 1 0 12h-2',
  redo: 'M16 6l4 4-4 4M20 10h-9a6 6 0 0 0 0 12h2',
  desktop: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
  tablet: 'M6 3.5h12v17H6zM11 18h2',
  phone: 'M8 3.5h8v17H8zM11 18.2h2',
  save: 'M5 5h11l3 3v11H5zM8 5v4h6V5M8 19v-5.5h8V19',
  eye: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  send: 'M20.5 3.5L10 14M20.5 3.5L14 20.5l-4-6.5-6.5-4z',
  star: 'M12 4l2.35 4.9 5.4.7-4 3.75 1 5.35L12 16.1l-4.75 2.6 1-5.35-4-3.75 5.4-.7z',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21zM4 18.5V21M20 18.5H6.5',
  folder: 'M3.5 6h6l2 2.5h9V19h-17z',
  list: 'M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5h.2M4.5 12h.2M4.5 17.5h.2',
  hash: 'M9 4L7 20M17 4l-2 20M4.5 9h16M3.5 15h16',
  cart: 'M4 5h2l2.2 10.5h9.6L20 8H7.2M9.7 19.5a.9.9 0 1 1 0 .1M16.7 19.5a.9.9 0 1 1 0 .1',
  building: 'M5 20V4h9v16M14 8h5v12M4 20h17M8 8h2M8 12h2M8 16h2',
  server: 'M3.5 4.5h17v6h-17zM3.5 13.5h17v6h-17zM7 7.5v.2M7 16.5v.2',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  cloud: 'M7 18.5a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 9a3.75 3.75 0 0 1-.3 9.5z',
  gauge: 'M12 20a8 8 0 1 1 8-8M12 12l4.5-4M4 12h1.5M12 4v1.5M18.5 6.5l-1 1',
  shield: 'M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z',
  lock: 'M6.5 10.5h11V20h-11zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5',
  'panel-close': 'M4 4.5h16v15H4zM9.5 4.5v15M17 10l-2.5 2 2.5 2',
  'panel-open': 'M4 4.5h16v15H4zM9.5 4.5v15M13.5 10l2.5 2-2.5 2',
  // names the studio was already asking for and rendering as text stubs
  block: 'M4 4.5h16v15H4zM4 10h16M10 10v9.5',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h7M9.5 15.5h5',
  compare: 'M12 4v16M7.5 8.5L4 13h7zM16.5 8.5L13 13h7zM4 13a3.5 3.5 0 0 0 7 0M13 13a3.5 3.5 0 0 0 7 0',
  bespoke: 'M6 20l1.5-5 8-8a2 2 0 0 1 3 3l-8 8zM14 6.5l3 3M4.5 4.5l1.6 1.6M9 3.5l-.8 2M3.5 9l2-.8',
  classic: 'M4 9.5L12 4l8 5.5M5.5 9.5V19M18.5 9.5V19M9.5 9.5V19M14.5 9.5V19M3.5 19h17',
  electric: 'M13 3L5.5 13.5H11L9.5 21 18 10.5h-5.5z',
  pin: 'M9.5 3h5l-.7 5.5 3.2 3v1.5H7v-1.5l3.2-3zM12 13v8',
  unpin: 'M9.5 3h5l-.7 5.5 3.2 3v1.5H7v-1.5l3.2-3zM12 13v8M4 4l16 16',
  eyeOff: 'M4 4l16 16M10 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.4M6.4 7.6A11.4 11.4 0 0 0 3 12c0 2.5 4 7 9 7a9.4 9.4 0 0 0 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  sidebar: 'M4 4.5h16v15H4zM9.5 4.5v15',
}

// Icons the studio asks for by name. In dev, a missing one is a bug worth
// hearing about rather than a two-letter text stub nobody notices.
const warned = new Set()

export function icon(name, size = 16, cls = '') {
  const d = P[name]
  if (!d) {
    if (!warned.has(name)) { warned.add(name); console.warn(`[studio] no icon named "${name}"`) }
    return `<span class="ico-txt" aria-hidden="true">${String(name).slice(0, 2)}</span>`
  }
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
}

/** DOM element version for h() composition */
export function iconEl(name, size = 16, cls = '') {
  const span = document.createElement('span')
  span.className = 'ico-wrap'
  span.innerHTML = icon(name, size, cls)
  return span
}

export const ICONS = Object.keys(P)
