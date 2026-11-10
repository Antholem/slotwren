import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  readThemePreference,
  saveThemePreference,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/*
 * A minimal browser for lib/theme.ts: <html> with a class list and style,
 * localStorage, matchMedia and window events. (Runs in the node project.)
 */
const classes = new Set<string>();
const html = {
  classList: {
    toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    contains: (name: string) => classes.has(name),
  },
  style: { colorScheme: "" },
};
const store = new Map<string, string>();
vi.stubGlobal("document", { documentElement: html });
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});
const events = new EventTarget();
vi.stubGlobal("window", {
  matchMedia: (query: string) => globalThis.matchMedia(query),
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
});

/** Pretend the OS is in light or dark mode. */
function systemPrefers(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark && query === "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const isDark = () => classes.has("dark");

describe("theme", () => {
  beforeEach(() => {
    store.clear();
    classes.clear();
    html.style.colorScheme = "";
  });

  it("follows the system by default", () => {
    systemPrefers(true);
    expect(readThemePreference()).toBe("system");
    applyTheme();
    expect(isDark()).toBe(true);
    expect(html.style.colorScheme).toBe("dark");

    systemPrefers(false);
    applyTheme();
    expect(isDark()).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("an explicit choice wins over the system, and System clears it", () => {
    systemPrefers(true);
    saveThemePreference("light");
    expect(store.get(THEME_STORAGE_KEY)).toBe("light");
    expect(isDark()).toBe(false);

    systemPrefers(false);
    saveThemePreference("dark");
    expect(isDark()).toBe(true);

    saveThemePreference("system");
    expect(store.get(THEME_STORAGE_KEY)).toBeUndefined();
    expect(isDark()).toBe(false);
  });

  it("ignores junk in storage", () => {
    store.set(THEME_STORAGE_KEY, "purple");
    expect(readThemePreference()).toBe("system");
  });

  it("the <head> script does the same before React loads", () => {
    systemPrefers(false);
    store.set(THEME_STORAGE_KEY, "dark");
    new Function(THEME_SCRIPT)();
    expect(isDark()).toBe(true);

    store.delete(THEME_STORAGE_KEY);
    systemPrefers(true);
    classes.clear();
    new Function(THEME_SCRIPT)();
    expect(isDark()).toBe(true);
  });
});
