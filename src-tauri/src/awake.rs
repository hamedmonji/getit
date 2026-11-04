//! Keeps the Mac from going to sleep on its own while a download runs, when
//! the Downloads settings say to. The display may still sleep.

use std::sync::atomic::{AtomicBool, Ordering};

use getit_engine::Engine;
use tauri::AppHandle;

use crate::dock::any_downloading;

/// Whether getit is keeping the Mac awake now.
static HOLDING: AtomicBool = AtomicBool::new(false);

/// Keeps the Mac awake if `wanted` and a download is running, or lets it sleep again.
pub fn update(app: &AppHandle, engine: &Engine, wanted: bool) {
    let hold = wanted && any_downloading(engine);
    if HOLDING.swap(hold, Ordering::SeqCst) != hold {
        let _ = app.run_on_main_thread(move || set(hold));
    }
}

#[cfg(target_os = "macos")]
fn set(hold: bool) {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};

    thread_local! {
        /// The activity that keeps the Mac awake while it's held.
        static ACTIVITY: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(None) };
    }

    let info = NSProcessInfo::processInfo();
    ACTIVITY.with(|activity| {
        let mut activity = activity.borrow_mut();
        if hold && activity.is_none() {
            *activity = Some(info.beginActivityWithOptions_reason(
                NSActivityOptions::IdleSystemSleepDisabled,
                &NSString::from_str("Downloading files"),
            ));
        } else if !hold && let Some(token) = activity.take() {
            // SAFETY: the token came from beginActivity on this process info.
            unsafe { info.endActivity(&token) };
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn set(_hold: bool) {}
