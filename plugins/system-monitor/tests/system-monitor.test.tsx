import { expect, mock, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import * as pixel from '../hooks/pixel'

const PANE = {
  plugin: 'system-monitor',
  component: 'Pane',
  requestId: 'system-monitor',
  props: {
    title: 'System',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'system-monitor',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const procOutput = (cpu: string) =>
  [
    `cpu  ${cpu}\ncpu0 0 0 0 0 0 0 0 0 0 0\ncpu1 0 0 0 0 0 0 0 0 0 0`,
    'MemTotal:       16777216 kB\nMemAvailable:    4194304 kB\nSwapTotal:       8388608 kB\nSwapFree:        6291456 kB',
    '1.50 1.00 0.50 1/100 123',
  ].join('\n@@\n')

// Between the two samples 1500 jiffies pass, 700 of them idle: 53% busy.
const SAMPLES = [procOutput('1000 0 500 8000 500 0 0 0 0 0'), procOutput('1600 0 700 8600 600 0 0 0 0 0')]

/** Stands for the host: the commands and files the mod reads. */
function machine(on: On, gpuState: string) {
  const ran: string[] = []
  let procCalls = 0
  const result = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_, e) => {
    const [cmd, , script] = e.argv
    ran.push(cmd ?? '')
    if (cmd === 'nvidia-smi') return result('NVIDIA GeForce RTX 3050 6GB Laptop GPU, 37, 1678, 6144, 48\n')
    if (script?.includes('/sys/bus/pci')) return result('/sys/bus/pci/devices/0000:01:00.0\n')

    return result(SAMPLES[Math.min(procCalls++, SAMPLES.length - 1)]!)
  })
  on('fs.read', () => ({ value: `${gpuState}\n` }))
  on('command.register', () => ({ value: { command: 'sysmon' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return ran
}

async function started($: Parameters<TestBody>[0], on: On, gpuState = 'active') {
  // local noon, so the band is in its day colours
  const clock = mock.clock(on, { now: new Date(2023, 10, 14, 12).getTime() })
  const ran = machine(on, gpuState)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  return ran
}

test('in the terminal the band is one row of short text bars', async ($, on) => {
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // One Text per bar; its label is a Text of its own inside it.
  const bar = async (label: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${label} .*%$`) }))?.text

  expect(await bar('CPU')).toBe('CPU ████░░░░  53%')
  expect(await bar('RAM')).toBe('RAM ██████░░  75%')
  expect(await bar('GPU')).toBe('GPU ███░░░░░  37%')
  expect(await ui.find({ type: 'Text', text: /chrome|TOP|\/mnt/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('on desktop each meter is a pixel-art icon and bar, then its reading', async ($, on) => {
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map(svg => svg.props.alt)).toEqual(['CPU 53%', 'RAM 75%', 'GPU 37%'])
  const sources = svgs.map(svg => String(svg.props.source))
  // the weather palette: meadow green under 70%, wheat gold from 70%
  expect(sources[0]).toContain('#5e9653')
  expect(sources[1]).toContain('#c9a94a')
  expect(sources[2]).toContain('#5e9653')
  // the glow round the lit segments is brighter the higher the reading
  const glow = (source: string) => Number(/stroke-opacity="([\d.]+)"/.exec(source)?.[1])
  expect(glow(sources[1]!)).toBeGreaterThan(glow(sources[0]!))
  expect(glow(sources[0]!)).toBeGreaterThan(glow(sources[2]!))
  // still pictures, sized past the ~300 px frame an unsized Svg gets
  for (const source of sources) expect(source).not.toContain('<animate')
  for (const svg of svgs) expect(svg.props.width).toBeGreaterThanOrEqual(20)
  for (const reading of ['53%', '75%', '37%']) expect((await ui.find({ type: 'Text', text: new RegExp(reading) }))?.text).toContain(reading)
  await ui.unmount()
})

test('a narrow band drops the bars and keeps the icons and numbers', async ($, on) => {
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 36 } })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(3)
  for (const svg of svgs) expect(String(svg.props.source)).not.toContain('#151d2e')
  expect((await ui.find({ type: 'Text', text: /53%/ }))?.text).toContain('53%')
  await ui.unmount()
})

test('the pane shows each bar with a detail line, on every surface', async ($, on) => {
  await started($, on)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/^CPU/)).toMatch(/53%$/)
    expect(await text(/2 threads · load 1\.50/)).toBeTruthy()
    expect(await text(/^RAM/)).toMatch(/75%$/)
    expect(await text(/12\.0 \/ 16\.0 GiB · swap 2\.0 GiB/)).toBeTruthy()
    expect(await text(/^GPU/)).toMatch(/37%$/)
    expect(await text(/VRAM 1\.6 \/ 6\.0 GiB · 48°C/)).toBeTruthy()
    for (const row of await ui.findAll({ type: 'Text' })) {
      for (const line of row.text.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
    }
    // The animated backdrop is drawn wherever the surface has Svg; RAM at
    // 75% makes the machine busy, the amber palette.
    const backdrop = await ui.find({ type: 'Svg' })
    expect(backdrop === undefined).toBe(surface === 'terminal')
    if (backdrop) expect(String(backdrop.props.source)).toContain('#f59e0b')
    // Sized to the whole pane, not the frame's default.
    if (backdrop) expect(backdrop.props.width).toBeGreaterThanOrEqual(40 * 8)
    if (backdrop) expect(backdrop.props.height).toBeGreaterThanOrEqual(40 * 18)
    await ui.unmount()
  }
})

test('a suspended GPU is left asleep, not woken by nvidia-smi', async ($, on) => {
  const ran = await started($, on, 'suspended')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // A sleeping GPU is its icon dimmed, with no reading and so no glow.
  const gpu = (await ui.findAll({ type: 'Svg' }))[2]
  expect(gpu?.props.alt).toBe('GPU asleep')
  expect(String(gpu?.props.source)).toContain('opacity=".45"')
  expect(String(gpu?.props.source)).not.toContain('stroke-opacity')
  expect((await ui.find({ type: 'Text', text: /asleep/ }))?.text).toContain('asleep')
  expect(ran).not.toContain('nvidia-smi')
  await ui.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /^GPU/ }))?.text).toBe('GPU asleep')
  await terminal.unmount()
})

test('the band yields to a survey', async ($, on) => {
  // Stands for the engine's own survey; hooks beneath come before any $ call.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the band is lit for the hour: the same by day, dimmer with a lantern glow at night', async () => {
  const { meterSvg, timeOfDay } = pixel
  expect(timeOfDay(12)).toEqual({ night: 0, warm: 0 })
  expect(timeOfDay(23).night).toBe(1)
  expect(timeOfDay(18.6).warm).toBeGreaterThan(0.9)

  const day = meterSvg('cpu', 53, 12, false, timeOfDay(12))
  const night = meterSvg('cpu', 53, 12, false, timeOfDay(23))
  expect(day).toBe(meterSvg('cpu', 53, 12))
  expect(night).not.toBe(day)
  // the meadow-green glow turns lantern amber after dark
  const glow = (svg: string) => /class="glow" stroke="(#[0-9a-f]{6})"/.exec(svg)?.[1]
  expect(glow(day)).toBe('#8cc36b')
  expect(glow(night)).not.toBe('#8cc36b')
})
