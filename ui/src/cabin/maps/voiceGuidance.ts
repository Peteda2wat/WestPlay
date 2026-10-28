import { fade, levelOf, stopFade } from '../apps/fade'
import { isAway, isOff, type MusicPlayer } from '../apps/musicWithGame'
import { useCabin, useLive } from '../state/store'
import { languageOf, STRINGS, type Strings } from '../state/strings'
import type { VoiceLevel } from '../../shared/host'
import { BANDS, bandOf, guidanceOf, pickVoice, spokenDistance, type Step } from './guidance'

/**
 * The route's turns spoken, as a car's navigation speaks them: by the cabin's page (the browser's own speech,
 * Windows' voices), so it's the WestPlay app that talks, not the game: nothing of it runs in the game (its own
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

/** The language the route's words are spoken in (the cabin's strings: English or Turkish). */
export function voiceLang(): string {
  return languageOf(useLive.getState().gameLanguage) === 'tr' ? 'tr-TR' : 'en-US'
}

/** The voices Windows has for that language, for Settings to list. */
export function voicesForLanguage(): SpeechSynthesisVoice[] {
  const prefix = voiceLang().split('-')[0]
  return (window.speechSynthesis?.getVoices() ?? []).filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
}

function utteranceOf(words: string): SpeechSynthesisUtterance {
  const { voice } = useCabin.getState()
  const utterance = new SpeechSynthesisUtterance(words)
  utterance.lang = voiceLang()
  const picked = pickVoice(window.speechSynthesis.getVoices(), utterance.lang, voice.name)
  if (picked) utterance.voice = picked
  utterance.volume = LOUDNESS[voice.level].voice
  return utterance
}

/** A direction in the voice and level chosen, for Settings (picked there, heard at once). */
export function previewVoice(): void {
  const speech = window.speechSynthesis
  if (!speech) return
  const language = languageOf(useLive.getState().gameLanguage)
  const text = STRINGS[language]
  speech.cancel()
  speech.speak(
    utteranceOf(text.sayIn(spokenDistance(800, useCabin.getState().miles, language === 'tr'), text.turns.right)),
  )
}

/** Speaks the route's turns from now on, ducking `players` under the voice. Returns the function that stops it. */
export function speakGuidance(players: readonly MusicPlayer[]): () => void {
  const speech = window.speechSynthesis
  if (!speech) return () => {}
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
    speech.cancel()
    duck(LOUDNESS[useCabin.getState().voice.level].duck)
    const utterance = utteranceOf(words)
    const over = () => {
      clearTimeout(timer)
      if (id === current) unduck()
    }
    const timer = setTimeout(over, LONGEST_MS)
    utterance.onend = over
    utterance.onerror = over
    speech.speak(utterance)
  }

  const quiet = () => {
    current++
    speech.cancel()
    unduck()
  }

  const stopLive = useLive.subscribe((live) => {
    if (isAway(live)) {
      speech.cancel()
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
    if (rerouted) words = `${text.rerouting}. ${words}`
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
