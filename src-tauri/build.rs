use std::fs;
use std::path::PathBuf;

fn main() {
    ffmpeg_sidecar();
    tauri_build::build()
}

/// Tauri won't build without the ffmpeg sidecar (see scripts/build-ffmpeg.sh),
/// which takes a while to build, and on Windows needs MSYS2. Development builds
/// make do with an empty stand-in, so getit runs without thumbnails; release
/// builds stop instead, so one never ships without ffmpeg.
fn ffmpeg_sidecar() {
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let exe = if target.contains("windows") { ".exe" } else { "" };
    let dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let sidecar = dir.join("binaries").join(format!("ffmpeg-{target}{exe}"));
    println!("cargo:rerun-if-changed={}", sidecar.display());
    let built = sidecar.metadata().is_ok_and(|m| m.len() > 0);
    if built {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("{} is missing; build it with `pnpm ffmpeg` first", sidecar.display());
    }
    if !sidecar.exists() {
        fs::create_dir_all(sidecar.parent().expect("has a parent")).expect("create binaries/");
        fs::write(&sidecar, b"").expect("write the ffmpeg stand-in");
        println!("cargo:warning=no ffmpeg at {}; thumbnails are off (run `pnpm ffmpeg`)", sidecar.display());
    }
}
