//! The button box's settings (`buttonbox.json` in the app's folder): the port, refuel's way, and each button's
//! key; and the connect code (`token.txt`). On the first start both come from Truck Remote's folder when it's
//! there (owner 2026-10-27: one program, the iPad keeping its code), else from the defaults.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::controller::REQUIRED;
use crate::keys;

const DEFAULTS: &str = include_str!("../defaults.json");

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub port: u16,
    /// "hold" (Enter held down) or "repeat" (tapped every `refuel_repeat_ms`).
    pub refuel_mode: String,
    pub refuel_repeat_ms: u64,
    pub bindings: BTreeMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Self { port: 8765, refuel_mode: "hold".into(), refuel_repeat_ms: 150, bindings: BTreeMap::new() }
    }
}

/// Truck Remote's folder, where it ran before it was part of this app.
fn truck_remote_folder() -> Option<PathBuf> {
    let folder = PathBuf::from(std::env::var_os("USERPROFILE")?).join(r"Downloads\Truck Remote\TruckRemote");
    folder.is_dir().then_some(folder)
}

/// Truck Remote's `config.json`: the same fields, with notes (keys starting "_") among the bindings.
fn from_truck_remote(text: &str) -> Option<Config> {
    let mut config: Config = serde_json::from_str(text).ok()?;
    config.bindings.retain(|name, _| !name.starts_with('_'));
    Some(config)
}

/// The settings, and what was wrong with them (a key name not known: that button left without a key).
pub fn load(dir: &Path) -> (Config, Vec<String>) {
    let file = dir.join("buttonbox.json");
    let mut config = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .or_else(|| {
            let old = std::fs::read_to_string(truck_remote_folder()?.join("config.json")).ok()?;
            from_truck_remote(&old)
        })
        .unwrap_or_else(|| serde_json::from_str(DEFAULTS).expect("the defaults read"));
    let problems = tidy(&mut config);
    save(dir, &config);
    (config, problems)
}

/// Every button the controller presses has an entry, every key as the table spells it; a key not known is
/// cleared and said.
fn tidy(config: &mut Config) -> Vec<String> {
    // Buttons added since the settings were saved get their default key (Nav zoom + / -, 2026-10-29).
    let defaults: Config = serde_json::from_str(DEFAULTS).expect("the defaults read");
    for (name, combo) in defaults.bindings {
        config.bindings.entry(name).or_insert(combo);
    }
    for name in REQUIRED {
        config.bindings.entry(name.to_owned()).or_default();
    }
    if config.refuel_mode != "hold" && config.refuel_mode != "repeat" {
        config.refuel_mode = "hold".into();
    }
    let mut problems = Vec::new();
    for (name, combo) in &mut config.bindings {
        match keys::normalize(combo) {
            Ok(normal) => *combo = normal,
            Err(e) => {
                problems.push(format!("{name}: {e}"));
                combo.clear();
            }
        }
    }
    problems
}

pub fn save(dir: &Path, config: &Config) {
    if let Ok(text) = serde_json::to_string_pretty(config) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(dir.join("buttonbox.json"), text + "\n");
    }
}

/// The connect code the iPad asks for: kept, or Truck Remote's, or a new one.
pub fn token(dir: &Path) -> String {
    let file = dir.join("token.txt");
    let kept = |path: &Path| {
        std::fs::read_to_string(path).ok().map(|code| code.trim().to_owned()).filter(|code| !code.is_empty())
    };
    if let Some(code) = kept(&file) {
        return code;
    }
    let code = truck_remote_folder().and_then(|folder| kept(&folder.join("token.txt"))).unwrap_or_else(new_token);
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(&file, &code);
    code
}

/// Six letters and digits, none that look alike (1/l, 0/o).
fn new_token() -> String {
    const LETTERS: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut bytes = [0u8; 6];
    // SAFETY: fills the buffer given, with the system's preferred random source.
    let _ = unsafe {
        windows::Win32::Security::Cryptography::BCryptGenRandom(
            None,
            &mut bytes,
            windows::Win32::Security::Cryptography::BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    bytes.iter().map(|b| char::from(LETTERS[usize::from(*b) % LETTERS.len()])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_truck_remotes_config_without_its_notes() {
        let old = r#"{"_help":"…","port":8765,"refuel_mode":"repeat","bindings":{"_lights":"","beacon":"O","service_anywhere":"shift+f8","wipers_up":"Banana"}}"#;
        let mut config = from_truck_remote(old).unwrap();
        assert_eq!(config.refuel_mode, "repeat");
        assert!(!config.bindings.contains_key("_lights"));
        let problems = tidy(&mut config);
        assert_eq!(config.bindings["service_anywhere"], "Shift+F8");
        assert_eq!(config.bindings["wipers_up"], "");
        assert_eq!(problems.len(), 1);
        assert!(REQUIRED.iter().all(|name| config.bindings.contains_key(*name)));
    }

    #[test]
    fn the_defaults_read_and_need_no_fixing() {
        let mut config: Config = serde_json::from_str(DEFAULTS).unwrap();
        assert_eq!(config.port, 8765);
        assert_eq!(tidy(&mut config), Vec::<String>::new());
    }

    #[test]
    fn a_new_code_has_six_plain_characters() {
        let code = new_token();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric() && !"lo01".contains(c)));
    }
}
