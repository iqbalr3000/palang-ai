"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme } from "@/lib/theme";

/** Keeps every page on the right theme after load: OS theme changes and choices made in other
 * tabs. Mounted once, in the root layout. */
export function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readStoredTheme() === "system") applyTheme("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) applyTheme(readStoredTheme());
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
