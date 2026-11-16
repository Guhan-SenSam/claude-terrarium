import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, TextProps, Timer } from 'claude-code'

import type { Gpu, Usage } from '../types'
import { CELL as PIXEL, ROWS, cellsWide, meterSvg, segmentsFor, type Kind } from './pixel'
import { FIND_NVIDIA, GPU_ARGV, PROC_SCRIPT, cpuPercent, parseGpus, parseProc, type ProcSample } from './sample'

const PANE = 'system-monitor'
const TITLE = 'System'
const EVERY_MS = 2000
// The band's bars stay short; they shrink, then go, when the prompt is narrow.
const BAR = 8
// An Svg left unsized draws in a ~300 px frame, so the backgrounds are sized
// from cells. The desktop's code font is ~7.8 px by ~19 px; these overshoot,
// and the clipping box around each background cuts what is left over.
const CELL_PX = 8.5
const LINE_PX = 20

// Change the tag when Usage's fields change: it declines what an earlier
// version stored, which outlives a reload.
const usage = atom({ plugin: 'system-monitor', key: 'usage' } as const, null, {
  shape: 'usage-2',
})

// Module variables start over on a reload; that costs one CPU delta.
let timer: Timer | undefined
let isBusy = false
let last: ProcSample | undefined
let gpuDirs: string[] | undefined
let hasNvidiaSmi = true
let lastError = ''

async function readGpus($: EngineInterface): Promise<Gpu[] | 'asleep'> {
  if (!hasNvidiaSmi) return []
  if (gpuDirs === undefined) {
    const found = await $.process.run(['sh', '-c', FIND_NVIDIA])
    gpuDirs = found.stdout.split('\n').filter(Boolean)
    hasNvidiaSmi = gpuDirs.length > 0
    if (!hasNvidiaSmi) return []
  }
  // nvidia-smi wakes a runtime-suspended GPU, so leave a sleeping one be.
  const states = await Promise.all(
    gpuDirs.map(dir => $.fs.read(`${dir}/power/runtime_status`).catch(() => 'active')),
  )
  if (states.every(state => state.trim() === 'suspended')) return 'asleep'
  try {
    const { exitCode, stdout } = await $.process.run(GPU_ARGV, { timeoutMs: 5000 })

    return exitCode === 0 ? parseGpus(stdout) : []
  } catch {
    hasNvidiaSmi = false

    return []
  }
}

async function sample($: EngineInterface) {
  if (isBusy) return
  isBusy = true
  try {
    const [proc, gpus] = await Promise.all([$.process.run(['sh', '-c', PROC_SCRIPT]), readGpus($)])
    const now = parseProc(proc.stdout)
    const prev = last
    last = now
    const cpu = prev ? { percent: cpuPercent(prev, now), threads: now.threads, load1: now.load1 } : null
    const at = await $.clock.now()
    await update($, usage, () => ({ at, cpu, memory: now.memory, gpus }))
    lastError = ''
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text !== lastError) $.ui.log(`system-monitor: sample failed: ${text}`)
    lastError = text
  } finally {
    isBusy = false
  }
}

function start($: EngineInterface) {
  if (timer) return
  void sample($)
  timer = $.clock.every(EVERY_MS, () => void sample($))
}

/** One bar: a percentage, `measuring` before the first CPU delta, or a sleeping GPU. */
type Meter = { label: string; percent?: number; isAsleep?: boolean; detail?: string }

function meters(data: Usage): Meter[] {
  const { cpu, memory, gpus } = data
  const gpuMeters: Meter[] =
    gpus === 'asleep'
      ? [{ label: 'GPU', isAsleep: true }]
      : gpus.map((gpu, i) => ({
          label: gpus.length > 1 ? `GPU${i}` : 'GPU',
          percent: gpu.percent,
          detail: `VRAM ${gib(gpu.memUsedBytes)} / ${gib(gpu.memTotalBytes)} GiB · ${gpu.tempC}°C`,
        }))

  return [
    {
      label: 'CPU',
      percent: cpu?.percent,
      detail: cpu ? `${cpu.threads} threads · load ${cpu.load1.toFixed(2)}` : undefined,
    },
    {
      label: 'RAM',
      percent: memoryPercent(memory),
      detail:
        `${gib(memory.usedBytes)} / ${gib(memory.totalBytes)} GiB` +
        (memory.swapTotalBytes > 0 ? ` · swap ${gib(memory.swapUsedBytes)} GiB` : ''),
    },
    ...gpuMeters,
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sysmon',
      description: 'Show or hide the system monitor pane (CPU, RAM, GPU)',
    })
    // The band above the prompt is always up, so sampling always runs.
    start($)

    return next(e)
  })

  on('command.run', { command: 'sysmon' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })

      return { text: 'System monitor closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: opened.isPlaced
        ? 'System monitor opened.'
        : `System monitor is open but not drawn yet (${opened.reason}).`,
    }
  })

  // One row above the prompt: `CPU ████░░░░  42%   RAM …   GPU …`.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, usage)
    if (e.props.hasSurvey || !data) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const list = meters(data)
    const label = labelWidth(list)
    const room = Math.floor((e.props.bodyColumns - 3 * (list.length - 1)) / list.length) - label - 5
    const cells = room >= 4 ? Math.min(BAR, room) : 0
    // The terminal has no Svg: there each bar is text, `CPU ████░░░░  42%`.
    if (e.surface === 'terminal') {
      return (
        <Box columnGap={3}>
          {list.map(meter => (
            <Text mono wrap="truncate-end">
              {meterRow(Text, meter, label, cells)}
            </Text>
          ))}
        </Box>
      )
    }
    // Elsewhere each meter is a pixel-art icon and bar in the weather scene's palette, then its
    // reading as text. Bars shrink, then go, when the prompt is narrow; the icons stay.
    const { Svg } = $.ui.resolve(e)
    const perMeterPx = (e.props.bodyColumns * CELL_PX - 3 * CELL_PX * (list.length - 1)) / list.length - 6 * CELL_PX
    const segments = segmentsFor(perMeterPx)

    return (
      <Box columnGap={3}>
        {list.map(meter => {
          const reading = meter.isAsleep ? 'asleep' : meter.percent === undefined ? '…' : `${Math.round(meter.percent)}%`

          return (
            <Box columnGap={1} alignItems="center">
              <Svg
                source={meterSvg(kindOf(meter.label), meter.percent, segments, meter.isAsleep)}
                alt={`${meter.label} ${reading}`}
                width={cellsWide(segments) * PIXEL}
                height={ROWS * PIXEL}
              />
              <Text mono dimColor={meter.isAsleep || meter.percent === undefined}>
                {reading.padStart(4)}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  // The same bars, full width, with a detail line each.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, usage)
    if (!data) return <Text dimColor>Reading system usage…</Text>

    const width = Math.max(24, e.props.bodyColumns)
    const list = meters(data)
    const label = labelWidth(list)
    const body = (
      <Box position="relative" flexDirection="column" gap={1}>
        {list.map(meter => (
          <Box flexDirection="column">
            <Text mono>{meterRow(Text, meter, label, width - label - 5)}</Text>
            {meter.detail && <Text mono dimColor>{' '.repeat(label) + fit(meter.detail, width - label)}</Text>}
          </Box>
        ))}
        <Text mono dimColor>updated {clock(data.at)} · every {EVERY_MS / 1000}s</Text>
      </Box>
    )
    // The terminal has no Svg; elsewhere an animated backdrop sits behind the rows.
    if (e.surface === 'terminal') return body
    const { Svg } = $.ui.resolve(e)

    return (
      <Box minHeight={e.props.scroll.bodyRows}>
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          <Svg
            source={backdrop(load(data))}
            alt="Background tinted and paced by system load"
            width={Math.ceil(width * CELL_PX)}
            height={e.props.scroll.bodyRows * LINE_PX}
            isInteractive
          />
        </Box>
        {body}
      </Box>
    )
  })
}

function kindOf(label: string): Kind {
  return label.startsWith('GPU') ? 'gpu' : label === 'RAM' ? 'ram' : 'cpu'
}

/** Labels padded to the longest, plus a space. */
function labelWidth(list: Meter[]) {
  return Math.max(...list.map(meter => meter.label.length)) + 1
}

/** `CPU ████░░░░  42%`; `cells` 0 leaves the bar out. */
function meterRow(Text: ElementConstructor<TextProps>, meter: Meter, label: number, cells: number) {
  const name = <Text bold>{meter.label.padEnd(label)}</Text>
  if (meter.isAsleep) return [name, <Text dimColor>asleep</Text>]
  if (meter.percent === undefined) return [name, <Text dimColor>{'…'.padStart(cells + 5)}</Text>]
  const filled = Math.round((clamp(meter.percent) / 100) * cells)

  return [
    name,
    <Text color={tone(meter.percent)}>{'█'.repeat(filled)}</Text>,
    <Text dimColor>{'░'.repeat(cells - filled)}</Text>,
    `${Math.round(meter.percent)}%`.padStart(5),
  ]
}

type Load = 'calm' | 'busy' | 'hot'

/** The busiest of CPU, RAM and GPU, in three steps so the backdrop rarely restarts. */
function load(data: Usage): Load {
  const gpu = Array.isArray(data.gpus) ? Math.max(0, ...data.gpus.map(g => g.percent)) : 0
  const peak = Math.max(data.cpu?.percent ?? 0, memoryPercent(data.memory), gpu)

  return peak >= 90 ? 'hot' : peak >= 70 ? 'busy' : 'calm'
}

const BACKDROP: Record<Load, { colors: [string, string, string]; seconds: number }> = {
  calm: { colors: ['#2dd4bf', '#22c55e', '#3b82f6'], seconds: 28 },
  busy: { colors: ['#f59e0b', '#eab308', '#f97316'], seconds: 14 },
  hot: { colors: ['#ef4444', '#f97316', '#dc2626'], seconds: 7 },
}

/** Three soft blobs drifting under a blur; tall, so the pane clips it rather than gaps. */
function backdrop(level: Load) {
  const { colors, seconds } = BACKDROP[level]
  const blob = (color: string, i: number) => {
    const xs = ['15;85;15', '80;20;80', '50;10;50'][i]
    const ys = ['30;220;30', '260;60;260', '150;290;150'][i]
    const dur = seconds * (1 + i * 0.37)

    return `<circle r="42" fill="${color}"><animate attributeName="cx" values="${xs}" dur="${dur.toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="cy" values="${ys}" dur="${(dur * 1.3).toFixed(1)}s" repeatCount="indefinite"/></circle>`
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 300" width="100" height="300" preserveAspectRatio="xMidYMid slice">' +
    '<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs>' +
    `<g filter="url(#soft)" opacity="0.16">${colors.map(blob).join('')}</g>` +
    '</svg>'
  )
}

function memoryPercent(memory: Usage['memory']) {
  return (memory.usedBytes / memory.totalBytes) * 100
}

function clamp(percent: number) {
  return Math.min(100, Math.max(0, percent))
}

function tone(percent: number) {
  return percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'
}

function fit(text: string, room: number) {
  return text.length <= room ? text : text.slice(0, Math.max(0, room - 1)) + '…'
}

function gib(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1)
}

function clock(at: number) {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
