// Real OKLCH -> OKLab -> linear sRGB -> WCAG contrast, for the studio's tokens.
// Ottosson's matrices; no lightness approximation.

const oklchToLinear = (L, C, H) => {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h), b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const ratio = (f, b) => {
  const [L1, L2] = [lum(f), lum(b)].sort((x, y) => y - x)
  return (L1 + 0.05) / (L2 + 0.05)
}
// alpha-composite a color-mix(in oklch, X pct%, transparent) fill over a backdrop
const over = (fill, pct, back) => fill.map((c, i) => c * pct + back[i] * (1 - pct))

const H = 162 // evergreen
const T = {
  light: {
    bg: oklchToLinear(0.955, 0.004, H),
    panel: oklchToLinear(0.985, 0.003, H),
    raise: oklchToLinear(1.0, 0, H),
    hover: oklchToLinear(0.925, 0.006, H),
    fnt: oklchToLinear(0.50, 0.012, H),
    mut: oklchToLinear(0.46, 0.01, H),
    okInk: oklchToLinear(0.42, 0.12, 155),
    warnInk: oklchToLinear(0.44, 0.11, 75),
    errInk: oklchToLinear(0.45, 0.16, 25),
    dangerHover: oklchToLinear(0.38, 0.17, 25),
  },
  dark: {
    bg: oklchToLinear(0.145, 0.008, H),
    panel: oklchToLinear(0.19, 0.009, H),
    raise: oklchToLinear(0.235, 0.01, H),
    hover: oklchToLinear(0.28, 0.012, H),
    fnt: oklchToLinear(0.66, 0.009, H),
    mut: oklchToLinear(0.70, 0.008, H),
    okInk: oklchToLinear(0.80, 0.13, 155),
    warnInk: oklchToLinear(0.84, 0.13, 75),
    errInk: oklchToLinear(0.78, 0.15, 25),
    dangerHover: oklchToLinear(0.86, 0.13, 25),
  },
}
const OK = oklchToLinear(0.58, 0.13, 155)
const WARN = oklchToLinear(0.66, 0.13, 75)
const ERR = oklchToLinear(0.56, 0.17, 25)

const rows = []
for (const theme of ['light', 'dark']) {
  const t = T[theme]
  for (const surf of ['bg', 'panel', 'raise', 'hover']) {
    rows.push([`--fnt on --bg-${surf}`, theme, ratio(t.fnt, t[surf]), 4.5])
    rows.push([`--mut on --bg-${surf}`, theme, ratio(t.mut, t[surf]), 4.5])
  }
  rows.push(['.chip.published', theme, ratio(t.okInk, over(OK, 0.16, t.panel)), 4.5])
  rows.push(['.chip.review', theme, ratio(t.warnInk, over(WARN, 0.16, t.panel)), 4.5])
  rows.push(['.chip.stale', theme, ratio(t.warnInk, over(WARN, 0.14, t.panel)), 4.5])
  rows.push(['.chip.err', theme, ratio(t.errInk, over(ERR, 0.14, t.panel)), 4.5])
  rows.push(['.btn.danger resting', theme, ratio(t.errInk, over(ERR, 0.12, t.raise)), 4.5])
  rows.push(['.btn.danger hover', theme, ratio(t.dangerHover, over(ERR, 0.20, t.raise)), 4.5])
  rows.push(['.toast.ok (fixed)', theme, ratio(t.okInk, t.raise), 4.5])
  rows.push(['.serp-url (fixed)', theme, ratio(t.okInk, t.panel), 4.5])
  rows.push(['.save-state.saved', theme, ratio(t.okInk, t.panel), 4.5])
  rows.push(['.save-state.error', theme, ratio(t.errInk, t.panel), 4.5])
  rows.push(['.field-error', theme, ratio(t.errInk, t.raise), 4.5])
  rows.push(['.ctx-menu .danger', theme, ratio(t.errInk, t.raise), 4.5])
}

let fails = 0
for (const [name, theme, r, need] of rows) {
  const ok = r >= need
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  ${theme.padEnd(5)}  ${name}`)
}
console.log(`\n${rows.length - fails}/${rows.length} pass; ${fails} fail`)
