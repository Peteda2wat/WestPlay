import { formatGameTime, formatTripDistance } from '../../shared/format'
import { cabClock, type JobInfo, type Telemetry } from '../../shared/host'
import type { Strings } from '../state/strings'
import { formatBreak, formatDeadline, formatRealLeft, realMinutesLeft } from './destination'

/**
 * Truck Remote's trip card, in the Dashboard's job tile (owner 2026-10-27: "the same navigation Truck Remote
 * had", in the tile, not on the map): arrival, real time left and distance left in big type, then the job,
 * the deadline, the break, the fuel and sleep stops the rest of the trip needs, and the fuel.
 */
export interface TripCardView {
  big: { value: string; unit: string }[]
  rows: { key: string; value: string; late?: boolean }[]
}

/** The game wants a sleep every 11 in-game hours of driving. */
const SLEEP_EVERY = 11 * 60
/** Fuel stops keep 10% of a full tank in reserve. */
const FUEL_RESERVE = 0.1

/**
 * Fuel and sleep stops left, as Truck Remote plans them: fuel by the game's range on what's in the tank,
 * keeping the reserve, then a full tank less the reserve per fill-up; sleeps from the break timer, then one
 * every 11 game hours. `null` where it can't be told.
 */
export function stopsNeeded(
  telemetry: Telemetry,
  fuelCapacity: number,
  metresLeft: number,
  gameMinutes: number,
): { fuel: number | null; fuelBy: number; sleep: number | null; sleepAt: number } {
  const plan = { fuel: null as number | null, fuelBy: 0, sleep: null as number | null, sleepAt: 0 }
  const range = telemetry.fuelRange * 1000
  if (range > 0 && telemetry.fuel > 0 && fuelCapacity > 0) {
    const fullRange = (range * fuelCapacity) / telemetry.fuel
    const reserve = fullRange * FUEL_RESERVE
    plan.fuelBy = Math.max(0, range - reserve)
    plan.fuel = metresLeft <= plan.fuelBy ? 0 : Math.ceil((metresLeft - plan.fuelBy) / (fullRange - reserve))
  }
  if (telemetry.nextRestStop !== 0 && gameMinutes > 0) {
    const rest = Math.max(0, telemetry.nextRestStop)
    plan.sleep = gameMinutes <= rest ? 0 : Math.ceil((gameMinutes - rest) / SLEEP_EVERY)
    plan.sleepAt = (metresLeft * rest) / gameMinutes
  }
  return plan
}

export function tripCardView(
  telemetry: Telemetry,
  job: JobInfo | null,
  fuelCapacity: number,
  text: Strings,
  clockShift: number,
  hours24: boolean,
  miles: boolean,
  dayLength = 1,
): TripCardView {
  const t = text.trip
  const distance = (metres: number) => formatTripDistance(metres, text.decimal, miles)
  const route = telemetry.navigationDistance > 1 && telemetry.navigationTime > 1
  const clock = cabClock(telemetry, clockShift)
  const big: TripCardView['big'] = []
  if (route) {
    // The weekday it arrives on in place of the word "arrival" (owner 2026-10-29).
    const arrival = Math.round(clock + telemetry.navigationTime / 60)
    big.push({ value: formatGameTime(arrival, hours24), unit: text.days[Math.floor(arrival / 1440) % 7] })
    const [left, leftUnit] = formatRealLeft(realMinutesLeft(telemetry, miles, dayLength)).split(' ')
    big.push({ value: left, unit: `${leftUnit} ${t.real}` })
    const [far, farUnit] = distance(telemetry.navigationDistance).split(' ')
    big.push({ value: far, unit: farUnit ?? '' })
  }

  const rows: TripCardView['rows'] = []
  const place = (city: string, company: string) => (company ? `${city} · ${company}` : city)
  if (!job) rows.push({ key: '', value: t.freeRoam })
  else if (!job.cargoLoaded) {
    rows.push({ key: t.pickUp, value: place(job.sourceCity, job.sourceCompany) })
    rows.push({ key: t.then, value: place(job.destinationCity, job.destinationCompany) })
  } else rows.push({ key: t.to, value: place(job.destinationCity, job.destinationCompany) })
  if (job?.cargo) rows.push({ key: t.cargo, value: job.cargo })
  if (job && job.deliveryTime > 0) {
    // Late by the player's own time (the job's), shown by the cab's clock.
    const arrival = telemetry.gameTime + (route ? telemetry.navigationTime / 60 : 0)
    const late = arrival > job.deliveryTime
    const due = formatDeadline(job.deliveryTime + (clock - telemetry.gameTime), clock, text.days, hours24)
    rows.push({ key: t.due, value: late ? `${due} · ${t.late}` : due, late })
  }
  if (telemetry.nextRestStop !== 0) {
    rows.push({
      key: text.breakLabel,
      value: formatBreak(telemetry.nextRestStop, text),
      late: telemetry.nextRestStop <= 60,
    })
  }
  if (route) {
    const plan = stopsNeeded(telemetry, fuelCapacity, telemetry.navigationDistance, telemetry.navigationTime / 60)
    if (plan.fuel !== null) {
      const first = plan.fuelBy < 1000 ? t.now : t.within(distance(plan.fuelBy))
      rows.push({ key: t.fuelStops, value: plan.fuel === 0 ? t.none : `${plan.fuel} · ${t.first} ${first}` })
    }
    if (plan.sleep !== null) {
      const first = plan.sleepAt < 1000 ? t.now : t.about(distance(plan.sleepAt))
      rows.push({ key: t.sleepStops, value: plan.sleep === 0 ? t.none : `${plan.sleep} · ${t.first} ${first}` })
    }
  }
  if (fuelCapacity > 0) {
    const percent = Math.round((telemetry.fuel / fuelCapacity) * 100)
    const amount = miles ? `${Math.round(telemetry.fuel / 3.785)} gal` : `${Math.round(telemetry.fuel)} L`
    rows.push({
      key: t.fuel,
      value: `${percent}% · ${amount} · ${distance(telemetry.fuelRange * 1000)}`,
      late: percent < 15,
    })
  }
  return { big, rows }
}
