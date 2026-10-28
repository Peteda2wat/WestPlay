import { useEffect, useRef, useState } from 'react'
import { Group, Note, Panel, Row, Status, Switch } from '../room/parts'
import { pressOf } from '../remote'
import { recentPresses, type RemoteStatus, remoteStatus, setTestMode } from '../remoteCalls'

/** How often the page asks the button box how things are. */
const POLL_MS = 1000

/**
 * The iPad (owner 2026-10-27: Truck Remote, now part of the app): where the iPad finds this PC and its code,
 * whether the iPad, the game's keys and the lamps are working, Test mode, and the latest presses; beside it
 * the iPad's page itself, live (`IpadMirror`).
 * shortcut: its words are English only (not yet in pages/words); translate them with the rest when needed.
 */
export function TruckRemote() {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    let live = true
    const look = () => {
      remoteStatus().then(
        (next) => live && (setStatus(next), setProblem(null)),
        (error: unknown) => live && setProblem(String(error)),
      )
      recentPresses(40).then(
        (lines) => live && setRecent(lines),
        () => {},
      )
    }
    look()
    const timer = window.setInterval(look, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  const presses = recent.flatMap((line) => pressOf(line) ?? []).slice(0, 5)
  const front = status?.inFront
  const keys: [string, 'good' | 'bad' | 'idle'] =
    front === 'game'
      ? ['The game is in front', 'good']
      : front === 'elevated'
        ? ['The game runs as administrator: Windows blocks the keys', 'bad']
        : front
          ? [`${front} is in front: click into the game`, 'idle']
          : ['—', 'idle']
  const lamps: [string, 'good' | 'idle' | 'bad'] =
    status?.lamps === 'game'
      ? ['From the game', 'good']
      : status?.lamps === 'waiting'
        ? ['When the game runs', 'idle']
        : ['Telemetry plugin missing', 'bad']

  return (
    <>
      <Panel
        place="page"
        title={status?.ipad ? 'Your iPad is connected' : 'Connect your iPad'}
        sub="Your iPad shows ATS GPS and the button box. The game sees every tap and every button."
      >
        {problem && <Note tone="bad">The button box couldn’t start: {problem}</Note>}
        <Group place={2}>
          <Row title="PC address" detail="Type this in the iPad app" value={status?.address ?? '—'} />
          <Row title="Connect code" detail="Asked once on each iPad" value={status?.code ?? '—'} />
        </Group>
        <Group title="Connection" place={3}>
          <Row
            title="iPad"
            value={status?.ipad ? 'Connected' : 'Not connected'}
            accessory={<Status tone={status?.ipad ? 'good' : 'idle'} />}
          />
          <Row title="Game keys" value={keys[0]} accessory={<Status tone={keys[1]} />} />
          <Row title="Button lamps" value={lamps[0]} accessory={<Status tone={lamps[1]} />} />
        </Group>
        <Group place={4}>
          <Row
            title="Test mode"
            detail="Presses are listed but nothing is pressed in the game."
            accessory={
              <Switch
                on={status?.testMode ?? false}
                disabled={!status}
                label="Test mode"
                change={(on) => {
                  setTestMode(on).then(
                    () => setStatus((s) => s && { ...s, testMode: on }),
                    () => {},
                  )
                }}
              />
            }
          />
        </Group>
        <Group title="Recent presses" place={5}>
          {presses.length === 0 ? (
            <Row title="None yet" detail="Each button you press on the iPad shows here." />
          ) : (
            presses.map((press, index) => (
              <Row
                key={`${press.time}${index}`}
                title={press.what}
                detail={press.warning ?? undefined}
                value={press.time}
              />
            ))
          )}
        </Group>
      </Panel>
      {status && <IpadMirror address={status.address} code={status.code} />}
    </>
  )
}

/** The iPad's page as the iPad shows it (served by the button box on this PC), live and usable: its size
 * (1180 x 820, a 10.9" iPad's) scaled to the room. It counts as no iPad: the box only counts other PCs. */
export function IpadMirror({ address, code }: { address: string; code: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  // The room right of the page's words, where the screen stands (owner 2026-10-28: over the words in the
  // 900 px window): the picture fills it, never reaching the words.
  const [room, setRoom] = useState<{ left: number; width: number } | null>(null)
  const port = address.split(':').pop()
  useEffect(() => {
    document.body.classList.add('cp-ipad')
    const box = frame.current
    const fit = new ResizeObserver(() => box && setScale(box.clientWidth / IPAD.width))
    if (box) fit.observe(box)
    const place = () => {
      const words = document.querySelector('.ob-words')?.getBoundingClientRect()
      const left = (words?.right ?? window.innerWidth / 2) + MARGIN
      setRoom({ left, width: Math.max(0, Math.min(MOST_WIDE, window.innerWidth - left - MARGIN)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      document.body.classList.remove('cp-ipad')
      fit.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])
  return (
    <figure className="cp-ipad-mirror" style={room ? { left: room.left, width: room.width } : { visibility: 'hidden' }}>
      <div ref={frame} className="cp-ipad-glass">
        <iframe
          title="Your iPad"
          src={`http://127.0.0.1:${port}/?code=${encodeURIComponent(code)}`}
          style={{ width: IPAD.width, height: IPAD.height, transform: `scale(${scale})` }}
        />
      </div>
      <figcaption>Your iPad: ATS GPS and the button box</figcaption>
    </figure>
  )
}

const IPAD = { width: 1180, height: 820 }
/** Space kept around the picture, and its widest. */
const MARGIN = 24
const MOST_WIDE = 640
