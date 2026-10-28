import { describe, expect, it } from 'vitest'
import { bandOf, pickVoice, spokenDistance } from './guidance'

describe('voice guidance', () => {
  it('says each step far off, close and at it by the time left to it', () => {
    // On the highway (scale 20) at 65 mph (29 m/s): 2 game-km is 100 m, 3.4 s away: close, not far off.
    expect(bandOf(2000, 20, 29)).toBe(1)
    // 30 s at 29 m/s is 870 m in the world, 17.4 game-km: far off from there.
    expect(bandOf(18000, 20, 29)).toBeNull()
    expect(bandOf(17000, 20, 29)).toBe(0)
    expect(bandOf(5000, 20, 29)).toBe(1)
    expect(bandOf(1500, 20, 29)).toBe(2)
    // In town (scale 3) at 30 mph (13 m/s): far off at 390 m, 1.2 game-km.
    expect(bandOf(1300, 3, 13)).toBeNull()
    expect(bandOf(1100, 3, 13)).toBe(0)
  })

  it('still says it stopped or crawling, by how near it is', () => {
    expect(bandOf(1000, 3, 0)).toBeNull()
    expect(bandOf(600, 3, 0)).toBe(0)
    expect(bandOf(200, 3, 0)).toBe(1)
    expect(bandOf(30, 3, 0)).toBe(2)
    // Reversing counts as moving; a scale not known counts as 1.
    expect(bandOf(100, 0, -40)).toBe(2)
  })

  it('says distances as a driver hears them', () => {
    expect(spokenDistance(150, true, false)).toBe('500 feet')
    expect(spokenDistance(1931, true, false)).toBe('1.2 miles')
    expect(spokenDistance(1609, true, false)).toBe('1 mile')
    expect(spokenDistance(580, false, false)).toBe('600 meters')
    expect(spokenDistance(1500, false, true)).toBe('1.5 kilometre')
  })

  it('picks the chosen voice, else the most natural one in the language', () => {
    const voice = (name: string, lang: string, isDefault = false) =>
      ({ name, lang, default: isDefault, localService: true, voiceURI: name }) as SpeechSynthesisVoice
    const voices = [
      voice('Microsoft David - English (United States)', 'en-US', true),
      voice('Microsoft Zira - English (United States)', 'en-US'),
      voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US'),
      voice('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'),
    ]
    expect(pickVoice(voices, 'en-US', null)?.name).toContain('Aria')
    expect(pickVoice(voices, 'en-US', 'Microsoft Zira - English (United States)')?.name).toContain('Zira')
    // A chosen voice gone (uninstalled): the pick again.
    expect(pickVoice(voices, 'en-US', 'Gone')?.name).toContain('Aria')
    expect(pickVoice(voices, 'tr-TR', null)?.name).toContain('Tolga')
    expect(pickVoice([], 'en-US', null)).toBeUndefined()
  })
})
