import { create } from 'zustand'
import type { Telemetry } from '../../shared/host'
import { useLive } from '../state/store'
import { jobKey, stepTrip, type Trip } from './tripComputer'

// shortcut: kept in memory only, so a restart of ATS GPS starts the trip again; persist it if players miss it.
export const useTrip = create<Trip>()(() => ({ job: null, metres: 0, movingMs: 0 }))

/** Counts the trip as the telemetry comes; returns the function that stops it. */
export function followTrip(): () => void {
  let last: number | null = null
  return useLive.subscribe((live, before) => {
    if (!live.telemetry || live.telemetry === before.telemetry) return
    const now = performance.now()
    const ms = last === null ? 0 : now - last
    last = now
    useTrip.setState((trip) => stepTrip(trip, live.telemetry as Telemetry, jobKey(live.job), ms), true)
  })
}
