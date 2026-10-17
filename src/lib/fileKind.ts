// Which file-type icon a file gets, from its name. See the FileIcon handoff spec.

export type FileKind = "doc" | "disc" | "archive" | "pkg" | "video" | "image" | "audio";

const KIND_BY_EXT: [FileKind, string[]][] = [
  ["doc", ["PDF", "DOC", "DOCX", "TXT", "MD", "RTF"]],
  ["disc", ["ISO", "DMG", "IMG"]],
  ["archive", ["ZIP", "TAR", "GZ", "TGZ", "RAR", "7Z", "XZ"]],
  ["pkg", ["PKG", "EXE", "MSI", "APP", "DEB", "RPM"]],
  ["video", ["MP4", "MKV", "MOV", "WEBM", "AVI"]],
  ["image", ["JPG", "JPEG", "PNG", "TIF", "TIFF", "WEBP", "GIF", "HEIC"]],
];

/** The icon kind and its label (uppercase, at most 4 characters) for a file name. */
export function resolveKind(name: string): { kind: FileKind; ext: string } {
  const n = name.toLowerCase();
  let ext = n.includes(".") ? n.split(".").pop()!.toUpperCase() : "";
  if (n.endsWith(".tar.gz")) ext = "TGZ";
  // Anywhere in the name, so `album.flac.zip` is still audio.
  if (/\.(flac|mp3|wav|aac)/.test(n)) return { kind: "audio", ext: ext.slice(0, 4) };
  for (const [kind, list] of KIND_BY_EXT) {
    if (list.includes(ext)) return { kind, ext: ext.slice(0, 4) };
  }
  return { kind: "doc", ext: (ext || "FILE").slice(0, 4) };
}

export function isMediaKind(kind: FileKind): boolean {
  return kind === "video" || kind === "image";
}
