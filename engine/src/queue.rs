//! A queue owns its folder, its settings and its downloads, and knows how to
//! save and restore itself.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;

use crate::schedule::local_minute;
use crate::store::{QueueSnapshot, QueueStore};
use crate::types::{DownloadId, DownloadItem, DownloadStatus, QueueId, QueueInfo, QueueSettings, ScheduleMode};

pub(crate) struct Queue {
    pub id: QueueId,
    pub dir: PathBuf,
    pub settings: QueueSettings,
    pub order: Vec<DownloadId>,
    pub items: HashMap<DownloadId, DownloadItem>,
    /// Outside its schedule's windows when last checked.
    pub closed: bool,
    /// Downloads the user started that wait for a free slot, in the order they
    /// were started. They go before the queue's own order, and start even while
    /// the queue is held, but never past its limit.
    pub started: Vec<DownloadId>,
}

impl Queue {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            id: QueueId::new(),
            dir,
            settings: QueueSettings::default(),
            order: Vec::new(),
            items: HashMap::new(),
            closed: false,
            started: Vec::new(),
        }
    }

    /// Rebuilds a queue from a snapshot. Downloads that were running, whether the
    /// queue or the user started them, come back `Paused`. Progress is taken from
    /// the `.part` files on disk (see [`DownloadItem::sync_progress`]).
    pub fn restore(snapshot: QueueSnapshot) -> Self {
        let settings = sanitize(snapshot.settings);
        let mut queue = Self {
            id: snapshot.id,
            dir: snapshot.dir,
            closed: !settings.schedule.allows(local_minute()),
            settings,
            order: Vec::with_capacity(snapshot.downloads.len()),
            items: HashMap::with_capacity(snapshot.downloads.len()),
            started: Vec::new(),
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
            schedule_closed: self.closed,
            started: self.started.clone(),
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
        self.unstart(id);
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

    /// Replaces the settings. Setting hours closes the queue, and a changed
    /// schedule closes it when it's outside the new windows now, but neither
    /// opens it, even inside a window: that waits for the next window to
    /// start. An open window that's only edited stays open. Going back to any
    /// time opens it.
    pub fn set_settings(&mut self, settings: QueueSettings) {
        let settings = sanitize(settings);
        let (old, new) = (&self.settings.schedule, &settings.schedule);
        if new != old {
            self.closed = new.mode == ScheduleMode::Hours
                && (old.mode == ScheduleMode::Any || self.closed || !new.allows(local_minute()));
        }
        self.settings = settings;
    }

    /// Whether the queue starts nothing: it's paused, or outside its schedule.
    pub fn held(&self) -> bool {
        self.settings.paused || self.closed
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

    /// Puts a waiting download in line to start ahead of the queue's own order,
    /// after the ones started before it. Returns whether it was added.
    pub fn start(&mut self, id: DownloadId) -> bool {
        if !self.items.contains_key(&id) || self.started.contains(&id) {
            return false;
        }
        self.started.push(id);
        true
    }

    /// Takes a download out of the started line. Returns whether it was in it.
    pub fn unstart(&mut self, id: DownloadId) -> bool {
        let before = self.started.len();
        self.started.retain(|other| *other != id);
        self.started.len() != before
    }

    /// Empties the started line, for when the queue's own order takes over
    /// (it was resumed) or everything stops (it was held). Returns whether it
    /// had any.
    pub fn clear_started(&mut self) -> bool {
        !std::mem::take(&mut self.started).is_empty()
    }

    /// Drops downloads from the started line that are running or no longer
    /// waiting. Returns whether any were dropped.
    pub fn prune_started(&mut self, is_running: impl Fn(&DownloadId) -> bool) -> bool {
        let before = self.started.len();
        let items = &self.items;
        self.started.retain(|id| {
            !is_running(id) && items.get(id).is_some_and(|item| item.status == DownloadStatus::Queued)
        });
        self.started.len() != before
    }

    /// How many downloads may run at once.
    fn limit(&self) -> usize {
        self.settings.max_concurrent.unwrap_or(usize::MAX)
    }

    /// The queued downloads to start now to fill the queue's free slots: first
    /// the ones the user started, in the order they were started, then, unless
    /// the queue is held, the rest in queue order. Every running download takes
    /// up a slot.
    pub fn next_to_start(&self, is_running: impl Fn(&DownloadId) -> bool) -> Vec<DownloadId> {
        let running = self
            .order
            .iter()
            .filter(|id| is_running(id))
            .count();
        let free = self.limit().saturating_sub(running);
        let waiting = |id: &&DownloadId| {
            !is_running(id)
                && self
                    .items
                    .get(id)
                    .is_some_and(|item| item.status == DownloadStatus::Queued)
        };
        let started = self.started.iter().filter(waiting);
        let rest = self
            .order
            .iter()
            .filter(|id| !self.held() && !self.started.contains(id))
            .filter(waiting);
        started.chain(rest).copied().take(free).collect()
    }

    /// Running downloads to send back to waiting so that the queue's top
    /// downloads, in queue order, run instead, up to its limit. Only for a
    /// running queue. Downloads that can't be resumed keep running and their
    /// slots; the rest are filled from the top by downloads that are running or
    /// waiting.
    pub fn to_make_room(&self, is_running: impl Fn(&DownloadId) -> bool) -> Vec<DownloadId> {
        if self.held() {
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
        schedule: settings.schedule.sanitized(),
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
    fn starts_nothing_outside_its_schedule() {
        let mut queue = queue_with(None, 3);
        queue.closed = true;
        assert!(queue.next_to_start(|_| false).is_empty());
        queue.closed = false;
        assert_eq!(queue.next_to_start(|_| false).len(), 3);
    }

    #[test]
    fn starts_downloads_started_by_hand_first_in_the_order_they_were_started() {
        let mut queue = queue_with(Some(2), 4);
        let ids = queue.order.clone();
        queue.start(ids[3]);
        queue.start(ids[1]);
        assert_eq!(queue.next_to_start(|_| false), vec![ids[3], ids[1]]);
        queue.set_settings(QueueSettings { max_concurrent: Some(3), ..Default::default() });
        assert_eq!(queue.next_to_start(|_| false), vec![ids[3], ids[1], ids[0]]);
    }

    #[test]
    fn a_held_queue_starts_only_downloads_started_by_hand_within_its_limit() {
        let mut queue = queue_with(Some(1), 3);
        let ids = queue.order.clone();
        queue.settings.paused = true;
        assert!(queue.next_to_start(|_| false).is_empty());
        queue.start(ids[2]);
        queue.start(ids[0]);
        assert_eq!(queue.next_to_start(|_| false), vec![ids[2]]);
        // Full while ids[2] runs.
        assert!(queue.next_to_start(|id| *id == ids[2]).is_empty());
        queue.closed = true;
        queue.settings.paused = false;
        assert_eq!(queue.next_to_start(|_| false), vec![ids[2]]);
    }

    #[test]
    fn starts_a_download_once_and_only_while_it_waits() {
        let mut queue = queue_with(None, 2);
        let ids = queue.order.clone();
        assert!(queue.start(ids[0]));
        assert!(!queue.start(ids[0]));
        assert!(!queue.start(DownloadId::new()));
        queue.items.get_mut(&ids[0]).unwrap().status = DownloadStatus::Paused;
        assert_eq!(queue.next_to_start(|_| false), vec![ids[1]]);
    }

    #[test]
    fn prunes_downloads_that_started_or_stopped_waiting() {
        let mut queue = queue_with(None, 3);
        let ids = queue.order.clone();
        for id in &ids {
            queue.start(*id);
        }
        queue.items.get_mut(&ids[1]).unwrap().status = DownloadStatus::Paused;
        assert!(queue.prune_started(|id| *id == ids[0]));
        assert_eq!(queue.started, vec![ids[2]]);
        assert!(!queue.prune_started(|_| false));
        queue.remove(ids[2]);
        assert!(queue.started.is_empty());
    }

    #[test]
    fn clears_and_unstarts() {
        let mut queue = queue_with(None, 2);
        let ids = queue.order.clone();
        queue.start(ids[0]);
        queue.start(ids[1]);
        assert!(queue.unstart(ids[0]));
        assert!(!queue.unstart(ids[0]));
        assert_eq!(queue.info().started, vec![ids[1]]);
        assert!(queue.clear_started());
        assert!(!queue.clear_started());
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
