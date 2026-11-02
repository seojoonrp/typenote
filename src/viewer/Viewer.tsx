// Single-page viewer (Acrobat "Single Page" view): one page at a time, page-by-page navigation
// when the page fits, scrolling within the page when it is taller. Worker-rendered bitmaps,
// Ctrl+wheel / touchpad-pinch zoom previewed with a CSS transform and committed when it settles.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { PdfClient } from "../pdf/client";
import type { DocInfo, HiddenAnnots } from "../pdf/protocol";
import { DocScrollbar } from "./DocScrollbar";
import { isPinch } from "./input";
import { fitPageZoom, fitWidthZoom, PX_PER_PT, pageLayout, type PageLayout } from "./layout";
import { keyNav, LINE, WheelPager, type Nav } from "./navigation";
import { RenderCache, type Want } from "./renderCache";
import { clampZoom, renderScale, stepZoom } from "./zoom";

// App text boxes and all highlights are drawn by the HTML overlay, not the base bitmap.
const HIDDEN: HiddenAnnots = { textBoxes: true, highlights: true };
/** pages rendered besides the current one, so flipping shows them at once */
const PREFETCH = [1, 2, -1];
const GESTURE_SETTLE_MS = 180;

export type ZoomMode = "fit-page" | "fit-width" | "custom";

/** The current page as the overlay sees it: its index and CSS px per pt. */
export type PageView = { page: number; scale: number };

export type ViewerHandle = {
  zoomIn(): void;
  zoomOut(): void;
  setZoom(zoom: number): void;
  setMode(mode: "fit-page" | "fit-width"): void;
  goTo(page: number): void;
  /** the pages' content changed (annotation edits): render them again */
  invalidatePages(pages: number[]): void;
  focus(): void;
};

type Props = {
  client: PdfClient;
  doc: DocInfo;
  ref?: Ref<ViewerHandle>;
  /** page shown first (a tab shown again comes back to its page) */
  initialPage?: number;
  initialMode: ZoomMode;
  initialZoom: number;
  onPageChange(page: number): void;
  onZoomChange(zoom: number, mode: ZoomMode): void;
  /** drawn over the page bitmap, in page CSS px (page space × scale) */
  overlay?: (view: PageView) => ReactNode;
  /** a press in the gray area around the page */
  onOutsidePage?: () => void;
};

type Anchor = { xPt: number; yPt: number; ax: number; ay: number };
type Gesture = { startZoom: number; factor: number; ax: number; ay: number; timer: number };

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

export function Viewer({ client, doc, ref, initialPage = 0, initialMode, initialZoom, onPageChange, onZoomChange, overlay, onOutsidePage }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [page, setPage] = useState(initialPage);
  const [mode, setMode] = useState<ZoomMode>(initialMode);
  const [customZoom, setCustomZoom] = useState(clampZoom(initialZoom));
  const [, setVersion] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const navRef = useRef<"top" | "bottom" | null>(null);
  /** after a page change from the document scrollbar: how far down the new page to scroll */
  const seekRef = useRef<number | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 1, client: 1 });
  const anchorRef = useRef<Anchor | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pager = useMemo(() => new WheelPager(), []);

  // re-render when bitmaps arrive, at most once per frame
  const bump = useRef(0);
  const cache = useMemo(
    () =>
      new RenderCache(
        client,
        () => {
          if (bump.current) return;
          bump.current = requestAnimationFrame(() => {
            bump.current = 0;
            setVersion((v) => v + 1);
          });
        },
        HIDDEN,
      ),
    [client],
  );
  useEffect(() => {
    cache.setDoc(doc.docId);
    return () => cache.dispose();
  }, [cache, doc.docId]);

  // viewport size and device pixel ratio
  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const measure = () => {
      setViewport((v) => (v.width === el.clientWidth && v.height === el.clientHeight ? v : { width: el.clientWidth, height: el.clientHeight }));
      setDpr(window.devicePixelRatio || 1);
    };
    measure(); // first layout without waiting for an observer tick
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = Math.min(page, doc.pageCount - 1);
  const zoomFor = useCallback(
    (i: number) => {
      const size = doc.pages[i]!;
      if (viewport.width === 0 || mode === "custom") return customZoom;
      return clampZoom(mode === "fit-page" ? fitPageZoom(size, viewport) : fitWidthZoom(size, viewport));
    },
    [doc.pages, viewport, mode, customZoom],
  );
  const zoom = zoomFor(current);
  const layout = useMemo(() => pageLayout(doc.pages[current]!, zoom, viewport), [doc.pages, current, zoom, viewport]);

  useEffect(() => onPageChange(current), [current, onPageChange]);
  useEffect(() => onZoomChange(zoom, mode), [zoom, mode, onZoomChange]);

  const measureScroll = useCallback(() => {
    const el = scrollerRef.current!;
    setScroll((s) => (s.top === el.scrollTop && s.height === el.scrollHeight && s.client === el.clientHeight ? s : { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
  }, []);
  useEffect(() => {
    const el = scrollerRef.current!;
    el.addEventListener("scroll", measureScroll, { passive: true });
    return () => el.removeEventListener("scroll", measureScroll);
  }, [measureScroll]);

  // after a page change or zoom change, restore the scroll position that goes with it
  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const align = navRef.current;
    const a = anchorRef.current;
    const seek = seekRef.current;
    navRef.current = null;
    anchorRef.current = null;
    seekRef.current = null;
    if (seek !== null) {
      el.scrollTop = seek * el.scrollHeight;
    } else if (align) {
      el.scrollTop = align === "top" ? 0 : el.scrollHeight;
    } else if (a) {
      el.scrollLeft = layout.left + a.xPt * layout.scale - a.ax;
      el.scrollTop = layout.top + a.yPt * layout.scale - a.ay;
    }
    measureScroll();
  }, [layout, measureScroll]);

  const goTo = useCallback(
    (target: number, align: "top" | "bottom") => {
      const el = scrollerRef.current!;
      const t = Math.max(0, Math.min(doc.pageCount - 1, target));
      if (t === current) {
        el.scrollTop = align === "top" ? 0 : el.scrollHeight;
        return;
      }
      navRef.current = align;
      setPage(t);
    },
    [current, doc.pageCount],
  );

  /** The document scrollbar: show `target`, scrolled `fraction` of its height down. */
  const seek = useCallback(
    (target: number, fraction: number) => {
      const el = scrollerRef.current!;
      const t = Math.max(0, Math.min(doc.pageCount - 1, target));
      if (t === live.current.current) {
        el.scrollTop = fraction * el.scrollHeight;
        return;
      }
      seekRef.current = fraction;
      setPage(t);
    },
    [doc.pageCount],
  );

  const anchorAt = useCallback(
    (ax: number, ay: number, l: PageLayout) => {
      const el = scrollerRef.current!;
      anchorRef.current = { xPt: (el.scrollLeft + ax - l.left) / l.scale, yPt: (el.scrollTop + ay - l.top) / l.scale, ax, ay };
    },
    [],
  );

  /** Commit a custom zoom, keeping the document point at viewport position (ax, ay) fixed. */
  const applyZoom = useCallback(
    (next: number, ax = viewport.width / 2, ay = viewport.height / 2) => {
      anchorAt(ax, ay, layout);
      setMode("custom");
      setCustomZoom(clampZoom(next));
    },
    [anchorAt, layout, viewport.width, viewport.height],
  );

  const applyNav = useCallback(
    (nav: Nav) => {
      const el = scrollerRef.current!;
      if (nav.kind === "page") goTo(nav.page, nav.align);
      else {
        el.scrollTop = nav.top;
        el.scrollLeft = nav.left;
      }
    },
    [goTo],
  );

  // listeners are registered once; they read the latest values through this ref
  const live = useRef({ zoom, current, goTo, applyZoom, applyNav, onZoomChange });
  useLayoutEffect(() => {
    live.current = { zoom, current, goTo, applyZoom, applyNav, onZoomChange };
  });

  // wheel: Ctrl / pinch zooms; otherwise page-by-page at the page edges (also over the
  // document scrollbar, which sits beside the scroller)
  useEffect(() => {
    const el = scrollerRef.current!;
    const outer = viewerRef.current!;
    const onWheel = (e: WheelEvent) => {
      const s = live.current;
      if (e.ctrlKey) {
        e.preventDefault();
        const content = contentRef.current!;
        let g = gestureRef.current;
        if (!g) {
          const rect = el.getBoundingClientRect();
          g = { startZoom: s.zoom, factor: 1, ax: e.clientX - rect.left, ay: e.clientY - rect.top, timer: 0 };
          gestureRef.current = g;
          content.style.transformOrigin = `${el.scrollLeft + g.ax}px ${el.scrollTop + g.ay}px`;
        }
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        // a touchpad pinch encodes its scale step as deltaY = -100·ln(step)
        const step = isPinch(e) ? Math.exp(-delta / 100) : Math.exp(-delta * 0.0015);
        g.factor = clampZoom(g.startZoom * g.factor * step) / g.startZoom;
        content.style.transform = `scale(${g.factor})`;
        s.onZoomChange(g.startZoom * g.factor, "custom");
        clearTimeout(g.timer);
        const settled = g;
        g.timer = window.setTimeout(() => {
          gestureRef.current = null;
          content.style.transform = "";
          live.current.applyZoom(settled.startZoom * settled.factor, settled.ax, settled.ay);
        }, GESTURE_SETTLE_MS);
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const dy = e.deltaMode === 1 ? e.deltaY * LINE : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      const maxTop = el.scrollHeight - el.clientHeight;
      const r = pager.onWheel(dy, e.timeStamp, el.scrollTop <= 0.5, el.scrollTop >= maxTop - 0.5);
      if (r === "native") {
        if (!el.contains(e.target as Node)) {
          e.preventDefault();
          el.scrollTop += dy;
        }
        return;
      }
      e.preventDefault();
      if (r !== "swallow") s.goTo(s.current + r, r > 0 ? "top" : "bottom");
    };
    outer.addEventListener("wheel", onWheel, { passive: false });
    return () => outer.removeEventListener("wheel", onWheel);
  }, [pager]);

  // keyboard: arrows, PageUp/PageDown, Home/End, all without scroll animation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.altKey || e.metaKey || e.shiftKey) return;
      if (e.ctrlKey && e.key !== "Home" && e.key !== "End") return;
      if (isEditable(e.target)) return;
      const el = scrollerRef.current!;
      const nav = keyNav(e.key, {
        page: live.current.current,
        pageCount: doc.pageCount,
        top: el.scrollTop,
        left: el.scrollLeft,
        maxTop: el.scrollHeight - el.clientHeight,
        maxLeft: el.scrollWidth - el.clientWidth,
        viewportHeight: el.clientHeight,
      });
      if (!nav) return;
      e.preventDefault();
      live.current.applyNav(nav);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.pageCount]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => applyZoom(stepZoom(zoom, 1)),
      zoomOut: () => applyZoom(stepZoom(zoom, -1)),
      setZoom: (z) => applyZoom(z),
      setMode: (m) => {
        anchorAt(viewport.width / 2, viewport.height / 2, layout);
        setMode(m);
      },
      goTo: (p) => goTo(p, "top"),
      invalidatePages: (pages) => {
        cache.invalidate(pages);
        setEpoch((e) => e + 1);
      },
      focus: () => scrollerRef.current?.focus(),
    }),
    [applyZoom, anchorAt, goTo, cache, zoom, layout, viewport.width, viewport.height],
  );

  // render the current page first, then its neighbours
  const wantScale = useCallback(
    (i: number) => renderScale(doc.pages[i]!.width, doc.pages[i]!.height, zoomFor(i) * PX_PER_PT * dpr),
    [doc.pages, zoomFor, dpr],
  );
  useEffect(() => {
    if (viewport.width === 0) return;
    const wants: Want[] = [{ page: current, scale: wantScale(current), priority: 0 }];
    for (const d of PREFETCH) {
      const i = current + d;
      if (i >= 0 && i < doc.pageCount) wants.push({ page: i, scale: wantScale(i), priority: 1 });
    }
    cache.ensure(wants);
  }, [cache, current, wantScale, viewport.width, doc.pageCount, epoch]);

  const bmp = cache.best(current, wantScale(current));

  return (
    <div className="viewer" ref={viewerRef}>
      <div
        className="scroller"
        ref={scrollerRef}
        tabIndex={0}
        onPointerDown={(e) => e.button === 0 && !(e.target as Element).closest(".page") && onOutsidePage?.()}
      >
        <div className="content" ref={contentRef} style={{ width: layout.contentWidth, height: layout.contentHeight }}>
          <div className="page" data-page={current + 1} style={{ top: layout.top, left: layout.left, width: layout.width, height: layout.height }}>
            <PageCanvas key={current} bitmap={bmp?.bitmap} />
            {overlay?.({ page: current, scale: layout.scale })}
          </div>
        </div>
      </div>
      <DocScrollbar
        page={current}
        pageCount={doc.pageCount}
        top={scroll.top}
        height={scroll.height}
        client={scroll.client}
        onSeek={seek}
        onFlip={(dir) => goTo(current + dir, "top")}
      />
    </div>
  );
}

function PageCanvas({ bitmap }: { bitmap: ImageBitmap | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    if (!bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    try {
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    } catch {
      // bitmap was evicted (closed) before this frame; the next arrival redraws
    }
  }, [bitmap]);
  return <canvas ref={ref} className={bitmap ? "" : "blank"} />;
}
