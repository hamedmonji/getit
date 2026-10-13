use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub(crate) fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

id_type!(
    /// Unique identifier of a download.
    DownloadId
);
id_type!(
    /// Unique identifier of a queue.
    QueueId
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    /// Waiting for its queue to start it.
    Queued,
    Downloading,
    Paused,
    Completed,
    /// Stopped after an error that retries could not fix. See [`DownloadItem::error`].
    Failed,
}

/// Snapshot of a download's state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: DownloadId,
    pub queue_id: QueueId,
    pub url: String,
    /// Final file name inside the queue's folder. `None` until the server first responds.
    pub file_name: Option<String>,
    /// Total size, when the server reports it.
    pub total_bytes: Option<u64>,
    pub downloaded: u64,
    pub status: DownloadStatus,
    /// Whether the server supports range requests. `None` until known.
    pub resumable: Option<bool>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub error: Option<String>,
    /// Started on its own (resumed by the user) rather than by its queue. Such
    /// downloads don't take up queue slots and aren't stopped by pausing the queue.
    #[serde(default)]
    pub manual: bool,
    /// When the download was added, in milliseconds since the Unix epoch.
    pub added_at: u64,
}

impl DownloadItem {
    /// Path of the finished file inside `dir` (the queue's folder), once the name is known.
    pub fn file_path(&self, dir: &Path) -> Option<PathBuf> {
        self.file_name.as_ref().map(|name| dir.join(name))
    }

    /// Path of the in-progress `.part` file inside `dir`, once the name is known.
    pub fn part_path(&self, dir: &Path) -> Option<PathBuf> {
        self.file_name.as_ref().map(|name| part_path(dir, name))
    }
}

pub(crate) fn part_path(dir: &Path, file_name: &str) -> PathBuf {
    dir.join(format!("{file_name}.part"))
}

/// A queue's own settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QueueSettings {
    /// How many of the queue's downloads may run at once (at least 1).
    pub max_concurrent: usize,
    /// A paused queue starts nothing; the downloads it started go back to `Queued`.
    pub paused: bool,
}

impl Default for QueueSettings {
    fn default() -> Self {
        Self {
            max_concurrent: 2,
            paused: false,
        }
    }
}

/// Snapshot of a queue: its folder, settings and download order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueInfo {
    pub id: QueueId,
    /// Folder the queue downloads into. Each folder has at most one queue.
    pub dir: PathBuf,
    pub settings: QueueSettings,
    /// The queue's downloads, in queue order.
    pub downloads: Vec<DownloadId>,
}

/// Change notifications sent to every [`subscriber`](crate::Engine::subscribe).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EngineEvent {
    /// A queue was created, or its settings or download order changed.
    QueueChanged(QueueInfo),
    QueueRemoved {
        id: QueueId,
    },
    DownloadAdded(DownloadItem),
    /// Status or metadata changed. Carries the full updated snapshot.
    DownloadChanged(DownloadItem),
    DownloadRemoved {
        id: DownloadId,
        queue_id: QueueId,
    },
    /// Sent about every 250 ms while a download is running.
    Progress {
        id: DownloadId,
        downloaded: u64,
        total: Option<u64>,
        speed_bps: u64,
    },
    /// A queue could not be saved to its store. The in-memory state is unaffected.
    SaveFailed {
        queue_id: QueueId,
        error: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("download {0} not found")]
    DownloadNotFound(DownloadId),
    #[error("queue {0} not found")]
    QueueNotFound(QueueId),
    #[error("cannot {action} a download that is {status:?}")]
    InvalidState {
        action: &'static str,
        status: DownloadStatus,
    },
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("queue folder must be an absolute path: {0}")]
    InvalidDir(PathBuf),
    #[error("{0} has downloads in progress; pause them first")]
    QueueBusy(PathBuf),
    #[error("{0} already has a queue")]
    DirTaken(PathBuf),
}

pub type Result<T> = std::result::Result<T, EngineError>;
