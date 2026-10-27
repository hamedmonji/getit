//! macOS asks before letting an app read Desktop, Documents or Downloads, the
//! first time it tries. getit doesn't touch those folders, not even to count
//! what's inside, until the user gives it Full Disk Access or chooses a folder
//! in one of them as getit's root, so the system's prompt never shows on its own.
//!
//! On first launch the user picks one of the two; the choice is remembered.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Folders in home that macOS asks about.
const PROTECTED: &[&str] = &["Desktop", "Documents", "Downloads"];

/// Files in home that only Full Disk Access lets an app read. Trying them never
/// makes macOS ask; without access, opening one just fails.
const FULL_DISK_PROBES: &[&str] = &[
    "Library/Application Support/com.apple.TCC/TCC.db",
    "Library/Safari/Bookmarks.plist",
];

/// The protected folder `path` is in (or is), if any. Compares names ignoring
/// case, as macOS's file system does.
pub fn protected_root(home: &Path, path: &Path) -> Option<PathBuf> {
    let rest = path.strip_prefix(home).ok()?;
    let Some(Component::Normal(first)) = rest.components().next() else {
        return None;
    };
    let first = first.to_str()?;
    PROTECTED
        .iter()
        .find(|name| name.eq_ignore_ascii_case(first))
        .map(|name| home.join(name))
}

/// Whether `root`, a folder the user chose in an Open panel (which lets getit
/// read it), covers `path` inside a protected folder.
pub fn root_allows(home: &Path, root: Option<&Path>, path: &Path) -> bool {
    root.is_some_and(|root| protected_root(home, root).is_some() && path.starts_with(root))
}

/// What the user chose on first launch.
#[derive(Clone, Serialize, Deserialize)]
pub struct Setup {
    /// The folder getit opens at and treats as the top, or None when the user
    /// gave Full Disk Access instead.
    pub root: Option<PathBuf>,
}

pub struct Access {
    home: PathBuf,
    /// Where the setup is remembered.
    file: PathBuf,
    /// None until the user has chosen, on first launch.
    setup: Mutex<Option<Setup>>,
}

impl Access {
    pub fn load(home: PathBuf, file: PathBuf) -> Self {
        let setup = fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        Access {
            home,
            file,
            setup: Mutex::new(setup),
        }
    }

    pub fn setup(&self) -> Option<Setup> {
        self.setup.lock().unwrap().clone()
    }

    pub fn set_setup(&self, setup: Setup) -> io::Result<()> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&self.file, serde_json::to_vec(&setup)?)?;
        *self.setup.lock().unwrap() = Some(setup);
        Ok(())
    }

    /// Forgets the first-launch choice, so onboarding shows again.
    pub fn reset(&self) -> io::Result<()> {
        match fs::remove_file(&self.file) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        *self.setup.lock().unwrap() = None;
        Ok(())
    }

    /// Whether getit has Full Disk Access. Checked each time, since the user
    /// can turn it on while getit runs (macOS may apply it only after a restart).
    pub fn full_disk(&self) -> bool {
        !cfg!(target_os = "macos") || FULL_DISK_PROBES.iter().any(|probe| fs::File::open(self.home.join(probe)).is_ok())
    }

    /// Whether reading `path` could make macOS ask for access: it's in a
    /// protected folder outside the chosen root, and getit doesn't have Full
    /// Disk Access.
    pub fn blocked(&self, path: &Path) -> bool {
        let root = self.setup().and_then(|setup| setup.root);
        cfg!(target_os = "macos")
            && protected_root(&self.home, path).is_some()
            && !root_allows(&self.home, root.as_deref(), path)
            && !self.full_disk()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(path: &str) -> Option<PathBuf> {
        protected_root(Path::new("/Users/me"), Path::new(path))
    }

    #[test]
    fn finds_the_protected_folder_a_path_is_in() {
        assert_eq!(root("/Users/me/Documents"), Some("/Users/me/Documents".into()));
        assert_eq!(root("/Users/me/Downloads/a/b"), Some("/Users/me/Downloads".into()));
        assert_eq!(root("/Users/me/desktop/"), Some("/Users/me/Desktop".into()));
    }

    #[test]
    fn other_folders_are_not_protected() {
        assert_eq!(root("/Users/me"), None);
        assert_eq!(root("/Users/me/Music"), None);
        assert_eq!(root("/Users/me/Documentsx"), None);
        assert_eq!(root("/Users/other/Documents"), None);
        assert_eq!(root("/Volumes/Documents"), None);
    }

    #[test]
    fn a_root_in_a_protected_folder_allows_only_what_is_inside_it() {
        let home = Path::new("/Users/me");
        let root = Some(Path::new("/Users/me/Documents/dl"));
        assert!(root_allows(home, root, Path::new("/Users/me/Documents/dl")));
        assert!(root_allows(home, root, Path::new("/Users/me/Documents/dl/a")));
        assert!(!root_allows(home, root, Path::new("/Users/me/Documents")));
        assert!(!root_allows(home, root, Path::new("/Users/me/Documents/dlx")));
        assert!(!root_allows(home, None, Path::new("/Users/me/Documents/dl")));
        // Home itself is no protected folder, so choosing it allows none of them.
        assert!(!root_allows(home, Some(home), Path::new("/Users/me/Desktop")));
    }

    #[test]
    fn only_protected_folders_outside_the_root_are_blocked_without_full_disk_access() {
        // A home without the probe files, as when getit lacks Full Disk Access.
        let dir = std::env::temp_dir().join(format!("getit-access-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let home = dir.join("home");
        let file = dir.join("setup.json");
        let access = Access::load(home.clone(), file.clone());
        assert!(access.setup().is_none());
        assert!(!access.blocked(&home.join("Music")));
        assert_eq!(access.blocked(&home.join("Documents/dl/a")), cfg!(target_os = "macos"));

        access.set_setup(Setup { root: Some(home.join("Documents/dl")) }).unwrap();
        assert!(!access.blocked(&home.join("Documents/dl/a")));
        assert_eq!(access.blocked(&home.join("Desktop")), cfg!(target_os = "macos"));
        // Remembered for the next launch.
        assert!(!Access::load(home.clone(), file.clone()).blocked(&home.join("Documents/dl")));

        // Forgotten on reset, here and on the next launch; resetting twice is fine.
        access.reset().unwrap();
        access.reset().unwrap();
        assert!(access.setup().is_none());
        assert!(Access::load(home.clone(), file).setup().is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
