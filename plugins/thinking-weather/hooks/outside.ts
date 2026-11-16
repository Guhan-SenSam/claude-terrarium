import type { EngineInterface } from 'claude-code'

import type { Cond, Holiday, Report, Season } from '../types'

// The real weather, from Open-Meteo (free, no key). The town is looked up once by name; after
// that only its coordinates, rounded to a tenth of a degree (about 10 km), are sent.

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

/** The calendar season at `lat` (southern hemisphere flipped). */
export function seasonOf(d: Date, lat: number): Season {
  const order: Season[] = ['winter', 'spring', 'summer', 'autumn']
  const north = Math.floor(((d.getMonth() + 1) % 12) / 3) // Dec-Feb 0, Mar-May 1, Jun-Aug 2, Sep-Nov 3
  return order[lat < 0 ? (north + 2) % 4 : north]!
}

/** A WMO weather code, as Open-Meteo reports it, as one of the skies the scene draws. */
export function condOf(code: number): Cond {
  if (code <= 1) return 'clear'
  if (code === 2) return 'partly'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunder'
  return 'rain' // drizzle, rain, freezing rain and showers
}

type Geo = { results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string }[] }
type Now = { current?: { weather_code: number; temperature_2m: number; snow_depth?: number }; daily?: { sunrise?: string[]; sunset?: string[] } }

/**
 * The weather at `place` now. `prev`, an earlier report for the same place, saves the lookup.
 * "Town, Region" narrows the lookup to a match on the region, state or country.
 */
export async function fetchReport($: EngineInterface, place: string, prev: Report | null): Promise<Report | string> {
  let name = prev?.name ?? ''
  let lat = prev?.lat ?? 0
  let lon = prev?.lon ?? 0
  try {
    if (prev === null) {
      const [town = '', ...rest] = place.split(',').map(p => p.trim())
      const region = rest.join(' ').toLowerCase()
      const res = await $.http.fetch(`${GEOCODE}?name=${encodeURIComponent(town)}&count=10&language=en&format=json`)
      if (!res.ok) return `Could not look up ${place} (HTTP ${res.status}).`
      const found = (JSON.parse(res.text) as Geo).results ?? []
      const pick = region === ''
        ? found[0]
        : found.find(g => [g.admin1, g.country, g.country_code].some(v => v !== undefined && v.toLowerCase().startsWith(region))) ?? found[0]
      if (pick === undefined) return `No town called ${place} was found.`
      name = [pick.name, pick.admin1, pick.country_code].filter(Boolean).join(', ')
      lat = Math.round(pick.latitude * 10) / 10
      lon = Math.round(pick.longitude * 10) / 10
    }
    const res = await $.http.fetch(`${FORECAST}?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,snow_depth&daily=sunrise,sunset&forecast_days=1&timezone=auto`)
    if (!res.ok) return `Could not get the weather (HTTP ${res.status}).`
    const body = JSON.parse(res.text) as Now
    const cur = body.current
    if (cur === undefined) return 'The weather service answered with no current conditions.'
    return {
      place, name, lat, lon,
      cond: condOf(cur.weather_code),
      tempC: cur.temperature_2m,
      snowCover: (cur.snow_depth ?? 0) > 0.01,
      at: await $.clock.now(),
      sunrise: clockHour(body.daily?.sunrise?.[0]),
      sunset: clockHour(body.daily?.sunset?.[0]),
    }
  } catch (error) {
    return `Could not reach the weather service: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** "2026-11-16T07:03", local to the place, as an hour of the day (7.05). */
function clockHour(iso: string | undefined): number | undefined {
  const m = iso === undefined ? null : /T(\d{2}):(\d{2})/.exec(iso)
  return m ? Number(m[1]) + Number(m[2]) / 60 : undefined
}

// The scene's looks are drawn for a sunrise at 6:24 and a sunset at 18:42. With the real times,
// the clock is stretched piecewise so dawn and dusk land when they really do.
const DRAWN_RISE = 6.4
const DRAWN_SET = 18.7

export function solarHour(h: number, rise: number | undefined, set: number | undefined): number {
  if (rise === undefined || set === undefined || !(rise > 0 && set > rise && set < 24)) return h
  if (h < rise) return (h / rise) * DRAWN_RISE
  if (h < set) return DRAWN_RISE + ((h - rise) / (set - rise)) * (DRAWN_SET - DRAWN_RISE)
  return DRAWN_SET + ((h - set) / (24 - set)) * (24 - DRAWN_SET)
}

/** The moon's age through its month, 0 new, 0.5 full, from a known new moon. */
export function moonPhase(d: Date): number {
  const SYNODIC = 29.530588853
  const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000
  return (((days / SYNODIC) % 1) + 1) % 1
}

/** The holiday the town is decorated for on this date, if any (local time). */
export function holidayOf(d: Date): Holiday | undefined {
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  if ((m === 12 && day === 31 && h >= 18) || (m === 1 && day === 1)) return 'newyear'
  if (m === 12) return 'christmas'
  if (m === 10 && day >= 15) return 'halloween'
  if (m === 7 && day === 4) return 'july4'
  return undefined
}

/** The era a context this full has reached: one step for each fifth of the window (0 to 4). */
export function eraLevel(percent: number): number {
  return Math.min(4, Math.max(0, Math.floor(percent / 20)))
}
