import type { GUIConfig } from "./api";

export type ThemePref = GUIConfig["theme"];

// The last theme applied, kept so index.html can set it before first
// paint instead of flashing dark while the config loads.
const STORAGE_KEY = "parallax-theme";

let media: MediaQueryList | null = null;
let followSystem: (() => void) | null = null;

function set(light: boolean) {
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

/**
 * applyTheme sets <html data-theme> from the saved preference. "system"
 * follows the OS theme, including later switches.
 */
export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable: index.html falls back to the system theme */
  }
  if (media && followSystem) media.removeEventListener("change", followSystem);
  media = null;
  followSystem = null;

  if (pref === "system") {
    media = window.matchMedia("(prefers-color-scheme: light)");
    followSystem = () => set(media!.matches);
    media.addEventListener("change", followSystem);
    followSystem();
  } else {
    set(pref === "light");
  }
}
