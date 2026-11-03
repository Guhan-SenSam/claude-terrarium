export type Pin = {
  /** The transcript row it was pinned from, or a minted id for `/pin`. */
  id: string
  /** The last words of its text, whitespace folded: finds the row again. */
  key: string
  /** The reply's text, markdown. */
  text: string
  /** Epoch ms it was pinned. */
  at: number
}

/** What is kept across sessions, per session. */
export type SavedPins = { at: number; pins: Pin[] }

declare module 'claude-code' {
  interface PluginState {
    pins: { pins: Shaped<Pin[]> }
  }
}
