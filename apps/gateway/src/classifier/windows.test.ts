import { test, expect } from "bun:test";
import { planWindows } from "./windows.js";

test("an input that fits is a single window", () => {
  expect(planWindows(40, 510, 64, 8)).toEqual([{ start: 0, end: 40 }]);
  expect(planWindows(510, 510, 64, 8)).toEqual([{ start: 0, end: 510 }]);
});

test("empty input has no windows", () => {
  expect(planWindows(0, 510, 64, 8)).toEqual([]);
});

test("longer input slides by size minus overlap and the last window ends at the last token", () => {
  expect(planWindows(1000, 510, 64, 8)).toEqual([
    { start: 0, end: 510 },
    { start: 446, end: 956 },
    { start: 892, end: 1000 },
  ]);
});

test("consecutive windows overlap by exactly the configured amount and cover every token", () => {
  const windows = planWindows(3000, 510, 64, 20);
  for (let i = 1; i < windows.length; i++) {
    expect(windows[i - 1]!.end - windows[i]!.start).toBe(64);
  }
  expect(windows[0]!.start).toBe(0);
  expect(windows.at(-1)!.end).toBe(3000);
});

test("the number of windows is capped, keeping the earliest ones", () => {
  const windows = planWindows(1_000_000, 510, 64, 8);
  expect(windows).toHaveLength(8);
  expect(windows[0]).toEqual({ start: 0, end: 510 });
  expect(windows[7]!.start).toBe(7 * 446);
});

test("rejects an overlap that would never advance", () => {
  expect(() => planWindows(100, 64, 64, 8)).toThrow();
});
