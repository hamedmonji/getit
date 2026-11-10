//! Opening getit when the user logs in, on Windows and macOS. Opened that way,
//! it starts without its window: in the system tray on Windows, and with only
//! its Dock icon on macOS, downloading what was queued. Not registered from
//! development builds, so the login item always opens the installed app.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::tray::Platform;

/// What the login item passes, so getit knows to start without its window.
pub const HIDDEN_ARG: &str = "--hidden";

/// How getit was opened this time.
pub struct Launch {
    /// Whether it was opened at login, and so started without its window.
    pub hidden: bool,
}

/// Whether `args` (the process's, program name first) are those of the login item.
pub fn launched_at_login<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> bool {
    args.into_iter().skip(1).any(|arg| arg.as_ref() == HIDDEN_ARG)
}

/// Whether getit can open at login on `platform`.
pub fn supported(platform: Platform) -> bool {
    matches!(platform, Platform::Mac | Platform::Windows)
}

/// Registers getit to open at login when `wanted`, or takes it away.
pub fn update(app: &AppHandle, wanted: bool) {
    if cfg!(debug_assertions) || !supported(Platform::current()) {
        return;
    }
    let launcher = app.autolaunch();
    // Enabling again keeps the login item pointing at this copy of getit.
    let result = if wanted { launcher.enable() } else { launcher.disable() };
    if let Err(e) = result {
        eprintln!("couldn't change opening at login: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_it_was_opened_at_login() {
        assert!(launched_at_login(["getit.exe", "--hidden"]));
    }

    #[test]
    fn opened_by_hand_shows_its_window() {
        assert!(!launched_at_login(["getit.exe"]));
        assert!(!launched_at_login(["getit://open"]));
        // The program itself is never taken for the flag.
        assert!(!launched_at_login(["--hidden"]));
    }

    #[test]
    fn opens_at_login_only_on_windows_and_mac() {
        assert!(supported(Platform::Windows));
        assert!(supported(Platform::Mac));
        assert!(!supported(Platform::Other));
    }
}
