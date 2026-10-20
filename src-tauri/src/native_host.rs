//! Native messaging host, which lets the browser extension start getit without
//! opening a tab (see `browser-extension/background.js`).
//!
//! On startup the app writes a host manifest for each installed browser,
//! pointing it at this executable. When the extension asks for the host, the
//! browser runs the executable with the extension's origin as an argument;
//! [`is_host_launch`] spots that, and [`serve`] starts the app and answers
//! instead of opening a window. Links still go through the local listener in
//! `browser.rs` once it's up.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Must match `NATIVE_HOST` in `browser-extension/background.js`.
const HOST_NAME: &str = "com.hamedmonji.getit";
/// Fixed by the `key` in `browser-extension/manifest.json`.
const CHROME_EXTENSION_ID: &str = "keiophbnadjdajmllmohammiflcdpfmo";
/// `browser_specific_settings.gecko.id` in `browser-extension/manifest.json`.
const FIREFOX_EXTENSION_ID: &str = "getit@hamedmonji.com";

#[derive(Clone, Copy, Debug, PartialEq)]
enum Family {
    Chromium,
    Firefox,
}

/// Where each browser keeps its profile, relative to the home folder, and so
/// its `NativeMessagingHosts` folder.
const BROWSERS: &[(&str, Family)] = &[
    ("Library/Application Support/Google/Chrome", Family::Chromium),
    ("Library/Application Support/Google/Chrome Beta", Family::Chromium),
    ("Library/Application Support/Google/Chrome Canary", Family::Chromium),
    ("Library/Application Support/Chromium", Family::Chromium),
    ("Library/Application Support/Microsoft Edge", Family::Chromium),
    ("Library/Application Support/BraveSoftware/Brave-Browser", Family::Chromium),
    ("Library/Application Support/Vivaldi", Family::Chromium),
    ("Library/Application Support/Arc/User Data", Family::Chromium),
    ("Library/Application Support/Mozilla", Family::Firefox),
];

/// Whether the browser started this executable as the native host: Chromium
/// passes the extension's origin, Firefox the manifest path and extension id.
pub fn is_host_launch(args: &[String]) -> bool {
    args.iter()
        .skip(1)
        .any(|a| a.starts_with(&format!("chrome-extension://{CHROME_EXTENSION_ID}")) || a == FIREFOX_EXTENSION_ID)
}

/// Runs as the native host: reads the extension's message, starts the app and
/// answers whether it did.
pub fn serve() {
    let _ = read_message(&mut io::stdin().lock());
    let reply = match launch_app() {
        Ok(()) => r#"{"ok":true}"#.to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }).to_string(),
    };
    let _ = write_message(&mut io::stdout().lock(), &reply);
}

/// Writes the host manifest for each installed browser. Skipped in debug
/// builds, which would point the browsers away from the installed app.
pub fn register(home: &Path) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    for (dir, family) in host_dirs(home, |p| p.is_dir()) {
        let written = fs::create_dir_all(&dir)
            .and_then(|()| fs::write(dir.join(format!("{HOST_NAME}.json")), manifest(&exe, family)));
        if let Err(e) = written {
            eprintln!("native host: couldn't register in {}: {e}", dir.display());
        }
    }
}

/// The `NativeMessagingHosts` folders of the browsers whose profile folder
/// `exists`.
fn host_dirs(home: &Path, exists: impl Fn(&Path) -> bool) -> Vec<(PathBuf, Family)> {
    BROWSERS
        .iter()
        .map(|(dir, family)| (home.join(dir), *family))
        .filter(|(dir, _)| exists(dir))
        .map(|(dir, family)| (dir.join("NativeMessagingHosts"), family))
        .collect()
}

fn manifest(exe: &Path, family: Family) -> String {
    let mut manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "Starts getit for its browser extension",
        "path": exe,
        "type": "stdio",
    });
    match family {
        Family::Chromium => manifest["allowed_origins"] = serde_json::json!([format!("chrome-extension://{CHROME_EXTENSION_ID}/")]),
        Family::Firefox => manifest["allowed_extensions"] = serde_json::json!([FIREFOX_EXTENSION_ID]),
    }
    serde_json::to_string_pretty(&manifest).expect("manifest serializes")
}

/// The `.app` bundle holding `exe`, if it's in one.
fn bundle_of(exe: &Path) -> Option<&Path> {
    exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))
}

/// Starts the app on its own, so it outlives this host process.
fn launch_app() -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let status = match bundle_of(&exe) {
        Some(bundle) => Command::new("/usr/bin/open").arg(bundle).status()?,
        None => {
            Command::new(&exe).spawn()?;
            return Ok(());
        }
    };
    if status.success() { Ok(()) } else { Err(io::Error::other(format!("open exited with {status}"))) }
}

/// Native messages are a native-endian u32 length followed by that much JSON.
fn read_message(input: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut len = [0; 4];
    input.read_exact(&mut len)?;
    let mut message = vec![0; u32::from_ne_bytes(len) as usize];
    input.read_exact(&mut message)?;
    Ok(message)
}

fn write_message(output: &mut impl Write, json: &str) -> io::Result<()> {
    output.write_all(&(json.len() as u32).to_ne_bytes())?;
    output.write_all(json.as_bytes())?;
    output.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn spots_host_launches() {
        assert!(is_host_launch(&args(&["getit", "chrome-extension://keiophbnadjdajmllmohammiflcdpfmo/"])));
        assert!(is_host_launch(&args(&["getit", "/path/com.hamedmonji.getit.json", "getit@hamedmonji.com"])));
        assert!(!is_host_launch(&args(&["getit"])));
        assert!(!is_host_launch(&args(&["getit", "chrome-extension://someoneelse/"])));
    }

    #[test]
    fn host_dirs_only_for_installed_browsers() {
        let home = Path::new("/Users/me");
        let dirs = host_dirs(home, |p| p.ends_with("Google/Chrome") || p.ends_with("Mozilla"));
        assert_eq!(
            dirs,
            vec![
                (home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"), Family::Chromium),
                (home.join("Library/Application Support/Mozilla/NativeMessagingHosts"), Family::Firefox),
            ]
        );
    }

    #[test]
    fn manifests_allow_only_the_extension() {
        let exe = Path::new("/Applications/getit.app/Contents/MacOS/getit");
        let chrome: serde_json::Value = serde_json::from_str(&manifest(exe, Family::Chromium)).unwrap();
        assert_eq!(chrome["name"], HOST_NAME);
        assert_eq!(chrome["path"], "/Applications/getit.app/Contents/MacOS/getit");
        assert_eq!(chrome["allowed_origins"][0], "chrome-extension://keiophbnadjdajmllmohammiflcdpfmo/");
        assert!(chrome.get("allowed_extensions").is_none());
        let firefox: serde_json::Value = serde_json::from_str(&manifest(exe, Family::Firefox)).unwrap();
        assert_eq!(firefox["allowed_extensions"][0], "getit@hamedmonji.com");
        assert!(firefox.get("allowed_origins").is_none());
    }

    #[test]
    fn finds_the_bundle() {
        let exe = Path::new("/Applications/getit.app/Contents/MacOS/getit");
        assert_eq!(bundle_of(exe), Some(Path::new("/Applications/getit.app")));
        assert_eq!(bundle_of(Path::new("/repo/target/debug/getit")), None);
    }

    #[test]
    fn messages_round_trip() {
        let mut buf = Vec::new();
        write_message(&mut buf, r#"{"launch":true}"#).unwrap();
        assert_eq!(read_message(&mut buf.as_slice()).unwrap(), br#"{"launch":true}"#);
    }
}
