// Acrobat-style single-page navigation. Pure logic (unit-tested); the Viewer applies the result.
// A page that fits the viewport moves page by page; a taller page scrolls within itself and
// moves to the neighbouring page once its edge is reached. Nothing is animated.

export const LINE = 48;
export const PAGE_OVERLAP = 40;
const EPS = 0.5;

export type NavState = {
  page: number;
  pageCount: number;
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
  viewportHeight: number;
};

export type Nav = { kind: "scroll"; top: number; left: number } | { kind: "page"; page: number; align: "top" | "bottom" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Result for a navigation key, or null if the key is not a navigation key. */
export function keyNav(key: string, s: NavState): Nav | null {
  const atTop = s.top <= EPS;
  const atBottom = s.top >= s.maxTop - EPS;
  const scrollY = (top: number): Nav => ({ kind: "scroll", top: clamp(top, 0, s.maxTop), left: s.left });
  const scrollX = (left: number): Nav => ({ kind: "scroll", top: s.top, left: clamp(left, 0, s.maxLeft) });
  const next = (): Nav => (s.page < s.pageCount - 1 ? { kind: "page", page: s.page + 1, align: "top" } : scrollY(s.maxTop));
  const prev = (align: "top" | "bottom"): Nav => (s.page > 0 ? { kind: "page", page: s.page - 1, align } : scrollY(0));
  const screen = s.viewportHeight - PAGE_OVERLAP;

  switch (key) {
    case "ArrowDown":
      return atBottom ? next() : scrollY(s.top + LINE);
    case "ArrowUp":
      return atTop ? prev("bottom") : scrollY(s.top - LINE);
    case "PageDown":
      return atBottom ? next() : scrollY(s.top + screen);
    case "PageUp":
      return atTop ? prev("bottom") : scrollY(s.top - screen);
    case "ArrowRight":
      return s.maxLeft > EPS ? scrollX(s.left + LINE) : next();
    case "ArrowLeft":
      return s.maxLeft > EPS ? scrollX(s.left - LINE) : prev("top");
    case "Home":
      return { kind: "page", page: 0, align: "top" };
    case "End":
      return { kind: "page", page: s.pageCount - 1, align: "bottom" };
    default:
      return null;
  }
}

export const BURST_GAP_MS = 150;
export const FLIP_THRESHOLD = 40;

/**
 * Turns a stream of wheel events into page flips. A burst is a run of events less than
 * BURST_GAP_MS apart (one touchpad swipe including its inertia, or one wheel flick).
 * A burst flips at most one page, and only if it started at the page edge, so momentum that
 * scrolls a tall page down to its bottom does not also flip to the next page.
 */
export class WheelPager {
  private last = -Infinity;
  private dir = 0;
  private acc = 0;
  private armed = false;
  private flipped = false;

  /** "native": let the browser scroll; "swallow": preventDefault; 1 / -1: flip to next / previous page. */
  onWheel(dy: number, now: number, atTop: boolean, atBottom: boolean): "native" | "swallow" | 1 | -1 {
    const dir = Math.sign(dy);
    const newBurst = now - this.last > BURST_GAP_MS;
    this.last = now;
    if (dir === 0) return "native";
    const atEdge = dir > 0 ? atBottom : atTop;
    if (newBurst || dir !== this.dir) {
      this.dir = dir;
      this.acc = 0;
      this.flipped = false;
      this.armed = atEdge;
    }
    if (this.flipped) return "swallow";
    if (!atEdge) {
      this.armed = false;
      return "native";
    }
    if (!this.armed) return "swallow";
    this.acc += Math.abs(dy);
    if (this.acc < FLIP_THRESHOLD) return "swallow";
    this.flipped = true;
    return dir > 0 ? 1 : -1;
  }
}
