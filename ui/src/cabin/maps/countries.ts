/**
 * Which country each square of the map is in, and their time zones, as the map export writes them
 * (crates/mapdata countries.rs, `countries.json` beside the tiles): for the cab's clock (state/timeZone.ts).
 */

/** Central Europe's time zone, minutes: the one ETS2's SDK game time is in. */
const GAME_ZONE = 120
/** ATS's: taken as the Pacific's (California's, its first map), as ETS2's is its home's. shortcut: not measured
 * in the game yet; if the clock is off by whole hours in ATS, this is the number to change. */
const ATS_GAME_ZONE = -420

/** The zone the SDK's game time is in, for the game whose countries these are: ATS's states are all west of
 * UTC, ETS2's countries none. */
function gameZone(zones: Map<number, number>): number {
  return [...zones.values()].some((zone) => zone < 0) ? ATS_GAME_ZONE : GAME_ZONE
}

/** The map's countries on a grid (`countries.json`), and their time zones. */
export interface CountryGrid {
  cell: number
  x: number
  z: number
  width: number
  height: number
  /** Each square's country id, row by row from the north west; 0 for none near. */
  cells: Uint8Array
  /** Each country's time zone, minutes, by id. */
  zones: Map<number, number>
  /** Each country's name (ATS's states), by id: none in a map built before they were exported. */
  names: Map<number, string>
}

/** The grid as the map export writes it, `null` if it isn't one. */
export function parseGrid(json: unknown): CountryGrid | null {
  const { cell, x, z, width, height, cells, zones, names } = (json ?? {}) as {
    cell?: unknown
    x?: unknown
    z?: unknown
    width?: unknown
    height?: unknown
    cells?: unknown
    zones?: Record<string, unknown>
    names?: Record<string, unknown>
  }
  if (
    typeof cell !== 'number' ||
    typeof x !== 'number' ||
    typeof z !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof cells !== 'string' ||
    cells.length !== width * height * 2
  ) {
    return null
  }
  const bytes = new Uint8Array(width * height)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cells.slice(i * 2, i * 2 + 2), 16) || 0
  const zoneMap = new Map(Object.entries(zones ?? {}).map(([id, minutes]) => [Number(id), Number(minutes)]))
  const nameMap = new Map(
    Object.entries(names ?? {}).flatMap(([id, name]) => (typeof name === 'string' ? [[Number(id), name]] : [])),
  )
  return { cell, x, z, width, height, cells: bytes, zones: zoneMap, names: nameMap }
}

/** The name of the country (ATS: the state) at `x`, `z`; `null` where it isn't known. */
export function countryNameAt(grid: CountryGrid, x: number, z: number): string | null {
  return grid.names.get(countryAt(grid, x, z)) ?? null
}

/** The country at `x`, `z` (metres): its square's (the map export gives a square without a country's road the
 * nearest's); 0 off the grid or with none near. */
export function countryAt(grid: CountryGrid, x: number, z: number): number {
  const column = Math.floor((x - grid.x) / grid.cell)
  const row = Math.floor((z - grid.z) / grid.cell)
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return 0
  return grid.cells[row * grid.width + column]
}

/** How far the clock at `x`, `z` runs from the game's time, minutes: 0 where the country or its zone isn't
 * known. */
export function clockShiftAt(grid: CountryGrid, x: number, z: number): number {
  const zone = grid.zones.get(countryAt(grid, x, z))
  return zone === undefined ? 0 : zone - gameZone(grid.zones)
}
