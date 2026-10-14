mod commands;

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
        .setup(|app| {
            let store = JsonDirStore::new(app.path().app_data_dir()?.join("queues"))?;
            // The engine spawns its tasks on the runtime it is created in.
            let engine = async_runtime::block_on(async { Engine::new(store) })?;
            forward_events(app.handle().clone(), &engine);
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::home_dir,
            commands::initial_dir,
            commands::list_dir,
            commands::add_download,
            commands::pause_download,
            commands::resume_download,
            commands::requeue_downloads,
            commands::create_queue,
            commands::rename_folder,
            commands::move_folders,
            commands::move_downloads,
            commands::remove_download,
            commands::move_to_trash,
            commands::set_queue_settings,
            commands::clear_completed,
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
