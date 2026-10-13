use std::collections::HashMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Client, Url};
use tokio::runtime::Handle;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;

use crate::queue::Queue;
use crate::store::QueueStore;
use crate::types::{
    DownloadId, DownloadItem, DownloadStatus, EngineError, EngineEvent, QueueId, QueueInfo,
    QueueSettings, Result,
};
use crate::types::part_path;
use crate::worker::{self, Job, Outcome, WorkerMsg, split_extension};

const EVENT_CAPACITY: usize = 1024;
const USER_AGENT: &str = concat!("getit/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Runs downloads for any number of queues.
///
/// Each queue belongs to one folder, has its own settings and downloads, and
/// saves itself to the [`QueueStore`] whenever it changes. The engine itself only
/// routes commands to queues and runs their workers.
///
/// Cloning is cheap; clones share the same queues. Dropping the last clone stops
/// every running download.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

struct Inner {
    state: Mutex<State>,
    store: Box<dyn QueueStore>,
    events: broadcast::Sender<EngineEvent>,
    client: Client,
    worker_tx: mpsc::UnboundedSender<WorkerMsg>,
    runtime: Handle,
}

#[derive(Default)]
struct State {
    queues: HashMap<QueueId, Queue>,
    by_dir: HashMap<PathBuf, QueueId>,
    /// Which queue each download belongs to.
    owner: HashMap<DownloadId, QueueId>,
    /// Downloads with a running worker task.
    active: HashMap<DownloadId, Active>,
}

struct Active {
    token: CancellationToken,
    /// Why the worker was told to stop, if it was.
    stop: Option<Stop>,
    /// Start a new worker as soon as this one has stopped (started again while pausing).
    restart: bool,
    /// Folder the worker writes into, when the download moved to another queue
    /// while it was running. Its file follows once the worker has stopped.
    moved_from: Option<PathBuf>,
}

impl Active {
    fn stop(&mut self, stop: Stop) {
        self.stop = Some(stop);
        self.restart = false;
        self.token.cancel();
    }
}

#[derive(Clone, Copy)]
enum Stop {
    /// Keep the partial file; the download's status was already updated.
    Pause,
    /// The download was removed; delete its partial file once the worker stops.
    Remove,
}

impl Engine {
    /// Loads every saved queue from `store` and starts their queued downloads.
    /// Downloads that were running when the queues were saved resume from their
    /// partial files.
    ///
    /// # Panics
    ///
    /// Panics if called outside a Tokio runtime.
    pub fn new(store: impl QueueStore) -> io::Result<Self> {
        let runtime = Handle::current();
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .build()
            .map_err(io::Error::other)?;
        let snapshots = store.load_all()?;
        let (worker_tx, worker_rx) = mpsc::unbounded_channel();
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        let inner = Arc::new(Inner {
            state: Mutex::new(State::default()),
            store: Box::new(store),
            events,
            client,
            worker_tx,
            runtime: runtime.clone(),
        });
        runtime.spawn(drive(Arc::downgrade(&inner), worker_rx));

        {
            let mut guard = inner.lock();
            let st = &mut *guard;
            for snapshot in snapshots {
                let mut queue = Queue::restore(snapshot);
                // Older saves could hold a folder with a trailing slash.
                if let Ok(dir) = normalize(&queue.dir) {
                    queue.dir = dir;
                }
                if st.by_dir.contains_key(&queue.dir) || st.queues.contains_key(&queue.id) {
                    continue;
                }
                st.by_dir.insert(queue.dir.clone(), queue.id);
                st.owner
                    .extend(queue.order.iter().map(|id| (*id, queue.id)));
                st.queues.insert(queue.id, queue);
            }
            // Restart downloads that had been started on their own.
            for queue in st.queues.values() {
                for item in queue.items.values() {
                    if item.status == DownloadStatus::Downloading {
                        inner.spawn(&mut st.active, item, &queue.dir);
                    }
                }
            }
            let ids: Vec<QueueId> = st.queues.keys().copied().collect();
            for id in ids {
                inner.schedule(st, id);
            }
        }
        Ok(Self { inner })
    }

    /// Receives every change from now on. A receiver that falls more than 1024
    /// events behind gets `RecvError::Lagged` and should re-read the state.
    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.inner.events.subscribe()
    }

    /// All queues, sorted by folder.
    pub fn queues(&self) -> Vec<QueueInfo> {
        let st = self.inner.lock();
        let mut queues: Vec<QueueInfo> = st.queues.values().map(Queue::info).collect();
        queues.sort_by(|a, b| a.dir.cmp(&b.dir));
        queues
    }

    pub fn queue(&self, id: QueueId) -> Option<QueueInfo> {
        self.inner.lock().queues.get(&id).map(Queue::info)
    }

    /// The queue that downloads into `dir`, if there is one.
    pub fn queue_for_dir(&self, dir: impl AsRef<Path>) -> Option<QueueId> {
        let dir = normalize(dir.as_ref()).ok()?;
        self.inner.lock().by_dir.get(&dir).copied()
    }

    /// Returns the queue for `dir`, creating it with default settings if needed.
    /// `dir` must be absolute.
    pub fn ensure_queue(&self, dir: impl AsRef<Path>) -> Result<QueueId> {
        let dir = normalize(dir.as_ref())?;
        let mut guard = self.inner.lock();
        Ok(self.inner.ensure_queue(&mut guard, dir))
    }

    /// Stops and forgets a queue and its downloads. Partial files are deleted;
    /// completed files stay on disk.
    pub fn remove_queue(&self, id: QueueId) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = st
            .queues
            .remove(&id)
            .ok_or(EngineError::QueueNotFound(id))?;
        st.by_dir.remove(&queue.dir);
        for item in queue.downloads() {
            st.owner.remove(&item.id);
            discard(&mut st.active, &item, &queue.dir);
            self.inner.emit(EngineEvent::DownloadRemoved {
                id: item.id,
                queue_id: id,
            });
        }
        if let Err(e) = self.inner.store.delete(id) {
            self.inner.emit(EngineEvent::SaveFailed {
                queue_id: id,
                error: e.to_string(),
            });
        }
        self.inner.emit(EngineEvent::QueueRemoved { id });
        Ok(())
    }

    /// Points every queue in `old` (or in a folder inside it) at the same place
    /// under `new`, after the folder was moved or renamed on disk. Fails without
    /// changing anything if one of those queues has a download running, or if a
    /// queue already uses a destination. Returns how many queues moved.
    pub fn relocate(&self, old: impl AsRef<Path>, new: impl AsRef<Path>) -> Result<usize> {
        let old = normalize(old.as_ref())?;
        let new = normalize(new.as_ref())?;
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let moves: Vec<(QueueId, PathBuf)> = st
            .queues
            .values()
            .filter_map(|queue| {
                let rest = queue.dir.strip_prefix(&old).ok()?;
                // `join("")` would add a trailing slash; normalizing drops it.
                Some((queue.id, normalize(&new.join(rest)).ok()?))
            })
            .collect();
        for (id, dir) in &moves {
            let queue = &st.queues[id];
            if queue.order.iter().any(|d| st.active.contains_key(d)) {
                return Err(EngineError::QueueBusy(queue.dir.clone()));
            }
            if st
                .by_dir
                .get(dir)
                .is_some_and(|other| !moves.iter().any(|(moved, _)| moved == other))
            {
                return Err(EngineError::DirTaken(dir.clone()));
            }
        }
        for (id, _) in &moves {
            let dir = &st.queues[id].dir;
            st.by_dir.remove(dir);
        }
        for (id, dir) in &moves {
            let queue = st.queues.get_mut(id).expect("queue exists");
            queue.dir = dir.clone();
            st.by_dir.insert(dir.clone(), *id);
            self.inner.save(queue);
            self.inner.emit(EngineEvent::QueueChanged(queue.info()));
        }
        Ok(moves.len())
    }

    /// Replaces a queue's settings. Pausing stops the downloads the queue started
    /// and puts them back to `Queued` (downloads started on their own keep going);
    /// unpausing or adding slots lets the queue start more.
    pub fn set_queue_settings(&self, id: QueueId, settings: QueueSettings) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = st
            .queues
            .get_mut(&id)
            .ok_or(EngineError::QueueNotFound(id))?;
        queue.set_settings(settings);
        if queue.settings.paused {
            for download_id in &queue.order {
                if let (Some(active), Some(item)) = (
                    st.active.get_mut(download_id),
                    queue.items.get_mut(download_id),
                ) && item.status == DownloadStatus::Downloading
                    && !item.manual
                {
                    item.status = DownloadStatus::Queued;
                    active.stop(Stop::Pause);
                    self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
                }
            }
        }
        self.inner.save(queue);
        self.inner.emit(EngineEvent::QueueChanged(queue.info()));
        self.inner.schedule(st, id);
        Ok(())
    }

    /// Moves the given downloads to the front of their queue, in the given order.
    /// Unknown ids are ignored. Running downloads are not interrupted.
    pub fn reorder_queue(&self, id: QueueId, ids: &[DownloadId]) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = st
            .queues
            .get_mut(&id)
            .ok_or(EngineError::QueueNotFound(id))?;
        queue.reorder(ids);
        self.inner.save(queue);
        self.inner.emit(EngineEvent::QueueChanged(queue.info()));
        self.inner.schedule(st, id);
        Ok(())
    }

    /// Moves downloads to the end of the queue for `dir` (creating it if needed),
    /// taking their files along. Downloads the old queue was running wait in the
    /// new one; ones started on their own restart there. A file whose name is
    /// taken in `dir` gets a free one. Downloads already in that queue stay put.
    pub fn move_downloads(&self, ids: &[DownloadId], dir: impl AsRef<Path>) -> Result<()> {
        let dir = normalize(dir.as_ref())?;
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        if let Some(id) = ids.iter().find(|id| !st.owner.contains_key(id)) {
            return Err(EngineError::DownloadNotFound(*id));
        }
        let target = self.inner.ensure_queue(st, dir.clone());
        let mut sources: Vec<QueueId> = Vec::new();
        let mut result = Ok(());
        for &id in ids {
            let source = st.owner[&id];
            if source == target {
                continue;
            }
            let from = st.queues.get_mut(&source).expect("owner queue exists");
            let running = st.active.contains_key(&id);
            // A running worker still writes into the old folder; its file moves when it stops.
            if !running {
                let item = &from.items[&id];
                match move_file(item, &from.dir, &dir) {
                    Ok(name) => from.items.get_mut(&id).expect("item exists").file_name = name,
                    Err(e) => {
                        result = Err(EngineError::MoveFailed {
                            name: item.file_name.clone().unwrap_or_else(|| item.url.clone()),
                            error: e.to_string(),
                        });
                        break;
                    }
                }
            }
            let mut item = from.remove(id).expect("owned download exists");
            if let Some(active) = st.active.get_mut(&id) {
                let manual = item.status == DownloadStatus::Downloading && item.manual;
                if item.status == DownloadStatus::Downloading && !manual {
                    item.status = DownloadStatus::Queued;
                }
                active.stop(Stop::Pause);
                active.restart = manual;
                active.moved_from.get_or_insert_with(|| from.dir.clone());
            }
            item.queue_id = target;
            st.owner.insert(id, target);
            self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
            st.queues
                .get_mut(&target)
                .expect("target queue exists")
                .push(item);
            if !sources.contains(&source) {
                sources.push(source);
            }
        }
        for id in sources.into_iter().chain([target]) {
            let queue = &st.queues[&id];
            self.inner.save(queue);
            self.inner.emit(EngineEvent::QueueChanged(queue.info()));
            self.inner.schedule(st, id);
        }
        result
    }

    /// Adds `url` to the end of a queue.
    pub fn add(&self, queue_id: QueueId, url: &str) -> Result<DownloadId> {
        let url = validate_url(url)?;
        let mut guard = self.inner.lock();
        if !guard.queues.contains_key(&queue_id) {
            return Err(EngineError::QueueNotFound(queue_id));
        }
        Ok(self.inner.add(&mut guard, queue_id, url))
    }

    /// Adds `url` to the queue for `dir`, creating the queue if needed.
    pub fn enqueue(&self, dir: impl AsRef<Path>, url: &str) -> Result<DownloadId> {
        let dir = normalize(dir.as_ref())?;
        let url = validate_url(url)?;
        let mut guard = self.inner.lock();
        let queue_id = self.inner.ensure_queue(&mut guard, dir);
        Ok(self.inner.add(&mut guard, queue_id, url))
    }

    /// Pauses a downloading or queued download. The partial file is kept.
    pub fn pause(&self, id: DownloadId) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = owner_queue(&mut st.queues, &st.owner, id)?;
        let item = queue
            .items
            .get_mut(&id)
            .ok_or(EngineError::DownloadNotFound(id))?;
        if !matches!(
            item.status,
            DownloadStatus::Queued | DownloadStatus::Downloading
        ) {
            return Err(invalid("pause", item));
        }
        item.status = DownloadStatus::Paused;
        self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
        if let Some(active) = st.active.get_mut(&id) {
            active.stop(Stop::Pause);
        }
        self.inner.save(queue);
        Ok(())
    }

    /// Starts a paused or failed download right away, on its own, continuing from
    /// its partial file. It runs whether or not its queue is paused or full, takes
    /// no queue slot, and starts nothing else.
    pub fn resume(&self, id: DownloadId) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = owner_queue(&mut st.queues, &st.owner, id)?;
        let item = queue
            .items
            .get_mut(&id)
            .ok_or(EngineError::DownloadNotFound(id))?;
        if !matches!(item.status, DownloadStatus::Paused | DownloadStatus::Failed) {
            return Err(invalid("resume", item));
        }
        item.status = DownloadStatus::Downloading;
        item.manual = true;
        item.error = None;
        self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
        match st.active.get_mut(&id) {
            // Still stopping after a pause; start again once it has.
            Some(active) => active.restart = true,
            None => self.inner.spawn(&mut st.active, item, &queue.dir),
        }
        self.inner.save(queue);
        Ok(())
    }

    /// Puts paused or failed downloads back in line in their queues, which start
    /// them when they have room. Downloads in other states are left alone.
    pub fn requeue(&self, ids: &[DownloadId]) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        if let Some(id) = ids.iter().find(|id| !st.owner.contains_key(id)) {
            return Err(EngineError::DownloadNotFound(*id));
        }
        let mut touched: Vec<QueueId> = Vec::new();
        for id in ids {
            let queue = owner_queue(&mut st.queues, &st.owner, *id)?;
            let Some(item) = queue.items.get_mut(id) else {
                continue;
            };
            if !matches!(item.status, DownloadStatus::Paused | DownloadStatus::Failed) {
                continue;
            }
            item.status = DownloadStatus::Queued;
            item.manual = false;
            item.error = None;
            // A worker still stopping after a pause stays stopped; the queue starts it again.
            if let Some(active) = st.active.get_mut(id) {
                active.restart = false;
            }
            self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
            if !touched.contains(&queue.id) {
                touched.push(queue.id);
            }
        }
        for id in touched {
            self.inner.save(&st.queues[&id]);
            self.inner.schedule(st, id);
        }
        Ok(())
    }

    /// Removes a download, stopping it if needed. Its partial file is deleted; a
    /// completed file stays on disk.
    pub fn remove(&self, id: DownloadId) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = owner_queue(&mut st.queues, &st.owner, id)?;
        let queue_id = queue.id;
        let item = queue.remove(id).ok_or(EngineError::DownloadNotFound(id))?;
        st.owner.remove(&id);
        discard(&mut st.active, &item, &queue.dir);
        self.inner.save(queue);
        self.inner
            .emit(EngineEvent::DownloadRemoved { id, queue_id });
        self.inner.emit(EngineEvent::QueueChanged(queue.info()));
        self.inner.schedule(st, queue_id);
        Ok(())
    }

    /// Removes a queue's completed downloads from the list (the files stay on
    /// disk). Returns how many were removed.
    pub fn clear_completed(&self, queue_id: QueueId) -> Result<usize> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = st
            .queues
            .get_mut(&queue_id)
            .ok_or(EngineError::QueueNotFound(queue_id))?;
        let done: Vec<DownloadId> = queue
            .downloads()
            .into_iter()
            .filter(|item| item.status == DownloadStatus::Completed)
            .map(|item| item.id)
            .collect();
        for id in &done {
            queue.remove(*id);
            st.owner.remove(id);
            self.inner
                .emit(EngineEvent::DownloadRemoved { id: *id, queue_id });
        }
        if !done.is_empty() {
            self.inner.save(queue);
            self.inner.emit(EngineEvent::QueueChanged(queue.info()));
        }
        Ok(done.len())
    }

    pub fn get(&self, id: DownloadId) -> Option<DownloadItem> {
        let st = self.inner.lock();
        let queue_id = st.owner.get(&id)?;
        st.queues.get(queue_id)?.items.get(&id).cloned()
    }

    /// A queue's downloads, in queue order.
    pub fn downloads(&self, queue_id: QueueId) -> Result<Vec<DownloadItem>> {
        let st = self.inner.lock();
        let queue = st
            .queues
            .get(&queue_id)
            .ok_or(EngineError::QueueNotFound(queue_id))?;
        Ok(queue.downloads())
    }

    /// Every download of every queue, each queue's in queue order.
    pub fn all_downloads(&self) -> Vec<DownloadItem> {
        let st = self.inner.lock();
        let mut queues: Vec<&Queue> = st.queues.values().collect();
        queues.sort_by(|a, b| a.dir.cmp(&b.dir));
        queues.iter().flat_map(|queue| queue.downloads()).collect()
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn emit(&self, event: EngineEvent) {
        // An error only means nobody is subscribed.
        let _ = self.events.send(event);
    }

    fn save(&self, queue: &Queue) {
        if let Err(e) = queue.save(self.store.as_ref()) {
            self.emit(EngineEvent::SaveFailed {
                queue_id: queue.id,
                error: e.to_string(),
            });
        }
    }

    fn ensure_queue(&self, st: &mut State, dir: PathBuf) -> QueueId {
        if let Some(id) = st.by_dir.get(&dir) {
            return *id;
        }
        let queue = Queue::new(dir.clone());
        let id = queue.id;
        self.save(&queue);
        self.emit(EngineEvent::QueueChanged(queue.info()));
        st.by_dir.insert(dir, id);
        st.queues.insert(id, queue);
        id
    }

    fn add(&self, st: &mut State, queue_id: QueueId, url: String) -> DownloadId {
        let queue = st.queues.get_mut(&queue_id).expect("queue exists");
        let item = DownloadItem {
            id: DownloadId::new(),
            queue_id,
            url,
            file_name: None,
            total_bytes: None,
            downloaded: 0,
            status: DownloadStatus::Queued,
            resumable: None,
            etag: None,
            last_modified: None,
            error: None,
            manual: false,
            added_at: now_millis(),
        };
        let id = item.id;
        queue.push(item.clone());
        st.owner.insert(id, queue_id);
        self.save(queue);
        self.emit(EngineEvent::DownloadAdded(item));
        self.emit(EngineEvent::QueueChanged(queue.info()));
        self.schedule(st, queue_id);
        id
    }

    /// Lets the queue start its next downloads if it has free slots. Called
    /// whenever that could change: the queue was resumed or given more slots, a
    /// download was added, or one of its downloads stopped.
    fn schedule(&self, st: &mut State, queue_id: QueueId) {
        let Some(queue) = st.queues.get_mut(&queue_id) else {
            return;
        };
        for id in queue.next_to_start(|id| st.active.contains_key(id)) {
            let Some(item) = queue.items.get_mut(&id) else {
                continue;
            };
            item.status = DownloadStatus::Downloading;
            item.manual = false;
            self.emit(EngineEvent::DownloadChanged(item.clone()));
            self.spawn(&mut st.active, item, &queue.dir);
        }
    }

    fn spawn(&self, active: &mut HashMap<DownloadId, Active>, item: &DownloadItem, dir: &Path) {
        let token = CancellationToken::new();
        active.insert(
            item.id,
            Active {
                token: token.clone(),
                stop: None,
                restart: false,
                moved_from: None,
            },
        );
        self.runtime.spawn(worker::run(
            self.client.clone(),
            Job::new(item, dir),
            token,
            self.worker_tx.clone(),
        ));
    }

    fn handle(&self, msg: WorkerMsg) {
        let mut guard = self.lock();
        let st = &mut *guard;
        match msg {
            WorkerMsg::Meta {
                id,
                file_name,
                total_bytes,
                resumable,
                etag,
                last_modified,
            } => {
                let Ok(queue) = owner_queue(&mut st.queues, &st.owner, id) else {
                    return;
                };
                if let Some(item) = queue.items.get_mut(&id) {
                    item.file_name = Some(file_name);
                    item.total_bytes = total_bytes;
                    item.resumable = Some(resumable);
                    item.etag = etag;
                    item.last_modified = last_modified;
                    self.emit(EngineEvent::DownloadChanged(item.clone()));
                    // The file name must survive a restart for the download to resume.
                    self.save(queue);
                }
            }
            WorkerMsg::Progress {
                id,
                downloaded,
                total,
                speed_bps,
            } => {
                let Ok(queue) = owner_queue(&mut st.queues, &st.owner, id) else {
                    return;
                };
                if let Some(item) = queue.items.get_mut(&id) {
                    item.downloaded = downloaded;
                    if total.is_some() {
                        item.total_bytes = total;
                    }
                    if item.status == DownloadStatus::Downloading {
                        self.emit(EngineEvent::Progress {
                            id,
                            downloaded,
                            total: item.total_bytes,
                            speed_bps,
                        });
                    }
                }
            }
            WorkerMsg::Done {
                id,
                outcome,
                part_path,
            } => {
                let (stop, restart, moved_from) = st.active.remove(&id).map_or(
                    (None, false, None),
                    |active| (active.stop, active.restart, active.moved_from),
                );
                let Ok(queue) = owner_queue(&mut st.queues, &st.owner, id) else {
                    // Removed while running.
                    if let Some(part) = part_path {
                        let _ = std::fs::remove_file(part);
                    }
                    return;
                };
                let queue_id = queue.id;
                if let Some(item) = queue.items.get_mut(&id) {
                    match (outcome, stop) {
                        // Finished just as it was asked to stop; keep the finished file.
                        (Outcome::Completed, _) => {
                            item.status = DownloadStatus::Completed;
                            item.error = None;
                            item.total_bytes.get_or_insert(item.downloaded);
                        }
                        // Status was already set by pause or by pausing the queue.
                        (_, Some(Stop::Pause | Stop::Remove)) => {}
                        (Outcome::Failed(msg), None) => {
                            item.status = DownloadStatus::Failed;
                            item.error = Some(msg);
                        }
                        (Outcome::Stopped, None) => item.status = DownloadStatus::Paused,
                    }
                    if let Some(from) = moved_from {
                        match move_file(item, &from, &queue.dir) {
                            Ok(name) => item.file_name = name,
                            Err(e) => {
                                item.status = DownloadStatus::Failed;
                                item.error = Some(format!("couldn't move the file: {e}"));
                            }
                        }
                    }
                    let item = item.clone();
                    self.emit(EngineEvent::DownloadChanged(item.clone()));
                    self.save(queue);
                    if restart && item.status == DownloadStatus::Downloading {
                        self.spawn(&mut st.active, &item, &queue.dir);
                    }
                }
                self.schedule(st, queue_id);
            }
        }
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        let st = self.state.get_mut().unwrap_or_else(PoisonError::into_inner);
        for active in st.active.values() {
            active.token.cancel();
        }
    }
}

/// Applies worker messages to the shared state. Holds only a weak reference so
/// the engine can be dropped.
async fn drive(inner: Weak<Inner>, mut rx: mpsc::UnboundedReceiver<WorkerMsg>) {
    while let Some(msg) = rx.recv().await {
        let Some(inner) = inner.upgrade() else {
            break;
        };
        inner.handle(msg);
    }
}

fn owner_queue<'a>(
    queues: &'a mut HashMap<QueueId, Queue>,
    owner: &HashMap<DownloadId, QueueId>,
    id: DownloadId,
) -> Result<&'a mut Queue> {
    owner
        .get(&id)
        .and_then(|queue_id| queues.get_mut(queue_id))
        .ok_or(EngineError::DownloadNotFound(id))
}

/// Stops a removed download's worker (which deletes its partial file when it
/// stops), or deletes the partial file right away if nothing is running.
fn discard(active: &mut HashMap<DownloadId, Active>, item: &DownloadItem, dir: &Path) {
    match active.get_mut(&item.id) {
        Some(active) => active.stop(Stop::Remove),
        None if item.status != DownloadStatus::Completed => {
            if let Some(part) = item.part_path(dir) {
                let _ = std::fs::remove_file(part);
            }
        }
        None => {}
    }
}

/// Moves a download's file (finished or partial) from `from` to `to`, picking a
/// free name there. Returns the download's file name in `to`.
fn move_file(item: &DownloadItem, from: &Path, to: &Path) -> io::Result<Option<String>> {
    let Some(name) = &item.file_name else {
        return Ok(None);
    };
    if from == to {
        return Ok(Some(name.clone()));
    }
    let done = item.status == DownloadStatus::Completed;
    let path = |dir: &Path, name: &str| {
        if done {
            dir.join(name)
        } else {
            part_path(dir, name)
        }
    };
    let src = path(from, name);
    let name = free_file_name(to, name)?;
    if src.exists() {
        std::fs::create_dir_all(to)?;
        let dest = path(to, &name);
        // Renaming fails across disks; copy, then delete the original.
        if std::fs::rename(&src, &dest).is_err() {
            std::fs::copy(&src, &dest)?;
            std::fs::remove_file(&src)?;
        }
    }
    Ok(Some(name))
}

/// `candidate`, or `candidate (1)`, `(2)`, ... if a file or partial download
/// already has that name in `dir`.
fn free_file_name(dir: &Path, candidate: &str) -> io::Result<String> {
    let (stem, ext) = split_extension(candidate);
    for n in 0..10_000 {
        let name = if n == 0 {
            candidate.to_string()
        } else {
            format!("{stem} ({n}){ext}")
        };
        if !dir.join(&name).exists() && !part_path(dir, &name).exists() {
            return Ok(name);
        }
    }
    Err(io::Error::other(format!("no free file name for {candidate}")))
}

fn validate_url(url: &str) -> Result<String> {
    let parsed = Url::parse(url).map_err(|e| EngineError::InvalidUrl(format!("{url}: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(EngineError::InvalidUrl(format!(
            "{url}: only http and https are supported"
        )));
    }
    Ok(parsed.into())
}

/// Makes `dir` a canonical queue key: absolute, with `.` and `..` resolved
/// lexically (the folder doesn't have to exist yet).
fn normalize(dir: &Path) -> Result<PathBuf> {
    if !dir.is_absolute() {
        return Err(EngineError::InvalidDir(dir.to_path_buf()));
    }
    let mut out = PathBuf::new();
    for component in dir.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    Ok(out)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn invalid(action: &'static str, item: &DownloadItem) -> EngineError {
    EngineError::InvalidState {
        action,
        status: item.status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dirs() {
        assert_eq!(
            normalize(Path::new("/a/./b/../c/")).unwrap(),
            PathBuf::from("/a/c")
        );
        assert!(normalize(Path::new("relative/dir")).is_err());
    }
}
