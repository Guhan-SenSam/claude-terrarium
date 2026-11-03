/** What one finished turn of the main conversation did. */
export type Receipt = {
  /** The reply it belongs to: the last words of its final text, whitespace folded. */
  key: string
  /** The transcript row of that text, when the session told us. */
  uuid?: string
  durationMs: number
  /** Tool calls in the turn, its subagents' included. */
  tools: number
  agents: number
  /** Paths of the files edited or written, in first-touched order. */
  files: string[]
  outputTokens?: number
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
}

/** What is kept across sessions, per session. */
export type SavedReceipts = { at: number; receipts: Receipt[] }

declare module 'claude-code' {
  interface PluginState {
    'turn-receipt': { receipts: Shaped<Receipt[]> }
  }
}
