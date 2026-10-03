import type { Category, Lang, Register, Sample, Split } from "../../dataset/schema.js";
import { createRng, pick, uniqueSamples, type Rng } from "../prng.js";
import { EN_POOLS } from "./pools-en.js";
import { ID_INFORMAL_POOLS } from "./pools-id-informal.js";
import { ID_POOLS } from "./pools-id.js";
import { MIXED_POOLS } from "./pools-mixed.js";
import type { LangPools } from "./pools.js";
import { INFORMAL_TRANSFORMS, TRANSFORMS, type Transform } from "./transforms.js";

type Counts = Record<Category, number>;
interface Draft {
  text: string;
  role: Sample["role"];
}

export interface Slice {
  key: string;
  lang: Lang;
  register: Register;
  pools: LangPools;
  transforms: Record<Split, readonly Transform[]>;
  seeds: Record<Split, number>;
  counts: Record<Split, Counts>;
}

const ID_COUNTS: Record<Split, Counts> = {
  dev: { direct: 64, indirect: 32, obfuscated: 32, benign: 80, benign_hard: 48 },
  test: { direct: 96, indirect: 48, obfuscated: 48, benign: 120, benign_hard: 72 },
};

// The key prefixes sample ids, so the original "id" and "en" slices keep their ids.
export const SLICES: readonly Slice[] = [
  {
    key: "id",
    lang: "id",
    register: "formal",
    pools: ID_POOLS,
    transforms: TRANSFORMS,
    seeds: { dev: 1101, test: 2202 },
    counts: ID_COUNTS,
  },
  {
    key: "en",
    lang: "en",
    register: "formal",
    pools: EN_POOLS,
    transforms: TRANSFORMS,
    seeds: { dev: 3303, test: 4404 },
    counts: {
      dev: { direct: 32, indirect: 16, obfuscated: 16, benign: 40, benign_hard: 24 },
      test: { direct: 48, indirect: 24, obfuscated: 24, benign: 60, benign_hard: 36 },
    },
  },
  {
    key: "id-informal",
    lang: "id",
    register: "informal",
    pools: ID_INFORMAL_POOLS,
    transforms: INFORMAL_TRANSFORMS,
    seeds: { dev: 5505, test: 6606 },
    counts: ID_COUNTS,
  },
  {
    key: "mixed",
    lang: "mixed",
    register: "informal",
    pools: MIXED_POOLS,
    transforms: INFORMAL_TRANSFORMS,
    seeds: { dev: 7707, test: 8808 },
    counts: ID_COUNTS,
  },
];
const BENIGN_TOOL_SHARE = 0.3;

function fillSlots(template: string, pools: LangPools, rng: Rng): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const options = pools.slots[name];
    if (!options) throw new Error(`unknown slot {${name}} in template: ${template}`);
    return pick(rng, options);
  });
}

function directText(pools: LangPools, split: Split, rng: Rng): string {
  const opener = pick(rng, pools.openers);
  const override = pick(rng, pools.overrides[split]);
  const action = pick(rng, pools.actions[split]);
  return `${opener}${override} ${action}`;
}

function direct(pools: LangPools, split: Split, rng: Rng): Draft {
  return { text: directText(pools, split, rng), role: "user" };
}

function indirect(pools: LangPools, split: Split, rng: Rng): Draft {
  const payload = `${pick(rng, pools.overrides[split])} ${pick(rng, pools.actions[split])}`;
  const text = pick(rng, pools.wrappers[split])(pick(rng, pools.filler), payload);
  return { text, role: "tool" };
}

function obfuscated(slice: Slice, split: Split, rng: Rng): Draft {
  const text = pick(rng, slice.transforms[split])(directText(slice.pools, split, rng), slice.lang);
  return { text, role: "user" };
}

function benign(pools: LangPools, split: Split, rng: Rng): Draft {
  if (rng() < BENIGN_TOOL_SHARE) {
    const text = pick(rng, pools.wrappers[split])(pick(rng, pools.filler), null);
    return { text, role: "tool" };
  }
  return { text: fillSlots(pick(rng, pools.benignTemplates[split]), pools, rng), role: "user" };
}

function benignHard(pools: LangPools, split: Split, rng: Rng): Draft {
  return {
    text: `${pick(rng, pools.hardLeadIns)}${pick(rng, pools.benignHard[split])}`,
    role: "user",
  };
}

export function generateInjectionSamples(slice: Slice, split: Split): Sample[] {
  const { pools, lang, register } = slice;
  const rng = createRng(slice.seeds[split]);
  const counts = slice.counts[split];
  const counters = { inj: 0, ben: 0 };

  function build(category: Category, drafts: Draft[]): Sample[] {
    const label = category === "benign" || category === "benign_hard" ? "benign" : "injection";
    const prefix = label === "injection" ? "inj" : "ben";
    return drafts.map((draft) => {
      counters[prefix] += 1;
      const id = `${prefix}-${slice.key}-${split}-${String(counters[prefix]).padStart(4, "0")}`;
      return { id, ...draft, label, lang, register, category, source: "template" };
    });
  }

  return [
    ...build(
      "direct",
      uniqueSamples(counts.direct, () => direct(pools, split, rng)),
    ),
    ...build(
      "indirect",
      uniqueSamples(counts.indirect, () => indirect(pools, split, rng)),
    ),
    ...build(
      "obfuscated",
      uniqueSamples(counts.obfuscated, () => obfuscated(slice, split, rng)),
    ),
    ...build(
      "benign",
      uniqueSamples(counts.benign, () => benign(pools, split, rng)),
    ),
    ...build(
      "benign_hard",
      uniqueSamples(counts.benign_hard, () => benignHard(pools, split, rng)),
    ),
  ];
}

export function generateInjectionDataset(split: Split): Sample[] {
  return SLICES.flatMap((slice) => generateInjectionSamples(slice, split));
}
