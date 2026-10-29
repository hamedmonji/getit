//! Commands the frontend calls. They are thin wrappers around the engine, plus
//! read-only folder listing for the browser.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use getit_engine::{
    DownloadId, DownloadItem, DownloadStatus, Engine, LinkInfo, QueueId, QueueInfo, QueueSettings, QueueSnapshot,
    RenameRule,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::access::{Access, Setup};

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

/// Folder the browser opens at: the root chosen on first launch, if any.
/// Otherwise development builds start in `test-downloads/` at the project root
/// (created if needed); release builds start in Documents on macOS and at home
/// elsewhere.
#[tauri::command]
pub fn initial_dir(app: AppHandle, access: State<'_, Access>) -> CommandResult<String> {
    if let Some(root) = access.setup().and_then(|setup| setup.root) {
        return Ok(root.to_string_lossy().into_owned());
    }
    if cfg!(debug_assertions) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .join("test-downloads");
        fs::create_dir_all(&dir).map_err(err)?;
        return Ok(dir.to_string_lossy().into_owned());
    }
    let home = app.path().home_dir().map_err(err)?;
    let start = if cfg!(target_os = "macos") { home.join("Documents") } else { home };
    Ok(start.to_string_lossy().into_owned())
}

/// The `.app` bundle getit runs from, for dragging into System Settings' Full
/// Disk Access list, which apps aren't added to on their own. None when getit
/// doesn't run from a bundle, as in development.
#[tauri::command]
pub fn app_bundle() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    crate::native_host::bundle_of(&exe).map(|bundle| bundle.to_string_lossy().into_owned())
}

/// What the user chose on first launch, or None if they haven't yet.
#[tauri::command]
pub fn access_setup(access: State<'_, Access>) -> Option<Setup> {
    access.setup()
}

/// Forgets the first-launch choice so onboarding shows again. For development
/// only: release builds refuse.
#[tauri::command]
pub fn reset_access_setup(access: State<'_, Access>) -> CommandResult<()> {
    if !cfg!(debug_assertions) {
        return Err("Only available in development".into());
    }
    access.reset().map_err(err)
}

/// Whether getit has Full Disk Access, for onboarding to go on once the user
/// turns it on.
#[tauri::command]
pub fn full_disk_access(access: State<'_, Access>) -> bool {
    access.full_disk()
}

/// Remembers the first-launch choice: `root` as getit's top folder, or None
/// for Full Disk Access.
#[tauri::command]
pub fn set_access_setup(access: State<'_, Access>, root: Option<String>) -> CommandResult<()> {
    access
        .set_setup(Setup { root: root.map(PathBuf::from), folders: vec![] })
        .map_err(err)
}

/// Replaces the folders added in Settings that getit may open, besides the
/// first-launch choice.
#[tauri::command]
pub fn set_access_folders(access: State<'_, Access>, folders: Vec<String>) -> CommandResult<()> {
    access.set_folders(folders.into_iter().map(PathBuf::from).collect()).map_err(err)
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

/// What `list_dir` fails with when the system won't let getit read the folder,
/// such as a privacy-protected one on macOS (Documents, Desktop, ...), or when
/// reading it would make macOS ask because getit doesn't have Full Disk Access.
const NO_ACCESS: &str = "no access";

#[tauri::command]
pub async fn list_dir(access: State<'_, Access>, path: String) -> CommandResult<DirListing> {
    if access.blocked(Path::new(&path)) {
        // A protected folder getit can't read shows only the chosen folders
        // inside it, by name, so they can be reached without macOS asking.
        let chosen = access.chosen_below(Path::new(&path));
        let names = crate::access::names_toward(Path::new(&path), &chosen);
        if names.is_empty() {
            return Err(NO_ACCESS.to_string());
        }
        let folders = names
            .into_iter()
            .map(|name| {
                let inside = Path::new(&path).join(&name);
                Folder {
                    items: if access.blocked(&inside) { 0 } else { count_visible(&inside) },
                    name,
                }
            })
            .collect();
        return Ok(DirListing { folders, files: Vec::new() });
    }
    let mut folders = Vec::new();
    let mut files = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| match e.kind() {
        io::ErrorKind::PermissionDenied => NO_ACCESS.to_string(),
        _ => err(e),
    })?;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        // Follows symlinks, so linked folders show up as folders.
        let Ok(meta) = fs::metadata(entry.path()) else {
            continue;
        };
        if meta.is_file() {
            files.push(name);
        } else if meta.is_dir() && !is_hidden(&name, &meta) && !is_package(&name) {
            let path = entry.path();
            folders.push(Folder {
                // Counting inside a protected folder would make macOS ask.
                items: if access.blocked(&path) { 0 } else { count_visible(&path) },
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

/// Whether `name` is already taken in `dir` by a file or a partial download.
#[tauri::command]
pub fn file_exists(dir: String, name: String) -> bool {
    let dir = Path::new(&dir);
    dir.join(&name).exists() || dir.join(format!("{name}.part")).exists()
}

/// The file name and size the server gives `url`, for showing before it's
/// added and checking it against existing downloads and files.
#[tauri::command]
pub async fn probe_link(engine: State<'_, Engine>, url: String) -> CommandResult<LinkInfo> {
    engine.probe(&url).await.map_err(err)
}

/// `names` as the queue for `dir` would name new downloads with its auto rename.
#[tauri::command]
pub fn auto_names(engine: State<'_, Engine>, dir: String, names: Vec<String>) -> CommandResult<Vec<String>> {
    engine.auto_names(dir, &names).map_err(err)
}

/// What auto rename `rules` make of `names`, and what's wrong with each rule's
/// regex, if anything; a rule with an invalid one is skipped.
#[derive(serde::Serialize)]
pub struct RenamePreview {
    names: Vec<String>,
    errors: Vec<Option<String>>,
}

#[tauri::command]
pub fn preview_rename(names: Vec<String>, rules: Vec<RenameRule>) -> RenamePreview {
    RenamePreview {
        names: names.iter().map(|name| getit_engine::apply_rules(name, &rules)).collect(),
        errors: getit_engine::rule_errors(&rules),
    }
}

#[tauri::command]
pub fn add_download(
    engine: State<'_, Engine>,
    dir: String,
    url: String,
    info: Option<LinkInfo>,
) -> CommandResult<DownloadId> {
    engine.enqueue_with(dir, &url, info).map_err(err)
}

/// Gives a stopped download a new link, for one whose link expired.
#[tauri::command]
pub fn set_download_url(engine: State<'_, Engine>, id: DownloadId, url: String) -> CommandResult<()> {
    engine.set_url(id, &url).map_err(err)
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

/// Renames a download's file. A running download keeps going and its file is
/// renamed when it stops. Returns the new name.
#[tauri::command]
pub fn rename_download(engine: State<'_, Engine>, id: DownloadId, name: String) -> CommandResult<String> {
    engine.rename_download(id, &name).map_err(err)
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

/// Moves `path` to the Trash and returns where it went there, so it can be put
/// back. On macOS this goes through the file manager API rather than scripting
/// Finder, so the app needs no extra permission. Elsewhere the place in the
/// Trash isn't known, and the result is `None`.
#[cfg(target_os = "macos")]
fn trash(path: &Path) -> CommandResult<Option<PathBuf>> {
    use objc2_foundation::{NSFileManager, NSURL};
    let fail = |e: &dyn std::fmt::Display| format!("couldn't move {} to the Trash: {e}", path.display());
    let url = NSURL::from_file_path(path).ok_or_else(|| fail(&"not a file path"))?;
    let mut trashed = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut trashed))
        .map_err(|e| fail(&e.localizedDescription()))?;
    Ok(trashed.and_then(|url| url.to_file_path()))
}

#[cfg(not(target_os = "macos"))]
fn trash(path: &Path) -> CommandResult<Option<PathBuf>> {
    trash::delete(path).map_err(|e| format!("couldn't move {} to the Trash: {e}", path.display()))?;
    Ok(None)
}

/// What [`move_to_trash`] moved, for [`restore_from_trash`] to put back.
#[derive(Serialize, Deserialize, Default)]
pub struct Trashed {
    downloads: Vec<TrashedDownload>,
    folders: Vec<TrashedFolder>,
    /// Why it stopped early, if it did. What's listed was trashed all the same.
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct TrashedDownload {
    item: DownloadItem,
    /// Its queue's folder.
    dir: PathBuf,
    /// Its finished file, if it had one, and where that went in the Trash.
    file: Option<(PathBuf, Option<PathBuf>)>,
}

#[derive(Serialize, Deserialize)]
struct TrashedFolder {
    path: PathBuf,
    /// Where it went in the Trash, when known.
    trashed: Option<PathBuf>,
    /// The queues that were in it.
    queues: Vec<QueueSnapshot>,
}

/// Moves downloads and folders to the Trash. Downloads leave the list, taking
/// their finished files to the Trash (unfinished ones' partial data is
/// deleted, so putting them back starts them over); a folder goes with
/// everything inside it, and the queues in it are removed. Stops at the first
/// item that can't be trashed; the ones before it stay trashed. Returns what
/// was trashed, so it can be put back.
#[tauri::command]
pub fn move_to_trash(engine: State<'_, Engine>, ids: Vec<DownloadId>, paths: Vec<String>) -> Trashed {
    let mut trashed = Trashed::default();
    if let Err(e) = trash_items(&engine, ids, paths, &mut trashed) {
        trashed.error = Some(e);
    }
    trashed
}

fn trash_items(engine: &Engine, ids: Vec<DownloadId>, paths: Vec<String>, trashed: &mut Trashed) -> CommandResult<()> {
    for id in ids {
        let Some(item) = engine.get(id) else { continue };
        let Some(queue) = engine.queue(item.queue_id) else { continue };
        // Unfinished downloads' partial files are deleted rather than trashed.
        let file = match item.file_path(&queue.dir).filter(|file| {
            item.status == DownloadStatus::Completed && file.exists()
        }) {
            Some(file) => {
                let to = trash(&file)?;
                Some((file, to))
            }
            None => None,
        };
        engine.remove(id).map_err(err)?;
        trashed.downloads.push(TrashedDownload { item, dir: queue.dir, file });
    }
    for path in paths {
        let dir = PathBuf::from(&path);
        if !dir.is_absolute() || dir.parent().is_none() {
            return Err(format!("won't move {path} to the Trash"));
        }
        let queues: Vec<QueueSnapshot> = engine
            .queues()
            .into_iter()
            .filter(|queue| queue.dir.starts_with(&dir))
            .filter_map(|queue| engine.queue_snapshot(queue.id))
            .collect();
        let to = trash(&dir)?;
        for queue in &queues {
            engine.remove_queue(queue.id).map_err(err)?;
        }
        trashed.folders.push(TrashedFolder { path: dir, trashed: to, queues });
    }
    Ok(())
}

/// Puts back what [`move_to_trash`] moved: files and folders return to where
/// they were, with their downloads and queues. Stops at the first item that
/// can't be put back, such as one whose place is taken or that's no longer in
/// the Trash; the ones before it stay put back.
#[tauri::command]
pub fn restore_from_trash(engine: State<'_, Engine>, trashed: Trashed) -> CommandResult<()> {
    // Folders first: a download trashed along with them goes back inside one.
    for folder in trashed.folders {
        put_back(&folder.path, folder.trashed.as_deref())?;
        for queue in folder.queues {
            engine.restore_queue(queue).map_err(err)?;
        }
    }
    for download in trashed.downloads {
        if let Some((file, to)) = &download.file {
            put_back(file, to.as_deref())?;
        }
        engine.restore_downloads(vec![download.item], &download.dir).map_err(err)?;
    }
    Ok(())
}

/// Moves `trashed` back to `path`.
fn put_back(path: &Path, trashed: Option<&Path>) -> CommandResult<()> {
    let name = path.file_name().unwrap_or(path.as_os_str()).to_string_lossy();
    let trashed = trashed.ok_or_else(|| format!("can't find \"{name}\" in the Trash"))?;
    if path.exists() {
        return Err(format!("\"{name}\" already exists in its old place"));
    }
    if !trashed.exists() {
        return Err(format!("\"{name}\" is no longer in the Trash"));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(trashed, path).map_err(|e| format!("couldn't put back \"{name}\": {e}"))
}

#[tauri::command]
pub fn remove_download(engine: State<'_, Engine>, id: DownloadId) -> CommandResult<()> {
    engine.remove(id).map_err(err)
}

/// Puts a queue's downloads in the given order. In a running queue, the top
/// ones run, stopping running ones that end up below the limit.
#[tauri::command]
pub fn reorder_queue(engine: State<'_, Engine>, queue_id: QueueId, ids: Vec<DownloadId>) -> CommandResult<()> {
    engine.reorder_queue(queue_id, &ids).map_err(err)
}

#[tauri::command]
pub fn set_queue_settings(
    engine: State<'_, Engine>,
    queue_id: QueueId,
    settings: QueueSettings,
) -> CommandResult<()> {
    engine.set_queue_settings(queue_id, settings).map_err(err)
}

/// Limits how fast all downloads together receive data, in bytes per second,
/// or lifts the limit with None.
#[tauri::command]
pub fn set_speed_limit(engine: State<'_, Engine>, limit: Option<u64>) {
    engine.set_speed_limit(limit);
}

#[tauri::command]
pub fn clear_completed(engine: State<'_, Engine>, queue_id: QueueId) -> CommandResult<usize> {
    engine.clear_completed(queue_id).map_err(err)
}
