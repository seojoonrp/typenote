// The window's top strip: the mark, one tab per open document (name, unsaved dot, save problem,
// close) and a button that opens another file. Middle click closes a tab too.
import { useSyncExternalStore } from "react";
import type { Tab } from "../doc/Tabs";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";

type Props = { tabs: Tab[]; activeId: number | null; onActivate(tab: Tab): void; onClose(tab: Tab): void; onOpen(): void };

export function TabBar({ tabs, activeId, onActivate, onClose, onOpen }: Props) {
  return (
    <nav className="tabbar" role="tablist">
      <span className="tabbar-mark">
        <LogoMark size={22} />
      </span>
      {tabs.map((t) => (
        <TabItem key={t.id} tab={t} active={t.id === activeId} onActivate={() => onActivate(t)} onClose={() => onClose(t)} />
      ))}
      <button className="tab-new" title="Open a PDF (Ctrl+O)" aria-label="Open a PDF" onClick={onOpen}>
        <Icon name="plus" size={16} />
      </button>
    </nav>
  );
}

function TabItem({ tab, active, onActivate, onClose }: { tab: Tab; active: boolean; onActivate(): void; onClose(): void }) {
  const { doc, dirty, saveProblem } = useSyncExternalStore(tab.store.subscribe, tab.store.getState);
  const name = doc?.name ?? "…";
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab${active ? " active" : ""}${dirty ? " dirty" : ""}`}
      title={doc?.path ?? name}
      onClick={onActivate}
      // middle button: no autoscroll, close on release
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
    >
      {saveProblem ? (
        <span className="tab-problem" title={`Not saved: ${saveProblem.message}`}>
          <Icon name="alert" size={14} />
        </span>
      ) : (
        <span className="tab-icon">
          <Icon name="file" size={14} />
        </span>
      )}
      <span className="tab-name">{name}</span>
      <button
        className="tab-close"
        title={dirty ? "Unsaved changes · Close (Ctrl+W)" : "Close (Ctrl+W)"}
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <span className="tab-dot" />
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
