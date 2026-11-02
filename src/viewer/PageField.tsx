// "n / m" whose n turns into a text field when clicked: Enter (or leaving the field) goes to that
// page, Esc cancels. Out-of-range numbers go to the first or last page.
import { useRef, useState } from "react";

type Props = { page: number; count: number; onGo(page: number): void; onDone(): void };

export function PageField({ page, count, onGo, onDone }: Props) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    const n = cancelled.current ? NaN : parseInt(text ?? "", 10);
    setText(null);
    if (Number.isFinite(n)) onGo(Math.min(count, Math.max(1, n)) - 1);
    onDone();
  };

  return (
    <span className="pages">
      {text === null ? (
        <button
          className="page-num"
          title="Go to page"
          onClick={() => {
            cancelled.current = false;
            setText(String(page + 1));
          }}
        >
          {page + 1}
        </button>
      ) : (
        <input
          className="page-num"
          autoFocus
          inputMode="numeric"
          aria-label="Page number"
          value={text}
          style={{ width: `${String(count).length + 2}ch` }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.currentTarget.value.replace(/\D/g, ""))}
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
      )}
      {" / "}
      {count}
    </span>
  );
}
