// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by the browser for its extension: launch the app and answer.
    let args: Vec<String> = std::env::args().collect();
    if getit_lib::native_host::is_host_launch(&args) {
        return getit_lib::native_host::serve();
    }
    getit_lib::run()
}
