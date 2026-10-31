import { describe, expect, it } from 'vitest'
import type { JobInfo, Telemetry } from '../../shared/host'
import { progressOf, trailerWear, tripLeg, truckWear, wearLevel } from './widgetViews'

const at = (navigationDistance: number) => ({ navigationDistance }) as Telemetry
const job = (cargoLoaded: boolean) =>
  ({ cargoLoaded, sourceCity: 'Reno', destinationCity: 'Elko', cargo: 'Tomatoes', plannedDistanceKm: 400 }) as JobInfo

describe("Home's widgets", () => {
  it('measure progress along the leg the truck is on', () => {
    expect(progressOf(25, 100)).toBe(0.75)
    expect(progressOf(150, 100)).toBe(0)
    expect(progressOf(10, 0)).toBe(0)
    expect(tripLeg(at(0), null)).toBeNull()
    // To the pickup: from the longest distance seen on the way.
    expect(tripLeg(at(80_000), job(false))?.progress).toBe(0)
    expect(tripLeg(at(20_000), job(false))).toEqual({ toPickup: true, progress: 0.75, left: 20_000 })
    // Delivering: from the job's planned distance.
    expect(tripLeg(at(100_000), job(true))).toEqual({ toPickup: false, progress: 0.75, left: 100_000 })
  })

  it('read the wear as its most worn part', () => {
    const t = { wearEngine: 0.02, wearChassis: 0.31, trailerWearBody: 0.12 } as Telemetry
    expect(truckWear(t)).toBe(0.31)
    expect(trailerWear(t)).toBe(0.12)
    expect([wearLevel(0.05), wearLevel(0.12), wearLevel(0.31)]).toEqual(['fine', 'worn', 'damaged'])
  })
})
