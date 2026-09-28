import { expect, test } from "bun:test";
import type { PiiSample } from "../dataset/pii-schema.js";
import { RESTORE_SCENARIOS, evaluateRestore } from "./restore.js";

const withPii: PiiSample = {
  id: "s1",
  text: "NIK saya 3171011506900001, hubungi 0812-3456-7890 ya",
  spans: [
    { type: "NIK", start: 9, end: 25 },
    { type: "PHONE_ID", start: 35, end: 49 },
  ],
  category: "positive",
};
const withoutPii: PiiSample = {
  id: "s2",
  text: "tagihan INV/2025/01/12345",
  spans: [],
  category: "hard_negative",
};

for (const scenario of RESTORE_SCENARIOS) {
  test(`${scenario}: masked PII streams back restored, with nothing missed`, async () => {
    const report = await evaluateRestore([withPii, withoutPii], scenario);

    // Only the sample that got masked counts; restore returns the phone's normalized +62 form.
    expect(report).toEqual({
      samples: 1,
      succeeded: 1,
      successRate: 1,
      restoreMiss: { NIK: 0, NPWP: 0, PHONE_ID: 0, EMAIL: 0, CARD: 0, total: 0 },
    });
  });
}
