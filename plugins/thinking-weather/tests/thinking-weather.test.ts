import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
  mock.clock(on, { now: AT })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__thinking-weather__${e.name}` } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
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
