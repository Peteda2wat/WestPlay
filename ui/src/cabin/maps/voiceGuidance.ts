import { fade, levelOf, stopFade } from '../apps/fade'
import { isAway, isOff, type MusicPlayer } from '../apps/musicWithGame'
import { useCabin, useLive } from '../state/store'
import { languageOf, STRINGS, type Strings } from '../state/strings'
import { postToHost, type VoiceLevel } from '../../shared/host'
import { BANDS, bandOf, guidanceOf, pickVoice, spokenDistance, type Step } from './guidance'

/**
 * The route's turns spoken, as a car's navigation speaks them: by the cabin's page (the browser's own speech,
 * Windows' voices; Narrator's natural ones, which the page can't reach, said by the host for it: sapi.rs), so it's
 * the ATS GPS app that talks, not the game: nothing of it runs in the game (its own
 * voice navigation crashed ATS here, owner 2026-10-27). While it talks, the music playing ducks under it.
 *
 * Each step is said far off, close and at it, by the time left to it (`bandOf`); with the step right after it
 * when that's close behind ("…, then keep left"); and, the route planned anew as the truck drives (a turn
 * missed), "Rerouting" and the next step at once. Settings › Sound › Spoken Directions sets it off or how loud
 * (louder, the music ducks deeper) and the voice.
 */

/** The voice's volume and the music's level under it (of its own volume), by the player's choice. */
const LOUDNESS: Record<VoiceLevel, { voice: number; duck: number }> = {
  low: { voice: 0.5, duck: 0.35 },
  normal: { voice: 1, duck: 0.25 },
  loud: { voice: 1, duck: 0.1 },
}
const DUCK_MS = 250
const UNDUCK_MS = 500
/** Speech that never says it ended (Chromium does that now and then): the music back after this, ms. */
const LONGEST_MS = 15000
/** A new route counts as a reroute only with the truck moving (m/s): one planned while parked is the player's. */
const DRIVING = 2

function keyOf(step: Step): string {
  return step.kind === 'arrive' ? 'arrive' : `${step.maneuver.node}:${step.maneuver.turn}`
}

function sayStep(step: Step, text: Strings): string {
  if (step.kind === 'arrive') return text.arrive
  return step.maneuver.turn === 'roundabout' ? text.roundabout(step.maneuver.exit ?? 1) : text.turns[step.maneuver.turn]
}

/** English directions said with attitude (owner 2026-10-28: "a little aggressive"): a jab after each one, picked
 * at random so the same turn said far off, close and at it doesn't nag the same way three times. */
const JABS: Record<string, readonly string[]> = {
  left: ['Yes, left.', 'Your other left. No, that one.', 'Try not to miss it.'],
  right: ['Right. Pay attention.', 'Not left. Right.', 'Try not to miss it.'],
  'sharp-left': ['Slow down first, genius.', 'Brake, then turn. In that order.'],
  'sharp-right': ['Slow down first, genius.', 'Brake, then turn. In that order.'],
  'u-turn': ["You missed it, didn't you.", 'Again.'],
  'keep-left': ['Get out of the right lane.', 'Stay in your lane. Literally.'],
  'keep-right': ['Out of the left lane, slowpoke.', 'Stay in your lane. Literally.'],
  'exit-left': ['Get over. Now.', 'Signal this time.'],
  'exit-right': ['Get over. Now.', 'Signal this time.'],
  roundabout: ["Count them. It's not hard.", "Don't go around twice."],
  arrive: ['You made it. Somehow.', 'Park it straight this time.'],
  any: ['Do it.', "Don't make me say it again.", 'Eyes on the road.'],
}
const ATTITUDE_REROUTING = 'Rerouting. Because somebody missed the turn'

function jabOf(step: Step): string {
  const pool = JABS[step.kind === 'arrive' ? 'arrive' : step.maneuver.turn] ?? JABS.any
  return pool[Math.floor(Math.random() * pool.length)]
}

/** The language the route's words are spoken in (the cabin's strings: English or Turkish). */
export function voiceLang(): string {
  return languageOf(useLive.getState().gameLanguage) === 'tr' ? 'tr-TR' : 'en-US'
}

/** The `voiceURI` of the host's natural voices (crates/host sapi.rs), told apart from the page's own. */
const HOST_VOICE = 'sapi:'

/** The page's own voices and the host's natural ones (Narrator's Ava and the like, which only it can reach). */
function allVoices(): SpeechSynthesisVoice[] {
  const host = useLive.getState().sapiVoices.map(
    ({ name, lang }) => ({ name, lang, default: false, localService: true, voiceURI: HOST_VOICE + name }) as SpeechSynthesisVoice,
  )
  return [...host, ...(window.speechSynthesis?.getVoices() ?? [])]
}

/** The voices Windows has for that language, for Settings to list. */
export function voicesForLanguage(): SpeechSynthesisVoice[] {
  const prefix = voiceLang().split('-')[0]
  return allVoices().filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
}

// The host's words not said yet, by id: what to do once they are (`spoken`).
const unsaid = new Map<number, () => void>()
let lastId = 0

/** The host's words of `id` said. */
export function receiveSpoken(id: number): void {
  unsaid.get(id)?.()
  unsaid.delete(id)
}

/** Whatever's being said, stopped (what's cut off never calls its `over`). */
function hush(): void {
  window.speechSynthesis?.cancel()
  if (unsaid.size === 0) return
  unsaid.clear()
  postToHost({ type: 'hush' })
}

/** Says `words` in the voice and level chosen, cutting off what's being said; `over` once they're said. */
function speakWords(words: string, over: () => void = () => {}): void {
  const { voice } = useCabin.getState()
  const lang = voiceLang()
  const picked = pickVoice(allVoices(), lang, voice.name)
  const volume = LOUDNESS[voice.level].voice
  hush()
  if (picked?.voiceURI.startsWith(HOST_VOICE)) {
    const id = ++lastId
    unsaid.set(id, over)
    postToHost({ type: 'speak', id, text: words, voice: picked.name, volume })
    return
  }
  const utterance = new SpeechSynthesisUtterance(words)
  utterance.lang = lang
  if (picked) utterance.voice = picked
  utterance.volume = volume
  utterance.onend = over
  utterance.onerror = over
  window.speechSynthesis?.speak(utterance)
}

/** A direction in the voice and level chosen, for Settings (picked there, heard at once). */
export function previewVoice(): void {
  const language = languageOf(useLive.getState().gameLanguage)
  const text = STRINGS[language]
  const words = text.sayIn(spokenDistance(800, useCabin.getState().miles, language === 'tr'), text.turns.right)
  speakWords(language === 'en' ? `${words}. ${JABS.right[1]}` : words)
}

/** Speaks the route's turns from now on, ducking `players` under the voice. Returns the function that stops it. */
export function speakGuidance(players: readonly MusicPlayer[]): () => void {
  let spoken = ''
  // The route last seen (its id), and a reroute not yet said.
  let routeId: number | null = null
  let rerouted = false
  // The utterance now speaking: only its end brings the music back (one cancelled for the next doesn't).
  let current = 0
  const ducked = new Set<MusicPlayer>()

  const duck = (level: number) => {
    for (const player of players) {
      const volume = player.volume()
      if (!player.playingHere() || volume === null || volume <= 0) continue
      fade(player.name, player.sendVolume, levelOf(player.name) ?? volume, volume * level, DUCK_MS)
      ducked.add(player)
    }
  }
  const unduck = () => {
    // Away from the game: its own fade out (musicWithGame.ts) took the music over and sets its volume back.
    if (!isAway(useLive.getState())) {
      for (const player of ducked) {
        const volume = player.volume()
        if (volume === null) continue
        if (player.playingHere())
          fade(player.name, player.sendVolume, levelOf(player.name) ?? volume, volume, UNDUCK_MS)
        else {
          stopFade(player.name)
          player.sendVolume(volume)
        }
      }
    }
    ducked.clear()
  }

  const say = (words: string) => {
    const id = ++current
    duck(LOUDNESS[useCabin.getState().voice.level].duck)
    const over = () => {
      clearTimeout(timer)
      if (id === current) unduck()
    }
    const timer = setTimeout(over, LONGEST_MS)
    speakWords(words, over)
  }

  const quiet = () => {
    current++
    hush()
    unduck()
  }

  const stopLive = useLive.subscribe((live) => {
    if (isAway(live)) {
      hush()
      return
    }
    const { route, routeNext, telemetry } = live
    // A new route while driving: the old one left (a turn missed), said, and the next step said at once.
    if (route && route.id !== routeId) {
      if (routeId !== null && Math.abs(telemetry?.speed ?? 0) > DRIVING) rerouted = true
      routeId = route.id
    }
    // Its turns not worked out yet (they come a moment after it): nothing to say of it yet.
    if (!route || route.paths.size === 0) return
    const guidance = guidanceOf(route.distances, route.maneuvers, routeNext, telemetry?.navigationDistance ?? 0)
    if (!guidance || isOff() || useCabin.getState().voice.muted) {
      rerouted = false
      return
    }
    const band = bandOf(guidance.distance, telemetry?.localScale ?? 0, telemetry?.speed ?? 0)
    const step = keyOf(guidance.step)
    if (!rerouted) {
      if (band === null) return
      const key = `${step}@${band}`
      if (key === spoken) return
      // Each band once, from the nearest reached (a route planned close to a turn says it once, not three times).
      if (spoken.startsWith(`${step}@`) && Number(spoken.split('@')[1]) > band) return
    }
    spoken = `${step}@${band ?? -1}`
    const language = languageOf(live.gameLanguage)
    const text = STRINGS[language]
    let words = sayStep(guidance.step, text)
    // The step right after, close behind: said with this one as it comes near (far off, it's said later).
    if (guidance.then && band !== null && band > 0) words = text.sayThen(words, sayStep(guidance.then, text))
    if (band !== BANDS.length - 1) {
      words = text.sayIn(spokenDistance(guidance.distance, useCabin.getState().miles, language === 'tr'), words)
    }
    if (language === 'en') words = `${words}. ${jabOf(guidance.step)}`
    if (rerouted) words = `${language === 'en' ? ATTITUDE_REROUTING : text.rerouting}. ${words}`
    rerouted = false
    say(words)
  })
  // Spoken Directions set to No Voice (or the iPad's Nav Voice key) while it speaks: quiet at once.
  const stopVoice = useCabin.subscribe((cabin, before) => {
    if (cabin.voice.muted && !before.voice.muted) quiet()
  })

  return () => {
    stopLive()
    stopVoice()
    quiet()
  }
}
