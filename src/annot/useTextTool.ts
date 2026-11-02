// Text box editing state: tool, default style, selection and the box being typed into.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DocStore } from "../doc/DocStore";
import type { Faces } from "../pdf/engine/faces";
import { HANGUL_TRACKING } from "../pdf/engine/layout";
import { newBoxId, type TextBox } from "../pdf/engine/model";
import { clampSize, DEFAULT_STYLE, newBoxOrigin, stepSize, type BoxStyle } from "./style";

export type Tool = "select" | "text" | "highlight";
/** The box being typed into (new or existing), not written to the document until committed. */
export type Draft = TextBox & { isNew: boolean; /** where the caret starts (default: the end) */ caret?: number };

/** Marks elements a pointerdown on which does not end typing (the editor, the attribute bars). */
export const KEEP_DRAFT_ATTR = "data-keep-draft";

const PREFS_KEY = "typenote.textTool";
type Prefs = { tool: Tool; style: BoxStyle };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Prefs | null;
    if (p && ["select", "text", "highlight"].includes(p.tool) && p.style?.size > 0) return p;
  } catch {
    // unreadable storage: defaults
  }
  return { tool: "text", style: DEFAULT_STYLE };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // not remembered; harmless
  }
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

const sameBox = (a: TextBox, b: TextBox) =>
  a.page === b.page &&
  a.x === b.x &&
  a.y === b.y &&
  a.text === b.text &&
  a.size === b.size &&
  a.weight === b.weight &&
  (a.tracking ?? 0) === (b.tracking ?? 0) &&
  a.color.every((v, i) => v === b.color[i]);

export type TextTool = ReturnType<typeof useTextTool>;

export function useTextTool(store: DocStore, faces: Faces | null, page: number) {
  const { textBoxes, doc } = useSyncExternalStore(store.subscribe, store.getState);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraftState(d);
  };

  const selected = textBoxes.find((b) => b.id === selectedId) ?? null;
  const find = useCallback((id: string) => store.getState().textBoxes.find((b) => b.id === id) ?? null, [store]);

  const updatePrefs = (p: Partial<Prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      savePrefs(next);
      return next;
    });

  /** Writes the draft (or deletes the box if it was emptied). Safe to call when not typing. */
  const commit = useCallback(() => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    setDraftState(null);
    const { isNew: _isNew, caret: _caret, ...box } = d;
    const existing = find(box.id);
    if (box.text.trim() === "") {
      if (existing) void store.deleteTextBox(box.id);
      setSelectedId(null);
      return;
    }
    if (!existing || !sameBox(existing, box)) void store.putTextBox(box);
    setSelectedId(box.id);
  }, [find, store]);

  const beginNew = (pageIndex: number, click: { x: number; y: number }) => {
    commit();
    if (!faces) return;
    const style = prefs.style;
    const origin = newBoxOrigin(click, faces[style.weight], style.size);
    setSelectedId(null);
    setDraft({ id: newBoxId(), page: pageIndex, ...origin, text: "", ...style, tracking: HANGUL_TRACKING, isNew: true });
  };

  /** Starts typing into a box, the caret at `caret` (a text offset) or at the end. */
  const beginEdit = (box: TextBox, caret?: number) => {
    if (draftRef.current?.id === box.id) return;
    commit();
    setSelectedId(box.id);
    // editing brings an older box to the current letter spacing
    setDraft({ ...box, tracking: HANGUL_TRACKING, isNew: false, caret });
  };

  const setText = (text: string) => {
    const d = draftRef.current;
    if (d) setDraft({ ...d, text });
  };

  const select = (id: string | null) => {
    commit();
    setSelectedId(id);
  };

  /** Applies to the box being typed into, else the selected box, else the tool defaults. */
  const setStyle = (patch: Partial<BoxStyle>, merge?: string) => {
    const d = draftRef.current;
    if (d) setDraft({ ...d, ...patch });
    else if (selected) void store.putTextBox({ ...selected, ...patch }, { merge: merge && `${merge}:${selected.id}` });
    else updatePrefs({ style: { ...prefs.style, ...patch } });
  };
  const target: BoxStyle = draft ?? selected ?? prefs.style;
  const toggleWeight = () => setStyle({ weight: target.weight === "semibold" ? "regular" : "semibold" });
  const stepSizeBy = (dir: 1 | -1) => setStyle({ size: clampSize(stepSize(target.size, dir)) }, "size");

  const moveTo = (box: TextBox, x: number, y: number) => void store.putTextBox({ ...box, x, y });
  const remove = (id: string) => {
    if (draftRef.current?.id === id) setDraft(null);
    setSelectedId(null);
    void store.deleteTextBox(id);
  };

  // leaving the page or the document ends typing and selection
  useEffect(() => {
    commit();
    setSelectedId(null);
  }, [page, doc?.info.docId, commit]);

  // a click anywhere outside the editor and the attribute bars ends typing
  useEffect(() => {
    if (!draft) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[${KEEP_DRAFT_ATTR}]`)) commit();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [draft, commit]);

  // keyboard: runs in the capture phase, before the viewer's page navigation
  const live = useRef({ selected, prefs, toggleWeight, stepSizeBy, remove, beginEdit, select });
  live.current = { selected, prefs, toggleWeight, stepSizeBy, remove, beginEdit, select };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const s = live.current;
      // style shortcuts work while typing too
      if (e.ctrlKey && !e.altKey) {
        if (e.code === "KeyB" && !e.shiftKey) {
          e.preventDefault();
          s.toggleWeight();
        } else if (e.shiftKey && (e.code === "Period" || e.code === "Comma")) {
          e.preventDefault();
          s.stepSizeBy(e.code === "Period" ? 1 : -1);
        } else if (!isEditable(e.target) && (e.code === "KeyZ" || e.code === "KeyY")) {
          e.preventDefault();
          if (e.code === "KeyY" || e.shiftKey) void store.redo();
          else void store.undo();
        }
        return;
      }
      if (e.altKey || e.metaKey || isEditable(e.target)) return;
      if (!e.shiftKey && e.code === "KeyV") updatePrefs({ tool: "select" });
      else if (!e.shiftKey && e.code === "KeyT") updatePrefs({ tool: "text" });
      else if (!e.shiftKey && e.code === "KeyH") updatePrefs({ tool: "highlight" });
      else if (s.selected) {
        const box = s.selected;
        const step = e.shiftKey ? 10 : 1;
        const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (e.key in nudge) {
          e.preventDefault();
          const [dx, dy] = nudge[e.key]!;
          void store.putTextBox({ ...box, x: box.x + dx, y: box.y + dy }, { merge: `nudge:${box.id}` });
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          s.remove(box.id);
        } else if (e.key === "Enter") {
          e.preventDefault();
          s.beginEdit(box);
        } else if (e.key === "Escape") {
          e.preventDefault();
          s.select(null);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [store]); // reads the latest values through `live`

  return {
    tool: prefs.tool,
    setTool: (tool: Tool) => updatePrefs({ tool }),
    defaults: prefs.style,
    textBoxes,
    selected,
    draft,
    target,
    beginNew,
    beginEdit,
    setText,
    commit,
    select,
    setStyle,
    toggleWeight,
    stepSizeBy,
    moveTo,
    remove,
  };
}
