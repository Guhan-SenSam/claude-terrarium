import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { condOf, seasonOf } from '../hooks/outside'
import { scene } from '../hooks/scene'
import type { Sky } from '../types'

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
function engine(on: On) {
  const clock = mock.clock(on, { now: AT })
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
