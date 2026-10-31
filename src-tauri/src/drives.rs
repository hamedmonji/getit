//! The drives mounted on this computer, shown at the top of the sidebar when
//! getit may open any folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Drive {
    pub name: String,
    pub path: String,
}

/// Where other drives are mounted: /Volumes on macOS, /media/<user> and /mnt elsewhere.
fn mount_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        return vec!["/Volumes".into()];
    }
    let mut dirs = Vec::new();
    if let Ok(user) = std::env::var("USER") {
        dirs.push(Path::new("/media").join(user));
    }
    dirs.push("/mnt".into());
    dirs
}

/// The drives from what's in the mount folders, as (name, mount path, whether
/// it is the startup drive, as macOS links it to /): the startup drive first,
/// named after its volume when the link gives one, then the rest by name.
pub fn drives_from(mut mounts: Vec<(String, PathBuf, bool)>) -> Vec<Drive> {
    mounts.sort_by_key(|(name, _, _)| name.to_lowercase());
    let startup = mounts.iter().find(|(_, _, root)| *root).map(|(name, _, _)| name.clone());
    let mut drives = vec![Drive { name: startup.unwrap_or_else(|| "/".into()), path: "/".into() }];
    drives.extend(
        mounts
            .into_iter()
            .filter(|(name, _, root)| !root && !name.starts_with('.'))
            .map(|(name, path, _)| Drive { name, path: path.to_string_lossy().into_owned() }),
    );
    drives
}

#[tauri::command]
pub fn list_drives() -> Vec<Drive> {
    let mut mounts = Vec::new();
    for dir in mount_dirs() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(real) = fs::canonicalize(&path) else { continue };
            if !real.is_dir() {
                continue;
            }
            mounts.push((entry.file_name().to_string_lossy().into_owned(), path, real == Path::new("/")));
        }
    }
    drives_from(mounts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(name: &str, path: &str) -> Drive {
        Drive { name: name.into(), path: path.into() }
    }

    #[test]
    fn the_startup_drive_comes_first_under_its_volume_name() {
        let mounts = vec![
            ("USB".into(), "/Volumes/USB".into(), false),
            ("Macintosh HD".into(), "/Volumes/Macintosh HD".into(), true),
            ("backup".into(), "/Volumes/backup".into(), false),
        ];
        assert_eq!(
            drives_from(mounts),
            [drive("Macintosh HD", "/"), drive("backup", "/Volumes/backup"), drive("USB", "/Volumes/USB")]
        );
    }

    #[test]
    fn the_file_system_root_shows_without_a_link_to_it() {
        assert_eq!(drives_from(vec![]), [drive("/", "/")]);
        assert_eq!(
            drives_from(vec![("disk".into(), "/mnt/disk".into(), false), (".hidden".into(), "/mnt/.hidden".into(), false)]),
            [drive("/", "/"), drive("disk", "/mnt/disk")]
        );
    }
}
