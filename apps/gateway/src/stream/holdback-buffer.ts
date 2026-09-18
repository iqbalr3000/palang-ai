// Releases all text except the last `holdbackSize` characters, so a placeholder like `[NIK_1]`
// split across two SSE chunks is never released half-formed.
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

  private computeReleasePoint(): number {
    const releasePoint = Math.max(0, this.buffer.length - this.holdbackSize);

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
