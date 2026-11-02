// Line icons for the toolbar, tabs and menus: a 24-unit grid, stroked in currentColor.
import type { ReactNode } from "react";

const PATHS = {
  open: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  recent: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.75V12l2.75 1.75" />
    </>
  ),
  save: <path d="M12 4v10.5M7.75 10.25 12 14.5l4.25-4.25M4.5 15.5v2.75A1.75 1.75 0 0 0 6.25 20h11.5a1.75 1.75 0 0 0 1.75-1.75V15.5" />,
  saveAs: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M12 11.5v6M9 14.5h6" />
    </>
  ),
  compact: <path d="M4.5 7h15M7 12h10M9.5 17h5" />,
  chevron: <path d="m7.5 10 4.5 4.5 4.5-4.5" />,
  select: (
    <>
      <path d="M6 4.5 18.5 10.25 13 12l-2.25 5.5z" />
      <path d="m13 12 4.5 4.5" />
    </>
  ),
  text: <path d="M5.5 7V5h13v2M12 5v14M9.25 19h5.5" />,
  highlight: (
    <>
      <path d="m14.5 4.5 5 5-7 7h-5v-5z" />
      <path d="M4 20h9" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4.5 9.5 9 5" />
      <path d="M4.5 9.5H15a4.75 4.75 0 0 1 0 9.5h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 4.5-4.5L15 5" />
      <path d="M19.5 9.5H9a4.75 4.75 0 0 0 0 9.5h3" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  plus: <path d="M12 6v12M6 12h12" />,
  fitPage: (
    <>
      <rect x="6.5" y="3.5" width="11" height="17" rx="1.5" />
      <path d="M9.75 9 12 6.75 14.25 9M9.75 15 12 17.25 14.25 15" />
    </>
  ),
  fitWidth: (
    <>
      <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />
      <path d="M9 9.75 6.75 12 9 14.25M15 9.75 17.25 12 15 14.25" />
    </>
  ),
  actualSize: <path d="M6.5 9.5 8.5 8v8M15.5 9.5l2-1.5v8M12 10.5v.01M12 13.5v.01" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  trash: <path d="M4.5 7h15M9.5 7V5.25A1.25 1.25 0 0 1 10.75 4h2.5a1.25 1.25 0 0 1 1.25 1.25V7M6.5 7l.75 11.5A1.5 1.5 0 0 0 8.75 20h6.5a1.5 1.5 0 0 0 1.5-1.5L17.5 7M10 11v5M14 11v5" />,
  file: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.6 4.6a1.6 1.6 0 0 1 2.8 0l7.2 12.7a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z" />
      <path d="M12 10v3.75M12 16.75v.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  check: <path d="m5.5 12.5 4 4 9-9" />,
  drop: <path d="M12 15.5V4.5M7.75 8.75 12 4.5l4.25 4.25M4.5 15.5v2.75A1.75 1.75 0 0 0 6.25 20h11.5a1.75 1.75 0 0 0 1.75-1.75V15.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
