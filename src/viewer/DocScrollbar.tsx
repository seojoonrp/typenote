// Acrobat-style scrollbar for the single-page view: the track is the whole document, so the thumb
// shows which page is shown (and how far down it, when the page is taller than the view).
// Dragging the thumb moves through the pages; clicking the track turns one page.
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const MIN_THUMB_PX = 24;

type Props = {
  page: number;
  pageCount: number;
  /** the scroller's scrollTop, scrollHeight and clientHeight */
  top: number;
  height: number;
  client: number;
  /** show `page`, scrolled `fraction` of its height down */
  onSeek(page: number, fraction: number): void;
  onFlip(dir: 1 | -1): void;
};

export function DocScrollbar({ page, pageCount, top, height, client, onSeek, onFlip }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = trackRef.current!;
    const measure = () => setTrackPx(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // in page units: the view covers [pos, pos + visible] of [0, pageCount]
  const visible = height > 0 ? Math.min(1, client / height) : 1;
  const pos = page + (height > 0 ? top / height : 0);
  const thumbPx = Math.min(trackPx, Math.max(MIN_THUMB_PX, (trackPx * visible) / pageCount));
  const span = pageCount - visible; // pos runs over [0, span]
  const thumbTop = span > 0 ? ((trackPx - thumbPx) * pos) / span : 0;

  const seekTo = (docPos: number) => {
    const p = Math.max(0, Math.min(span, docPos));
    // the page under the middle of the view, scrolled so the view starts at p
    const target = Math.max(0, Math.min(pageCount - 1, Math.floor(p + visible / 2)));
    onSeek(target, Math.max(0, Math.min(1 - visible, p - target)));
  };

  const onThumbDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const trackTop = trackRef.current!.getBoundingClientRect().top;
    const grab = e.clientY - trackTop - thumbTop;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (trackPx <= thumbPx) return;
      seekTo(((ev.clientY - trackTop - grab) / (trackPx - thumbPx)) * span);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      setDragging(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y = e.clientY - trackRef.current!.getBoundingClientRect().top;
    onFlip(y < thumbTop ? -1 : 1);
  };

  return (
    <div className="docbar" ref={trackRef} onPointerDown={onTrackDown} title={dragging ? undefined : `Page ${page + 1} of ${pageCount}`}>
      <div className={`docbar-thumb${dragging ? " dragging" : ""}`} style={{ top: thumbTop, height: thumbPx }} onPointerDown={onThumbDown} />
      {dragging && (
        <div className="docbar-label" style={{ top: thumbTop + thumbPx / 2 }}>
          {page + 1} / {pageCount}
        </div>
      )}
    </div>
  );
}
