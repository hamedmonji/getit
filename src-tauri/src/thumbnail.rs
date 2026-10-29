//! Thumbnails of finished images and videos, for their file icons. Made by the
//! ffmpeg bundled beside getit (see scripts/build-ffmpeg.sh), with Quick Look
//! as a fallback on macOS for what it can't read, such as HEIC. Cached on disk
//! by path, size and modification time so each is made once.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Semaphore;

use crate::access::Access;

/// How many thumbnails are made at once, so a folder full of videos doesn't
/// start dozens of decoders together.
static PERMITS: Semaphore = Semaphore::const_new(2);

/// How long making one thumbnail may take before it's given up on.
const TIMEOUT: Duration = Duration::from_secs(20);

/// The PNG thumbnail of the file at `path`, at most `size` pixels on its
/// longer side, as raw bytes.
#[tauri::command]
pub async fn thumbnail(app: AppHandle, access: State<'_, Access>, path: String, size: u32) -> Result<Response, String> {
    let file = PathBuf::from(&path);
    if access.blocked(&file) {
        return Err("no access".into());
    }
    let meta = fs::metadata(&file).map_err(|e| e.to_string())?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbnails");
    let cached = dir.join(format!("{:016x}.png", cache_key(&path, meta.len(), modified, size)));
    if let Ok(bytes) = fs::read(&cached) {
        return Ok(Response::new(bytes));
    }
    let _permit = PERMITS.acquire().await.map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if !with_ffmpeg(&file, &cached, size) && !with_quick_look(&file, &dir, &cached, size) {
            return Err("no thumbnail".to_string());
        }
        fs::read(&cached).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

fn cache_key(path: &str, len: u64, modified: u128, size: u32) -> u64 {
    let mut h = DefaultHasher::new();
    (path, len, modified, size).hash(&mut h);
    h.finish()
}

/// The bundled ffmpeg, which Tauri puts beside getit's own executable.
fn ffmpeg() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let path = exe.parent()?.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    path.is_file().then_some(path)
}

/// Makes the thumbnail into `cached` with ffmpeg, from the keyframe a tenth of
/// the way into a video, past any black opening, or from an image. Whether it did.
fn with_ffmpeg(file: &Path, cached: &Path, size: u32) -> bool {
    let Some(ffmpeg) = ffmpeg() else { return false };
    // With no output, ffmpeg only describes the input, its duration included.
    let probe = Command::new(&ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(file)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let seek = probe
        .ok()
        .and_then(|out| parse_duration(&String::from_utf8_lossy(&out.stderr)))
        .map_or(0.0, seek_seconds);
    let part = cached.with_extension("part");
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-skip_frame", "nokey"])
        .args(["-ss", &format!("{seek:.3}"), "-i"])
        .arg(file)
        .args(["-an", "-sn", "-dn", "-frames:v", "1", "-vf", &scale_filter(size), "-c:v", "png", "-f", "image2pipe", "-y"])
        .arg(&part)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let made = cmd.spawn().is_ok_and(finished) && part.metadata().is_ok_and(|m| m.len() > 0);
    let made = made && fs::rename(&part, cached).is_ok();
    let _ = fs::remove_file(&part);
    made
}

/// The video's duration in seconds from ffmpeg's description of it, as in
/// `Duration: 00:42:10.12, start: ...`; None when it has none, as an image.
fn parse_duration(description: &str) -> Option<f64> {
    let rest = description.split("Duration: ").nth(1)?;
    let mut parts = rest.split(',').next()?.trim().split(':');
    let (h, m, s) = (parts.next()?, parts.next()?, parts.next()?);
    let seconds = h.parse::<f64>().ok()? * 3600.0 + m.parse::<f64>().ok()? * 60.0 + s.parse::<f64>().ok()?;
    (seconds > 0.0).then_some(seconds)
}

/// Where to take a video's frame from: a tenth of the way in.
fn seek_seconds(duration: f64) -> f64 {
    duration / 10.0
}

/// Shrinks the frame to fit `size` on its longer side, never enlarging it, in
/// 8-bit colour, which PNG takes from any source (10-bit video included).
fn scale_filter(size: u32) -> String {
    format!("scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease,format=rgb24")
}

/// Waits for `child` to exit, killing it after `TIMEOUT`. Whether it succeeded.
fn finished(mut child: Child) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < TIMEOUT => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// Makes the thumbnail into `cached` with Quick Look. Whether it did.
#[cfg(target_os = "macos")]
fn with_quick_look(file: &Path, dir: &Path, cached: &Path, size: u32) -> bool {
    // Quick Look names its output after the file; a folder of its own per
    // thumbnail keeps two files of the same name apart.
    let work = dir.join(format!("tmp-{}", cached.file_stem().and_then(|s| s.to_str()).unwrap_or("x")));
    if fs::create_dir_all(&work).is_err() {
        return false;
    }
    let ran = Command::new("/usr/bin/qlmanage")
        .args(["-t", "-s", &size.to_string(), "-o"])
        .arg(&work)
        .arg(file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok_and(finished);
    let made = fs::read_dir(&work)
        .ok()
        .and_then(|mut entries| entries.find_map(|e| e.ok().map(|e| e.path())))
        .filter(|p| p.extension().is_some_and(|ext| ext == "png"));
    let done = ran && made.is_some_and(|png| fs::rename(png, cached).is_ok());
    let _ = fs::remove_dir_all(&work);
    done
}

#[cfg(not(target_os = "macos"))]
fn with_quick_look(_file: &Path, _dir: &Path, _cached: &Path, _size: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_duration_from_ffmpegs_description() {
        let description = "Input #0, matroska,webm, from 'a.mkv':\n  Duration: 00:42:10.50, start: 0.000000, bitrate: 2000 kb/s\n";
        assert_eq!(parse_duration(description), Some(42.0 * 60.0 + 10.5));
        assert_eq!(parse_duration("  Duration: 01:00:00.00, start: 0"), Some(3600.0));
    }

    #[test]
    fn has_no_duration_for_images_or_unknown_lengths() {
        assert_eq!(parse_duration("Input #0, png_pipe, from 'a.png':\n  Stream #0:0: Video: png"), None);
        assert_eq!(parse_duration("  Duration: N/A, bitrate: N/A"), None);
        assert_eq!(parse_duration("  Duration: 00:00:00.00, start: 0"), None);
    }

    #[test]
    fn seeks_a_tenth_of_the_way_in() {
        assert_eq!(seek_seconds(600.0), 60.0);
    }

    #[test]
    fn scales_to_fit_without_enlarging() {
        assert_eq!(
            scale_filter(256),
            "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease,format=rgb24"
        );
    }
}
