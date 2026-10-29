//! The natural voices Windows' Narrator downloads (Ava and the like), spoken by ATS GPS itself: the page's own
//! speech (WebView2's) only lists the newer OneCore voices, and those natural ones reach the older SAPI 5 alone,
//! through the NaturalVoiceSAPIAdapter (owner 2026-10-28: "Ava is missing"). The page asks (`speak`), this
//! speaks on a thread of its own and says when it's done (`spoken`), for the music to come back up.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use windows::Win32::Globalization::{LCIDToLocaleName, LOCALE_ALLOW_NEUTRAL_NAMES};
use windows::Win32::Media::Speech::{
    ISpObjectToken, ISpObjectTokenCategory, ISpVoice, SPCAT_VOICES, SPF_ASYNC, SPF_IS_NOT_XML,
    SPF_PURGEBEFORESPEAK, SPRS_DONE, SPVOICESTATUS, SpObjectTokenCategory, SpVoice,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree};
use windows::core::{PCWSTR, PWSTR, w};

/// A voice for the page to list: its name as Windows gives it, and its language ("en-US").
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Voice {
    pub name: String,
    pub lang: String,
}

enum Command {
    Speak { id: u32, text: String, voice: String, volume: u16 },
    Hush,
}

pub struct Sapi {
    commands: Sender<Command>,
    /// The natural voices found as ATS GPS started.
    pub voices: Vec<Voice>,
    /// The ids of the words said to the end (or that couldn't be said).
    pub done: Receiver<u32>,
}

impl Sapi {
    pub fn start() -> Sapi {
        let (commands, received) = mpsc::channel();
        let (finished, done) = mpsc::channel();
        let (found, voices) = mpsc::channel();
        let _ = std::thread::Builder::new().name("sapi".into()).spawn(move || run(received, finished, found));
        // Listing them takes a few milliseconds; a SAPI gone wrong doesn't hold ATS GPS up.
        let voices = voices.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
        Sapi { commands, voices, done }
    }

    /// Says `text` in `voice` (a name from `voices`) at `volume` (0 to 1), cutting off what's being said.
    pub fn speak(&self, id: u32, text: String, voice: String, volume: f32) {
        let volume = (volume.clamp(0.0, 1.0) * 100.0).round() as u16;
        let _ = self.commands.send(Command::Speak { id, text, voice, volume });
    }

    pub fn hush(&self) {
        let _ = self.commands.send(Command::Hush);
    }

    /// `{"type":"sapiVoices","voices":[{"name":…,"lang":"en-US"}]}`, for Settings to list them.
    pub fn voices_message(&self) -> String {
        serde_json::json!({ "type": "sapiVoices", "voices": self.voices }).to_string()
    }
}

fn run(commands: Receiver<Command>, done: Sender<u32>, found: Sender<Vec<Voice>>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let tokens = unsafe { natural_voices() }.unwrap_or_else(|error| {
        crate::log!("sapi: voices not listed: {error}");
        Vec::new()
    });
    let _ = found.send(tokens.iter().map(|(voice, _)| voice.clone()).collect());
    if tokens.is_empty() {
        return;
    }
    let speaker: ISpVoice = match unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) } {
        Ok(speaker) => speaker,
        Err(error) => {
            crate::log!("sapi: no voice: {error}");
            return;
        }
    };
    // The words being said, kept until they're said (SAPI reads them as it speaks), and their id.
    let mut _words: Vec<u16> = Vec::new();
    let mut speaking: Option<u32> = None;
    loop {
        match commands.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::Speak { id, text, voice, volume }) => {
                if let Some((_, token)) = tokens.iter().find(|(found, _)| found.name == voice) {
                    unsafe {
                        let _ = speaker.SetVoice(token);
                        let _ = speaker.SetVolume(volume);
                    }
                }
                let flags = (SPF_ASYNC.0 | SPF_PURGEBEFORESPEAK.0 | SPF_IS_NOT_XML.0) as u32;
                let next: Vec<u16> = text.encode_utf16().chain([0]).collect();
                match unsafe { speaker.Speak(PCWSTR(next.as_ptr()), flags, None) } {
                    Ok(()) => speaking = Some(id),
                    Err(error) => {
                        crate::log!("sapi: not said: {error}");
                        speaking = None;
                        let _ = done.send(id);
                    }
                }
                _words = next;
            }
            Ok(Command::Hush) => {
                unsafe {
                    let _ = speaker.Speak(PCWSTR::null(), SPF_PURGEBEFORESPEAK.0 as u32, None);
                }
                speaking = None;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if let Some(id) = speaking {
            let mut status = SPVOICESTATUS::default();
            let said = unsafe { speaker.GetStatus(&mut status, std::ptr::null_mut()) }.is_err()
                || status.dwRunningState & SPRS_DONE.0 as u32 != 0;
            if said {
                speaking = None;
                let _ = done.send(id);
            }
        }
    }
}

/// SAPI 5's natural voices. shortcut: "Natural" in the name only, as the adapter names them; the others are the
/// same voices the page's own speech already has (as OneCore voices). Upgrade if another kind turns up.
unsafe fn natural_voices() -> windows::core::Result<Vec<(Voice, ISpObjectToken)>> {
    unsafe {
        let category: ISpObjectTokenCategory = CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL)?;
        category.SetId(SPCAT_VOICES, false)?;
        let list = category.EnumTokens(PCWSTR::null(), PCWSTR::null())?;
        let mut count = 0;
        list.GetCount(&mut count)?;
        let mut voices = Vec::new();
        for index in 0..count {
            let Ok(token) = list.Item(index) else { continue };
            let Ok(name) = token.GetStringValue(PCWSTR::null()).map(taken) else { continue };
            if !name.contains("Natural") {
                continue;
            }
            let lcid = token.OpenKey(w!("Attributes")).and_then(|keys| keys.GetStringValue(w!("Language"))).map(taken);
            voices.push((Voice { name, lang: locale_of(&lcid.unwrap_or_default()) }, token));
        }
        Ok(voices)
    }
}

/// SAPI's own string (one it allocated for us, never another), as a `String`, freed.
fn taken(text: PWSTR) -> String {
    unsafe {
        let string = text.to_string().unwrap_or_default();
        CoTaskMemFree(Some(text.0 as _));
        string
    }
}

/// A voice's language as SAPI keeps it (its LCIDs in hex, the first its own: "409;9") as a BCP 47 tag ("en-US").
fn locale_of(lcids: &str) -> String {
    let Ok(lcid) = u32::from_str_radix(lcids.split(';').next().unwrap_or("").trim(), 16) else {
        return String::new();
    };
    let mut name = [0u16; 85];
    let length = unsafe { LCIDToLocaleName(lcid, Some(&mut name), LOCALE_ALLOW_NEUTRAL_NAMES) };
    String::from_utf16_lossy(&name[..(length.max(1) - 1) as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sapi_languages() {
        assert_eq!(locale_of("409;9"), "en-US");
        assert_eq!(locale_of("41F"), "tr-TR");
        assert_eq!(locale_of(""), "");
    }

    /// This PC's natural voices (Narrator's, through the adapter): `cargo test -p westplay-host sapi -- --ignored`.
    #[test]
    #[ignore]
    fn lists_this_pcs_natural_voices() {
        let sapi = Sapi::start();
        println!("{}", sapi.voices_message());
        assert!(!sapi.voices.is_empty());
    }
}
