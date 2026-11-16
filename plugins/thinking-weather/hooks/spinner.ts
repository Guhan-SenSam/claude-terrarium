// The working indicator: a little pixel storm cloud in the weather palette, doing what the turn
// does. Thinking, it billows; sending a request, three dots light in turn under it; using a tool,
// lightning flickers from it; writing the reply, rain falls. 16x12 cells at 2 px; every loop steps
// on the same half-second clock as the background.

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

export const ICON_PX = { width: 32, height: 24 }

const CLOUD = [
  '.....hhhh.......',
  '...hhmmmmhh.....',
  '..hmmmmmmmmhh...',
  '.hmmmmmmmmmmmh..',
  '.mmmmmmmmmmmmmm.',
  '.dmmmmmmmmmmmmd.',
  '..ddddddddddddd.',
]
const PUFF = [ // the extra billow on the second thinking frame
  '..........hh....',
  '.........hmmh...',
]
const COLOURS: Record<string, string> = { h: '#8a84b8', m: '#57508a', d: '#3a386c' }

function cells(map: string[], dy: number): string {
  const by = new Map<string, string>()
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
      by.set(c, (by.get(c) ?? '') + `M${x} ${dy + y + 0.5}h${n}`)
      x += n
    }
  })
  return [...by].map(([c, d]) => `<path stroke="${COLOURS[c]}" d="${d}"/>`).join('')
}

const delay = (now: number, ms: number) => `animation-delay:${-(now % ms)}ms`

export function spinnerSvg(mode: SpinnerMode, now: number): string {
  let extra = ''
  let css = ''
  if (mode === 'thinking') {
    extra = `<g class="a" style="${delay(now, 1000)}">${cells(PUFF, 0)}</g>`
    css = '.a{animation:a 1s steps(1) infinite}@keyframes a{0%{opacity:0}50%{opacity:1}}'
  } else if (mode === 'tool-use' || mode === 'tool-input') {
    extra = `<g class="b" style="${delay(now, 1000)}"><path stroke="#9fc8ff" stroke-opacity=".6" d="M6 8.5h3M5 9.5h3M7 10.5h3M6 11.5h2"/>` +
      `<path stroke="#ffffff" d="M7 8.5h1M6 9.5h1M8 10.5h1M7 11.5h1"/></g>`
    css = '.b{animation:b 1s steps(1) infinite}@keyframes b{0%{opacity:1}25%{opacity:0}50%{opacity:.8}75%{opacity:0}}'
  } else if (mode === 'responding') {
    extra = `<g class="r" style="${delay(now, 1500)}"><path stroke="#a9c6ff" d="M4 8.5h1M8 9.5h1M12 8.5h1M6 10.5h1M10 11.5h1"/></g>`
    css = '.r{animation:r 1.5s steps(3) infinite}@keyframes r{from{transform:translateY(-1px)}to{transform:translateY(2px)}}'
  } else {
    extra = [4, 7, 10].map((x, i) =>
      `<path class="d" style="animation-delay:${-((now + (2 - i) * 500) % 1500)}ms" stroke="#ead27a" d="M${x} 10.5h2"/>`).join('')
    css = '.d{opacity:.25;animation:d 1.5s steps(1) infinite}@keyframes d{0%{opacity:1}33%{opacity:.25}}'
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 12" width="${ICON_PX.width}" height="${ICON_PX.height}" fill="none" shape-rendering="crispEdges"><style>${css}</style>${cells(CLOUD, 1)}${extra}</svg>`
}
