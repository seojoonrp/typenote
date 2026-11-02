// The shown tab's document: its toolbar, save problems, the page viewer and the annotation
// overlays. Mounted per tab (key = tab id), so typing and selection start fresh when another
// tab is shown; the tab keeps its page and zoom.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AttributeBar } from "./annot/AttributeBar";
import { useFaces } from "./annot/fonts";
import { HighlightBar } from "./annot/HighlightBar";
import { HighlightLayer } from "./annot/HighlightLayer";
import { highlightAt } from "./annot/highlightStyle";
import { TextLayer } from "./annot/TextLayer";
import { useHighlightTool } from "./annot/useHighlightTool";
import { useTextTool } from "./annot/useTextTool";
import type { SaveOptions, SaveProblem } from "./doc/DocStore";
import type { Tab, TabView } from "./doc/Tabs";
import { platform } from "./platform";
import { Menu } from "./ui/Menu";
import { Viewer, type ViewerHandle, type ZoomMode } from "./viewer/Viewer";
import { ZoomField } from "./viewer/ZoomField";

// the zoom mode (or custom %) carries over to the next document and the next launch
const ZOOM_KEY = "typenote.zoom";

/** Page and zoom for a newly opened document. */
export function initialView(): TabView {
  try {
    const p = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? "null") as { mode: ZoomMode; value: number } | null;
    if (p && ["fit-page", "fit-width", "custom"].includes(p.mode) && p.value > 0) return { page: 0, mode: p.mode, zoom: p.value };
  } catch {
    // unreadable storage: use the default
  }
  return { page: 0, mode: "fit-width", zoom: 1 };
}

function saveZoomPref(mode: ZoomMode, value: number) {
  try {
    localStorage.setItem(ZOOM_KEY, JSON.stringify({ mode, value }));
  } catch {
    // not remembered; harmless
  }
}

const PROBLEM_TEXT: Record<SaveProblem["kind"], string> = {
  locked: "Another program has this file open, so it could not be saved. It saves again automatically once that program closes the file.",
  conflict: "The file changed on disk while it was open here. Autosave is paused.",
  readonly: "The file is read-only, so it cannot be saved.",
  io: "Could not save the file.",
  failed: "Could not save the file.",
};

type Props = {
  tab: Tab;
  /** the window's own toolbar buttons (Open, Recent), first in the row */
  toolbarStart: ReactNode;
  /** a window-level notice (an open error) under the toolbar */
  notice: ReactNode;
};

export function DocumentView({ tab, toolbarStart, notice }: Props) {
  const { client, store } = tab;
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const doc = state.doc!; // a tab is shown only once its document is open
  const viewerRef = useRef<ViewerHandle>(null);
  const [page, setPage] = useState(tab.view.page);
  const [zoom, setZoom] = useState({ mode: tab.view.mode, value: tab.view.zoom });

  const save = useCallback((opts?: SaveOptions) => void store.save(opts), [store]);

  const faces = useFaces();
  const tt = useTextTool(store, faces, page);
  const ht = useHighlightTool(store, page);

  // switching or closing tabs writes the text being typed first
  useEffect(() => {
    tab.flush = tt.commit;
    return () => {
      tab.flush = () => {};
    };
  }, [tab, tt.commit]);

  // one selection at a time: a text box or a highlight
  const textSelected = tt.selected?.id;
  const highlightSelected = ht.selected?.id;
  const { select: selectHighlight } = ht;
  useEffect(() => {
    if (textSelected) selectHighlight(null);
  }, [textSelected, selectHighlight]);
  useEffect(() => {
    if (highlightSelected) tt.select(null);
  }, [highlightSelected]); // only when a highlight gets selected (tt.select is not memoized)
  useEffect(() => {
    if (tt.tool === "text") selectHighlight(null);
  }, [tt.tool, selectHighlight]);

  // focus the pages so arrow keys / PageUp / PageDown work right away
  useEffect(() => viewerRef.current?.focus(), []);

  useEffect(() => platform.setTitle(`${state.dirty ? "• " : ""}${doc.name} — typenote`), [state.dirty, doc.name]);

  // zoom and save shortcuts (never while an IME is composing); the window swallows the zoom keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || !e.ctrlKey || e.altKey) return;
      const v = viewerRef.current;
      if (!v) return;
      const zoomKeys: Record<string, () => void> = {
        "=": v.zoomIn,
        "+": v.zoomIn,
        "-": v.zoomOut,
        "0": () => v.setMode("fit-page"),
        "1": () => v.setZoom(1),
        "2": () => v.setMode("fit-width"),
      };
      if (e.key in zoomKeys) {
        e.preventDefault();
        zoomKeys[e.key]!();
      } else if (e.code === "KeyS") {
        e.preventDefault();
        save(e.shiftKey ? { saveAs: true } : undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const onPageChange = useCallback(
    (p: number) => {
      setPage(p);
      tab.view.page = p;
    },
    [tab],
  );
  const onZoomChange = useCallback(
    (value: number, mode: ZoomMode) => {
      setZoom({ value, mode });
      tab.view.mode = mode;
      tab.view.zoom = value;
      saveZoomPref(mode, value);
    },
    [tab],
  );

  const problem = state.saveProblem;

  return (
    <>
      <header className="toolbar">
        {toolbarStart}
        <Menu label="Save ▾">
          <button onClick={() => save()}>
            Save<span className="dim">Ctrl+S</span>
          </button>
          <button onClick={() => save({ saveAs: true })}>
            Save As…<span className="dim">Ctrl+Shift+S</span>
          </button>
          <button onClick={() => save({ full: true })}>
            Save Compacted<span className="dim">Rewrites the file without its edit history, making it smaller</span>
          </button>
        </Menu>
        <span className="sep" />
        <button className={tt.tool === "select" ? "active" : ""} onClick={() => tt.setTool("select")} title="Select (V)">
          Select
        </button>
        <button className={tt.tool === "text" ? "active" : ""} onClick={() => tt.setTool("text")} title="Text (T)">
          Text
        </button>
        <button className={tt.tool === "highlight" ? "active" : ""} onClick={() => tt.setTool("highlight")} title="Highlight (H)">
          Highlight
        </button>
        <span className="sep" />
        <button onClick={() => void store.undo()} disabled={!state.canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={() => void store.redo()} disabled={!state.canRedo} title="Redo (Ctrl+Y)">
          ↷
        </button>
        {/* always present in the text tool, so selecting never reflows the toolbar (and the page);
            it edits the selected box or, with nothing selected, the tool defaults */}
        {tt.tool === "text" && <AttributeBar className="docked" value={tt.target} onChange={tt.setStyle} onStepSize={tt.stepSizeBy} />}
        {tt.tool === "highlight" && <HighlightBar className="docked" value={ht.target} onChange={ht.setStyle} />}
        <SaveStatus saving={state.saving} dirty={state.dirty} lastSave={state.lastSave} />
        <span className="spacer" />
        <span className="pages">
          {page + 1} / {doc.info.pageCount}
        </span>
        <button onClick={() => viewerRef.current?.zoomOut()} title="Zoom Out (Ctrl+-)">
          −
        </button>
        <ZoomField zoom={zoom.value} onCommit={(z) => viewerRef.current?.setZoom(z)} onDone={() => viewerRef.current?.focus()} />
        <button onClick={() => viewerRef.current?.zoomIn()} title="Zoom In (Ctrl+=)">
          +
        </button>
        <Menu label={zoom.mode === "fit-page" ? "Fit Page ▾" : zoom.mode === "fit-width" ? "Fit Width ▾" : "Fit ▾"} align="right">
          <button onClick={() => viewerRef.current?.setMode("fit-page")} className={zoom.mode === "fit-page" ? "active" : ""}>
            Fit Page<span className="dim">Ctrl+0</span>
          </button>
          <button onClick={() => viewerRef.current?.setMode("fit-width")} className={zoom.mode === "fit-width" ? "active" : ""}>
            Fit Width<span className="dim">Ctrl+2</span>
          </button>
          <button onClick={() => viewerRef.current?.setZoom(1)}>
            Actual Size (100%)<span className="dim">Ctrl+1</span>
          </button>
        </Menu>
      </header>

      {notice}

      {problem && (
        <div className="error" role="alert">
          <span>
            {PROBLEM_TEXT[problem.kind]} <span className="dim">({problem.message})</span>
          </span>
          {(problem.kind === "locked" || problem.kind === "io" || problem.kind === "failed") && <button onClick={() => save()}>Retry</button>}
          {problem.kind === "conflict" && <button onClick={() => save({ overwrite: true })}>Overwrite</button>}
          <button onClick={() => save({ saveAs: true })}>Save As…</button>
          <button onClick={() => store.dismissProblem()}>Dismiss</button>
        </div>
      )}

      <Viewer
        ref={viewerRef}
        client={client}
        doc={doc.info}
        initialPage={tab.view.page}
        initialMode={tab.view.mode}
        initialZoom={tab.view.zoom}
        onPageChange={onPageChange}
        onZoomChange={onZoomChange}
        onOutsidePage={() => {
          tt.select(null);
          ht.select(null);
        }}
        overlay={(view) =>
          faces && (
            <>
              <HighlightLayer view={view} ht={ht} tool={tt.tool} client={client} />
              <TextLayer
                view={view}
                tt={tt}
                faces={faces}
                onBackgroundClick={(pt) => {
                  const hit = highlightAt(ht.highlights.filter((h) => h.page === view.page), pt.x, pt.y);
                  ht.select(hit?.id ?? null);
                  return !!hit;
                }}
              />
            </>
          )
        }
      />
    </>
  );
}

function SaveStatus({ saving, dirty, lastSave }: { saving: boolean; dirty: boolean; lastSave: { at: number } | null }) {
  let text = "";
  if (saving) text = "Saving…";
  else if (dirty) text = "Edited";
  else if (lastSave) text = `Saved ${new Date(lastSave.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return <span className="save-status dim">{text}</span>;
}
