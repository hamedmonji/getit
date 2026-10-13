//! Downloads a single file over one HTTP connection.
//!
//! Data is written to `<name>.part` and renamed to `<name>` when complete. The
//! `.part` file's length is the resume offset, so a stopped download can carry on
//! with a `Range` request whenever the server supports it.

use std::collections::VecDeque;
use std::error::Error as StdError;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::header::{self, HeaderMap};
use reqwest::{Client, StatusCode, Url};
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

use crate::types::{DownloadId, DownloadItem, part_path};

const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const SPEED_WINDOW: Duration = Duration::from_secs(3);
const WRITE_BUFFER: usize = 256 * 1024;
const MAX_FILE_NAME_BYTES: usize = 200;
const FALLBACK_FILE_NAME: &str = "download";

pub(crate) enum WorkerMsg {
    Meta {
        id: DownloadId,
        file_name: String,
        total_bytes: Option<u64>,
        resumable: bool,
        etag: Option<String>,
        last_modified: Option<String>,
    },
    Progress {
        id: DownloadId,
        downloaded: u64,
        total: Option<u64>,
        speed_bps: u64,
    },
    Done {
        id: DownloadId,
        outcome: Outcome,
        part_path: Option<PathBuf>,
    },
}

#[derive(Debug)]
pub(crate) enum Outcome {
    Completed,
    /// The cancellation token fired. The `.part` file is kept for resuming.
    Stopped,
    Failed(String),
}

/// What a worker needs to know about a download, copied from its [`DownloadItem`]
/// and its queue's folder.
pub(crate) struct Job {
    id: DownloadId,
    url: String,
    dest_dir: PathBuf,
    file_name: Option<String>,
    total_bytes: Option<u64>,
    resumable: Option<bool>,
    etag: Option<String>,
    last_modified: Option<String>,
}

impl Job {
    pub(crate) fn new(item: &DownloadItem, dest_dir: &Path) -> Self {
        Self {
            id: item.id,
            url: item.url.clone(),
            dest_dir: dest_dir.to_path_buf(),
            file_name: item.file_name.clone(),
            total_bytes: item.total_bytes,
            resumable: item.resumable,
            etag: item.etag.clone(),
            last_modified: item.last_modified.clone(),
        }
    }

    fn part_path(&self) -> Option<PathBuf> {
        self.file_name
            .as_ref()
            .map(|name| part_path(&self.dest_dir, name))
    }

    /// Validator for `If-Range`. Weak ETags are not allowed there, so fall back to
    /// `Last-Modified` for those.
    fn if_range_validator(&self) -> Option<&str> {
        self.etag
            .as_deref()
            .filter(|etag| !etag.starts_with("W/"))
            .or(self.last_modified.as_deref())
    }
}

enum AttemptError {
    /// Network trouble or a server error. Worth trying again.
    Retryable(String),
    /// Retrying won't help (4xx, disk errors, ...).
    Fatal(String),
}

/// Runs the download to completion, failure or cancellation, then sends
/// [`WorkerMsg::Done`].
pub(crate) async fn run(
    client: Client,
    mut job: Job,
    cancel: CancellationToken,
    tx: UnboundedSender<WorkerMsg>,
) {
    let mut failures = 0;
    let outcome = loop {
        let mut progressed = false;
        match attempt(&client, &mut job, &cancel, &tx, &mut progressed).await {
            Ok(outcome) => break outcome,
            Err(AttemptError::Fatal(msg)) => break Outcome::Failed(msg),
            Err(AttemptError::Retryable(msg)) => {
                if progressed {
                    failures = 0;
                }
                if failures >= MAX_RETRIES {
                    break Outcome::Failed(msg);
                }
                let delay = RETRY_BASE_DELAY * 2u32.pow(failures);
                failures += 1;
                tokio::select! {
                    _ = cancel.cancelled() => break Outcome::Stopped,
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    };
    let _ = tx.send(WorkerMsg::Done {
        id: job.id,
        part_path: job.part_path(),
        outcome,
    });
}

async fn attempt(
    client: &Client,
    job: &mut Job,
    cancel: &CancellationToken,
    tx: &UnboundedSender<WorkerMsg>,
    progressed: &mut bool,
) -> Result<Outcome, AttemptError> {
    fs::create_dir_all(&job.dest_dir).await.map_err(|e| {
        AttemptError::Fatal(format!("cannot create {}: {e}", job.dest_dir.display()))
    })?;

    let offset = match job.part_path() {
        Some(path) => match fs::metadata(&path).await {
            Ok(meta) => meta.len(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => 0,
            Err(e) => return Err(io_fatal(&path, e)),
        },
        None => 0,
    };
    let use_range = offset > 0 && job.resumable != Some(false);

    let mut request = client.get(&job.url);
    if use_range {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
        if let Some(validator) = job.if_range_validator() {
            request = request.header(header::IF_RANGE, validator);
        }
    }
    let response = tokio::select! {
        _ = cancel.cancelled() => return Ok(Outcome::Stopped),
        response = request.send() => response.map_err(|e| AttemptError::Retryable(describe(&e)))?,
    };

    let status = response.status();
    if status == StatusCode::RANGE_NOT_SATISFIABLE && use_range {
        let remote_total = parse_content_range_total(response.headers());
        if job.total_bytes == Some(offset) || remote_total == Some(offset) {
            // Everything was downloaded; only the rename was left.
            return finish(job, offset, tx).await;
        }
        discard_partial(job).await?;
        return Err(AttemptError::Retryable(
            "server rejected the resume range".into(),
        ));
    }
    if !status.is_success() {
        let msg = format!("HTTP {status}");
        let retryable = status.is_server_error()
            || status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT;
        return Err(if retryable {
            AttemptError::Retryable(msg)
        } else {
            AttemptError::Fatal(msg)
        });
    }

    let headers = response.headers();
    let partial = status == StatusCode::PARTIAL_CONTENT;
    let (start, total) = if partial {
        match parse_content_range(headers) {
            Some((start, total)) if start == 0 || (use_range && start == offset) => (start, total),
            _ => {
                discard_partial(job).await?;
                return Err(AttemptError::Retryable(
                    "server sent an unexpected Content-Range".into(),
                ));
            }
        }
    } else {
        // A 200 means a full body: either we didn't ask for a range, the server
        // ignored it, or the file changed since the partial download (If-Range).
        (0, response.content_length())
    };

    if job.file_name.is_none() {
        let candidate = filename_from_disposition(headers)
            .or_else(|| filename_from_url(response.url()))
            .and_then(|name| sanitize_file_name(&name))
            .unwrap_or_else(|| FALLBACK_FILE_NAME.to_string());
        let name = reserve_file_name(&job.dest_dir, &candidate)
            .await
            .map_err(|e| io_fatal(&job.dest_dir, e))?;
        job.file_name = Some(name);
    }
    job.total_bytes = total;
    job.resumable = Some(partial || accepts_ranges(headers));
    job.etag = header_string(headers, header::ETAG);
    job.last_modified = header_string(headers, header::LAST_MODIFIED);
    let _ = tx.send(WorkerMsg::Meta {
        id: job.id,
        file_name: job.file_name.clone().unwrap_or_default(),
        total_bytes: job.total_bytes,
        resumable: job.resumable.unwrap_or(false),
        etag: job.etag.clone(),
        last_modified: job.last_modified.clone(),
    });

    let part = job.part_path().expect("file name was just set");
    let file = if start == 0 {
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&part)
            .await
    } else {
        OpenOptions::new().append(true).open(&part).await
    }
    .map_err(|e| io_fatal(&part, e))?;

    let mut writer = BufWriter::with_capacity(WRITE_BUFFER, file);
    let mut stream = response.bytes_stream();
    let mut downloaded = start;
    let mut meter = SpeedMeter::new(downloaded);
    let mut last_emit = Instant::now();
    send_progress(tx, job, downloaded, 0);

    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                writer.flush().await.map_err(|e| io_fatal(&part, e))?;
                send_progress(tx, job, downloaded, 0);
                return Ok(Outcome::Stopped);
            }
            chunk = stream.next() => chunk,
        };
        match chunk {
            Some(Ok(bytes)) => {
                writer
                    .write_all(&bytes)
                    .await
                    .map_err(|e| io_fatal(&part, e))?;
                downloaded += bytes.len() as u64;
                *progressed = true;
                if last_emit.elapsed() >= PROGRESS_INTERVAL {
                    send_progress(tx, job, downloaded, meter.sample(downloaded));
                    last_emit = Instant::now();
                }
            }
            Some(Err(e)) => {
                // Keep what we have so the retry can resume from it.
                let _ = writer.flush().await;
                send_progress(tx, job, downloaded, 0);
                return Err(AttemptError::Retryable(describe(&e)));
            }
            None => break,
        }
    }

    writer.flush().await.map_err(|e| io_fatal(&part, e))?;
    let file = writer.into_inner();
    file.sync_all().await.map_err(|e| io_fatal(&part, e))?;
    drop(file);

    if let Some(total) = job.total_bytes
        && downloaded < total
    {
        return Err(AttemptError::Retryable(
            "connection closed before the download finished".into(),
        ));
    }
    finish(job, downloaded, tx).await
}

async fn finish(
    job: &Job,
    downloaded: u64,
    tx: &UnboundedSender<WorkerMsg>,
) -> Result<Outcome, AttemptError> {
    let name = job
        .file_name
        .as_deref()
        .expect("file name is set before finishing");
    let part = part_path(&job.dest_dir, name);
    fs::rename(&part, job.dest_dir.join(name))
        .await
        .map_err(|e| io_fatal(&part, e))?;
    send_progress(tx, job, downloaded, 0);
    Ok(Outcome::Completed)
}

/// Empties the `.part` file so the next attempt starts from zero.
async fn discard_partial(job: &Job) -> Result<(), AttemptError> {
    if let Some(part) = job.part_path() {
        fs::File::create(&part)
            .await
            .map_err(|e| io_fatal(&part, e))?;
    }
    Ok(())
}

fn send_progress(tx: &UnboundedSender<WorkerMsg>, job: &Job, downloaded: u64, speed_bps: u64) {
    let _ = tx.send(WorkerMsg::Progress {
        id: job.id,
        downloaded,
        total: job.total_bytes,
        speed_bps,
    });
}

/// Average speed over a sliding window.
struct SpeedMeter {
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    fn new(bytes: u64) -> Self {
        Self {
            samples: VecDeque::from([(Instant::now(), bytes)]),
        }
    }

    fn sample(&mut self, bytes: u64) -> u64 {
        let now = Instant::now();
        self.samples.push_back((now, bytes));
        while self.samples.len() > 2
            && self
                .samples
                .front()
                .is_some_and(|(t, _)| now.duration_since(*t) > SPEED_WINDOW)
        {
            self.samples.pop_front();
        }
        let (t0, b0) = self.samples[0];
        let secs = now.duration_since(t0).as_secs_f64();
        if secs > 0.0 {
            (bytes.saturating_sub(b0) as f64 / secs) as u64
        } else {
            0
        }
    }
}

fn io_fatal(path: &Path, err: io::Error) -> AttemptError {
    AttemptError::Fatal(format!("{}: {err}", path.display()))
}

/// Error message including its source chain. reqwest's top-level messages alone
/// ("error sending request") don't say what went wrong.
fn describe(err: &dyn StdError) -> String {
    let mut msg = err.to_string();
    let mut source = err.source();
    while let Some(err) = source {
        msg.push_str(": ");
        msg.push_str(&err.to_string());
        source = err.source();
    }
    msg
}

fn header_string(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers.get(name)?.to_str().ok().map(str::to_owned)
}

fn accepts_ranges(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|unit| unit.trim().eq_ignore_ascii_case("bytes"))
        })
}

/// Parses `Content-Range: bytes <start>-<end>/<total|*>` into `(start, total)`.
fn parse_content_range(headers: &HeaderMap) -> Option<(u64, Option<u64>)> {
    let value = headers.get(header::CONTENT_RANGE)?.to_str().ok()?;
    let (range, total) = value.trim().strip_prefix("bytes ")?.split_once('/')?;
    let (start, _end) = range.split_once('-')?;
    Some((start.trim().parse().ok()?, total.trim().parse().ok()))
}

/// Total from a 416 response's `Content-Range: bytes */<total>`.
fn parse_content_range_total(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(header::CONTENT_RANGE)?.to_str().ok()?;
    value.rsplit_once('/')?.1.trim().parse().ok()
}

/// File name from `Content-Disposition`, preferring the RFC 5987 `filename*` form.
fn filename_from_disposition(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::CONTENT_DISPOSITION)?.to_str().ok()?;
    let mut plain = None;
    for param in value.split(';').skip(1) {
        let Some((key, val)) = param.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let val = val.trim();
        if key == "filename*" {
            // charset'language'percent-encoded-value
            if let Some((_, rest)) = val.split_once('\'')
                && let Some((_, encoded)) = rest.split_once('\'')
                && let Ok(decoded) = percent_decode_str(encoded).decode_utf8()
            {
                return Some(decoded.into_owned());
            }
        } else if key == "filename" {
            plain = Some(val.trim_matches('"').to_string());
        }
    }
    plain
}

fn filename_from_url(url: &Url) -> Option<String> {
    let segment = url.path_segments()?.next_back()?;
    if segment.is_empty() {
        return None;
    }
    Some(percent_decode_str(segment).decode_utf8_lossy().into_owned())
}

/// Makes a server- or URL-provided name safe to use as a file name on every
/// platform. Returns `None` if nothing usable is left.
fn sanitize_file_name(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.len() > MAX_FILE_NAME_BYTES {
        let mut cut = MAX_FILE_NAME_BYTES;
        while !cleaned.is_char_boundary(cut) {
            cut -= 1;
        }
        cleaned.truncate(cut);
    }
    (!cleaned.is_empty()).then_some(cleaned)
}

/// Splits `"name.ext"` into `("name", ".ext")`. Dotfiles have no extension.
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

/// Picks a name that's free in `dir`, adding ` (1)`, ` (2)`, ... as needed, and
/// claims it by creating the `.part` file so concurrent downloads can't take it.
async fn reserve_file_name(dir: &Path, candidate: &str) -> io::Result<String> {
    let (stem, ext) = split_extension(candidate);
    for n in 0..10_000 {
        let name = if n == 0 {
            candidate.to_string()
        } else {
            format!("{stem} ({n}){ext}")
        };
        if fs::try_exists(dir.join(&name)).await? {
            continue;
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(part_path(dir, &name))
            .await
        {
            Ok(_) => return Ok(name),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other(format!(
        "no free file name for {candidate}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    fn disposition(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(value).unwrap(),
        );
        headers
    }

    #[test]
    fn disposition_plain_and_encoded() {
        assert_eq!(
            filename_from_disposition(&disposition(r#"attachment; filename="report final.pdf""#)),
            Some("report final.pdf".into())
        );
        assert_eq!(
            filename_from_disposition(&disposition("attachment; filename=plain.txt")),
            Some("plain.txt".into())
        );
        assert_eq!(
            filename_from_disposition(&disposition(
                r#"attachment; filename="fallback.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9.txt"#
            )),
            Some("résumé.txt".into())
        );
        assert_eq!(filename_from_disposition(&disposition("inline")), None);
    }

    #[test]
    fn url_file_names() {
        let name = |url: &str| filename_from_url(&Url::parse(url).unwrap());
        assert_eq!(
            name("https://x.com/a/b%20c.zip?q=1"),
            Some("b c.zip".into())
        );
        assert_eq!(name("https://x.com/"), None);
        assert_eq!(name("https://x.com/dir/"), None);
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(
            sanitize_file_name("../../etc/passwd"),
            Some("passwd".into())
        );
        assert_eq!(sanitize_file_name(r"C:\temp\a.txt"), Some("a.txt".into()));
        assert_eq!(sanitize_file_name("a:b?.txt"), Some("a_b_.txt".into()));
        assert_eq!(sanitize_file_name(" ... "), None);
        assert_eq!(sanitize_file_name(&"é".repeat(150)).unwrap().len(), 200);
    }

    #[test]
    fn splits_extensions() {
        assert_eq!(split_extension("a.zip"), ("a", ".zip"));
        assert_eq!(split_extension("a.tar.gz"), ("a.tar", ".gz"));
        assert_eq!(split_extension(".bashrc"), (".bashrc", ""));
        assert_eq!(split_extension("noext"), ("noext", ""));
    }

    #[test]
    fn parses_content_range() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_static("bytes 100-199/200"),
        );
        assert_eq!(parse_content_range(&headers), Some((100, Some(200))));
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_static("bytes 0-99/*"),
        );
        assert_eq!(parse_content_range(&headers), Some((0, None)));
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_static("bytes */500"),
        );
        assert_eq!(parse_content_range_total(&headers), Some(500));
    }

    #[tokio::test]
    async fn reserves_unique_names() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.zip"), b"done").unwrap();
        assert_eq!(
            reserve_file_name(dir.path(), "a.zip").await.unwrap(),
            "a (1).zip"
        );
        // The first reservation's .part file now blocks the same name.
        assert_eq!(
            reserve_file_name(dir.path(), "a.zip").await.unwrap(),
            "a (2).zip"
        );
    }
}
