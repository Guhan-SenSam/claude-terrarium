import type { EngineInterface } from 'claude-code'

import type { Cond, Report, Season } from '../types'

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
type Now = { current?: { weather_code: number; temperature_2m: number; snow_depth?: number } }

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
    const res = await $.http.fetch(`${FORECAST}?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,snow_depth`)
    if (!res.ok) return `Could not get the weather (HTTP ${res.status}).`
    const cur = (JSON.parse(res.text) as Now).current
    if (cur === undefined) return 'The weather service answered with no current conditions.'
    return {
      place, name, lat, lon,
      cond: condOf(cur.weather_code),
      tempC: cur.temperature_2m,
      snowCover: (cur.snow_depth ?? 0) > 0.01,
      at: await $.clock.now(),
    }
  } catch (error) {
    return `Could not reach the weather service: ${error instanceof Error ? error.message : String(error)}`
  }
}
