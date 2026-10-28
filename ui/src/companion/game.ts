/** Which of SCS's games ATS GPS is set up in (mirrors the app's `game::Kind`). */
export type GameKind = 'ets2' | 'ats'

export const GAME_NAMES: Record<GameKind, string> = {
  ets2: 'Euro Truck Simulator 2',
  ats: 'American Truck Simulator',
}

let current: GameKind = 'ets2'

/** Makes `kind` the game the companion's words name. Set while rendering, before the words are read (the
 * onboarding's chosen game, the room's set-up one): idempotent, and children render after their parent. */
export function setGameKind(kind: GameKind | undefined): void {
  current = kind ?? 'ets2'
}

const cache = new Map<object, object>()

/** `words` naming the current game: the words are written for ETS2, so ATS gets them with its name in. The
 * same object back for ETS2. */
export function forGame<T extends object>(words: T): T {
  if (current === 'ets2') return words
  let made = cache.get(words) as T | undefined
  if (!made) {
    made = swap(words, GAME_NAMES.ets2, GAME_NAMES.ats) as T
    cache.set(words, made)
  }
  return made
}

function swap(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value.split(from).join(to)
  if (Array.isArray(value)) return value.map((item) => swap(item, from, to))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item, from, to)]))
  }
  return value
}
