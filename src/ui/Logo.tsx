// The typenote mark: a red tile, a white page with a folded corner, a red T over a highlighted
// line (typing + highlighting on PDFs). Same drawing as src-tauri/icons/source.svg.

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="64 64 896 896" aria-hidden="true">
      <defs>
        <linearGradient id="tn-logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4454b" />
          <stop offset="1" stopColor="#c3111a" />
        </linearGradient>
        <radialGradient id="tn-logo-sheen" cx="0.25" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#tn-logo-tile)" />
      <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#tn-logo-sheen)" />
      <path d="M338 214H612L742 344V770Q742 826 686 826H338Q282 826 282 770V270Q282 214 338 214Z" fill="#7a0a10" opacity="0.28" transform="translate(10 18)" />
      <path d="M338 214H612L742 344V770Q742 826 686 826H338Q282 826 282 770V270Q282 214 338 214Z" fill="#fff" />
      <path d="M612 214V312Q612 344 644 344H742Z" fill="#f7b4b7" />
      <rect x="346" y="588" width="332" height="118" rx="20" fill="#ffc4c6" />
      <rect x="372" y="410" width="280" height="84" rx="16" fill="#d4161e" />
      <rect x="470" y="410" width="84" height="320" rx="16" fill="#d4161e" />
    </svg>
  );
}
