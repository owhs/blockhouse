// Server-side icon set (subset of the studio set) for rendered site chrome:
// mega-menu tiles, drill-down chevrons, etc. Same 24×24 stroke style.

const PATHS: Record<string, string> = {
  compare: 'M9 4H4v16h5M15 4h5v16h-5M12 2v20M7 9h2M7 14h2M15 9h2M15 14h2',
  bespoke: 'M12 3l2.1 4.6L19 8.2l-3.5 3.4.9 5L12 14.3l-4.4 2.3.9-5L5 8.2l4.9-.6z',
  classic: 'M5 16l1.5-6.5h11L19 16M5 16h14M5 16v3M19 16v3M8 9.5V7a4 4 0 0 1 8 0v2.5',
  electric: 'M13 3L5 13.5h5.5L11 21l8-10.5h-5.5z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M9.5 6l6 6-6 6',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  location: 'M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11zM12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z',
  bookmark: 'M7 3.5h10V21l-5-3.5L7 21z',
  support: 'M4 14.5v-3a8 8 0 0 1 16 0v3M4 14.5a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zM20 14.5a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2zM17 18.5c0 1.5-2 2-5 2',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21',
  account: 'M16.5 20v-1.4a3.6 3.6 0 0 0-3.6-3.6h-1.8a3.6 3.6 0 0 0-3.6 3.6V20M12 11.6a3.55 3.55 0 1 0 0-7.1 3.55 3.55 0 0 0 0 7.1z',
  cart: 'M4 5h2l2.2 10.5h9.6L20 8H7.2M9.7 19.5a.9.9 0 1 1 0 .1M16.7 19.5a.9.9 0 1 1 0 .1',
  tag: 'M4 4h7l9 9-7 7-9-9zM8.5 8.3a.4.4 0 1 1 0 .1',
  mail: 'M3.5 6h17v12h-17zM4 7l8 6.5L20 7',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c-5.5 5.5-5.5 12.5 0 18M12 3c5.5 5.5 5.5 12.5 0 18',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4',
  star: 'M12 4l2.35 4.9 5.4.7-4 3.75 1 5.35L12 16.1l-4.75 2.6 1-5.35-4-3.75 5.4-.7z',
  bolt: 'M13 2.5L4.5 13.5H11l-1 8L18.5 10H12z',
  building: 'M5 20V4h9v16M14 8h5v12M4 20h17M8 8h2M8 12h2M8 16h2',
  phone: 'M8 3.5h8v17H8zM11 18.2h2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7',
  key: 'M14 10a4 4 0 1 0-4 4c.5 0 1-.1 1.4-.3L13 15.4V18h2.6v2.6H18l1.5-1.5L14 13.6c.2-.4.3-.9.3-1.4M9.8 9.8a.5.5 0 1 1 0 .1',
  // Everyday marketing/product vocabulary, so authors rarely need a raw glyph.
  sparkle: 'M11 3l1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7zM18 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  layers: 'M12 3l8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5',
  pen: 'M4 20l1-4L16.5 4.5a1.9 1.9 0 0 1 3 3L8 19zM13 7l3.5 3.5',
  code: 'M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4M13.5 5l-3 14',
  shield: 'M12 3l7.5 3v5.5c0 4.4-3 8.2-7.5 9.5-4.5-1.3-7.5-5.1-7.5-9.5V6z',
  lock: 'M6.5 10.5h11V20h-11zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5',
  chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
  users: 'M15.5 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.9a3.4 3.4 0 0 0-3.4 3.4V20M9.5 11.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM20.5 20v-1.6a3.4 3.4 0 0 0-2.5-3.3M14.5 5a3.4 3.4 0 0 1 0 6.5',
  heart: 'M12 20S3.5 14.5 3.5 9A4.5 4.5 0 0 1 12 6.8 4.5 4.5 0 0 1 20.5 9c0 5.5-8.5 11-8.5 11z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5.3l3.4 2',
  check: 'M4.5 12.5l5 5 10-11',
  play: 'M8 5.5l11 6.5-11 6.5z',
  download: 'M12 3v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15',
  rocket: 'M13.5 4c3.5 1 6.5 4 7.5 7.5-2.6 3.4-6.3 5.6-10.5 6.2L6 13.7C6.6 9.5 8.8 5.8 12.2 3.2zM14 9.8a1.4 1.4 0 1 0 2 2 1.4 1.4 0 0 0-2-2M6.5 17.5L4 20M9 18.5L7 21M5.5 15L3 17',
  leaf: 'M5 19c0-8 5-13 15-13 0 9-5 13-11 13-2 0-4-1-4-3zM8 16c2.5-3.5 5-5.5 8.5-7',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.39 2.54a7 7 0 0 0-2.42 1.4l-2.35-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.39 2.54h3.4l.39-2.54a7 7 0 0 0 2.42-1.4l2.35.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z',
}

export function siteIcon(name: string | undefined, size = 18, cls = ''): string {
  const d = name ? PATHS[name] : undefined
  if (!d) return ''
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
}

export const SITE_ICONS = Object.keys(PATHS)
