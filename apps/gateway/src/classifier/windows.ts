export interface TokenWindow {
  start: number;
  end: number;
}

/**
 * Sliding windows over `tokenCount` tokens. Only the first `maxWindows` are returned: text beyond
 * them goes unscanned, which bounds the cost of a very large tool result.
 */
export function planWindows(
  tokenCount: number,
  size: number,
  overlap: number,
  maxWindows: number,
): TokenWindow[] {
  if (overlap >= size) throw new Error("overlap must be smaller than the window size");
  if (tokenCount <= 0) return [];

  const windows: TokenWindow[] = [];
  for (let start = 0; windows.length < maxWindows; start += size - overlap) {
    const end = Math.min(start + size, tokenCount);
    windows.push({ start, end });
    if (end === tokenCount) break;
  }
  return windows;
}
