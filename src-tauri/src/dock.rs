//! The Dock icon's download overlay: a picture the frontend draws (progress
//! and speed), laid over the app's own icon. Elsewhere, the taskbar button's
//! progress bar instead.
//!
//! The frontend only redraws on a timer, which macOS holds back while the
//! window is in the background, so clearing doesn't wait for it: the overlay
//! goes as soon as the last download stops, and isn't drawn while none runs.

use std::sync::atomic::{AtomicBool, Ordering};

use getit_engine::{DownloadStatus, Engine};
use tauri::ipc::{InvokeBody, Request};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, State};

/// Whether an overlay is on the Dock icon now, so clearing it again is skipped.
static SHOWING: AtomicBool = AtomicBool::new(false);

/// Whether any download is running now.
pub fn any_downloading(engine: &Engine) -> bool {
    engine
        .all_downloads()
        .iter()
        .any(|d| d.status == DownloadStatus::Downloading)
}

/// Shows the PNG sent as the raw request body over the Dock icon, or the plain
/// icon again when the body is empty or not raw bytes, or nothing is downloading.
#[tauri::command]
pub fn set_dock_overlay(
    app: AppHandle,
    engine: State<'_, Engine>,
    request: Request<'_>,
) -> Result<(), String> {
    let png = match request.body() {
        InvokeBody::Raw(bytes) if !bytes.is_empty() && any_downloading(&engine) => {
            Some(bytes.clone())
        }
        _ => None,
    };
    SHOWING.store(png.is_some(), Ordering::SeqCst);
    app.run_on_main_thread(move || show(png)).map_err(|e| e.to_string())
}

/// Shows the running downloads' overall progress (0–100) on the taskbar
/// button, a busy bar when none knows its size, or nothing when `active` is
/// false or nothing is downloading. For Windows and Linux; macOS has the Dock
/// overlay.
#[tauri::command]
pub fn set_taskbar_progress(
    app: AppHandle,
    engine: State<'_, Engine>,
    active: bool,
    progress: Option<u64>,
) -> Result<(), String> {
    let active = active && any_downloading(&engine);
    SHOWING.store(active, Ordering::SeqCst);
    show_on_taskbar(&app, taskbar_state(active, progress))
}

/// What the taskbar button shows for downloads whose overall `progress` is
/// known or not, while `active`.
fn taskbar_state(active: bool, progress: Option<u64>) -> ProgressBarState {
    let (status, progress) = match (active, progress) {
        (false, _) => (ProgressBarStatus::None, None),
        (true, Some(progress)) => (ProgressBarStatus::Normal, Some(progress.min(100))),
        (true, None) => (ProgressBarStatus::Indeterminate, None),
    };
    ProgressBarState { status: Some(status), progress }
}

fn show_on_taskbar(app: &AppHandle, state: ProgressBarState) -> Result<(), String> {
    match app.get_webview_window("main") {
        Some(window) => window.set_progress_bar(state).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Puts the plain icon back once no download is running.
pub fn clear_when_idle(app: &AppHandle, engine: &Engine) {
    if SHOWING.load(Ordering::SeqCst) && !any_downloading(engine) {
        SHOWING.store(false, Ordering::SeqCst);
        if cfg!(target_os = "macos") {
            let _ = app.run_on_main_thread(|| show(None));
        } else {
            let _ = show_on_taskbar(app, taskbar_state(false, None));
        }
    }
}

#[cfg(target_os = "macos")]
fn show(png: Option<Vec<u8>>) {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize};

    thread_local! {
        /// The icon before any overlay, to draw under each one and to put back.
        static PLAIN: RefCell<Option<Retained<NSImage>>> = const { RefCell::new(None) };
    }

    /// `layers` drawn one over another into a new image of `size`.
    fn compose(size: NSSize, layers: &[&NSImage]) -> Retained<NSImage> {
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), size);
        let icon = NSImage::initWithSize(NSImage::alloc(), size);
        #[allow(deprecated)]
        {
            icon.lockFocus();
            for layer in layers {
                layer.drawInRect(rect);
            }
            icon.unlockFocus();
        }
        icon
    }

    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    let plain = PLAIN.with(|p| {
        let mut p = p.borrow_mut();
        if p.is_none() {
            // The app's icon image follows the icon set since, so putting it
            // back would keep the overlay; a copy drawn now stays plain.
            *p = app.applicationIconImage().map(|live| compose(live.size(), &[&live]));
        }
        p.clone()
    });
    let Some(plain) = plain else { return };
    let overlay = png.and_then(|png| NSImage::initWithData(NSImage::alloc(), &NSData::from_vec(png)));
    let icon = match overlay {
        Some(overlay) => compose(plain.size(), &[&plain, &overlay]),
        None => plain,
    };
    unsafe { app.setApplicationIconImage(Some(&icon)) };
}

#[cfg(not(target_os = "macos"))]
fn show(_png: Option<Vec<u8>>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_taskbar_shows_progress_while_downloading() {
        let state = taskbar_state(true, Some(42));
        assert!(matches!(state.status, Some(ProgressBarStatus::Normal)));
        assert_eq!(state.progress, Some(42));
        assert_eq!(taskbar_state(true, Some(250)).progress, Some(100));
    }

    #[test]
    fn the_taskbar_is_busy_without_a_known_size_and_clear_when_idle() {
        assert!(matches!(taskbar_state(true, None).status, Some(ProgressBarStatus::Indeterminate)));
        let idle = taskbar_state(false, Some(42));
        assert!(matches!(idle.status, Some(ProgressBarStatus::None)));
        assert_eq!(idle.progress, None);
    }
}
