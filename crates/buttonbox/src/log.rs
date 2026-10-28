//! What the button box did, for the window's Recent presses: the last lines in memory, and every line in
//! `buttonbox.log` (to look back at a press that didn't work after the game is closed).

use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const KEPT: usize = 300;

struct Log {
    lines: VecDeque<String>,
    file: Option<PathBuf>,
}

fn log() -> &'static Mutex<Log> {
    static LOG: OnceLock<Mutex<Log>> = OnceLock::new();
    LOG.get_or_init(|| Mutex::new(Log { lines: VecDeque::new(), file: None }))
}

pub fn keep_in(file: PathBuf) {
    log().lock().unwrap_or_else(|e| e.into_inner()).file = Some(file);
}

pub fn write(line: String) {
    let mut log = log().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(file) = &log.file
        && let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(file)
    {
        let _ = writeln!(file, "{line}");
    }
    if log.lines.len() == KEPT {
        log.lines.pop_front();
    }
    log.lines.push_back(line);
}

/// The newest `count` lines, newest first.
pub fn recent(count: usize) -> Vec<String> {
    log().lock().unwrap_or_else(|e| e.into_inner()).lines.iter().rev().take(count).cloned().collect()
}

/// The time of day, as each line starts.
pub fn now() -> String {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    // SAFETY: a plain call returning the time by value.
    let time = unsafe { GetLocalTime() };
    format!("{:02}:{:02}:{:02}", time.wHour, time.wMinute, time.wSecond)
}
