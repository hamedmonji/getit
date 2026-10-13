//! Commands the frontend calls. They are thin wrappers around the engine, plus
//! read-only folder listing for the browser.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use getit_engine::{DownloadId, DownloadItem, Engine, QueueId, QueueInfo, QueueSettings};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

type CommandResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
pub struct Snapshot {
    queues: Vec<QueueInfo>,
    downloads: Vec<DownloadItem>,
}

#[tauri::command]
pub fn snapshot(engine: State<'_, Engine>) -> Snapshot {
    Snapshot {
        queues: engine.queues(),
        downloads: engine.all_downloads(),
    }
}

#[tauri::command]
pub fn home_dir(app: AppHandle) -> CommandResult<String> {
    let home = app.path().home_dir().map_err(err)?;
    Ok(home.to_string_lossy().into_owned())
}

/// Folder the browser opens at. Development builds start in `test-downloads/`
/// at the project root (created if needed); release builds start at home.
#[tauri::command]
pub fn initial_dir(app: AppHandle) -> CommandResult<String> {
    if cfg!(debug_assertions) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .join("test-downloads");
        fs::create_dir_all(&dir).map_err(err)?;
        return Ok(dir.to_string_lossy().into_owned());
    }
    home_dir(app)
}

#[derive(Serialize)]
pub struct Folder {
    name: String,
    /// Number of visible entries inside.
    items: usize,
}

#[derive(Serialize)]
pub struct DirListing {
    /// Visible subfolders, sorted by name.
    folders: Vec<Folder>,
    /// Names of the files in the folder, used to tell whether finished downloads
    /// are still there.
    files: Vec<String>,
}

/// Folder-like bundles that Finder shows as single items.
const PACKAGE_EXTENSIONS: &[&str] = &[
    "app",
    "bundle",
    "framework",
    "photoslibrary",
    "musiclibrary",
    "tvlibrary",
    "imovielibrary",
    "plugin",
    "kext",
];

#[tauri::command]
pub async fn list_dir(path: String) -> CommandResult<DirListing> {
    let mut folders = Vec::new();
    let mut files = Vec::new();
    for entry in fs::read_dir(&path).map_err(err)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        // Follows symlinks, so linked folders show up as folders.
        let Ok(meta) = fs::metadata(entry.path()) else {
            continue;
        };
        if meta.is_file() {
            files.push(name);
        } else if meta.is_dir() && !is_hidden(&name, &meta) && !is_package(&name) {
            folders.push(Folder {
                items: count_visible(&entry.path()),
                name,
            });
        }
    }
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok(DirListing { folders, files })
}

fn is_hidden(name: &str, meta: &fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        const UF_HIDDEN: u32 = 0x8000;
        if meta.st_flags() & UF_HIDDEN != 0 {
            return true;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = meta;
    false
}

fn is_package(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| PACKAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn count_visible(dir: &Path) -> usize {
    fs::read_dir(dir).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .count()
    })
}

#[tauri::command]
pub fn add_download(engine: State<'_, Engine>, dir: String, url: String) -> CommandResult<DownloadId> {
    engine.enqueue(dir, &url).map_err(err)
}

#[tauri::command]
pub fn pause_download(engine: State<'_, Engine>, id: DownloadId) -> CommandResult<()> {
    engine.pause(id).map_err(err)
}

#[tauri::command]
pub fn resume_download(engine: State<'_, Engine>, id: DownloadId) -> CommandResult<()> {
    engine.resume(id).map_err(err)
}

const NEW_QUEUE_NAME: &str = "New Queue";

/// Creates a new folder in `parent` named "New Queue" (or "New Queue 2", ...)
/// with its own queue, and returns its path. The user renames it afterwards.
#[tauri::command]
pub fn create_queue(engine: State<'_, Engine>, parent: String) -> CommandResult<String> {
    for n in 1..1000 {
        let name = if n == 1 {
            NEW_QUEUE_NAME.to_string()
        } else {
            format!("{NEW_QUEUE_NAME} {n}")
        };
        let dir = Path::new(&parent).join(name);
        match fs::create_dir(&dir) {
            Ok(()) => {
                engine.ensure_queue(&dir).map_err(err)?;
                return Ok(dir.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(err(e)),
        }
    }
    Err("couldn't find a free folder name".into())
}

/// Renames a folder, moving any queues inside it along. Returns the new path.
#[tauri::command]
pub fn rename_folder(engine: State<'_, Engine>, path: String, name: String) -> CommandResult<String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err(format!("\"{name}\" isn't a valid folder name"));
    }
    let old = PathBuf::from(&path);
    let parent = old.parent().ok_or("can't rename this folder")?;
    let new = parent.join(name);
    if new == old {
        return Ok(path);
    }
    // On case-insensitive disks, a case-only rename finds the folder itself.
    let same = fs::canonicalize(&new).ok() == fs::canonicalize(&old).ok();
    if new.exists() && !same {
        return Err(format!("\"{name}\" already exists"));
    }
    move_dir(&engine, &old, &new)?;
    Ok(new.to_string_lossy().into_owned())
}

/// Moves a folder on disk and points its queues at the new place, undoing the
/// move if the queues can't follow.
fn move_dir(engine: &Engine, old: &Path, new: &Path) -> CommandResult<()> {
    fs::rename(old, new).map_err(err)?;
    if let Err(e) = engine.relocate(old, new) {
        let _ = fs::rename(new, old);
        return Err(err(e));
    }
    Ok(())
}

/// Moves folders (with the queues inside them) into `dest`. Stops at the first
/// one that can't move; the ones before it stay moved.
#[tauri::command]
pub fn move_folders(engine: State<'_, Engine>, paths: Vec<String>, dest: String) -> CommandResult<()> {
    let dest = PathBuf::from(dest);
    for path in paths {
        let old = PathBuf::from(&path);
        let name = old.file_name().ok_or("can't move this folder")?;
        if old.parent() == Some(dest.as_path()) {
            continue;
        }
        if dest.starts_with(&old) {
            return Err(format!("can't move \"{}\" into itself", name.to_string_lossy()));
        }
        let new = dest.join(name);
        if new.exists() {
            return Err(format!("\"{}\" already exists there", name.to_string_lossy()));
        }
        move_dir(&engine, &old, &new)?;
    }
    Ok(())
}

/// Moves downloads, with their files, to the queue for `dir`.
#[tauri::command]
pub fn move_downloads(engine: State<'_, Engine>, ids: Vec<DownloadId>, dir: String) -> CommandResult<()> {
    engine.move_downloads(&ids, dir).map_err(err)
}

/// Puts paused or failed downloads back in line in their queues.
#[tauri::command]
pub fn requeue_downloads(engine: State<'_, Engine>, ids: Vec<DownloadId>) -> CommandResult<()> {
    engine.requeue(&ids).map_err(err)
}

#[tauri::command]
pub fn remove_download(engine: State<'_, Engine>, id: DownloadId) -> CommandResult<()> {
    engine.remove(id).map_err(err)
}

#[tauri::command]
pub fn set_queue_settings(
    engine: State<'_, Engine>,
    queue_id: QueueId,
    settings: QueueSettings,
) -> CommandResult<()> {
    engine.set_queue_settings(queue_id, settings).map_err(err)
}

#[tauri::command]
pub fn clear_completed(engine: State<'_, Engine>, queue_id: QueueId) -> CommandResult<usize> {
    engine.clear_completed(queue_id).map_err(err)
}
