//! The Downloads settings: how many connections a download may use, and
//! whether the Mac stays awake while downloads run. Kept here rather than in
//! the window, so they're in place before any download starts at launch.

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

use getit_engine::{DEFAULT_CONNECTIONS, Engine, MAX_CONNECTIONS};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::awake;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DownloadPrefs {
    /// The most connections one download uses; small files use fewer.
    pub connections: u64,
    /// Whether the Mac is kept from sleeping while a download runs.
    pub keep_awake: bool,
}

impl Default for DownloadPrefs {
    fn default() -> Self {
        DownloadPrefs {
            connections: DEFAULT_CONNECTIONS,
            keep_awake: true,
        }
    }
}

impl DownloadPrefs {
    /// The same, with the connections within what the engine allows.
    fn clamped(self) -> Self {
        DownloadPrefs {
            connections: self.connections.clamp(1, MAX_CONNECTIONS),
            ..self
        }
    }
}

pub struct Prefs {
    /// Where they're remembered.
    file: PathBuf,
    prefs: Mutex<DownloadPrefs>,
}

impl Prefs {
    /// The prefs saved in `file`, or the defaults when there are none or they can't be read.
    pub fn load(file: PathBuf) -> Self {
        let prefs = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<DownloadPrefs>(&bytes).ok())
            .unwrap_or_default()
            .clamped();
        Prefs {
            file,
            prefs: Mutex::new(prefs),
        }
    }

    pub fn get(&self) -> DownloadPrefs {
        *self.prefs.lock().unwrap()
    }

    fn set(&self, prefs: DownloadPrefs) -> io::Result<DownloadPrefs> {
        let prefs = prefs.clamped();
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&self.file, serde_json::to_vec(&prefs)?)?;
        *self.prefs.lock().unwrap() = prefs;
        Ok(prefs)
    }
}

/// Puts `prefs` into effect: the engine's connections, and keeping awake.
pub fn apply(app: &AppHandle, engine: &Engine, prefs: DownloadPrefs) {
    engine.set_connections(prefs.connections);
    awake::update(app, engine, prefs.keep_awake);
}

#[tauri::command]
pub fn download_prefs(prefs: State<'_, Prefs>) -> DownloadPrefs {
    prefs.get()
}

/// Saves and applies the Downloads settings, and returns them as saved.
#[tauri::command]
pub fn set_download_prefs(
    app: AppHandle,
    engine: State<'_, Engine>,
    state: State<'_, Prefs>,
    prefs: DownloadPrefs,
) -> Result<DownloadPrefs, String> {
    let prefs = state.set(prefs).map_err(|e| e.to_string())?;
    apply(&app, &engine, prefs);
    Ok(prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_with_sixteen_connections_and_keeping_awake() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = Prefs::load(dir.path().join("downloads.json"));
        assert_eq!(prefs.get(), DownloadPrefs { connections: 16, keep_awake: true });
    }

    #[test]
    fn remembers_what_was_set() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("downloads.json");
        let set = DownloadPrefs { connections: 8, keep_awake: false };
        Prefs::load(file.clone()).set(set).unwrap();
        assert_eq!(Prefs::load(file).get(), set);
    }

    #[test]
    fn keeps_connections_within_what_the_engine_allows() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = Prefs::load(dir.path().join("downloads.json"));
        let saved = prefs.set(DownloadPrefs { connections: 99, keep_awake: true }).unwrap();
        assert_eq!(saved.connections, MAX_CONNECTIONS);
        assert_eq!(prefs.set(DownloadPrefs { connections: 0, keep_awake: true }).unwrap().connections, 1);
    }

    #[test]
    fn fills_in_what_an_older_file_left_out() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("downloads.json");
        fs::write(&file, r#"{"connections":2}"#).unwrap();
        assert_eq!(Prefs::load(file).get(), DownloadPrefs { connections: 2, keep_awake: true });
    }
}
