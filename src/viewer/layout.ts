// Single-page layout, in CSS px. Pure functions (unit-tested).
import type { PageSize } from "../pdf/protocol";

/** zoom 1 = actual size: 1pt = 1/72in = 96/72 CSS px */
export const PX_PER_PT = 96 / 72;
export const PAD = 16;

export type Viewport = { width: number; height: number };

export type PageLayout = {
  /** CSS px per pt */
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  /** the whole page height is visible: navigation moves page by page */
  fits: boolean;
};

/** The current page, centered; content grows (and scrolls) only where the page is bigger than the viewport. */
export function pageLayout(size: PageSize, zoom: number, viewport: Viewport): PageLayout {
  const scale = zoom * PX_PER_PT;
  const width = size.width * scale;
  const height = size.height * scale;
  const contentWidth = Math.max(viewport.width, width + 2 * PAD);
  const contentHeight = Math.max(viewport.height, height + 2 * PAD);
  return {
    scale,
    width,
    height,
    left: (contentWidth - width) / 2,
    top: (contentHeight - height) / 2,
    contentWidth,
    contentHeight,
    fits: contentHeight <= viewport.height,
  };
}

// 1px of slack so rounding never makes the page overflow and add a scrollbar.
export function fitWidthZoom(size: PageSize, viewport: Viewport): number {
  return (viewport.width - 2 * PAD - 1) / (size.width * PX_PER_PT);
}

export function fitPageZoom(size: PageSize, viewport: Viewport): number {
  return Math.min(fitWidthZoom(size, viewport), (viewport.height - 2 * PAD - 1) / (size.height * PX_PER_PT));
}
