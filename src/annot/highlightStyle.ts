// Highlight colors, opacity steps and quad geometry. Pure (unit-tested).
import type { Highlight, Quad, RGB } from "../pdf/engine/model";

export type HighlightStyle = { color: RGB; opacity: number };

/** cyan = the color used in the user's Acrobat highlights; yellow = Acrobat's usual default */
export const HIGHLIGHT_COLORS: { name: string; color: RGB }[] = [
  { name: "청록", color: [0.219604, 0.898041, 1] },
  { name: "노랑", color: [1, 0.819611, 0] },
  { name: "연두", color: [0.55, 0.9, 0.35] },
  { name: "분홍", color: [1, 0.5, 0.75] },
  { name: "주황", color: [1, 0.65, 0.25] },
];

export const DEFAULT_HIGHLIGHT: HighlightStyle = { color: HIGHLIGHT_COLORS[0]!.color, opacity: 0.4 };

/** Opacity snaps to 10% steps between 10% and 100%. */
export const snapOpacity = (v: number) => Math.min(1, Math.max(0.1, Math.round(v * 10) / 10));

const cross = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

/** Point inside a (convex) quad given as UL, UR, LL, LR. */
export function pointInQuad(q: Quad, x: number, y: number): boolean {
  // walk the outline UL -> UR -> LR -> LL: all turns on the same side
  const pts: [number, number][] = [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[(i + 1) % 4]!;
    const c = cross(ax, ay, bx, by, x, y);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** The topmost highlight (last drawn) under a page-space point. */
export function highlightAt(highlights: Highlight[], x: number, y: number): Highlight | null {
  for (let i = highlights.length - 1; i >= 0; i--) {
    if (highlights[i]!.quads.some((q) => pointInQuad(q, x, y))) return highlights[i]!;
  }
  return null;
}

/** Axis-aligned bounds [x0, y0, x1, y1] of some quads. */
export function quadsBounds(quads: Quad[]): [number, number, number, number] {
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
