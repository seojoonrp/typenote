// Selecting the page's own text with the select tool, to copy it elsewhere (Ctrl+C or the Copy
// button). Nothing in the document changes. A drag selects characters, a double-click a word; a
// click without dragging is left to the caller (it selects a highlight under the pointer).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PdfClient } from "../pdf/client";
import type { Quad } from "../pdf/engine/model";
import type { SelectMode } from "../pdf/protocol";

type Pt = [number, number];
export type Selection = { page: number; from: Pt; to: Pt; mode: SelectMode; quads: Quad[] };

const DRAG_THRESHOLD_PX = 3;

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

/** Clipboard API, or the old copy command where it is unavailable. */
async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

export type TextSelection = ReturnType<typeof useTextSelection>;

export function useTextSelection(client: PdfClient, page: number) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [copied, setCopied] = useState(false);
  const drag = useRef<object | null>(null);

  const clear = useCallback(() => {
    drag.current = null;
    setSelection(null);
    setCopied(false);
  }, []);

  /**
   * A press on the page's background: drag to select text from `start`. Selection requests go to
   * the worker one at a time, the latest pointer position winning.
   */
  const press = (e: ReactPointerEvent<HTMLElement>, start: Pt, toPage: (clientX: number, clientY: number) => Pt, onClick: () => void) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const s = { latest: null as Pt | null, busy: false };
    drag.current = s;
    setCopied(false);
    const request = () => {
      if (s.busy || !s.latest) return;
      const to = s.latest;
      s.latest = null;
      s.busy = true;
      client.selectText({ page, from: start, to, mode: "chars" }).then(
        (quads) => {
          s.busy = false;
          if (drag.current !== s) return;
          setSelection(quads.length ? { page, from: start, to, mode: "chars", quads } : null);
          request();
        },
        () => {
          s.busy = false;
        },
      );
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      s.latest = toPage(ev.clientX, ev.clientY);
      request();
    };
    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (!moved || ev.type !== "pointerup") {
        clear();
        onClick();
        return;
      }
      s.latest = toPage(ev.clientX, ev.clientY);
      request();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const selectWord = (at: Pt) => {
    const s = {};
    drag.current = s;
    setCopied(false);
    void client.selectText({ page, from: at, to: at, mode: "word" }).then((quads) => {
      if (drag.current === s) setSelection(quads.length ? { page, from: at, to: at, mode: "word", quads } : null);
    });
  };

  const copy = useCallback(async () => {
    if (!selection) return;
    const { page: p, from, to, mode } = selection;
    await writeClipboard(await client.copyText({ page: p, from, to, mode }));
    setCopied(true);
  }, [client, selection]);

  // the selection belongs to its page
  useEffect(() => clear(), [page, clear]);

  // Ctrl+C copies, Esc lets go (not while typing in a field)
  const live = useRef({ selection, copy, clear });
  live.current = { selection, copy, clear };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = live.current;
      if (!s.selection || e.isComposing || e.keyCode === 229 || isEditable(e.target)) return;
      if (e.ctrlKey && !e.altKey && e.code === "KeyC") {
        e.preventDefault();
        void s.copy();
      } else if (e.key === "Escape") {
        e.preventDefault();
        s.clear();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return { selection: selection?.page === page ? selection : null, copied, press, selectWord, copy, clear };
}
