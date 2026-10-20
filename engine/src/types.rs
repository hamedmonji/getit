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

/// What the server says about a link before it's downloaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkInfo {
    /// The name a download of it would get, before a free name is picked in its folder.
    pub file_name: String,
    /// Its size, when the server tells.
    pub total_bytes: Option<u64>,
    /// The name the server gave, when `file_name` is that name with the queue's
    /// auto rename rules applied (or changed by the user) before it was added.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
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
    /// When the download was added, in milliseconds since the Unix epoch.
    pub added_at: u64,
    /// When the download last started running, by its queue or by being resumed,
    /// in milliseconds since the Unix epoch. `None` until it first runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// Byte ranges fetched over their own connections into the `.part` file,
    /// which is then as long as the whole file. Empty for a download over one
    /// connection, whose `.part` file holds everything downloaded so far.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<Segment>,
    /// Name the user gave a running download. Its file keeps `file_name` until
    /// the download stops, and is renamed then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_to: Option<String>,
    /// The name the server gave before it was added, shown until it starts and
    /// gets a `file_name`, which may differ if that name is taken in its folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_name: Option<String>,
    /// The name the server gave, before the queue's auto rename rules or the
    /// user renamed it. `None` until known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
}

/// One byte range of a segmented download.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    /// Offset of the range's first byte.
    pub start: u64,
    /// Offset just past the range's last byte.
    pub end: u64,
    /// How much of the range, from `start` on, is written.
    pub downloaded: u64,
}

impl Segment {
    /// Offset of the next byte to download.
    pub fn pos(&self) -> u64 {
        self.start + self.downloaded
    }

    pub fn is_done(&self) -> bool {
        self.pos() >= self.end
    }
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

    /// The name to show: a pending rename, else the file's name.
    pub fn display_name(&self) -> Option<&str> {
        self.rename_to.as_deref().or(self.file_name.as_deref())
    }

    /// Path of the download's file in `dir` as it is on disk now: the finished
    /// file, or the `.part` file.
    pub(crate) fn current_path(&self, dir: &Path) -> Option<PathBuf> {
        if self.status == DownloadStatus::Completed {
            self.file_path(dir)
        } else {
            self.part_path(dir)
        }
    }

    /// Renames the download's file in `dir` to its pending name, if it has one,
    /// picking a free name if something outside the queue took it meanwhile.
    /// Must not be called while a worker writes the file.
    pub(crate) fn apply_rename(&mut self, dir: &Path) -> std::io::Result<()> {
        let Some(wanted) = self.rename_to.clone() else {
            return Ok(());
        };
        let Some(from) = self.current_path(dir) else {
            self.file_name = Some(wanted);
            self.rename_to = None;
            return Ok(());
        };
        let name = if from.exists() {
            // A case-only rename finds the file itself on case-insensitive disks.
            let same = self.file_name.as_deref().is_some_and(|old| old.eq_ignore_ascii_case(&wanted));
            let name = if same {
                wanted
            } else {
                crate::engine::free_file_name(dir, &wanted)?
            };
            let mut renamed = self.clone();
            renamed.file_name = Some(name.clone());
            std::fs::rename(&from, renamed.current_path(dir).expect("name is set"))?;
            name
        } else {
            wanted
        };
        self.file_name = Some(name);
        self.rename_to = None;
        Ok(())
    }

    /// Sets an unfinished download's progress from its partial file in `dir`:
    /// the file's length, or for a segmented download, what its segments got to.
    pub(crate) fn sync_progress(&mut self, dir: &Path) {
        let len = self
            .part_path(dir)
            .and_then(|part| std::fs::metadata(part).ok())
            .map(|meta| meta.len());
        match len {
            Some(_) if !self.segments.is_empty() => {
                self.downloaded = self.segments.iter().map(|segment| segment.downloaded).sum();
            }
            Some(len) => self.downloaded = len,
            None => {
                self.downloaded = 0;
                self.segments.clear();
            }
        }
    }
}

pub(crate) fn part_path(dir: &Path, file_name: &str) -> PathBuf {
    dir.join(format!("{file_name}.part"))
}

/// A queue's own settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QueueSettings {
    /// How many of the queue's downloads may run at once (at least 1), or
    /// `None` for no limit.
    pub max_concurrent: Option<usize>,
    /// A paused queue starts nothing; its running downloads go back to `Queued`.
    pub paused: bool,
    /// How many times in a row a download retries network trouble before it fails.
    pub retries: u32,
    /// Applied in order to the name of each new download, without its extension.
    pub rename: Vec<RenameRule>,
}

impl Default for QueueSettings {
    fn default() -> Self {
        Self {
            max_concurrent: Some(2),
            paused: false,
            retries: 3,
            rename: Vec::new(),
        }
    }
}

/// One step of a queue's auto rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum RenameRule {
    /// Adds text before the name.
    Prefix { text: String },
    /// Adds text after the name, before its extension.
    Suffix { text: String },
    /// Removes every match of the pattern.
    Remove { pattern: Pattern },
    /// Replaces every match of the pattern. A regex's `with` can use `$1`, `${name}`.
    Replace { pattern: Pattern, with: String },
}

/// Text to find in a name: as it is, or as a regular expression.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pattern {
    pub text: String,
    #[serde(default)]
    pub regex: bool,
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
    #[error("couldn't move {name}: {error}")]
    MoveFailed { name: String, error: String },
    #[error("couldn't copy {name}: {error}")]
    CopyFailed { name: String, error: String },
    #[error("couldn't look up {url}: {error}")]
    NameLookupFailed { url: String, error: String },
    #[error("\"{0}\" isn't a valid file name")]
    InvalidName(String),
    #[error("\"{0}\" is already taken")]
    NameTaken(String),
    #[error("couldn't rename {name}: {error}")]
    RenameFailed { name: String, error: String },
}

pub type Result<T> = std::result::Result<T, EngineError>;
