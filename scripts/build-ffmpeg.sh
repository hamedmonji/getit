#!/bin/bash
# Builds the ffmpeg that getit bundles to make thumbnails of videos and images:
# an LGPL build from source with only the demuxers, decoders and PNG encoder
# that needs. Tauri bundles it from src-tauri/binaries/ffmpeg-<target triple>.
#
# Usage: build-ffmpeg.sh [target triple]   (defaults to this machine's)
#
# Windows targets build with MinGW under MSYS2 (gcc, make, diffutils, xz, zlib),
# statically linked so the .exe needs no MinGW runtime DLLs beside it.
set -euo pipefail

VERSION=7.1.1
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
GITHUB_SHA256=f117507dc501f2a6c11f9241d8d0c3213846cfad91764361af37befd6b6c523d

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
EXE=""
case "$TRIPLE" in *-windows-*) EXE=".exe" ;; esac
OUT="$ROOT_DIR/src-tauri/binaries/ffmpeg-$TRIPLE$EXE"
WORK="$ROOT_DIR/target/ffmpeg-build"

if [ -x "$OUT" ]; then
  echo "→ $OUT already built"
  exit 0
fi

configure_target=()
case "$TRIPLE" in
  aarch64-apple-darwin | x86_64-apple-darwin)
    arch="${TRIPLE%%-*}"
    [ "$arch" = aarch64 ] && arch=arm64
    min="-mmacosx-version-min=10.13"
    configure_target=(--arch="$arch" --target-os=darwin --cc="clang -arch $arch"
      --extra-cflags="$min" --extra-ldflags="$min")
    [ "$arch" != "$(uname -m)" ] && configure_target+=(--enable-cross-compile)
    ;;
  *-linux-gnu) ;;
  x86_64-pc-windows-msvc | x86_64-pc-windows-gnu)
    configure_target=(--arch=x86_64 --target-os=mingw32 --extra-ldflags=-static)
    ;;
  *)
    echo "No ffmpeg build for $TRIPLE yet" >&2
    exit 1
    ;;
esac

mkdir -p "$WORK"
cd "$WORK"

sha256_ok() { # <sha256> <file>
  if command -v sha256sum >/dev/null; then
    echo "$1  $2" | sha256sum -c -
  else
    echo "$1  $2" | shasum -a 256 -c -
  fi
}

# ffmpeg.org is sometimes unreachable from CI runners, so fall back to GitHub's
# archive of the same release tag (a different tarball, with its own checksum).
SOURCES=(
  "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz $SHA256"
  "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n$VERSION.tar.gz $GITHUB_SHA256"
)
tarball=""
for source in "${SOURCES[@]}"; do
  url="${source% *}"
  sha="${source##* }"
  file="$(basename "$url")"
  if [ ! -f "$file" ]; then
    echo "→ Downloading $url..."
    if ! curl -fsSL --connect-timeout 20 --retry 3 --retry-all-errors \
      -o "$file.part" "$url"; then
      echo "→ Download failed, trying next source" >&2
      rm -f "$file.part"
      continue
    fi
    mv "$file.part" "$file"
  fi
  if sha256_ok "$sha" "$file"; then
    tarball="$file"
    break
  fi
  rm -f "$file"
done
if [ -z "$tarball" ]; then
  echo "Could not download ffmpeg $VERSION" >&2
  exit 1
fi

src="$WORK/$TRIPLE"
rm -rf "$src"
mkdir -p "$src"
tar -xf "$tarball" -C "$src" --strip-components 1
cd "$src"

echo "→ Configuring for $TRIPLE..."
./configure \
  "${configure_target[@]}" \
  --disable-everything --disable-autodetect --disable-network \
  --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --disable-avdevice \
  --disable-x86asm \
  --enable-zlib \
  --enable-protocol=file,pipe \
  --enable-demuxer=matroska,mov,avi,flv,mpegts,mpegps,asf,ogg \
  --enable-demuxer=image2,image_jpeg_pipe,image_png_pipe,image_webp_pipe,image_tiff_pipe,image_bmp_pipe,gif \
  --enable-decoder=h264,hevc,vp8,vp9,mpeg4,mpeg2video,mpeg1video,msmpeg4v3,wmv3,vc1,theora,prores,mjpeg \
  --enable-decoder=png,webp,tiff,bmp,gif \
  --enable-parser=h264,hevc,vp8,vp9,mpeg4video,mpegvideo,vc1,mjpeg,png,webp,gif \
  --enable-filter=scale,format,null \
  --enable-encoder=png \
  --enable-muxer=image2pipe

echo "→ Building..."
# The target carries the executable suffix: ffmpeg.exe on Windows.
make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" "ffmpeg$EXE"
mkdir -p "$(dirname "$OUT")"
cp "ffmpeg$EXE" "$OUT"
strip "$OUT"
echo "→ Built $OUT ($(du -h "$OUT" | cut -f1))"
