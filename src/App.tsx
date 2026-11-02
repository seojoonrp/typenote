// The window: one tab per open document. Opens files (dialog, recent list, drag and drop,
// launch and the .pdf association, each as a new tab), closes them, and shows the start screen.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DocumentView, initialView } from "./DocumentView";
import { pathKey, Tabs, type Tab } from "./doc/Tabs";
import { PdfError } from "./pdf/client";
import type { TextBoxInput } from "./pdf/engine/model";
import { baseName, platform, type OpenedFile } from "./platform";
import { Menu } from "./ui/Menu";
import { TabBar } from "./ui/TabBar";

// one tab list for the app's lifetime (not per render: StrictMode double-invokes initializers).
// The tabs' stores leave the window title alone; the shown document sets it.
let sharedTabs: Tabs | null = null;
const getTabs = () =>
  (sharedTabs ??= new Tabs({
    writePdf: platform.writePdf,
    pickSavePath: platform.pickSavePath,
    addRecentFile: platform.addRecentFile,
    setTitle: () => {},
  }));

/** Ctrl + these zoom the shown document, never the UI itself */
const ZOOM_KEYS = new Set(["=", "+", "-", "0", "1", "2"]);

/** Saves the tabs' edits; if some could not be saved, asks before letting them go. */
async function settle(list: Tab[]): Promise<boolean> {
  const failed: string[] = [];
  for (const t of list) {
    const s = t.store.getState();
    if (s.dirty && !(await t.store.save())) failed.push(s.doc?.name ?? "untitled");
  }
  if (failed.length === 0) return true;
  return platform.ask(`Changes to ${failed.join(", ")} could not be saved. Close without saving them?`, "Close", "Cancel");
}

export function App() {
  const tabs = getTabs();
  const { tabs: list, activeId } = useSyncExternalStore(tabs.subscribe, tabs.getState);
  const active = list.find((t) => t.id === activeId) ?? null;
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(0);
  /** paths being opened, so a second request for the same file does not open it twice */
  const openingPaths = useRef(new Set<string>());

  /** Opens a file as a new tab, or shows the tab that already has it. */
  const openLoaded = useCallback(
    async (load: () => Promise<OpenedFile>, path: string | null) => {
      if (path) {
        const existing = tabs.findByPath(path);
        if (existing) return tabs.activate(existing.id);
        if (openingPaths.current.has(pathKey(path))) return;
        openingPaths.current.add(pathKey(path));
      }
      setOpening((n) => n + 1);
      setError(null);
      const tab = tabs.create(initialView());
      try {
        const file = await load();
        await tab.store.open(file);
        tabs.add(tab);
        if (file.path) setRecent(await platform.addRecentFile(file.path));
      } catch (e) {
        tab.dispose();
        const reason = e instanceof PdfError ? e.message : `Could not open the file (${e instanceof Error ? e.message : String(e)})`;
        setError(path ? `${baseName(path)}: ${reason}` : reason);
        if (path && !(e instanceof PdfError)) setRecent(await platform.removeRecentFile(path));
      } finally {
        if (path) openingPaths.current.delete(pathKey(path));
        setOpening((n) => n - 1);
      }
    },
    [tabs],
  );

  const openPath = useCallback((path: string) => openLoaded(() => platform.readPath(path), path), [openLoaded]);

  const pick = useCallback(async () => {
    const file = await platform.pickPdf().catch((e: unknown) => {
      setError(String(e));
      return null;
    });
    if (file) void openLoaded(async () => file, file.path);
  }, [openLoaded]);

  const closeTab = useCallback(
    async (tab: Tab) => {
      tab.flush();
      if (await settle([tab])) tabs.remove(tab.id);
    },
    [tabs],
  );

  // launch files and files opened while running, recent list, drag & drop, closing the window
  useEffect(() => {
    void platform.recentFiles().then(setRecent);
  }, []);
  // one after another, so the tabs come in the order the files were given
  const openQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(
    () =>
      platform.onOpenRequest((p) => {
        openQueue.current = openQueue.current.then(() => openPath(p));
      }),
    [openPath],
  );
  useEffect(() => platform.onFileDrop((load, path) => void openLoaded(load, path)), [openLoaded]);
  useEffect(
    () =>
      platform.onCloseRequested(() => {
        tabs.active?.flush();
        return settle(tabs.getState().tabs);
      }),
    [tabs],
  );
  useEffect(() => {
    if (!active) platform.setTitle("typenote");
  }, [active]);

  // window shortcuts (never while an IME is composing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      // reloading the page would drop the open tabs
      if (!import.meta.env.DEV && (e.key === "F5" || (e.ctrlKey && e.code === "KeyR"))) {
        e.preventDefault();
        return;
      }
      if (!e.ctrlKey || e.altKey) return;
      if (ZOOM_KEYS.has(e.key)) {
        e.preventDefault();
      } else if (e.code === "KeyO") {
        e.preventDefault();
        void pick();
      } else if (e.code === "KeyW") {
        e.preventDefault();
        if (tabs.active) void closeTab(tabs.active);
      } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        tabs.cycle(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, pick, closeTab]);

  // development hook for scripted checks (tools/): window.__typenote.store (the shown tab's), openPath()
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __typenote: unknown }).__typenote = {
      tabs,
      get store() {
        return tabs.active?.store ?? null;
      },
      openPath,
      addTestBox: (patch: Partial<TextBoxInput> = {}) => {
        const t = tabs.active;
        return t?.store.putTextBox({ page: t.view.page, x: 60, y: 60, text: "테스트 상자 Test 123\n둘째 줄", size: 14, weight: "regular", color: [0.1, 0.2, 0.8], ...patch });
      },
    };
  }, [tabs, openPath]);

  const toolbarStart = (
    <>
      <button onClick={() => void pick()} title="Open (Ctrl+O)">
        Open
      </button>
      <Menu label="Recent ▾" disabled={recent.length === 0} wide>
        {recent.map((p) => (
          <button key={p} onClick={() => void openPath(p)} title={p}>
            {baseName(p)}
            <span className="dim">{p}</span>
          </button>
        ))}
      </Menu>
    </>
  );

  const notice = error && (
    <div className="error" role="alert">
      {error}
      <button onClick={() => setError(null)}>Dismiss</button>
    </div>
  );

  return (
    <div className="app">
      {list.length > 0 && <TabBar tabs={list} activeId={activeId} onActivate={(t) => tabs.activate(t.id)} onClose={(t) => void closeTab(t)} />}
      {active ? (
        <DocumentView key={active.id} tab={active} toolbarStart={toolbarStart} notice={notice} />
      ) : (
        <>
          <header className="toolbar">{toolbarStart}</header>
          {notice}
          <main className="start">
            <button className="primary" onClick={() => void pick()} disabled={opening > 0}>
              {opening > 0 ? "Opening…" : "Open PDF"}
            </button>
            <p className="dim">or drop a PDF file onto the window</p>
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
        </>
      )}
    </div>
  );
}
