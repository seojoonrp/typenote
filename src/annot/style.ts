// Text box styling and geometry helpers. Pure (unit-tested) apart from the CSS objects.
import type { CSSProperties } from "react";
import type { Face } from "../pdf/engine/faces";
import { PAD, type Layout } from "../pdf/engine/layout";
import type { RGB, Weight } from "../pdf/engine/model";
import { FONT_FAMILY } from "./fonts";

export type BoxStyle = { size: number; weight: Weight; color: RGB };

export const DEFAULT_STYLE: BoxStyle = { size: 12, weight: "regular", color: [0, 0, 0] };
export const SIZE_PRESETS = [10, 12, 14, 18, 24];
/** what the stepper / Ctrl+Shift+. walks through (the spec presets plus room at both ends) */
export const SIZE_STEPS = [6, 8, 10, 12, 14, 18, 24, 30, 36, 48, 72];
export const MIN_SIZE = 4;
export const MAX_SIZE = 200;

export const COLOR_PRESETS: { name: string; color: RGB }[] = [
  { name: "검정", color: [0, 0, 0] },
  { name: "파랑", color: [0.05, 0.3, 0.85] },
  { name: "빨강", color: [0.85, 0.12, 0.12] },
  { name: "초록", color: [0.1, 0.55, 0.2] },
  { name: "보라", color: [0.45, 0.15, 0.65] },
];

export const clampSize = (s: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(s * 10) / 10));

/** Next step above (dir 1) or below (dir -1) the current size. */
export function stepSize(size: number, dir: 1 | -1): number {
  if (dir > 0) return SIZE_STEPS.find((s) => s > size + 1e-6) ?? clampSize(size + 12);
  return [...SIZE_STEPS].reverse().find((s) => s < size - 1e-6) ?? clampSize(Math.max(MIN_SIZE, size - 1));
}

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");
export const rgbToHex = (c: RGB) => `#${c.map(hex2).join("")}`;
export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [m[1], m[2], m[3]].map((h) => Math.round((parseInt(h!, 16) / 255) * 1000) / 1000) as RGB;
}
export const sameColor = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]!) < 0.002);
export const cssColor = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`;

/** Line height in pt for a style (same formula as the appearance stream). */
export function lineHeightOf(face: Face, size: number): number {
  const t = face.ttf;
  return ((t.hhea.ascender - t.hhea.descender + t.hhea.lineGap) * size) / t.unitsPerEm;
}

/**
 * Top-left of a new box so that its first line is vertically centred on the click and the text
 * starts right at it (like Acrobat's typewriter caret).
 */
export function newBoxOrigin(click: { x: number; y: number }, face: Face, size: number): { x: number; y: number } {
  return { x: Math.max(0, click.x - PAD), y: Math.max(0, click.y - PAD - lineHeightOf(face, size) / 2) };
}

/** CSS for text that must line up with the appearance stream: same font, size, line height. */
export function textCss(layout: Layout, style: BoxStyle, scale: number): CSSProperties {
  return {
    fontFamily: FONT_FAMILY,
    fontWeight: style.weight === "semibold" ? 600 : 400,
    fontSize: `${style.size * scale}px`,
    lineHeight: `${layout.lineHeight * scale}px`,
    padding: `${PAD * scale}px`,
    color: cssColor(style.color),
    fontKerning: "none",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"kern" 0, "liga" 0, "calt" 0',
    fontSynthesis: "none",
    whiteSpace: "pre",
  };
}
