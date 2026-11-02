import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { makeFaces } from "../pdf/engine/faces";
import { caretIndexAt, layoutText, PAD } from "../pdf/engine/layout";
import { hexToRgb, lineHeightOf, newBoxOrigin, rgbToHex, stepSize } from "./style";

const faces = makeFaces({
  regular: new Uint8Array(fs.readFileSync("fonts/Pretendard-Regular.ttf")),
  semibold: new Uint8Array(fs.readFileSync("fonts/Pretendard-SemiBold.ttf")),
});

describe("text box style helpers", () => {
  it("steps sizes through the presets", () => {
    expect(stepSize(12, 1)).toBe(14);
    expect(stepSize(12, -1)).toBe(10);
    expect(stepSize(13, 1)).toBe(14);
    expect(stepSize(13, -1)).toBe(12);
    expect(stepSize(72, 1)).toBe(84);
    expect(stepSize(6, -1)).toBe(5);
    expect(stepSize(4, -1)).toBe(4);
  });

  it("round-trips colors through hex", () => {
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
    expect(rgbToHex([1, 0.5, 0])).toBe("#ff8000");
    expect(hexToRgb("#0d4dd9")).toEqual([0.051, 0.302, 0.851]);
    expect(rgbToHex(hexToRgb("#3a7bc8"))).toBe("#3a7bc8");
  });

  it("puts a new box's first line centred on the click", () => {
    const f = faces.regular;
    const o = newBoxOrigin({ x: 100, y: 200 }, f, 12);
    expect(o.x).toBe(100 - PAD);
    const l = layoutText("가", f, 12);
    expect(o.y + PAD + l.lineHeight / 2).toBeCloseTo(200);
    expect(lineHeightOf(f, 12)).toBeCloseTo(l.lineHeight);
    expect(newBoxOrigin({ x: 0, y: 0 }, f, 12)).toEqual({ x: 0, y: 0 });
  });

  it("main-thread layout matches the engine's box size", () => {
    // the same function lays out the appearance stream, so this pins the shared formula
    const l = layoutText("한글 Abc\n둘째 줄이 더 깁니다", faces.semibold, 18);
    expect(l.lines).toHaveLength(2);
    expect(l.height).toBeCloseTo(2 * l.lineHeight + 2 * PAD);
    expect(l.width).toBeCloseTo(Math.max(l.lines[0]!.width, l.lines[1]!.width) + 2 * PAD);
  });
});

describe("caret position from a click", () => {
  it("picks the line under the point and the nearest character boundary", () => {
    const f = faces.regular;
    const text = "가나다 AB\n둘째 줄";
    const l = layoutText(text, f, 20, -0.03);
    const w = (s: string) => layoutText(s, f, 20, -0.03).lines[0]!.width;
    const y1 = PAD + l.lineHeight / 2;
    const y2 = PAD + l.lineHeight * 1.5;
    expect(caretIndexAt(l, f, 20, 0, y1)).toBe(0);
    expect(caretIndexAt(l, f, 20, PAD + w("가") * 0.4, y1)).toBe(0);
    expect(caretIndexAt(l, f, 20, PAD + w("가") * 0.6, y1)).toBe(1);
    expect(caretIndexAt(l, f, 20, PAD + w("가나다 A") + 1, y1)).toBe(5);
    expect(caretIndexAt(l, f, 20, 999, y1)).toBe(6); // past the end of line 1
    expect(caretIndexAt(l, f, 20, PAD + w("둘") + 1, y2)).toBe(7 + 1); // "가나다 AB\n" is 7 long
    expect(caretIndexAt(l, f, 20, 0, 999)).toBe(7); // below the last line: its start
  });
});
