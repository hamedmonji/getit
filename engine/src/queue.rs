//! A queue owns its folder, its settings and its downloads, and knows how to
//! save and restore itself.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;

use crate::store::{QueueSnapshot, QueueStore};
use crate::types::{DownloadId, DownloadItem, DownloadStatus, QueueId, QueueInfo, QueueSettings};

pub(crate) struct Queue {
    pub id: QueueId,
    pub dir: PathBuf,
    pub settings: QueueSettings,
    pub order: Vec<DownloadId>,
    pub items: HashMap<DownloadId, DownloadItem>,
}

impl Queue {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            id: QueueId::new(),
            dir,
            settings: QueueSettings::default(),
            order: Vec::new(),
            items: HashMap::new(),
        }
    }

    /// Rebuilds a queue from a snapshot. Downloads that were running, whether the
    /// queue or the user started them, come back `Paused`. Progress is taken from
    /// the `.part` files on disk.
    pub fn restore(snapshot: QueueSnapshot) -> Self {
        let mut queue = Self {
            id: snapshot.id,
            dir: snapshot.dir,
            settings: sanitize(snapshot.settings),
            order: Vec::with_capacity(snapshot.downloads.len()),
            items: HashMap::with_capacity(snapshot.downloads.len()),
        };
        for mut item in snapshot.downloads {
            if queue.items.contains_key(&item.id) {
                continue;
            }
            item.queue_id = queue.id;
            if item.status == DownloadStatus::Downloading {
                item.status = DownloadStatus::Paused;
            }
            if item.status != DownloadStatus::Completed {
                item.downloaded = item
                    .part_path(&queue.dir)
                    .and_then(|part| std::fs::metadata(part).ok())
                    .map_or(0, |meta| meta.len());
            }
            queue.order.push(item.id);
            queue.items.insert(item.id, item);
        }
        queue
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot::new(self.id, self.dir.clone(), self.settings, self.downloads())
    }

    pub fn save(&self, store: &dyn QueueStore) -> io::Result<()> {
        store.save(&self.snapshot())
    }

    pub fn info(&self) -> QueueInfo {
        QueueInfo {
            id: self.id,
            dir: self.dir.clone(),
            settings: self.settings,
            downloads: self.order.clone(),
        }
    }

    /// Downloads in queue order.
    pub fn downloads(&self) -> Vec<DownloadItem> {
        self.order
            .iter()
            .filter_map(|id| self.items.get(id).cloned())
            .collect()
    }

    pub fn push(&mut self, item: DownloadItem) {
        self.order.push(item.id);
        self.items.insert(item.id, item);
    }

    pub fn remove(&mut self, id: DownloadId) -> Option<DownloadItem> {
        let item = self.items.remove(&id)?;
        self.order.retain(|other| *other != id);
        Some(item)
    }

    /// File names the queue's other downloads use or will use, so a new download
    /// doesn't take one even when that file is no longer on disk.
    pub fn names_except(&self, id: DownloadId) -> HashSet<String> {
        self.items
            .values()
            .filter(|item| item.id != id)
            .filter_map(|item| item.file_name.clone())
            .collect()
    }

    pub fn set_settings(&mut self, settings: QueueSettings) {
        self.settings = sanitize(settings);
    }

    /// Moves the given downloads to the front, in the given order. Unknown ids are
    /// ignored and the rest keep their relative order.
    pub fn reorder(&mut self, ids: &[DownloadId]) {
        let mut order: Vec<DownloadId> = Vec::with_capacity(self.order.len());
        for id in ids {
            if self.items.contains_key(id) && !order.contains(id) {
                order.push(*id);
            }
        }
        for id in &self.order {
            if !order.contains(id) {
                order.push(*id);
            }
        }
        self.order = order;
    }

    /// The queued downloads to start now, in queue order, to fill the queue's free
    /// slots. Every running download takes up a slot, including ones the user
    /// started past the limit.
    pub fn next_to_start(&self, is_running: impl Fn(&DownloadId) -> bool) -> Vec<DownloadId> {
        if self.settings.paused {
            return Vec::new();
        }
        let running = self
            .order
            .iter()
            .filter(|id| is_running(id))
            .count();
        let free = self.settings.max_concurrent.saturating_sub(running);
        self.order
            .iter()
            .copied()
            .filter(|id| {
                !is_running(id)
                    && self
                        .items
                        .get(id)
                        .is_some_and(|item| item.status == DownloadStatus::Queued)
            })
            .take(free)
            .collect()
    }
}

fn sanitize(settings: QueueSettings) -> QueueSettings {
    QueueSettings {
        max_concurrent: settings.max_concurrent.max(1),
        ..settings
    }
}
