import { describe, expect, it } from "vitest";
import type { Highlight, Quad } from "../pdf/engine/model";
import { highlightAt, pointInQuad, quadsBounds, snapOpacity } from "./highlightStyle";

const RECT: Quad = [10, 10, 90, 10, 10, 22, 90, 22];
// a quad on text rotated 90° (UL, UR, LL, LR still in reading order)
const ROTATED: Quad = [100, 10, 100, 90, 88, 10, 88, 90];

const hl = (id: string, quads: Quad[]): Highlight => ({ id, page: 0, quads, color: [1, 1, 0], opacity: 0.4 });

describe("highlight helpers", () => {
  it("snaps opacity to 10% steps within 10–100%", () => {
    expect(snapOpacity(0.44)).toBe(0.4);
    expect(snapOpacity(0.45)).toBe(0.5);
    expect(snapOpacity(0)).toBe(0.1);
    expect(snapOpacity(1.3)).toBe(1);
  });

  it("tests points against quads in any orientation", () => {
    expect(pointInQuad(RECT, 50, 15)).toBe(true);
    expect(pointInQuad(RECT, 50, 25)).toBe(false);
    expect(pointInQuad(RECT, 5, 15)).toBe(false);
    expect(pointInQuad(ROTATED, 94, 50)).toBe(true);
    expect(pointInQuad(ROTATED, 80, 50)).toBe(false);
  });

  it("finds the topmost highlight under a point", () => {
    const a = hl("a", [RECT]);
    const b = hl("b", [[40, 12, 60, 12, 40, 20, 60, 20]]);
    expect(highlightAt([a, b], 50, 15)?.id).toBe("b");
    expect(highlightAt([a, b], 20, 15)?.id).toBe("a");
    expect(highlightAt([a, b], 20, 40)).toBeNull();
  });

  it("bounds multi-line quads", () => {
    expect(quadsBounds([RECT, [10, 24, 50, 24, 10, 36, 50, 36]])).toEqual([10, 10, 90, 36]);
  });
});
