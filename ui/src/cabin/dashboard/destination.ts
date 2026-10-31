import { formatGameTime, formatTripDistance, formatTripTime } from '../../shared/format'
import { cabClock, type JobInfo, type Telemetry } from '../../shared/host'
import { labelLines } from '../maps/labels'
import type { MapLabel } from '../maps/mapData'
import { metresBetween, toLngLat } from '../maps/projection'
import type { Point } from '../maps/route'
import type { Strings } from '../state/strings'

/**
 * Where the truck is headed, for the Dashboard's destination widget: the job (its pickup, then its
 * delivery, as the game reports it: companies and cities in the game's language), or else where the game's
 * route ends (a point the player put on the map: named after the nearest city), or nothing.
 */
export interface DestinationView {
  /** What it is: "Delivery", "Pickup", "Destination". */
  kicker: string
  title: string
  /** The city under a company's name. */
  subtitle: string | null
  /** The deadline and distance, the cargo, or the arrival and distance. */
  detail: string
  /** Past the delivery deadline. */
  late: boolean
}

/**
 * Real minutes of driving left, as Truck Remote's trip card counts them: the game's time left over its time
 * scale, at the open-road rate (about 20 in ATS, 19 in ETS2) unless the game reports one that high right now,
 * since cities run at 3 and would make it read hours too long. `miles` stands for ATS.
 */
export function realMinutesLeft(telemetry: Telemetry, miles: boolean): number {
  const scale = telemetry.localScale >= 10 ? telemetry.localScale : miles ? 20 : 19
  return telemetry.navigationTime / 60 / scale
}

/** Real time left as Truck Remote shows it: "45 min", "2:05 hr". */
export function formatRealLeft(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes))
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')} hr` : `${whole} min`
}

/** The break as Truck Remote shows it, in game minutes: "In 6h 0m", "In 45m · find a stop", "Now!". */
export function formatBreak(rest: number, text: Strings): string {
  if (rest < 0) return text.breakNow
  const time = `${rest >= 60 ? `${Math.floor(rest / 60)}h ` : ''}${rest % 60}m`
  return `${text.breakIn(time)}${rest <= 60 ? ` · ${text.findStop}` : ''}`
}

/** A day of the week (day 0 is a Monday) and the time, or only the time if it's today. */
export function formatDeadline(deadline: number, now: number, days: readonly string[], hours24 = true): string {
  const sameDay = Math.floor(deadline / 1440) === Math.floor(now / 1440)
  return sameDay
    ? formatGameTime(deadline, hours24)
    : `${days[Math.floor(deadline / 1440) % 7]} ${formatGameTime(deadline, hours24)}`
}

/** The city nearest `at` (game metres), by its name as the map shows it; `null` without any. */
export function nearestCity(at: Point, labels: readonly MapLabel[]): string | null {
  const target = toLngLat(at[0], at[1])
  let best: { label: MapLabel; distance: number } | null = null
  for (const label of labels) {
    if (label.kind !== 'city') continue
    const distance = metresBetween(target, label.at)
    if (!best || distance < best.distance) best = { label, distance }
  }
  return best && labelLines(best.label.name, best.label.localized).first
}

export function destinationView(
  job: JobInfo | null,
  routeEnd: Point | null,
  telemetry: Telemetry | null,
  labels: readonly MapLabel[],
  text: Strings,
  clockShift: number,
  /** The clock in 24 hours, or 12 with AM/PM (Settings › Appearance). */
  hours24 = true,
  miles = false,
): DestinationView | null {
  // Late or not by the player's own time, as the job's; shown by the cab's clock (a Convoy session's, in
  // the time zone where the truck is: `cabClock`).
  const now = telemetry?.gameTime ?? 0
  const clock = telemetry ? cabClock(telemetry, clockShift) : 0
  const routeLeft = telemetry && telemetry.navigationDistance > 0 ? telemetry.navigationDistance : null
  if (job) {
    if (!job.cargoLoaded) {
      const tonnes = (job.cargoMass / 1000).toFixed(1).replace('.', text.decimal)
      return {
        kicker: text.pickup,
        title: job.sourceCompany || job.sourceCity,
        subtitle: job.sourceCompany ? job.sourceCity : null,
        detail: job.cargo ? `${job.cargo} · ${tonnes} t` : `${tonnes} t`,
        late: false,
      }
    }
    const distance =
      routeLeft !== null
        ? formatTripDistance(routeLeft, text.decimal, miles)
        : formatTripDistance(job.plannedDistanceKm * 1000, text.decimal, miles)
    const late = job.deliveryTime > 0 && now > job.deliveryTime
    const deadline =
      job.deliveryTime > 0
        ? late
          ? text.late
          : text.arriveBy(formatDeadline(job.deliveryTime + (clock - now), clock, text.days, hours24))
        : null
    return {
      kicker: text.delivery,
      title: job.destinationCompany || job.destinationCity,
      subtitle: job.destinationCompany ? job.destinationCity : null,
      detail: deadline ? `${deadline} · ${distance}` : distance,
      late,
    }
  }
  if (routeEnd && telemetry && routeLeft !== null) {
    const minutes = telemetry.navigationTime / 60
    return {
      kicker: text.destination,
      title: nearestCity(routeEnd, labels) ?? text.mapPoint,
      subtitle: null,
      detail: `${formatGameTime(Math.round(clock + minutes), hours24)} ${text.arrival} · ${formatTripTime(minutes, text)}`,
      late: false,
    }
  }
  return null
}
