//! Local listener for the browser extension (see `browser-extension/`).
//!
//! The extension POSTs `{"urls": [...], "title": "..."}` to `http://127.0.0.1:PORT/add`; the
//! links are handed to the frontend, which shows them as captured until the user
//! adds them to a folder. Only requests from extension pages are accepted, so a
//! website can't add downloads by calling the port itself.
//!
//! When the app isn't running, the extension starts it through the `getit://`
//! link scheme and sends the links once this listener answers. The listener is
//! up before the window is, so links that arrive before the frontend asks for
//! them with `take_browser_links` wait in the [`Inbox`].

use std::mem;
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server};

/// Must match `PORT` in `browser-extension/background.js`.
pub const PORT: u16 = 47615;
/// Links sent by the extension, with the title of their page.
const LINKS: &str = "browser://links";

const EXTENSION_ORIGINS: &[&str] = &["chrome-extension://", "moz-extension://", "safari-web-extension://"];

#[derive(Deserialize)]
struct AddRequest {
    urls: Vec<String>,
    /// Title of the page the links came from, if any.
    #[serde(default)]
    title: Option<String>,
}

/// What the frontend gets.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Captured {
    urls: Vec<String>,
    title: Option<String>,
}

/// Holds links until the frontend is listening for them.
#[derive(Default)]
pub struct Inbox {
    ready: bool,
    pending: Vec<Captured>,
}

impl Inbox {
    /// Returns `captured` if the frontend is listening, to be sent now;
    /// otherwise keeps it for [`Inbox::open`].
    fn receive(&mut self, captured: Captured) -> Option<Captured> {
        if self.ready {
            return Some(captured);
        }
        self.pending.push(captured);
        None
    }

    /// Marks the frontend as listening and hands over what arrived before it was.
    fn open(&mut self) -> Vec<Captured> {
        self.ready = true;
        mem::take(&mut self.pending)
    }
}

/// Called by the frontend once it listens for links; returns those that came
/// in before it did.
#[tauri::command]
pub fn take_browser_links(inbox: State<'_, Mutex<Inbox>>) -> Vec<Captured> {
    inbox.lock().expect("inbox lock").open()
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
            let add = match serde_json::from_str::<AddRequest>(&body) {
                Ok(add) => add,
                Err(_) => return respond(request, 400, "expected {\"urls\": [...]}"),
            };
            let urls: Vec<String> = add.urls.into_iter().filter(|u| is_web_url(u)).collect();
            if urls.is_empty() {
                return respond(request, 400, "no http(s) links");
            }
            let title = add.title.filter(|t| !t.trim().is_empty());
            let ready = app.state::<Mutex<Inbox>>().lock().expect("inbox lock").receive(Captured { urls, title });
            if let Some(captured) = ready
                && app.emit(LINKS, captured).is_err()
            {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn captured(url: &str) -> Captured {
        Captured { urls: vec![url.into()], title: None }
    }

    #[test]
    fn inbox_keeps_links_until_opened() {
        let mut inbox = Inbox::default();
        assert_eq!(inbox.receive(captured("https://a")), None);
        assert_eq!(inbox.receive(captured("https://b")), None);
        assert_eq!(inbox.open(), vec![captured("https://a"), captured("https://b")]);
    }

    #[test]
    fn inbox_passes_links_through_once_opened() {
        let mut inbox = Inbox::default();
        assert!(inbox.open().is_empty());
        assert_eq!(inbox.receive(captured("https://a")), Some(captured("https://a")));
        assert!(inbox.open().is_empty());
    }
}
