import { describe, expect, it } from 'vitest'
import { cabClock, type JobInfo, type Telemetry } from '../../shared/host'
import type { MapLabel } from '../maps/mapData'
import { STRINGS } from '../state/strings'
import {
  destinationView,
  formatBreak,
  formatDeadline,
  formatRealLeft,
  nearestCity,
  realMinutesLeft,
} from './destination'

const text = STRINGS.en
// Thursday (day 3), 14:00.
const now = 3 * 1440 + 14 * 60
// A time scale of 18 (3 h of game time is 10 real minutes); a break due in 10 game hours.
const telemetry = {
  gameTime: now,
  navigationDistance: 214_000,
  navigationTime: 3 * 3600,
  localScale: 18,
  nextRestStop: 600,
} as Telemetry

const job: JobInfo = {
  active: true,
  cargoLoaded: true,
  special: false,
  cargo: 'Tomatoes',
  cargoMass: 18_400,
  sourceCity: 'Bari',
  sourceCompany: 'Agrominta',
  destinationCity: 'Kraków',
  destinationCompany: 'Wielton',
  deliveryTime: now + 4 * 60 + 40,
  plannedDistanceKm: 1480,
  income: 52_000,
}

const label = (name: string, x: number, localized?: string): MapLabel => ({
  name,
  localized,
  kind: 'city',
  at: [x / 111_319.490_793_273_57, 0],
  population: 1,
})

describe('Truck Remote time formats', () => {
  it('counts real time at the open-road scale, not a city one', () => {
    expect(formatRealLeft(realMinutesLeft({ navigationTime: 2 * 3600 * 20, localScale: 3 } as Telemetry, true))).toBe(
      '2:00 hr',
    )
    expect(formatRealLeft(realMinutesLeft({ navigationTime: 45 * 60 * 19, localScale: 19 } as Telemetry, false))).toBe(
      '45 min',
    )
  })

  it('stretches real time by the day_length plugin, whose clock runs slower', () => {
    // 3x slower clock: the game says 40 game-minutes of open road, which is 6 real minutes.
    expect(formatRealLeft(realMinutesLeft({ navigationTime: 40 * 60, localScale: 20 } as Telemetry, true, 3))).toBe(
      '6 min',
    )
  })

  it('shows the break in game hours and minutes', () => {
    expect(formatBreak(370, text)).toBe('In 6h 10m')
    expect(formatBreak(45, text)).toBe('In 45m · find a stop')
    expect(formatBreak(-5, text)).toBe('Now!')
  })
})

describe('destinationView', () => {
  it('shows a delivery: the company, its city, the deadline and the distance left', () => {
    expect(destinationView(job, null, telemetry, [], text, 0)).toEqual({
      kicker: 'Delivery',
      title: 'Wielton',
      subtitle: 'Kraków',
      detail: 'Arrive by 18:40 · 214 km',
      late: false,
    })
  })

  it('shows times by the cab clock in a Convoy session, and is late by the player’s own time', () => {
    // The player's own 14:00 is the session's 01:11 the next day (11 h 11 min on).
    const convoy = { ...telemetry, multiplayerTimeOffset: 11 * 60 + 11 }
    expect(cabClock(convoy, 0)).toBe(now + 671)
    expect(destinationView(job, null, convoy, [], text, 0)?.detail).toBe('Arrive by 05:51 · 214 km')
    const late = destinationView({ ...job, deliveryTime: now - 10 }, null, convoy, [], text, 0)
    expect(late?.late).toBe(true)
    // A route's arrival, 3 h on by the cab clock.
    expect(destinationView(null, [0, 0], convoy, [label('Bari', 0)], text, 0)?.detail).toBe('04:11 arrival · 3:00 hrs')
    // Out of a session (no offset sent): the game's own time.
    expect(cabClock(telemetry, 0)).toBe(now)
  })

  it('shows times in the time zone where the truck is, and is late by the player’s own time', () => {
    // An hour on (Finland, with the game's time zones on).
    expect(cabClock(telemetry, 60)).toBe(now + 60)
    expect(destinationView(job, null, telemetry, [], text, 60)?.detail).toBe('Arrive by 19:40 · 214 km')
    expect(destinationView({ ...job, deliveryTime: now - 10 }, null, telemetry, [], text, 60)?.late).toBe(true)
    expect(destinationView(null, [0, 0], telemetry, [label('Bari', 0)], text, 60)?.detail).toBe(
      '18:00 arrival · 3:00 hrs',
    )
  })

  it('names the day when the deadline is another day, and says when it has passed', () => {
    expect(destinationView({ ...job, deliveryTime: now + 1440 }, null, telemetry, [], text, 0)?.detail).toBe(
      'Arrive by Fri 14:00 · 214 km',
    )
    const late = destinationView({ ...job, deliveryTime: now - 10 }, null, telemetry, [], text, 0)
    expect(late?.detail).toBe('Late · 214 km')
    expect(late?.late).toBe(true)
  })

  it('shows the pickup with the cargo before it is loaded', () => {
    expect(destinationView({ ...job, cargoLoaded: false }, null, telemetry, [], text, 0)).toEqual({
      kicker: 'Pickup',
      title: 'Agrominta',
      subtitle: 'Bari',
      detail: 'Tomatoes · 18.4 t',
      late: false,
    })
  })

  it('names a special transport by its city alone', () => {
    const special = { ...job, special: true, destinationCompany: '' }
    expect(destinationView(special, null, telemetry, [], text, 0)).toMatchObject({ title: 'Kraków', subtitle: null })
  })

  it('without a job, names a map point after its nearest city', () => {
    const view = destinationView(null, [900, 0], telemetry, [label('Bari', 1000), label('Taranto', 5000)], text, 0)
    expect(view).toMatchObject({ kicker: 'Destination', title: 'Bari' })
    expect(view?.detail).toBe('17:00 arrival · 3:00 hrs')
  })

  it('shows nothing without a job or a route', () => {
    expect(destinationView(null, null, { ...telemetry, navigationDistance: 0 }, [], text, 0)).toBeNull()
  })
})

describe('helpers', () => {
  it('gives a deadline its day only when it is not today', () => {
    expect(formatDeadline(now + 60, now, text.days)).toBe('15:00')
    expect(formatDeadline(now + 2 * 1440, now, STRINGS.tr.days)).toBe('Cmt 14:00')
  })

  it('finds the nearest city, by the name the map shows', () => {
    expect(nearestCity([4000, 0], [label('Bari', 1000), label('Τάραντας', 5000, 'Taranto')])).toBe('Τάραντας')
    expect(nearestCity([0, 0], [])).toBeNull()
  })
})
