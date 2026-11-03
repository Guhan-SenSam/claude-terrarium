import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin, SavedPins } from '../types'

const PANE = 'pins'
const TITLE = 'Pinned'
// Pins kept per session, and sessions kept in the store.
const KEEP = 50
const SESSIONS = 30
const STORE_PREFIX = 'pins:'

// Change the tag when Pin's fields change: it declines what an earlier
// version stored, which outlives a reload.
const pins = atom({ plugin: 'pins', key: 'pins' } as const, [], { shape: 'pins-1' })

// Module variables start over on a reload; session.start runs again then.
let storeKey: string | undefined

/** What a reply is matched by: the last words of its text, whitespace folded. */
export function textKey(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(-160)
}

/** Learns which session this is, and brings back its pins after a restart. */
async function attach($: EngineInterface, sessionId: string) {
  if (storeKey === STORE_PREFIX + sessionId) return
  storeKey = STORE_PREFIX + sessionId
  const saved = (await $.store.get(storeKey)) as SavedPins | undefined
  if (saved?.pins?.length) await update($, pins, list => (list.length > 0 ? list : saved.pins))
  await prune($)
}

async function save($: EngineInterface) {
  if (!storeKey) return
  const saved: SavedPins = { at: await $.clock.now(), pins: await read($, pins) }
  await $.store.set(storeKey, saved)
}

/** Keeps the store to the last few sessions. */
async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith(STORE_PREFIX))
  if (keys.length <= SESSIONS) return
  const dated = await Promise.all(
    keys.map(async key => ({ key, at: ((await $.store.get(key)) as SavedPins | undefined)?.at ?? 0 })),
  )
  const old = dated.sort((a, b) => a.at - b.at).slice(0, keys.length - SESSIONS)
  await Promise.all(old.map(({ key }) => $.store.delete(key)))
}

function isPinned(list: readonly Pin[], id: string, key: string) {
  return list.some(pin => pin.id === id || pin.key === key)
}

/** Pins a reply, or unpins it when it is pinned; opens the pane on a pin. */
async function toggle($: EngineInterface, id: string, text: string) {
  const key = textKey(text)
  const at = await $.clock.now()
  const wasPinned = isPinned(await read($, pins), id, key)
  await update($, pins, list =>
    isPinned(list, id, key)
      ? list.filter(pin => pin.id !== id && pin.key !== key)
      : [...list, { id, key, text, at }].slice(-KEEP),
  )
  await save($)
  if (!wasPinned) await $.ui.open({ id: PANE, title: TITLE })
}

async function unpin($: EngineInterface, id: string) {
  await update($, pins, list => list.filter(pin => pin.id !== id))
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pin', description: "Pin Claude's last reply" })
    await $.command.register({ name: 'pins', description: 'Show or hide the Pinned pane' })
    // Runs at the start and again after every reload.
    await attach($, await $.session.id())

    return next(e)
  })

  on('command.run', { command: 'pin' }, async $ => {
    const messages = await $.session.messages()
    const last = messages.findLast(message => message.role === 'assistant' && message.text.trim())
    if (!last) return { text: 'There is no reply to pin yet.' }
    const key = textKey(last.text)
    if (!isPinned(await read($, pins), '', key)) await toggle($, `last-${await $.clock.now()}`, last.text)
    else await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Pinned the last reply.' }
  })

  on('command.run', { command: 'pins' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })

      return { text: 'Pinned pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Pinned pane opened.' }
  })

  // A Pin button at the end of each reply block on the desktop, shown on
  // hover; a pinned block keeps an Unpin button. The phone and the terminal
  // have no hover: there `/pin` pins the last reply.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const { text } = e.props
    if (e.props.isSummary || !text.trim() || e.surface === 'terminal' || e.surface === 'mobile') return drawn
    const { Box, Button } = $.ui.resolve(e)
    const pinned = isPinned(await read($, pins), e.requestId, textKey(text))
    const button = (
      <Button key="pin" plain dimColor label={pinned ? 'Unpin' : 'Pin'} onPress={() => toggle($, e.requestId, text)} />
    )

    return pinned ? (
      <Box flexDirection="column">
        {drawn}
        <Box justifyContent="flex-end">{button}</Box>
      </Box>
    ) : (
      <Box key="reply" flexDirection="column">
        {drawn}
        <Box position="absolute" bottom={0} right={0} display="none" hover={{ display: 'flex' }}>
          {button}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const list = await read($, pins)
    if (list.length === 0) {
      return <Text dimColor>Nothing pinned yet. Hover a reply and press Pin, or type /pin to pin the last one.</Text>
    }

    return (
      <Box flexDirection="column" gap={1}>
        {[...list].reverse().map(pin => (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Box justifyContent="space-between">
              <Text dimColor>{clock(pin.at)}</Text>
              <Button key={`unpin-${pin.id}`} plain dimColor label="Unpin" onPress={() => unpin($, pin.id)} />
            </Box>
            <Markdown text={pin.text} />
          </Box>
        ))}
      </Box>
    )
  })
}

function clock(at: number) {
  const d = new Date(at)

  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':')
}
