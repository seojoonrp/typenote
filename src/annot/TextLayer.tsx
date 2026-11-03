// HTML overlay for the app's text boxes on the current page: shows them (the base bitmap hides
// them), selects, drags, and edits in a textarea laid out exactly like the appearance stream.
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import type { Face, Faces } from "../pdf/engine/faces";
import { caretIndexAt, layoutText, missingGlyphs } from "../pdf/engine/layout";
import type { TextBox } from "../pdf/engine/model";
import type { PageView } from "../viewer/Viewer";
import { AttributeBar } from "./AttributeBar";
import { textCss } from "./style";
import { KEEP_DRAFT_ATTR, type Draft, type TextTool } from "./useTextTool";

const DRAG_THRESHOLD_PX = 3;
const BAR_HEIGHT_PX = 40;
/** room between a floating bar and what it belongs to */
const BAR_GAP_PX = 10;

type Props = {
  view: PageView;
  tt: TextTool;
  faces: Faces;
  /** select tool, press on no box (a drag selects page text, a click a highlight) */
  onBackgroundPress?: (e: ReactPointerEvent<HTMLDivElement>, pt: { x: number; y: number }, toPage: (clientX: number, clientY: number) => { x: number; y: number }) => void;
  /** select tool, double-click on no box (selects the word under it) */
  onBackgroundDoubleClick?: (pt: { x: number; y: number }) => void;
  /** is there page text at this point (the select tool shows an I-beam there) */
  overText?: (x: number, y: number) => boolean;
};
type Drag = { id: string; dx: number; dy: number };

export function TextLayer({ view, tt, faces, onBackgroundPress, onBackgroundDoubleClick, overText }: Props) {
  const { page, scale } = view;
  const layerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const boxes = tt.textBoxes.filter((b) => b.page === page);
  const draft = tt.draft?.page === page ? tt.draft : null;

  /** client px -> page pt, also correct while a zoom gesture scales the page with CSS */
  const toPage = (clientX: number, clientY: number) => {
    const el = layerRef.current!;
    const r = el.getBoundingClientRect();
    const css = r.width / el.offsetWidth;
    return { x: (clientX - r.left) / css / scale, y: (clientY - r.top) / css / scale };
  };

  const onLayerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (tt.tool === "text") tt.beginNew(page, toPage(e.clientX, e.clientY));
    else {
      tt.select(null);
      onBackgroundPress?.(e, toPage(e.clientX, e.clientY), toPage);
    }
  };

  /** The caret offset in `box`'s text nearest to a point on the page. */
  const caretAt = (box: TextBox, p: { x: number; y: number }) =>
    caretIndexAt(layoutText(box.text, faces[box.weight], box.size, box.tracking), faces[box.weight], box.size, p.x - box.x, p.y - box.y);

  /**
   * Press on a box: select it and drag to move. A click without moving starts typing in the text
   * tool, with the caret where it was clicked; on the box's edge (`moveOnly`) it only selects.
   */
  const onBoxDown = (box: TextBox, moveOnly = false) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    tt.select(box.id);
    const el = e.currentTarget;
    const start = toPage(e.clientX, e.clientY);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let delta = { dx: 0, dy: 0 };
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const p = toPage(ev.clientX, ev.clientY);
      delta = { dx: p.x - start.x, dy: p.y - start.y };
      setDrag({ id: box.id, ...delta });
    };
    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      setDrag(null);
      if (moved && ev.type === "pointerup") tt.moveTo(box, box.x + delta.dx, box.y + delta.dy);
      else if (!moved && tt.tool === "text" && !moveOnly) tt.beginEdit(box, caretAt(box, start));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const barBox: TextBox | null = draft ?? (tt.selected?.page === page && !drag ? tt.selected : null);
  const barLayout = barBox && layoutText(barBox.text, faces[barBox.weight], barBox.size, barBox.tracking);
  let barTop = 0;
  let barAbove = true;
  if (barBox && barLayout) {
    barTop = barBox.y * scale - BAR_HEIGHT_PX - BAR_GAP_PX;
    if (barTop < 0) {
      barTop = (barBox.y + barLayout.height) * scale + BAR_GAP_PX;
      barAbove = false;
    }
  }

  return (
    <div
      ref={layerRef}
      className={`text-layer tool-${tt.tool}`}
      onPointerDown={onLayerDown}
      onPointerMove={(e) => {
        if (tt.tool !== "select" || e.buttons) return;
        const p = toPage(e.clientX, e.clientY);
        e.currentTarget.style.cursor = overText?.(p.x, p.y) ? "text" : "";
      }}
      onDoubleClick={(e) => tt.tool === "select" && onBackgroundDoubleClick?.(toPage(e.clientX, e.clientY))}
      // no focus change or text selection from clicks on the page (the editor places its caret itself)
      onMouseDown={(e) => !(e.target instanceof HTMLTextAreaElement) && e.preventDefault()}
    >
      {boxes.map((box) =>
        box.id === draft?.id ? null : (
          <BoxView
            key={box.id}
            box={box}
            face={faces[box.weight]}
            scale={scale}
            selected={box.id === tt.selected?.id}
            offset={drag?.id === box.id ? drag : null}
            onPointerDown={onBoxDown(box)}
            onEdgeDown={onBoxDown(box, true)}
            onDoubleClick={(e) => tt.beginEdit(box, caretAt(box, toPage(e.clientX, e.clientY)))}
          />
        ),
      )}
      {draft && <BoxEditor ref={editorRef} draft={draft} face={faces[draft.weight]} scale={scale} onText={tt.setText} onCommit={tt.commit} />}
      {barBox && (
        <AttributeBar
          className="floating"
          style={{ left: Math.max(0, barBox.x * scale), top: barTop }}
          listUp={barAbove}
          value={barBox}
          onChange={tt.setStyle}
          onStepSize={tt.stepSizeBy}
          onDelete={() => tt.remove(barBox.id)}
          onDone={() => editorRef.current?.focus()}
        />
      )}
    </div>
  );
}

type BoxViewProps = {
  box: TextBox;
  face: Face;
  scale: number;
  selected: boolean;
  offset: { dx: number; dy: number } | null;
  onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
  /** on the box's outline: move only (in the text tool the inside is for typing) */
  onEdgeDown(e: ReactPointerEvent<HTMLDivElement>): void;
  onDoubleClick(e: ReactMouseEvent): void;
};

const EDGES = ["top", "right", "bottom", "left"] as const;

function BoxView({ box, face, scale, selected, offset, onPointerDown, onEdgeDown, onDoubleClick }: BoxViewProps) {
  const layout = useMemo(() => layoutText(box.text, face, box.size, box.tracking), [box.text, face, box.size, box.tracking]);
  return (
    <div
      className={`tbox${selected ? " selected" : ""}`}
      data-box-id={box.id}
      style={{
        left: (box.x + (offset?.dx ?? 0)) * scale,
        top: (box.y + (offset?.dy ?? 0)) * scale,
        width: layout.width * scale,
        height: layout.height * scale,
        ...textCss(layout, box, scale),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(e);
      }}
    >
      {withNotdef(box.text, face)}
      {EDGES.map((edge) => (
        <div key={edge} className={`tbox-edge ${edge}`} onPointerDown={onEdgeDown} onDoubleClick={(e) => e.stopPropagation()} />
      ))}
    </div>
  );
}

/**
 * Characters Pretendard lacks are written as its .notdef glyph (an empty box, 1em wide) in the
 * PDF; show the same instead of whatever system font the browser would fall back to.
 */
function withNotdef(text: string, face: Face) {
  if (missingGlyphs(text, face).length === 0) return text;
  return [...text].map((ch, i) =>
    ch === "\n" || face.ttf.cmap.has(ch.codePointAt(0)!) ? (
      ch
    ) : (
      <span key={i} className="notdef">
        □
      </span>
    ),
  );
}

type EditorProps = {
  ref: Ref<HTMLTextAreaElement>;
  draft: Draft;
  face: Face;
  scale: number;
  onText(text: string): void;
  onCommit(): void;
};

function BoxEditor({ ref, draft, face, scale, onText, onCommit }: EditorProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const layout = layoutText(draft.text, face, draft.size, draft.tracking);
  const missing = missingGlyphs(draft.text, face);

  useLayoutEffect(() => {
    const t = own.current!;
    t.focus({ preventScroll: true });
    const at = Math.min(draft.caret ?? t.value.length, t.value.length);
    t.setSelectionRange(at, at);
  }, [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps -- once per box: the caret moves by itself afterwards

  // 1em of extra room so the caret and the character being composed never scroll the field
  const slack = draft.size;
  return (
    <>
      <textarea
        ref={(t) => {
          own.current = t;
          if (typeof ref === "function") ref(t);
          else if (ref) ref.current = t;
        }}
        className="tbox-editor"
        {...{ [KEEP_DRAFT_ATTR]: "" }}
        wrap="off"
        spellCheck={false}
        autoComplete="off"
        value={draft.text}
        style={{
          left: draft.x * scale,
          top: draft.y * scale,
          width: (layout.width + slack) * scale,
          height: layout.height * scale,
          ...textCss(layout, draft, scale),
        }}
        onChange={(e) => onText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // never act on keys that belong to an IME composition (it would duplicate the last syllable)
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            e.preventDefault();
            onCommit();
          }
        }}
        onScroll={(e) => {
          e.currentTarget.scrollTop = 0;
          e.currentTarget.scrollLeft = 0;
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {missing.length > 0 && (
        <div className="glyph-warning" style={{ left: draft.x * scale, top: (draft.y + layout.height) * scale + 4 }}>
          Not in Pretendard: {missing.join(" ")} (saved as empty boxes in the PDF)
        </div>
      )}
    </>
  );
}
