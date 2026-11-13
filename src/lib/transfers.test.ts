import { describe, expect, it } from "vitest";
import { findTransferPairs, pairKey, type TransferCandidate } from "@/lib/transfers";

let nextId = 1;
function tx(accountId: number, date: string, amountCents: number, categoryId: number | null = null): TransferCandidate {
  return { id: nextId++, accountId, date, amountCents, categoryId };
}

const ids = (pairs: ReturnType<typeof findTransferPairs>) => pairs.map((pair) => [pair.out.id, pair.in.id]);

describe("findTransferPairs", () => {
  it("pairs money out of one account with the same amount into another", () => {
    const out = tx(1, "2026-10-05", -50000);
    const inRow = tx(2, "2026-10-07", 50000);
    const pairs = findTransferPairs([out, inRow]);
    expect(ids(pairs)).toEqual([[out.id, inRow.id]]);
    expect(pairs[0].days).toBe(2);
  });

  it("ignores pairs in the same account, with different amounts, or too far apart", () => {
    expect(findTransferPairs([tx(1, "2026-10-05", -500), tx(1, "2026-10-05", 500)])).toEqual([]);
    expect(findTransferPairs([tx(1, "2026-10-05", -500), tx(2, "2026-10-05", 501)])).toEqual([]);
    expect(findTransferPairs([tx(1, "2026-10-01", -500), tx(2, "2026-10-05", 500)])).toEqual([]);
    expect(findTransferPairs([tx(1, "2026-10-01", -500), tx(2, "2026-10-04", 500)])).toHaveLength(1);
  });

  it("counts days across month ends", () => {
    expect(findTransferPairs([tx(1, "2026-10-31", -500), tx(2, "2026-11-02", 500)])).toHaveLength(1);
  });

  it("skips pairs where both sides already have a category", () => {
    expect(findTransferPairs([tx(1, "2026-10-05", -500, 3), tx(2, "2026-10-05", 500, 4)])).toEqual([]);
    expect(findTransferPairs([tx(1, "2026-10-05", -500, 3), tx(2, "2026-10-05", 500)])).toHaveLength(1);
  });

  it("uses each transaction once, preferring the closest dates", () => {
    const out = tx(1, "2026-10-05", -2000);
    const far = tx(2, "2026-10-02", 2000);
    const near = tx(3, "2026-10-05", 2000);
    expect(ids(findTransferPairs([out, far, near]))).toEqual([[out.id, near.id]]);
  });

  it("matches two same-amount payments to their own arrivals", () => {
    const out1 = tx(1, "2026-09-01", -10000);
    const out2 = tx(1, "2026-10-01", -10000);
    const in1 = tx(2, "2026-09-02", 10000);
    const in2 = tx(2, "2026-10-03", 10000);
    // Newest first.
    expect(ids(findTransferPairs([out1, out2, in1, in2]))).toEqual([
      [out2.id, in2.id],
      [out1.id, in1.id],
    ]);
  });

  it("leaves out dismissed pairs and offers the next best match", () => {
    const out = tx(1, "2026-10-05", -2000);
    const near = tx(2, "2026-10-05", 2000);
    const far = tx(3, "2026-10-07", 2000);
    expect(ids(findTransferPairs([out, near, far], new Set([pairKey(out.id, near.id)])))).toEqual([[out.id, far.id]]);
  });
});
