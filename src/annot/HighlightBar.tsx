// Color swatches, opacity slider and delete for a highlight (or the highlight tool defaults).
import type { CSSProperties } from "react";
import { Icon } from "../ui/Icon";
import { useKeepInside } from "./floating";
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
  const ref = useKeepInside(style?.left);
  return (
    <div ref={ref} className={`attr-bar ${className ?? ""}`} style={style} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
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
        title="Other color"
        aria-label="Other color"
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
        title="Opacity"
        aria-label="Opacity"
        onChange={(e) => onChange({ opacity: Number(e.currentTarget.value) / 100 }, "opacity")}
      />
      <span className="opacity-label">{pct}%</span>
      {onDelete && (
        <>
          <span className="sep" />
          <button className="danger" onClick={onDelete} title="Delete (Del)" aria-label="Delete">
            <Icon name="trash" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
