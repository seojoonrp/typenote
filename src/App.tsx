import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AttributeBar } from "./annot/AttributeBar";
import { useFaces } from "./annot/fonts";
import { TextLayer } from "./annot/TextLayer";
import { useTextTool } from "./annot/useTextTool";
import { DocStore, type SaveOptions, type SaveProblem } from "./doc/DocStore";
import { PdfClient, PdfError } from "./pdf/client";
import type { TextBoxInput } from "./pdf/engine/model";
import { baseName, platform, type OpenedFile } from "./platform";
import { Viewer, type ViewerHandle, type ZoomMode } from "./viewer/Viewer";
import { ZoomField } from "./viewer/ZoomField";

type ZoomPref = { mode: ZoomMode; value: number };

// one worker and one document store for the app's lifetime (not per render: StrictMode
// double-invokes initializers)
let sharedClient: PdfClient | null = null;
let sharedStore: DocStore | null = null;
const getClient = () => (sharedClient ??= new PdfClient());
const getStore = () => (sharedStore ??= new DocStore(getClient(), platform));

// the zoom mode (or custom %) carries over to the next document and the next launch
const ZOOM_KEY = "typenote.zoom";
function loadZoomPref(): ZoomPref {
  try {
    const p = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? "null") as ZoomPref | null;
    if (p && ["fit-page", "fit-width", "custom"].includes(p.mode) && p.value > 0) return p;
  } catch {
    // unreadable storage: use the default
  }
  return { mode: "fit-width", value: 1 };
}
function saveZoomPref(p: ZoomPref) {
  try {
    localStorage.setItem(ZOOM_KEY, JSON.stringify(p));
  } catch {
    // not remembered; harmless
  }
}

const PROBLEM_TEXT: Record<SaveProblem["kind"], string> = {
  locked: "다른 프로그램이 이 파일을 열고 있어서 저장하지 못했습니다. 그 프로그램에서 파일을 닫으면 자동으로 다시 저장합니다.",
  conflict: "열어 둔 사이에 다른 곳에서 파일이 바뀌었습니다. 자동 저장을 멈췄습니다.",
  readonly: "읽기 전용 파일이라 저장할 수 없습니다.",
  io: "저장하지 못했습니다.",
  failed: "저장하지 못했습니다.",
};

export function App() {
  const client = getClient();
  const store = getStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { doc } = state;
  const viewerRef = useRef<ViewerHandle>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<ZoomPref>(loadZoomPref);

  /** Unsaved edits: try to save; if that fails, ask before throwing them away. */
  const settleUnsaved = useCallback(
    async (action: string) => {
      if (!store.getState().dirty || (await store.save())) return true;
      return platform.ask(`저장하지 못한 변경 사항이 있습니다. 저장하지 않고 ${action}?`, action.replace(/까요$/, ""), "취소");
    },
    [store],
  );

  const openLoaded = useCallback(
    async (load: () => Promise<OpenedFile>, path: string | null) => {
      if (!(await settleUnsaved("다른 파일을 열까요"))) return;
      setBusy(true);
      setError(null);
      try {
        const file = await load();
        await store.open(file);
        setPage(0);
        if (file.path) setRecent(await platform.addRecentFile(file.path));
      } catch (e) {
        const reason = e instanceof PdfError ? e.message : `파일을 열 수 없습니다 (${e instanceof Error ? e.message : String(e)})`;
        setError(path ? `${baseName(path)}: ${reason}` : reason);
        if (path && !(e instanceof PdfError)) setRecent(await platform.removeRecentFile(path));
      } finally {
        setBusy(false);
      }
    },
    [store, settleUnsaved],
  );

  const openPath = useCallback((path: string) => openLoaded(() => platform.readPath(path), path), [openLoaded]);

  const pick = useCallback(async () => {
    const file = await platform.pickPdf().catch((e: unknown) => {
      setError(String(e));
      return null;
    });
    if (file) void openLoaded(async () => file, file.path);
  }, [openLoaded]);

  const save = useCallback((opts?: SaveOptions) => void store.save(opts), [store]);

  // launch file, recent list, drag & drop, closing with unsaved edits
  const launched = useRef(false);
  useEffect(() => {
    void platform.recentFiles().then(setRecent);
    if (!launched.current) {
      launched.current = true;
      void platform.launchPath().then((p) => {
        if (p) void openPath(p);
      });
    }
    return platform.onFileDrop((load) => void openLoaded(load, null));
  }, [openPath, openLoaded]);
  useEffect(() => platform.onCloseRequested(() => settleUnsaved("닫을까요")), [settleUnsaved]);

  const faces = useFaces();
  const tt = useTextTool(store, faces, page);

  // focus the pages so arrow keys / PageUp / PageDown work right away
  const docId = doc?.info.docId;
  useEffect(() => {
    if (docId !== undefined) viewerRef.current?.focus();
  }, [docId]);

  // shortcuts (never while an IME is composing). Zoom keys are always swallowed so WebView2
  // never zooms the UI itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (!e.ctrlKey || e.altKey) return;
      const v = viewerRef.current;
      const key = e.key.toLowerCase();
      const zoomKeys: Record<string, (() => void) | null | undefined> = {
        "=": v?.zoomIn,
        "+": v?.zoomIn,
        "-": v?.zoomOut,
        "0": v && (() => v.setMode("fit-page")),
        "1": v && (() => v.setZoom(1)),
        "2": v && (() => v.setMode("fit-width")),
      };
      if (e.key in zoomKeys) {
        e.preventDefault();
        zoomKeys[e.key]?.();
      } else if (key === "o") {
        e.preventDefault();
        void pick();
      } else if (key === "s") {
        e.preventDefault();
        save(e.shiftKey ? { saveAs: true } : undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, save]);

  // development hook for scripted checks (tools/): window.__typenote.addTestBox()
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __typenote: unknown }).__typenote = {
      store,
      addTestBox: (patch: Partial<TextBoxInput> = {}) =>
        store.putTextBox({ page: pageRef.current, x: 60, y: 60, text: "테스트 상자 Test 123\n둘째 줄", size: 14, weight: "regular", color: [0.1, 0.2, 0.8], ...patch }),
    };
  }, [store]);

  const onZoomChange = useCallback((value: number, mode: ZoomMode) => {
    setZoom({ value, mode });
    saveZoomPref({ value, mode });
  }, []);

  const problem = state.saveProblem;

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void pick()} disabled={busy} title="열기 (Ctrl+O)">
          열기
        </button>
        <Menu label="최근 ▾" disabled={recent.length === 0} wide>
          {recent.map((p) => (
            <button key={p} onClick={() => void openPath(p)} title={p}>
              {baseName(p)}
              <span className="dim">{p}</span>
            </button>
          ))}
        </Menu>
        {doc && (
          <Menu label="저장 ▾">
            <button onClick={() => save()}>
              저장<span className="dim">Ctrl+S</span>
            </button>
            <button onClick={() => save({ saveAs: true })}>
              다른 이름으로 저장…<span className="dim">Ctrl+Shift+S</span>
            </button>
            <button onClick={() => save({ full: true })}>
              정리하여 저장<span className="dim">쌓인 변경 기록을 정리해 파일 크기를 줄입니다</span>
            </button>
          </Menu>
        )}
        {doc && (
          <>
            <span className="sep" />
            <button className={tt.tool === "select" ? "active" : ""} onClick={() => tt.setTool("select")} title="선택 (V)">
              선택
            </button>
            <button className={tt.tool === "text" ? "active" : ""} onClick={() => tt.setTool("text")} title="텍스트 (T)">
              텍스트
            </button>
            <span className="sep" />
            <button onClick={() => void store.undo()} disabled={!state.canUndo} title="실행 취소 (Ctrl+Z)">
              ↶
            </button>
            <button onClick={() => void store.redo()} disabled={!state.canRedo} title="다시 실행 (Ctrl+Y)">
              ↷
            </button>
            {/* always present in the text tool, so selecting never reflows the toolbar (and the page);
                it edits the selected box or, with nothing selected, the tool defaults */}
            {tt.tool === "text" && <AttributeBar className="docked" value={tt.target} onChange={tt.setStyle} onStepSize={tt.stepSizeBy} />}
          </>
        )}
        <span className="title">{doc ? doc.name : ""}</span>
        {doc && <SaveStatus saving={state.saving} dirty={state.dirty} lastSave={state.lastSave} />}
        <span className="spacer" />
        {doc && (
          <>
            <span className="pages">
              {page + 1} / {doc.info.pageCount}
            </span>
            <button onClick={() => viewerRef.current?.zoomOut()} title="축소 (Ctrl+-)">
              −
            </button>
            <ZoomField zoom={zoom.value} onCommit={(z) => viewerRef.current?.setZoom(z)} onDone={() => viewerRef.current?.focus()} />
            <button onClick={() => viewerRef.current?.zoomIn()} title="확대 (Ctrl+=)">
              +
            </button>
            <Menu label={zoom.mode === "fit-page" ? "쪽 맞춤 ▾" : zoom.mode === "fit-width" ? "폭 맞춤 ▾" : "맞춤 ▾"} align="right">
              <button onClick={() => viewerRef.current?.setMode("fit-page")} className={zoom.mode === "fit-page" ? "active" : ""}>
                쪽 맞춤<span className="dim">Ctrl+0</span>
              </button>
              <button onClick={() => viewerRef.current?.setMode("fit-width")} className={zoom.mode === "fit-width" ? "active" : ""}>
                폭 맞춤<span className="dim">Ctrl+2</span>
              </button>
              <button onClick={() => viewerRef.current?.setZoom(1)}>
                실제 크기 (100%)<span className="dim">Ctrl+1</span>
              </button>
            </Menu>
          </>
        )}
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(null)}>닫기</button>
        </div>
      )}

      {problem && (
        <div className="error" role="alert">
          <span>
            {PROBLEM_TEXT[problem.kind]} <span className="dim">({problem.message})</span>
          </span>
          {(problem.kind === "locked" || problem.kind === "io" || problem.kind === "failed") && <button onClick={() => save()}>다시 시도</button>}
          {problem.kind === "conflict" && <button onClick={() => save({ overwrite: true })}>덮어쓰기</button>}
          <button onClick={() => save({ saveAs: true })}>다른 이름으로 저장…</button>
          <button onClick={() => store.dismissProblem()}>닫기</button>
        </div>
      )}

      {doc ? (
        <Viewer
          key={doc.info.docId}
          ref={viewerRef}
          client={client}
          doc={doc.info}
          initialMode={zoom.mode}
          initialZoom={zoom.value}
          onPageChange={setPage}
          onZoomChange={onZoomChange}
          overlay={(view) => faces && <TextLayer view={view} tt={tt} faces={faces} />}
        />
      ) : (
        <main className="start">
          <button className="primary" onClick={() => void pick()} disabled={busy}>
            PDF 열기
          </button>
          <p className="dim">또는 PDF 파일을 창에 끌어다 놓으세요</p>
          {recent.length > 0 && (
            <ul className="recent">
              {recent.map((p) => (
                <li key={p}>
                  <button onClick={() => void openPath(p)} title={p}>
                    {baseName(p)}
                    <span className="dim">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </div>
  );
}

function SaveStatus({ saving, dirty, lastSave }: { saving: boolean; dirty: boolean; lastSave: { at: number } | null }) {
  let text = "";
  if (saving) text = "저장 중…";
  else if (dirty) text = "수정됨";
  else if (lastSave) text = `저장됨 ${new Date(lastSave.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  return <span className="save-status dim">{text}</span>;
}

/** Dropdown: a button and a list of buttons; closes on pick, mouse leave or Esc. */
function Menu({ label, disabled, wide, align, children }: { label: string; disabled?: boolean; wide?: boolean; align?: "right"; children: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onMouseLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <ul className={`menu-list${wide ? " wide" : ""}${align === "right" ? " right" : ""}`} onClick={() => setOpen(false)}>
          {children.map((child, i) => (
            <li key={i}>{child}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
