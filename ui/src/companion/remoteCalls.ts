import { call } from './bridge'

/** The iPad's button box's state and settings, from the app (`westplay_buttonbox`; remote.ts has the rest). */

export interface RemoteStatus {
  /** Where the iPad finds this PC ("192.168.1.20:8765"). */
  address: string
  code: string
  ipad: boolean
  /** The program in front: "game", "elevated" (the game as administrator), another's name, or none. */
  inFront: string | null
  /** Where the lamps come from: "game", "waiting" (the plugin's there, the game isn't), "no plugin". */
  lamps: 'game' | 'waiting' | 'no plugin'
  testMode: boolean
}

export const remoteStatus = () => call<RemoteStatus>('buttonbox_status')
export const recentPresses = (count: number) => call<string[]>('buttonbox_recent', { count })
export const setTestMode = (on: boolean) => call<void>('buttonbox_set_test_mode', { on })
export const bindings = () => call<Record<string, string>>('buttonbox_bindings')
export const setBinding = (name: string, key: string) => call<string>('buttonbox_set_binding', { name, key })
