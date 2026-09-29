export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick from an empty pool");
  return item;
}

export function uniqueSamples<T extends { text: string }>(count: number, make: () => T): T[] {
  const seen = new Map<string, T>();
  const maxAttempts = count * 200;
  for (let attempt = 0; seen.size < count; attempt++) {
    if (attempt >= maxAttempts) {
      throw new Error(`could only produce ${seen.size} of ${count} distinct samples`);
    }
    const item = make();
    if (!seen.has(item.text)) seen.set(item.text, item);
  }
  return [...seen.values()];
}
