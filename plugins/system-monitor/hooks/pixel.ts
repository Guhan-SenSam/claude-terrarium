// The band's look on surfaces that draw Svg: a pixel-art icon and a game-style bar of chunky
// segments, in the palette of the thinking-weather scene. Still pictures, redrawn only when a
// reading moves a segment or a glow step; nothing animates, so nothing redraws the band between
// samples.

/** Screen pixels per art cell, and the band's height in cells (24 px rows). */
export const CELL = 2
export const ROWS = 12
const ICON = 10
const GAP = 3
const SEG = 3 // a segment's width; one cell of gap follows it

export type Kind = 'cpu' | 'ram' | 'gpu'

type Tone = { fill: string; light: string; dark: string; glow: string }
const TONES: Record<'calm' | 'busy' | 'hot', Tone> = {
  calm: { fill: '#5e9653', light: '#8cc36b', dark: '#3d6e36', glow: '#8cc36b' }, // meadow
  busy: { fill: '#c9a94a', light: '#ead27a', dark: '#9a7d2e', glow: '#ead27a' }, // wheat
  hot: { fill: '#e0703a', light: '#ffb070', dark: '#a8482a', glow: '#ffb347' }, // lantern
}

export function toneOf(percent: number) {
  return percent >= 90 ? 'hot' : percent >= 70 ? 'busy' : 'calm'
}

// Icons, 10x10 cells. Each letter is a colour; '.' is empty.
const COLOURS: Record<string, string> = {
  p: '#c9a94a', // gold pins and contacts
  b: '#3e4a63', // slate body
  s: '#2e374a', // body shade
  h: '#8acdf3', // sky highlight
  g: '#2f6135', // circuit-board green
  G: '#447a3e', // board highlight
  k: '#1b1b22', // chip black
  f: '#9fb3c8', // fan
  w: '#d8cfbd', // pale metal
}
const ICONS: Record<Kind, string[]> = {
  cpu: [
    '..p.p.p...',
    '.bbbbbbbs.',
    'pbhbbbbbsp',
    '.bbsssbbs.',
    'pbbshsbbsp',
    '.bbsssbbs.',
    'pbbbbbbbsp',
    '.sssssssss',
    '..p.p.p...',
    '..........',
  ],
  ram: [
    '..........',
    '..........',
    'GGGGGGGGGG',
    'gkkgkkgkkg',
    'gkkgkkgkkg',
    'gggggggggg',
    'gggg.ggggg',
    'pp.pp.pp.p',
    '..........',
    '..........',
  ],
  gpu: [
    '..........',
    'w.........',
    'wbbbbbbbbb',
    'wbbffffbbs',
    'wbffssffbs',
    'wbffssffbs',
    'wbbffffbbs',
    'wssssssss.',
    '..pppppp..',
    '..........',
  ],
}

/** Horizontal runs of one row of a map, as stroke path data per colour. */
function iconPaths(map: string[], dx: number, dy: number): string {
  const byColour = new Map<string, string>()
  map.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const c = row[x]!
      if (c === '.') {
        x++
        continue
      }
      let n = 1
      while (row[x + n] === c) n++
      byColour.set(c, (byColour.get(c) ?? '') + `M${dx + x} ${dy + y + 0.5}h${n}`)
      x += n
    }
  })

  return [...byColour].map(([c, d]) => `<path stroke="${COLOURS[c]}" d="${d}"/>`).join('')
}

/** Cells wide for a meter with `segments` segments (0: the icon alone). */
export function cellsWide(segments: number) {
  return segments > 0 ? ICON + GAP + segments * (SEG + 1) + 3 : ICON
}

/** How many segments fit in `px` screen pixels: 4 to 12, or 0 when not even 4 do. */
export function segmentsFor(px: number) {
  const n = Math.floor((px / CELL - ICON - GAP - 3) / (SEG + 1))

  return n >= 4 ? Math.min(12, n) : 0
}

/**
 * One meter as an Svg document: its icon, then a framed bar lit to `percent`. A lit bar has a
 * stepped pixel glow round its lit part, brighter in 10% steps as the reading rises. A sleeping
 * GPU is its icon dimmed, with a little "z".
 */
export function meterSvg(kind: Kind, percent: number | undefined, segments: number, isAsleep = false) {
  const w = cellsWide(segments)
  const parts: string[] = []
  const iconY = 1
  parts.push(isAsleep ? `<g opacity=".45">${iconPaths(ICONS[kind], 0, iconY)}</g>` : iconPaths(ICONS[kind], 0, iconY))
  if (isAsleep) parts.push(`<path stroke="#cfd8ff" d="M7 0.5h3M8 1.5h1M7 2.5h3"/>`)

  if (segments > 0) {
    const x0 = ICON + GAP
    const inner = segments * (SEG + 1) + 1
    const lit = percent === undefined ? 0 : Math.round((Math.min(100, Math.max(0, percent)) / 100) * segments)
    const tone = TONES[toneOf(percent ?? 0)]
    // the glow: two stepped rings round the lit segments, faint to brighter
    if (lit > 0 && percent !== undefined) {
      const strength = Math.round((0.12 + 0.5 * (Math.min(100, percent) / 100)) * 10) / 10
      const gx = x0 + 1
      const gw = lit * (SEG + 1) + 1
      // nearer the bar brighter, the outer cells fainter, so it fades rather than ends in a line
      parts.push(
        `<path stroke="${tone.glow}" stroke-opacity="${(strength * 0.5).toFixed(2)}" d="M${gx - 1} 1.5h${gw + 2}M${gx - 1} 10.5h${gw + 2}"/>`,
        `<path stroke="${tone.glow}" stroke-opacity="${(strength * 0.2).toFixed(2)}" d="M${gx + 1} 0.5h${Math.max(1, gw - 2)}M${gx + 1} 11.5h${Math.max(1, gw - 2)}"/>`,
      )
    }
    // frame: a dark border with a darker well
    parts.push(
      `<path stroke="#0d1222" d="M${x0 + 1} 2.5h${inner + 1}M${x0} 3.5h1M${x0} 4.5h1M${x0} 5.5h1M${x0} 6.5h1M${x0} 7.5h1M${x0} 8.5h1M${x0 + inner + 2} 3.5h1M${x0 + inner + 2} 4.5h1M${x0 + inner + 2} 5.5h1M${x0 + inner + 2} 6.5h1M${x0 + inner + 2} 7.5h1M${x0 + inner + 2} 8.5h1M${x0 + 1} 9.5h${inner + 1}"/>`,
      `<path stroke="#151d2e" d="${[3, 4, 5, 6, 7, 8].map(y => `M${x0 + 1} ${y}.5h${inner + 1}`).join('')}"/>`,
    )
    // segments: lit ones with a highlight row on top and a shadow row beneath, the rest empty
    let light = ''
    let fill = ''
    let dark = ''
    let empty = ''
    let emptyTop = ''
    for (let i = 0; i < segments; i++) {
      const sx = x0 + 2 + i * (SEG + 1)
      if (i < lit) {
        light += `M${sx} 4.5h${SEG}`
        fill += `M${sx} 5.5h${SEG}M${sx} 6.5h${SEG}`
        dark += `M${sx} 7.5h${SEG}`
      } else {
        emptyTop += `M${sx} 4.5h${SEG}`
        empty += `M${sx} 5.5h${SEG}M${sx} 6.5h${SEG}M${sx} 7.5h${SEG}`
      }
    }
    if (light) parts.push(`<path stroke="${tone.light}" d="${light}"/><path stroke="${tone.fill}" d="${fill}"/><path stroke="${tone.dark}" d="${dark}"/>`)
    if (empty) parts.push(`<path stroke="#26324a" d="${emptyTop}"/><path stroke="#1f2a3e" d="${empty}"/>`)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ROWS}" width="${w * CELL}" height="${ROWS * CELL}" fill="none" shape-rendering="crispEdges">${parts.join('')}</svg>`
}
