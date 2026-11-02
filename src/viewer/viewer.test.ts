import { describe, expect, it } from "vitest";
import { fitPageZoom, fitWidthZoom, PAD, pageLayout, PX_PER_PT } from "./layout";
import { LruCache } from "./lru";
import { BURST_GAP_MS, keyNav, LINE, PAGE_OVERLAP, SMOOTH_PAGE_PX, WheelPager, type NavState } from "./navigation";
import { bucketScale, MAX_PAGE_PIXELS, parseZoomPercent, renderScale, stepZoom } from "./zoom";

const A4 = { width: 595, height: 842 };
const SLIDE = { width: 720, height: 540 };
const VP = { width: 1000, height: 700 };

describe("layout", () => {
  it("centers a page that fits and does not scroll", () => {
    const l = pageLayout(SLIDE, 0.5, VP);
    expect(l.fits).toBe(true);
    expect(l.contentWidth).toBe(VP.width);
    expect(l.contentHeight).toBe(VP.height);
    expect(l.left + l.width / 2).toBeCloseTo(VP.width / 2);
    expect(l.top + l.height / 2).toBeCloseTo(VP.height / 2);
  });

  it("a taller page scrolls with padding", () => {
    const l = pageLayout(A4, 1, VP);
    expect(l.fits).toBe(false);
    expect(l.top).toBeCloseTo(PAD);
    expect(l.contentHeight).toBeCloseTo(842 * PX_PER_PT + 2 * PAD);
  });

  it("fit width / fit page", () => {
    const zw = fitWidthZoom(SLIDE, VP);
    expect(720 * PX_PER_PT * zw).toBeCloseTo(VP.width - 2 * PAD - 1);
    expect(pageLayout(SLIDE, zw, VP).contentWidth).toBe(VP.width);
    const zp = fitPageZoom(A4, VP);
    const l = pageLayout(A4, zp, VP);
    expect(l.fits).toBe(true);
    expect(l.height).toBeCloseTo(VP.height - 2 * PAD - 1);
  });
});

describe("keyNav", () => {
  const base: NavState = { page: 3, pageCount: 10, top: 0, left: 0, maxTop: 0, maxLeft: 0, viewportHeight: 700 };

  it("moves page by page when the page fits", () => {
    expect(keyNav("ArrowDown", base)).toEqual({ kind: "page", page: 4, align: "top" });
    expect(keyNav("PageDown", base)).toEqual({ kind: "page", page: 4, align: "top" });
    expect(keyNav("ArrowUp", base)).toEqual({ kind: "page", page: 2, align: "bottom" });
    expect(keyNav("PageUp", base)).toEqual({ kind: "page", page: 2, align: "bottom" });
    expect(keyNav("ArrowRight", base)).toEqual({ kind: "page", page: 4, align: "top" });
    expect(keyNav("ArrowLeft", base)).toEqual({ kind: "page", page: 2, align: "top" });
    expect(keyNav("Home", base)).toEqual({ kind: "page", page: 0, align: "top" });
    expect(keyNav("End", base)).toEqual({ kind: "page", page: 9, align: "bottom" });
    expect(keyNav("a", base)).toBeNull();
  });

  it("stays put at the first and last page", () => {
    expect(keyNav("ArrowUp", { ...base, page: 0 })).toEqual({ kind: "scroll", top: 0, left: 0 });
    expect(keyNav("PageDown", { ...base, page: 9 })).toEqual({ kind: "scroll", top: 0, left: 0 });
  });

  it("scrolls within a taller page, then moves at its edge", () => {
    const tall = { ...base, maxTop: 1000 };
    expect(keyNav("ArrowDown", tall)).toEqual({ kind: "scroll", top: LINE, left: 0 });
    expect(keyNav("PageDown", tall)).toEqual({ kind: "scroll", top: 700 - PAGE_OVERLAP, left: 0 });
    expect(keyNav("PageDown", { ...tall, top: 900 })).toEqual({ kind: "scroll", top: 1000, left: 0 });
    expect(keyNav("PageDown", { ...tall, top: 1000 })).toEqual({ kind: "page", page: 4, align: "top" });
    expect(keyNav("ArrowUp", { ...tall, top: 30 })).toEqual({ kind: "scroll", top: 0, left: 0 });
    expect(keyNav("ArrowUp", tall)).toEqual({ kind: "page", page: 2, align: "bottom" });
  });

  it("left/right scroll horizontally when the page is wider", () => {
    expect(keyNav("ArrowRight", { ...base, maxLeft: 300 })).toEqual({ kind: "scroll", top: 0, left: LINE });
  });
});

describe("page edges", () => {
  it("counts a scroll position stopped a fraction of a pixel short as the edge", () => {
    const s: NavState = { page: 0, pageCount: 3, top: 58.3, left: 0, maxTop: 59, maxLeft: 0, viewportHeight: 700 };
    expect(keyNav("ArrowDown", s)).toEqual({ kind: "page", page: 1, align: "top" });
    expect(keyNav("PageDown", s)).toEqual({ kind: "page", page: 1, align: "top" });
  });
});

describe("WheelPager", () => {
  it("flips a page per wheel notch when the page fits, however fast the notches come", () => {
    const p = new WheelPager();
    let t = 0;
    const notch = (n = 1, dir = 1) => p.onWheel(100 * n * dir, (t += 15), true, true, n);
    expect(notch()).toBe(1);
    expect(notch()).toBe(1);
    expect(notch()).toBe(1);
    expect(notch(2)).toBe(2); // two notches in one event
    expect(notch(1, -1)).toBe(-1);
  });

  it("flips a page per SMOOTH_PAGE_PX of touchpad scrolling, several in a long swipe", () => {
    const p = new WheelPager();
    let t = 0;
    const swipe = (dy: number) => p.onWheel(dy, (t += 10), true, true);
    const flips = Array.from({ length: 30 }, () => swipe(25)).filter((r) => typeof r === "number");
    expect(flips).toEqual([1, 1, 1]); // 750px
    t += BURST_GAP_MS + 1;
    expect(swipe(-SMOOTH_PAGE_PX)).toBe(-1);
  });

  it("scrolls a tall page natively; touchpad momentum does not flip at its edge, a notch does", () => {
    const p = new WheelPager();
    let t = 0;
    expect(p.onWheel(50, (t += 10), true, false)).toBe("native");
    // momentum reaches the bottom within the same burst: stop, no flip
    for (let i = 0; i < 20; i++) expect(p.onWheel(50, (t += 10), false, true)).toBe("swallow");
    t += BURST_GAP_MS + 1;
    for (let i = 0; i < 4; i++) expect(p.onWheel(50, (t += 10), false, true)).toBe("swallow");
    expect(p.onWheel(100, (t += 10), false, true)).toBe(1); // a new burst from the edge flips
    // a wheel notch flips as soon as the edge is reached
    expect(p.onWheel(-100, (t += 10), true, false, 1)).toBe(-1);
  });
});

describe("zoom", () => {
  it("steps through presets", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.17, 1)).toBe(1.25);
    expect(stepZoom(1.17, -1)).toBe(1.1);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });

  it("parses typed percentages", () => {
    expect(parseZoomPercent("150")).toBe(1.5);
    expect(parseZoomPercent(" 87.5 % ")).toBe(0.875);
    expect(parseZoomPercent("87,5")).toBe(0.875);
    expect(parseZoomPercent("5000")).toBe(8);
    expect(parseZoomPercent("1")).toBe(0.1);
    expect(parseZoomPercent("abc")).toBeNull();
    expect(parseZoomPercent("")).toBeNull();
    expect(parseZoomPercent("0")).toBeNull();
  });

  it("snaps render scale up to quarter-octave buckets", () => {
    expect(bucketScale(1)).toBeCloseTo(1);
    expect(bucketScale(1.01)).toBeCloseTo(Math.pow(2, 0.25));
    expect(bucketScale(2)).toBeCloseTo(2);
    for (const s of [0.3, 0.77, 1.3, 2.9, 5.5]) {
      expect(bucketScale(s)).toBeGreaterThanOrEqual(s - 1e-9);
      expect(bucketScale(s)).toBeLessThan(s * Math.pow(2, 0.25) + 1e-9);
    }
  });

  it("caps page pixels", () => {
    const s = renderScale(595, 842, 20);
    expect(595 * 842 * s * s).toBeLessThanOrEqual(MAX_PAGE_PIXELS + 1);
    expect(renderScale(595, 842, 1.5)).toBeCloseTo(bucketScale(1.5));
  });
});

describe("LruCache", () => {
  it("evicts least recently used entries over budget, skipping pinned ones", () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>(3, (k) => evicted.push(k));
    c.set("a", 1, 1);
    c.set("b", 2, 1);
    c.set("c", 3, 1);
    c.get("a");
    c.set("d", 4, 1);
    expect(evicted).toEqual(["b"]);
    c.set("e", 5, 2, (k) => k === "c");
    expect(evicted).toEqual(["b", "a", "d"]);
    expect(c.keys()).toEqual(["c", "e"]);
    expect(c.cost).toBe(3);
  });

  it("replacing a key evicts the old value", () => {
    const evicted: number[] = [];
    const c = new LruCache<string, number>(10, (_k, v) => evicted.push(v));
    c.set("a", 1, 1);
    c.set("a", 2, 1);
    expect(evicted).toEqual([1]);
    expect(c.peek("a")).toBe(2);
    c.clear();
    expect(evicted).toEqual([1, 2]);
    expect(c.size).toBe(0);
  });
});
