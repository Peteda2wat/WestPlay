//! Key presses for the game: hardware scan codes through `SendInput`, which games read more reliably than
//! virtual keys. A key combo is written "Y", "F5", "Ctrl+F5" or "Shift+NumPlus"; empty means not bound.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    KEYEVENTF_SCANCODE, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT, SendInput, VIRTUAL_KEY,
    VK_PAUSE,
};
use windows::Win32::UI::WindowsAndMessaging::WHEEL_DELTA;

/// Every key name, its scan code, and whether it's an extended key. The mouse's side buttons are "keys" too:
/// their code is the X button's number.
const KEYS: &[(&str, u16, bool)] = &[
    ("Q", 0x10, false),
    ("W", 0x11, false),
    ("E", 0x12, false),
    ("R", 0x13, false),
    ("T", 0x14, false),
    ("Y", 0x15, false),
    ("U", 0x16, false),
    ("I", 0x17, false),
    ("O", 0x18, false),
    ("P", 0x19, false),
    ("A", 0x1E, false),
    ("S", 0x1F, false),
    ("D", 0x20, false),
    ("F", 0x21, false),
    ("G", 0x22, false),
    ("H", 0x23, false),
    ("J", 0x24, false),
    ("K", 0x25, false),
    ("L", 0x26, false),
    ("Z", 0x2C, false),
    ("X", 0x2D, false),
    ("C", 0x2E, false),
    ("V", 0x2F, false),
    ("B", 0x30, false),
    ("N", 0x31, false),
    ("M", 0x32, false),
    ("1", 0x02, false),
    ("2", 0x03, false),
    ("3", 0x04, false),
    ("4", 0x05, false),
    ("5", 0x06, false),
    ("6", 0x07, false),
    ("7", 0x08, false),
    ("8", 0x09, false),
    ("9", 0x0A, false),
    ("0", 0x0B, false),
    ("F1", 0x3B, false),
    ("F2", 0x3C, false),
    ("F3", 0x3D, false),
    ("F4", 0x3E, false),
    ("F5", 0x3F, false),
    ("F6", 0x40, false),
    ("F7", 0x41, false),
    ("F8", 0x42, false),
    ("F9", 0x43, false),
    ("F10", 0x44, false),
    ("F11", 0x57, false),
    ("F12", 0x58, false),
    // No keyboard has F13-F17 and the game binds none of them: free keys for WestPlay's music keybinds.
    ("F13", 0x64, false),
    ("F14", 0x65, false),
    ("F15", 0x66, false),
    ("F16", 0x67, false),
    ("F17", 0x68, false),
    ("Escape", 0x01, false),
    ("Tab", 0x0F, false),
    ("Backspace", 0x0E, false),
    ("Enter", 0x1C, false),
    ("Space", 0x39, false),
    ("CapsLock", 0x3A, false),
    ("Ctrl", 0x1D, false),
    ("Shift", 0x2A, false),
    ("Alt", 0x38, false),
    ("RightCtrl", 0x1D, true),
    ("RightShift", 0x36, false),
    ("RightAlt", 0x38, true),
    ("Pause", 0x45, false),
    ("ScrollLock", 0x46, false),
    ("-", 0x0C, false),
    ("=", 0x0D, false),
    ("[", 0x1A, false),
    ("]", 0x1B, false),
    (";", 0x27, false),
    ("'", 0x28, false),
    ("`", 0x29, false),
    ("\\", 0x2B, false),
    (",", 0x33, false),
    (".", 0x34, false),
    ("/", 0x35, false),
    ("Num0", 0x52, false),
    ("Num1", 0x4F, false),
    ("Num2", 0x50, false),
    ("Num3", 0x51, false),
    ("Num4", 0x4B, false),
    ("Num5", 0x4C, false),
    ("Num6", 0x4D, false),
    ("Num7", 0x47, false),
    ("Num8", 0x48, false),
    ("Num9", 0x49, false),
    ("NumPlus", 0x4E, false),
    ("NumMinus", 0x4A, false),
    ("NumMultiply", 0x37, false),
    ("NumDot", 0x53, false),
    ("NumDivide", 0x35, true),
    ("NumEnter", 0x1C, true),
    ("Up", 0x48, true),
    ("Down", 0x50, true),
    ("Left", 0x4B, true),
    ("Right", 0x4D, true),
    ("Home", 0x47, true),
    ("End", 0x4F, true),
    ("PageUp", 0x49, true),
    ("PageDown", 0x51, true),
    ("Insert", 0x52, true),
    ("Delete", 0x53, true),
    ("MouseBack", 1, false),
    ("MouseForward", 2, false),
    // The wheel: one notch a press (its code unused).
    ("WheelUp", 0, false),
    ("WheelDown", 0, false),
];

fn key(name: &str) -> Option<&'static (&'static str, u16, bool)> {
    KEYS.iter().find(|(known, ..)| known.eq_ignore_ascii_case(name))
}

/// The keys of a combo, in its own spelling's place the table's ("ctrl+f5" is Ctrl, F5); empty for none.
pub fn parse(combo: &str) -> Result<Vec<&'static str>, String> {
    if combo.trim().is_empty() {
        return Ok(Vec::new());
    }
    combo
        .split('+')
        .map(|part| {
            key(part.trim())
                .map(|(name, ..)| *name)
                .ok_or_else(|| format!("Unknown key \"{}\" in \"{combo}\"", part.trim()))
        })
        .collect()
}

/// A combo as the table spells it ("ctrl+f5" → "Ctrl+F5"), or the reason it isn't one.
pub fn normalize(combo: &str) -> Result<String, String> {
    parse(combo).map(|keys| keys.join("+"))
}

/// Every key name, for the window's key picker.
pub fn names() -> impl Iterator<Item = &'static str> {
    KEYS.iter().map(|(name, ..)| *name)
}

pub struct Keyboard {
    /// Test mode: say what would be pressed and press nothing.
    pub dry_run: AtomicBool,
    gate: Mutex<()>,
    log: fn(String),
}

impl Keyboard {
    pub fn new(log: fn(String)) -> Self {
        Self { dry_run: AtomicBool::new(false), gate: Mutex::new(()), log }
    }

    pub fn press(&self, combo: &str) {
        let Ok(keys) = parse(combo) else { return };
        let _gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        for name in keys {
            self.emit(name, false);
        }
    }

    pub fn release(&self, combo: &str) {
        let Ok(keys) = parse(combo) else { return };
        let _gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        for name in keys.into_iter().rev() {
            self.emit(name, true);
        }
    }

    /// Games read input once a frame, so a key stays down a moment to be seen.
    pub fn tap(&self, combo: &str) {
        if parse(combo).is_ok_and(|keys| !keys.is_empty()) {
            self.press(combo);
            std::thread::sleep(Duration::from_millis(50));
            self.release(combo);
        }
    }

    fn emit(&self, name: &str, up: bool) {
        let Some(&(_, code, extended)) = key(name) else { return };
        if self.dry_run.load(Ordering::Relaxed) {
            if !up {
                (self.log)(format!("          test mode, would press {name}"));
            }
            return;
        }
        let input = if name.starts_with("Wheel") {
            // A notch has no "up": nothing to release.
            if up {
                return;
            }
            let notch = if name == "WheelUp" { WHEEL_DELTA as i32 } else { -(WHEEL_DELTA as i32) };
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT { mouseData: notch as u32, dwFlags: MOUSEEVENTF_WHEEL, ..Default::default() },
                },
            }
        } else if name.starts_with("Mouse") {
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        mouseData: u32::from(code),
                        dwFlags: if up { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN },
                        ..Default::default()
                    },
                },
            }
        } else {
            // Pause has no plain scan code (the keyboard sends a sequence), so it goes as a virtual key.
            let pause = name == "Pause";
            let mut flags = if pause { KEYBD_EVENT_FLAGS(0) } else { KEYEVENTF_SCANCODE };
            if extended && !pause {
                flags |= KEYEVENTF_EXTENDEDKEY;
            }
            if up {
                flags |= KEYEVENTF_KEYUP;
            }
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: if pause { VK_PAUSE } else { VIRTUAL_KEY(0) },
                        wScan: code,
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            }
        };
        // SAFETY: one fully initialised INPUT, its size given as Windows expects.
        unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_combos_however_typed_and_names_what_it_cant() {
        assert_eq!(parse("ctrl+f5"), Ok(vec!["Ctrl", "F5"]));
        assert_eq!(parse(" Shift + NumPlus "), Ok(vec!["Shift", "NumPlus"]));
        assert_eq!(parse(""), Ok(vec![]));
        assert_eq!(normalize("shift+f8").as_deref(), Ok("Shift+F8"));
        assert_eq!(normalize("mouseback").as_deref(), Ok("MouseBack"));
        assert_eq!(normalize("wheelup").as_deref(), Ok("WheelUp"));
        assert!(parse("Ctrl+Banana").unwrap_err().contains("Banana"));
    }

    #[test]
    fn every_key_is_named_once() {
        let mut seen = std::collections::HashSet::new();
        assert!(names().all(|name| seen.insert(name.to_ascii_lowercase())));
    }
}
