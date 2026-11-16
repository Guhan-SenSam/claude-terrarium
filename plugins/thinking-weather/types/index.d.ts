export type Mode = 'idle' | 'working' | 'waiting' | 'done'

export type Strike = { t: number; seed: number }

export type Sky = {
  mode: Mode
  modeSince: number
  stormSince: number
  strikes: Strike[]
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'thinking-weather': { sky: Sky }
  }
}
