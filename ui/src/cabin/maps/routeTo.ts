import { useShallow } from 'zustand/react/shallow'
import type { RouteAction, RouteAnswer } from '../../shared/host'
import { useLive } from '../state/store'
import { type Strings, useText } from '../state/text'
import type { Destination } from './places'
import { toLngLat } from './projection'
import { useRecents } from './recents'
import { changeRoute } from './routeChange'

/** Where the truck is, and routing to a place as Destinations does: shared with Home's widgets. */

/** How far the truck may move before the lists' distances are worked out again, metres. */
const WHERE_STEP = 250

/** Where the truck is (lng, lat), to the nearest `WHERE_STEP` (the lists don't redraw with every metre). */
export function useTruckAt(): [number, number] | null {
  const at = useLive(
    useShallow((state) => {
      const t = state.telemetry
      return t ? [Math.round(t.x / WHERE_STEP) * WHERE_STEP, Math.round(t.z / WHERE_STEP) * WHERE_STEP] : null
    }),
  )
  return at ? toLngLat(at[0], at[1]) : null
}

/** What the game's route allows: on a job, only stops (the destination is the job's). */
interface RouteState {
  job: boolean
  route: boolean
}

export function useRouteState(): RouteState {
  return useLive(useShallow((state) => ({ job: state.job !== null, route: state.route !== null })))
}

/**
 * Routes to `place` as Destinations' buttons do: as a stop on a route or job, else as where to go; then what to
 * tell the player (`onDone`), or what went wrong (`onProblem`, `null` once it goes right). Remembered in Recents.
 */
export function useRouteTo(onDone: (message: string) => void, onProblem: (problem: string | null) => void) {
  const text = useText()
  const { job, route } = useRouteState()
  const remember = useRecents((state) => state.remember)
  return async (place: Destination) => {
    const action: RouteAction = job || route ? 'addStop' : 'go'
    const answer = await changeRoute(action, place.node)
    if (answer !== 'done') return onProblem(answerText(answer, text))
    onProblem(null)
    remember(place)
    onDone(text.destinations.done[action])
  }
}

/** What to tell the player when the game didn't take a route change. */
export function answerText(answer: RouteAnswer, text: Strings): string {
  switch (answer) {
    case 'alreadyThere':
      return text.destinations.alreadyThere
    case 'full':
      return text.destinations.full
    case 'onJob':
      return text.destinations.onJob
    case 'unsupported':
      return text.destinations.unsupported
    case 'noAnswer':
      return text.destinations.noAnswer
    case 'noSuchNode':
    case 'unexpected':
    case 'done':
      return text.destinations.failed
  }
}
