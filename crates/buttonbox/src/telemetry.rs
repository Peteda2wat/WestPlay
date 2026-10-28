//! The game's state for the button lamps, from the shared memory RenCloud's telemetry plugin
//! (`scs-telemetry.dll`) writes: WestPlay's own plugin doesn't read the beacon, wipers, diff lock, axles or
//! trailer. Offsets are `scsTelemetryMap_t`'s (scs-telemetry-common.hpp), each zone at a fixed place.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Memory::{
    FILE_MAP_READ, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile, OpenFileMappingW, UnmapViewOfFile,
};
use windows::core::w;

/// Up to the first trailer's "attached" flag (zone 14 starts at 6000).
const SIZE: usize = 6100;

/// One reading of the game, as the lamps need it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Truck {
    /// "ats" or "ets2".
    pub game: &'static str,
    pub speed: f32,
    pub cruise_speed: f32,
    pub fuel: f32,
    pub fuel_capacity: f32,
    pub retarder: u32,
    pub park_brake: bool,
    pub engine_brake: bool,
    pub electric: bool,
    pub engine: bool,
    pub wipers: bool,
    pub parking_lights: bool,
    pub low_beam: bool,
    pub high_beam: bool,
    pub beacon: bool,
    pub hazard: bool,
    pub cruise: bool,
    pub diff_lock: bool,
    pub lift_axle: bool,
    pub trailer_lift_axle: bool,
    pub trailer_attached: bool,
}

impl Truck {
    /// The light switch: off, parking or low beam (high beam is its own button).
    pub fn light_level(&self) -> u8 {
        if self.low_beam { 2 } else { u8::from(self.parking_lights) }
    }

    fn read(bytes: &[u8]) -> Option<Self> {
        let u8_at = |at: usize| bytes[at] != 0;
        let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap_or_default());
        let f32_at = |at: usize| f32::from_bits(u32_at(at));
        // Zone 1: whether the game runs (it leaves the map behind as it closes).
        if !u8_at(0) {
            return None;
        }
        Some(Self {
            game: match u32_at(52) {
                1 => "ets2",
                2 => "ats",
                _ => "",
            },
            retarder: u32_at(108),
            fuel_capacity: f32_at(704),
            speed: f32_at(948),
            cruise_speed: f32_at(988),
            fuel: f32_at(1000),
            park_brake: u8_at(1566),
            engine_brake: u8_at(1567),
            electric: u8_at(1575),
            engine: u8_at(1576),
            wipers: u8_at(1577),
            parking_lights: u8_at(1582),
            low_beam: u8_at(1583),
            high_beam: u8_at(1584),
            beacon: u8_at(1585),
            hazard: u8_at(1588),
            cruise: u8_at(1589),
            diff_lock: u8_at(1608),
            lift_axle: u8_at(1609),
            trailer_lift_axle: u8_at(1611),
            trailer_attached: u8_at(6080),
        })
    }
}

/// The plugin's map, opened once it's there (looked for at most every 2 s).
#[derive(Default)]
pub struct Telemetry {
    view: Mutex<View>,
    /// Never reads the game (tests: the game may be running on the PC that runs them).
    off: bool,
}

#[derive(Default)]
struct View {
    mapping: Option<(HANDLE, MEMORY_MAPPED_VIEW_ADDRESS)>,
    next_look: Option<Instant>,
}

// SAFETY: the handle and the view are the process's own, only used under the mutex, and only read.
unsafe impl Send for View {}

impl Telemetry {
    /// One that never reads the game (tests: the game may be running on the PC that runs them).
    #[cfg(test)]
    pub fn off() -> Self {
        Self { off: true, ..Self::default() }
    }

    /// The game now (`None`: not running, or the plugin isn't installed).
    pub fn live(&self) -> Option<Truck> {
        if self.off {
            return None;
        }
        let mut view = self.view.lock().unwrap_or_else(|e| e.into_inner());
        if view.mapping.is_none() {
            if view.next_look.is_some_and(|next| Instant::now() < next) {
                return None;
            }
            view.next_look = Some(Instant::now() + Duration::from_secs(2));
            view.mapping = open();
        }
        let (_, address) = view.mapping?;
        // SAFETY: the view is at least SIZE bytes (mapped so, read only), alive while the mapping is kept.
        let bytes = unsafe { std::slice::from_raw_parts(address.Value as *const u8, SIZE) };
        Truck::read(bytes)
    }

    /// Whether the plugin's map is there.
    pub fn plugin_found(&self) -> bool {
        self.live();
        self.view.lock().unwrap_or_else(|e| e.into_inner()).mapping.is_some()
    }
}

fn open() -> Option<(HANDLE, MEMORY_MAPPED_VIEW_ADDRESS)> {
    // SAFETY: plain calls with a static name; what they return is checked and kept, or closed.
    unsafe {
        let handle = OpenFileMappingW(FILE_MAP_READ.0, false, w!(r"Local\SCSTelemetry")).ok()?;
        let address = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, SIZE);
        if address.Value.is_null() {
            let _ = CloseHandle(handle);
            return None;
        }
        Some((handle, address))
    }
}

impl Drop for View {
    fn drop(&mut self) {
        if let Some((handle, address)) = self.mapping.take() {
            // SAFETY: mapped and opened above, let go once.
            unsafe {
                let _ = UnmapViewOfFile(address);
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_plugins_map_at_its_offsets() {
        let mut bytes = vec![0u8; SIZE];
        assert_eq!(Truck::read(&bytes), None, "the game not running");
        bytes[0] = 1;
        bytes[52..56].copy_from_slice(&2u32.to_le_bytes());
        bytes[948..952].copy_from_slice(&25.5f32.to_le_bytes());
        for at in [1576, 1583, 1585, 1608, 6080] {
            bytes[at] = 1;
        }
        let truck = Truck::read(&bytes).unwrap();
        assert_eq!((truck.game, truck.speed), ("ats", 25.5));
        assert!(truck.engine && truck.beacon && truck.diff_lock && truck.trailer_attached);
        assert!(!truck.electric && !truck.hazard);
        assert_eq!(truck.light_level(), 2);
    }
}
