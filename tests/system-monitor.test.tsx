import { expect, mock, test } from 'claude-code/testing'
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

/** A `/proc/<pid>/stat` line: utime is field 14, rss (pages) field 24. */
const proc = (pid: number, name: string, utime: number, rss: number) =>
  `${pid} (${name}) S 1 ${pid} ${pid} 0 -1 0 0 0 0 0 ${utime} 0 0 0 20 0 1 0 100 1000 ${rss}`

const procOutput = (cpu: string, procs: string[]) =>
  [
    `cpu  ${cpu}\ncpu0 0 0 0 0 0 0 0 0 0 0\ncpu1 0 0 0 0 0 0 0 0 0 0`,
    'MemTotal:       16777216 kB\nMemAvailable:    4194304 kB\nSwapTotal:       8388608 kB\nSwapFree:        6291456 kB',
    '1.50 1.00 0.50 1/100 123',
    procs.join('\n'),
  ].join('\n@@\n')

// Between the two samples: 1500 jiffies pass, 700 of them idle (53% busy);
// "big app" uses 600 (40%), the two chrome processes 150 each (20% together).
const SAMPLES = [
  procOutput('1000 0 500 8000 500 0 0 0 0 0', [
    proc(101, 'big app', 1000, 1048576),
    proc(201, 'chrome', 100, 131072),
    proc(202, 'chrome', 100, 131072),
    proc(2, 'kworker/0:1', 50, 0),
  ]),
  procOutput('1600 0 700 8600 600 0 0 0 0 0', [
    proc(101, 'big app', 1600, 1048576),
    proc(201, 'chrome', 250, 131072),
    proc(202, 'chrome', 250, 131072),
    proc(2, 'kworker/0:1', 400, 0),
  ]),
]

const DF = [
  'Filesystem     Mounted on    1B-blocks         Used',
  '/dev/nvme1n1p5 /          292823236608 113056530432',
  '/dev/nvme1n1p5 /home      292823236608 113056530432',
  '/dev/nvme1n1p1 /boot/efi     268435456     52535296',
  '/dev/nvme0n1p3 /mnt/Dev   680965177344 237503307776',
].join('\n')

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
    if (cmd === 'getconf') return result('4096\n')
    if (cmd === 'df') return result(DF)
    if (cmd === 'nvidia-smi') return result('NVIDIA GeForce RTX 3050 6GB Laptop GPU, 37, 1678, 6144, 48\n')
    if (script?.includes('/sys/bus/pci')) return result('/sys/bus/pci/devices/0000:01:00.0\n')

    return result(SAMPLES[Math.min(procCalls++, SAMPLES.length - 1)]!)
  })
  on('fs.read', () => ({ value: `${gpuState}\n` }))
  on('command.register', () => ({ value: { command: 'sysmon' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return ran
}

test('the pane shows usage and the top apps, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  machine(on, 'active')

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/^CPU/)).toMatch(/53%$/)
    expect(await text(/^RAM/)).toMatch(/75%$/)
    expect(await text(/12\.0 \/ 16\.0 GiB · swap 2\.0 GiB/)).toBeTruthy()
    expect(await text(/^GPU/)).toMatch(/37%$/)
    expect(await text(/RTX 3050 6GB Laptop GPU/)).toBeTruthy()
    expect(await text(/^\/mnt\/Dev/)).toMatch(/35%$/)
    expect(await text(/^\/home/)).toBeUndefined()
    expect(await text(/boot/)).toBeUndefined()
    expect(await text(/big app\s+40\.0%$/)).toBeTruthy()
    expect(await text(/chrome ×2\s+20\.0%$/)).toBeTruthy()
    expect(await text(/big app\s+4\.0 GiB$/)).toBeTruthy()
    expect(await text(/kworker/)).toBeUndefined()
    // The animated backdrop is drawn wherever the surface has Svg.
    const backdrop = await ui.find({ type: 'Svg' })
    expect(backdrop === undefined).toBe(surface === 'terminal')
    // RAM at 75% makes the machine busy: the amber palette.
    if (backdrop) expect(String(backdrop.props.source)).toContain('#f59e0b')
    // Every row fits the pane's width.
    for (const row of await ui.findAll({ type: 'Text' })) {
      for (const line of row.text.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
    }
    await ui.unmount()
  }
})

test('a suspended GPU is left asleep, not woken by nvidia-smi', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const ran = machine(on, 'suspended')

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^GPU/ }))?.text).toMatch(/asleep/)
  expect(ran).not.toContain('nvidia-smi')
  await ui.unmount()
})

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

test('the band above the prompt sums it up in two rows', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  machine(on, 'active')

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [80, 40]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns } })
      // Whole rows, not the colored pieces inside them.
      const rows = [
        await ui.find({ type: 'Text', text: /^CPU .*RAM/ }),
        await ui.find({ type: 'Text', text: /^\/ \d+%  / }),
      ]

      expect(rows[0]!.text).toMatch(/^CPU .*53%  RAM .*75%  GPU .*37%$/)
      expect(rows[1]!.text).toMatch(/^\/ 39%  \/mnt\/Dev 35% · RAM big app 4\.0G, chrome×2 1\.0G · CPU big app 40\.0%/)
      // The meters row fits; the second row is cut by the surface (truncate-end).
      expect(rows[0]!.text.length).toBeLessThanOrEqual(bodyColumns)
      expect(rows[0]!.text.includes('█')).toBe(bodyColumns === 80)
      await ui.unmount()
    }
  }
})

test('the band yields to a survey', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  machine(on, 'active')
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
