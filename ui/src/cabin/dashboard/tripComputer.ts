import type { JobInfo, Telemetry } from '../../shared/host'

/**
 * The trip computer on the trip card (YMN One's, from the speedometer): how far the truck has driven since the
 * job was taken (or since the last one ended, free roaming) and its average speed while moving.
 */
export interface Trip {
  /** The job it's for (`jobKey`), `null` free roaming. */
  job: string | null
  /** Metres driven, as the game's distances are (`navigationDistance`). */
  metres: number
  /** Milliseconds moving faster than `MOVING`: the average leaves out the stops. */
  movingMs: number
}

/** Slower than this (m/s) the truck counts as stopped. */
const MOVING = 1
/** A longer step than this (ms: a load, the page out of view) is left out rather than guessed. */
const LONGEST_STEP = 2000

/** A job told apart from the next: where from and to, and what. */
export function jobKey(job: JobInfo | null): string | null {
  return job
    ? `${job.sourceCity}|${job.sourceCompany}|${job.destinationCity}|${job.destinationCompany}|${job.cargo}`
    : null
}

/** The trip after `ms` more at `telemetry`: a new one when the job changed; nothing counted while paused. */
export function stepTrip(trip: Trip, telemetry: Telemetry, job: string | null, ms: number): Trip {
  const current = trip.job === job ? trip : { job, metres: 0, movingMs: 0 }
  if (telemetry.paused || ms <= 0 || ms > LONGEST_STEP) return current
  const speed = Math.abs(telemetry.speed)
  return {
    job,
    metres: current.metres + (speed * ms) / 1000,
    movingMs: current.movingMs + (speed > MOVING ? ms : 0),
  }
}

/** The average speed while moving, m/s (0 before it has moved). */
export function averageSpeed(trip: Trip): number {
  return trip.movingMs > 0 ? trip.metres / (trip.movingMs / 1000) : 0
}
