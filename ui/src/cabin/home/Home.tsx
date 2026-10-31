import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppIcon } from '../state/hooks'
import { type AppId, APPS } from '../state/apps'
import { type HomeItem, SMALL_WIDGETS, widgetOf } from '../state/home'
import { useLaunchStyle } from '../state/launch'
import { go, useCabin } from '../state/store'
import { useText } from '../state/text'
import { textScale } from '../state/textSize'
import { DestinationWidget, NowPlayingWidget, WeatherWidget } from '../dashboard/widgets'
import {
  DamageSmallWidget,
  DamageWidget,
  FuelWidget,
  NearbyWidget,
  PlacesWidget,
  TripProgressWidget,
  TripRingWidget,
} from './HomeWidgets'
import { CELL, COMPACT_CELL, LABEL_LINES, packPages, pageSize, rowLayout } from './pages'
import '../dashboard/dashboard.css'
import './home.css'

/** A widget on Home takes two columns by two rows: the room of four apps. */
const WIDGET_CELLS = 2

/**
 * CarPlay-style Home: the app grid next to the sidebar, in pages as CarPlay's: as many columns and rows as the
 * screen fits (pages.ts), the next page a drag sideways away (shell/dragScroll.ts), with a dot for each page
 * below. The apps and the Dashboard's widgets the player put on it, in their order (Settings › Home).
 */
export function Home() {
  const pagesElement = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ columns: 4, rows: 2, compact: false, height: 0 })
  const [page, setPage] = useState(0)
  // The labels grow with the player's Text Size, and the cells with them.
  const scale = textScale(useCabin((state) => state.textSize))
  const names = useText().apps
  // Each app's label's lines as drawn (a long name takes two): the rows are as tall as their names need.
  const [lines, setLines] = useState<Partial<Record<AppId, number>>>({})
  const home = useCabin((state) => state.home)
  const items = useMemo(() => home.flatMap(({ item, shown }) => (shown ? [item] : [])), [home])
  const apps = useMemo(() => items.filter((item): item is AppId => widgetOf(item) === null), [items])

  useLayoutEffect(() => {
    const element = pagesElement.current
    if (!element) return
    const measure = () => {
      const next = { ...pageSize(element.clientWidth, element.clientHeight, scale), height: element.clientHeight }
      setSize((current) =>
        current.columns === next.columns &&
        current.rows === next.rows &&
        current.compact === next.compact &&
        current.height === next.height
          ? current
          : next,
      )
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(element)
    return () => resized.disconnect()
  }, [scale])

  // The names' lines, at the columns' width: again as the columns, the text or its size change, and once the web
  // font is in (a fallback font's names wrap elsewhere).
  useLayoutEffect(() => {
    const element = pagesElement.current
    if (!element) return
    const count = () => {
      const found: Partial<Record<AppId, number>> = {}
      for (const label of element.querySelectorAll<HTMLElement>('.app .label')) {
        const app = label.parentElement?.dataset.app as AppId | undefined
        if (!app) continue
        const style = getComputedStyle(label)
        const line = parseFloat(style.lineHeight)
        const text = label.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        found[app] = line > 0 ? Math.min(LABEL_LINES, Math.max(1, Math.round(text / line))) : 1
      }
      setLines((current) => (apps.every((app) => current[app] === found[app]) ? current : found))
    }
    count()
    let active = true
    document.fonts.ready.then(() => active && count())
    return () => {
      active = false
    }
  }, [size.columns, size.compact, scale, names, apps])

  const cell = size.compact ? COMPACT_CELL : CELL
  // Each item's cells each way: an app's or a small widget's one, a widget's two.
  const cellsOf = (item: HomeItem) => {
    const widget = widgetOf(item)
    return widget === null || SMALL_WIDGETS.has(widget) ? 1 : WIDGET_CELLS
  }
  // With widgets, which row an app lands in is the packing's: every row as tall as the longest name, and a
  // widget counted as the cells it takes.
  const widgets = items.length - apps.length
  const longest = Math.max(1, ...apps.map((app) => lines[app] ?? 1))
  const cellCount = items.reduce((sum, item) => sum + cellsOf(item) ** 2, 0)
  const rows = rowLayout(
    cell,
    scale,
    size.height,
    size.columns,
    size.rows,
    widgets > 0 ? Array.from({ length: cellCount }, () => longest) : apps.map((app) => lines[app] ?? 1),
  )
  const pages = packPages(
    items.map((item) => ({ item, width: cellsOf(item), height: cellsOf(item) })),
    size.columns,
    rows.rows,
  )
  const turnTo = (index: number) => {
    const element = pagesElement.current
    element?.scrollTo({ left: index * element.clientWidth, behavior: 'smooth' })
  }

  return (
    <section className="screen home" aria-label="Home">
      <div
        ref={pagesElement}
        className={size.compact ? 'home-pages compact' : 'home-pages'}
        onScroll={(event) => {
          const element = event.currentTarget
          setPage(Math.round(element.scrollLeft / Math.max(1, element.clientWidth)))
        }}
      >
        {pages.map((placed, index) => (
          <div
            key={index}
            className="home-grid"
            // Every page has the page's whole grid: a page with fewer apps has them where the first has its. The rows
            // the first page fills, not all that fit: seven apps in two rows centred, not at the top of three (owner
            // 2026-10-24: "icons are too close to the top").
            style={{
              gridTemplateColumns: `repeat(${size.columns}, minmax(0, 1fr))`,
              gridTemplateRows: rows.heights.map((height) => `${height}px`).join(' '),
              rowGap: rows.gap,
            }}
          >
            {placed.map(({ item, column, row, width, height }) => (
              <div
                key={item}
                className="home-cell"
                style={{ gridColumn: `${column + 1} / span ${width}`, gridRow: `${row + 1} / span ${height}` }}
              >
                <HomeItemView item={item} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="home-dots">
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              className={index === page ? 'home-dot shown' : 'home-dot'}
              aria-label={`${index + 1} / ${pages.length}`}
              aria-current={index === page}
              onClick={() => turnTo(index)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function HomeItemView({ item }: { item: HomeItem }) {
  switch (widgetOf(item)) {
    case null:
      return <HomeApp app={item as AppId} />
    case 'nowPlaying':
      return <NowPlayingWidget onHome />
    case 'destination':
      return <DestinationWidget onHome />
    case 'weather':
      return <WeatherWidget onHome />
    case 'tripProgress':
      return <TripProgressWidget />
    case 'fuel':
      return <FuelWidget />
    case 'nearby':
      return <NearbyWidget />
    case 'places':
      return <PlacesWidget />
    case 'damage':
      return <DamageWidget />
    case 'tripRing':
      return <TripRingWidget />
    case 'fuelSmall':
      return <FuelWidget small />
    case 'damageSmall':
      return <DamageSmallWidget />
  }
}

/** An app on Home. Its icon is what the app grows out of when it opens, and shrinks back into. */
function HomeApp({ app }: { app: AppId }) {
  const launch = useLaunchStyle(app, { kind: 'icon', origin: 'home' })
  const text = useText()
  const icon = useAppIcon(APPS[app].icon)
  return (
    <button type="button" className="app" data-app={app} onClick={() => go({ type: 'openApp', app }, 'home')}>
      <img src={icon} alt="" style={launch} />
      <span className="label">{text.apps[app]}</span>
    </button>
  )
}
