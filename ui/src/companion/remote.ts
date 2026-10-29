/**
 * The iPad's button box (the app's `westplay_buttonbox`, once Truck Remote): its state for the Truck Remote
 * page, its key bindings for the Buttons page, and the key a press in the window makes, in its key names.
 */

/** The iPad's buttons, as its page groups them, by their names in the bindings. */
export const BUTTON_GROUPS: { title: string; buttons: [name: string, label: string, detail?: string][] }[] = [
  {
    title: 'Engine and lights',
    buttons: [
      ['power_toggle', 'Ignition', 'Electrics on and off'],
      ['engine_toggle', 'Engine'],
      ['lights_up', 'Light switch'],
      ['lights_down', 'Light switch back', 'No key: the switch goes round instead'],
      ['high_beam', 'High beam'],
      ['beacon', 'Beacon'],
      ['hazard', 'Hazards'],
    ],
  },
  {
    title: 'Key grid',
    buttons: [
      ['window_left_close', 'Left window up'],
      ['window_left_open', 'Left window down'],
      ['window_right_close', 'Right window up'],
      ['window_right_open', 'Right window down'],
      ['refuel', 'Refuel', 'Held until tapped again'],
      ['trailer_attach', 'Attach trailer'],
      ['garage', 'Garage'],
      ['mirrors', 'Mirrors'],
      ['seat_adjust', 'Adjust seat'],
      ['pause', 'Pause'],
      ['dash_mode', 'Dash mode'],
      ['info_mode', 'Info mode'],
      ['camera_cab', 'In-cab camera'],
      ['camera_chase', 'Chase camera'],
      ['trip_reset', 'Trip reset'],
      ['activate_overlay', 'Activate overlay'],
      ['sleep_anywhere', 'Sleep', 'SleepAnywhere plugin'],
      ['service_anywhere', 'Service', 'ServiceAnywhere plugin: the full service area'],
      ['escape', 'Escape'],
      ['confirm', 'Confirm'],
      ['navigation', 'Nav'],
      ['nav_zoom_out', 'Zoom −', 'The Nav map: mouse wheel down'],
      ['nav_zoom_in', 'Zoom +', 'The Nav map: mouse wheel up'],
    ],
  },
  {
    title: 'Music (ATS GPS’s keys)',
    buttons: [
      ['music_volume_down', 'Volume down'],
      ['music_previous', 'Rewind'],
      ['music_play_pause', 'Play / pause'],
      ['music_next', 'Skip'],
      ['music_volume_up', 'Volume up'],
    ],
  },
  {
    title: 'Driving',
    buttons: [
      ['cruise_toggle', 'Cruise on / off'],
      ['cruise_up', 'Cruise faster'],
      ['cruise_down', 'Cruise slower'],
      ['cruise_resume', 'Cruise resume'],
      ['retarder_up', 'Retarder up'],
      ['retarder_down', 'Retarder down'],
      ['engine_brake', 'Engine brake'],
      ['engine_brake_up', 'Engine brake stronger'],
      ['engine_brake_down', 'Engine brake weaker'],
      ['wipers_up', 'Wipers faster'],
      ['wipers_down', 'Wipers slower'],
    ],
  },
  {
    title: 'Axles, suspension and brakes',
    buttons: [
      ['diff_lock', 'Diff lock'],
      ['lift_axle', 'Lift axle'],
      ['trailer_lift_axle', 'Trailer lift axle'],
      ['suspension_front_up', 'Front up'],
      ['suspension_front_down', 'Front down'],
      ['suspension_rear_up', 'Rear up'],
      ['suspension_rear_down', 'Rear down'],
      ['suspension_reset', 'Suspension reset'],
      ['parking_brake', 'Parking brake'],
      ['trailer_detach', 'Trailer supply', 'Pull to drop the trailer'],
    ],
  },
]

/** A key of the keyboard as the button box names it (`KeyboardEvent.code`), or none it can press. */
const NAMED: Record<string, string> = {
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Space: 'Space',
  CapsLock: 'CapsLock',
  Pause: 'Pause',
  ScrollLock: 'ScrollLock',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'NumPlus',
  NumpadSubtract: 'NumMinus',
  NumpadMultiply: 'NumMultiply',
  NumpadDivide: 'NumDivide',
  NumpadDecimal: 'NumDot',
  NumpadEnter: 'NumEnter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  ControlLeft: 'Ctrl',
  ControlRight: 'RightCtrl',
  ShiftLeft: 'Shift',
  ShiftRight: 'RightShift',
  AltLeft: 'Alt',
  AltRight: 'RightAlt',
}

export function keyName(code: string): string | null {
  const match = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d)|(F\d{1,2}))$/.exec(code)
  if (match) return match[1] ?? match[2] ?? (match[3] !== undefined ? `Num${match[3]}` : match[4])
  return NAMED[code] ?? null
}

const MODIFIERS = new Set(['Ctrl', 'RightCtrl', 'Shift', 'RightShift', 'Alt', 'RightAlt'])
export const isModifier = (name: string) => MODIFIERS.has(name)

/** A key pressed with the modifiers held ("Ctrl+F8"); a modifier alone is the modifier. */
export function comboOf(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string | null {
  const key = keyName(event.code)
  if (key === null) return null
  if (isModifier(key)) return key
  const held = [event.ctrlKey && 'Ctrl', event.shiftKey && 'Shift', event.altKey && 'Alt'].filter(Boolean)
  return [...held, key].join('+')
}

/** The mouse's side buttons, which the game binds too. */
export function mouseButtonName(button: number): string | null {
  return button === 3 ? 'MouseBack' : button === 4 ? 'MouseForward' : null
}

/** A line of the button box's log ("21:15:51  engine_start   !! went to chrome…"): its time, what was pressed
 * in words, and any warning; `null` for its other lines (test mode's, refuel's). */
export function pressOf(line: string): { time: string; what: string; warning: string | null } | null {
  const match = /^(\d\d:\d\d:\d\d) {2}(\S+)( [+-]1)?(?: {3}!! (.*))?$/.exec(line)
  if (!match) return null
  const [, time, action, way, warning] = match
  const named = BUTTON_GROUPS.flatMap((group) => group.buttons).find(([name]) => name === action)?.[1]
  const what =
    PRESS_WORDS[action] ??
    named ??
    action
      .replace(/^(hold|release):/, '')
      .replaceAll('_', ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  return { time, what: way ? `${what} ${way.trim() === '+1' ? 'up' : 'down'}` : what, warning: warning ?? null }
}

const PRESS_WORDS: Record<string, string> = {
  engine_start: 'Engine start',
  engine_stop: 'Engine stop',
  power_on: 'Ignition on',
  power_off: 'Ignition off',
  cruise_on: 'Cruise on',
  cruise_off: 'Cruise off',
  lights: 'Light switch',
  lights_next: 'Light switch',
  reset_state: 'Reset states',
  trailer_axle_up: 'Trailer axle up',
  trailer_axle_down: 'Trailer axle down',
}
