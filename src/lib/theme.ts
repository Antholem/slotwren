/*
 * Light, dark or the system's choice. The preference lives in localStorage
 * (no cookie, so pages stay static); THEME_SCRIPT applies it in <head>
 * before the first paint, so there's no flash of the wrong theme.
 */

export const THEME_STORAGE_KEY = "sw-theme";
export const THEME_EVENT = "sw-theme-change";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const isPreference = (value: unknown): value is ThemePreference =>
  (THEME_PREFERENCES as readonly unknown[]).includes(value);

/** Inline in <head>: same logic as applyTheme(), as plain ES5. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Put the preference on <html>: the `dark` class and native controls' colour scheme. */
export function applyTheme(preference: ThemePreference = readThemePreference()) {
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode: still apply it for this page.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}
