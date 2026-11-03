// Highlights on the current page: drawn as SVG with Multiply blending (the base bitmap hides
// them), and with the highlight tool, created by dragging over text or double-clicking a word.
import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PdfClient } from "../pdf/client";
import type { Quad, RGB } from "../pdf/engine/model";
import type { PageView } from "../viewer/Viewer";
import { HighlightBar } from "./HighlightBar";
import { highlightAt, quadsBounds } from "./highlightStyle";
import { cssColor } from "./style";
import type { HighlightTool } from "./useHighlightTool";
import type { Tool } from "./useTextTool";

const DRAG_THRESHOLD_PX = 3;
const BAR_HEIGHT_PX = 40;
/** room between a floating bar and what it belongs to */
const BAR_GAP_PX = 10;

type Props = {
  view: PageView;
  ht: HighlightTool;
  tool: Tool;
  client: PdfClient;
  /** is there page text at this point (an I-beam there, the normal pointer elsewhere) */
  overText: (x: number, y: number) => boolean;
};
type Pt = [number, number];
/** a drag in progress: selection requests are sent one at a time, the latest point wins */
type Selecting = { start: Pt; latest: Pt | null; busy: boolean };

export function HighlightLayer({ view, ht, tool, client, overText }: Props) {
  const { page, scale } = view;
  const layerRef = useRef<HTMLDivElement>(null);
  const selecting = useRef<Selecting | null>(null);
  const [preview, setPreview] = useState<Quad[] | null>(null);
  const highlights = ht.highlights.filter((h) => h.page === page);
  const selected = ht.selected?.page === page ? ht.selected : null;

  const toPage = (clientX: number, clientY: number): Pt => {
    const el = layerRef.current!;
    const r = el.getBoundingClientRect();
    const css = r.width / el.offsetWidth;
    return [(clientX - r.left) / css / scale, (clientY - r.top) / css / scale];
  };

  const requestPreview = () => {
    const s = selecting.current;
    if (!s || s.busy || !s.latest) return;
    const to = s.latest;
    s.latest = null;
    s.busy = true;
    client.selectText({ page, from: s.start, to, mode: "chars" }).then(
      (quads) => {
        if (selecting.current !== s) return;
        s.busy = false;
        setPreview(quads.length ? quads : null);
        requestPreview();
      },
      () => {
        s.busy = false;
      },
    );
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "highlight" || e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = toPage(e.clientX, e.clientY);
    const hit = highlightAt(highlights, start[0], start[1]);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const s: Selecting = { start, latest: null, busy: false };
    selecting.current = s;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      s.latest = toPage(ev.clientX, ev.clientY);
      requestPreview();
    };
    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      selecting.current = null;
      if (!moved || ev.type !== "pointerup") {
        setPreview(null);
        ht.select(hit?.id ?? null);
        return;
      }
      ht.select(null);
      const to = toPage(ev.clientX, ev.clientY);
      client.selectText({ page, from: start, to, mode: "chars" }).then(
        (quads) => {
          setPreview(null);
          ht.create(page, quads);
        },
        () => setPreview(null),
      );
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (tool !== "highlight") return;
    const p = toPage(e.clientX, e.clientY);
    // on an existing highlight the clicks select it; don't stack another one on top
    if (highlightAt(highlights, p[0], p[1])) return;
    void client.selectText({ page, from: p, to: p, mode: "word" }).then((quads) => ht.create(page, quads));
  };

  let barTop = 0;
  let barLeft = 0;
  if (selected) {
    const b = quadsBounds(selected.quads);
    barTop = b[1] * scale - BAR_HEIGHT_PX - BAR_GAP_PX;
    if (barTop < 0) barTop = b[3] * scale + BAR_GAP_PX;
    barLeft = Math.max(0, b[0] * scale);
  }

  return (
    <div
      ref={layerRef}
      className={`hl-layer tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (tool !== "highlight" || e.buttons) return;
        const [x, y] = toPage(e.clientX, e.clientY);
        e.currentTarget.style.cursor = overText(x, y) ? "text" : "";
      }}
      onDoubleClick={onDoubleClick}
      // no focus change or native text selection while dragging over the page
      onMouseDown={(e) => tool === "highlight" && e.preventDefault()}
    >
      {highlights.map((h) => (
        <HighlightShape key={h.id} quads={h.quads} color={h.color} opacity={h.opacity} scale={scale} />
      ))}
      {preview && <HighlightShape quads={preview} color={ht.defaults.color} opacity={ht.defaults.opacity} scale={scale} />}
      {selected && <SelectionOutline quads={selected.quads} scale={scale} />}
      {selected && (
        <HighlightBar
          className="floating"
          style={{ left: barLeft, top: barTop }}
          value={selected}
          onChange={ht.setStyle}
          onDelete={() => ht.remove(selected.id)}
        />
      )}
    </div>
  );
}

const points = (q: Quad, scale: number, ox: number, oy: number) =>
  [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ]
    .map(([x, y]) => `${(x! - ox) * scale},${(y! - oy) * scale}`)
    .join(" ");

/**
 * One SVG per highlight, blended with Multiply onto what is below at the highlight's opacity:
 * like the appearance stream (an opaque group composited with /CA and /BM Multiply), so
 * overlapping lines of one highlight don't darken twice but separate highlights multiply.
 */
function HighlightShape({ quads, color, opacity, scale }: { quads: Quad[]; color: RGB; opacity: number; scale: number }) {
  const [x0, y0, x1, y1] = quadsBounds(quads);
  return (
    <svg className="hl-shape" style={{ left: x0 * scale, top: y0 * scale, opacity }} width={(x1 - x0) * scale} height={(y1 - y0) * scale}>
      {quads.map((q, i) => (
        <polygon key={i} points={points(q, scale, x0, y0)} fill={cssColor(color)} />
      ))}
    </svg>
  );
}

function SelectionOutline({ quads, scale }: { quads: Quad[]; scale: number }) {
  const [x0, y0, x1, y1] = quadsBounds(quads);
  const pad = 2;
  return (
    <div
      className="hl-selected"
      style={{ left: x0 * scale - pad, top: y0 * scale - pad, width: (x1 - x0) * scale + 2 * pad, height: (y1 - y0) * scale + 2 * pad }}
    />
  );
}
