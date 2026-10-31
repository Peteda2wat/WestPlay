import { type AppId, isReleasedApp, RELEASED_APP_IDS } from './apps'
import type { DashboardWidget } from './store'

/** A widget Home can hold: the Dashboard's, and Home's own (home/HomeWidgets.tsx: YMN One's, owner 2026-10-30). */
export type HomeWidget =
  | Exclude<DashboardWidget, 'gauges'>
  | 'tripProgress'
  | 'fuel'
  | 'nearby'
  | 'places'
  | 'damage'
  | 'tripRing'
  | 'fuelSmall'
  | 'damageSmall'

/** The widgets one cell big, an app's room (the rest take two by two): YMN One's small gauges. */
export const SMALL_WIDGETS: ReadonlySet<HomeWidget> = new Set<HomeWidget>(['tripRing', 'fuelSmall', 'damageSmall'])

/** What Home can hold: an app, or a widget (`widget:` before it: Weather is both). */
export type HomeItem = AppId | `widget:${HomeWidget}`

/** An item in Home's order, and whether Home shows it (Settings › Home). */
export interface HomeEntry {
  item: HomeItem
  shown: boolean
}

const WIDGETS: readonly HomeWidget[] = [
  'nowPlaying',
  'destination',
  'weather',
  'tripProgress',
  'fuel',
  'nearby',
  'places',
  'damage',
  'tripRing',
  'fuelSmall',
  'damageSmall',
]

/** Everything Home can hold, in its first order: the apps, then the widgets. */
export const HOME_ITEMS: readonly HomeItem[] = [...RELEASED_APP_IDS, ...WIDGETS.map((w) => `widget:${w}` as const)]

/** The widget an item is, or `null` for an app. */
export function widgetOf(item: HomeItem): HomeWidget | null {
  return item.startsWith('widget:') ? (item.slice('widget:'.length) as HomeWidget) : null
}

/** Home as it comes: every app, the widgets off (they're the Dashboard's until the player adds them). */
export const DEFAULT_HOME: readonly HomeEntry[] = HOME_ITEMS.map((item) => ({ item, shown: widgetOf(item) === null }))

function isHomeItem(value: unknown): value is HomeItem {
  if (typeof value !== 'string') return false
  return value.startsWith('widget:') ? (HOME_ITEMS as readonly string[]).includes(value) : isReleasedApp(value)
}

/**
 * Home's order as stored (an earlier version, or edited): what Home can hold, each once, in the order kept;
 * what wasn't kept (an app added since) after them as it comes. Settings is always shown, so Home can't lose
 * the way back to it.
 */
export function toHome(stored: unknown): HomeEntry[] {
  const home: HomeEntry[] = []
  for (const entry of Array.isArray(stored) ? stored : []) {
    const { item, shown } = (entry ?? {}) as { item?: unknown; shown?: unknown }
    if (isHomeItem(item) && !home.some((kept) => kept.item === item)) home.push({ item, shown: shown !== false })
  }
  for (const entry of DEFAULT_HOME) if (!home.some((kept) => kept.item === entry.item)) home.push({ ...entry })
  return home.map((entry) => (entry.item === 'settings' ? { ...entry, shown: true } : entry))
}

/** The entry at `index` moved `by` places (-1 up, 1 down), kept within the list. */
export function moveEntry(home: readonly HomeEntry[], index: number, by: number): HomeEntry[] {
  const to = Math.max(0, Math.min(home.length - 1, index + by))
  const moved = [...home]
  const [entry] = moved.splice(index, 1)
  if (entry) moved.splice(to, 0, entry)
  return moved
}

/** `item` shown or not (never Settings hidden). */
export function showEntry(home: readonly HomeEntry[], item: HomeItem, shown: boolean): HomeEntry[] {
  return home.map((entry) => (entry.item === item ? { item, shown: shown || item === 'settings' } : entry))
}
