# Test server

A local HTTP server for testing the download manager. It uses only the Python standard library.

```sh
python3 test-server/server.py            # http://127.0.0.1:8000
```

| Endpoint | Behaviour |
| --- | --- |
| `/resumable.bin` | 1.2 GB, `Accept-Ranges: bytes`, answers `Range` with `206` + `Content-Range` |
| `/non-resumable.bin` | 1.2 GB, `Accept-Ranges: none`, ignores `Range` and always returns `200` with the full body |
| `/files` | Plain-text list of the sample files' URLs, ready to paste into the app |
| `/files/<name>` | One sample per file-type icon, resumable like `/resumable.bin`, with a matching `Content-Type` |

The samples cover every icon kind in `src/lib/fileKind.ts`:

| Kind | Samples |
| --- | --- |
| doc | `report.pdf` (8 MB, red PDF label), `notes.docx` (3 MB), `changelog.md` (1 MB), `README` (1 MB, no extension, `FILE` label) |
| disc | `ubuntu-24.04.iso` (300 MB), `Figma.dmg` (150 MB) |
| archive | `logo-pack.zip` (60 MB), `repo.tar.gz` (40 MB, `TGZ` label), `backup.7z` (90 MB) |
| pkg | `node-v22.pkg` (80 MB), `setup.exe` (50 MB) |
| video | `Big Buck Bunny.mp4` (250 MB, a name with spaces), `trailer.mkv` (120 MB) |
| image | `hero-01.jpg` (12 MB), `screenshot.png` (6 MB) |
| audio | `track-01.mp3` (9 MB), `field-recordings.flac.zip` (120 MB, audio despite the `.zip`) |

All the samples at 1.3 MB/s (`rate=1300`), to copy and paste into the app together:

```
http://127.0.0.1:8000/files/report.pdf?rate=1300&delay=2
http://127.0.0.1:8000/files/notes.docx?rate=1300&delay=1
http://127.0.0.1:8000/files/changelog.md?rate=1300&delay=3
http://127.0.0.1:8000/files/README?rate=1300
http://127.0.0.1:8000/files/ubuntu-24.04.iso?rate=1300
http://127.0.0.1:8000/files/Figma.dmg?rate=1300&delay=2
http://127.0.0.1:8000/files/logo-pack.zip?rate=1300
http://127.0.0.1:8000/files/repo.tar.gz?rate=1300&delay=4
http://127.0.0.1:8000/files/backup.7z?rate=1300
http://127.0.0.1:8000/files/node-v22.pkg?rate=1300
http://127.0.0.1:8000/files/setup.exe?rate=1300
http://127.0.0.1:8000/files/Big%20Buck%20Bunny.mp4?rate=1300
http://127.0.0.1:8000/files/trailer.mkv?rate=1300
http://127.0.0.1:8000/files/hero-01.jpg?rate=1300
http://127.0.0.1:8000/files/screenshot.png?rate=1300
http://127.0.0.1:8000/files/track-01.mp3?rate=1300
http://127.0.0.1:8000/files/field-recordings.flac.zip?rate=1300
```

Their bytes are the same random data as the `.bin` files, so they won't open; they're for checking icons and progress. Small samples finish in about a second at the default speed; add `?rate=500` to watch an image or video preview fill in.

Each connection is limited to 10 MB/s by default (about 2 minutes per file). The samples are limited the same way. Set the speed per request with the `rate` query parameter, in KB per second (1 KB = 1000 bytes):

```
http://127.0.0.1:8000/resumable.bin?rate=0           # no limit
http://127.0.0.1:8000/resumable.bin?rate=2000        # 2 MB/s, about 10 minutes per file
http://127.0.0.1:8000/non-resumable.bin?rate=2000  # 2 MB/s, about 24 seconds per file
```

The limit applies to each connection, so a download split across several connections goes faster in total.

## Slow answers

Add `delay`, in seconds, to make any file wait that long before answering. That's long enough to
watch "Fetching file name…" in the paste and captured prompts before the name and size come in:

```
http://127.0.0.1:8000/files/report.pdf?delay=3
http://127.0.0.1:8000/files/Big%20Buck%20Bunny.mp4?delay=5&rate=1300
```

Every request waits, including the download's own, so a download split across connections waits
once per connection. getit gives up on the name lookup after 10 seconds, so `delay=10` or more shows
the name from the link instead.

The content is generated on the fly from a fixed seed, so the same offset always holds the same bytes. A resumed download should hash the same as an uninterrupted one.
