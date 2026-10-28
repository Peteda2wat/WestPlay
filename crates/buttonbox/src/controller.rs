//! The iPad's buttons as the game's keys, and what the truck is doing for its lamps. The game has one key for
//! the engine, the power and cruise, so "start the engine" presses it only with the engine off: the game says
//! (telemetry) when the plugin runs; without it the box remembers, and Reset states sets that right.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::keys::Keyboard;
use crate::log;
use crate::telemetry::{Telemetry, Truck};

/// Bindings the controller presses itself; every other binding is a plain button named as its action.
pub const REQUIRED: [&str; 6] =
    ["engine_toggle", "power_toggle", "cruise_toggle", "lights_up", "lights_down", "refuel"];
/// Bindings no button taps straight (the light switch and refuel have their own actions).
const NOT_TAPPABLE: [&str; 3] = ["lights_up", "lights_down", "refuel"];
const LIGHT_NAMES: [&str; 3] = ["Off", "Parking", "Low beam"];
/// A held key ("hold:<button>", suspension) the iPad hasn't renewed for this long is let go: no key stays stuck
/// when the iPad sleeps or the Wi-Fi drops.
const HOLD: Duration = Duration::from_millis(1500);
/// Refuel holds Activate (Enter) until pressed again; a forgotten one is let go once it can't be needed: tank
/// full, truck moving (m/s, about 3.6 km/h), the game gone, or after this long.
const REFUEL_LONGEST: Duration = Duration::from_secs(180);
const REFUEL_MOVING: f32 = 1.0;

pub type Bindings = Arc<RwLock<BTreeMap<String, String>>>;

pub struct Controller {
    pub bindings: Bindings,
    keyboard: Arc<Keyboard>,
    telemetry: Arc<Telemetry>,
    refuel_hold: bool,
    refuel_interval: Duration,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    engine: bool,
    power: bool,
    cruise: bool,
    lights: u8,
    held: HashMap<String, Instant>,
    /// Refuel going: since when, and (tapping) the flag that stops its thread.
    refuel: Option<(Instant, Option<Arc<std::sync::atomic::AtomicBool>>)>,
}

impl Controller {
    pub fn new(
        bindings: Bindings,
        keyboard: Arc<Keyboard>,
        telemetry: Arc<Telemetry>,
        refuel_hold: bool,
        refuel_interval: Duration,
    ) -> Arc<Self> {
        let controller = Arc::new(Self {
            bindings,
            keyboard,
            telemetry,
            refuel_hold,
            refuel_interval,
            state: Mutex::new(State::default()),
        });
        let watched = Arc::downgrade(&controller);
        std::thread::Builder::new()
            .name("buttonbox-watchdog".into())
            .spawn(move || {
                while let Some(controller) = watched.upgrade() {
                    controller.watch();
                    drop(controller);
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
            .expect("a thread");
        controller
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn binding(&self, name: &str) -> String {
        self.bindings.read().unwrap_or_else(|e| e.into_inner()).get(name).cloned().unwrap_or_default()
    }

    /// Lets go of held keys the iPad stopped renewing, and of a refuel that can't be needed any more.
    fn watch(&self) {
        let mut state = self.state();
        let now = Instant::now();
        let expired: Vec<String> =
            state.held.iter().filter(|(_, until)| **until < now).map(|(n, _)| n.clone()).collect();
        for name in expired {
            self.let_go(&mut state, &name);
        }
        if let Some((since, _)) = state.refuel
            && let Some(why) = refuel_done(since.elapsed(), self.telemetry.live())
        {
            self.stop_refuel(&mut state);
            log::write(format!("{}  refuel auto-OFF ({why})", log::now()));
        }
    }

    /// Does what a button asks (`delta`: the light switch's way) and returns the lamps' state.
    pub fn handle(&self, action: &str, delta: i32) -> Result<Value, String> {
        let mut state = self.state();
        let renewing = action.strip_prefix("hold:").is_some_and(|name| state.held.contains_key(name));
        if !renewing {
            let way = if action == "lights" { if delta > 0 { " +1" } else { " -1" } } else { "" };
            log::write(format!("{}  {action}{way}{}", log::now(), focus_warning()));
        }
        let live = self.telemetry.live();
        match action {
            "engine_start" | "engine_stop" => {
                let now = live.map_or(state.engine, |t| t.engine);
                state.engine = self.toggle(now, action == "engine_start", "engine_toggle");
            }
            "power_on" | "power_off" => {
                let now = live.map_or(state.power, |t| t.electric);
                state.power = self.toggle(now, action == "power_on", "power_toggle");
            }
            "cruise_on" | "cruise_off" => {
                let now = live.map_or(state.cruise, |t| t.cruise);
                state.cruise = self.toggle(now, action == "cruise_on", "cruise_toggle");
            }
            "lights_next" => {
                if let Some(truck) = live {
                    state.lights = truck.light_level();
                }
                self.tap("lights_up");
                state.lights = (state.lights + 1) % LIGHT_NAMES.len() as u8;
            }
            "lights" => {
                if delta != 1 && delta != -1 {
                    return Err("lights needs delta 1 or -1".into());
                }
                if let Some(truck) = live {
                    state.lights = truck.light_level();
                }
                let next = (i32::from(state.lights) + delta).clamp(0, LIGHT_NAMES.len() as i32 - 1) as u8;
                if next != state.lights {
                    if delta > 0 || !self.binding("lights_down").trim().is_empty() {
                        self.tap(if delta > 0 { "lights_up" } else { "lights_down" });
                    } else {
                        // The game's light key only cycles forward (off, parking, low, off...): one step back
                        // is the whole way round.
                        for step in 0..LIGHT_NAMES.len() - 1 {
                            if step > 0 {
                                std::thread::sleep(Duration::from_millis(80));
                            }
                            self.tap("lights_up");
                        }
                    }
                    state.lights = next;
                }
            }
            "refuel" => {
                if state.refuel.is_some() {
                    self.stop_refuel(&mut state);
                } else {
                    self.start_refuel(&mut state);
                }
                let on = state.refuel.is_some();
                log::write(format!(
                    "          refuel is now {}",
                    if on { "ON (sending until pressed again)" } else { "OFF" }
                ));
            }
            "reset_state" => (state.engine, state.power, state.cruise, state.lights) = (false, false, false, 0),
            // The trailer's lift axle key toggles: up and down press it only when the axle is the other way
            // (without telemetry they just toggle).
            "trailer_axle_up" | "trailer_axle_down" => {
                let up = action == "trailer_axle_up";
                if live.is_none_or(|truck| truck.trailer_lift_axle != up) {
                    self.tap("trailer_lift_axle");
                } else {
                    log::write(format!("          trailer axle is already {}", if up { "up" } else { "down" }));
                }
            }
            _ => {
                if let Some(name) = action.strip_prefix("hold:") {
                    self.hold(&mut state, name)?;
                } else if let Some(name) = action.strip_prefix("release:") {
                    self.let_go(&mut state, name);
                } else {
                    if !self.bindings.read().unwrap_or_else(|e| e.into_inner()).contains_key(action)
                        || NOT_TAPPABLE.contains(&action)
                    {
                        return Err(format!("Unknown button \"{action}\""));
                    }
                    self.tap(action);
                    // A toggle key pressed straight flips what's remembered (telemetry overrides it anyway).
                    match action {
                        "engine_toggle" => state.engine = !state.engine,
                        "power_toggle" => state.power = !state.power,
                        "cruise_toggle" => state.cruise = !state.cruise,
                        _ => {}
                    }
                }
            }
        }
        Ok(self.lamps(&mut state))
    }

    pub fn snapshot(&self) -> Value {
        let mut state = self.state();
        self.lamps(&mut state)
    }

    /// Lets go of every key held (the program quitting).
    pub fn shutdown(&self) {
        let mut state = self.state();
        self.stop_refuel(&mut state);
        let held: Vec<String> = state.held.keys().cloned().collect();
        for name in held {
            self.let_go(&mut state, &name);
        }
    }

    fn toggle(&self, now: bool, wanted: bool, binding: &str) -> bool {
        if now != wanted {
            self.tap(binding);
        }
        wanted
    }

    fn tap(&self, binding: &str) {
        let combo = self.binding(binding);
        if combo.trim().is_empty() {
            log::write(format!("          (no key set for \"{binding}\")"));
        }
        self.keyboard.tap(&combo);
    }

    fn hold(&self, state: &mut State, name: &str) -> Result<(), String> {
        let combo = {
            let bindings = self.bindings.read().unwrap_or_else(|e| e.into_inner());
            match bindings.get(name) {
                Some(combo) if !NOT_TAPPABLE.contains(&name) => combo.clone(),
                _ => return Err(format!("Unknown button \"{name}\"")),
            }
        };
        if !state.held.contains_key(name) && !combo.trim().is_empty() {
            self.keyboard.press(&combo);
        }
        state.held.insert(name.to_owned(), Instant::now() + HOLD);
        Ok(())
    }

    fn let_go(&self, state: &mut State, name: &str) {
        if state.held.remove(name).is_some() {
            self.keyboard.release(&self.binding(name));
        }
    }

    fn start_refuel(&self, state: &mut State) {
        let combo = self.binding("refuel");
        if self.refuel_hold {
            self.keyboard.press(&combo);
            state.refuel = Some((Instant::now(), None));
            return;
        }
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (keyboard, stopped, interval) = (self.keyboard.clone(), stop.clone(), self.refuel_interval);
        let _ = std::thread::Builder::new().name("buttonbox-refuel".into()).spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                keyboard.tap(&combo);
                std::thread::sleep(interval);
            }
        });
        state.refuel = Some((Instant::now(), Some(stop)));
    }

    fn stop_refuel(&self, state: &mut State) {
        match state.refuel.take() {
            Some((_, Some(stop))) => stop.store(true, Ordering::Relaxed),
            Some((_, None)) => self.keyboard.release(&self.binding("refuel")),
            None => {}
        }
    }

    /// The lamps: what the game says while it runs (the plugin), else what's remembered.
    fn lamps(&self, state: &mut State) -> Value {
        let live = self.telemetry.live();
        if let Some(truck) = live {
            (state.engine, state.power, state.cruise, state.lights) =
                (truck.engine, truck.electric, truck.cruise, truck.light_level());
        }
        let mut lamps = json!({
            "engine": state.engine,
            "power": state.power,
            "cruise": state.cruise,
            "lights": state.lights,
            "lightName": LIGHT_NAMES[usize::from(state.lights)],
            "refuel": state.refuel.is_some(),
            "live": live.is_some(),
        });
        if let Some(truck) = live {
            // Only the game knows these: without it they're left out and their lamps stay dark.
            let known = json!({
                "game": truck.game,
                "cruiseSpeed": truck.cruise_speed,
                "highBeam": truck.high_beam,
                "beacon": truck.beacon,
                "hazard": truck.hazard,
                "parkBrake": truck.park_brake,
                "wipers": truck.wipers,
                "diffLock": truck.diff_lock,
                "liftAxle": truck.lift_axle,
                "trailerLiftAxle": truck.trailer_lift_axle,
                "trailerAttached": truck.trailer_attached,
                "engineBrake": truck.engine_brake,
                "retarder": truck.retarder,
            });
            if let (Some(lamps), Value::Object(known)) = (lamps.as_object_mut(), known) {
                lamps.extend(known);
            }
        }
        lamps
    }
}

fn refuel_done(going: Duration, live: Option<Truck>) -> Option<&'static str> {
    if going > REFUEL_LONGEST {
        return Some("time limit");
    }
    let truck = live?;
    if truck.speed.abs() > REFUEL_MOVING {
        return Some("truck moving");
    }
    (truck.fuel_capacity > 0.0 && truck.fuel >= truck.fuel_capacity * 0.995).then_some("tank full")
}

/// Windows sends keys to the window in front, and drops them silently for a program run as administrator.
fn focus_warning() -> String {
    match crate::foreground::program() {
        Some(crate::foreground::Program::Game) => String::new(),
        Some(crate::foreground::Program::Elevated) => {
            "   !! the game runs as administrator, so Windows blocks these keys: start the game normally".into()
        }
        Some(crate::foreground::Program::Other(name)) => {
            format!("   !! went to {name}, not the game: click the game window first")
        }
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_forgotten_refuel_stops_once_it_cant_be_needed() {
        let truck = |speed: f32, fuel: f32| Some(Truck { speed, fuel, fuel_capacity: 100.0, ..Truck::default() });
        assert_eq!(refuel_done(Duration::from_secs(1), truck(0.0, 50.0)), None);
        assert_eq!(refuel_done(Duration::from_secs(1), truck(5.0, 50.0)), Some("truck moving"));
        assert_eq!(refuel_done(Duration::from_secs(1), truck(0.0, 99.6)), Some("tank full"));
        assert_eq!(refuel_done(Duration::from_secs(1), None), None);
        assert_eq!(refuel_done(Duration::from_secs(200), truck(0.0, 50.0)), Some("time limit"));
    }

    fn controller() -> Arc<Controller> {
        let bindings: Bindings = Arc::new(RwLock::new(
            [("engine_toggle", "E"), ("lights_up", "L"), ("lights_down", ""), ("beacon", "O"), ("refuel", "Enter")]
                .map(|(name, key)| (name.to_owned(), key.to_owned()))
                .into(),
        ));
        let keyboard = Arc::new(Keyboard::new(|_| {}));
        keyboard.dry_run.store(true, Ordering::Relaxed);
        let telemetry = Arc::new(Telemetry::off());
        Controller::new(bindings, keyboard, telemetry, true, Duration::from_millis(150))
    }

    #[test]
    fn remembers_what_it_pressed_without_the_game() {
        let controller = controller();
        let lamps = controller.handle("engine_start", 0).unwrap();
        assert_eq!(lamps["engine"], true);
        assert_eq!(controller.handle("lights", 1).unwrap()["lightName"], "Parking");
        assert_eq!(controller.handle("lights", 1).unwrap()["lightName"], "Low beam");
        assert_eq!(controller.handle("lights", 1).unwrap()["lightName"], "Low beam");
        assert_eq!(controller.handle("lights", -1).unwrap()["lightName"], "Parking");
        assert_eq!(controller.handle("refuel", 0).unwrap()["refuel"], true);
        assert_eq!(controller.handle("refuel", 0).unwrap()["refuel"], false);
        assert_eq!(controller.handle("reset_state", 0).unwrap()["engine"], false);
        assert!(controller.handle("beacon", 0).is_ok());
        assert!(controller.handle("lights_up", 0).is_err(), "the light switch has its own action");
        assert!(controller.handle("banana", 0).is_err());
        assert!(controller.handle("lights", 3).is_err());
    }

    #[test]
    fn a_held_key_is_let_go_when_the_ipad_stops_renewing_it() {
        let controller = controller();
        controller.handle("hold:beacon", 0).unwrap();
        assert!(controller.state().held.contains_key("beacon"));
        controller.state().held.insert("beacon".into(), Instant::now() - Duration::from_millis(1));
        controller.watch();
        assert!(!controller.state().held.contains_key("beacon"));
    }
}
