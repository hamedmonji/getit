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
    /// the `.part` files on disk (see [`DownloadItem::sync_progress`]).
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
            // Nothing runs yet, so a rename left pending at quit can be applied.
            // If it can't be, it stays pending for the next time the download stops.
            let _ = item.apply_rename(&queue.dir);
            if item.status != DownloadStatus::Completed {
                item.sync_progress(&queue.dir);
            }
            queue.order.push(item.id);
            queue.items.insert(item.id, item);
        }
        queue
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot::new(self.id, self.dir.clone(), self.settings.clone(), self.downloads())
    }

    pub fn save(&self, store: &dyn QueueStore) -> io::Result<()> {
        store.save(&self.snapshot())
    }

    pub fn info(&self) -> QueueInfo {
        QueueInfo {
            id: self.id,
            dir: self.dir.clone(),
            settings: self.settings.clone(),
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

    /// File names the queue's other downloads use or will use, including names
    /// waiting to be applied, so a new download doesn't take one even when that
    /// file is no longer on disk.
    pub fn names_except(&self, id: DownloadId) -> HashSet<String> {
        self.items
            .values()
            .filter(|item| item.id != id)
            .flat_map(|item| [item.file_name.clone(), item.rename_to.clone()])
            .flatten()
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

    /// How many downloads may run at once.
    fn limit(&self) -> usize {
        self.settings.max_concurrent.unwrap_or(usize::MAX)
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
        let free = self.limit().saturating_sub(running);
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

    /// Running downloads to send back to waiting so that the queue's top
    /// downloads, in queue order, run instead, up to its limit. Only for a
    /// running queue. Downloads that can't be resumed keep running and their
    /// slots; the rest are filled from the top by downloads that are running or
    /// waiting.
    pub fn to_make_room(&self, is_running: impl Fn(&DownloadId) -> bool) -> Vec<DownloadId> {
        if self.settings.paused {
            return Vec::new();
        }
        let running: Vec<&DownloadItem> = self
            .order
            .iter()
            .filter(|id| is_running(id))
            .filter_map(|id| self.items.get(id))
            .filter(|item| item.status == DownloadStatus::Downloading)
            .collect();
        let kept = running.iter().filter(|item| item.resumable == Some(false)).count();
        let slots = self.limit().saturating_sub(kept);
        let wanted: HashSet<DownloadId> = self
            .order
            .iter()
            .filter_map(|id| self.items.get(id))
            .filter(|item| item.resumable != Some(false) || !is_running(&item.id))
            .filter(|item| matches!(item.status, DownloadStatus::Queued | DownloadStatus::Downloading))
            .take(slots)
            .map(|item| item.id)
            .collect();
        running
            .into_iter()
            .filter(|item| item.resumable != Some(false) && !wanted.contains(&item.id))
            .map(|item| item.id)
            .collect()
    }
}

/// Most retries a queue can be set to.
pub(crate) const MAX_RETRIES: u32 = 10;

fn sanitize(settings: QueueSettings) -> QueueSettings {
    QueueSettings {
        max_concurrent: settings.max_concurrent.map(|n| n.max(1)),
        retries: settings.retries.min(MAX_RETRIES),
        ..settings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_with(limit: Option<usize>, waiting: usize) -> Queue {
        let mut queue = Queue::new(PathBuf::from("/tmp/q"));
        queue.set_settings(QueueSettings {
            max_concurrent: limit,
            ..Default::default()
        });
        for n in 0..waiting {
            queue.push(DownloadItem {
                id: DownloadId::new(),
                queue_id: queue.id,
                url: format!("https://example.com/{n}"),
                file_name: None,
                total_bytes: None,
                downloaded: 0,
                status: DownloadStatus::Queued,
                resumable: None,
                etag: None,
                last_modified: None,
                error: None,
                added_at: 0,
                started_at: None,
                segments: Vec::new(),
                rename_to: None,
                suggested_name: None,
                original_name: None,
            });
        }
        queue
    }

    #[test]
    fn starts_up_to_the_limit() {
        assert_eq!(queue_with(Some(2), 5).next_to_start(|_| false).len(), 2);
    }

    #[test]
    fn starts_everything_without_a_limit() {
        assert_eq!(queue_with(None, 5).next_to_start(|_| false).len(), 5);
    }

    #[test]
    fn clamps_settings() {
        let mut queue = queue_with(Some(0), 0);
        assert_eq!(queue.settings.max_concurrent, Some(1));
        queue.set_settings(QueueSettings {
            retries: 1000,
            ..Default::default()
        });
        assert_eq!(queue.settings.retries, MAX_RETRIES);
    }
}
