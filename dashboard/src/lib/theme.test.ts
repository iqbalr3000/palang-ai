import { afterEach, expect, test } from "bun:test";
import { THEME_BOOTSTRAP, THEME_STORAGE_KEY } from "./theme";

// A minimal browser: enough for the bootstrap script, which only touches these globals.
function fakeBrowser(options: {
  stored: string | null;
  systemDark: boolean;
  storageThrows?: boolean;
}) {
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  Object.assign(globalThis, {
    window: {
      matchMedia: (query: string) => ({ matches: query.includes("dark") && options.systemDark }),
    },
    localStorage: {
      getItem: (key: string) => {
        if (options.storageThrows) throw new Error("SecurityError");
        return key === THEME_STORAGE_KEY ? options.stored : null;
      },
    },
    document: {
      documentElement: {
        classList: {
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        },
        style,
      },
    },
  });
  new Function(THEME_BOOTSTRAP)();
  return { dark: classes.has("dark"), colorScheme: style.colorScheme };
}

afterEach(() => {
  for (const key of ["window", "localStorage", "document"])
    delete (globalThis as Record<string, unknown>)[key];
});

test("a stored choice wins over the system preference", () => {
  expect(fakeBrowser({ stored: "dark", systemDark: false })).toEqual({
    dark: true,
    colorScheme: "dark",
  });
  expect(fakeBrowser({ stored: "light", systemDark: true })).toEqual({
    dark: false,
    colorScheme: "light",
  });
});

test("no stored choice follows the system", () => {
  expect(fakeBrowser({ stored: null, systemDark: true }).dark).toBe(true);
  expect(fakeBrowser({ stored: "system", systemDark: false }).dark).toBe(false);
});

// Regression: the whole script used to sit in one try/catch, so a throwing localStorage skipped
// the system fallback and a dark-mode OS got the light theme.
test("blocked storage still follows the system preference", () => {
  expect(fakeBrowser({ stored: null, systemDark: true, storageThrows: true }).dark).toBe(true);
});
