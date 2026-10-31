import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME, moveEntry, showEntry, toHome, widgetOf } from './home'

describe('Home order', () => {
  it('comes with every app and the widgets off', () => {
    expect(toHome(undefined)).toEqual(DEFAULT_HOME)
    expect(DEFAULT_HOME.filter((entry) => entry.shown).map((entry) => entry.item)).toEqual([
      'maps',
      'music',
      'spotify',
      'youtube',
      'youtubeMusic',
      'weather',
      'settings',
    ])
    expect(widgetOf('widget:weather')).toBe('weather')
    expect(widgetOf('weather')).toBeNull()
  })

  it('keeps the order stored, drops what Home can no longer hold, and adds what is new', () => {
    const home = toHome([
      { item: 'spotify', shown: true },
      { item: 'phone', shown: true }, // not released
      { item: 'widget:weather', shown: true },
      { item: 'spotify', shown: false }, // twice
      { item: 'nonsense' },
      'maps',
      { item: 'maps', shown: false },
    ])
    expect(home.slice(0, 3)).toEqual([
      { item: 'spotify', shown: true },
      { item: 'widget:weather', shown: true },
      { item: 'maps', shown: false },
    ])
    expect(home).toHaveLength(DEFAULT_HOME.length)
  })

  it('never hides Settings', () => {
    expect(toHome([{ item: 'settings', shown: false }])[0]).toEqual({ item: 'settings', shown: true })
    expect(showEntry(DEFAULT_HOME, 'settings', false).find((e) => e.item === 'settings')?.shown).toBe(true)
    expect(showEntry(DEFAULT_HOME, 'maps', false)[0]).toEqual({ item: 'maps', shown: false })
  })

  it('moves an entry within the list', () => {
    expect(
      moveEntry(DEFAULT_HOME, 1, -1)
        .slice(0, 2)
        .map((e) => e.item),
    ).toEqual(['music', 'maps'])
    expect(moveEntry(DEFAULT_HOME, 0, -1)).toEqual(DEFAULT_HOME)
    const last = DEFAULT_HOME.length - 1
    expect(moveEntry(DEFAULT_HOME, last, 1)).toEqual(DEFAULT_HOME)
  })
})
