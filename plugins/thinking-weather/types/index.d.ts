export type Mode = 'idle' | 'working' | 'waiting' | 'done'

export type Strike = { t: number; seed: number }

/** The sky outside, from the weather service or a preview. */
export type Cond = 'clear' | 'partly' | 'overcast' | 'rain' | 'snow' | 'fog' | 'thunder'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Outside = { cond: Cond; season: Season; snowCover: boolean }

/** What the weather service last said for the place set, and where that is. */
export type Report = { place: string; name: string; lat: number; lon: number; cond: Cond; tempC: number; snowCover: boolean; at: number }

export type Sky = {
  mode: Mode
  modeSince: number
  stormSince: number
  strikes: Strike[]
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'thinking-weather': { sky: Sky; report: Report | null }
  }
}
