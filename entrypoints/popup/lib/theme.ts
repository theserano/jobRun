export type Theme = "auto" | "light" | "dark";

const STORAGE_KEY = "jobrun-theme";

export const NEXT_THEME: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };

// localStorage rather than browser.storage so it can be read synchronously before the
// first render, which keeps the popup from flashing the wrong theme.
export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage unavailable: fall back to following the system.
  }
  return "auto";
}

// "auto" removes the attribute so the prefers-color-scheme rules in App.css take over.
export function applyTheme(theme: Theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
  try {
    if (theme === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted; the choice still applies until the popup closes.
  }
}
