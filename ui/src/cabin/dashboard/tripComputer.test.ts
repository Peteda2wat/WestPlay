import { describe, expect, it } from 'vitest'
import type { Telemetry } from '../../shared/host'
import { averageSpeed, stepTrip, type Trip } from './tripComputer'

const at = (speed: number, paused = false) => ({ speed, paused }) as Telemetry
const START: Trip = { job: 'a', metres: 0, movingMs: 0 }

describe('trip computer', () => {
  it('sums the distance and averages the speed while moving', () => {
    let trip = stepTrip(START, at(20), 'a', 1000)
    trip = stepTrip(trip, at(0), 'a', 1000) // stopped: no distance, not in the average
    trip = stepTrip(trip, at(-10), 'a', 1000) // reversing counts as distance
    expect(trip.metres).toBe(30)
    expect(trip.movingMs).toBe(2000)
    expect(averageSpeed(trip)).toBe(15)
  })

  it('counts nothing while paused or over a long gap', () => {
    expect(stepTrip(START, at(20, true), 'a', 1000)).toEqual(START)
    expect(stepTrip(START, at(20), 'a', 5000)).toEqual(START)
    expect(averageSpeed(START)).toBe(0)
  })

  it('starts again with another job', () => {
    const driven = stepTrip(START, at(20), 'a', 1000)
    expect(stepTrip(driven, at(20), null, 1000)).toEqual({ job: null, metres: 20, movingMs: 1000 })
  })
})
