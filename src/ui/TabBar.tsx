// One tab per open document: name, unsaved marker, a save problem marker and a close button.
// Middle click closes too.
import { useSyncExternalStore } from "react";
import type { Tab } from "../doc/Tabs";

type Props = { tabs: Tab[]; activeId: number | null; onActivate(tab: Tab): void; onClose(tab: Tab): void };

export function TabBar({ tabs, activeId, onActivate, onClose }: Props) {
  return (
    <nav className="tabbar" role="tablist">
      {tabs.map((t) => (
        <TabItem key={t.id} tab={t} active={t.id === activeId} onActivate={() => onActivate(t)} onClose={() => onClose(t)} />
      ))}
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
      className={`tab${active ? " active" : ""}`}
      title={doc?.path ?? name}
      onClick={onActivate}
      // middle button: no autoscroll, close on release
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
    >
      {saveProblem && (
        <span className="tab-problem" title={`Not saved: ${saveProblem.message}`}>
          !
        </span>
      )}
      <span className="tab-name">
        {dirty ? "• " : ""}
        {name}
      </span>
      <button
        className="tab-close"
        title="Close (Ctrl+W)"
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
