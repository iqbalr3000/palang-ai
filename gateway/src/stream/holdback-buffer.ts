const MAX_BOUNDARY_SCAN = 256;
const MAX_PLACEHOLDER_LENGTH = 32;

const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);
const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9";

// Never cuts inside a token, so a placeholder or canary split across chunks reaches guards whole.
export class HoldbackBuffer {
  private buffer = "";

  constructor(private readonly holdbackSize: number) {}

  append(text: string): string {
    this.buffer += text;
    const releasePoint = this.computeReleasePoint();
    const released = this.buffer.slice(0, releasePoint);
    this.buffer = this.buffer.slice(releasePoint);
    return released;
  }

  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  // Whitespace between digits ("0812 3456") isn't a safe cut: it may be inside a phone number.
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

    const openStack: number[] = [];
    for (let i = Math.max(0, releasePoint - MAX_PLACEHOLDER_LENGTH); i < releasePoint; i++) {
      if (this.buffer[i] === "[") openStack.push(i);
      else if (this.buffer[i] === "]") openStack.pop();
    }

    return openStack.length > 0 ? openStack[0]! : releasePoint;
  }
}
