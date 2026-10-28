//! The iPad's button box, once Truck Remote (owner 2026-10-27: one program): the iPad's buttons pressed as the
//! game's keys, their lamps lit from the game, and the iPad's page served on the home network beside WestPlay's
//! screen. The window's Truck Remote and Buttons pages show and set it (app `buttonbox` commands).

mod config;
mod controller;
mod foreground;
mod keys;
pub mod log;
mod server;
mod telemetry;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use controller::Controller;
use keys::Keyboard;
use telemetry::Telemetry;

pub use keys::names as key_names;

/// The iPad counts as connected while it asked something this recently (it asks for the lamps 4 times a
/// second while the game runs, every 2 s otherwise).
const IPAD_GONE: Duration = Duration::from_secs(5);

pub struct ButtonBox {
    dir: PathBuf,
    config: Mutex<config::Config>,
    controller: Arc<Controller>,
    keyboard: Arc<Keyboard>,
    telemetry: Arc<Telemetry>,
    token: String,
    port: u16,
    ipad: Mutex<Option<Instant>>,
}

/// What the window's Truck Remote page shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Where the iPad finds this PC ("192.168.1.20:8765").
    pub address: String,
    pub code: String,
    pub ipad: bool,
    /// The program in front: "game", "elevated" (the game run as administrator: keys blocked), another's
    /// name, or none.
    pub in_front: Option<String>,
    /// Where the lamps come from: "game" (the game running, its telemetry plugin read), "waiting" (the game
    /// closed or still starting), "no plugin" (the game running without the telemetry plugin).
    pub lamps: &'static str,
    pub test_mode: bool,
}

impl ButtonBox {
    /// Starts the button box with its settings in `dir`; the error says why it can't (the port taken).
    pub fn start(dir: &Path) -> Result<Arc<Self>, String> {
        log::keep_in(dir.join("buttonbox.log"));
        let (config, problems) = config::load(dir);
        for problem in problems {
            log::write(format!("{}  key bindings: {problem} (that button has no key now)", log::now()));
        }
        let keyboard = Arc::new(Keyboard::new(log::write));
        let telemetry = Arc::new(Telemetry::default());
        let controller = Controller::new(
            Arc::new(RwLock::new(config.bindings.clone())),
            keyboard.clone(),
            telemetry.clone(),
            config.refuel_mode == "hold",
            Duration::from_millis(config.refuel_repeat_ms.clamp(30, 2000)),
        );
        let port = config.port;
        let box_ = Arc::new(Self {
            dir: dir.to_owned(),
            config: Mutex::new(config),
            controller,
            keyboard,
            telemetry,
            token: config::token(dir),
            port,
            ipad: Mutex::new(None),
        });
        server::start(port, box_.clone()).map_err(|e| format!("port {port} is in use ({e})"))?;
        log::write(format!(
            "{}  Ready for the iPad at {}. Click into the game so it gets the key presses.",
            log::now(),
            box_.address()
        ));
        Ok(box_)
    }

    fn ipad_seen(&self) {
        *self.ipad.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    }

    fn address(&self) -> String {
        format!("{}:{}", lan_address().unwrap_or_else(|| "this PC's address".into()), self.port)
    }

    pub fn status(&self) -> Status {
        let ipad = self.ipad.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|seen| seen.elapsed() < IPAD_GONE);
        let in_front = foreground::program().map(|program| match program {
            foreground::Program::Game => "game".to_owned(),
            foreground::Program::Elevated => "elevated".to_owned(),
            foreground::Program::Other(name) => name,
        });
        // The plugin's map is there only while the game runs: missing then, it isn't installed; with the game
        // closed, nothing can be said of it (owner 2026-10-28: "plugin missing" with the game closed misled).
        let lamps = if self.telemetry.live().is_some() {
            "game"
        } else if self.telemetry.plugin_found() || !foreground::game_running() {
            "waiting"
        } else {
            "no plugin"
        };
        Status {
            address: self.address(),
            code: self.token.to_ascii_uppercase(),
            ipad,
            in_front,
            lamps,
            test_mode: self.keyboard.dry_run.load(Ordering::Relaxed),
        }
    }

    pub fn set_test_mode(&self, on: bool) {
        self.keyboard.dry_run.store(on, Ordering::Relaxed);
        log::write(format!(
            "{}  Test mode {}",
            log::now(),
            if on { "on: nothing is pressed in the game" } else { "off" }
        ));
    }

    pub fn bindings(&self) -> BTreeMap<String, String> {
        self.controller.bindings.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Gives a button another key ("" for none); returns the key as the table spells it.
    pub fn set_binding(&self, name: &str, combo: &str) -> Result<String, String> {
        let combo = keys::normalize(combo)?;
        let mut config = self.config.lock().unwrap_or_else(|e| e.into_inner());
        if !config.bindings.contains_key(name) {
            return Err(format!("Unknown button \"{name}\""));
        }
        config.bindings.insert(name.to_owned(), combo.clone());
        self.controller.bindings.write().unwrap_or_else(|e| e.into_inner()).insert(name.to_owned(), combo.clone());
        config::save(&self.dir, &config);
        log::write(format!("{}  {name} is now {}", log::now(), if combo.is_empty() { "unset" } else { &combo }));
        Ok(combo)
    }

    /// Lets go of every key held (the app quitting).
    pub fn shutdown(&self) {
        self.controller.shutdown();
    }
}

/// This PC's address on the home network: the one a packet out would leave from (none is sent).
fn lan_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("10.255.255.255:1").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    use super::*;

    /// The whole box as the iPad meets it, on a port of its own, in test mode (nothing pressed in the game).
    #[test]
    fn serves_the_ipad_its_page_lamps_and_buttons_behind_the_code() {
        let dir = std::env::temp_dir().join(format!("buttonbox-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("buttonbox.json"), r#"{"port":18765,"bindings":{"engine_toggle":"E","beacon":"O"}}"#)
            .unwrap();
        std::fs::write(dir.join("token.txt"), "abc234").unwrap();
        let box_ = ButtonBox::start(&dir).expect("started");
        box_.set_test_mode(true);
        let ask = |request: String| {
            let mut stream = std::net::TcpStream::connect(("127.0.0.1", 18765)).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut answer = String::new();
            let _ = stream.read_to_string(&mut answer);
            answer
        };
        let get = |path: &str, code: &str| {
            ask(format!("GET {path} HTTP/1.1\r\nX-Token: {code}\r\nConnection: close\r\n\r\n"))
        };
        assert!(get("/", "").contains("<title>ATS GPS</title>"));
        assert!(get("/api/state", "nope").starts_with("HTTP/1.1 401"));
        // The code however it's typed (the window shows it in capitals).
        assert!(get("/api/state", "ABC234").contains(r#""live":false"#));
        let body = r#"{"action":"engine_start"}"#;
        let pressed = ask(format!(
            "POST /api/action HTTP/1.1\r\nX-Token: abc234\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));
        assert!(pressed.contains(r#""engine":true"#), "{pressed}");
        assert!(log::recent(10).iter().any(|line| line.contains("engine_start")));
        // This PC's own requests aren't the iPad's.
        assert!(!box_.status().ipad);
        assert_eq!(box_.set_binding("beacon", "shift+o").as_deref(), Ok("Shift+O"));
        assert!(std::fs::read_to_string(dir.join("buttonbox.json")).unwrap().contains("Shift+O"));
        assert!(box_.set_binding("beacon", "Banana").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
