// The shown tab's document: its toolbar, save problems, the page viewer and the annotation
// overlays. Mounted per tab (key = tab id), so typing and selection start fresh when another
// tab is shown; the tab keeps its page and zoom.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AttributeBar } from "./annot/AttributeBar";
import { useFaces } from "./annot/fonts";
import { HighlightBar } from "./annot/HighlightBar";
import { HighlightLayer } from "./annot/HighlightLayer";
import { SelectionLayer } from "./annot/SelectionLayer";
import { highlightAt } from "./annot/highlightStyle";
import { TextLayer } from "./annot/TextLayer";
import { useHighlightTool } from "./annot/useHighlightTool";
import { useTextLines } from "./annot/useTextLines";
import { useTextSelection } from "./annot/useTextSelection";
import { useTextTool } from "./annot/useTextTool";
import type { SaveOptions, SaveProblem } from "./doc/DocStore";
import type { Tab, TabView } from "./doc/Tabs";
import { platform } from "./platform";
import { Icon } from "./ui/Icon";
import { Menu } from "./ui/Menu";
import { PageField } from "./viewer/PageField";
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
  const ts = useTextSelection(client, page);
  const overText = useTextLines(client, page);

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
  // each tool shows only its own kind of selection (page text is selected with the select tool)
  const { clear: clearTextSelection } = ts;
  useEffect(() => {
    if (tt.tool === "text") selectHighlight(null);
    if (tt.tool === "highlight") tt.select(null);
    if (tt.tool !== "select") clearTextSelection();
  }, [tt.tool, selectHighlight, clearTextSelection]); // eslint-disable-line react-hooks/exhaustive-deps -- tt.select is not memoized

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
        <Menu label={<Icon name="save" />} title="Save">
          <button onClick={() => save()}>
            <Icon name="save" />
            <span className="mi-label">Save</span>
            <kbd>Ctrl+S</kbd>
          </button>
          <button onClick={() => save({ saveAs: true })}>
            <Icon name="saveAs" />
            <span className="mi-label">Save As…</span>
            <kbd>Ctrl+Shift+S</kbd>
          </button>
          <button onClick={() => save({ full: true })}>
            <Icon name="compact" />
            <span className="mi-label">
              Save Compacted
              <span className="mi-note">Rewrites the file without its edit history, making it smaller</span>
            </span>
          </button>
        </Menu>
        <span className="sep" />
        <div className="seg" role="radiogroup" aria-label="Tool">
          {(
            [
              ["select", "select", "Select (V)"],
              ["text", "text", "Text (T)"],
              ["highlight", "highlight", "Highlight (H)"],
            ] as const
          ).map(([tool, icon, title]) => (
            <button key={tool} role="radio" aria-checked={tt.tool === tool} className={tt.tool === tool ? "active" : ""} onClick={() => tt.setTool(tool)} title={title} aria-label={title}>
              <Icon name={icon} />
            </button>
          ))}
        </div>
        <span className="sep" />
        <button className="icon-button" onClick={() => void store.undo()} disabled={!state.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-button" onClick={() => void store.redo()} disabled={!state.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        {/* always present in the text tool, so selecting never reflows the toolbar (and the page);
            it edits the selected box or, with nothing selected, the tool defaults */}
        {tt.tool !== "select" && <span className="sep" />}
        {tt.tool === "text" && <AttributeBar className="docked" value={tt.target} onChange={tt.setStyle} onStepSize={tt.stepSizeBy} />}
        {tt.tool === "highlight" && <HighlightBar className="docked" value={ht.target} onChange={ht.setStyle} />}
        <span className="spacer" />
        <SaveStatus saving={state.saving} dirty={state.dirty} lastSave={state.lastSave} />
        <PageField page={page} count={doc.info.pageCount} onGo={(p) => viewerRef.current?.goTo(p)} onDone={() => viewerRef.current?.focus()} />
        <div className="zoom-group">
          <button onClick={() => viewerRef.current?.zoomOut()} title="Zoom Out (Ctrl+-)" aria-label="Zoom out">
            <Icon name="minus" size={16} />
          </button>
          <ZoomField zoom={zoom.value} onCommit={(z) => viewerRef.current?.setZoom(z)} onDone={() => viewerRef.current?.focus()} />
          <button onClick={() => viewerRef.current?.zoomIn()} title="Zoom In (Ctrl+=)" aria-label="Zoom in">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <Menu label={<Icon name={zoom.mode === "fit-page" ? "fitPage" : zoom.mode === "fit-width" ? "fitWidth" : "actualSize"} />} title="Fit" align="right">
          <button onClick={() => viewerRef.current?.setMode("fit-page")} className={zoom.mode === "fit-page" ? "active" : ""}>
            <Icon name="fitPage" />
            <span className="mi-label">Fit Page</span>
            <kbd>Ctrl+0</kbd>
          </button>
          <button onClick={() => viewerRef.current?.setMode("fit-width")} className={zoom.mode === "fit-width" ? "active" : ""}>
            <Icon name="fitWidth" />
            <span className="mi-label">Fit Width</span>
            <kbd>Ctrl+2</kbd>
          </button>
          <button onClick={() => viewerRef.current?.setZoom(1)}>
            <Icon name="actualSize" />
            <span className="mi-label">Actual Size</span>
            <kbd>Ctrl+1</kbd>
          </button>
        </Menu>
      </header>

      {notice}

      {problem && (
        <div className="error" role="alert">
          <Icon name="alert" size={16} />
          <span className="error-text">
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
          ts.clear();
        }}
        overlay={(view) =>
          faces && (
            <>
              <HighlightLayer view={view} ht={ht} tool={tt.tool} client={client} overText={overText} />
              <TextLayer
                view={view}
                tt={tt}
                faces={faces}
                onBackgroundPress={(e, pt, toPage) =>
                  ts.press(
                    e,
                    [pt.x, pt.y],
                    (x, y) => {
                      const p = toPage(x, y);
                      return [p.x, p.y];
                    },
                    () => {
                      const hit = highlightAt(ht.highlights.filter((h) => h.page === view.page), pt.x, pt.y);
                      ht.select(hit?.id ?? null);
                    },
                  )
                }
                onBackgroundDoubleClick={(pt) => ts.selectWord([pt.x, pt.y])}
                overText={overText}
              />
              <SelectionLayer ts={ts} scale={view.scale} />
            </>
          )
        }
      />
    </>
  );
}

function SaveStatus({ saving, dirty, lastSave }: { saving: boolean; dirty: boolean; lastSave: { at: number } | null }) {
  let text = "";
  let kind = "";
  if (saving) [text, kind] = ["Saving…", "saving"];
  else if (dirty) [text, kind] = ["Edited", "edited"];
  else if (lastSave) [text, kind] = [`Saved ${new Date(lastSave.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`, "saved"];
  return <span className={`save-status ${kind}`}>{text}</span>;
}
