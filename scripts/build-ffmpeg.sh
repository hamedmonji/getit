#!/bin/bash
# Builds the ffmpeg that getit bundles to make thumbnails of videos and images:
# an LGPL build from source with only the demuxers, decoders and PNG encoder
# that needs. Tauri bundles it from src-tauri/binaries/ffmpeg-<target triple>.
#
# Usage: build-ffmpeg.sh [target triple]   (defaults to this machine's)
set -euo pipefail

VERSION=7.1.1
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT="$ROOT_DIR/src-tauri/binaries/ffmpeg-$TRIPLE"
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
  *)
    echo "No ffmpeg build for $TRIPLE yet" >&2
    exit 1
    ;;
esac

mkdir -p "$WORK"
cd "$WORK"
tarball="ffmpeg-$VERSION.tar.xz"
if [ ! -f "$tarball" ]; then
  echo "→ Downloading ffmpeg $VERSION..."
  curl -fsSL -o "$tarball.part" "https://ffmpeg.org/releases/$tarball"
  mv "$tarball.part" "$tarball"
fi
echo "$SHA256  $tarball" | shasum -a 256 -c -

src="$WORK/$TRIPLE"
rm -rf "$src"
mkdir -p "$src"
tar -xJf "$tarball" -C "$src" --strip-components 1
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
make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" ffmpeg
mkdir -p "$(dirname "$OUT")"
cp ffmpeg "$OUT"
strip "$OUT"
echo "→ Built $OUT ($(du -h "$OUT" | cut -f1))"
