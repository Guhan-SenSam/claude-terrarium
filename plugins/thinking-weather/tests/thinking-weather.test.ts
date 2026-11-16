import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { condOf, eraLevel, holidayOf, moonPhase, seasonOf, solarHour } from '../hooks/outside'
import { scene } from '../hooks/scene'
import type { Era, Sky } from '../types'

const LIMIT = 131072
const AT = 1_700_000_000_000

const BACKDROP = {
  plugin: 'thinking-weather',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'weather', plugin: 'thinking-weather', glass: false },
  surface: 'desktop',
} as const

/** Stands for the engine beneath the mod. */
function engine(on: On, now = AT) {
  const clock = mock.clock(on, { now })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__thinking-weather__${e.name}` } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return clock
}

test('every scene stays under the app limit, at any hour and in a full burst of lightning', async () => {
  const strikes = Array.from({ length: 20 }, (_, i) => ({ t: AT - i * 40, seed: i + 1 }))
  for (const mode of ['idle', 'working', 'waiting', 'done'] as const) {
    for (const hour of [0, 6.3, 12, 18.6, 22]) {
      const s: Sky = { mode, modeSince: AT - 1000, stormSince: AT - 3000, strikes: mode === 'working' ? strikes : [], at: AT }
      expect(scene(s, AT, hour).length < LIMIT).toBe(true)
    }
  }
})

test('the scene holds no embedded pictures, which the desktop app strips', async () => {
  const s: Sky = { mode: 'working', modeSince: AT, stormSince: AT, strikes: [{ t: AT, seed: 3 }], at: AT }
  const svg = scene(s, AT, 12)
  expect(svg.includes('<image')).toBe(false)
  expect(svg.includes('data:')).toBe(false)
})

test('a turn brings the storm and rain; a subagent finishing does not end it', async ($, on) => {
  engine(on)
  const view = await $.ui.mount(BACKDROP)
  const svg = async () => String((await view.find({ type: 'Svg' }))?.props.source ?? '')

  expect((await svg()).includes('class="rain"')).toBe(false)

  await $.turn.start({ turnId: 't1' })
  expect((await svg()).includes('class="rain"')).toBe(true)

  await $.turn.complete({ turnId: 't2', agentId: 'helper', reason: 'completed' })
  expect((await svg()).includes('class="rain"')).toBe(true)

  await $.turn.complete({ turnId: 't1', reason: 'completed' })
  expect((await svg()).includes('class="rain"')).toBe(false)
  expect((await svg()).includes('class="beams"')).toBe(true)
})

test('seasons follow the calendar, flipped south of the equator', async () => {
  expect(seasonOf(new Date(2026, 0, 15), 28)).toBe('winter')
  expect(seasonOf(new Date(2026, 3, 15), 28)).toBe('spring')
  expect(seasonOf(new Date(2026, 6, 15), 28)).toBe('summer')
  expect(seasonOf(new Date(2026, 9, 15), 28)).toBe('autumn')
  expect(seasonOf(new Date(2026, 0, 15), -33)).toBe('summer')
})

test('weather codes map to the skies the scene draws', async () => {
  expect([0, 2, 3, 45, 61, 73, 95].map(condOf)).toEqual(['clear', 'partly', 'overcast', 'fog', 'rain', 'snow', 'thunder'])
})

test('with a place set, the town is looked up once and then only rounded coordinates are sent', { options: { place: 'Springfield, Illinois' } }, async ($, on) => {
  const clock = engine(on)
  const urls: string[] = []
  on('http.fetch', (_, e) => {
    urls.push(e.url)
    const text = e.url.includes('geocoding')
      ? JSON.stringify({ results: [
          { name: 'Springfield', latitude: 37.215, longitude: -93.298, admin1: 'Missouri', country_code: 'US' },
          { name: 'Springfield', latitude: 39.8017, longitude: -89.6436, admin1: 'Illinois', country_code: 'US' },
        ] })
      : JSON.stringify({ current: { weather_code: 63, temperature_2m: 4.2, snow_depth: 0 } })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('config.set', (_, e) => ({ value: e.value }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10)

  expect(urls[0]).toContain('geocoding-api.open-meteo.com')
  expect(urls[1]).toContain('latitude=39.8&longitude=-89.6')
  const view = await $.ui.mount(BACKDROP)
  const svg = String((await view.find({ type: 'Svg' }))?.props.source ?? '')
  expect(svg.includes('class="rain"')).toBe(true) // it is raining in Springfield
})

test('on desktop the working row is a pixel storm cloud, the step and the time; elsewhere it is left alone', async ($, on) => {
  engine(on)
  const props = { word: 'Creating notes.md', message: null, suffix: '…', mode: 'tool-use' } as const
  const row = await $.ui.mount({ plugin: 'thinking-weather', component: 'Spinner', props, surface: 'desktop' })
  const svg = await row.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toContain('tool-use')
  expect(String(svg?.props.source)).toContain('#57508a')
  expect((await row.find({ type: 'Text', text: /Creating notes\.md…/ }))?.text).toBe('Creating notes.md…')
  await row.unmount()

  const terminal = await $.ui.mount({ plugin: 'thinking-weather', component: 'Spinner', props, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  await terminal.unmount()
})

test('dawn and dusk land on the real sunrise and sunset', async () => {
  // Tampa in November: up at 7:02, down at 17:40
  expect(Math.abs(solarHour(7.03, 7.03, 17.67) - 6.4) < 1e-9).toBe(true)
  expect(Math.abs(solarHour(17.67, 7.03, 17.67) - 18.7) < 1e-9).toBe(true)
  expect(solarHour(12, undefined, undefined)).toBe(12)
})

test('the moon has its real phase', async () => {
  expect(moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14))) < 1e-9).toBe(true)
  // a full moon: 2026-01-03
  expect(Math.abs(moonPhase(new Date(Date.UTC(2026, 0, 3, 10))) - 0.5)).toBeLessThan(0.03)
})

test('holidays follow the calendar', async () => {
  expect(holidayOf(new Date(2026, 9, 31, 20))).toBe('halloween')
  expect(holidayOf(new Date(2026, 11, 20, 12))).toBe('christmas')
  expect(holidayOf(new Date(2026, 11, 31, 22))).toBe('newyear')
  expect(holidayOf(new Date(2026, 6, 4, 21))).toBe('july4')
  expect(holidayOf(new Date(2026, 4, 10, 12))).toBeUndefined()
})

test('a subagent flies a kite until it finishes', async ($, on) => {
  engine(on)
  const view = await $.ui.mount(BACKDROP)
  const svg = async () => String((await view.find({ type: 'Svg' }))?.props.source ?? '')

  await $.turn.start({ turnId: 't1' })
  await $.turn.start({ turnId: 'a1', agentId: 'helper' })
  expect((await svg()).includes('class="kite-in"')).toBe(true)
  await $.turn.complete({ turnId: 'a1', agentId: 'helper', reason: 'completed' })
  expect((await svg()).includes('class="kite-in"')).toBe(false)
})

test('holiday decorations stay under the size limit on a stormy night', async () => {
  const strikes = Array.from({ length: 12 }, (_, i) => ({ t: AT - i * 40, seed: i + 1, err: i % 3 === 0 }))
  for (const holiday of ['halloween', 'christmas', 'newyear', 'july4'] as const) {
    const s: Sky = { mode: 'working', modeSince: AT - 400_000, stormSince: AT - 400_000, strikes, at: AT }
    const ev = { fogUntil: AT + 1000, kites: [1, 2, 3, 4, 5, 6].map(i => ({ id: `k${i}`, since: AT - i * 1000 })), fireworks: [{ t: AT - 500, seed: 2 }] }
    for (const era of ['stone', 'village', 'industrial', 'modern', 'scifi'] as const) {
      const svg = scene(s, AT, 22, { cond: 'snow', season: 'winter', snowCover: true, moon: 0.5, holiday, era, eraSince: AT - 500 }, ev)
      expect(svg.length < LIMIT).toBe(true)
    }
  }
})

test('running a slash command strikes lightning', async ($, on) => {
  // the backdrop times bolts on the real clock, so this test's clock starts there too
  const clock = engine(on, Date.now())
  on('command.run', () => ({ text: 'ran' }))
  const view = await $.ui.mount(BACKDROP)
  await $.command.run({ command: 'compact', args: '' })
  await clock.advance(400)
  const svg = String((await view.find({ type: 'Svg' }))?.props.source ?? '')
  expect(svg.includes('class="bolt"')).toBe(true)
})

test('society advances with the context, an era for each fifth', async () => {
  expect([0, 19, 20, 45, 61, 80, 100].map(eraLevel)).toEqual([0, 0, 1, 2, 3, 4, 4])
})

test('/weather-era shows another era on the backdrop', async ($, on) => {
  engine(on)
  const view = await $.ui.mount(BACKDROP)
  const svg = async () => String((await view.find({ type: 'Svg' }))?.props.source ?? '')
  expect((await svg()).includes('#e8dcff')).toBe(false)
  await $.command.run({ command: 'weather-era', args: 'scifi' })
  expect((await svg()).includes('#e8dcff')).toBe(true) // the future's ringed planet
})

test('each era draws its own settlement', async () => {
  const s: Sky = { mode: 'idle', modeSince: 0, stormSince: 0, strikes: [], at: AT }
  const draw = (era: Era) => scene(s, AT, 12, { cond: 'clear', season: 'summer', snowCover: false, era })
  const eras = ['stone', 'village', 'industrial', 'modern', 'scifi'] as const
  expect(new Set(eras.map(draw)).size).toBe(eras.length)
  expect(draw('scifi').includes('#e8dcff')).toBe(true) // the ringed planet
  expect(draw('industrial').includes('id="smog"')).toBe(true) // coal smoke over the valley
  expect(draw('modern').includes('#ff3a3a')).toBe(true) // aircraft lights on the towers
})

test('rain falls down its columns and loops without a jump', async () => {
  const s: Sky = { mode: 'working', modeSince: AT - 10_000, stormSince: AT - 10_000, strikes: [], at: AT }
  const svg = scene(s, AT, 12)
  expect(svg).toMatch(/\.rain\{stroke-dasharray:2 46;animation:rain \d+ms steps\(24\)/)
  expect(svg.includes('to{stroke-dashoffset:-48}')).toBe(true)
})
