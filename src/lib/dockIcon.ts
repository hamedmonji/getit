import { invoke } from "@tauri-apps/api/core";
import type { DockOverlayLayout } from "./dock";

/** The overlay's side in pixels: the Dock shows icons at up to 256 px when magnified on Retina screens. */
const SIDE = 512;

function roundRect(ctx: CanvasRenderingContext2D, r: { x: number; y: number; width: number; height: number }) {
  ctx.beginPath();
  ctx.roundRect(r.x * SIDE, r.y * SIDE, r.width * SIDE, r.height * SIDE, (Math.min(r.width, r.height) * SIDE) / 2);
  ctx.fill();
}

/** Draws `layout` on a transparent square, as PNG bytes. */
async function drawOverlay(layout: DockOverlayLayout): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
  ctx.beginPath();
  const p = layout.panel;
  ctx.roundRect(p.x * SIDE, p.y * SIDE, p.width * SIDE, p.height * SIDE, 0.1 * SIDE);
  ctx.fill();
  if (layout.text) {
    const { value, x, y, size, maxWidth } = layout.text;
    ctx.font = `600 ${size * SIDE}px -apple-system, system-ui, sans-serif`;
    const fit = Math.min(1, (maxWidth * SIDE) / ctx.measureText(value).width);
    ctx.font = `600 ${size * SIDE * fit}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value, x * SIDE, y * SIDE);
  }
  if (layout.bar) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    roundRect(ctx, layout.bar.track);
    if (layout.bar.fill.width > 0) {
      ctx.fillStyle = "white";
      roundRect(ctx, layout.bar.fill);
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob!.arrayBuffer());
}

/** Shows `layout` over the Dock icon, or the plain icon when it's null. */
export async function showDockOverlay(layout: DockOverlayLayout | null): Promise<void> {
  if (layout === null) return invoke("set_dock_overlay");
  return invoke("set_dock_overlay", await drawOverlay(layout));
}
