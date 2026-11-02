import { isTauri } from "@tauri-apps/api/core";
import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export const platform: Platform = isTauri() ? tauriPlatform : browserPlatform;
export * from "./types";
