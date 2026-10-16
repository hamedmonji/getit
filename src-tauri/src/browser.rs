//! Local listener for the browser extension (see `browser-extension/`).
//!
//! The extension POSTs `{"urls": [...]}` to `http://127.0.0.1:PORT/add`; the
//! links are handed to the frontend, which shows them as captured until the user
//! adds them to a folder. Only requests from extension pages are accepted, so a
//! website can't add downloads by calling the port itself.

use std::thread;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

/// Must match `PORT` in `browser-extension/background.js`.
pub const PORT: u16 = 47615;
/// Links sent by the extension, as a list of URLs.
const LINKS: &str = "browser://links";

const EXTENSION_ORIGINS: &[&str] = &["chrome-extension://", "moz-extension://", "safari-web-extension://"];

#[derive(Deserialize)]
struct AddRequest {
    urls: Vec<String>,
}

/// Starts listening on a background thread. If the port is taken the app runs
/// on without the extension.
pub fn listen(app: AppHandle) {
    let server = match Server::http(("127.0.0.1", PORT)) {
        Ok(server) => server,
        Err(e) => {
            eprintln!("browser extension listener: couldn't bind port {PORT}: {e}");
            return;
        }
    };
    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&app, request);
        }
    });
}

fn handle(app: &AppHandle, mut request: Request) {
    if !from_extension(&request) {
        return respond(request, 403, "forbidden");
    }
    match (request.method(), request.url()) {
        (Method::Get, "/ping") => respond(request, 200, "getit"),
        (Method::Post, "/add") => {
            let mut body = String::new();
            if request.as_reader().read_to_string(&mut body).is_err() {
                return respond(request, 400, "unreadable body");
            }
            let urls: Vec<String> = match serde_json::from_str::<AddRequest>(&body) {
                Ok(add) => add.urls.into_iter().filter(|u| is_web_url(u)).collect(),
                Err(_) => return respond(request, 400, "expected {\"urls\": [...]}"),
            };
            if urls.is_empty() {
                return respond(request, 400, "no http(s) links");
            }
            if app.emit(LINKS, urls).is_err() {
                return respond(request, 500, "couldn't reach the window");
            }
            bring_to_front(app);
            respond(request, 202, "added")
        }
        _ => respond(request, 404, "not found"),
    }
}

fn from_extension(request: &Request) -> bool {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .is_some_and(|h| EXTENSION_ORIGINS.iter().any(|o| h.value.as_str().starts_with(o)))
}

fn is_web_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn respond(request: Request, status: u16, text: &str) {
    let header = Header::from_bytes("Content-Type", "text/plain; charset=utf-8").expect("valid header");
    let _ = request.respond(Response::from_string(text).with_status_code(status).with_header(header));
}
