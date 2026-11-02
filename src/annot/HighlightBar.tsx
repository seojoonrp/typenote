// Color swatches, opacity slider and delete for a highlight (or the highlight tool defaults).
import type { CSSProperties } from "react";
import { HIGHLIGHT_COLORS, type HighlightStyle } from "./highlightStyle";
import { cssColor, hexToRgb, rgbToHex, sameColor } from "./style";

type Props = {
  value: HighlightStyle;
  onChange(patch: Partial<HighlightStyle>, merge?: string): void;
  onDelete?: () => void;
  className?: string;
  style?: CSSProperties;
};

export function HighlightBar({ value, onChange, onDelete, className, style }: Props) {
  const pct = Math.round(value.opacity * 100);
  return (
    <div className={`attr-bar ${className ?? ""}`} style={style} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {HIGHLIGHT_COLORS.map((p) => (
        <button
          key={p.name}
          className={`swatch${sameColor(p.color, value.color) ? " active" : ""}`}
          style={{ background: cssColor(p.color) }}
          title={p.name}
          aria-label={p.name}
          onClick={() => onChange({ color: p.color })}
        />
      ))}
      <input
        type="color"
        className="picker"
        title="다른 색"
        aria-label="다른 색"
        value={rgbToHex(value.color)}
        onChange={(e) => onChange({ color: hexToRgb(e.currentTarget.value) }, "color")}
      />
      <span className="sep" />
      <input
        type="range"
        className="opacity"
        min={10}
        max={100}
        step={10}
        value={pct}
        title="진하기"
        aria-label="진하기"
        onChange={(e) => onChange({ opacity: Number(e.currentTarget.value) / 100 }, "opacity")}
      />
      <span className="opacity-label">{pct}%</span>
      {onDelete && (
        <>
          <span className="sep" />
          <button onClick={onDelete} title="삭제 (Delete)">
            삭제
          </button>
        </>
      )}
    </div>
  );
}
