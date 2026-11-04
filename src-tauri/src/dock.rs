//! The Dock icon's download overlay: a picture the frontend draws (progress
//! and speed), laid over the app's own icon.
//!
//! The frontend only redraws on a timer, which macOS holds back while the
//! window is in the background, so clearing doesn't wait for it: the overlay
//! goes as soon as the last download stops, and isn't drawn while none runs.

use std::sync::atomic::{AtomicBool, Ordering};

use getit_engine::{DownloadStatus, Engine};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

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

/// Puts the plain icon back once no download is running.
pub fn clear_when_idle(app: &AppHandle, engine: &Engine) {
    if SHOWING.load(Ordering::SeqCst) && !any_downloading(engine) {
        SHOWING.store(false, Ordering::SeqCst);
        let _ = app.run_on_main_thread(|| show(None));
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
