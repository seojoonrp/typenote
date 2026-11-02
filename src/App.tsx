import { useCallback, useEffect, useRef, useState } from "react";
import { PdfClient, PdfError } from "./pdf/client";
import type { DocInfo } from "./pdf/protocol";
import { baseName, platform, type OpenedFile } from "./platform";
import { Viewer, type ViewerHandle, type ZoomMode } from "./viewer/Viewer";
import { ZoomField } from "./viewer/ZoomField";

type OpenDoc = { info: DocInfo; name: string; path: string | null };
type ZoomPref = { mode: ZoomMode; value: number };

// one worker for the app's lifetime (not per render: StrictMode double-invokes initializers)
let sharedClient: PdfClient | null = null;
const getClient = () => (sharedClient ??= new PdfClient());

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

export function App() {
  const client = getClient();
  const viewerRef = useRef<ViewerHandle>(null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<ZoomPref>(loadZoomPref);
  const [recentOpen, setRecentOpen] = useState(false);

  const openLoaded = useCallback(
    async (load: () => Promise<OpenedFile>, path: string | null) => {
      setBusy(true);
      setError(null);
      setRecentOpen(false);
      try {
        const file = await load();
        const info = await client.open(file.bytes);
        setDoc({ info, name: file.name, path: file.path });
        setPage(0);
        platform.setTitle(`${file.name} — typenote`);
        if (file.path) setRecent(await platform.addRecentFile(file.path));
      } catch (e) {
        const reason = e instanceof PdfError ? e.message : `파일을 열 수 없습니다 (${e instanceof Error ? e.message : String(e)})`;
        setError(path ? `${baseName(path)}: ${reason}` : reason);
        if (path && !(e instanceof PdfError)) setRecent(await platform.removeRecentFile(path));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const openPath = useCallback((path: string) => openLoaded(() => platform.readPath(path), path), [openLoaded]);

  const pick = useCallback(async () => {
    const file = await platform.pickPdf().catch((e: unknown) => {
      setError(String(e));
      return null;
    });
    if (file) void openLoaded(async () => file, file.path);
  }, [openLoaded]);

  // launch file, recent list, drag & drop
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

  // focus the pages so arrow keys / PageUp / PageDown scroll right away
  useEffect(() => {
    if (doc) viewerRef.current?.focus();
  }, [doc]);

  // shortcuts (never while an IME is composing). Zoom keys are always swallowed so WebView2
  // never zooms the UI itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (!e.ctrlKey || e.altKey) return;
      const v = viewerRef.current;
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
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void pick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  const onZoomChange = useCallback((value: number, mode: ZoomMode) => {
    setZoom({ value, mode });
    saveZoomPref({ value, mode });
  }, []);

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void pick()} disabled={busy} title="열기 (Ctrl+O)">
          열기
        </button>
        <div className="menu">
          <button onClick={() => setRecentOpen((o) => !o)} disabled={recent.length === 0} aria-expanded={recentOpen}>
            최근 파일 ▾
          </button>
          {recentOpen && (
            <ul className="menu-list" onMouseLeave={() => setRecentOpen(false)}>
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
        </div>
        <span className="title">{doc ? doc.name : ""}</span>
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
            <button onClick={() => viewerRef.current?.setMode("fit-page")} className={zoom.mode === "fit-page" ? "active" : ""} title="쪽 맞춤 (Ctrl+0)">
              쪽 맞춤
            </button>
            <button onClick={() => viewerRef.current?.setMode("fit-width")} className={zoom.mode === "fit-width" ? "active" : ""} title="폭 맞춤 (Ctrl+2)">
              폭 맞춤
            </button>
          </>
        )}
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(null)}>닫기</button>
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
