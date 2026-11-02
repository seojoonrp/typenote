// Zoom levels and render-resolution buckets. Pure functions (unit-tested).

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];

/** Largest bitmap rendered for one page (pixels). Beyond this, deep zoom gets softer. */
export const MAX_PAGE_PIXELS = 12_000_000;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** "150", "150%", " 87.5 % " -> zoom factor (clamped); null if not a number. */
export function parseZoomPercent(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  if (!m) return null;
  const pct = parseFloat(m[1]!.replace(",", "."));
  return pct > 0 ? clampZoom(pct / 100) : null;
}

/** Next preset step above (dir 1) or below (dir -1) the current zoom. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-3;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - eps) ?? MIN_ZOOM;
}

/** Render scales snap up to 2^(k/4) so small zoom changes reuse the cache and stay sharp. */
export function bucketScale(scale: number): number {
  const k = Math.ceil(Math.log2(scale) * 4 - 1e-9);
  return Math.pow(2, k / 4);
}

/** Device pixels per pt to render a page at, capped by MAX_PAGE_PIXELS. */
export function renderScale(pageWidthPt: number, pageHeightPt: number, wantedScale: number): number {
  const bucket = bucketScale(wantedScale);
  const cap = Math.sqrt(MAX_PAGE_PIXELS / (pageWidthPt * pageHeightPt));
  return Math.min(bucket, cap);
}
