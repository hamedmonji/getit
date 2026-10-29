mod access;
mod browser;
mod commands;
mod dock;
pub mod native_host;
mod relaunch;
mod thumbnail;

use std::sync::Mutex;

use getit_engine::{Engine, JsonDirStore};
use tauri::async_runtime;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast::error::RecvError;

/// Every engine event, forwarded as-is.
const EVENT: &str = "engine://event";
/// The frontend missed events and should reload the full state.
const RESYNC: &str = "engine://resync";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Registers the `getit://` scheme, which the browser extension opens to
        // start the app; the link itself carries nothing.
        .plugin(tauri_plugin_deep_link::init())
        .manage(Mutex::new(browser::Inbox::default()))
        .setup(|app| {
            let store = JsonDirStore::new(app.path().app_data_dir()?.join("queues"))?;
            // The engine spawns its tasks on the runtime it is created in.
            let engine = async_runtime::block_on(async { Engine::new(store) })?;
            forward_events(app.handle().clone(), &engine);
            app.manage(engine);
            browser::listen(app.handle().clone());
            native_host::register(&app.path().home_dir()?);
            app.manage(access::Access::load(
                app.path().home_dir()?,
                app.path().app_data_dir()?.join("setup.json"),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::home_dir,
            commands::initial_dir,
            commands::list_dir,
            commands::access_setup,
            commands::app_bundle,
            commands::set_access_setup,
            commands::set_access_folders,
            commands::full_disk_access,
            commands::reset_access_setup,
            commands::probe_link,
            commands::auto_names,
            commands::preview_rename,
            commands::file_exists,
            commands::add_download,
            commands::set_download_url,
            commands::pause_download,
            commands::resume_download,
            commands::requeue_downloads,
            commands::create_queue,
            commands::rename_folder,
            commands::rename_download,
            commands::move_folders,
            commands::move_downloads,
            commands::copy_folders,
            commands::copy_downloads,
            commands::remove_download,
            commands::move_to_trash,
            commands::restore_from_trash,
            commands::set_queue_settings,
            commands::reorder_queue,
            commands::clear_completed,
            commands::set_speed_limit,
            browser::take_browser_links,
            dock::set_dock_overlay,
            relaunch::relaunch,
            thumbnail::thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn forward_events(app: AppHandle, engine: &Engine) {
    let mut events = engine.subscribe();
    async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => {
                    let _ = app.emit(EVENT, event);
                }
                Err(RecvError::Lagged(_)) => {
                    let _ = app.emit(RESYNC, ());
                }
                Err(RecvError::Closed) => break,
            }
        }
    });
}
