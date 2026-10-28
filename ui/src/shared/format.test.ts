import { describe, expect, it } from 'vitest'
import { formatGameTime, formatTripDistance, formatTripTime, speedKmh } from './format'

const words = { minutes: (m: number) => `${m} min`, hours: (h: number, m: string) => `${h}:${m} hrs` }

describe('trip', () => {
  it('shows the time left in minutes, then hours and minutes', () => {
    expect(formatTripTime(0.4, words)).toBe('0 min')
    expect(formatTripTime(12.2, words)).toBe('12 min')
    expect(formatTripTime(59.4, words)).toBe('59 min')
    expect(formatTripTime(65, words)).toBe('1:05 hrs')
    expect(formatTripTime(754, words)).toBe('12:34 hrs')
  })

  it('shows a distance in metres close by, then kilometres, in the language’s decimals', () => {
    expect(formatTripDistance(42)).toBe('40 m')
    expect(formatTripDistance(830)).toBe('850 m')
    expect(formatTripDistance(990)).toBe('1.0 km')
    expect(formatTripDistance(9420)).toBe('9.4 km')
    expect(formatTripDistance(9420, ',')).toBe('9,4 km')
    expect(formatTripDistance(67_703)).toBe('68 km')
  })

  it('shows a distance in feet close by, then miles, with Miles on', () => {
    expect(formatTripDistance(10, '.', true)).toBe('30 ft')
    expect(formatTripDistance(42, '.', true)).toBe('150 ft')
    expect(formatTripDistance(1000, '.', true)).toBe('0.6 mi')
    expect(formatTripDistance(15_000, '.', true)).toBe('9.3 mi')
    expect(formatTripDistance(100_000, '.', true)).toBe('62 mi')
    expect(speedKmh(26.8224, true)).toBe(60)
    expect(speedKmh(-25)).toBe(90)
  })
})

describe('formatGameTime', () => {
  it('shows the clock in 24 hours, or in 12 with AM/PM', () => {
    // Day 2, 14:22; midnight; noon.
    const afternoon = 2 * 1440 + 14 * 60 + 22
    expect(formatGameTime(afternoon)).toBe('14:22')
    expect(formatGameTime(afternoon, false)).toBe('2:22 PM')
    expect(formatGameTime(5, false)).toBe('12:05 AM')
    expect(formatGameTime(12 * 60, false)).toBe('12:00 PM')
    expect(formatGameTime(5)).toBe('00:05')
  })
})
