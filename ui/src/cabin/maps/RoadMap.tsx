import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLook } from '../state/hooks'
import { useCabin } from '../state/store'
import { setLiveMapAppearance, setLiveMapMarker, showLiveMap } from './liveMap'
import type { MapData } from './mapData'
import './maps.css'

/**
 * The live map: the game's own roads and land, drawn in ATS GPS's style and following the truck (or
 * resting on the exported area when there's no truck, e.g. in a browser). One map serves every screen
 * (liveMap.ts); this is where it's shown. `interactive`: the player can move it (the Maps app).
 */
export function RoadMap({ data, interactive }: { data: MapData; interactive: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const { appearance } = useLook()
  const marker = useCabin((state) => state.marker)
  // The appearance as of now, for when the map is shown (outside render).
  const appearanceRef = useRef(appearance)
  useLayoutEffect(() => {
    appearanceRef.current = appearance
  })

  // Before the map is shown, so a map made now has it.
  useLayoutEffect(() => setLiveMapMarker(marker), [marker])

  useEffect(() => {
    if (!host.current) return
    return showLiveMap(host.current, data, appearanceRef.current, interactive)
  }, [data, interactive])

  // Light and dark: restyled in place, fading like the rest of the UI.
  useEffect(() => setLiveMapAppearance(appearance), [appearance])

  return <div ref={host} className="road-map-host" />
}
