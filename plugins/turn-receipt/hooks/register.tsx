import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Receipt, SavedReceipts } from '../types'

// Receipts kept per session, and sessions kept in the store.
const KEEP = 200
const SESSIONS = 30
const STORE_PREFIX = 'receipts:'
// Tools whose input names the file they change, and the field that names it.
const EDITS: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}
const AGENT_TOOLS = new Set(['Agent', 'Task'])

// Change the tag when Receipt's fields change: it declines what an earlier
// version stored, which outlives a reload.
const receipts = atom({ plugin: 'turn-receipt', key: 'receipts' } as const, [], {
  shape: 'receipts-1',
})

// Module variables start over on a reload; a turn running then gets no receipt.
let turn: { tools: number; agents: number; files: string[] } | undefined
let lastText: { uuid: string; key: string } | undefined
let storeKey: string | undefined

/** What a reply is matched by: the last words of its text, whitespace folded. */
export function textKey(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(-160)
}

/** Learns which session this is, and brings back its receipts after a restart. */
async function attach($: EngineInterface, sessionId: string) {
  if (storeKey === STORE_PREFIX + sessionId) return
  storeKey = STORE_PREFIX + sessionId
  const saved = (await $.store.get(storeKey)) as SavedReceipts | undefined
  if (saved?.receipts?.length) await update($, receipts, list => (list.length > 0 ? list : saved.receipts))
  await prune($)
}

async function save($: EngineInterface) {
  if (!storeKey) return
  const saved: SavedReceipts = { at: await $.clock.now(), receipts: await read($, receipts) }
  await $.store.set(storeKey, saved)
}

/** Keeps the store to the last few sessions. */
async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith(STORE_PREFIX))
  if (keys.length <= SESSIONS) return
  const dated = await Promise.all(
    keys.map(async key => ({ key, at: ((await $.store.get(key)) as SavedReceipts | undefined)?.at ?? 0 })),
  )
  const old = dated.sort((a, b) => a.at - b.at).slice(0, keys.length - SESSIONS)
  await Promise.all(old.map(({ key }) => $.store.delete(key)))
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    await attach($, e.session_id)

    return next(e)
  })

  // After a reload the session start has passed; the next prompt names it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await attach($, e.session_id)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) turn = { tools: 0, agents: 0, files: [] }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (turn) {
      const tool = String(e.tool)
      turn.tools++
      if (AGENT_TOOLS.has(tool)) turn.agents++
      const field = EDITS[tool]
      const path = field ? (e as Record<string, unknown>)[field] : undefined
      if (typeof path === 'string' && !turn.files.includes(path)) turn.files.push(path)
    }

    return next(e)
  })

  // The main loop's text rows, so a receipt can name the row it sits under.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'response' && e.agentId === undefined) {
      const text = textOf(e.message.content)
      if (text && 'uuid' in stored && stored.uuid) lastText = { uuid: stored.uuid, key: textKey(text) }
    }

    return stored
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || !turn) return result
    const done = turn
    turn = undefined
    const key = e.answer ? textKey(e.answer) : lastText?.key
    if (!key) return result
    const receipt: Receipt = {
      key,
      uuid: lastText?.key === key ? lastText.uuid : undefined,
      durationMs: e.durationMs,
      tools: done.tools,
      agents: done.agents,
      files: done.files,
      outputTokens: e.usage?.output_tokens,
      reason: e.reason,
    }
    await update($, receipts, list => [...list, receipt].slice(-KEEP))
    await save($)

    return result
  })

  // The receipt goes under the reply's final text block.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.isSummary) return drawn
    const list = await read($, receipts)
    const key = textKey(e.props.text)
    const receipt = list.findLast(r => r.uuid === e.requestId) ?? list.findLast(r => r.key === key)
    if (!receipt) return drawn
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Text dimColor size="caption">
          {describe(receipt)}
        </Text>
      </Box>
    )
  })
}

/** `4m 12s · 23 tool calls · 2 agents · edited a.ts, b.ts +3 · 3.2k tokens out` */
export function describe(receipt: Receipt) {
  const took = duration(receipt.durationMs)
  const lead = {
    answer: took,
    aborted: `interrupted after ${took}`,
    refusal: `refused after ${took}`,
    error: `stopped on an error after ${took}`,
  }[receipt.reason]
  const parts = [lead]
  if (receipt.tools > 0) parts.push(plural(receipt.tools, 'tool call'))
  if (receipt.agents > 0) parts.push(plural(receipt.agents, 'agent'))
  if (receipt.files.length > 0) {
    const names = receipt.files.slice(0, 2).map(path => path.split('/').pop())
    const more = receipt.files.length > 2 ? ` +${receipt.files.length - 2}` : ''
    parts.push(`edited ${names.join(', ')}${more}`)
  }
  if (receipt.outputTokens) parts.push(`${tokens(receipt.outputTokens)} tokens out`)

  return parts.join(' · ')
}

function duration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`

  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function tokens(n: number) {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`
}

/** The text blocks of a stored row, joined. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(block => (block && typeof block === 'object' && 'text' in block ? String(block.text) : ''))
    .join('')
}
