//! The iPad's button box (`westplay_buttonbox`, once Truck Remote), started with the app, and the window's
//! Truck Remote and Buttons pages' commands.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use tauri::State;
use westplay_buttonbox::{ButtonBox, Status};

/// The button box, or why it couldn't start (its port taken: Truck Remote's old program still running).
pub struct Box(Result<Arc<ButtonBox>, String>);

impl Box {
    pub fn start(dir: &Path) -> Self {
        let started = ButtonBox::start(dir);
        if let Err(e) = &started {
            westplay_host::log!("[app] the iPad's button box couldn't start: {e}");
        }
        Self(started)
    }

    fn get(&self) -> Result<&ButtonBox, String> {
        self.0.as_deref().map_err(Clone::clone)
    }

    /// Lets go of every key held (the app quitting).
    pub fn shutdown(&self) {
        if let Ok(box_) = &self.0 {
            box_.shutdown();
        }
    }
}

#[tauri::command]
pub fn buttonbox_status(box_: State<Box>) -> Result<Status, String> {
    Ok(box_.get()?.status())
}

/// The newest presses and messages, newest first.
#[tauri::command]
pub fn buttonbox_recent(count: usize) -> Vec<String> {
    westplay_buttonbox::log::recent(count.min(300))
}

#[tauri::command]
pub fn buttonbox_set_test_mode(on: bool, box_: State<Box>) -> Result<(), String> {
    box_.get()?.set_test_mode(on);
    Ok(())
}

#[tauri::command]
pub fn buttonbox_bindings(box_: State<Box>) -> Result<BTreeMap<String, String>, String> {
    Ok(box_.get()?.bindings())
}

/// Gives a button another key ("" for none): the key as saved, or why it can't be.
#[tauri::command]
pub fn buttonbox_set_binding(name: String, key: String, box_: State<Box>) -> Result<String, String> {
    box_.get()?.set_binding(&name, &key)
}
