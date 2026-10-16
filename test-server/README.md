# Test server

A local HTTP server for testing the download manager. It uses only the Python standard library.

```sh
python3 test-server/server.py            # http://127.0.0.1:8000
```

| Endpoint | Behaviour |
| --- | --- |
| `/resumable.bin` | 1.2 GB, `Accept-Ranges: bytes`, answers `Range` with `206` + `Content-Range` |
| `/non-resumable.bin` | 1.2 GB, `Accept-Ranges: none`, ignores `Range` and always returns `200` with the full body |

Each connection is limited to 10 MB/s by default (about 2 minutes per file). Set the speed per request with the `rate` query parameter, in KB per second (1 KB = 1000 bytes):

```
http://127.0.0.1:8000/resumable.bin?rate=0           # no limit
http://127.0.0.1:8000/resumable.bin?rate=2000        # 2 MB/s, about 10 minutes per file
http://127.0.0.1:8000/non-resumable.bin?rate=50000  # 50 MB/s, about 24 seconds per file
```

The limit applies to each connection, so a download split across several connections goes faster in total.

The content is generated on the fly from a fixed seed, so the same offset always holds the same bytes. A resumed download should hash the same as an uninterrupted one.
