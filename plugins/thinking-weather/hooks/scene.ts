import {
  BANK_L, BANK_R, BANK_T, CHIMNEYS, DOORS, EAVES, FAIR, GROUND, GROUND_AUTUMN, GROUND_SNOW, GROUND_SPRING, GROUND_WINTER, LAMPS,
  MILL, OVERCAST, WINDOWS,
} from './art'
import type { Cond, Holiday, Outside, Season, SessionEvents, Sky, Strike } from '../types'

// A 320x180 grid of pixel cells, all vector (the desktop app strips embedded images).
// Every animation is timed from `now` at draw time, so a scene the app restarts (a resize, a
// state change) carries on where its motion was instead of starting over.

const STRIKE_MS = 900
const MAX_BOLTS = 6
const LIMIT = 130000
// Where the storm clouds sit (gen_vec.py: corner masses and TOP_CLUMPS 90/170/250):
// bolts start from these cloud bases and rain falls only beneath them.
const ZONES = [
  { x0: 4, x1: 50, y: 56 },
  { x0: 70, x1: 110, y: 28 },
  { x0: 150, x1: 190, y: 28 },
  { x0: 230, x1: 270, y: 28 },
  { x0: 270, x1: 316, y: 56 },
]
const GROUND_Y = 152

// Rain: a fixed scatter of 2-cell drops under the clouds, two rows apart per frame. It moves
// only a few times a second, since every step redraws the whole scene.
const RAIN = (() => {
  const r = rng(9)
  let d = ''
  for (const z of ZONES) {
    for (let i = 0; i < 16; i++) {
      const x = z.x0 + Math.floor(r() * (z.x1 - z.x0))
      const y = z.y - 8 + Math.floor(r() * (GROUND_Y - z.y + 8))
      d += `M${x + 0.5} ${y}v2`
    }
  }
  return d
})()

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

// One bolt as pixel strokes: a 1-cell core, a 3-cell glow, a branch or two, sparks at the foot.
function bolt(st: Strike, ageMs: number): string {
  const r = rng(st.seed)
  const zone = ZONES[Math.floor(r() * ZONES.length)] ?? ZONES[0]!
  const x0 = zone.x0 + Math.floor(r() * (zone.x1 - zone.x0))
  const y0 = zone.y + Math.floor(r() * 4)
  const core: string[] = []
  const glow: string[] = []
  const walk = (x: number, y: number, until: number, drift: number) => {
    while (y < until) {
      const step = Math.min(1 + Math.floor(r() * 3), until - y)
      core.push(`M${x + 0.5} ${y}v${step}`)
      glow.push(`M${x - 0.5} ${y}v${step}m2 ${-step}v${step}`)
      y += step
      x += Math.round((r() - 0.5) * 2.4 + drift)
    }
    return x
  }
  const drift = (r() - 0.5) * 0.7
  const xEnd = walk(x0, y0, GROUND_Y, drift)
  const branches = 1 + Math.floor(r() * 2)
  for (let b = 0; b < branches; b++) {
    const by = y0 + 6 + Math.floor(r() * 40)
    walk(x0 + Math.round((by - y0) * drift), by, by + 8 + Math.floor(r() * 14), (r() < 0.5 ? -1 : 1) * 1.1)
  }
  const sparks = `M${xEnd - 2} ${GROUND_Y - 1}h1m2 -1h1m1 1h1`
  const style = `style="animation-delay:${-ageMs}ms"`
  // a failed tool call strikes red
  const [halo, centre, sky] = st.err ? ['#ff5a4a', '#ffd6cc', '#ffb4a6'] : ['#9fc8ff', '#fff', '#e8f0ff']
  return `<g class="bolt" ${style}><path stroke="${halo}" stroke-opacity=".55" d="${glow.join('')}"/>` +
    `<path stroke="${centre}" d="${core.join('')}${sparks}"/></g>` +
    `<rect class="flash" ${style} y="-1" width="320" height="182" fill="${sky}"/>`
}

// ---- time of day: the local hour picks a blend of these looks ----
type Look = { h: number; sky: string[]; bright: number; sat: number; warm: number; stars: number; lights: number }
const NIGHT = ['#04091f', '#0a1538', '#142453', '#203668', '#2e4a78']
const DAWN = ['#26387a', '#5f58a0', '#c77a95', '#f2a873', '#ffd9a0']
const DAY = ['#0e3c98', '#1c66c8', '#4a9fe4', '#8acdf3', '#d4eefa']
const DUSK = ['#1b2766', '#553d8c', '#c25a6c', '#ef8a4c', '#ffc274']
const LOOKS: Look[] = [
  { h: 0, sky: NIGHT, bright: 0.42, sat: 0.65, warm: 0, stars: 1, lights: 1 },
  { h: 5, sky: NIGHT, bright: 0.42, sat: 0.65, warm: 0, stars: 1, lights: 1 },
  { h: 6.25, sky: DAWN, bright: 0.78, sat: 0.9, warm: 0.25, stars: 0.2, lights: 0.5 },
  { h: 7.5, sky: DAY, bright: 1, sat: 1, warm: 0, stars: 0, lights: 0 },
  { h: 17, sky: DAY, bright: 1, sat: 1, warm: 0, stars: 0, lights: 0 },
  { h: 18.5, sky: DUSK, bright: 0.74, sat: 0.9, warm: 0.3, stars: 0.3, lights: 0.6 },
  { h: 20, sky: NIGHT, bright: 0.42, sat: 0.65, warm: 0, stars: 1, lights: 1 },
  { h: 24, sky: NIGHT, bright: 0.42, sat: 0.65, warm: 0, stars: 1, lights: 1 },
]
const STOPS = [0, 0.3, 0.6, 0.82, 1]

const mixHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

function lookAt(hour: number): Look {
  const i = Math.max(0, LOOKS.findIndex(l => l.h > hour) - 1)
  const a = LOOKS[i]!
  const b = LOOKS[i + 1] ?? a
  const t = b.h === a.h ? 0 : (hour - a.h) / (b.h - a.h)
  const n = (x: number, y: number) => x + (y - x) * t
  return {
    h: hour,
    sky: a.sky.map((c, k) => mixHex(c, b.sky[k]!, t)),
    bright: n(a.bright, b.bright), sat: n(a.sat, b.sat), warm: n(a.warm, b.warm),
    stars: n(a.stars, b.stars), lights: n(a.lights, b.lights),
  }
}

// A filled pixel disc as one path of rows.
function disc(cx: number, cy: number, r: number): string {
  let d = ''
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y) + 0.3)
    if (w > 0) d += `M${cx - w} ${cy + y}h${2 * w}`
  }
  return d
}

const STARS = (() => {
  const r = rng(77)
  let d = ''
  let bright = ''
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(r() * 320)
    const y = Math.floor(r() * 118)
    if (r() < 0.15) bright += `M${x} ${y}h1M${x - 1} ${y + 1}h3M${x} ${y + 2}h1`
    else d += `M${x} ${y}h1`
  }
  return `<path stroke="#cfd8ff" d="${d}"/><path stroke="#ffffff" stroke-opacity=".9" d="${bright}"/>`
})()

// The moon in its real phase: the lit part bright, the rest a faint earthshine. Waxing is lit on
// the right; a new moon is only the faint disc.
function moonDisc(cx: number, cy: number, phase: number): string {
  const r = 5
  const k = Math.cos(2 * Math.PI * phase)
  let lit = ''
  let dark = ''
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y) + 0.3)
    for (let x = -w; x < w; x++) {
      const t = (x + 0.5) / Math.max(1, w)
      const on = phase < 0.5 ? t > k : t < -k
      if (on) lit += `M${cx + x} ${cy + y}h1`
      else dark += `M${cx + x} ${cy + y}h1`
    }
  }
  const glow = 0.04 + 0.1 * (1 - Math.abs(phase - 0.5) * 2)
  return `<path stroke="#e9eef9" stroke-opacity="${glow.toFixed(2)}" d="${disc(cx, cy, 9)}"/>` +
    `<path stroke="#2c3652" stroke-opacity=".7" d="${dark}"/><path stroke="#dfe6f5" d="${lit}"/>`
}

function sky(look: Look, out: Outside): string {
  const grey = GREY.has(out.cond)
  const greyTo = mixHex('#a3acb8', '#1a1f2a', 1 - look.bright)
  const haze = grey ? 0.6 : out.cond === 'fog' ? 0.4 : 0
  const stops = look.sky.map((c, i) => `<stop offset="${STOPS[i]}" stop-color="${mixHex(c, greyTo, haze)}"/>`).join('')
  const h = look.h
  let bodies = ''
  if (!grey && h > 5.4 && h < 19.6) {     // the sun arcs from the left at dawn to the right at dusk
    const p = (h - 5.6) / (19.4 - 5.6)
    const x = Math.round(20 + 280 * p)
    const y = Math.round(140 - 112 * Math.sin(Math.PI * p))
    const low = 1 - Math.sin(Math.PI * p)
    const core = mixHex('#fff6c8', '#ffb35a', low)
    bodies += `<path stroke="${mixHex('#fff1a8', '#ff9a4a', low)}" stroke-opacity=".22" d="${disc(x, y, 11)}"/>` +
      `<path stroke="${mixHex('#ffe27a', '#ff8a3a', low)}" d="${disc(x, y, 7)}"/><path stroke="${core}" d="${disc(x - 1, y - 1, 5)}"/>`
  }
  if (!grey && (h > 18.8 || h < 6.6)) {   // the moon crosses through the night
    const t = h > 18.8 ? h - 18.8 : h + 5.2
    const p = t / 11.8
    const x = Math.round(30 + 260 * p)
    const y = Math.round(130 - 100 * Math.sin(Math.PI * p))
    bodies += moonDisc(x, y, out.moon ?? 0.5)
  }
  const stars = !grey && look.stars > 0.02 ? `<g opacity="${look.stars.toFixed(2)}">${STARS}</g>` : ''
  const lit = `style="filter:brightness(${Math.max(0.35, look.bright).toFixed(2)})"`
  const clouds = grey ? `<g ${lit}>${OVERCAST}</g>` : out.cond === 'partly' ? `<g ${lit}>${FAIR}</g>` : ''
  return `<linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>` +
    `<rect y="-1" width="320" height="162" fill="url(#skyg)"/>${stars}${bodies}${clouds}`
}

// ---- the real weather outside, when Claude is not bringing its own storm ----
const GREY = new Set<Cond>(['overcast', 'rain', 'snow', 'thunder'])
const GROUNDS: Record<Season, string> = { spring: GROUND_SPRING, summer: GROUND, autumn: GROUND_AUTUMN, winter: GROUND_WINTER }

// Light rain across the whole valley, and snowflakes; both step on the half-second clock.
const WIDE_RAIN = (() => {
  const r = rng(21)
  let d = ''
  for (let i = 0; i < 120; i++) d += `M${Math.floor(r() * 320) + 0.5} ${Math.floor(r() * 170) - 8}v2`
  return d
})()
const FLAKES = (() => {
  const r = rng(5)
  let d = ''
  for (let i = 0; i < 110; i++) d += `M${Math.floor(r() * 320)} ${Math.floor(r() * 176) - 16}h1`
  return d
})()

function outside(out: Outside, look: Look, now: number, stormRain: boolean): string {
  let s = ''
  if ((out.cond === 'rain' || out.cond === 'thunder') && !stormRain) {
    s += `<path class="rain" stroke="#b8c8de" stroke-opacity=".4" d="${WIDE_RAIN}"/>`
  }
  if (out.cond === 'snow') {
    s += `<path class="flakes" style="animation-delay:${-(now % 4000)}ms" stroke="#f4f8fd" stroke-opacity="${(0.55 + 0.4 * look.bright).toFixed(2)}" d="${FLAKES}"/>`
  }
  if (out.cond === 'thunder') {
    s += `<rect class="far" style="animation-delay:${-(now % 8000)}ms" y="-1" width="320" height="182" fill="#dfe6ff"/>`
  }
  return s
}

// Fog: a soft bank of mist lying over the low ground, thickest just above the fields.
function fog(look: Look): string {
  const c = mixHex('#e3e8ee', '#3a4250', 1 - look.bright)
  return `<linearGradient id="fogg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/>` +
    `<stop offset=".45" stop-color="${c}" stop-opacity=".55"/><stop offset=".7" stop-color="${c}" stop-opacity=".4"/>` +
    `<stop offset="1" stop-color="${c}" stop-opacity=".15"/></linearGradient><rect y="100" width="320" height="81" fill="url(#fogg)"/>`
}

const OUTSIDE_CSS = `.flakes{animation:flakes 4s steps(8) infinite}
@keyframes flakes{0%{transform:translate(0,0)}50%{transform:translate(2px,8px)}100%{transform:translate(0,16px)}}
.far{opacity:0;animation:far 8s steps(1) infinite}
@keyframes far{0%{opacity:.16}6%{opacity:0}12%{opacity:.08}18%,100%{opacity:0}}`

// ---- the town's live parts. Every loop steps on one shared half-second clock (its delay is
// `now` modulo its length, and stagger is whole steps), so the scene redraws twice a second at most.
const STEP = 500
const loop = (now: number, ms: number, offsetSteps = 0) => `animation-delay:${-((now + offsetSteps * STEP) % ms)}ms`

const pix = (x: number, y: number, w = 1) => `M${x} ${y}h${w}`

function town(look: Look, now: number, waiting: boolean): string {
  const night = look.lights
  const dark = 1 - look.bright
  // windows: glass by day; after dark most glow warm, a few stay dark
  let lit = ''
  let unlit = ''
  let halo = ''
  for (const [x, y, w, h, on] of WINDOWS) {
    for (let r = 0; r < h; r++) {
      if (on && night > 0.05) lit += pix(x, y + r, w)
      else unlit += pix(x, y + r, w)
    }
    if (on && night > 0.05) halo += `M${x - 1} ${y - 1}h${w + 2}M${x - 2} ${y}h${w + 4}M${x - 1} ${y + h}h${w + 2}`
  }
  const glass = mixHex('#33425f', '#0c1120', dark)
  const warm = mixHex('#33425f', '#ffcf6a', Math.min(1, night * 1.2))
  let out = `<path stroke="${glass}" d="${unlit}"/>`
  if (lit) out += `<path stroke="#ffb347" stroke-opacity="${(0.28 * night).toFixed(2)}" d="${halo}"/><path stroke="${warm}" d="${lit}"/>`
  // streetlamps: a warm head and a pool of light on the lane after dark
  let heads = ''
  let pools = ''
  for (const [x, y] of LAMPS) {
    heads += pix(x - 1, y - 1, 3)
    pools += `M${x - 2} ${y - 2}h5M${x - 3} ${y - 1}h7M${x - 3} ${y}h7M${x - 2} ${y + 1}h5M${x - 5} ${y + 7}h11M${x - 4} ${y + 8}h9`
  }
  out += night > 0.05
    ? `<path stroke="#ffcf6a" stroke-opacity="${(0.22 * night).toFixed(2)}" d="${pools}"/><path stroke="${mixHex('#3a3326', '#ffe6a0', night)}" d="${heads}"/>`
    : `<path stroke="#3a3326" d="${heads}"/>`
  // the lantern by the road: steady after dark unless it is blinking for you
  if (!waiting && night > 0.05) {
    out += `<path stroke="#ffb347" stroke-opacity="${(0.4 * night).toFixed(2)}" d="M264 150h7M263 151h9M263 152h9M263 153h9M264 154h7"/>` +
      `<path fill="#ffd27a" fill-opacity="${night.toFixed(2)}" d="M266 151h3v3h-3z"/>`
  }
  // chimney smoke: three puffs rising and thinning, each chimney a step out of time
  const smoke = mixHex('#d6d9e0', '#59607a', dark)
  out += CHIMNEYS.map(([x, y], i) =>
    `<path class="smoke" style="${loop(now, 2000, i % 4)}" stroke="${smoke}" stroke-opacity=".7" d="M${x} ${y}h1M${x + 1} ${y - 2}h2M${x} ${y - 4}h2"/>`).join('')
  // windmill sails, turning between two frames
  const [mx, my] = MILL
  const sail = mixHex('#efe6d2', '#6a6a78', dark)
  out += `<path class="sa" style="${loop(now, 1000)}" stroke="${sail}" d="M${mx} ${my - 7}v14M${mx - 7} ${my}h14"/>` +
    `<path class="sb" style="${loop(now, 1000)}" stroke="${sail}" d="${[1, 2, 3, 4, 5].map(k => `M${mx - k} ${my - k}h1M${mx + k} ${my - k}h1M${mx - k} ${my + k}h1M${mx + k} ${my + k}h1`).join('')}"/>` +
    `<path stroke="#6b4b3a" d="M${mx} ${my}h1"/>`
  // the pond's glint shifts now and then
  out += `<path class="ga" style="${loop(now, 2000)}" stroke="#eaf7ff" stroke-opacity="${(0.9 - 0.6 * dark).toFixed(2)}" d="M62 174h7M57 173h3"/>` +
    `<path class="gb" style="${loop(now, 2000)}" stroke="#eaf7ff" stroke-opacity="${(0.9 - 0.6 * dark).toFixed(2)}" d="M66 174h5M58 175h4"/>`
  // birds by day, crossing slowly with a flap; fireflies in the meadow by night
  if (look.stars < 0.5) {
    out += [0, 1, 2].map(i => {
      const y = 40 + i * 9
      return `<g class="bird" style="${loop(now, 180000, i * 7)}"><path class="sa" style="${loop(now, 1000)}" stroke="#1d2a44" d="M${-10 + i * 8} ${y}h1m1 1h1m1 -1h1"/>` +
        `<path class="sb" style="${loop(now, 1000)}" stroke="#1d2a44" d="M${-10 + i * 8} ${y + 1}h5"/></g>`
    }).join('')
  }
  if (night > 0.5) {
    const r = rng(31)
    out += Array.from({ length: 14 }, (_, i) => {
      const x = Math.floor(r() * 300) + 10
      const y = 162 + Math.floor(r() * 16)
      return `<path class="ff" style="${loop(now, 3000, i % 6)}" stroke="#d9ff8c" d="M${x} ${y}h1"/>`
    }).join('')
  }
  return out
}

const TOWN_CSS = `.smoke{animation:smoke 2s steps(4) infinite}
@keyframes smoke{from{transform:translateY(0);opacity:1}to{transform:translateY(-8px);opacity:.2}}
.sa{animation:sa 1s steps(1) infinite}.sb{animation:sb 1s steps(1) infinite}
@keyframes sa{0%{opacity:1}50%{opacity:0}}@keyframes sb{0%{opacity:0}50%{opacity:1}}
.ga{animation:sa 2s steps(1) infinite}.gb{animation:sb 2s steps(1) infinite}
.bird{animation:bird 180s steps(360) infinite}
@keyframes bird{from{transform:translateX(0)}to{transform:translateX(360px)}}
.ff{opacity:0;animation:ff 3s steps(1) infinite}
@keyframes ff{0%{opacity:0}50%{opacity:1}67%{opacity:0}}`

// ---- the session's own events ----
export const NO_EVENTS: SessionEvents = { fogUntil: 0, kites: [], fireworks: [] }
const FOG_IN_MS = 3000
const FOG_OUT_MS = 4000
export const FIREWORK_MS = 2500
const KITE_COLOURS = ['#e05a4a', '#4aa2e3', '#ead27a', '#8cc36b', '#c78ae8']

// A kite per subagent at work, flying over the town on a long string; each rises as it starts.
function kites(ev: SessionEvents, now: number, look: Look): string {
  const dim = mixHex('#ffffff', '#5a6070', 1 - look.bright)
  return ev.kites.slice(0, 6).map((k, i) => {
    const x = 192 + i * 22
    const y = 46 + (i % 3) * 14
    const c = KITE_COLOURS[i % KITE_COLOURS.length]!
    const shade = mixHex(c, '#1a1f2a', 0.35)
    const rise = Math.max(0, now - k.since)
    // a diamond kite, its right half in shade, with cross spars and a tail of bows
    const rows = [1, 3, 5, 7, 9, 7, 5, 3, 1]
    const left = rows.map((w, j) => `M${x - (w - 1) / 2} ${y + j}h${(w + 1) / 2}`).join('')
    const right = rows.map((w, j) => (w > 1 ? `M${x + 1} ${y + j}h${(w - 1) / 2}` : '')).join('')
    const body = `<path stroke="${c}" d="${left}"/><path stroke="${shade}" d="${right}"/>` +
      `<path stroke="#2a1f1a" stroke-opacity=".6" d="M${x - 4} ${y + 4}h9M${x} ${y + 1}v7"/>` +
      `<path stroke="${dim}" stroke-opacity=".85" d="M${x} ${y + 9}h1M${x + 1} ${y + 10}h1M${x} ${y + 11}h1M${x - 1} ${y + 12}h1M${x} ${y + 13}h1"/>` +
      `<path stroke="${c}" d="M${x - 1} ${y + 11}h1M${x + 2} ${y + 11}h1M${x - 2} ${y + 13}h1M${x + 1} ${y + 13}h1"/>`
    const string = `<path stroke="${dim}" stroke-opacity=".45" d="${Array.from({ length: 18 }, (_, j) => `M${Math.round(x - (j * 10) / 18)} ${Math.round(y + 9 + (j * (150 - y - 9)) / 18)}h1`).join('')}"/>`
    return `<g class="kite-in" style="animation-delay:${-rise}ms">${string}<g class="bob" style="animation-delay:${-((now + i * 500) % 2000)}ms">${body}</g></g>`
  }).join('')
}

// A firework over the church: a rocket climbs, then bursts in three widening rings.
function fireworks(ev: SessionEvents, now: number, palette = ['#ffd26a', '#ff7a8a', '#8ad8ff', '#b8ff8a', '#e0a8ff']): string {
  return ev.fireworks.filter(f => now - f.t < FIREWORK_MS).map(f => {
    const r = rng(f.seed)
    const cx = 200 + Math.floor(r() * 50)
    const cy = 70 + Math.floor(r() * 25)
    const c = palette[Math.floor(r() * palette.length)]!
    const ring = (rad: number) => {
      let d = ''
      const n = Math.max(8, Math.round(rad * 2.2))
      for (let a = 0; a < n; a++) {
        const t = (a / n) * Math.PI * 2
        d += `M${Math.round(cx + Math.cos(t) * rad)} ${Math.round(cy + Math.sin(t) * rad * 0.9)}h1`
      }
      return d
    }
    const age = `animation-delay:${-(now - f.t)}ms`
    return `<path class="fw-rocket" style="${age}" stroke="#ffe8b0" d="M${cx} ${cy}v3M${cx} ${cy + 5}v1"/>` +
      `<path class="fw-1" style="${age}" stroke="#fff6dc" d="M${cx - 1} ${cy}h3M${cx} ${cy - 1}h1M${cx} ${cy + 1}h1${ring(4)}"/>` +
      `<path class="fw-2" style="${age}" stroke="${c}" d="${ring(9)}${ring(6)}"/>` +
      `<path class="fw-3" style="${age}" stroke="${c}" stroke-opacity=".6" d="${ring(14)}"/>`
  }).join('')
}

// Fog rolling through while the conversation is compacted, then lifting.
function compactFog(ev: SessionEvents, now: number, look: Look): string {
  if (ev.fogUntil === 0 || now > ev.fogUntil + FOG_OUT_MS) return ''
  const lifting = now > ev.fogUntil
  const anim = lifting ? `fog-out ${FOG_OUT_MS}ms steps(8) ${-(now - ev.fogUntil)}ms both` : `fog-in ${FOG_IN_MS}ms steps(6) ${-Math.min(FOG_IN_MS, Math.max(0, now - (ev.fogUntil - 60_000)))}ms both`
  return `<g style="animation:${anim}">${fog(look)}<rect y="-1" width="320" height="182" fill="${mixHex('#e3e8ee', '#3a4250', 1 - look.bright)}" fill-opacity=".18"/></g>`
}

const EVENTS_CSS = `.bob{animation:bob 2s steps(1) infinite}@keyframes bob{0%{transform:none}50%{transform:translateY(-1px)}}
.kite-in{animation:kite-in 4s steps(8) both}@keyframes kite-in{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.fw-rocket,.fw-1,.fw-2,.fw-3{opacity:0;animation:${FIREWORK_MS}ms steps(1) both}
.fw-rocket{animation-name:fwr}.fw-1{animation-name:fw1}.fw-2{animation-name:fw2}.fw-3{animation-name:fw3}
@keyframes fwr{0%{opacity:1;transform:translateY(40px)}10%{transform:translateY(27px)}20%{transform:translateY(13px)}30%{opacity:1;transform:none}31%,100%{opacity:0}}
@keyframes fw1{0%,30%{opacity:0}31%{opacity:1}50%,100%{opacity:0}}
@keyframes fw2{0%,45%{opacity:0}46%{opacity:1}68%,100%{opacity:0}}
@keyframes fw3{0%,62%{opacity:0}63%{opacity:.8}92%,100%{opacity:0}}
@keyframes fog-in{from{opacity:0}to{opacity:1}}@keyframes fog-out{from{opacity:1}to{opacity:0}}`


// ---- holidays: decorations on the town, drawn over the dimmed ground so their lights glow ----
const TREE_X = 132
const TREE_BASE = 172

function holiday(h: Holiday | undefined, look: Look, now: number): string {
  if (h === undefined) return ''
  const night = look.lights
  const dark = 1 - look.bright
  let out = ''
  if (h === 'halloween') {
    const orange = mixHex('#e07a2a', '#3a2010', dark * 0.8)
    const shade = mixHex('#a8541c', '#2a1408', dark * 0.8)
    let body = ''
    let rind = ''
    let stems = ''
    let faces = ''
    DOORS.forEach(([x, y], i) => {
      if (i % 2) return
      const px = x + 2
      body += `M${px} ${y - 1}h3M${px} ${y}h3`
      rind += `M${px + 2} ${y - 1}h1M${px + 2} ${y}h1`
      stems += `M${px + 1} ${y - 2}h1`
      faces += `M${px} ${y - 1}h1M${px + 2} ${y - 1}h1M${px + 1} ${y}h1`
    })
    out += `<path stroke="${orange}" d="${body}"/><path stroke="${shade}" d="${rind}"/><path stroke="#3d6e36" d="${stems}"/>`
    if (night > 0.05) out += `<path stroke="#ffd26a" stroke-opacity="${night.toFixed(2)}" d="${faces}"/>`
  }
  if (h === 'christmas' || h === 'newyear') {
    // string lights on the front-row eaves, twinkling between two sets after dark
    const colours = ['#ff5a4a', '#8cff7a', '#ffd26a', '#6ab8ff']
    const sets: [string[], string[]] = [[], []]
    EAVES.forEach(([x, y, w]) => {
      for (let i = 0; i < w; i += 2) sets[(i / 2) % 2]!.push(`M${x + i} ${y}h1`)
    })
    const bulbs = (set: string[], k: number) => colours.map((c, j) =>
      `<path stroke="${night > 0.05 ? c : mixHex(c, '#5a5a5a', 0.4)}" d="${set.filter((_, n) => n % 4 === (j + k) % 4).join('')}"/>`).join('')
    out += night > 0.05
      ? `<g class="sa" style="${loop(now, 1000)}">${bulbs(sets[0], 0)}</g><g class="sb" style="${loop(now, 1000)}">${bulbs(sets[1], 1)}</g>` +
        `<g stroke-opacity="${(0.4 * night).toFixed(2)}">${bulbs(sets[0], 0)}${bulbs(sets[1], 1)}</g>`
      : bulbs(sets[0], 0) + bulbs(sets[1], 1)
    // a decorated tree in the meadow by the path
    const green = mixHex('#2f6a3a', '#0e1f14', dark * 0.8)
    const deep = mixHex('#1f4a2a', '#08140c', dark * 0.8)
    let left = ''
    let right = ''
    for (let r = 0; r < 13; r++) {
      const w = 1 + Math.floor(r * 0.7) * 2 - (r % 4 === 3 ? 2 : 0)
      const y = TREE_BASE - 15 + r
      const half = Math.max(0, Math.floor(w / 2))
      left += `M${TREE_X - half} ${y}h${half + 1}`
      if (half > 0) right += `M${TREE_X + 1} ${y}h${half}`
    }
    const baubles = [[-2, 4], [2, 6], [-3, 8], [1, 9], [3, 11], [-1, 12], [-4, 11], [0, 3]]
      .map(([dx, dy], i) => `<path stroke="${colours[i % 4]}" stroke-opacity="${night > 0.05 ? 1 : 0.8}" d="M${TREE_X + dx!} ${TREE_BASE - 15 + dy!}h1"/>`).join('')
    out += `<path stroke="${green}" d="${left}"/><path stroke="${deep}" d="${right}"/>${baubles}` +
      `<path stroke="#5a3d26" d="M${TREE_X} ${TREE_BASE - 2}h2M${TREE_X} ${TREE_BASE - 1}h2"/>` +
      `<path stroke="#ffe27a" d="M${TREE_X} ${TREE_BASE - 17}h1M${TREE_X - 1} ${TREE_BASE - 16}h3M${TREE_X} ${TREE_BASE - 15}h1"/>`
    if (night > 0.05) out += `<path stroke="#ffe27a" stroke-opacity="${(0.25 * night).toFixed(2)}" d="${disc(TREE_X, TREE_BASE - 16, 3)}"/>`
  }
  if (h === 'july4' && night < 0.5) {
    // bunting along the eaves by day
    const flags = ['#d23a3a', '#f4f4f4', '#3a5ad2']
    out += flags.map((c, j) => `<path stroke="${c}" d="${EAVES.map(([x, y, w]) => {
      let d = ''
      for (let i = j; i < w; i += 3) d += `M${x + i} ${y + 1}h1`
      return d
    }).join('')}"/>`).join('')
  }
  // New Year's Eve and the Fourth of July: a firework every few seconds after dark
  if ((h === 'newyear' || h === 'july4') && night > 0.5) {
    const every = 1500
    const k = Math.floor(now / every)
    const shows = [k, k - 1].map(n => ({ t: n * every, seed: n }))
    out += fireworks({ ...NO_EVENTS, fireworks: shows }, now, h === 'july4' ? ['#ff5a5a', '#ffffff', '#6a8aff'] : undefined)
  }
  return out
}


// A roll in and out, one cell per step so it stays on the pixel grid, eased: in arrives fast
// and settles, out starts slow and speeds away. Each segment steps its own share of the cells.
const EASE = [0, 0.35, 0.7, 1] // time marks
const OFF = [1, 0.4, 0.1, 0] // share of the distance still to go at each mark
function glide(name: string, axis: 'X' | 'Y', dist: number): string {
  const frames = (marks: number[], offs: number[]) =>
    marks.map((t, i) => {
      const at = Math.round(offs[i]! * dist)
      const next = offs[i + 1]
      const fn = next === undefined ? '' : `;animation-timing-function:steps(${Math.max(1, Math.abs(Math.round((offs[i]! - next) * dist)))})`
      return `${Math.round(t * 100)}%{transform:translate${axis}(${at}px)${fn}}`
    }).join('')
  const outMarks = EASE.map(t => 1 - t).reverse()
  const outOffs = [...OFF].reverse()
  return `@keyframes ${name}-in{${frames(EASE, OFF)}}@keyframes ${name}-out{${frames(outMarks, outOffs)}}`
}

export const CLEAR_SUMMER: Outside = { cond: 'clear', season: 'summer', snowCover: false }

export function scene(s: Sky, now: number, hour: number, out: Outside = CLEAR_SUMMER, ev: SessionEvents = NO_EVENTS): string {
  const look = lookAt(hour)
  // an overcast day is dimmer on the ground too
  const ground = out.snowCover ? GROUND_SNOW : GROUNDS[out.season]
  const dull = GREY.has(out.cond) || out.cond === 'fog' ? 0.85 : 1
  const stormy = s.mode === 'working' || s.mode === 'waiting'
  const modeAge = Math.max(0, now - s.modeSince)
  const stormAge = Math.max(0, now - s.stormSince)
  // the banks roll in (and the sky darkens) while stormy, roll back out once the turn is done
  const roll = stormy ? `in 6s linear -${stormAge}ms both` : `out 6s linear -${modeAge}ms both`
  const banks = stormy || s.mode === 'done'
    ? `<rect class="dim" style="animation:${stormy ? 'dim-in' : 'dim-out'} ${roll.slice(roll.indexOf(' ') + 1)}" y="-1" width="320" height="182" fill="#06071a" fill-opacity=".45"/>` +
      `<g style="filter:brightness(${Math.max(0.5, look.bright).toFixed(2)})">` +
      `<g class="bl" style="animation:bl-${roll}">${BANK_L}</g>` +
      `<g class="br" style="animation:br-${roll}">${BANK_R}</g>` +
      `<g class="bt" style="animation:bt-${roll}">${BANK_T}</g></g>`
    : ''
  const strikes = s.strikes
    .filter(st => now - st.t < STRIKE_MS)
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_BOLTS)
  // rain waits until the clouds are most of the way in (about 4 s of their 6 s roll)
  // a long turn's storm grows: after two minutes heavier rain, after five the sky darker still
  const heavy = stormy && stormAge > 120_000
  const rain = s.mode === 'working'
    ? `<g style="animation:rain-in 6s steps(1) -${stormAge}ms both"><path class="rain" stroke="#a9c6ff" stroke-opacity=".5" d="${RAIN}"/>` +
      (heavy ? `<g transform="translate(5 7)"><path class="rain" stroke="#a9c6ff" stroke-opacity=".45" d="${RAIN}"/></g>` : '') + `</g>`
    : ''
  const darker = stormy && stormAge > 300_000 ? `<rect y="-1" width="320" height="182" fill="#06071a" fill-opacity=".15"/>` : ''
  const beams = s.mode === 'done'
    ? `<g class="beams" style="animation-delay:-${modeAge}ms" fill="#fff4c2">` +
      `<path d="M80 0h27L40 160H7z"/><path d="M127 0h15L87 160H63z"/><path d="M167 0h9L143 160H127z"/></g>`
    : ''
  const lantern = s.mode === 'waiting'
    ? `<g class="lantern"><path fill="#ffb347" fill-opacity=".35" d="M264 149h7v1h-7zM263 150h9v4h-9zM264 154h7v1h-7z"/>` +
      `<path fill="#ffd27a" d="M266 151h3v3h-3z"/></g>`
    : `<path fill="#3a3326" d="M266 151h3v3h-3z"/>`

  const build = (bolts: string) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none"><style>
${glide('bl', 'X', -100)}
${glide('br', 'X', 100)}
${glide('bt', 'Y', -60)}
${TOWN_CSS}
${OUTSIDE_CSS}
${EVENTS_CSS}
@keyframes dim-in{from{opacity:0}to{opacity:1}}
@keyframes dim-out{from{opacity:1}to{opacity:0}}
.rain{animation:rain 1.5s steps(3) -${now % 1500}ms infinite}
@keyframes rain{from{transform:translateY(-6px)}to{transform:translateY(6px)}}
@keyframes rain-in{0%{opacity:0}70%,100%{opacity:1}}
.bolt,.flash{opacity:0;animation:strike ${STRIKE_MS}ms steps(1) both}
.flash{animation-name:flash}
@keyframes strike{0%{opacity:1}12%{opacity:0}22%{opacity:1}40%{opacity:.6}55%,100%{opacity:0}}
@keyframes flash{0%{opacity:.22}8%{opacity:0}22%{opacity:.12}30%,100%{opacity:0}}
.lantern{animation:blink 1s steps(1) -${now % 1000}ms infinite}
@keyframes blink{0%{opacity:1}50%{opacity:.25}}
.beams{opacity:0;animation:beams 20s steps(20) both}
@keyframes beams{0%{opacity:0}15%{opacity:.22}70%{opacity:.18}100%{opacity:0}}
</style><svg viewBox="0 -.5 320 180" preserveAspectRatio="xMidYMax slice">
${sky(look, out)}
${outside(out, look, now, s.mode === 'working')}${kites(ev, now, look)}${fireworks(ev, now)}${rain}${banks}${darker}
${beams}${bolts}
<g style="filter:brightness(${(look.bright * dull).toFixed(2)}) saturate(${(look.sat * dull).toFixed(2)}) sepia(${look.warm.toFixed(2)})">${ground}</g>
${lantern}${town(look, now, s.mode === 'waiting')}${out.cond === 'fog' ? fog(look) : ''}${holiday(out.holiday, look, now)}${compactFog(ev, now, look)}
</svg></svg>`

  // newest bolts first; a crowded burst drops its oldest so the scene stays under the app's limit
  let n = strikes.length
  let svg = build(strikes.map(st => bolt(st, now - st.t)).join(''))
  while (svg.length > LIMIT && n > 0) {
    n--
    svg = build(strikes.slice(0, n).map(st => bolt(st, now - st.t)).join(''))
  }
  return svg
}
