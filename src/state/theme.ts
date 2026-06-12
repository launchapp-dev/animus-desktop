import { create } from "zustand";

type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
}

function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      if ("setTheme" in win) {
        (win.setTheme as (t: string | null) => Promise<void>)(
          mode === "system" ? null : mode,
        ).catch((e) => console.warn("[theme] setTheme failed:", e));
      }
    }).catch((e) => console.warn("[theme] window api unavailable:", e));
  }
}

let mediaUnlisten: (() => void) | null = null;

export function initTheme(): void {
  const persisted = localStorage.getItem("animus-theme") as ThemeMode | null;
  const mode: ThemeMode =
    persisted === "light" || persisted === "dark" || persisted === "system"
      ? persisted
      : "system";
  useThemeStore.setState({ mode });
  applyTheme(mode);

  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const listener = () => {
    if (useThemeStore.getState().mode === "system") {
      applyTheme("system");
    }
  };
  if (mediaUnlisten) mediaUnlisten();
  mq.addEventListener("change", listener);
  mediaUnlisten = () => mq.removeEventListener("change", listener);
}

export const useThemeStore = create<ThemeState>(() => ({
  mode: "system",
  setMode: (mode: ThemeMode) => {
    localStorage.setItem("animus-theme", mode);
    useThemeStore.setState({ mode });
    applyTheme(mode);
  },
}));
