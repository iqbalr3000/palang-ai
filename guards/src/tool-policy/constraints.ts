import type { Primitive, ToolConstraint } from "./config.js";

const MISSING = Symbol("missing");

export function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index >= current.length) return MISSING;
      current = current[index];
    } else if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      if (!Object.hasOwn(current, segment)) return MISSING;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return MISSING;
    }
  }
  return current;
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

const sameType = (a: Primitive, b: Primitive): boolean =>
  (a === null) === (b === null) && typeof a === typeof b;

export function constraintPasses(
  constraint: ToolConstraint,
  args: unknown,
  regex: RegExp | undefined,
): boolean {
  const actual = resolvePath(args, constraint.path);
  if (actual === MISSING) return false;

  switch (constraint.op) {
    case "eq":
    case "neq":
      if (!isPrimitive(actual) || !sameType(actual, constraint.value)) return false;
      return (actual === constraint.value) === (constraint.op === "eq");
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
      const limit = constraint.value;
      if (constraint.op === "lt") return actual < limit;
      if (constraint.op === "lte") return actual <= limit;
      if (constraint.op === "gt") return actual > limit;
      return actual >= limit;
    }
    case "in":
    case "not_in":
      if (!isPrimitive(actual)) return false;
      return constraint.value.includes(actual) === (constraint.op === "in");
    case "regex":
      return typeof actual === "string" && regex !== undefined && regex.test(actual);
  }
}
