import type { JobInfo, Telemetry } from '../../shared/host'

/**
 * What Home's own widgets show (HomeWidgets.tsx), worked out apart from drawing them.
 */

/** How far along a trip of `from` metres the truck is with `left` to go, 0 to 1. */
export function progressOf(left: number, from: number): number {
  return from > 0 ? Math.min(1, Math.max(0, 1 - left / from)) : 0
}

/** The longest distance left seen on each leg, to measure the progress from: the job's pickup, its delivery, or
 * a route of the player's own. */
let longest: { leg: string; metres: number } = { leg: '', metres: 0 }

/**
 * The leg the truck is on and how far along it: to the job's pickup, to its delivery (from the job's planned
 * distance when the game gives one), or a route of the player's own; `null` with no route.
 */
export function tripLeg(
  telemetry: Telemetry,
  job: JobInfo | null,
): { toPickup: boolean; progress: number; left: number } | null {
  const left = telemetry.navigationDistance
  if (left <= 1) return null
  const toPickup = job !== null && !job.cargoLoaded
  const leg = job ? `${job.sourceCity}|${job.destinationCity}|${job.cargo}|${toPickup}` : 'route'
  if (longest.leg !== leg) longest = { leg, metres: 0 }
  longest.metres = Math.max(longest.metres, left)
  const planned = job && !toPickup ? job.plannedDistanceKm * 1000 : 0
  return { toPickup, progress: progressOf(left, Math.max(planned, longest.metres)), left }
}

/** How a share of wear reads: fine below 10%, worn below 30%, damaged from there. */
export function wearLevel(share: number): 'fine' | 'worn' | 'damaged' {
  return share < 0.1 ? 'fine' : share < 0.3 ? 'worn' : 'damaged'
}

/** The truck's wear as the game's own truck screen counts it: its most worn part. */
export function truckWear(t: Telemetry): number {
  return Math.max(t.wearEngine ?? 0, t.wearTransmission ?? 0, t.wearCabin ?? 0, t.wearChassis ?? 0, t.wearWheels ?? 0)
}

/** The first trailer's wear: its most worn part. */
export function trailerWear(t: Telemetry): number {
  return Math.max(t.trailerWearChassis ?? 0, t.trailerWearWheels ?? 0, t.trailerWearBody ?? 0)
}
