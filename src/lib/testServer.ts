// The local test server's downloads (test-server/server.py), for filling a
// test queue in development.

/** Where `python3 test-server/server.py` serves by default. */
export const TEST_SERVER = "http://127.0.0.1:8000";

/** What a test queue is named, when the name is free. */
export const TEST_QUEUE_NAME = "Test Queue";

/**
 * The samples, one per file-type icon, at 1.3 MB/s as in the server's README,
 * some answering late to show names being fetched. Keep in step with
 * `SAMPLES` in server.py.
 */
const SAMPLES: [name: string, delay?: number][] = [
  ["report.pdf", 2],
  ["notes.docx", 1],
  ["changelog.md", 3],
  ["README"],
  ["ubuntu-24.04.iso"],
  ["Figma.dmg", 2],
  ["logo-pack.zip"],
  ["repo.tar.gz", 4],
  ["backup.7z"],
  ["node-v22.pkg"],
  ["setup.exe"],
  ["Big Buck Bunny.mp4"],
  ["trailer.mkv"],
  ["hero-01.jpg"],
  ["screenshot.png"],
  ["track-01.mp3"],
  ["field-recordings.flac.zip"],
];

/** Every download the test server has: the samples, then the big files that can and can't resume. */
export function testServerUrls(base: string = TEST_SERVER): string[] {
  return [
    ...SAMPLES.map(
      ([name, delay]) => `${base}/files/${encodeURIComponent(name)}?rate=1300${delay ? `&delay=${delay}` : ""}`,
    ),
    `${base}/resumable.bin`,
    `${base}/non-resumable.bin`,
  ];
}
