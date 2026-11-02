// Highlight state: default style, the selected highlight, and its keyboard shortcuts.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DocStore } from "../doc/DocStore";
import { newHighlightId, type Quad } from "../pdf/engine/model";
import { DEFAULT_HIGHLIGHT, snapOpacity, type HighlightStyle } from "./highlightStyle";

const PREFS_KEY = "typenote.highlight";

function loadStyle(): HighlightStyle {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as HighlightStyle | null;
    if (p && Array.isArray(p.color) && p.color.length === 3 && p.opacity > 0) return { color: p.color, opacity: snapOpacity(p.opacity) };
  } catch {
    // unreadable storage: defaults
  }
  return DEFAULT_HIGHLIGHT;
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

export type HighlightTool = ReturnType<typeof useHighlightTool>;

export function useHighlightTool(store: DocStore, page: number) {
  const { highlights, doc } = useSyncExternalStore(store.subscribe, store.getState);
  const [defaults, setDefaults] = useState<HighlightStyle>(loadStyle);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = highlights.find((h) => h.id === selectedId) ?? null;

  /** Applies to the selected highlight, else the defaults for new ones. */
  const setStyle = (patch: Partial<HighlightStyle>, merge?: string) => {
    const p = patch.opacity === undefined ? patch : { ...patch, opacity: snapOpacity(patch.opacity) };
    if (selected) void store.putHighlight({ ...selected, ...p }, { merge: merge && `${merge}:${selected.id}` });
    else
      setDefaults((old) => {
        const next = { ...old, ...p };
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        } catch {
          // not remembered; harmless
        }
        return next;
      });
  };

  const create = (pageIndex: number, quads: Quad[]) => {
    if (quads.length === 0) return;
    void store.putHighlight({ id: newHighlightId(), page: pageIndex, quads, ...defaults });
  };

  const remove = (id: string) => {
    setSelectedId(null);
    void store.deleteHighlight(id);
  };

  useEffect(() => setSelectedId(null), [page, doc?.info.docId]);

  // Delete / Esc for the selected highlight (capture phase, before page navigation)
  const live = useRef({ selected, remove });
  live.current = { selected, remove };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = live.current.selected;
      if (!h || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || isEditable(e.target)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        live.current.remove(h.id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return {
    highlights,
    defaults,
    selected,
    target: (selected ?? defaults) as HighlightStyle,
    select: setSelectedId,
    setStyle,
    create,
    remove,
  };
}
