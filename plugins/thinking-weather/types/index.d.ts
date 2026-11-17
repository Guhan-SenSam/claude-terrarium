export type Mode = 'idle' | 'working' | 'waiting' | 'done'

export type Strike = { t: number; seed: number; err?: boolean }

/** What the session is up to beyond the turn itself. */
/** The era reached, and when it changed (for the shimmer). */
export type EraState = { level: number; since: number }

export type SessionEvents = {
  fogUntil: number
  kites: { id: string; since: number }[]
  fireworks: { t: number; seed: number }[]
}

/** The sky outside, from the weather service or a preview. */
export type Cond = 'clear' | 'partly' | 'overcast' | 'rain' | 'snow' | 'fog' | 'thunder'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Holiday = 'halloween' | 'christmas' | 'newyear' | 'july4'
/** The age society has reached, by how full the conversation's context is. */
export type Era = 'stone' | 'village' | 'industrial' | 'modern' | 'scifi'
export type Outside = { cond: Cond; season: Season; snowCover: boolean; moon?: number; holiday?: Holiday; era?: Era; eraSince?: number }

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
    'thinking-weather': { sky: Sky; report: Report | null; tick: number; events: SessionEvents; era: EraState; eraPreview: Era | null }
  }
}
