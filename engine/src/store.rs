//! Where queues save themselves. The engine only talks to the [`QueueStore`]
//! trait, so the storage backend can be swapped without touching queues.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::types::{DownloadItem, QueueId, QueueSettings};

const SNAPSHOT_VERSION: u32 = 1;

/// Everything needed to rebuild a queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueSnapshot {
    pub version: u32,
    pub id: QueueId,
    pub dir: PathBuf,
    pub settings: QueueSettings,
    /// The queue's downloads, in queue order.
    pub downloads: Vec<DownloadItem>,
}

impl QueueSnapshot {
    pub(crate) fn new(
        id: QueueId,
        dir: PathBuf,
        settings: QueueSettings,
        downloads: Vec<DownloadItem>,
    ) -> Self {
        Self {
            version: SNAPSHOT_VERSION,
            id,
            dir,
            settings,
            downloads,
        }
    }
}

/// Persistence backend for queues. Each queue is saved and deleted on its own.
pub trait QueueStore: Send + Sync + 'static {
    fn save(&self, snapshot: &QueueSnapshot) -> io::Result<()>;
    fn delete(&self, id: QueueId) -> io::Result<()>;
    fn load_all(&self) -> io::Result<Vec<QueueSnapshot>>;
}

impl<T: QueueStore + ?Sized> QueueStore for Arc<T> {
    fn save(&self, snapshot: &QueueSnapshot) -> io::Result<()> {
        (**self).save(snapshot)
    }

    fn delete(&self, id: QueueId) -> io::Result<()> {
        (**self).delete(id)
    }

    fn load_all(&self) -> io::Result<Vec<QueueSnapshot>> {
        (**self).load_all()
    }
}

/// Saves each queue as `<queue id>.json` in a directory.
pub struct JsonDirStore {
    dir: PathBuf,
}

impl JsonDirStore {
    /// Uses `dir` for queue files, creating it if needed.
    pub fn new(dir: impl Into<PathBuf>) -> io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, id: QueueId) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }
}

impl QueueStore for JsonDirStore {
    /// Writes to a temporary file and renames it, so a crash never leaves a
    /// half-written queue behind.
    fn save(&self, snapshot: &QueueSnapshot) -> io::Result<()> {
        let path = self.path(snapshot.id);
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_vec_pretty(snapshot).map_err(io::Error::other)?;
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&json)?;
        file.sync_all()?;
        fs::rename(&tmp, &path)
    }

    fn delete(&self, id: QueueId) -> io::Result<()> {
        match fs::remove_file(self.path(id)) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }

    /// Loads every queue file. Files that can't be read or parsed are skipped
    /// and left in place.
    fn load_all(&self) -> io::Result<Vec<QueueSnapshot>> {
        let mut snapshots = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let path = entry?.path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            if let Ok(snapshot) = serde_json::from_slice::<QueueSnapshot>(&bytes) {
                snapshots.push(snapshot);
            }
        }
        Ok(snapshots)
    }
}

/// Keeps snapshots in memory only. Useful for tests and for running without persistence.
#[derive(Default)]
pub struct MemoryStore {
    snapshots: Mutex<HashMap<QueueId, QueueSnapshot>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl QueueStore for MemoryStore {
    fn save(&self, snapshot: &QueueSnapshot) -> io::Result<()> {
        self.snapshots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(snapshot.id, snapshot.clone());
        Ok(())
    }

    fn delete(&self, id: QueueId) -> io::Result<()> {
        self.snapshots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        Ok(())
    }

    fn load_all(&self) -> io::Result<Vec<QueueSnapshot>> {
        Ok(self
            .snapshots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .cloned()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_store_round_trips_and_skips_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let store = JsonDirStore::new(dir.path().join("queues")).unwrap();
        let snapshot = QueueSnapshot::new(
            QueueId::new(),
            PathBuf::from("/tmp/x"),
            QueueSettings::default(),
            Vec::new(),
        );
        store.save(&snapshot).unwrap();
        std::fs::write(store.dir().join("broken.json"), b"{not json").unwrap();
        assert_eq!(store.load_all().unwrap(), vec![snapshot.clone()]);

        store.delete(snapshot.id).unwrap();
        store.delete(snapshot.id).unwrap();
        assert!(store.load_all().unwrap().is_empty());
    }
}
