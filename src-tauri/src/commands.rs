//! Commands the frontend calls. They are thin wrappers around the engine, plus
//! read-only folder listing for the browser.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use getit_engine::{DownloadId, DownloadItem, DownloadStatus, Engine, QueueId, QueueInfo, QueueSettings};
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
            .expect("src-tauri has a parent");
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

/// Copies downloads, with their files, into the queue for `dir`. Returns the
/// copies' ids. Runs off the main thread, since big files take a while.
#[tauri::command]
pub async fn copy_downloads(
    engine: State<'_, Engine>,
    ids: Vec<DownloadId>,
    dir: String,
) -> CommandResult<Vec<DownloadId>> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.copy_downloads(&ids, dir))
        .await
        .map_err(err)?
        .map_err(err)
}

/// Copies folders, with everything in them and copies of their queues, into
/// `dest`. A copy whose name is taken there is named "<name> copy" (or
/// "<name> copy 2", ...), so copying next to the original works. Returns the
/// copies' paths. Stops at the first folder that can't be copied; the ones
/// before it stay copied.
#[tauri::command]
pub async fn copy_folders(engine: State<'_, Engine>, paths: Vec<String>, dest: String) -> CommandResult<Vec<String>> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dest = PathBuf::from(dest);
        let mut copies = Vec::new();
        for path in paths {
            let old = PathBuf::from(&path);
            let name = old.file_name().ok_or("can't copy this folder")?.to_string_lossy().into_owned();
            if dest.starts_with(&old) {
                return Err(format!("can't copy \"{name}\" into itself"));
            }
            let new = free_folder_path(&dest, &name)?;
            let copied = copy_dir(&old, &new).map_err(|e| format!("couldn't copy \"{name}\": {e}"));
            if let Err(e) = copied.and_then(|()| engine.copy_queues(&old, &new).map_err(err)) {
                let _ = fs::remove_dir_all(&new);
                return Err(e);
            }
            copies.push(new.to_string_lossy().into_owned());
        }
        Ok(copies)
    })
    .await
    .map_err(err)?
}

/// `dest/name`, or `dest/name copy`, `dest/name copy 2`, ... if that's taken.
fn free_folder_path(dest: &Path, name: &str) -> CommandResult<PathBuf> {
    for n in 0..1000 {
        let candidate = match n {
            0 => name.to_string(),
            1 => format!("{name} copy"),
            _ => format!("{name} copy {n}"),
        };
        let path = dest.join(candidate);
        if !path.exists() {
            return Ok(path);
        }
    }
    Err(format!("couldn't find a free name for \"{name}\""))
}

/// Copies a folder and everything in it. Symbolic links are copied as links.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let (src, dest) = (entry.path(), to.join(entry.file_name()));
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&src, &dest)?;
        } else if kind.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(fs::read_link(&src)?, &dest)?;
        } else {
            fs::copy(&src, &dest)?;
        }
    }
    Ok(())
}

/// Puts paused or failed downloads back in line in their queues.
#[tauri::command]
pub fn requeue_downloads(engine: State<'_, Engine>, ids: Vec<DownloadId>) -> CommandResult<()> {
    engine.requeue(&ids).map_err(err)
}

/// Moves `path` to the Trash. On macOS this goes through the file manager API
/// rather than scripting Finder, so the app needs no extra permission.
fn trash(path: &Path) -> CommandResult<()> {
    #[allow(unused_mut)]
    let mut trash = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        trash.set_delete_method(DeleteMethod::NsFileManager);
    }
    trash
        .delete(path)
        .map_err(|e| format!("couldn't move {} to the Trash: {e}", path.display()))
}

/// Moves downloads and folders to the Trash. Downloads leave the list, taking
/// their finished files to the Trash (unfinished ones' partial data is deleted);
/// a folder goes with everything inside it, and the queues in it are removed.
/// Stops at the first item that can't be trashed; the ones before it stay trashed.
#[tauri::command]
pub fn move_to_trash(engine: State<'_, Engine>, ids: Vec<DownloadId>, paths: Vec<String>) -> CommandResult<()> {
    for id in ids {
        let Some(item) = engine.get(id) else { continue };
        if item.status == DownloadStatus::Completed
            && let Some(queue) = engine.queue(item.queue_id)
            && let Some(file) = item.file_path(&queue.dir)
            && file.exists()
        {
            trash(&file)?;
        }
        engine.remove(id).map_err(err)?;
    }
    for path in paths {
        let dir = PathBuf::from(&path);
        if !dir.is_absolute() || dir.parent().is_none() {
            return Err(format!("won't move {path} to the Trash"));
        }
        trash(&dir)?;
        for queue in engine.queues() {
            if queue.dir.starts_with(&dir) {
                engine.remove_queue(queue.id).map_err(err)?;
            }
        }
    }
    Ok(())
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
