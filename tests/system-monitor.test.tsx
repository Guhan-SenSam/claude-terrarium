import { expect, mock, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

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
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const ran = machine(on, gpuState)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  return ran
}

test('the band is one row of short CPU, RAM and GPU bars', async ($, on) => {
  await started($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // The whole row; its labels are Texts of their own inside it.
    const row = await ui.find({ type: 'Text', text: /^CPU .*RAM/ })

    expect(row?.text).toBe('CPU ████░░░░  53%   RAM ██████░░  75%   GPU ███░░░░░  37%')
    expect(await ui.find({ type: 'Text', text: /chrome|TOP|\/mnt/ })).toBeUndefined()
    // A scanner beam in the load's colours glides behind the row wherever there is Svg.
    const glow = await ui.find({ type: 'Svg' })
    expect(glow === undefined).toBe(surface === 'terminal')
    if (glow) expect(String(glow.props.source)).toMatch(/#f59e0b.*<animate attributeName="x"/)
    // Sized to the whole band: unsized, the desktop's frame stops ~300 px in.
    if (glow) expect(glow.props.width).toBeGreaterThanOrEqual(80 * 8)
    await ui.unmount()
  }
})

test('a narrow band drops the bars and keeps the numbers', async ($, on) => {
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 36 } })
  expect((await ui.find({ type: 'Text', text: /^CPU/ }))?.text).toBe('CPU   53%   RAM   75%   GPU   37%')
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
  expect((await ui.find({ type: 'Text', text: /^CPU/ }))?.text).toMatch(/GPU asleep$/)
  expect(ran).not.toContain('nvidia-smi')
  await ui.unmount()
})

test('the band yields to a survey', async ($, on) => {
  // Stands for the engine's own survey; hooks beneath come before any $ call.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  await started($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
