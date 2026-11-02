// Window-wide input state for zoom handling.
//
// WebView2 pinch-zoom is enabled (tauri.conf.json zoomHotkeysEnabled: true) because with it
// disabled, touchpad pinches never reach the page. Chromium delivers a touchpad pinch as wheel
// events with ctrlKey set, so the browser must never be allowed to act on a ctrl+wheel itself.

let ctrlHeld = false;
let installed = false;

export function installInputGuards() {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Control") ctrlHeld = true;
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.key === "Control") ctrlHeld = false;
  }, true);
  window.addEventListener("blur", () => {
    ctrlHeld = false;
  });
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { capture: true, passive: false },
  );
}

/**
 * A touchpad pinch: ctrl+wheel while no Ctrl key is physically down. Pinch steps are small;
 * a large delta is a mouse wheel with Ctrl held while the window was unfocused.
 */
export const isPinch = (e: WheelEvent) => e.ctrlKey && !ctrlHeld && Math.abs(e.deltaY) < 50;
