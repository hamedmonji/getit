// The list view's filler: plain rows after the real ones, so alternate row
// colours carry on to the bottom of the view, as in Finder.

/**
 * Whether each filler row is striped, for `room` pixels left below
 * `realRows` rows, with filler rows `rowHeight` tall. Enough of them to fill
 * the room, the last cut off; striped where a real row in their place would be
 * (every second one, counting from the first real row).
 */
export function fillerStripes(realRows: number, room: number, rowHeight: number): boolean[] {
  if (room <= 0 || rowHeight <= 0) return [];
  const count = Math.ceil(room / rowHeight);
  return Array.from({ length: count }, (_, i) => (realRows + i) % 2 === 1);
}
