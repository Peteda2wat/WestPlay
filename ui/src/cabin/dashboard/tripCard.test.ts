import { describe, expect, it } from 'vitest'
import type { JobInfo, Telemetry } from '../../shared/host'
import { STRINGS } from '../state/strings'
import { stopsNeeded, tripCardView } from './tripCard'

const text = STRINGS.en
// Thursday 14:00, 600 km left taking 10 game hours, scale 20; half a 400 L tank with 500 km of range.
const telemetry = {
  gameTime: 3 * 1440 + 14 * 60,
  navigationDistance: 600_000,
  navigationTime: 10 * 3600,
  localScale: 20,
  nextRestStop: 4 * 60,
  fuel: 200,
  fuelRange: 500,
} as Telemetry

describe('Truck Remote trip card', () => {
  it('plans fuel and sleep stops as Truck Remote did', () => {
    // Full tank 1000 km, reserve 100 km: first fill within 400 km, then 900 km a tank.
    // Sleep: due in 4 h of a 10 h trip, so one, about 240 km on.
    expect(stopsNeeded(telemetry, 400, 600_000, 600)).toEqual({ fuel: 1, fuelBy: 400_000, sleep: 1, sleepAt: 240_000 })
  })

  it('shows arrival (its weekday), real time left and distance, then the job rows', () => {
    const job = {
      cargoLoaded: true,
      cargo: 'Tomatoes',
      destinationCity: 'Reno',
      destinationCompany: 'Wallbert',
      deliveryTime: 0,
    } as JobInfo
    const view = tripCardView(telemetry, job, 400, text, 0, true, false)
    expect(view.big).toEqual([
      { value: '00:00', unit: 'Fri' },
      { value: '30', unit: 'min left' },
      { value: '600', unit: 'km' },
    ])
    expect(view.rows.map((row) => `${row.key}: ${row.value}`)).toEqual([
      'To: Reno · Wallbert',
      'Cargo: Tomatoes',
      'Break: In 4h 0m',
      'Fuel stops: 1 · first within 400 km',
      'Sleep stops: 1 · first in ~240 km',
      'Fuel: 50% · 200 L · 500 km',
    ])
  })
})
