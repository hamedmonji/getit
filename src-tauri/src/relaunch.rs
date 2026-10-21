//! Restarting into an update.
//!
//! Tauri's own restart runs `open -n` on the bundle while this process is still
//! alive, which forces a second instance. After an update has swapped the bundle,
//! macOS treats that instance as a different app: it gets its own Dock icon next
//! to a pinned one instead of taking its place. So on macOS a detached helper
//! waits for this process to exit and then opens the bundle normally, the same
//! as clicking it in the Dock.

use std::path::Path;

use tauri::AppHandle;

/// How long the helper waits for this process to exit before opening anyway.
const EXIT_TIMEOUT_TENTHS: u32 = 100;

/// Exits and starts the app again.
#[tauri::command]
pub fn relaunch(app: AppHandle) {
    #[cfg(target_os = "macos")]
    if let Some(bundle) = std::env::current_exe().ok().as_deref().and_then(crate::native_host::bundle_of)
        && spawn_helper(std::process::id(), bundle).is_ok()
    {
        app.exit(0);
        return;
    }
    app.request_restart();
}

#[cfg(target_os = "macos")]
fn spawn_helper(pid: u32, bundle: &Path) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let (program, args) = helper_command(pid, bundle);
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Its own process group, so it isn't taken down with this one.
        .process_group(0)
        .spawn()
        .map(drop)
}

/// The shell command that waits for `pid` to exit (for at most
/// [`EXIT_TIMEOUT_TENTHS`] tenths of a second) and then opens `bundle`. The
/// bundle is passed as an argument, so its path needs no quoting.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn helper_command(pid: u32, bundle: &Path) -> (&'static str, Vec<String>) {
    let script = format!(
        "i=0; while kill -0 {pid} 2>/dev/null && [ $i -lt {EXIT_TIMEOUT_TENTHS} ]; do sleep 0.1; i=$((i+1)); done; exec /usr/bin/open \"$0\""
    );
    ("/bin/sh", vec!["-c".into(), script, bundle.to_string_lossy().into_owned()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_waits_for_the_process_then_opens_the_bundle() {
        let (program, args) = helper_command(42, Path::new("/Applications/get it's.app"));
        assert_eq!(program, "/bin/sh");
        assert_eq!(args[0], "-c");
        assert!(args[1].contains("kill -0 42"));
        assert!(args[1].ends_with("exec /usr/bin/open \"$0\""));
        assert!(!args[1].contains("-n"), "a plain open, not a forced new instance");
        assert_eq!(args[2], "/Applications/get it's.app");
    }
}
