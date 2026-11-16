import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, ThemeSetArgs } from 'claude-code'

import type { Cond, Era, EraState, Holiday, Mode, Outside, Report, Season, SessionEvents, Sky, Strike } from '../types'
import { FIREWORK_MS, NO_EVENTS, scene } from './scene'
import { ICON_PX, spinnerSvg } from './spinner'
import { eraLevel, fetchReport, holidayOf, moonPhase, seasonOf, solarHour } from './outside'

const INITIAL: Sky = { mode: 'idle', modeSince: 0, stormSince: 0, strikes: [], at: 0 }
const sky = atom({ plugin: 'thinking-weather', key: 'sky' } as const, INITIAL)
const report = atom({ plugin: 'thinking-weather', key: 'report' } as const, null)
// A second's tick while a turn runs, read only by the working row: it redraws that row's
// elapsed time without redrawing the background.
const tick = atom({ plugin: 'thinking-weather', key: 'tick' } as const, 0)
let tickTimer: { cancel: () => void } | undefined
const events = atom({ plugin: 'thinking-weather', key: 'events' } as const, NO_EVENTS)
const COMPACT_FOG_MS = 60_000

// Society advances with the conversation's context: an era for each fifth of the window. Compaction
// sends it back to the Stone Age behind the fog.
const ERA_ORDER: readonly Era[] = ['stone', 'village', 'industrial', 'modern', 'scifi']
const eraState = atom({ plugin: 'thinking-weather', key: 'era' } as const, { level: 0, since: 0 } as EraState)
let eraOverride: Era | undefined
const levelFor = eraLevel
const GIT_SHIP = /\bgit\b[^|;&]*\b(commit|push)\b/

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
const WEATHER_MS = 30 * 60 * 1000

// Previews from /weather-sky and /weather-season; undefined follows the weather and the calendar.
let skyOverride: Cond | undefined
let seasonOverride: Season | 'snow' | undefined
let holidayOverride: Holiday | 'none' | undefined
const HOLIDAYS: readonly Holiday[] = ['halloween', 'christmas', 'newyear', 'july4']
let place = ''

const CONDS: readonly Cond[] = ['clear', 'partly', 'overcast', 'rain', 'snow', 'fog', 'thunder']
const SEASONS = ['spring', 'summer', 'autumn', 'winter', 'snow'] as const

/** The sky outside now: previews first, then the last report for the place set, then the calendar. */
function outsideAt(ms: number, r: Report | null, era?: EraState): Outside {
  const fresh = r !== null && r.place === place && ms - r.at < 3 * 60 * 60 * 1000 ? r : null
  const cond = skyOverride ?? fresh?.cond ?? 'clear'
  const moon = moonPhase(new Date(ms))
  const eraName = eraOverride ?? ERA_ORDER[era?.level ?? 0] ?? 'stone'
  const eraSince = eraOverride === undefined ? era?.since : undefined
  const holiday = holidayOverride === 'none' ? undefined : holidayOverride ?? holidayOf(new Date(ms))
  if (seasonOverride === 'snow') return { cond, season: 'winter', snowCover: true, moon, holiday, era: eraName, eraSince }
  const season = seasonOverride ?? seasonOf(new Date(ms), fresh?.lat ?? r?.lat ?? 40)
  // With no place set, winter is the storybook kind; with one, snow lies only when it really does.
  const snowCover = seasonOverride === undefined && (fresh ? fresh.snowCover : place === '' && season === 'winter')
  return { cond, season, snowCover: snowCover || cond === 'snow', moon, holiday, era: eraName, eraSince }
}

async function refreshWeather($: EngineInterface): Promise<string> {
  if (place === '') {
    await update($, report, () => null)
    return 'No place set: the sky stays clear and the seasons follow the calendar.'
  }
  const prev = await read($, report)
  const r = await fetchReport($, place, prev !== null && prev.place === place ? prev : null)
  if (typeof r === 'string') return r
  await update($, report, () => r)
  await write($)
  return `${r.name}: ${r.cond}, ${Math.round(r.tempC)}°C${r.snowCover ? ', snow on the ground' : ''}.`
}

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

// A slideshow of seasons and skies, each held a few seconds, in clear weather.
const TOUR: { season: Season | 'snow'; sky: Cond; hour: number; label: string }[] = [
  { season: 'spring', sky: 'clear', hour: 11, label: 'spring morning' },
  { season: 'summer', sky: 'partly', hour: 13, label: 'summer, a few clouds' },
  { season: 'autumn', sky: 'overcast', hour: 15, label: 'overcast autumn' },
  { season: 'winter', sky: 'rain', hour: 12, label: 'winter rain' },
  { season: 'snow', sky: 'snow', hour: 12, label: 'snowfall' },
  { season: 'autumn', sky: 'fog', hour: 8, label: 'foggy autumn morning' },
  { season: 'summer', sky: 'thunder', hour: 22, label: 'summer thunderstorm at night' },
  { season: 'snow', sky: 'clear', hour: 21, label: 'snowy night' },
]
const TOUR_STEP_MS = 5000
let tour: { start: number } | undefined
let tourTimer: { cancel: () => void } | undefined

async function startTour($: EngineInterface): Promise<string> {
  tourTimer?.cancel()
  tour = { start: await $.clock.now() }
  const step = async () => {
    const now = await $.clock.now()
    const i = tour === undefined ? TOUR.length : Math.floor((now - tour.start) / TOUR_STEP_MS)
    const t = TOUR[i]
    if (t === undefined) {
      tourTimer?.cancel()
      tourTimer = undefined
      tour = undefined
      skyOverride = undefined
      seasonOverride = undefined
      hourOverride = undefined
    } else {
      skyOverride = t.sky
      seasonOverride = t.season
      hourOverride = t.hour
    }
    await write($)
  }
  await step()
  tourTimer = $.clock.every(500, () => void step())
  return `Touring ${TOUR.length} looks, ${TOUR_STEP_MS / 1000} s each: ${TOUR.map(t => t.label).join(', ')}. Then back to the real weather.`
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

async function setPlace($: EngineInterface, town: string): Promise<string> {
  const value = town.toLowerCase() === 'off' ? '' : town
  if (town === '') return place === '' ? 'No place set. /weather-place <town> sets one.' : `The sky follows the weather in ${place}.`
  const set = await $.config.set({ key: 'thinking-weather.place', value })
  if ('deny' in set && set.deny) return `Could not save the place: ${set.deny}`
  place = value
  return value === '' ? 'Real weather off: the sky stays clear.' : await refreshWeather($)
}

async function preview($: EngineInterface, skyArg: string | undefined, seasonArg: string | undefined): Promise<string> {
  if (skyArg !== undefined) {
    if (skyArg === 'auto' || skyArg === '') skyOverride = undefined
    else if ((CONDS as readonly string[]).includes(skyArg)) skyOverride = skyArg as Cond
    else return `Skies: ${CONDS.join(', ')}, or auto.`
  }
  if (seasonArg !== undefined) {
    if (seasonArg === 'auto' || seasonArg === '') seasonOverride = undefined
    else if ((SEASONS as readonly string[]).includes(seasonArg)) seasonOverride = seasonArg as Season | 'snow'
    else return `Seasons: ${SEASONS.join(', ')}, or auto.`
  }
  await write($)
  const o = outsideAt(await $.clock.now(), await read($, report))
  return `Showing ${o.cond}, ${o.snowCover ? 'snow on the ground' : o.season}.`
}

/** Changes the session's events and redraws; `later` asks for another redraw after that long. */
async function event($: EngineInterface, fn: (ev: SessionEvents, now: number) => SessionEvents, later?: number) {
  const now = await $.clock.now()
  await update($, events, prev => fn(prev ?? NO_EVENTS, now))
  await write($)
  if (later !== undefined) $.clock.after(later, () => void write($))
}

async function firework($: EngineInterface) {
  await event($, (ev, now) => ({ ...ev, fireworks: [...ev.fireworks.filter(f => now - f.t < FIREWORK_MS), { t: now, seed: seed++ }] }), FIREWORK_MS + 200)
}

async function demo($: EngineInterface): Promise<string> {
  const ids = ['demo-1', 'demo-2', 'demo-3']
  await event($, (ev, now) => ({ ...ev, kites: [...ev.kites, ...ids.map((id, i) => ({ id, since: now + i * 1500 }))] }))
  $.clock.after(3000, () => void firework($))
  $.clock.after(5000, async () => {
    pending.push({ t: await $.clock.now(), seed: seed++, err: true })
    flushSoon($)
  })
  $.clock.after(7000, () => void event($, (ev, now) => ({ ...ev, fogUntil: now + 8000 }), 8000 + 4200))
  $.clock.after(22000, () => void event($, ev => ({ ...ev, kites: ev.kites.filter(k => !ids.includes(k.id)) })))
  return 'Demo: three kites go up for subagents, a firework for a commit, a red strike for a failed tool call, then fog rolls through for a compaction. About 22 seconds.'
}

export const register: Register = (on, options: PluginOptions) => {
  place = typeof options.place === 'string' ? options.place.trim() : ''

  // every slash command you run strikes lightning, like a tool call does
  on('command.run', async ($, e, next) => {
    pending.push({ t: await $.clock.now(), seed: seed++ })
    flushSoon($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.theme.set(LOOK)
    await $.command.register({ name: 'weather-place', description: 'Set the town whose real weather the sky follows, or "off"', argumentHint: 'town | off' })
    await $.command.register({ name: 'weather-sky', description: 'Preview a sky: clear, partly, overcast, rain, snow, fog, thunder, or auto', argumentHint: CONDS.join(' | ') + ' | auto' })
    await $.command.register({ name: 'weather-season', description: 'Preview a season: spring, summer, autumn, winter, snow, or auto', argumentHint: SEASONS.join(' | ') + ' | auto' })
    await $.command.register({ name: 'weather-now', description: 'Say what the background is showing and why' })
    await $.command.register({ name: 'weather-holiday', description: 'Preview a holiday: halloween, christmas, newyear, july4, none, or auto', argumentHint: 'halloween | christmas | newyear | july4 | none | auto' })
    await $.command.register({ name: 'weather-era', description: 'Preview an era: stone, village, industrial, modern, scifi, or auto', argumentHint: 'stone | village | industrial | modern | scifi | auto' })
    await $.command.register({ name: 'weather-demo', description: 'Show the session events: kites, a firework, a red strike, fog' })
    await $.command.register({ name: 'weather-tour', description: 'A slideshow of the seasons and skies, about 40 seconds' })
    await $.tool.register({
      name: 'weather_preview',
      description: 'Shows the thinking-weather background with a given sky and/or season, as a preview. Pass "auto" to return either to the real weather and calendar.',
      inputSchema: {
        type: 'object',
        properties: {
          sky: { type: 'string', enum: [...CONDS, 'auto'] },
          season: { type: 'string', enum: [...SEASONS, 'auto'] },
          holiday: { type: 'string', enum: [...HOLIDAYS, 'none', 'auto'] },
          era: { type: 'string', enum: [...ERA_ORDER, 'auto'] },
          hour: { type: 'number', description: 'Show this hour of the day (0-24); omit to follow the clock' },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'weather_place',
      description: 'Sets the town whose real weather the thinking-weather background follows (sent to Open-Meteo), or "off".',
      inputSchema: { type: 'object', properties: { town: { type: 'string' } }, required: ['town'] },
      isDeferred: false,
    })
    void refreshWeather($)
    $.clock.every(WEATHER_MS, () => void refreshWeather($))
    // a session that resumes partway through starts in the era its context has reached
    void $.session.usage().then(async u => {
      if (u.context.percent === undefined) return
      const level = levelFor(u.context.percent)
      const prev = await read($, eraState)
      if (level !== prev.level) await update($, eraState, () => ({ level, since: 0 }))
    }).catch(() => undefined)
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
    // a subagent at work flies a kite over the town
    const agent = e.agentId
    if (agent !== undefined) {
      await event($, (ev, now) => (ev.kites.some(k => k.id === agent) ? ev : { ...ev, kites: [...ev.kites, { id: agent, since: now }] }))
      return next(e)
    }
    await write($, 'working')
    tickTimer?.cancel()
    tickTimer = $.clock.every(1000, () => void $.clock.now().then(now => update($, tick, () => now)))
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
    const failed = 'isError' in result && result.isError === true
    if (failed) {
      pending.push({ t: await $.clock.now(), seed: seed++, err: true })
      flushSoon($)
    } else if (e.tool === 'Bash' && GIT_SHIP.test(String((e as { command?: unknown }).command ?? ''))) {
      await firework($)
    }
    const s = await read($, sky)
    if (s.mode === 'waiting') await write($, 'working')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agent = e.agentId
    if (agent !== undefined) {
      await event($, ev => ({ ...ev, kites: ev.kites.filter(k => k.id !== agent) }))
      return next(e)
    }
    tickTimer?.cancel()
    tickTimer = undefined
    await write($, 'done')
    const since = (await read($, sky)).modeSince
    $.clock.after(DONE_MS, () => {
      void read($, sky).then(s => (s.mode === 'done' && s.modeSince === since ? write($, 'idle') : undefined))
    })
    return next(e)
  })

  // compacting the conversation rolls fog through the valley; behind it society falls back to the
  // Stone Age, and the fog lifts on the basics
  on('session.compact', async ($, e, next) => {
    await event($, (ev, now) => ({ ...ev, fogUntil: now + COMPACT_FOG_MS }))
    const done = await next(e)
    const now = await $.clock.now()
    await update($, eraState, () => ({ level: 0, since: now }))
    await event($, (ev, t) => ({ ...ev, fogUntil: t + 2000 }), 2000 + 4200)
    return done
  })

  // after each turn the engine measures the session: society reaches the era its context has
  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (percent !== undefined) {
      const level = levelFor(percent)
      const now = await $.clock.now()
      const prev = await read($, eraState)
      if (level !== prev.level) {
        await update($, eraState, () => ({ level, since: now }))
        await write($)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'weather-era' }, async ($, e, next) => {
    const arg = e.args.trim()
    if (arg === '') {
      const st = await read($, eraState)
      return { text: `Society is in the ${ERA_ORDER[st.level]} era${eraOverride ? ` (previewing ${eraOverride})` : ''}. It moves up a step for each fifth of the context, and back to the Stone Age at compaction.` }
    }
    if (arg === 'auto') eraOverride = undefined
    else if ((ERA_ORDER as readonly string[]).includes(arg)) eraOverride = arg as Era
    else return { text: `Eras: ${ERA_ORDER.join(', ')}, or auto.` }
    await write($)
    return { text: eraOverride === undefined ? 'The era follows the context again.' : `Showing the ${eraOverride} era. /weather-era auto follows the context.` }
  })

  on('command.run', { command: 'weather-holiday' }, async ($, e, next) => {
    const arg = e.args.trim()
    if (arg === '') {
      const shown = outsideAt(await $.clock.now(), await read($, report)).holiday
      return { text: `${shown === undefined ? 'No holiday decorations' : `Decorated for ${shown}`}${holidayOverride === undefined ? ', from the calendar' : ' (preview)'}. /weather-holiday <${HOLIDAYS.join(' | ')} | none | auto>` }
    }
    if (arg === 'auto') holidayOverride = undefined
    else if (arg === 'none' || (HOLIDAYS as readonly string[]).includes(arg)) holidayOverride = arg as Holiday | 'none'
    else return { text: `Holidays: ${HOLIDAYS.join(', ')}, none, or auto.` }
    await write($)
    return { text: holidayOverride === undefined ? 'Holidays follow the calendar again.' : `Decorated for ${holidayOverride}. /weather-holiday auto follows the calendar.` }
  })

  on('command.run', { command: 'weather-demo' }, async ($, e, next) => ({ text: await demo($) }))

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

  on('command.run', { command: 'weather-place' }, async ($, e, next) => ({ text: await setPlace($, e.args.trim()) }))

  on('tool.call', { tool: 'mcp__thinking-weather__weather_place' }, async ($, e, next) => {
    const town = String((e as { town?: unknown }).town ?? '').trim()
    return { result: await setPlace($, town) }
  })

  on('command.run', { command: 'weather-sky' }, async ($, e, next) => ({ text: await preview($, e.args.trim(), undefined) }))
  on('command.run', { command: 'weather-season' }, async ($, e, next) => ({ text: await preview($, undefined, e.args.trim()) }))

  on('tool.call', { tool: 'mcp__thinking-weather__weather_preview' }, async ($, e, next) => {
    const args = e as { sky?: unknown; season?: unknown; holiday?: unknown; hour?: unknown; era?: unknown }
    if (args.era !== undefined) eraOverride = args.era === 'auto' ? undefined : (String(args.era) as Era)
    if (args.holiday !== undefined) holidayOverride = args.holiday === 'auto' ? undefined : (String(args.holiday) as Holiday | 'none')
    if (typeof args.hour === 'number' && args.hour >= 0 && args.hour < 24) hourOverride = args.hour
    return { result: await preview($, args.sky === undefined ? undefined : String(args.sky), args.season === undefined ? undefined : String(args.season)) }
  })

  on('command.run', { command: 'weather-tour' }, async ($, e, next) => ({ text: await startTour($) }))

  on('command.run', { command: 'weather-now' }, async ($, e, next) => {
    const r = await read($, report)
    const o = outsideAt(await $.clock.now(), r)
    const where = place === '' ? 'No place set (/weather-place <town>).' : r === null ? `Place: ${place}, no report yet.` : `${r.name}: ${r.cond}, ${Math.round(r.tempC)}°C, checked ${new Date(r.at).toLocaleTimeString()}.`
    const shown = `Showing ${o.cond}, ${o.snowCover ? 'snow on the ground' : o.season}${skyOverride || seasonOverride ? ' (preview; "auto" returns to the real one)' : ''}.`
    return { text: `${where} ${shown}` }
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

  // The working row on desktop: a pixel storm cloud doing what the turn does, the step's words,
  // and the time the turn has run. Other surfaces keep their own line.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const ticked = await read($, tick)
    const s = await read($, sky)
    const now = Math.max(ticked, s.at)
    const secs = s.stormSince > 0 ? Math.max(0, Math.round((now - s.stormSince) / 1000)) : 0
    const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
    const words = (e.props.message ?? e.props.word) + e.props.suffix
    const { Box, Svg, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Svg source={spinnerSvg(e.props.mode, Date.now())} alt={`A little storm cloud, ${e.props.mode}`} width={ICON_PX.width} height={ICON_PX.height} isInteractive />
        <Text>{words}</Text>
        <Text dimColor>{elapsed}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'thinking-weather') return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const stored = await read($, sky)
    // while a day cycle or a tour plays, show clear weather so the sky can be seen
    const s: Sky = cycle !== undefined || tour !== undefined ? { ...stored, mode: 'idle', strikes: [] } : stored
    const { Svg } = $.ui.resolve(e)
    const r = await read($, report)
    // the report's age and the season are judged on the engine's clock, as the state was written
    const outside = outsideAt(stored.at > 0 ? stored.at : Date.now(), r, await read($, eraState))
    // on the real clock, dawn and dusk land at the place's real sunrise and sunset
    // (not `h`: that name is the JSX factory)
    const clockHour = hourAt(Date.now())
    const previewing = cycle !== undefined || tour !== undefined || hourOverride !== undefined
    const shownHour = previewing ? clockHour : solarHour(clockHour, r?.sunrise, r?.sunset)
    const ev = await read($, events)
    return <Svg source={scene(s, Date.now(), shownHour, outside, ev)} alt="A pixel-art sky over fields that turns stormy while Claude works" isInteractive />
  })
}
