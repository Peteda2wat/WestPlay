//! The program in front, which gets the keys: the game, or another (a press went astray), or the game run as
//! administrator (Windows drops keys sent to it, without a word).

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
use windows::core::PWSTR;

const GAMES: [&str; 2] = ["amtrucks", "eurotrucks2"];

#[derive(Debug, PartialEq, Eq)]
pub enum Program {
    Game,
    /// A program run as administrator (the game, most likely): its name can't be read.
    Elevated,
    /// Another program, by its file name ("chrome").
    Other(String),
}

pub fn program() -> Option<Program> {
    // SAFETY: plain calls; the process handle is closed once read.
    unsafe {
        let window = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return Some(Program::Elevated);
        };
        let mut buffer = [0u16; 520];
        let mut length = buffer.len() as u32;
        let read = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut length);
        let _ = CloseHandle(process);
        read.ok()?;
        Some(of(&String::from_utf16_lossy(&buffer[..length as usize])))
    }
}

/// Whether ATS or ETS2 is running (in front or not).
pub fn game_running() -> bool {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };
    // SAFETY: a snapshot of the processes, walked with an entry of its own size and closed once.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return false };
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more && !found {
            let length = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            found = of(&String::from_utf16_lossy(&entry.szExeFile[..length])) == Program::Game;
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
        found
    }
}

fn of(path: &str) -> Program {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let name = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    if GAMES.iter().any(|game| game.eq_ignore_ascii_case(name)) {
        Program::Game
    } else {
        Program::Other(name.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_games_by_their_file_names() {
        assert_eq!(of(r"D:\Steam\steamapps\common\American Truck Simulator\bin\win_x64\amtrucks.exe"), Program::Game);
        assert_eq!(of(r"C:\x\eurotrucks2.exe"), Program::Game);
        assert_eq!(of(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), Program::Other("chrome".into()));
    }
}
