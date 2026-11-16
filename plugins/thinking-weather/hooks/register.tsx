import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { Mode, Sky, Strike } from '../types'
import { scene } from './scene'

const INITIAL: Sky = { mode: 'idle', modeSince: 0, stormSince: 0, strikes: [], at: 0 }
const sky = atom({ plugin: 'thinking-weather', key: 'sky' } as const, INITIAL)

const LOOK: ThemeSetArgs = {
  backdrop: { scene: 'weather', glass: { blur: 6, opacity: 0.5 } },
}

const BATCH_MS = 350
const KEEP_MS = 1500
const DONE_MS = 20000

let pending: Strike[] = []
let flushing = false
let seed = 1
// /weather-time sets an hour to preview; undefined follows the local clock.
let hourOverride: number | undefined
const REDRAW_MS = 2 * 60 * 1000

// A sped-up day for showing the looks: from `fromHour` round the clock in `durMs`, clear weather.
let cycle: { start: number; durMs: number; fromHour: number } | undefined
let cycleTimer: { cancel: () => void } | undefined
const CYCLE_FROM = 5
const CYCLE_S = 48

function hourAt(ms: number): number {
  if (cycle !== undefined) {
    const p = (ms - cycle.start) / cycle.durMs
    if (p >= 0 && p < 1) return (cycle.fromHour + 24 * p) % 24
  }
  if (hourOverride !== undefined) return hourOverride
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

// The session's permission mode, from the footer's mode labels. In these modes nobody is
// asked: an `ask` verdict is settled by the mode itself (auto's classifier, or a deny).
let permMode: string | undefined
const NOBODY_ASKED = new Set(['auto', 'bypassPermissions', 'dontAsk'])

async function write($: EngineInterface, mode?: Mode) {
  const now = await $.clock.now()
  const fresh = pending
  pending = []
  await update($, sky, prev => {
    const s = prev ?? INITIAL
    const next: Sky = { ...s, at: now }
    if (mode !== undefined && mode !== s.mode) {
      const wasStormy = s.mode === 'working' || s.mode === 'waiting'
      const isStormy = mode === 'working' || mode === 'waiting'
      next.mode = mode
      next.modeSince = now
      if (isStormy && !wasStormy) next.stormSince = now
    }
    next.strikes = [...s.strikes, ...fresh].filter(st => now - st.t < KEEP_MS)
    return next
  })
}

function flushSoon($: EngineInterface) {
  if (flushing) return
  flushing = true
  $.clock.after(BATCH_MS, () => {
    flushing = false
    void write($).then(() => {
      // one more pass to drop strikes that have finished
      $.clock.after(KEEP_MS, () => void write($))
    })
  })
}

async function startCycle($: EngineInterface, seconds: number): Promise<string> {
  const s = Math.min(600, Math.max(10, Math.round(seconds)))
  cycleTimer?.cancel()
  cycle = { start: await $.clock.now(), durMs: s * 1000, fromHour: CYCLE_FROM }
  cycleTimer = $.clock.every(500, () => {
    const c = cycle
    void $.clock.now().then(now => {
      if (c === undefined || now - c.start >= c.durMs) {
        cycleTimer?.cancel()
        cycleTimer = undefined
        cycle = undefined
      }
      return write($)
    })
  })
  return `Running a full day in ${s} seconds, from ${CYCLE_FROM}:00, in clear weather; then the sky follows the clock again.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.theme.set(LOOK)
    await $.command.register({ name: 'weather-test', description: 'Fire a burst of test lightning' })
    await $.command.register({ name: 'weather-off', description: 'Clear the thinking-weather background' })
    await $.command.register({ name: 'weather-cycle', description: 'Play a whole day in under a minute', argumentHint: '[seconds]' })
    await $.tool.register({
      name: 'weather_cycle',
      description: 'Plays the thinking-weather background through a whole day (dawn, day, dusk, night) in clear weather, sped up, then returns to the real clock.',
      inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: 'How long the whole day takes, 10 to 600; default 48.' } } },
      isDeferred: false,
    })
    await $.command.register({ name: 'weather-time', description: 'Preview a time of day (HH:MM), or "auto" to follow the clock', argumentHint: 'HH:MM | auto' })
    // the sky follows the clock: redraw every couple of minutes
    $.clock.every(REDRAW_MS, () => void write($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await write($, 'working')
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.approver !== undefined && e.agentId === undefined) {
      // With the mode unknown an ask may be auto's classifier at work, and nothing tells when an
      // approved tool starts running, so only a known asking mode counts as waiting on you.
      if (permMode !== undefined && !NOBODY_ASKED.has(permMode)) {
        await write($, 'waiting')
      }
    }
    return verdict
  })

  // The footer's mode labels say which permission mode is on; read them as the engine draws it.
  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    const labels = e.props.modes.join(' ')
    // The desktop app draws its own footer and leaves these labels empty: the mode stays unknown.
    const mode = labels.trim() === '' ? undefined
      : /bypass/i.test(labels) ? 'bypassPermissions' : /auto/i.test(labels) ? 'auto' : /don.?t ask/i.test(labels) ? 'dontAsk' : 'default'
    permMode = mode
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const asksPerson = e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode'
    if (asksPerson) {
      await write($, 'waiting')
    } else {
      pending.push({ t: await $.clock.now(), seed: seed++ })
      flushSoon($)
    }
    const result = await next(e)
    const s = await read($, sky)
    if (s.mode === 'waiting') await write($, 'working')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await write($, 'done')
    const since = (await read($, sky)).modeSince
    $.clock.after(DONE_MS, () => {
      void read($, sky).then(s => (s.mode === 'done' && s.modeSince === since ? write($, 'idle') : undefined))
    })
    return next(e)
  })

  on('command.run', { command: 'weather-test' }, async ($, e, next) => {
    await write($, 'working')
    const now = await $.clock.now()
    for (let i = 0; i < 5; i++) pending.push({ t: now + i * 140, seed: seed++ })
    flushSoon($)
    return { text: 'Five test strikes on the way.' }
  })

  on('command.run', { command: 'weather-cycle' }, async ($, e, next) => {
    const n = Number(e.args.trim())
    return { text: await startCycle($, Number.isFinite(n) && n > 0 ? n : CYCLE_S) }
  })

  on('tool.call', { tool: 'mcp__thinking-weather__weather_cycle' }, async ($, e, next) => {
    // a mod tool's arguments sit beside `tool` on the input
    const seconds = Number((e as { seconds?: unknown }).seconds)
    const n = Number.isFinite(seconds) && seconds > 0 ? seconds : CYCLE_S
    return { result: await startCycle($, n) }
  })

  on('command.run', { command: 'weather-time' }, async ($, e, next) => {
    const arg = e.args.trim()
    const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(arg)
    if (arg === '' || arg === 'auto') {
      hourOverride = undefined
    } else if (m && Number(m[1]) < 24 && Number(m[2] ?? 0) < 60) {
      hourOverride = Number(m[1]) + Number(m[2] ?? 0) / 60
    } else {
      return { text: 'Give a time like 06:15 or 21:00, or "auto" to follow the clock.' }
    }
    await write($)
    return { text: hourOverride === undefined ? 'The sky follows your clock again.' : `Showing the sky at ${arg}. /weather-time auto goes back to the clock.` }
  })

  on('command.run', { command: 'weather-off' }, async ($, e, next) => {
    await $.theme.clear()
    return { text: 'Weather cleared. /reload-plugins or a new session brings it back.' }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'thinking-weather') return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const stored = await read($, sky)
    // while a day cycle plays, show clear weather so the sky can be seen
    const s: Sky = cycle !== undefined ? { ...stored, mode: 'idle', strikes: [] } : stored
    const { Svg } = $.ui.resolve(e)
    return <Svg source={scene(s, Date.now(), hourAt(Date.now()))} alt="A pixel-art sky over fields that turns stormy while Claude works" isInteractive />
  })
}
