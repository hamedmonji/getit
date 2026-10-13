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
use crate::worker::{self, Job, Outcome, WorkerMsg};

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
}

impl Active {
    fn stop(&mut self, stop: Stop) {
        self.stop = Some(stop);
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
                let queue = Queue::restore(snapshot);
                if st.by_dir.contains_key(&queue.dir) || st.queues.contains_key(&queue.id) {
                    continue;
                }
                st.by_dir.insert(queue.dir.clone(), queue.id);
                st.owner
                    .extend(queue.order.iter().map(|id| (*id, queue.id)));
                st.queues.insert(queue.id, queue);
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

    /// Replaces a queue's settings. Pausing stops its running downloads and puts
    /// them back to `Queued`; unpausing or adding slots starts more.
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

    /// Puts a paused or failed download back in its queue. It continues from its
    /// partial file when a slot is free.
    pub fn resume(&self, id: DownloadId) -> Result<()> {
        let mut guard = self.inner.lock();
        let st = &mut *guard;
        let queue = owner_queue(&mut st.queues, &st.owner, id)?;
        let queue_id = queue.id;
        let item = queue
            .items
            .get_mut(&id)
            .ok_or(EngineError::DownloadNotFound(id))?;
        if !matches!(item.status, DownloadStatus::Paused | DownloadStatus::Failed) {
            return Err(invalid("resume", item));
        }
        item.status = DownloadStatus::Queued;
        item.error = None;
        self.inner.emit(EngineEvent::DownloadChanged(item.clone()));
        self.inner.save(queue);
        self.inner.schedule(st, queue_id);
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

    /// Starts the queue's next downloads if it has free slots.
    fn schedule(&self, st: &mut State, queue_id: QueueId) {
        let Some(queue) = st.queues.get_mut(&queue_id) else {
            return;
        };
        for id in queue.next_to_start(|id| st.active.contains_key(id)) {
            let Some(item) = queue.items.get_mut(&id) else {
                continue;
            };
            item.status = DownloadStatus::Downloading;
            self.emit(EngineEvent::DownloadChanged(item.clone()));
            let token = CancellationToken::new();
            st.active.insert(
                id,
                Active {
                    token: token.clone(),
                    stop: None,
                },
            );
            self.runtime.spawn(worker::run(
                self.client.clone(),
                Job::new(item, &queue.dir),
                token,
                self.worker_tx.clone(),
            ));
        }
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
                let stop = st.active.remove(&id).and_then(|active| active.stop);
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
                    self.emit(EngineEvent::DownloadChanged(item.clone()));
                    self.save(queue);
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
