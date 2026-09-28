import { test, expect } from "bun:test";
import { ToolCallAssembler, ToolArgsTooLargeError } from "./tool-call-assembler.js";

test("accumulates name and arguments across deltas for one index", () => {
  const assembler = new ToolCallAssembler();
  assembler.accumulate({ index: 0, id: "call_1", type: "function", function: { name: "lookup" } });
  assembler.accumulate({ index: 0, function: { arguments: '{"a":' } });
  assembler.accumulate({ index: 0, function: { arguments: "1}" } });

  expect(assembler.finalize()).toEqual([
    { id: "call_1", type: "function", function: { name: "lookup", arguments: '{"a":1}' } },
  ]);
});

test("tracks multiple tool calls independently by index", () => {
  const assembler = new ToolCallAssembler();
  assembler.accumulate({ index: 0, id: "call_1", function: { name: "a", arguments: "{}" } });
  assembler.accumulate({ index: 1, id: "call_2", function: { name: "b", arguments: "{}" } });

  const calls = assembler.finalize();
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ id: "call_1" });
  expect(calls[1]).toMatchObject({ id: "call_2" });
});

test("finalize with no accumulated calls returns an empty array", () => {
  expect(new ToolCallAssembler().finalize()).toEqual([]);
});

test("throws ToolArgsTooLargeError past the byte cap", () => {
  const assembler = new ToolCallAssembler({ maxArgsBytes: 10 });
  assembler.accumulate({ index: 0, id: "call_1", function: { name: "a", arguments: "12345" } });

  expect(() => assembler.accumulate({ index: 0, function: { arguments: "678901" } })).toThrow(
    ToolArgsTooLargeError,
  );
});
