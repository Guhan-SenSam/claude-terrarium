import { expect, mock, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Receipt } from '../types'

type Engine = Parameters<TestBody>[0]

const ANSWER = 'All done.\n\nThe fix is in `src/a.ts`.'

const message = (text: string) =>
  ({ plugin: 'turn-receipt', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

const usage = (output: number) => ({
  input_tokens: 10,
  output_tokens: output,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  model: 'claude-opus-5-5',
})

/** Stands for the engine beneath the mod: tools run, turns start and end, rows draw. */
function engine(on: On) {
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'the reply as the engine draws it' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

async function edit($: Engine, file_path: string, agentId?: string) {
  await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId })
}

async function receiptOn($: Engine, surface: 'terminal' | 'desktop' | 'mobile', text: string) {
  const ui = await $.ui.mount({ ...message(text), surface })
  const found = await ui.find({ type: 'Text', text: /tool call|after|tokens out/ })
  await ui.unmount()

  return found?.text
}

test('a finished turn leaves a receipt under its reply, on every surface', async ($, on) => {
  engine(on)

  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/c.ts' })
  await edit($, '/repo/src/a.ts')
  await edit($, '/repo/src/a.ts')
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/b.ts', content: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'look around' })
  await $.turn.complete({
    answer: ANSWER,
    durationMs: 252_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: usage(3200),
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    expect(await receiptOn($, surface, ANSWER)).toBe(
      '4m 12s · 5 tool calls · 1 agent · edited a.ts, b.ts · 3.2k tokens out',
    )
  }
  // Another reply has none.
  expect(await receiptOn($, 'desktop', 'Something said earlier.')).toBeUndefined()
})

test("a subagent's turns count toward the main turn, with no receipt of their own", async ($, on) => {
  engine(on)

  await $.turn.start({ text: 'go', turnId: 'main' })
  await $.turn.start({ text: 'sub task', turnId: 'sub', agentId: 'a1' })
  await edit($, '/repo/one.ts', 'a1')
  await edit($, '/repo/two.ts', 'a1')
  await edit($, '/repo/three.ts', 'a1')
  await $.turn.complete({ answer: 'Subagent report.', durationMs: 5000, isAborted: false, turnId: 'sub', agentId: 'a1', reason: 'answer' })
  await $.turn.complete({ answer: 'Main answer.', durationMs: 65_000, isAborted: false, turnId: 'main', reason: 'answer' })

  expect(await receiptOn($, 'desktop', 'Subagent report.')).toBeUndefined()
  expect(await receiptOn($, 'desktop', 'Main answer.')).toBe('1m 5s · 3 tool calls · edited one.ts, two.ts +1')
})

test('an interrupted turn says so', async ($, on) => {
  engine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts' })
  await $.turn.complete({ answer: 'Partial.', durationMs: 3000, isAborted: true, turnId: 't1', reason: 'aborted' })

  expect(await receiptOn($, 'desktop', 'Partial.')).toBe('interrupted after 3s · 1 tool call')
})

test('receipts come back when the session restarts', async ($, on) => {
  const saved: Receipt = { key: 'Kept from before.', durationMs: 9000, tools: 2, agents: 0, files: [], reason: 'answer' }
  mock.store(on, { 'receipts:s1': { at: 1, receipts: [saved] } })
  mock.clock(on, { now: 10 })
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(await receiptOn($, 'desktop', 'Kept from before.')).toBe('9s · 2 tool calls')
})

test("a receipt is saved under the session's id", async ($, on) => {
  const saved: { key: string; value: unknown }[] = []
  mock.clock(on, { now: 10 })
  on('store.get', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('store.set', (_, e) => {
    saved.push(e)

    return { value: undefined }
  })
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: 'Saved one.', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(saved.at(-1)).toMatchObject({ key: 'receipts:s1', value: { at: 10, receipts: [{ key: 'Saved one.' }] } })
})
