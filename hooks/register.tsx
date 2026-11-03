import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, TextProps, Timer } from 'claude-code'

import type { App, Disk, Gpu, Usage } from '../types'
import {
  DF_ARGV,
  FIND_NVIDIA,
  GPU_ARGV,
  PROC_SCRIPT,
  apps,
  cpuPercent,
  parseDisks,
  parseGpus,
  parseProc,
  pushHistory,
  topBy,
  type ProcSample,
} from './sample'

const PANE = 'system-monitor'
const TITLE = 'System'
const EVERY_MS = 2000
// df is slow to change; read it every 15 ticks (30 s).
const DISK_EVERY = 15
const HISTORY = 120
const TOP = 5
const LABEL = 6

// Change the tag when Usage's fields change: it declines what an earlier
// version stored, which outlives a reload.
const usage = atom({ plugin: 'system-monitor', key: 'usage' } as const, null, {
  shape: 'usage-1',
})

// Module variables start over on a reload; that costs one CPU delta.
let timer: Timer | undefined
let isBusy = false
let tick = 0
let last: ProcSample | undefined
let disks: Disk[] = []
let gpuDirs: string[] | undefined
let hasNvidiaSmi = true
let pageSize = 4096
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
    const [proc, gpus, df] = await Promise.all([
      $.process.run(['sh', '-c', PROC_SCRIPT]),
      readGpus($),
      tick % DISK_EVERY === 0 ? $.process.run(DF_ARGV) : undefined,
    ])
    tick++
    if (df) disks = parseDisks(df.stdout)
    const now = parseProc(proc.stdout)
    const prev = last
    last = now
    const list = apps(prev, now, pageSize)
    const cpu = prev ? cpuPercent(prev, now) : undefined
    const memPercent = (now.memory.usedBytes / now.memory.totalBytes) * 100
    const gpuPercent = Array.isArray(gpus) && gpus[0] ? gpus[0].percent : 0
    const at = await $.clock.now()
    await update($, usage, old => ({
      at,
      cpu: cpu === undefined ? null : { percent: cpu, threads: now.threads, load1: now.load1 },
      memory: now.memory,
      gpus,
      disks,
      topCpu: prev ? topBy(list, 'cpuPercent', TOP) : [],
      topMemory: topBy(list, 'rssBytes', TOP),
      history: {
        cpu: cpu === undefined ? (old?.history.cpu ?? []) : pushHistory(old?.history.cpu, cpu, HISTORY),
        memory: pushHistory(old?.history.memory, memPercent, HISTORY),
        gpu: pushHistory(old?.history.gpu, gpuPercent, HISTORY),
      },
    }))
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


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sysmon',
      description: 'Show or hide the detailed system monitor pane (history, top 5 apps)',
    })
    const size = await $.process.run(['getconf', 'PAGESIZE']).catch(() => undefined)
    pageSize = Number(size?.stdout.trim()) || 4096
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

  // Two compact rows above the prompt: the meters, then disks and top apps.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, usage)
    if (e.props.hasSurvey || !data) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const { gpus } = data
    const meters: [string, number | undefined][] = [
      ['CPU', data.cpu?.percent],
      ['RAM', memoryPercent(data.memory)],
      ...(gpus === 'asleep'
        ? []
        : gpus.map((gpu, i): [string, number] => [gpus.length > 1 ? `GPU${i}` : 'GPU', gpu.percent])),
    ]
    // Each meter is `CPU ████░░  42%`, two spaces apart; bars share what is left.
    const fixed = meters.reduce((sum, [label]) => sum + label.length + 6, 0) + 2 * (meters.length - 1)
    const room = Math.floor((e.props.bodyColumns - fixed) / meters.length)
    const cells = room >= 4 ? Math.min(12, room) : 0
    const disks = data.disks.map((disk, i) => {
      const percent = (disk.usedBytes / disk.totalBytes) * 100

      return [
        i > 0 ? '  ' : '',
        <Text dimColor>{disk.mount} </Text>,
        <Text color={tone(percent)}>{Math.round(percent)}%</Text>,
      ]
    })
    const top = (list: App[], value: (app: App) => string) =>
      list.map(app => `${app.name}${app.count > 1 ? `×${app.count}` : ''} ${value(app)}`).join(', ')

    return (
      <Box flexDirection="column">
        <Text mono wrap="truncate-end">
          {meters.map(([label, percent], i) => [
            i > 0 ? '  ' : '',
            <Text bold>{label} </Text>,
            percent === undefined
              ? <Text dimColor>{'…'.padStart(cells + 5)}</Text>
              : [...bar(Text, percent, cells), `${Math.round(percent)}%`.padStart(5)],
          ])}
          {gpus === 'asleep' && <Text dimColor>  GPU asleep</Text>}
        </Text>
        <Text mono wrap="truncate-end">
          {disks}
          {data.topMemory.length > 0 && (
            <Text dimColor>{`${disks.length > 0 ? ' · ' : ''}RAM ${top(data.topMemory.slice(0, 2), app => gib(app.rssBytes) + 'G')}`}</Text>
          )}
          {data.topCpu.length > 0 && (
            <Text dimColor>{` · CPU ${top(data.topCpu.slice(0, 2), app => app.cpuPercent.toFixed(1) + '%')}`}</Text>
          )}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, usage)
    if (!data) return <Text dimColor>Reading system usage…</Text>

    const width = Math.max(28, e.props.bodyColumns)
    const indent = ' '.repeat(LABEL)

    const meter = (label: string, percent: number, labelWidth = LABEL) => {
      const cells = width - labelWidth - 5

      return (
        <Text mono>
          <Text bold>{fit(label, labelWidth - 1).padEnd(labelWidth)}</Text>
          {bar(Text, percent, cells)}
          {`${Math.round(percent)}%`.padStart(5)}
        </Text>
      )
    }
    const detail = (text: string, labelWidth = LABEL) => (
      <Text mono dimColor>{' '.repeat(labelWidth) + fit(text, width - labelWidth)}</Text>
    )
    const spark = (history: number[]) => (
      <Text mono color="subtle">{indent + sparkline(history, width - LABEL)}</Text>
    )
    const appRow = (app: App, value: string) => {
      const count = app.count > 1 ? ` ×${app.count}` : ''
      const name = fit(app.name, width - 2 - count.length - 1 - value.length)
      const gap = width - 2 - name.length - count.length - value.length

      return (
        <Text mono>
          {'  ' + name}
          <Text dimColor>{count}</Text>
          {' '.repeat(Math.max(1, gap)) + value}
        </Text>
      )
    }

    const { cpu, memory, gpus } = data
    // Mount points get as wide a label as they need, up to a third of the pane.
    const diskLabel = Math.min(
      Math.floor(width / 3),
      Math.max(LABEL, ...data.disks.map(disk => disk.mount.length + 1)),
    )

    const body = (
      <Box position="relative" flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {cpu ? meter('CPU', cpu.percent) : <Text mono bold>CPU   <Text dimColor>measuring…</Text></Text>}
          {spark(data.history.cpu)}
          {cpu && detail(`${cpu.threads} threads · load ${cpu.load1.toFixed(2)}`)}
        </Box>
        <Box flexDirection="column">
          {meter('RAM', memoryPercent(memory))}
          {spark(data.history.memory)}
          {detail(
            `${gib(memory.usedBytes)} / ${gib(memory.totalBytes)} GiB` +
              (memory.swapTotalBytes > 0 ? ` · swap ${gib(memory.swapUsedBytes)} GiB` : ''),
          )}
        </Box>
        {gpus === 'asleep' && (
          <Text mono bold>GPU   <Text dimColor>asleep (not polled, to let it stay off)</Text></Text>
        )}
        {gpus !== 'asleep' &&
          gpus.map((gpu, i) => (
            <Box flexDirection="column">
              {meter(gpus.length > 1 ? `GPU${i}` : 'GPU', gpu.percent)}
              {i === 0 && spark(data.history.gpu)}
              {detail(`VRAM ${gib(gpu.memUsedBytes)} / ${gib(gpu.memTotalBytes)} GiB · ${gpu.tempC}°C`)}
              {detail(gpu.name)}
            </Box>
          ))}
        {data.disks.length > 0 && (
          <Box flexDirection="column">
            <Text mono bold>DISK</Text>
            {data.disks.map(disk => (
              <Box flexDirection="column">
                {meter(disk.mount, (disk.usedBytes / disk.totalBytes) * 100, diskLabel)}
                {detail(
                  `${gib(disk.totalBytes - disk.usedBytes, 0)} GiB free of ${gib(disk.totalBytes, 0)}`,
                  diskLabel,
                )}
              </Box>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <Text mono bold>TOP CPU <Text dimColor>(% of all cores)</Text></Text>
          {data.topCpu.length === 0 && detail('measuring…')}
          {data.topCpu.map(app => appRow(app, `${app.cpuPercent.toFixed(1)}%`))}
        </Box>
        <Box flexDirection="column">
          <Text mono bold>TOP MEMORY</Text>
          {data.topMemory.map(app => appRow(app, `${gib(app.rssBytes)} GiB`))}
        </Box>
        <Text mono dimColor>updated {clock(data.at)} · every {EVERY_MS / 1000}s</Text>
      </Box>
    )
    // The terminal has no Svg; elsewhere an animated backdrop sits behind the rows.
    if (e.surface === 'terminal') return body
    const { Svg } = $.ui.resolve(e)

    return (
      <Box minHeight={e.props.scroll.bodyRows}>
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          <Svg source={backdrop(load(data))} alt="Background tinted and paced by system load" isInteractive />
        </Box>
        {body}
      </Box>
    )
  })
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

/** `████░░░░`: the filled share in the load's tone; nothing when `cells` is 0. */
function bar(Text: ElementConstructor<TextProps>, percent: number, cells: number) {
  const filled = Math.round((clamp(percent) / 100) * cells)

  return [
    <Text color={tone(percent)}>{'█'.repeat(filled)}</Text>,
    <Text dimColor>{'░'.repeat(cells - filled)}</Text>,
  ]
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

function gib(bytes: number, digits = 1) {
  return (bytes / 1024 ** 3).toFixed(digits)
}

const BLOCKS = '▁▂▃▄▅▆▇█'

function sparkline(history: number[], cells: number) {
  return history
    .slice(-cells)
    .map(n => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((clamp(n) / 100) * BLOCKS.length))])
    .join('')
}

function clock(at: number) {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
