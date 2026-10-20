#!/usr/bin/env python3
"""Local test server for exercising the download manager.

Endpoints:
  GET /resumable.bin       1.2 GB file, supports Range requests (206 / resume)
  GET /non-resumable.bin   1.2 GB file, ignores Range and always sends 200 in full
  GET /files               plain-text list of the sample files' URLs
  GET /files/<name>        a sample of each file type the app draws an icon for
                           (pdf, docx, iso, zip, mp4, jpg, flac, ...), with Range

The content is generated on the fly from a fixed 1 MiB block, so nothing is
stored on disk and the bytes at any offset are always the same. A resumed
download can therefore be checked against a fresh one.

Usage: python3 server.py [--port 8000] [--size BYTES]

Each connection is throttled to 10 MB/s by default (about 2 minutes per file).
Pass ?rate=KB_PER_SEC (1 KB = 1000 bytes) on any file to change it, or ?rate=0 for no limit.
Pass ?delay=SECONDS on any file to wait that long before answering, to watch the
app while it looks up a file's name and size.
"""

import argparse
import random
import re
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BLOCK_SIZE = 1024 * 1024
BLOCK = random.Random(42).randbytes(BLOCK_SIZE) if hasattr(random.Random, "randbytes") \
    else bytes(random.Random(42).getrandbits(8) for _ in range(BLOCK_SIZE))

DEFAULT_RATE = 10 * 1000 ** 2
CONFIG = {"size": int(1.2 * 1000 ** 3)}
MB = 1000 ** 2

# One sample per icon kind (see src/lib/fileKind.ts), plus a few edge cases.
# All support Range. The bytes are the same random data as the .bin files;
# only the name, size and Content-Type differ.
SAMPLES = {
    # doc
    "report.pdf": (8 * MB, "application/pdf"),
    "notes.docx": (3 * MB, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "changelog.md": (1 * MB, "text/markdown"),
    "README": (1 * MB, "application/octet-stream"),  # no extension: FILE label
    # disc
    "ubuntu-24.04.iso": (300 * MB, "application/x-iso9660-image"),
    "Figma.dmg": (150 * MB, "application/x-apple-diskimage"),
    # archive
    "logo-pack.zip": (60 * MB, "application/zip"),
    "repo.tar.gz": (40 * MB, "application/gzip"),  # TGZ label
    "backup.7z": (90 * MB, "application/x-7z-compressed"),
    # pkg
    "node-v22.pkg": (80 * MB, "application/octet-stream"),
    "setup.exe": (50 * MB, "application/vnd.microsoft.portable-executable"),
    # video
    "Big Buck Bunny.mp4": (250 * MB, "video/mp4"),
    "trailer.mkv": (120 * MB, "video/x-matroska"),
    # image
    "hero-01.jpg": (12 * MB, "image/jpeg"),
    "screenshot.png": (6 * MB, "image/png"),
    # audio
    "track-01.mp3": (9 * MB, "audio/mpeg"),
    "field-recordings.flac.zip": (120 * MB, "application/zip"),  # audio, not archive
}


def iter_bytes(start, end):
    """Yield the bytes of the virtual file from start to end, inclusive."""
    pos = start
    while pos <= end:
        offset = pos % BLOCK_SIZE
        n = min(BLOCK_SIZE - offset, end - pos + 1)
        yield BLOCK[offset:offset + n]
        pos += n


def parse_range(header, size):
    """Return (start, end) for a single 'bytes=' range, or None if invalid."""
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not m or (m.group(1) == "" and m.group(2) == ""):
        return None
    if m.group(1) == "":
        length = int(m.group(2))
        if length == 0:
            return None
        return max(0, size - length), size - 1
    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else size - 1
    if start >= size or end < start:
        return None
    return start, min(end, size - 1)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_HEAD(self):
        self.handle_request(send_body=False)

    def do_GET(self):
        self.handle_request(send_body=True)

    def handle_request(self, send_body):
        url = urlsplit(self.path)
        if url.path.rstrip("/") == "/files":
            base = f"http://{self.headers.get('Host', '127.0.0.1')}/files/"
            self.send_text(200, "".join(base + quote(name) + "\n" for name in SAMPLES), send_body)
            return
        sample = None
        if url.path.startswith("/files/"):
            name = unquote(url.path[len("/files/"):])
            if name not in SAMPLES:
                self.send_text(404, "No such sample; see /files\n", send_body)
                return
            sample = (name, *SAMPLES[name])
        elif url.path not in ("/resumable.bin", "/non-resumable.bin"):
            self.send_text(404, "Try /resumable.bin, /non-resumable.bin or /files\n", send_body)
            return
        rate_values = parse_qs(url.query).get("rate")
        if rate_values is None:
            rate = DEFAULT_RATE
        elif rate_values[0].isdigit():
            rate = int(rate_values[0]) * 1000
        else:
            self.send_text(400, "rate must be a whole number of KB per second\n", send_body)
            return
        delay_values = parse_qs(url.query).get("delay")
        if delay_values is not None:
            try:
                delay = float(delay_values[0])
            except ValueError:
                delay = -1
            if not 0 <= delay <= 60:
                self.send_text(400, "delay must be a number of seconds from 0 to 60\n", send_body)
                return
            time.sleep(delay)
        if sample:
            name, size, content_type = sample
            self.serve(name, size, content_type, True, rate, send_body)
        else:
            resumable = url.path == "/resumable.bin"
            self.serve(url.path.lstrip("/"), CONFIG["size"], "application/octet-stream", resumable, rate, send_body)

    def send_text(self, status, text, send_body):
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def serve(self, name, size, content_type, resumable, rate, send_body):
        start, end = 0, size - 1
        status = 200

        range_header = self.headers.get("Range")
        if resumable and range_header:
            parsed = parse_range(range_header, size)
            if parsed is None:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            start, end = parsed
            status = 206

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{name}"')
        self.send_header("Content-Length", str(end - start + 1))
        if resumable:
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", f'"test-{quote(name)}-{size}"')
            self.send_header("Last-Modified", "Thu, 01 Jan 2026 00:00:00 GMT")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_header("Accept-Ranges", "none")
        self.end_headers()

        if not send_body:
            return
        began = time.monotonic()
        sent = 0
        try:
            for chunk in iter_bytes(start, end):
                for i in range(0, len(chunk), 64 * 1024):
                    piece = chunk[i:i + 64 * 1024]
                    self.wfile.write(piece)
                    sent += len(piece)
                    if rate:
                        ahead = sent / rate - (time.monotonic() - began)
                        if ahead > 0:
                            time.sleep(ahead)
        except (BrokenPipeError, ConnectionResetError):
            self.log_message("client disconnected after %d bytes", sent)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--size", type=int, default=CONFIG["size"], help="file size in bytes (default 1.2 GB)")
    args = parser.parse_args()
    CONFIG["size"] = args.size

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving on http://127.0.0.1:{args.port}")
    print(f"  /resumable.bin       {args.size} bytes, Range supported")
    print(f"  /non-resumable.bin   {args.size} bytes, Range ignored")
    print(f"  /files               {len(SAMPLES)} samples, one per file type (lists their URLs)")
    print(f"  add ?rate=KB_PER_SEC to change the {DEFAULT_RATE // 1000} KB/s default, ?rate=0 for no limit")
    print("  add ?delay=SECONDS to wait before answering, e.g. to watch the name being fetched")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
