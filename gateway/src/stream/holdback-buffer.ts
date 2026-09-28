// How far back from the normal cut to look for a safe boundary before giving up and splitting.
const MAX_BOUNDARY_SCAN = 256;

const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);
const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9";

// Releases all text except the last `holdbackSize` characters, and never cuts inside a token, so a
// placeholder like `[NIK_1]`, a canary, or an email split across SSE chunks reaches output guards
// whole.
export class HoldbackBuffer {
  private buffer = "";

  constructor(private readonly holdbackSize: number) {}

  /** Appends newly-arrived text and returns the portion now safe to release. */
  append(text: string): string {
    this.buffer += text;
    const releasePoint = this.computeReleasePoint();
    const released = this.buffer.slice(0, releasePoint);
    this.buffer = this.buffer.slice(releasePoint);
    return released;
  }

  /** Releases everything still held — call on `finish_reason`. */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  /** A cut right after whitespace, unless that whitespace sits between digits ("0812 3456"). */
  private isSafeCut(point: number): boolean {
    if (point === 0) return true;
    const before = this.buffer[point - 1];
    if (!isWhitespace(before)) return false;
    let start = point - 1;
    while (start > 0 && isWhitespace(this.buffer[start - 1])) start--;
    return !(isDigit(this.buffer[start - 1]) && isDigit(this.buffer[point]));
  }

  private computeReleasePoint(): number {
    if (this.holdbackSize === 0) return this.buffer.length;

    let releasePoint = Math.max(0, this.buffer.length - this.holdbackSize);
    const floor = Math.max(0, releasePoint - MAX_BOUNDARY_SCAN);
    for (let point = releasePoint; point >= floor; point--) {
      if (this.isSafeCut(point)) {
        releasePoint = point;
        break;
      }
    }

    // A single forward scan with a stack, not a repeated "does some ']' exist after this '['"
    // check: the latter can't tell which "]" actually belongs to which "[", so an earlier
    // unclosed "[" can get mistaken for closed by a *different*, later bracket's "]" (e.g.
    // "[NIK_ ... [2]" — the lone "]" belongs to "[2]", not to "[NIK_"). LIFO stack matching
    // resolves that correctly, the same way any bracket-matching scan does.
    const openStack: number[] = [];
    for (let i = 0; i < releasePoint; i++) {
      if (this.buffer[i] === "[") openStack.push(i);
      else if (this.buffer[i] === "]") openStack.pop();
    }

    return openStack.length > 0 ? openStack[0]! : releasePoint;
  }
}
