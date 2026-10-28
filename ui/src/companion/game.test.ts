import { afterEach, describe, expect, it } from 'vitest'
import { forGame, setGameKind } from './game'

describe('forGame', () => {
  afterEach(() => setGameKind('ets2'))

  const words = { found: 'ATS GPS found Euro Truck Simulator 2.', nested: { list: ['Euro Truck Simulator 2', 3] } }

  it('gives ETS2 the words as written', () => {
    expect(forGame(words)).toBe(words)
  })

  it('names ATS in every string, nested ones too, once worked out', () => {
    setGameKind('ats')
    const ats = forGame(words)
    expect(ats).toEqual({
      found: 'ATS GPS found American Truck Simulator.',
      nested: { list: ['American Truck Simulator', 3] },
    })
    expect(forGame(words)).toBe(ats)
    expect(words.found).toContain('Euro Truck Simulator 2')
  })
})
