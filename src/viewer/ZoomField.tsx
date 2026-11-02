// Zoom percentage that turns into a text field when clicked. Enter or leaving the field
// applies it, Esc cancels.
import { useRef, useState } from "react";
import { parseZoomPercent } from "./zoom";

type Props = { zoom: number; onCommit(zoom: number): void; onDone(): void };

export function ZoomField({ zoom, onCommit, onDone }: Props) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const label = `${Math.round(zoom * 100)}%`;

  if (text === null) {
    return (
      <button
        className="zoom"
        title="배율 입력"
        onClick={() => {
          cancelled.current = false;
          setText(String(Math.round(zoom * 100)));
        }}
      >
        {label}
      </button>
    );
  }

  const finish = () => {
    const z = cancelled.current ? null : parseZoomPercent(text);
    setText(null);
    if (z !== null) onCommit(z);
    onDone();
  };

  return (
    <input
      className="zoom"
      autoFocus
      inputMode="decimal"
      aria-label="배율 (%)"
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={finish}
    />
  );
}
