import { describe, expect, it } from 'vitest'
import { clockShiftAt, countryAt, countryNameAt, parseGrid } from '../maps/countries'

// Three squares of 1000 m west to east: Germany (5), the square between (the export gives it the nearest's,
// Germany), Finland (23); a square with none near; and their time zones.
const grid = parseGrid({
  cell: 1000,
  x: -1000,
  z: 0,
  width: 4,
  height: 1,
  cells: '05051700',
  zones: { '5': 120, '23': 180, '10': 60 },
})!

describe('the clock where the truck is', () => {
  it("reads the map export's grid", () => {
    expect(grid.cells).toEqual(new Uint8Array([5, 5, 23, 0]))
    expect(parseGrid({ cell: 1000, x: 0, z: 0, width: 2, height: 1, cells: '05' })).toBeNull()
    expect(parseGrid(null)).toBeNull()
  })

  it("finds the country of the truck's square", () => {
    expect(countryAt(grid, -500, 500)).toBe(5)
    expect(countryAt(grid, 1500, 500)).toBe(23)
    expect(countryAt(grid, 500, 500)).toBe(5)
    // None near, and off the grid: none.
    expect(countryAt(grid, 2500, 500)).toBe(0)
    expect(countryAt(grid, 90_000, 500)).toBe(0)
    expect(countryAt(grid, -1500, 500)).toBe(0)
  })

  it("runs an hour on in Finland, as the game's clock, and as the game's time in central Europe", () => {
    expect(clockShiftAt(grid, 1500, 500)).toBe(60)
    expect(clockShiftAt(grid, -500, 500)).toBe(0)
    // Off the grid, or a country without a zone: the game's time.
    expect(clockShiftAt(grid, 90_000, 500)).toBe(0)
  })

  it("runs ATS's clock from the Pacific's time", () => {
    // California (1), Texas (2).
    const usa = parseGrid({
      cell: 1000,
      x: 0,
      z: 0,
      width: 2,
      height: 1,
      cells: '0102',
      zones: { '1': -420, '2': -300 },
    })!
    expect(clockShiftAt(usa, 500, 500)).toBe(0)
    expect(clockShiftAt(usa, 1500, 500)).toBe(120)
  })

  it('names the state the truck is in, where the map export named it', () => {
    const usa = parseGrid({
      cell: 1000,
      x: 0,
      z: 0,
      width: 2,
      height: 1,
      cells: '0102',
      names: { '1': 'California', '2': 7 },
    })!
    expect(countryNameAt(usa, 500, 500)).toBe('California')
    // A name that isn't one, off the grid, and a map built before names: none.
    expect(countryNameAt(usa, 1500, 500)).toBeNull()
    expect(countryNameAt(usa, 9000, 500)).toBeNull()
    expect(countryNameAt(grid, -500, 500)).toBeNull()
  })
})
