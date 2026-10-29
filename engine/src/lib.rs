//! Download engine for getit.
//!
//! Downloads are organised in queues. Each queue belongs to one folder, has its
//! own settings (how many downloads run at once, paused or not) and its own
//! ordered downloads, and saves itself through a [`QueueStore`] whenever it
//! changes. The [`Engine`] routes commands to queues and runs their downloads:
//! one HTTP connection per file, or several for large files on servers that
//! accept range requests, with pause and resume through range requests.
//!
//! Other layers (UI, logging) observe the engine through [`Engine::subscribe`].

mod engine;
mod queue;
mod rename;
mod store;
mod throttle;
mod types;
mod worker;

pub use engine::Engine;
pub use rename::{apply_rules, rule_errors};
pub use store::{JsonDirStore, MemoryStore, QueueSnapshot, QueueStore};
pub use types::{
    DownloadId, DownloadItem, DownloadStatus, EngineError, EngineEvent, LinkInfo, Pattern, QueueId,
    QueueInfo, QueueSettings, RenameRule, Result, Segment,
};
