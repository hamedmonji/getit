import { useId } from "react";
import type { FileKind } from "../lib/fileKind";

// Ported from the FileIcon handoff (file-icon.js). Geometry and colours are the
// spec; everything is drawn in a 64 x 64 viewBox and scales to its box.

const MONO = { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 700 };
const REVEAL_TRANSITION = "height .4s linear, y .4s linear";
const SPROCKETS = [14, 22, 30, 38, 46];
const TEETH = [8, 12, 16, 20, 24, 28];
const BARS = [
  [15, 27, 10],
  [21, 21, 22],
  [27, 15, 34],
  [33, 23, 18],
  [39, 18, 28],
  [45, 26, 12],
];

function typeColors(kind: FileKind, ext: string) {
  const hue = { doc: ext === "PDF" ? 25 : 250, disc: 245, archive: 75, pkg: 55, audio: 300 }[kind as string] ?? 250;
  const c = kind === "disc" ? 0.04 : 0.13;
  return {
    c1: `oklch(0.58 ${c} ${hue})`,
    c2: `oklch(0.70 ${c} ${hue})`,
    c3: `oklch(0.92 ${c * 0.4} ${hue})`,
    sheen: [`oklch(0.94 0.02 ${hue})`, `oklch(0.80 0.03 ${(hue + 60) % 360})`, `oklch(0.90 0.03 ${(hue + 140) % 360})`],
  };
}

/** Placeholder preview for media, seeded per file. */
function thumbStops(hue: number): string[] {
  return [`oklch(0.80 0.09 ${hue})`, `oklch(0.58 0.12 ${(hue + 35) % 360})`, `oklch(0.38 0.08 ${(hue + 60) % 360})`];
}

export interface FileIconProps {
  kind: FileKind;
  /** Uppercase, at most 4 characters. Shown on doc, disc, archive and pkg. */
  ext: string;
  /** 0–100, media only: how much of the preview has arrived. */
  reveal?: number;
  /** Scan line at the reveal boundary, while actively downloading. */
  edge?: boolean;
  /** Seed for the media placeholder gradient. */
  hue?: number;
  /** Hide the extension label, for sizes too small to read it. */
  hideLabel?: boolean;
}

/** A file-type icon that fills its box. Images and videos fill in top-down as they download. */
export function FileIcon({ kind, ext, reveal = 100, edge = false, hue = 240, hideLabel = false }: FileIconProps) {
  // Gradient ids must be unique per icon; the same file can show in two places.
  const uid = useId().replace(/[^\w-]/g, "");
  const t = typeColors(kind, ext);
  const r = Math.max(0, Math.min(100, reveal)) / 100;
  const label = hideLabel ? "" : ext;
  const labelW = Math.max(22, ext.length * 6 + 10);
  const pillW = Math.max(20, ext.length * 5.5 + 9);
  const thumbId = `tg${uid}`;

  const thumbGradient = (
    <linearGradient id={thumbId} gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="40" y2="60">
      {thumbStops(hue).map((color, i) => (
        <stop key={i} offset={[0, 0.6, 1][i]} stopColor={color} />
      ))}
    </linearGradient>
  );
  // The preview fills `h` from the top of the window at (x, y, w, h).
  const preview = (x: number, y: number, w: number, h: number, edgeOpacity: number) => (
    <>
      <rect x={x} y={y} width={w} fill={`url(#${thumbId})`} style={{ height: h * r, transition: REVEAL_TRANSITION }} />
      {edge && r < 1 && (
        <rect x={x} width={w} height={0.8} fill="#fff" opacity={edgeOpacity} style={{ y: y + h * r, transition: REVEAL_TRANSITION }} />
      )}
    </>
  );

  let body;
  switch (kind) {
    case "doc":
      body = (
        <>
          <path
            d="M15 4h24l13 13v41a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            fill="var(--panel)"
            stroke="var(--muted)"
            strokeOpacity={0.35}
            strokeWidth={1.2}
          />
          <path
            d="M39 4v11a2 2 0 0 0 2 2h11"
            fill="var(--panel2)"
            stroke="var(--muted)"
            strokeOpacity={0.35}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <rect x={19} y={23} width={20} height={2.2} rx={1.1} fill="var(--track)" />
          <rect x={19} y={28.5} width={26} height={2.2} rx={1.1} fill="var(--track)" />
          <rect x={19} y={34} width={22} height={2.2} rx={1.1} fill="var(--track)" />
          <rect x={7} y={42} width={labelW} height={13} rx={3} fill={t.c1} />
          <text x={7 + labelW / 2} y={51.3} textAnchor="middle" fill="#fff" fontSize={8} style={MONO}>
            {label}
          </text>
        </>
      );
      break;
    case "disc":
      body = (
        <>
          <defs>
            <linearGradient id={`sg${uid}`} x1="0" y1="0" x2="1" y2="1">
              {t.sheen.map((color, i) => (
                <stop key={i} offset={[0, 0.5, 1][i]} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
          <circle cx={32} cy={31} r={27} fill={`url(#sg${uid})`} stroke="var(--muted)" strokeOpacity={0.3} />
          <circle cx={32} cy={31} r={20} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.8} />
          <circle cx={32} cy={31} r={14} fill="none" stroke="#fff" strokeOpacity={0.25} strokeWidth={0.8} />
          <path d="M32 31L14 12A27 27 0 0 1 27 4.5z" fill="#fff" opacity={0.35} />
          <circle cx={32} cy={31} r={8} fill="var(--panel)" stroke="var(--muted)" strokeOpacity={0.3} />
          <circle cx={32} cy={31} r={3} fill={t.c1} opacity={0.6} />
          <rect x={32 - pillW / 2} y={52} width={pillW} height={11} rx={5.5} fill={t.c1} />
          <text x={32} y={60.2} textAnchor="middle" fill="#fff" fontSize={7.5} style={MONO}>
            {label}
          </text>
        </>
      );
      break;
    case "archive":
      body = (
        <>
          <rect x={11} y={5} width={42} height={55} rx={5} fill={t.c3} stroke={t.c1} strokeOpacity={0.5} />
          <rect x={29} y={5} width={6} height={30} fill={t.c2} opacity={0.5} />
          {TEETH.map((y, i) => (
            <rect key={y} x={i % 2 ? 32.5 : 27.5} y={y} width={4} height={2.6} rx={0.8} fill={t.c1} />
          ))}
          <rect x={27} y={33} width={10} height={13} rx={2.5} fill={t.c1} />
          <rect x={30} y={38} width={4} height={5} rx={1.5} fill={t.c3} />
          <text x={32} y={56.2} textAnchor="middle" fill={t.c1} fontSize={7.5} style={MONO}>
            {label}
          </text>
        </>
      );
      break;
    case "pkg":
      body = (
        <>
          <path d="M32 7l23 11.5-23 11.5L9 18.5z" fill={t.c3} stroke={t.c1} strokeOpacity={0.45} strokeLinejoin="round" />
          <path d="M9 18.5L32 30v28L9 46.5z" fill={t.c2} stroke={t.c1} strokeOpacity={0.45} strokeLinejoin="round" />
          <path d="M55 18.5L32 30v28l23-11.5z" fill={t.c1} stroke={t.c1} strokeOpacity={0.45} strokeLinejoin="round" />
          <path d="M20.5 12.75L43.5 24.25v8" fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={3.2} />
          <text
            x={20.5}
            y={42.7}
            textAnchor="middle"
            fill="#fff"
            fontSize={7.5}
            style={MONO}
            transform="rotate(26 20.5 40)"
          >
            {label}
          </text>
        </>
      );
      break;
    case "video":
      body = (
        <>
          <defs>{thumbGradient}</defs>
          <rect x={3} y={11} width={58} height={42} rx={5} fill="#1d1d1b" />
          <rect x={10} y={15} width={44} height={34} rx={1.5} fill="#fff" opacity={0.1} />
          {preview(10, 15, 44, 34, 0.9)}
          {SPROCKETS.map((y) => (
            <g key={y} fill="#fff" opacity={0.55}>
              <rect x={4.5} y={y} width={3.5} height={4} rx={0.8} />
              <rect x={56} y={y} width={3.5} height={4} rx={0.8} />
            </g>
          ))}
          {r >= 1 && <path d="M28 25.5v13l11-6.5z" fill="#fff" opacity={0.9} />}
        </>
      );
      break;
    case "image":
      body = (
        <>
          <defs>{thumbGradient}</defs>
          <rect
            x={12}
            y={9}
            width={44}
            height={46}
            rx={2.5}
            fill="#fff"
            stroke="rgba(0,0,0,.12)"
            transform="rotate(7 34 32)"
            opacity={0.75}
          />
          <g transform="rotate(-4 32 32)">
            <rect x={8} y={7} width={46} height={50} rx={2.5} fill="#fff" stroke="rgba(0,0,0,.14)" />
            <rect x={12} y={11} width={38} height={36} fill="#000" opacity={0.08} />
            {preview(12, 11, 38, 36, 1)}
          </g>
        </>
      );
      break;
    case "audio":
      body = (
        <>
          <rect x={7} y={7} width={50} height={50} rx={13} fill={t.c3} stroke={t.c1} strokeOpacity={0.4} />
          {BARS.map(([x, y, h]) => (
            <rect key={x} x={x} y={y} width={3.5} height={h} rx={1.75} fill={t.c1} />
          ))}
        </>
      );
      break;
  }

  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" style={{ display: "block", overflow: "visible" }} aria-hidden>
      {body}
    </svg>
  );
}
