import { type ReactNode, useEffect, useState } from 'react'
import { formatTripDistance } from '../../shared/format'
import { formatRealLeft, realMinutesLeft } from '../dashboard/destination'
import { PlaceRow, RouteToNearest } from '../maps/Destinations'
import { useRouteTo, useTruckAt } from '../maps/routeTo'
import { ownGarages, usePlaces } from '../maps/places'
import { useRecents } from '../maps/recents'
import { useCabin, useLive } from '../state/store'
import { useText } from '../state/text'
import { trailerWear, tripLeg, truckWear, wearLevel } from './widgetViews'
import '../maps/maps.css'

/**
 * Home's own widgets, YMN One's (owner 2026-10-30), each two columns by two rows of Home's grid: the trip's
 * progress, the fuel's range, Route to Nearest, the player's places, and the truck's and trailer's damage; and
 * small ones, an app's room (and side by side in the Dashboard's Gauges): the time left on a ring, the fuel's
 * range and the damage.
 */

/** A widget's card, as the Dashboard's (dashboard.css `.widget`), filling its cell; `small`, its type sized
 * to the card (home.css). */
function Card({
  className,
  label,
  small = false,
  children,
}: {
  className: string
  label: string
  small?: boolean
  children: ReactNode
}) {
  return (
    <div className="widget-slot open">
      <article className={`widget glass home-widget${small ? ' small' : ''} ${className}`} aria-label={label}>
        {children}
      </article>
    </div>
  )
}

/** The truck seen from the side, for the progress bar's start and the damage widget. */
function TruckGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 20" width={size} height={(size * 20) / 32} fill="currentColor" aria-hidden>
      <path d="M2 4a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v11H2Zm17 3h5.2a2 2 0 0 1 1.7.9l3.6 5.2a2 2 0 0 1 .5 1.3V16H19Z" />
      <circle cx="8" cy="16.5" r="2.6" />
      <circle cx="24.5" cy="16.5" r="2.6" />
    </svg>
  )
}

/** The trip's progress: the real time left in large type, a bar from the truck to the end of the leg (the
 * job's pickup, then its delivery), and the distance left. */
export function TripProgressWidget() {
  const text = useText()
  const miles = useCabin((state) => state.miles)
  const telemetry = useLive((state) => state.telemetry)
  const job = useLive((state) => state.job)
  const leg = telemetry ? tripLeg(telemetry, job) : null
  const w = text.homeWidgets
  return (
    <Card className="trip-progress" label={w.tripProgress}>
      {leg && telemetry ? (
        <>
          <b className="tp-time">{formatRealLeft(realMinutesLeft(telemetry, miles))}</b>
          <div className="tp-bar">
            <div className="tp-done" style={{ width: `${leg.progress * 100}%` }} />
            <span className="tp-truck" style={{ left: `${leg.progress * 100}%` }}>
              <TruckGlyph size={30} />
            </span>
            <span className={leg.toPickup ? 'tp-end pickup' : 'tp-end'} />
          </div>
          <span className="tp-left">
            {formatTripDistance(leg.left, text.decimal, miles)} {job ? (leg.toPickup ? w.toPickup : w.toDelivery) : ''}
          </span>
        </>
      ) : (
        <span className="home-widget-note">{w.noRoute}</span>
      )}
    </Card>
  )
}

/** How much of the ring a gauge draws: three quarters, open at the bottom (the stroke's share of 100). */
const GAUGE = 75

/** A three-quarter ring filled to `share` (0 to 1), what it says in its middle. */
function Gauge({ share, children }: { share: number; children: ReactNode }) {
  return (
    <>
      <svg className="gauge" viewBox="0 0 100 100" aria-hidden>
        <circle className="gauge-track" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${GAUGE} 100`} />
        <circle
          className="gauge-fill"
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          strokeDasharray={`${GAUGE * share} 100`}
        />
      </svg>
      <div className="gauge-text">{children}</div>
    </>
  )
}

/** The time left on a ring filled as far as the truck has come along the leg (blue; orange to a pickup). */
export function TripRingWidget() {
  const text = useText()
  const miles = useCabin((state) => state.miles)
  const telemetry = useLive((state) => state.telemetry)
  const job = useLive((state) => state.job)
  const leg = telemetry ? tripLeg(telemetry, job) : null
  const [value, unit] = leg && telemetry ? formatRealLeft(realMinutesLeft(telemetry, miles)).split(' ') : ['–', '']
  return (
    <Card
      className={leg?.toPickup ? 'fuel-gauge trip-ring pickup' : 'fuel-gauge trip-ring'}
      label={text.homeWidgets.tripRing}
      small
    >
      <Gauge share={leg?.progress ?? 0}>
        <b>{value}</b>
        <span>{unit ?? ''}</span>
      </Gauge>
    </Card>
  )
}

/** The fuel's range on a gauge, as the tank's level: green, orange under 15% (the trip card's warning). `small`:
 * the range alone. */
export function FuelWidget({ small = false }: { small?: boolean }) {
  const text = useText()
  const miles = useCabin((state) => state.miles)
  const fuel = useLive((state) => state.telemetry?.fuel ?? 0)
  const range = useLive((state) => state.telemetry?.fuelRange ?? 0)
  const capacity = useLive((state) => state.truck?.fuelCapacity ?? 0)
  const share = capacity > 0 ? Math.min(1, fuel / capacity) : 0
  const [value, unit] = formatTripDistance(range * 1000, text.decimal, miles).split(' ')
  return (
    <Card className={share < 0.15 ? 'fuel-gauge low' : 'fuel-gauge'} label={text.homeWidgets.fuel} small={small}>
      <Gauge share={share}>
        <b>{value}</b>
        <span>{unit}</span>
        {!small && <small>{Math.round(share * 100)}%</small>}
      </Gauge>
    </Card>
  )
}

/** What a route change says, for a moment. */
function useNote(): [string | null, (note: string | null) => void] {
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const shown = setTimeout(() => setNote(null), 3000)
    return () => clearTimeout(shown)
  }, [note])
  return [note, setNote]
}

/** Maps' Route to Nearest (fuel, a rest area, a service shop, the player's garage), one tap from Home. */
export function NearbyWidget() {
  const text = useText()
  const places = usePlaces()
  const from = useTruckAt()
  const owned = useLive((state) => state.ownedGarages)
  const headquarters = useLive((state) => state.headquarters)
  const [note, setNote] = useNote()
  return (
    <Card className="home-nearby" label={text.destinations.routeToNearest}>
      {places ? (
        <RouteToNearest
          places={places}
          garages={ownGarages(places, owned, headquarters)}
          from={from}
          onDone={setNote}
        />
      ) : (
        <span className="home-widget-note">
          {places === undefined ? text.destinations.loading : text.destinations.noPlaces}
        </span>
      )}
      {note && <p className="home-widget-done">{note}</p>}
    </Card>
  )
}

/** The player's places, as Maps' Favourites and Recents have them: their headquarters and garages, then the
 * places they went last; a tap routes there (a stop, on a route). */
export function PlacesWidget() {
  const text = useText()
  const places = usePlaces()
  const from = useTruckAt()
  const owned = useLive((state) => state.ownedGarages)
  const headquarters = useLive((state) => state.headquarters)
  const recents = useRecents((state) => state.places)
  const [note, setNote] = useNote()
  const routeTo = useRouteTo(setNote, setNote)
  const garages = places ? ownGarages(places, owned, headquarters) : []
  const shown = [...garages, ...recents.filter((place) => !garages.some((g) => g.node === place.node))].slice(0, 4)
  return (
    <Card className="home-places" label={text.destinations.favourites}>
      {shown.length > 0 ? (
        <div className="destinations-list">
          {shown.map((place, index) => (
            <PlaceRow
              key={index}
              place={place}
              title={
                garages.includes(place)
                  ? place.cityId === headquarters
                    ? text.destinations.headquarters
                    : text.destinations.yourGarage
                  : undefined
              }
              from={from}
              onChoose={(chosen) => void routeTo(chosen)}
            />
          ))}
        </div>
      ) : (
        <span className="home-widget-note">{text.destinations.favourites}</span>
      )}
      {note && <p className="home-widget-done">{note}</p>}
    </Card>
  )
}

/** The truck's and the first trailer's wear (their most worn part), and the cargo's damage on a job: each a
 * bar, green, orange from 10%, red from 30%. */
export function DamageWidget() {
  const text = useText()
  const w = text.homeWidgets
  const telemetry = useLive((state) => state.telemetry)
  const job = useLive((state) => state.job)
  const rows: { label: string; share: number | null }[] = [
    { label: w.truck, share: telemetry ? truckWear(telemetry) : 0 },
    { label: w.trailer, share: telemetry?.trailerKnown ? trailerWear(telemetry) : null },
  ]
  if (job && telemetry?.trailerKnown) rows.push({ label: w.cargo, share: telemetry.cargoDamage ?? 0 })
  return (
    <Card className="home-damage" label={w.damage}>
      <span className="damage-truck">
        <TruckGlyph size={88} />
      </span>
      {rows.map(({ label, share }) => (
        <div key={label} className={`damage-row ${share === null ? 'none' : wearLevel(share)}`}>
          <span className="damage-label">{label}</span>
          {share === null ? (
            <span className="damage-value">{w.noTrailer}</span>
          ) : (
            <>
              <span className="damage-bar">
                <span style={{ width: `${Math.max(2, share * 100)}%` }} />
              </span>
              <span className="damage-value">{Math.round(share * 100)}%</span>
            </>
          )}
        </div>
      ))}
    </Card>
  )
}

/** The truck's wear (its most worn part) in large type under the truck, green, orange or red. */
export function DamageSmallWidget() {
  const text = useText()
  const wear = useLive((state) => (state.telemetry ? truckWear(state.telemetry) : 0))
  return (
    <Card className={`damage-small ${wearLevel(wear)}`} label={text.homeWidgets.damageSmall} small>
      <span className="damage-truck">
        <TruckGlyph size={64} />
      </span>
      <b className="damage-share">{Math.round(wear * 100)}%</b>
    </Card>
  )
}
