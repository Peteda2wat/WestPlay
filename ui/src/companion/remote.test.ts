import { describe, expect, it } from 'vitest'
import { comboOf, keyName, mouseButtonName, pressOf } from './remote'

const press = (code: string, held: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  comboOf({ code, ctrlKey: !!held.ctrl, shiftKey: !!held.shift, altKey: !!held.alt })

describe('the button box’s keys', () => {
  it('names keys as the button box does', () => {
    expect(keyName('KeyQ')).toBe('Q')
    expect(keyName('Digit7')).toBe('7')
    expect(keyName('Numpad4')).toBe('Num4')
    expect(keyName('F14')).toBe('F14')
    expect(keyName('ArrowUp')).toBe('Up')
    expect(keyName('Quote')).toBe("'")
    expect(keyName('MetaLeft')).toBeNull()
  })

  it('takes a key with the modifiers held, and a modifier alone', () => {
    expect(press('F8', { shift: true })).toBe('Shift+F8')
    expect(press('F8', { ctrl: true })).toBe('Ctrl+F8')
    expect(press('KeyE')).toBe('E')
    expect(press('ShiftLeft', { shift: true })).toBe('Shift')
    expect(mouseButtonName(3)).toBe('MouseBack')
    expect(mouseButtonName(0)).toBeNull()
  })

  it('reads the log’s presses in words, with their warnings', () => {
    expect(pressOf('21:15:51  engine_start')).toEqual({ time: '21:15:51', what: 'Engine start', warning: null })
    expect(pressOf('21:15:52  lights +1')).toEqual({ time: '21:15:52', what: 'Light switch up', warning: null })
    expect(
      pressOf('21:16:00  service_anywhere   !! went to chrome, not the game: click the game window first'),
    ).toEqual({
      time: '21:16:00',
      what: 'Service',
      warning: 'went to chrome, not the game: click the game window first',
    })
    expect(pressOf('          refuel is now OFF')).toBeNull()
  })
})
