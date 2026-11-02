// Acrobat-style single-page navigation. Pure logic (unit-tested); the Viewer applies the result.
// A page that fits the viewport moves page by page; a taller page scrolls within itself and
// moves to the neighbouring page once its edge is reached. Nothing is animated.

export const LINE = 48;
export const PAGE_OVERLAP = 40;
/**
 * How close to the end of the scroll range counts as the page edge. scrollTop stops at a
 * fractional device-pixel position (e.g. 58.3 of 59 at 175% scaling), so 0.5 px left pages stuck.
 */
export const EDGE_EPS = 1.5;
const EPS = EDGE_EPS;

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
/** touchpad (smooth) scrolling at the page edge: this much flips a page */
export const SMOOTH_PAGE_PX = 250;

/**
 * Turns wheel events into page flips, like Acrobat's single page view: at the page edge every
 * mouse-wheel notch flips a page, however fast they come, and touchpad scrolling flips a page per
 * SMOOTH_PAGE_PX, so a long swipe goes through several pages. A page taller than the view scrolls
 * natively first. Touchpad momentum that scrolls a tall page to its edge does not flip: a burst
 * (events less than BURST_GAP_MS apart) flips only if it started at the edge. Wheel notches have
 * no momentum, so they flip as soon as the edge is reached.
 */
export class WheelPager {
  private last = -Infinity;
  private dir = 0;
  private acc = 0;
  private armed = false;

  /**
   * `notches`: mouse-wheel notches in this event (0 for touchpad scrolling).
   * Returns "native" (let the browser scroll), "swallow" (preventDefault) or the number of pages
   * to move (negative: back).
   */
  onWheel(dy: number, now: number, atTop: boolean, atBottom: boolean, notches = 0): "native" | "swallow" | number {
    const dir = Math.sign(dy);
    const newBurst = now - this.last > BURST_GAP_MS;
    this.last = now;
    if (dir === 0) return "native";
    const atEdge = dir > 0 ? atBottom : atTop;
    if (newBurst || dir !== this.dir) {
      this.dir = dir;
      this.acc = 0;
      this.armed = atEdge;
    }
    if (!atEdge) {
      this.armed = false;
      this.acc = 0;
      return "native";
    }
    if (notches > 0) return dir * notches;
    if (!this.armed) return "swallow";
    this.acc += Math.abs(dy);
    const pages = Math.floor(this.acc / SMOOTH_PAGE_PX);
    if (pages === 0) return "swallow";
    this.acc -= pages * SMOOTH_PAGE_PX;
    return dir * pages;
  }
}

/** Mouse-wheel notches in a wheel event (0 for touchpad scrolling): the legacy wheelDelta is 120 per notch. */
export function wheelNotches(e: WheelEvent): number {
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0;
  return legacy !== 0 && legacy % 120 === 0 ? Math.abs(legacy) / 120 : 0;
}
