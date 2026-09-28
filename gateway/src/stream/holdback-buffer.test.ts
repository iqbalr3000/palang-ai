import { test, expect } from "bun:test";
import { HoldbackBuffer } from "./holdback-buffer.js";

test("releases all but the last H characters", () => {
  const buffer = new HoldbackBuffer(5);
  const released = buffer.append("hello world"); // 11 chars, hold back last 5 ("world")
  expect(released).toBe("hello ");
});

test("holds everything when text is shorter than H", () => {
  const buffer = new HoldbackBuffer(10);
  expect(buffer.append("hi")).toBe("");
});

test("accumulates across multiple appends", () => {
  const buffer = new HoldbackBuffer(3);
  let released = "";
  released += buffer.append("ab");
  released += buffer.append("cd");
  released += buffer.append("ef");
  // buffer so far: "abcdef" (6 chars), holding back last 3 at each step
  expect(released + buffer.flush()).toBe("abcdef");
});

test("flush releases everything remaining", () => {
  const buffer = new HoldbackBuffer(5);
  buffer.append("hello world");
  expect(buffer.flush()).toBe("world");
  expect(buffer.flush()).toBe(""); // nothing left the second time
});

test("never splits a placeholder even when it straddles the holdback boundary", () => {
  const buffer = new HoldbackBuffer(4); // shorter than "[NIK_1]" (7 chars)
  let released = "";
  released += buffer.append("your id is [NIK");
  released += buffer.append("_1] thanks");
  released += buffer.flush();
  expect(released).toBe("your id is [NIK_1] thanks");
});

test("an unclosed bracket further back than H still gets held, not split", () => {
  const buffer = new HoldbackBuffer(2);
  // "[EMAIL_1" is 8 chars, well past a holdback of 2 — must still not be split
  const released = buffer.append("value [EMAIL_1");
  expect(released).toBe("value ");
});

test("a closed bracket well before the tail is released normally (not held forever)", () => {
  const buffer = new HoldbackBuffer(3);
  const released = buffer.append("[NIK_1] and more text here");
  expect(released.startsWith("[NIK_1]")).toBe(true);
});

test("a closed bracket at the very start of the buffer doesn't hang the backward scan", () => {
  const buffer = new HoldbackBuffer(3);
  const released = buffer.append("[NIK_1] rest of the text");
  expect(released.startsWith("[NIK_1]")).toBe(true);
});

test("an earlier unclosed bracket further back than a later closed one is still held", () => {
  const buffer = new HoldbackBuffer(3);
  const released = buffer.append("start [NIK_ middle [2] end");
  expect(released).not.toContain("[NIK_");
  expect(released.length).toBeLessThan("start [NIK_ middle [2] end".length);
});

test("random chunk splits of the same text always reassemble identically", () => {
  const original =
    "Nomor identitas Anda adalah [NIK_1] dan email [EMAIL_1], terima kasih sudah menghubungi kami hari ini.";

  for (let trial = 0; trial < 50; trial++) {
    const buffer = new HoldbackBuffer(8); // e.g. holdback(config) for pii-id
    let cursor = 0;
    let released = "";
    while (cursor < original.length) {
      const chunkSize = 1 + Math.floor(Math.random() * 6);
      const chunk = original.slice(cursor, cursor + chunkSize);
      cursor += chunk.length;
      released += buffer.append(chunk);
    }
    released += buffer.flush();
    expect(released).toBe(original);
  }
});

function releaseInChunks(buffer: HoldbackBuffer, text: string, chunkSize: () => number): string[] {
  const segments: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const chunk = text.slice(cursor, cursor + chunkSize());
    cursor += chunk.length;
    segments.push(buffer.append(chunk));
  }
  segments.push(buffer.flush());
  return segments.filter((s) => s !== "");
}

const TOKENS = [
  "plg-canary-0123456789abcdef",
  "budi.santoso@example.com",
  "0812 3456 7890",
  "4111 1111 1111 1111",
  "3171011506900001",
];

test("whitespace-delimited tokens and space-grouped numbers are never split across releases", () => {
  const text = `Balasan: ${TOKENS.join(" lalu ")} selesai, terima kasih banyak ya.`;

  for (let trial = 0; trial < 50; trial++) {
    const segments = releaseInChunks(
      new HoldbackBuffer(32),
      text,
      () => 1 + Math.floor(Math.random() * 12),
    );
    expect(segments.join("")).toBe(text);
    for (const token of TOKENS) {
      expect(segments.filter((s) => s.includes(token))).toHaveLength(1);
    }
  }
});

test("a token with no safe boundary within the cap is still released, not held forever", () => {
  const buffer = new HoldbackBuffer(8);
  const released = buffer.append("x".repeat(600));
  expect(released.length).toBeGreaterThan(0);
});

test("no holdback (no output guards) releases everything immediately", () => {
  expect(new HoldbackBuffer(0).append("budi@exam")).toBe("budi@exam");
});
