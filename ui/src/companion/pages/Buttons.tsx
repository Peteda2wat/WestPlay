import { useEffect, useState } from 'react'
import { Group, Note, Panel, Row } from '../room/parts'
import { BUTTON_GROUPS, comboOf, isModifier, keyName, mouseButtonName } from '../remote'
import { bindings, remoteStatus, setBinding } from '../remoteCalls'
import { IpadMirror } from './TruckRemote'

/**
 * The iPad's buttons and the game's keys they press (owner 2026-10-27: set here, not in Truck Remote's
 * config.json): click a button, press the key the game uses for it (with Ctrl, Shift or Alt for a combo, or
 * the mouse's side buttons). A button without a key shows it in orange.
 * shortcut: its words are English only (not yet in pages/words); translate them with the rest when needed.
 */
export function Buttons() {
  const [keys, setKeys] = useState<Record<string, string> | null>(null)
  const [listening, setListening] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [mirror, setMirror] = useState<{ address: string; code: string } | null>(null)
  useEffect(() => {
    bindings().then(setKeys, (error: unknown) => setProblem(String(error)))
    remoteStatus().then(setMirror, () => {})
  }, [])

  const choose = (name: string, key: string) => {
    setListening(null)
    setBinding(name, key).then(
      (saved) => (setKeys((all) => all && { ...all, [name]: saved }), setProblem(null)),
      (error: unknown) => setProblem(String(error)),
    )
  }

  // Listening: the next key (with the modifiers held) or side button; a modifier alone once it's let go.
  useEffect(() => {
    if (!listening) return
    let modifier: string | null = null
    const down = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      const combo = comboOf(event)
      if (combo === null) return
      if (isModifier(combo)) modifier = combo
      else choose(listening, combo)
    }
    const up = (event: KeyboardEvent) => {
      if (modifier !== null && keyName(event.code) === modifier) choose(listening, modifier)
    }
    const mouse = (event: MouseEvent) => {
      const name = mouseButtonName(event.button)
      if (name === null) return
      event.preventDefault()
      choose(listening, name)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('mousedown', mouse, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('mousedown', mouse, true)
    }
    // `choose` is made anew each render; the listener only needs the button it listens for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening])

  const known = new Set(BUTTON_GROUPS.flatMap((group) => group.buttons.map(([name]) => name)))
  const others = Object.keys(keys ?? {})
    .filter((name) => !known.has(name))
    .map((name): [string, string] => [name, name.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())])
  const groups = others.length ? [...BUTTON_GROUPS, { title: 'Other keys', buttons: others }] : BUTTON_GROUPS

  return (
    <>
      <Panel
        place="page"
        title="Buttons"
        sub="Click a button, then press the key the game uses for it (Options › Controls in the game)."
      >
        {problem && <Note tone="bad">{problem}</Note>}
        {keys &&
          groups.map((group, index) => (
            <Group key={group.title} title={group.title} place={2 + index}>
              {group.buttons.map(([name, label, detail]) => (
                <Row
                  key={name}
                  title={label}
                  detail={detail}
                  onClick={() => setListening(listening === name ? null : name)}
                  accessory={
                    <KeyChip combo={keys[name] ?? ''} listening={listening === name} clear={() => choose(name, '')} />
                  }
                />
              ))}
            </Group>
          ))}
      </Panel>
      {mirror && <IpadMirror address={mirror.address} code={mirror.code} />}
    </>
  )
}

/** A button's key: its name, "No key" in orange, or, while listening, "Press a key…" and a way to clear it. */
function KeyChip({ combo, listening, clear }: { combo: string; listening: boolean; clear(): void }) {
  if (listening) {
    return (
      <span className="cp-keys">
        <span className="cp-key" data-listening>
          Press a key…
        </span>
        {combo && (
          <span
            className="cp-key-clear"
            role="button"
            tabIndex={0}
            onClick={(event) => (event.stopPropagation(), clear())}
          >
            No key
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="cp-key" data-unset={combo === '' || undefined}>
      {combo === ''
        ? 'No key'
        : combo.replaceAll('+', ' + ').replace('MouseBack', 'Mouse back').replace('MouseForward', 'Mouse forward')}
    </span>
  )
}
