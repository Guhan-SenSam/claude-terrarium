export type Mode = 'idle' | 'working' | 'waiting' | 'done'

export type Strike = { t: number; seed: number; err?: boolean }

/** What the session is up to beyond the turn itself. */
export type SessionEvents = {
  fogUntil: number
  kites: { id: string; since: number }[]
  fireworks: { t: number; seed: number }[]
}

/** The sky outside, from the weather service or a preview. */
export type Cond = 'clear' | 'partly' | 'overcast' | 'rain' | 'snow' | 'fog' | 'thunder'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Holiday = 'halloween' | 'christmas' | 'newyear' | 'july4'
export type Outside = { cond: Cond; season: Season; snowCover: boolean; moon?: number; holiday?: Holiday }

/** What the weather service last said for the place set, and where that is. */
export type Report = { place: string; name: string; lat: number; lon: number; cond: Cond; tempC: number; snowCover: boolean; at: number; sunrise?: number; sunset?: number }

export type Sky = {
  mode: Mode
  modeSince: number
  stormSince: number
  strikes: Strike[]
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'thinking-weather': { sky: Sky; report: Report | null; tick: number; events: SessionEvents }
  }
}
