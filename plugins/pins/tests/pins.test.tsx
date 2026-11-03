import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Pin } from '../types'

const REPLY = 'Plan:\n\n1. Bump the version\n2. Tag the release'

const message = (text: string) =>
  ({ plugin: 'pins', component: 'AssistantMessage', requestId: 'row-1', props: { text, isFirstOfReply: true } }) as const

const PANE = {
  plugin: 'pins',
  component: 'Pane',
  requestId: 'pins',
  props: {
    title: 'Pinned',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** Stands for the engine beneath the mod; returns the panes it was asked to open. */
function engine(on: On) {
  const opened: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  mock.store(on)
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'the reply as the engine draws it' }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'what next?', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))

  return opened
}

test('Pin on a desktop reply pins it, opens the pane, and Unpin there takes it off', async ($, on) => {
  const opened = engine(on)

  const row = await $.ui.mount({ ...message(REPLY), surface: 'desktop' })
  expect((await row.find({ type: 'Button', key: 'pin' }))?.props.label).toBe('Pin')

  await row.press({ key: 'pin' })
  expect(opened).toEqual(['pins'])
  expect((await row.find({ type: 'Button', key: 'pin' }))?.props.label).toBe('Unpin')

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe(REPLY)
  await pane.press({ key: 'unpin-row-1' })
  expect((await pane.find({ type: 'Text' }))?.text).toMatch(/^Nothing pinned yet/)
  expect((await row.find({ type: 'Button', key: 'pin' }))?.props.label).toBe('Pin')
  await pane.unmount()
  await row.unmount()
})

test('the terminal and the phone draw no Pin button', async ($, on) => {
  engine(on)

  for (const surface of ['terminal', 'mobile'] as const) {
    const row = await $.ui.mount({ ...message(REPLY), surface })
    expect(await row.find({ type: 'Button' })).toBeUndefined()
    await row.unmount()
  }
})

test('/pin pins the last reply, and the pane shows it on the phone', async ($, on) => {
  const opened = engine(on)

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const ran = await $.command.run({
    command: 'pin',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: 'Pinned the last reply.' })
  expect(opened).toEqual(['pins'])

  const pane = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe(REPLY)
  await pane.unmount()

  // The desktop row it came from shows as pinned.
  const row = await $.ui.mount({ ...message(REPLY), surface: 'desktop' })
  expect((await row.find({ type: 'Button', key: 'pin' }))?.props.label).toBe('Unpin')
  await row.unmount()
})

test('pins come back when the session restarts', async ($, on) => {
  const kept: Pin = { id: 'old', key: 'Kept from before.', text: 'Kept from before.', at: 1 }
  mock.store(on, { 'pins:s1': { at: 1, pins: [kept] } })
  mock.clock(on, { now: 10 })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('Kept from before.')
  await pane.unmount()
})

test("a pin is saved under the session's id", async ($, on) => {
  const saved: { key: string; value: unknown }[] = []
  mock.clock(on, { now: 10 })
  on('store.get', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('store.set', (_, e) => {
    saved.push(e)

    return { value: undefined }
  })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const row = await $.ui.mount({ ...message(REPLY), surface: 'desktop' })
  await row.press({ key: 'pin' })
  await row.unmount()

  expect(saved.at(-1)).toMatchObject({ key: 'pins:s1', value: { at: 10, pins: [{ id: 'row-1', text: REPLY }] } })
})
