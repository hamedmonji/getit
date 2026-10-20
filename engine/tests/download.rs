//! End-to-end tests against a local HTTP server that streams a generated file
//! slowly enough for pause, queue and restart behaviour to be observable.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use axum::routing::get;
use futures_util::Stream;
use getit_engine::{
    DownloadId, DownloadItem, DownloadStatus, Engine, EngineError, EngineEvent, JsonDirStore, LinkInfo,
    MemoryStore, Pattern, QueueId, QueueSettings, RenameRule,
};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;

const FILE_SIZE: usize = 4 * 1024 * 1024;
/// Large enough to be downloaded in four segments.
const BIG_FILE_SIZE: usize = 16 * 1024 * 1024;
const CHUNK: usize = 32 * 1024;
/// ~6.5 MB/s, so one file takes about 0.6 s.
const CHUNK_DELAY: Duration = Duration::from_millis(5);
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone)]
struct Server {
    data: Arc<Vec<u8>>,
    big: Arc<Vec<u8>>,
    log: Arc<Mutex<Vec<Logged>>>,
}

#[derive(Debug, Clone)]
struct Logged {
    range: Option<String>,
    status: u16,
}

impl Server {
    fn requests(&self) -> Vec<Logged> {
        self.log.lock().unwrap().clone()
    }
}

async fn start_server() -> (String, Server) {
    let server = Server {
        data: Arc::new(test_data(FILE_SIZE)),
        big: Arc::new(test_data(BIG_FILE_SIZE)),
        log: Arc::default(),
    };
    let app = Router::new()
        .route("/file.bin", get(ranged))
        .route("/big.bin", get(big))
        .route("/norange.bin", get(no_range))
        .route("/attachment", get(attachment))
        .with_state(server.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), server)
}

async fn ranged(State(server): State<Server>, headers: HeaderMap) -> Response {
    serve(&server, &server.data, &headers, true, None)
}

async fn big(State(server): State<Server>, headers: HeaderMap) -> Response {
    serve(&server, &server.big, &headers, true, None)
}

async fn no_range(State(server): State<Server>, headers: HeaderMap) -> Response {
    serve(&server, &server.data, &headers, false, None)
}

async fn attachment(State(server): State<Server>, headers: HeaderMap) -> Response {
    serve(
        &server,
        &server.data,
        &headers,
        true,
        Some(r#"attachment; filename="report final.pdf""#),
    )
}

fn serve(
    server: &Server,
    data: &Arc<Vec<u8>>,
    headers: &HeaderMap,
    ranges: bool,
    disposition: Option<&str>,
) -> Response {
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let len = data.len();
    // `bytes=<start>-` or `bytes=<start>-<last>`.
    let requested = range
        .as_deref()
        .filter(|_| ranges)
        .and_then(|r| r.strip_prefix("bytes="))
        .and_then(|r| r.split_once('-'))
        .and_then(|(start, last)| {
            let start = start.parse::<usize>().ok()?;
            let end = match last {
                "" => len,
                last => (last.parse::<usize>().ok()? + 1).min(len),
            };
            Some((start, end))
        });

    let mut builder = Response::builder().header(header::ETAG, "\"v1\"");
    if ranges {
        builder = builder.header(header::ACCEPT_RANGES, "bytes");
    }
    if let Some(disposition) = disposition {
        builder = builder.header(header::CONTENT_DISPOSITION, disposition);
    }
    let (status, from, to) = match requested {
        Some((start, end)) if start < end => {
            builder = builder.header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{}/{len}", end - 1),
            );
            (StatusCode::PARTIAL_CONTENT, start, end)
        }
        Some(_) => {
            server
                .log
                .lock()
                .unwrap()
                .push(Logged { range, status: 416 });
            return builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Body::empty())
                .unwrap();
        }
        None => (StatusCode::OK, 0, len),
    };
    server.log.lock().unwrap().push(Logged {
        range,
        status: status.as_u16(),
    });
    builder
        .status(status)
        .header(header::CONTENT_LENGTH, to - from)
        .body(Body::from_stream(throttled(data.clone(), from, to)))
        .unwrap()
}

fn throttled(
    data: Arc<Vec<u8>>,
    from: usize,
    to: usize,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> {
    futures_util::stream::unfold(from, move |pos| {
        let data = data.clone();
        async move {
            if pos >= to {
                return None;
            }
            tokio::time::sleep(CHUNK_DELAY).await;
            let end = (pos + CHUNK).min(to);
            Some((Ok(Bytes::copy_from_slice(&data[pos..end])), end))
        }
    })
}

/// Deterministic pseudo-random bytes (xorshift64).
fn test_data(len: usize) -> Vec<u8> {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x as u8
        })
        .collect()
}

fn sha256(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

struct Ctx {
    base: String,
    server: Server,
    dir: tempfile::TempDir,
    engine: Engine,
}

impl Ctx {
    async fn new() -> Self {
        let (base, server) = start_server().await;
        Self {
            base,
            server,
            dir: tempfile::tempdir().unwrap(),
            engine: Engine::new(MemoryStore::new()).unwrap(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn folder(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    /// Creates a paused queue with the given concurrency, so tests can add
    /// downloads before anything starts.
    fn paused_queue(&self, name: &str, max_concurrent: usize) -> QueueId {
        let id = self.engine.ensure_queue(self.folder(name)).unwrap();
        self.engine
            .set_queue_settings(
                id,
                QueueSettings {
                    max_concurrent: Some(max_concurrent),
                    paused: true,
                    ..Default::default()
                },
            )
            .unwrap();
        id
    }

    fn unpause(&self, id: QueueId) {
        let mut settings = self.engine.queue(id).unwrap().settings;
        settings.paused = false;
        self.engine.set_queue_settings(id, settings).unwrap();
    }

    fn assert_file_matches(&self, id: DownloadId) {
        assert_file_matches(&self.engine, id, &self.server);
    }
}

fn assert_file_matches(engine: &Engine, id: DownloadId, server: &Server) {
    assert_file_is(engine, id, &server.data);
}

fn assert_file_is(engine: &Engine, id: DownloadId, data: &[u8]) {
    let item = engine.get(id).expect("download exists");
    let dir = engine.queue(item.queue_id).unwrap().dir;
    let path = item.file_path(&dir).expect("file name known");
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes.len(), data.len(), "{}", path.display());
    assert_eq!(sha256(&bytes), sha256(data), "{}", path.display());
    assert!(
        !item.part_path(&dir).unwrap().exists(),
        ".part file left behind"
    );
}

async fn wait_until(
    engine: &Engine,
    id: DownloadId,
    what: &str,
    pred: impl Fn(&DownloadItem) -> bool,
) -> DownloadItem {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let item = engine.get(id).expect("download exists");
        if pred(&item) {
            return item;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {what}: {item:?}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn wait_for_status(engine: &Engine, id: DownloadId, status: DownloadStatus) -> DownloadItem {
    wait_until(engine, id, &format!("{status:?}"), |item| {
        item.status == status
    })
    .await
}

async fn wait_for_progress(engine: &Engine, id: DownloadId) -> DownloadItem {
    wait_until(engine, id, "1 MiB downloaded", |item| {
        item.downloaded >= 1024 * 1024
    })
    .await
}

async fn wait_until_gone(path: &Path) {
    let deadline = Instant::now() + TIMEOUT;
    while path.exists() {
        assert!(
            Instant::now() < deadline,
            "{} was not deleted",
            path.display()
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Lets a stopped worker finish flushing its partial file.
async fn settle() {
    tokio::time::sleep(Duration::from_millis(300)).await;
}

#[derive(Default)]
struct QueueWatch {
    completed: Vec<DownloadId>,
    /// Most downloads running at once, overall and per queue.
    max_running: usize,
    max_running_per_queue: usize,
    /// How many other downloads were running when each one started.
    running_at_start: HashMap<DownloadId, usize>,
}

/// Follows download events until `count` downloads have completed.
async fn watch(events: &mut broadcast::Receiver<EngineEvent>, count: usize) -> QueueWatch {
    let mut running: HashSet<(QueueId, DownloadId)> = HashSet::new();
    let mut watch = QueueWatch::default();
    while watch.completed.len() < count {
        let event = tokio::time::timeout(TIMEOUT, events.recv())
            .await
            .expect("timed out waiting for queue events")
            .expect("event stream closed or lagged");
        let EngineEvent::DownloadChanged(item) = event else {
            continue;
        };
        match item.status {
            DownloadStatus::Downloading => {
                watch.running_at_start.entry(item.id).or_insert(running.len());
                running.insert((item.queue_id, item.id));
            }
            DownloadStatus::Completed => {
                running.remove(&(item.queue_id, item.id));
                watch.completed.push(item.id);
            }
            DownloadStatus::Failed => panic!("download failed: {item:?}"),
            _ => {}
        }
        watch.max_running = watch.max_running.max(running.len());
        let per_queue = running
            .iter()
            .map(|(queue, _)| running.iter().filter(|(q, _)| q == queue).count())
            .max()
            .unwrap_or(0);
        watch.max_running_per_queue = watch.max_running_per_queue.max(per_queue);
    }
    watch
}

#[tokio::test(flavor = "multi_thread")]
async fn enqueue_downloads_into_the_folder_queue() {
    let ctx = Ctx::new().await;
    let mut events = ctx.engine.subscribe();

    let id = ctx
        .engine
        .enqueue(ctx.folder("Downloads"), &ctx.url("/file.bin"))
        .unwrap();
    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;

    let queues = ctx.engine.queues();
    assert_eq!(queues.len(), 1);
    assert_eq!(queues[0].dir, ctx.folder("Downloads"));
    assert_eq!(queues[0].downloads, vec![id]);
    assert_eq!(item.queue_id, queues[0].id);
    assert_eq!(item.file_name.as_deref(), Some("file.bin"));
    assert_eq!(item.total_bytes, Some(FILE_SIZE as u64));
    assert_eq!(item.downloaded, FILE_SIZE as u64);
    assert_eq!(item.resumable, Some(true));
    ctx.assert_file_matches(id);

    // A second download into the same folder reuses the queue.
    let second = ctx
        .engine
        .enqueue(ctx.folder("Downloads/./"), &ctx.url("/file.bin"))
        .unwrap();
    assert_eq!(ctx.engine.queues().len(), 1);
    assert_eq!(ctx.engine.get(second).unwrap().queue_id, queues[0].id);

    let mut saw_completed = false;
    let mut saw_progress = false;
    loop {
        match events.try_recv() {
            Ok(EngineEvent::DownloadChanged(i))
                if i.id == id && i.status == DownloadStatus::Completed =>
            {
                saw_completed = true
            }
            Ok(EngineEvent::Progress { id: pid, .. }) if pid == id => saw_progress = true,
            Ok(_) | Err(broadcast::error::TryRecvError::Lagged(_)) => {}
            Err(_) => break,
        }
    }
    assert!(saw_completed, "no Completed event");
    assert!(saw_progress, "no Progress event");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_same_link_twice_in_a_queue_gets_its_own_name() {
    let ctx = Ctx::new().await;
    let url = ctx.url("/file.bin");
    let first = ctx.engine.enqueue(ctx.folder("a"), &url).unwrap();
    wait_for_status(&ctx.engine, first, DownloadStatus::Completed).await;
    // Even with the first file gone from disk, its name stays its own.
    std::fs::remove_file(ctx.folder("a/file.bin")).unwrap();

    let second = ctx.engine.enqueue(ctx.folder("a"), &url).unwrap();
    let item = wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    assert_eq!(item.file_name.as_deref(), Some("file (1).bin"));
    ctx.assert_file_matches(second);
}

#[tokio::test(flavor = "multi_thread")]
async fn enqueue_starts_right_away_in_a_paused_queue() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let waiting = ctx.engine.add(queue, &url).unwrap();

    let added = ctx.engine.enqueue(ctx.folder("a"), &url).unwrap();
    assert_eq!(ctx.engine.get(added).unwrap().status, DownloadStatus::Downloading);
    wait_for_status(&ctx.engine, added, DownloadStatus::Completed).await;
    ctx.assert_file_matches(added);
    // The queue stays paused and what was waiting keeps waiting.
    assert!(ctx.engine.queue(queue).unwrap().settings.paused);
    assert_eq!(ctx.engine.get(waiting).unwrap().status, DownloadStatus::Queued);
}

#[tokio::test(flavor = "multi_thread")]
async fn enqueue_respects_the_limit_of_a_running_queue() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let first = ctx.engine.add(queue, &url).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, first).await;

    let added = ctx.engine.enqueue(ctx.folder("a"), &url).unwrap();
    assert_eq!(ctx.engine.get(added).unwrap().status, DownloadStatus::Queued);
    wait_for_status(&ctx.engine, added, DownloadStatus::Completed).await;
    assert_eq!(ctx.engine.get(first).unwrap().status, DownloadStatus::Completed);
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_and_resume_continues_with_a_range_request() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    ctx.engine.pause(id).unwrap();
    assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Paused);

    settle().await;
    let item = ctx.engine.get(id).unwrap();
    let partial = std::fs::metadata(item.part_path(&ctx.folder("a")).unwrap())
        .unwrap()
        .len();
    assert!(
        partial > 0 && partial < FILE_SIZE as u64,
        "partial size {partial}"
    );
    assert_eq!(item.downloaded, partial);

    ctx.engine.resume(id).unwrap();
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);

    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[1].status, 206);
    assert_eq!(
        requests[1].range.as_deref(),
        Some(format!("bytes={partial}-").as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn large_files_download_in_four_segments() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/big.bin"))
        .unwrap();
    let item = wait_until(&ctx.engine, id, "every segment under way", |item| {
        item.segments.len() == 4 && item.segments.iter().all(|s| s.downloaded > 0)
    })
    .await;
    let part = item.part_path(&ctx.folder("a")).unwrap();
    assert_eq!(
        std::fs::metadata(&part).unwrap().len(),
        BIG_FILE_SIZE as u64,
        "the partial file is preallocated"
    );
    assert_eq!(
        item.downloaded,
        item.segments.iter().map(|s| s.downloaded).sum::<u64>()
    );

    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_file_is(&ctx.engine, id, &ctx.server.big);
    assert_eq!(item.downloaded, BIG_FILE_SIZE as u64);
    assert!(item.segments.is_empty(), "{:?}", item.segments);

    // The first request learns the size and becomes the first segment.
    let quarter = BIG_FILE_SIZE / 4;
    let mut ranges: Vec<Option<String>> =
        ctx.server.requests().into_iter().map(|r| r.range).collect();
    assert_eq!(ranges.remove(0), None);
    ranges.sort();
    let mut expected: Vec<Option<String>> = (1..4)
        .map(|i| Some(format!("bytes={}-{}", i * quarter, (i + 1) * quarter - 1)))
        .collect();
    expected.sort();
    assert_eq!(ranges, expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn segmented_downloads_resume_each_segment_after_a_restart() {
    let (base, server) = start_server().await;
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::new());
    let folder = dir.path().join("a");

    let engine = Engine::new(store.clone()).unwrap();
    let id = engine.enqueue(&folder, &format!("{base}/big.bin")).unwrap();
    wait_until(&engine, id, "every segment under way", |item| {
        item.segments.len() == 4 && item.segments.iter().all(|s| s.downloaded > 0)
    })
    .await;
    engine.pause(id).unwrap();
    settle().await;
    let paused = engine.get(id).unwrap();
    assert!(paused.segments.iter().all(|s| !s.is_done()), "{:?}", paused.segments);
    drop(engine);

    let engine = Engine::new(store).unwrap();
    let item = engine.get(id).unwrap();
    assert_eq!(item.status, DownloadStatus::Paused);
    assert_eq!(item.segments, paused.segments);
    assert_eq!(
        item.downloaded,
        paused.segments.iter().map(|s| s.downloaded).sum::<u64>()
    );

    engine.resume(id).unwrap();
    wait_for_status(&engine, id, DownloadStatus::Completed).await;
    assert_file_is(&engine, id, &server.big);

    let requests = server.requests();
    assert_eq!(requests.len(), 8, "{requests:?}");
    let mut resumed: Vec<Option<String>> = requests[4..].iter().map(|r| r.range.clone()).collect();
    resumed.sort();
    let mut expected: Vec<Option<String>> = paused
        .segments
        .iter()
        .map(|s| Some(format!("bytes={}-{}", s.start + s.downloaded, s.end - 1)))
        .collect();
    expected.sort();
    assert_eq!(resumed, expected);
    assert!(requests[4..].iter().all(|r| r.status == 206), "{requests:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn resume_without_range_support_restarts_from_zero() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/norange.bin"))
        .unwrap();
    let item = wait_for_progress(&ctx.engine, id).await;
    assert_eq!(item.resumable, Some(false));
    ctx.engine.pause(id).unwrap();
    settle().await;

    ctx.engine.resume(id).unwrap();
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);

    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[1].status, 200);
    assert_eq!(requests[1].range, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn queue_runs_in_order_one_at_a_time() {
    let ctx = Ctx::new().await;
    let mut events = ctx.engine.subscribe();
    let queue = ctx.paused_queue("a", 1);

    let url = ctx.url("/file.bin");
    let ids: Vec<_> = (0..3)
        .map(|_| ctx.engine.add(queue, &url).unwrap())
        .collect();
    assert_eq!(ctx.engine.queue(queue).unwrap().downloads, ids);

    // Nothing starts while the queue is paused.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        ctx.engine
            .downloads(queue)
            .unwrap()
            .iter()
            .all(|i| i.status == DownloadStatus::Queued)
    );
    assert!(ctx.server.requests().is_empty());

    ctx.unpause(queue);
    let watch = watch(&mut events, 3).await;
    assert_eq!(watch.completed, ids);
    assert_eq!(watch.max_running, 1);

    // Same URL three times into one folder: each gets its own name.
    let names: HashSet<_> = ids
        .iter()
        .map(|id| ctx.engine.get(*id).unwrap().file_name.unwrap())
        .collect();
    let expected: HashSet<_> = ["file.bin", "file (1).bin", "file (2).bin"]
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(names, expected);
    for id in ids {
        ctx.assert_file_matches(id);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn queue_respects_max_concurrent() {
    let ctx = Ctx::new().await;
    let mut events = ctx.engine.subscribe();
    let queue = ctx.paused_queue("a", 2);

    let url = ctx.url("/file.bin");
    let ids: Vec<_> = (0..3)
        .map(|_| ctx.engine.add(queue, &url).unwrap())
        .collect();
    ctx.unpause(queue);
    let watch = watch(&mut events, 3).await;
    assert_eq!(watch.completed.len(), 3);
    assert_eq!(watch.max_running, 2);
    for id in ids {
        ctx.assert_file_matches(id);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn queues_run_independently() {
    let ctx = Ctx::new().await;
    let mut events = ctx.engine.subscribe();
    let movies = ctx.paused_queue("Movies", 1);
    let music = ctx.paused_queue("Music", 1);

    let url = ctx.url("/file.bin");
    let mut ids = Vec::new();
    for queue in [movies, music] {
        for _ in 0..2 {
            ids.push(ctx.engine.add(queue, &url).unwrap());
        }
    }
    ctx.unpause(movies);
    ctx.unpause(music);
    let watch = watch(&mut events, 4).await;
    assert_eq!(watch.max_running, 2, "one per queue at the same time");
    assert_eq!(watch.max_running_per_queue, 1);
    for id in ids {
        ctx.assert_file_matches(id);
    }
    assert!(ctx.folder("Movies/file.bin").exists());
    assert!(ctx.folder("Music/file.bin").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn pausing_a_queue_requeues_and_later_resumes() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let first = ctx.engine.add(queue, &url).unwrap();
    let second = ctx.engine.add(queue, &url).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, first).await;

    let mut settings = ctx.engine.queue(queue).unwrap().settings;
    settings.paused = true;
    ctx.engine.set_queue_settings(queue, settings).unwrap();
    assert_eq!(
        ctx.engine.get(first).unwrap().status,
        DownloadStatus::Queued
    );
    settle().await;
    assert_eq!(
        ctx.engine.get(second).unwrap().status,
        DownloadStatus::Queued
    );
    assert_eq!(ctx.server.requests().len(), 1);

    // Put the second download first; the queue picks it up before the partial one.
    ctx.engine.reorder_queue(queue, &[second]).unwrap();
    assert_eq!(
        ctx.engine.queue(queue).unwrap().downloads,
        vec![second, first]
    );
    ctx.unpause(queue);
    wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    wait_for_status(&ctx.engine, first, DownloadStatus::Completed).await;
    ctx.assert_file_matches(first);
    ctx.assert_file_matches(second);

    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 3, "{requests:?}");
    assert_eq!(requests[1].range, None, "second download starts fresh");
    assert_eq!(requests[2].status, 206, "first download resumes");
}

#[tokio::test(flavor = "multi_thread")]
async fn remove_stops_and_deletes_the_partial_file() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    let part = wait_for_progress(&ctx.engine, id)
        .await
        .part_path(&ctx.folder("a"))
        .unwrap();
    let queue = ctx.engine.get(id).unwrap().queue_id;

    ctx.engine.remove(id).unwrap();
    assert!(ctx.engine.get(id).is_none());
    assert!(ctx.engine.queue(queue).unwrap().downloads.is_empty());
    wait_until_gone(&part).await;
    assert!(ctx.engine.remove(id).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn clear_completed_keeps_files_and_unfinished_downloads() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let done = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let waiting = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.pause(waiting).unwrap();
    ctx.unpause(queue);
    let item = wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;

    assert_eq!(ctx.engine.clear_completed(queue).unwrap(), 1);
    assert!(ctx.engine.get(done).is_none());
    assert_eq!(ctx.engine.queue(queue).unwrap().downloads, vec![waiting]);
    assert!(item.file_path(&ctx.folder("a")).unwrap().exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn enqueue_with_shows_the_probed_name_and_size_until_it_starts() {
    let ctx = Ctx::new().await;
    let dir = ctx.folder("Downloads");
    std::fs::create_dir_all(&dir).unwrap();
    // The suggested name is taken, so the download must still pick a free one.
    std::fs::write(dir.join("file.bin"), b"already here").unwrap();
    let mut events = ctx.engine.subscribe();

    let info = LinkInfo { file_name: "file.bin".into(), total_bytes: Some(FILE_SIZE as u64), original_name: None };
    let id = ctx.engine.enqueue_with(&dir, &ctx.url("/file.bin"), Some(info)).unwrap();
    let added = loop {
        match events.recv().await.unwrap() {
            EngineEvent::DownloadAdded(item) if item.id == id => break item,
            _ => {}
        }
    };
    assert_eq!(added.suggested_name.as_deref(), Some("file.bin"));
    assert_eq!(added.total_bytes, Some(FILE_SIZE as u64));
    assert_eq!(added.file_name, None);

    let done = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_ne!(done.file_name.as_deref(), Some("file.bin"));
    assert_eq!(std::fs::read(dir.join("file.bin")).unwrap(), b"already here");
    ctx.assert_file_matches(id);
}

#[tokio::test(flavor = "multi_thread")]
async fn probe_asks_the_server() {
    let ctx = Ctx::new().await;
    let size = Some(FILE_SIZE as u64);
    let info = |file_name: &str| LinkInfo { file_name: file_name.into(), total_bytes: size, original_name: None };
    assert_eq!(ctx.engine.probe(&ctx.url("/attachment")).await.unwrap(), info("report final.pdf"));
    assert_eq!(ctx.engine.probe(&ctx.url("/file.bin?sig=1")).await.unwrap(), info("file.bin"));
    // A server that ignores the range sends the whole file's length instead.
    assert_eq!(ctx.engine.probe(&ctx.url("/norange.bin")).await.unwrap(), info("norange.bin"));
    assert!(ctx.engine.probe(&ctx.url("/missing")).await.is_err());
    // Nothing was added.
    assert!(ctx.engine.queues().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_file_fails() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/missing"))
        .unwrap();
    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Failed).await;
    let error = item.error.unwrap();
    assert!(error.contains("404"), "{error}");
    assert_eq!(item.file_name, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn uses_content_disposition_file_name() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/attachment"))
        .unwrap();
    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_eq!(item.file_name.as_deref(), Some("report final.pdf"));
    ctx.assert_file_matches(id);
}

/// Sets the auto rename of the queue for `dir`, creating it if needed.
fn set_rename(engine: &Engine, dir: &Path, rename: Vec<RenameRule>) -> QueueId {
    let queue = engine.ensure_queue(dir).unwrap();
    let mut settings = engine.queue(queue).unwrap().settings;
    settings.rename = rename;
    engine.set_queue_settings(queue, settings).unwrap();
    queue
}

fn prefix_and_spaces() -> Vec<RenameRule> {
    vec![
        RenameRule::Prefix { text: "new ".into() },
        RenameRule::Replace {
            pattern: Pattern { text: r"\s+".into(), regex: true },
            with: "_".into(),
        },
    ]
}

#[tokio::test(flavor = "multi_thread")]
async fn auto_rename_names_new_downloads_and_keeps_the_servers_name() {
    let ctx = Ctx::new().await;
    let dir = ctx.folder("a");
    set_rename(&ctx.engine, &dir, prefix_and_spaces());
    let id = ctx.engine.enqueue(&dir, &ctx.url("/attachment")).unwrap();
    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_eq!(item.file_name.as_deref(), Some("new_report_final.pdf"));
    assert_eq!(item.original_name.as_deref(), Some("report final.pdf"));
    ctx.assert_file_matches(id);
}

#[tokio::test(flavor = "multi_thread")]
async fn auto_names_follow_the_folders_queue() {
    let ctx = Ctx::new().await;
    let dir = ctx.folder("a");
    let names = vec!["report final.pdf".to_string()];
    assert_eq!(ctx.engine.auto_names(&dir, &names).unwrap(), names);
    set_rename(&ctx.engine, &dir, prefix_and_spaces());
    assert_eq!(ctx.engine.auto_names(&dir, &names).unwrap(), vec!["new_report_final.pdf"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn enqueue_with_renames_a_server_name_but_not_a_chosen_one() {
    let ctx = Ctx::new().await;
    let dir = ctx.folder("a");
    let queue = set_rename(&ctx.engine, &dir, prefix_and_spaces());
    let mut settings = ctx.engine.queue(queue).unwrap().settings;
    settings.paused = true;
    ctx.engine.set_queue_settings(queue, settings).unwrap();

    let server = LinkInfo { file_name: "a b.bin".into(), total_bytes: None, original_name: None };
    let id = ctx.engine.enqueue_with(&dir, &ctx.url("/file.bin"), Some(server)).unwrap();
    let item = ctx.engine.get(id).unwrap();
    assert_eq!(item.suggested_name.as_deref(), Some("new_a_b.bin"));
    assert_eq!(item.original_name.as_deref(), Some("a b.bin"));

    let chosen = LinkInfo {
        file_name: "mine.bin".into(),
        total_bytes: None,
        original_name: Some("a b.bin".into()),
    };
    let id = ctx.engine.enqueue_with(&dir, &ctx.url("/file.bin"), Some(chosen)).unwrap();
    let item = ctx.engine.get(id).unwrap();
    assert_eq!(item.suggested_name.as_deref(), Some("mine.bin"));
    assert_eq!(item.original_name.as_deref(), Some("a b.bin"));
}

#[tokio::test(flavor = "multi_thread")]
async fn without_retries_network_errors_fail_at_once() {
    let ctx = Ctx::new().await;
    let queue = ctx.engine.ensure_queue(ctx.folder("a")).unwrap();
    let mut settings = ctx.engine.queue(queue).unwrap().settings;
    settings.retries = 0;
    ctx.engine.set_queue_settings(queue, settings).unwrap();
    let started = Instant::now();
    // Nothing listens on port 1.
    let id = ctx.engine.add(queue, "http://127.0.0.1:1/file.bin").unwrap();
    wait_for_status(&ctx.engine, id, DownloadStatus::Failed).await;
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_invalid_input() {
    let ctx = Ctx::new().await;
    assert!(ctx.engine.enqueue(ctx.folder("a"), "not a url").is_err());
    assert!(
        ctx.engine
            .enqueue(ctx.folder("a"), "ftp://example.com/file")
            .is_err()
    );
    assert!(
        ctx.engine
            .enqueue("relative/dir", &ctx.url("/file.bin"))
            .is_err()
    );
    assert!(ctx.engine.queues().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn queues_are_saved_and_restored() {
    let (base, server) = start_server().await;
    let dir = tempfile::tempdir().unwrap();
    let store_dir = dir.path().join("store");
    let folder = dir.path().join("Downloads");
    let url = format!("{base}/file.bin");

    let engine = Engine::new(JsonDirStore::new(&store_dir).unwrap()).unwrap();
    let queue = engine.ensure_queue(&folder).unwrap();
    engine
        .set_queue_settings(
            queue,
            QueueSettings {
                max_concurrent: Some(1),
                paused: false,
                ..Default::default()
            },
        )
        .unwrap();
    let first = engine.add(queue, &url).unwrap();
    wait_for_progress(&engine, first).await;
    engine
        .set_queue_settings(
            queue,
            QueueSettings {
                max_concurrent: Some(1),
                paused: true,
                ..Default::default()
            },
        )
        .unwrap();
    let second = engine.add(queue, &url).unwrap();
    settle().await;
    let partial = std::fs::metadata(folder.join("file.bin.part"))
        .unwrap()
        .len();
    drop(engine);

    let engine = Engine::new(JsonDirStore::new(&store_dir).unwrap()).unwrap();
    let queues = engine.queues();
    assert_eq!(queues.len(), 1);
    assert_eq!(queues[0].id, queue);
    assert_eq!(queues[0].dir, folder);
    assert_eq!(
        queues[0].settings,
        QueueSettings {
            max_concurrent: Some(1),
            paused: true,
            ..Default::default()
        }
    );
    assert_eq!(queues[0].downloads, vec![first, second]);
    let restored = engine.get(first).unwrap();
    assert_eq!(restored.status, DownloadStatus::Queued);
    assert_eq!(restored.file_name.as_deref(), Some("file.bin"));
    assert_eq!(restored.downloaded, partial);

    engine
        .set_queue_settings(
            queue,
            QueueSettings {
                max_concurrent: Some(1),
                paused: false,
                ..Default::default()
            },
        )
        .unwrap();
    wait_for_status(&engine, second, DownloadStatus::Completed).await;
    assert_file_matches(&engine, first, &server);
    assert_file_matches(&engine, second, &server);

    let requests = server.requests();
    assert_eq!(requests[1].status, 206, "{requests:?}");
    assert_eq!(
        requests[1].range.as_deref(),
        Some(format!("bytes={partial}-").as_str())
    );

    // Removing the queue removes its saved file.
    engine.remove_queue(queue).unwrap();
    assert!(engine.queues().is_empty());
    drop(engine);
    let engine = Engine::new(JsonDirStore::new(&store_dir).unwrap()).unwrap();
    assert!(engine.queues().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn interrupted_downloads_stay_paused_after_restart() {
    let (base, server) = start_server().await;
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::new());
    let folder = dir.path().join("a");

    let engine = Engine::new(store.clone()).unwrap();
    let id = engine
        .enqueue(&folder, &format!("{base}/file.bin"))
        .unwrap();
    wait_for_progress(&engine, id).await;
    // Simulates quitting mid-download.
    drop(engine);
    settle().await;

    let engine = Engine::new(store).unwrap();
    let item = engine.get(id).unwrap();
    assert_eq!(item.status, DownloadStatus::Paused);
    assert!(item.downloaded > 0, "progress comes from the partial file");
    settle().await;
    assert_eq!(server.requests().len(), 1, "nothing restarts on its own");

    engine.resume(id).unwrap();
    wait_for_status(&engine, id, DownloadStatus::Completed).await;
    assert_file_matches(&engine, id, &server);
    let requests = server.requests();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[1].status, 206);
}

#[tokio::test(flavor = "multi_thread")]
async fn resume_starts_only_that_download() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let first = ctx.engine.add(queue, &url).unwrap();
    let second = ctx.engine.add(queue, &url).unwrap();
    ctx.engine.pause(second).unwrap();

    ctx.engine.resume(second).unwrap();
    let item = ctx.engine.get(second).unwrap();
    assert_eq!(item.status, DownloadStatus::Downloading);
    wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    ctx.assert_file_matches(second);
    // The queue stays paused and nothing else started.
    assert!(ctx.engine.queue(queue).unwrap().settings.paused);
    assert_eq!(
        ctx.engine.get(first).unwrap().status,
        DownloadStatus::Queued
    );
    assert_eq!(ctx.server.requests().len(), 1);
    assert!(ctx.engine.resume(second).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn resume_starts_a_download_waiting_in_a_paused_queue() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let first = ctx.engine.add(queue, &url).unwrap();
    let second = ctx.engine.add(queue, &url).unwrap();

    ctx.engine.resume(second).unwrap();
    wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    ctx.assert_file_matches(second);
    assert!(ctx.engine.queue(queue).unwrap().settings.paused);
    assert_eq!(
        ctx.engine.get(first).unwrap().status,
        DownloadStatus::Queued
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn notes_when_a_download_last_started() {
    let ctx = Ctx::new().await;
    let url = ctx.url("/file.bin");
    // Started by its queue.
    let queued = ctx.engine.enqueue(ctx.folder("a"), &url).unwrap();
    assert!(ctx.engine.get(queued).unwrap().started_at.is_some());

    // Waiting in a paused queue: not started until resumed.
    let queue = ctx.paused_queue("b", 1);
    let id = ctx.engine.add(queue, &url).unwrap();
    assert_eq!(ctx.engine.get(id).unwrap().started_at, None);
    ctx.engine.resume(id).unwrap();
    let first = ctx.engine.get(id).unwrap().started_at.expect("started");

    // Resuming again counts as starting again.
    ctx.engine.pause(id).unwrap();
    tokio::time::sleep(Duration::from_millis(5)).await;
    ctx.engine.resume(id).unwrap();
    let again = ctx.engine.get(id).unwrap().started_at.expect("started again");
    assert!(again > first, "{again} should be after {first}");

    // Added to a paused queue by the user, it starts right away.
    let added = ctx.engine.enqueue(ctx.folder("b"), &url).unwrap();
    assert!(ctx.engine.get(added).unwrap().started_at.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn resume_right_after_pause_continues_the_download() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    // The worker may still be stopping when the download is resumed.
    ctx.engine.pause(id).unwrap();
    ctx.engine.resume(id).unwrap();
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);
    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[1].status, 206);
}

#[tokio::test(flavor = "multi_thread")]
async fn resumed_downloads_take_up_queue_slots() {
    let ctx = Ctx::new().await;
    let mut events = ctx.engine.subscribe();
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let ids: Vec<_> = (0..3)
        .map(|_| ctx.engine.add(queue, &url).unwrap())
        .collect();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, ids[0]).await;

    // Resuming goes past the limit, but the queue starts nothing more until
    // both are done.
    ctx.engine.resume(ids[1]).unwrap();
    let watch = watch(&mut events, 3).await;
    assert_eq!(watch.max_running, 2);
    assert_eq!(watch.completed.last(), Some(&ids[2]));
    assert_eq!(watch.running_at_start[&ids[2]], 0);
    for id in &ids {
        ctx.assert_file_matches(*id);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn pausing_a_queue_stops_resumed_downloads_too() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let url = ctx.url("/file.bin");
    let first = ctx.engine.add(queue, &url).unwrap();
    let resumed = ctx.engine.add(queue, &url).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, first).await;
    // Past the limit, started by hand.
    ctx.engine.resume(resumed).unwrap();
    wait_for_progress(&ctx.engine, resumed).await;

    let mut settings = ctx.engine.queue(queue).unwrap().settings;
    settings.paused = true;
    ctx.engine.set_queue_settings(queue, settings).unwrap();
    for id in [first, resumed] {
        assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Queued);
    }

    // Unpausing picks them up again in queue order.
    ctx.unpause(queue);
    wait_for_status(&ctx.engine, resumed, DownloadStatus::Completed).await;
    ctx.assert_file_matches(first);
    ctx.assert_file_matches(resumed);
}

#[tokio::test(flavor = "multi_thread")]
async fn changing_a_paused_queues_limit_keeps_resumed_downloads_going() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let id = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.resume(id).unwrap();
    wait_for_progress(&ctx.engine, id).await;

    let mut settings = ctx.engine.queue(queue).unwrap().settings;
    settings.max_concurrent = Some(3);
    ctx.engine.set_queue_settings(queue, settings).unwrap();
    assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Downloading);
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn resumed_downloads_stay_paused_after_restart() {
    let (base, server) = start_server().await;
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::new());
    let folder = dir.path().join("a");

    let engine = Engine::new(store.clone()).unwrap();
    let queue = engine.ensure_queue(&folder).unwrap();
    engine
        .set_queue_settings(
            queue,
            QueueSettings {
                max_concurrent: Some(1),
                paused: true,
                ..Default::default()
            },
        )
        .unwrap();
    let id = engine.add(queue, &format!("{base}/file.bin")).unwrap();
    engine.pause(id).unwrap();
    engine.resume(id).unwrap();
    wait_for_progress(&engine, id).await;
    drop(engine);
    settle().await;

    let engine = Engine::new(store).unwrap();
    let item = engine.get(id).unwrap();
    assert_eq!(item.status, DownloadStatus::Paused);
    settle().await;
    assert_eq!(server.requests().len(), 1, "nothing restarts on its own");

    engine.resume(id).unwrap();
    wait_for_status(&engine, id, DownloadStatus::Completed).await;
    assert_file_matches(&engine, id, &server);
    assert_eq!(server.requests()[1].status, 206);
}

#[tokio::test(flavor = "multi_thread")]
async fn relocate_moves_queues_with_their_folder() {
    let ctx = Ctx::new().await;
    let outer = ctx.paused_queue("Old", 1);
    let inner = ctx.paused_queue("Old/Inner", 1);
    let other = ctx.paused_queue("Other", 1);
    let id = ctx.engine.add(inner, &ctx.url("/file.bin")).unwrap();

    std::fs::create_dir_all(ctx.folder("Old/Inner")).unwrap();
    std::fs::rename(ctx.folder("Old"), ctx.folder("New")).unwrap();
    assert_eq!(
        ctx.engine
            .relocate(ctx.folder("Old"), ctx.folder("New"))
            .unwrap(),
        2
    );
    // Compared as strings: `PathBuf` equality ignores a trailing slash, the UI doesn't.
    assert_eq!(
        ctx.engine.queue(outer).unwrap().dir.to_str(),
        ctx.folder("New").to_str()
    );
    assert_eq!(
        ctx.engine.queue(inner).unwrap().dir.to_str(),
        ctx.folder("New/Inner").to_str()
    );
    assert_eq!(
        ctx.engine.queue(inner).unwrap().dir,
        ctx.folder("New/Inner")
    );
    assert_eq!(ctx.engine.queue(other).unwrap().dir, ctx.folder("Other"));
    assert_eq!(ctx.engine.queue_for_dir(ctx.folder("Old")), None);

    // Downloads continue in the new place.
    ctx.unpause(inner);
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert!(ctx.folder("New/Inner/file.bin").exists());

    // A destination that already has a queue is refused.
    assert!(
        ctx.engine
            .relocate(ctx.folder("New"), ctx.folder("Other"))
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn relocate_refuses_queues_with_running_downloads() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    assert!(
        ctx.engine
            .relocate(ctx.folder("a"), ctx.folder("b"))
            .is_err()
    );
    let queue = ctx.engine.get(id).unwrap().queue_id;
    assert_eq!(ctx.engine.queue(queue).unwrap().dir, ctx.folder("a"));
}

#[tokio::test(flavor = "multi_thread")]
async fn restore_drops_trailing_slashes_from_saved_folders() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    std::fs::create_dir_all(&store).unwrap();
    let id = "6f1c1f3e-8a51-4c51-9d2e-6f0e3c1b2a77";
    let json = format!(
        r#"{{"version":1,"id":"{id}","dir":"/tmp/getit-test/Renamed/","settings":{{"max_concurrent":1,"paused":true}},"downloads":[]}}"#
    );
    std::fs::write(store.join(format!("{id}.json")), json).unwrap();

    let engine = Engine::new(JsonDirStore::new(&store).unwrap()).unwrap();
    let queues = engine.queues();
    assert_eq!(queues[0].dir.to_str(), Some("/tmp/getit-test/Renamed"));
    assert_eq!(
        engine.queue_for_dir("/tmp/getit-test/Renamed"),
        Some(queues[0].id)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn moving_a_waiting_download_up_starts_it_in_place_of_a_running_one() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let first = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let second = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, first).await;
    assert_eq!(ctx.engine.get(second).unwrap().status, DownloadStatus::Queued);

    ctx.engine.reorder_queue(queue, &[second, first]).unwrap();
    assert_eq!(ctx.engine.queue(queue).unwrap().downloads, vec![second, first]);
    assert_eq!(ctx.engine.get(first).unwrap().status, DownloadStatus::Queued);
    wait_for_status(&ctx.engine, second, DownloadStatus::Downloading).await;
    assert_eq!(ctx.engine.get(first).unwrap().status, DownloadStatus::Queued);

    // The bumped one carries on from its partial file once the other finishes.
    wait_for_status(&ctx.engine, first, DownloadStatus::Completed).await;
    ctx.assert_file_matches(first);
    ctx.assert_file_matches(second);
    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 3, "{requests:?}");
    assert_eq!(requests[2].status, 206, "{requests:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn reordering_keeps_downloads_running_within_the_limit() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 2);
    let a = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let b = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let c = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, a).await;
    wait_for_progress(&ctx.engine, b).await;

    // Swapping the two running ones, or moving the waiting one below them, stops nothing.
    ctx.engine.reorder_queue(queue, &[b, a, c]).unwrap();
    ctx.engine.reorder_queue(queue, &[a, b, c]).unwrap();
    for id in [a, b] {
        assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Downloading);
    }
    assert_eq!(ctx.engine.get(c).unwrap().status, DownloadStatus::Queued);
}

#[tokio::test(flavor = "multi_thread")]
async fn reordering_never_stops_a_download_that_cant_resume() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let first = ctx.engine.add(queue, &ctx.url("/norange.bin")).unwrap();
    let second = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.unpause(queue);
    wait_for_progress(&ctx.engine, first).await;
    assert_eq!(ctx.engine.get(first).unwrap().resumable, Some(false));

    ctx.engine.reorder_queue(queue, &[second, first]).unwrap();
    settle().await;
    assert_eq!(ctx.engine.get(first).unwrap().status, DownloadStatus::Downloading);
    assert_eq!(ctx.engine.get(second).unwrap().status, DownloadStatus::Queued);
    wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    ctx.assert_file_matches(first);
    assert_eq!(ctx.server.requests().len(), 2, "the first wasn't restarted");
}

#[tokio::test(flavor = "multi_thread")]
async fn reordering_a_paused_queue_starts_nothing() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let first = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let second = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.reorder_queue(queue, &[second, first]).unwrap();
    settle().await;
    assert_eq!(ctx.engine.queue(queue).unwrap().downloads, vec![second, first]);
    assert!(ctx.server.requests().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_renames_finished_and_paused_files() {
    let ctx = Ctx::new().await;
    let done = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;
    assert_eq!(ctx.engine.rename_download(done, "renamed.bin").unwrap(), "renamed.bin");
    assert_eq!(ctx.engine.get(done).unwrap().file_name.as_deref(), Some("renamed.bin"));
    assert!(!ctx.folder("a/file.bin").exists());
    ctx.assert_file_matches(done);

    let queue = ctx.engine.get(done).unwrap().queue_id;
    let paused = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    wait_for_progress(&ctx.engine, paused).await;
    ctx.engine.pause(paused).unwrap();
    settle().await;
    let name = ctx.engine.get(paused).unwrap().file_name.unwrap();
    ctx.engine.rename_download(paused, "later.bin").unwrap();
    let item = ctx.engine.get(paused).unwrap();
    assert_eq!(item.file_name.as_deref(), Some("later.bin"));
    assert_eq!(item.rename_to, None);
    assert!(!ctx.folder(&format!("a/{name}.part")).exists());
    assert!(ctx.folder("a/later.bin.part").exists());

    ctx.engine.resume(paused).unwrap();
    wait_for_status(&ctx.engine, paused, DownloadStatus::Completed).await;
    ctx.assert_file_matches(paused);
    let requests = ctx.server.requests();
    assert_eq!(requests.last().unwrap().status, 206, "{requests:?}");
}

/// Renames a running download and checks it finishes under the new name over
/// the same connections, without restarting.
async fn rename_while_running(path: &str, connections: usize, data: impl Fn(&Server) -> Arc<Vec<u8>>) {
    let ctx = Ctx::new().await;
    let id = ctx.engine.enqueue(ctx.folder("a"), &ctx.url(path)).unwrap();
    let item = wait_for_progress(&ctx.engine, id).await;
    let old = item.file_name.clone().unwrap();
    ctx.engine.rename_download(id, "renamed.bin").unwrap();

    let item = ctx.engine.get(id).unwrap();
    assert_eq!(item.status, DownloadStatus::Downloading);
    assert_eq!(item.file_name.as_deref(), Some(old.as_str()));
    assert_eq!(item.rename_to.as_deref(), Some("renamed.bin"));
    assert_eq!(item.display_name(), Some("renamed.bin"));
    assert!(ctx.folder(&format!("a/{old}.part")).exists());

    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_eq!(item.file_name.as_deref(), Some("renamed.bin"));
    assert_eq!(item.rename_to, None);
    assert_file_is(&ctx.engine, id, &data(&ctx.server));
    assert!(!ctx.folder(&format!("a/{old}")).exists());
    let requests = ctx.server.requests();
    assert_eq!(requests.len(), connections, "nothing restarted: {requests:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_keeps_a_running_download_going() {
    rename_while_running("/file.bin", 1, |server| server.data.clone()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_keeps_a_non_resumable_download_going() {
    rename_while_running("/norange.bin", 1, |server| server.data.clone()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_keeps_a_segmented_download_going() {
    rename_while_running("/big.bin", 4, |server| server.big.clone()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_of_a_running_download_applies_when_paused() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    ctx.engine.rename_download(id, "renamed.bin").unwrap();
    ctx.engine.pause(id).unwrap();
    settle().await;

    let item = ctx.engine.get(id).unwrap();
    assert_eq!(item.file_name.as_deref(), Some("renamed.bin"));
    assert_eq!(item.rename_to, None);
    assert!(!ctx.folder("a/file.bin.part").exists());
    assert!(ctx.folder("a/renamed.bin.part").exists());

    ctx.engine.resume(id).unwrap();
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);
    let requests = ctx.server.requests();
    assert_eq!(requests.len(), 2, "{requests:?}");
    assert_eq!(requests[1].status, 206);
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_takes_a_free_name_if_one_appeared_meanwhile() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    ctx.engine.rename_download(id, "x.bin").unwrap();
    std::fs::write(ctx.folder("a/x.bin"), b"taken").unwrap();

    let item = wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    assert_eq!(item.file_name.as_deref(), Some("x (1).bin"));
    ctx.assert_file_matches(id);
    assert_eq!(std::fs::read(ctx.folder("a/x.bin")).unwrap(), b"taken");
}

#[tokio::test(flavor = "multi_thread")]
async fn pending_renames_survive_a_restart() {
    let (base, server) = start_server().await;
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::new());
    let folder = dir.path().join("a");

    let engine = Engine::new(store.clone()).unwrap();
    let id = engine.enqueue(&folder, &format!("{base}/file.bin")).unwrap();
    wait_for_progress(&engine, id).await;
    engine.rename_download(id, "renamed.bin").unwrap();
    // Simulates quitting mid-download.
    drop(engine);
    settle().await;

    let engine = Engine::new(store).unwrap();
    let item = engine.get(id).unwrap();
    assert_eq!(item.file_name.as_deref(), Some("renamed.bin"));
    assert_eq!(item.rename_to, None);
    assert!(!folder.join("file.bin.part").exists());
    assert!(item.downloaded > 0, "progress comes from the renamed partial file");

    engine.resume(id).unwrap();
    wait_for_status(&engine, id, DownloadStatus::Completed).await;
    assert_file_matches(&engine, id, &server);
}

#[tokio::test(flavor = "multi_thread")]
async fn rename_refuses_taken_and_invalid_names() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 2);
    let first = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let second = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.rename_download(first, "one.bin").unwrap();
    std::fs::create_dir_all(ctx.folder("a")).unwrap();
    std::fs::write(ctx.folder("a/outside.bin"), b"x").unwrap();
    std::fs::write(ctx.folder("a/partial.bin.part"), b"x").unwrap();

    for name in ["one.bin", "outside.bin", "partial.bin"] {
        assert!(
            matches!(ctx.engine.rename_download(second, name), Err(EngineError::NameTaken(_))),
            "{name}"
        );
    }
    for name in ["", " ", ".", "..", "a/b.bin", "a\\b.bin"] {
        assert!(
            matches!(ctx.engine.rename_download(second, name), Err(EngineError::InvalidName(_))),
            "{name:?}"
        );
    }
    // Changing only the case is fine, and so is keeping the name.
    ctx.engine.rename_download(first, "ONE.bin").unwrap();
    ctx.engine.rename_download(first, "ONE.bin").unwrap();

    // A name given before the download starts is used instead of the server's.
    ctx.unpause(queue);
    wait_for_status(&ctx.engine, first, DownloadStatus::Completed).await;
    assert_eq!(ctx.engine.get(first).unwrap().file_name.as_deref(), Some("ONE.bin"));
    ctx.assert_file_matches(first);
}

#[tokio::test(flavor = "multi_thread")]
async fn pending_names_are_reserved() {
    let ctx = Ctx::new().await;
    let running = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, running).await;
    ctx.engine.rename_download(running, "x.bin").unwrap();
    let queue = ctx.engine.get(running).unwrap().queue_id;
    let other = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.pause(other).unwrap();
    assert!(matches!(
        ctx.engine.rename_download(other, "x.bin"),
        Err(EngineError::NameTaken(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn move_downloads_takes_files_along() {
    let ctx = Ctx::new().await;
    let done = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;
    let source = ctx.engine.get(done).unwrap().queue_id;
    let waiting = ctx.engine.add(source, &ctx.url("/file.bin")).unwrap();
    ctx.engine.pause(waiting).unwrap();
    // A file with the same name is already in the destination.
    std::fs::create_dir_all(ctx.folder("b")).unwrap();
    std::fs::write(ctx.folder("b/file.bin"), b"taken").unwrap();

    ctx.engine
        .move_downloads(&[done, waiting], ctx.folder("b"))
        .unwrap();

    let target = ctx.engine.queue_for_dir(ctx.folder("b")).unwrap();
    assert_eq!(ctx.engine.queue(target).unwrap().downloads, vec![done, waiting]);
    assert!(ctx.engine.queue(source).unwrap().downloads.is_empty());
    let moved = ctx.engine.get(done).unwrap();
    assert_eq!(moved.queue_id, target);
    assert_eq!(moved.file_name.as_deref(), Some("file (1).bin"));
    assert!(!ctx.folder("a/file.bin").exists());
    ctx.assert_file_matches(done);
    assert_eq!(std::fs::read(ctx.folder("b/file.bin")).unwrap(), b"taken");

    // Moving into the queue it's already in changes nothing.
    ctx.engine.move_downloads(&[done], ctx.folder("b")).unwrap();
    assert_eq!(ctx.engine.queue(target).unwrap().downloads, vec![done, waiting]);

    ctx.engine.resume(waiting).unwrap();
    wait_for_status(&ctx.engine, waiting, DownloadStatus::Completed).await;
    ctx.assert_file_matches(waiting);
}

#[tokio::test(flavor = "multi_thread")]
async fn move_downloads_moves_running_downloads() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_progress(&ctx.engine, id).await;
    let target = ctx.paused_queue("b", 1);

    ctx.engine.move_downloads(&[id], ctx.folder("b")).unwrap();
    let item = ctx.engine.get(id).unwrap();
    assert_eq!(item.queue_id, target);
    assert_eq!(item.status, DownloadStatus::Queued);

    // It waits in the paused queue, then continues from its moved partial file.
    settle().await;
    assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Queued);
    let name = ctx.engine.get(id).unwrap().file_name.unwrap();
    assert!(!ctx.folder(&format!("a/{name}.part")).exists());
    ctx.unpause(target);
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);
    assert!(ctx.server.requests().iter().any(|r| r.status == 206));
}

#[tokio::test(flavor = "multi_thread")]
async fn move_downloads_waits_in_the_new_queue() {
    let ctx = Ctx::new().await;
    let source = ctx.paused_queue("a", 1);
    let id = ctx.engine.add(source, &ctx.url("/file.bin")).unwrap();
    ctx.engine.resume(id).unwrap();
    wait_for_progress(&ctx.engine, id).await;
    let target = ctx.paused_queue("b", 1);

    ctx.engine.move_downloads(&[id], ctx.folder("b")).unwrap();
    settle().await;
    assert_eq!(ctx.engine.get(id).unwrap().status, DownloadStatus::Queued);
    ctx.unpause(target);
    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);
    assert!(ctx.folder("b").join(ctx.engine.get(id).unwrap().file_name.unwrap()).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn requeue_puts_paused_downloads_back_in_line() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let first = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let second = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.pause(first).unwrap();
    ctx.engine.pause(second).unwrap();
    ctx.unpause(queue);
    settle().await;
    assert_eq!(ctx.engine.get(first).unwrap().status, DownloadStatus::Paused);

    ctx.engine.requeue(&[first, second]).unwrap();
    // The queue runs them one at a time, as it would have before they were paused.
    wait_for_progress(&ctx.engine, first).await;
    assert_eq!(ctx.engine.get(second).unwrap().status, DownloadStatus::Queued);
    wait_for_status(&ctx.engine, second, DownloadStatus::Completed).await;
    ctx.assert_file_matches(first);
    ctx.assert_file_matches(second);
}

#[tokio::test(flavor = "multi_thread")]
async fn copy_downloads_copies_files_and_partial_progress() {
    let ctx = Ctx::new().await;
    let done = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;
    let source = ctx.engine.get(done).unwrap().queue_id;
    let partial = ctx.engine.add(source, &ctx.url("/file.bin")).unwrap();
    wait_for_progress(&ctx.engine, partial).await;
    ctx.engine.pause(partial).unwrap();
    settle().await;

    // Copying into the same folder gives the copies free names.
    let copies = ctx.engine.copy_downloads(&[done, partial], ctx.folder("a")).unwrap();
    assert_eq!(copies.len(), 2);
    assert_eq!(ctx.engine.queue(source).unwrap().downloads[2..], copies[..]);
    let copy = ctx.engine.get(copies[0]).unwrap();
    assert_eq!(copy.status, DownloadStatus::Completed);
    assert_ne!(copy.file_name, ctx.engine.get(done).unwrap().file_name);
    ctx.assert_file_matches(done);
    ctx.assert_file_matches(copies[0]);

    // The paused copy carries on from the copied partial file.
    let copy = ctx.engine.get(copies[1]).unwrap();
    assert_eq!(copy.status, DownloadStatus::Paused);
    assert!(copy.downloaded > 0);
    ctx.engine.resume(copies[1]).unwrap();
    wait_for_status(&ctx.engine, copies[1], DownloadStatus::Completed).await;
    ctx.assert_file_matches(copies[1]);
    assert_eq!(ctx.engine.get(partial).unwrap().status, DownloadStatus::Paused);
}

#[tokio::test(flavor = "multi_thread")]
async fn copy_queues_gives_a_copied_folder_its_own_queues() {
    let ctx = Ctx::new().await;
    let done = ctx
        .engine
        .enqueue(ctx.folder("a/inner"), &ctx.url("/file.bin"))
        .unwrap();
    wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;
    let name = ctx.engine.get(done).unwrap().file_name.unwrap();
    std::fs::create_dir_all(ctx.folder("b/inner")).unwrap();
    std::fs::copy(ctx.folder(&format!("a/inner/{name}")), ctx.folder(&format!("b/inner/{name}"))).unwrap();

    assert_eq!(ctx.engine.copy_queues(ctx.folder("a"), ctx.folder("b")).unwrap(), 1);
    let queue = ctx.engine.queue_for_dir(ctx.folder("b/inner")).unwrap();
    let copies = ctx.engine.queue(queue).unwrap().downloads;
    assert_eq!(copies.len(), 1);
    assert_ne!(copies[0], done);
    ctx.assert_file_matches(copies[0]);
    assert_eq!(ctx.engine.get(done).unwrap().queue_id, ctx.engine.queue_for_dir(ctx.folder("a/inner")).unwrap());

    // A folder that already has a queue isn't copied over.
    assert!(ctx.engine.copy_queues(ctx.folder("a"), ctx.folder("b")).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn restored_downloads_carry_on_from_their_partial_files() {
    let ctx = Ctx::new().await;
    let id = ctx
        .engine
        .enqueue(ctx.folder("a"), &ctx.url("/file.bin"))
        .unwrap();
    let item = wait_for_progress(&ctx.engine, id).await;
    // Set the partial file aside, as moving it to the Trash would.
    let part = item.part_path(&ctx.folder("a")).unwrap();
    let aside = ctx.dir.path().join("aside.part");
    std::fs::rename(&part, &aside).unwrap();
    ctx.engine.remove(id).unwrap();
    settle().await;

    std::fs::rename(&aside, &part).unwrap();
    let partial = std::fs::metadata(&part).unwrap().len();
    ctx.engine
        .restore_downloads(vec![item], ctx.folder("a"))
        .unwrap();
    let restored = ctx.engine.get(id).expect("download is back");
    assert_eq!(restored.downloaded, partial);
    assert_ne!(restored.status, DownloadStatus::Paused);

    wait_for_status(&ctx.engine, id, DownloadStatus::Completed).await;
    ctx.assert_file_matches(id);
    let requests = ctx.server.requests();
    assert_eq!(
        requests.last().unwrap().range.as_deref(),
        Some(format!("bytes={partial}-").as_str()),
        "{requests:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn removed_queues_can_be_restored() {
    let ctx = Ctx::new().await;
    let queue = ctx.paused_queue("a", 1);
    let done = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    let waiting = ctx.engine.add(queue, &ctx.url("/file.bin")).unwrap();
    ctx.engine.pause(waiting).unwrap();
    ctx.unpause(queue);
    wait_for_status(&ctx.engine, done, DownloadStatus::Completed).await;

    let snapshot = ctx.engine.queue_snapshot(queue).unwrap();
    ctx.engine.remove_queue(queue).unwrap();
    assert!(ctx.engine.get(done).is_none());

    ctx.engine.restore_queue(snapshot.clone()).unwrap();
    let info = ctx.engine.queue(queue).expect("queue is back");
    assert_eq!(info.dir, ctx.folder("a"));
    assert!(!info.settings.paused);
    assert_eq!(info.downloads, vec![done, waiting]);
    assert_eq!(ctx.engine.get(done).unwrap().status, DownloadStatus::Completed);
    assert_eq!(ctx.engine.get(waiting).unwrap().status, DownloadStatus::Paused);
    assert_eq!(ctx.engine.queue_for_dir(ctx.folder("a")), Some(queue));
    assert!(ctx.engine.restore_queue(snapshot).is_err());
}
