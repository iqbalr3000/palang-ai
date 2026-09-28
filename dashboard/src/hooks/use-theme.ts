"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, type Theme } from "@/lib/theme";

/** The stored theme choice (null until mounted: it only exists in the browser) and a setter.
 * Following the OS and other tabs is ThemeSync's job; this only keeps the choice in sync. */
export function useTheme(): [Theme | null, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readStoredTheme());
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setTheme(readStoredTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    applyTheme(next);
  }

  return [theme, choose];
}
