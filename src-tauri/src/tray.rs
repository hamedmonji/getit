//! On Windows, the system tray icon that keeps getit reachable while its
//! window is hidden by closing it. Shown only while the General settings say
//! closing the window keeps getit running; clicking it brings the window back,
//! and its menu can also quit.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::browser;

const TRAY_ID: &str = "main";
const SHOW: &str = "show";
const QUIT: &str = "quit";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Platform {
    Mac,
    Windows,
    Other,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Platform::Mac
        } else if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Other
        }
    }
}

/// Whether closing the window only hides it: always on macOS, on Windows when
/// `close_to_tray` is set, and never elsewhere.
pub fn hides_on_close(platform: Platform, close_to_tray: bool) -> bool {
    match platform {
        Platform::Mac => true,
        Platform::Windows => close_to_tray,
        Platform::Other => false,
    }
}

/// Shows the tray icon when `wanted`, or takes it away; Windows only.
pub fn update(app: &AppHandle, wanted: bool) {
    if Platform::current() != Platform::Windows {
        return;
    }
    let showing = app.tray_by_id(TRAY_ID).is_some();
    if wanted && !showing {
        if let Err(e) = create(app) {
            eprintln!("couldn't show the tray icon: {e}");
        }
    } else if !wanted && showing {
        app.remove_tray_by_id(TRAY_ID);
        // With no icon left to bring it back, a hidden window comes back now.
        browser::bring_to_front(app);
    }
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, SHOW, "Show getit", true, None::<&str>)?,
            &MenuItem::with_id(app, QUIT, "Quit getit", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("getit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => browser::bring_to_front(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                browser::bring_to_front(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mac_always_hides_on_close() {
        assert!(hides_on_close(Platform::Mac, false));
        assert!(hides_on_close(Platform::Mac, true));
    }

    #[test]
    fn windows_hides_on_close_only_when_set() {
        assert!(hides_on_close(Platform::Windows, true));
        assert!(!hides_on_close(Platform::Windows, false));
    }

    #[test]
    fn elsewhere_closing_quits() {
        assert!(!hides_on_close(Platform::Other, true));
        assert!(!hides_on_close(Platform::Other, false));
    }
}
