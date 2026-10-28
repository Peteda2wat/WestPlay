/**
 * Turn-by-turn: the route's next turn and how far it is. The host works out the turns at the route's
 * junctions from the game's own lanes (crates/mapdata junctions.rs: only where there's a choice, in the
 * terms of the game's voice navigation), and each route node carries the game's own distance left from it
 * to the destination; the SDK's distance left, less the node's, is how far the truck is from the turn, as
 * the game counts distances (its map's scale, so the same figures as its own GPS).
 *
 * The game's scale is about 3 to 1 in cities and 15-19 to 1 between them, so at a steady speed the
 * distance counts down several times faster out of town. That's deliberate: the
 * figures stay the game's own, matching its GPS, its jobs and the trip pill, rather than metres driven.
 */

export type TurnKind =
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'u-turn'
  | 'keep-left'
  | 'keep-right'
  | 'exit-left'
  | 'exit-right'
  | 'roundabout'

/** A turn of the route, at the junction entered at its node `node`: how far it turns (degrees, right
 * positive), and a roundabout's exit. */
export interface Maneuver {
  node: number
  turn: TurnKind
  angle: number
  exit: number | null
}

/** What to do next: a turn, or arrive. */
export type Step = { kind: 'turn'; maneuver: Maneuver } | { kind: 'arrive' }

export interface Guidance {
  step: Step
  /** How far to it, metres (as the game counts them). */
  distance: number
  /** What comes right after it, when it's that close behind (the game's "…and then"). */
  then: Step | null
}

/** A second step this close behind the first (metres, as the game counts them) is shown with it. */
export const THEN_WITHIN = 400

const ARRIVE: Step = { kind: 'arrive' }

/**
 * The guidance along a route (`distances`: each node's distance left to the destination; `maneuvers` in
 * route order) for a truck before its node `next`, with `distanceLeft` to go; `null` without a route. A
 * turn stays next until the truck is through its junction (it's "now" while inside).
 */
export function guidanceOf(
  distances: readonly number[],
  maneuvers: readonly Maneuver[],
  next: number,
  distanceLeft: number,
): Guidance | null {
  if (distanceLeft <= 0 || distances.length === 0) return null
  const ahead = maneuvers.filter((maneuver) => maneuver.node >= next - 1)
  const to = (maneuver: Maneuver) => Math.max(0, distanceLeft - (distances[maneuver.node] ?? 0))
  const [first, second] = ahead
  if (!first) return { step: ARRIVE, distance: distanceLeft, then: null }
  const distance = to(first)
  const after: [Step, number] = second ? [{ kind: 'turn', maneuver: second }, to(second)] : [ARRIVE, distanceLeft]
  return {
    step: { kind: 'turn', maneuver: first },
    distance,
    then: after[1] - distance <= THEN_WITHIN ? after[0] : null,
  }
}

/** Within this, metres, a step is "now". */
export const NOW_WITHIN = 30

/**
 * When a step is spoken: far off, close, and at it, by the time left to it at the truck's speed (owner
 * 2026-10-27: on the highway, fixed distances as the game counts them came seconds before the turn, its scale
 * 20 to 1 there, 3 in town), or, crawling or stopped (lights, a queue), by how near it is in the world.
 */
export const BANDS = [
  { seconds: 30, metres: 250 },
  { seconds: 10, metres: 80 },
  { seconds: 3, metres: 15 },
] as const
/** Which band a step `distance` off (metres as the game counts them) is in for a truck at `speed` (m/s) where
 * the game's map scale is `scale` (0: not known, taken as 1): 0 far, 2 at it, `null` before the first. */
export function bandOf(distance: number, scale: number, speed: number): number | null {
  const metres = distance / Math.max(1, scale)
  const seconds = metres / Math.max(0.1, Math.abs(speed))
  for (let band = BANDS.length - 1; band >= 0; band--) {
    if (seconds <= BANDS[band].seconds || metres <= BANDS[band].metres) return band
  }
  return null
}

/** The voice to speak `lang` in: the one chosen (`name`) if it's installed, else the most natural one for the
 * language (Windows' "Natural" or online voices before its older ones). */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: string,
  name: string | null,
): SpeechSynthesisVoice | undefined {
  const chosen = name === null ? undefined : voices.find((voice) => voice.name === name)
  if (chosen) return chosen
  const prefix = lang.split('-')[0].toLowerCase()
  const rank = (voice: SpeechSynthesisVoice) =>
    (/natural/i.test(voice.name) ? 4 : 0) +
    (/online/i.test(voice.name) ? 2 : 0) +
    (voice.lang.toLowerCase() === lang.toLowerCase() ? 1 : 0)
  return voices
    .filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
    .reduce<SpeechSynthesisVoice | undefined>(
      (best, voice) => (best && rank(best) >= rank(voice) ? best : voice),
      undefined,
    )
}

/** How far, said aloud: feet then miles, or metres then kilometres. */
export function spokenDistance(metres: number, miles: boolean, turkish: boolean): string {
  if (miles) {
    const feet = metres * 3.28084
    if (feet < 1000) return `${Math.max(100, Math.round(feet / 100) * 100)} ${turkish ? 'fit' : 'feet'}`
    const count = Math.round((metres / 1609.344) * 10) / 10
    return `${count} ${turkish ? 'mil' : count === 1 ? 'mile' : 'miles'}`
  }
  if (metres < 1000) return `${Math.max(50, Math.round(metres / 50) * 50)} ${turkish ? 'metre' : 'meters'}`
  const count = Math.round(metres / 100) / 10
  return `${count} ${turkish ? 'kilometre' : count === 1 ? 'kilometer' : 'kilometers'}`
}
