//! The Dock icon's download overlay: a picture the frontend draws (progress
//! and speed), laid over the app's own icon.

use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;

/// Shows the PNG sent as the raw request body over the Dock icon, or the plain
/// icon again when the body is empty or not raw bytes.
#[tauri::command]
pub fn set_dock_overlay(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let png = match request.body() {
        InvokeBody::Raw(bytes) if !bytes.is_empty() => Some(bytes.clone()),
        _ => None,
    };
    app.run_on_main_thread(move || show(png)).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn show(png: Option<Vec<u8>>) {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, NSPoint, NSRect};

    thread_local! {
        /// The icon before any overlay, to draw under each one and to put back.
        static PLAIN: RefCell<Option<Retained<NSImage>>> = const { RefCell::new(None) };
    }

    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    let plain = PLAIN.with(|p| {
        let mut p = p.borrow_mut();
        if p.is_none() {
            *p = app.applicationIconImage();
        }
        p.clone()
    });
    let Some(plain) = plain else { return };
    let overlay = png.and_then(|png| NSImage::initWithData(NSImage::alloc(), &NSData::from_vec(png)));
    let Some(overlay) = overlay else {
        unsafe { app.setApplicationIconImage(Some(&plain)) };
        return;
    };
    let size = plain.size();
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), size);
    let icon = NSImage::initWithSize(NSImage::alloc(), size);
    #[allow(deprecated)]
    {
        icon.lockFocus();
        plain.drawInRect(rect);
        overlay.drawInRect(rect);
        icon.unlockFocus();
    }
    unsafe { app.setApplicationIconImage(Some(&icon)) };
}

#[cfg(not(target_os = "macos"))]
fn show(_png: Option<Vec<u8>>) {}
