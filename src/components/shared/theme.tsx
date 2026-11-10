"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  applyTheme,
  readThemePreference,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The saved preference; "system" while rendering on the server. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference, () => "system");
}

/**
 * Keeps <html> in step after the first paint: the system switching between
 * light and dark, and a choice made in another tab. Renders nothing.
 */
export function ThemeWatcher() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme();
    media.addEventListener("change", update);
    const unsubscribe = subscribe(update);
    return () => {
      media.removeEventListener("change", update);
      unsubscribe();
    };
  }, []);
  return null;
}
