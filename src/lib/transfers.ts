// Finds money that left one of your accounts and arrived in another, such as a
// checking account paying a credit card, so both sides can be marked as transfers
// and kept out of income and spending.

// Bank payments often post a day or more apart on each side.
export const TRANSFER_WINDOW_DAYS = 3;

export type TransferCandidate = {
  id: number;
  accountId: number;
  date: string;
  amountCents: number;
  categoryId: number | null;
};

export type TransferMatch<T extends TransferCandidate> = { out: T; in: T; days: number };

export function pairKey(outId: number, inId: number) {
  return `${outId}-${inId}`;
}

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

// Pairs each outgoing transaction with an incoming one of the same amount in a
// different account, at most `windowDays` apart. Closest dates win, and each
// transaction is used once. Pairs where both sides already have a category are
// skipped: you've already said what those are. `rows` should leave out
// transactions already marked as transfers.
export function findTransferPairs<T extends TransferCandidate>(
  rows: T[],
  dismissed: ReadonlySet<string> = new Set(),
  windowDays = TRANSFER_WINDOW_DAYS,
): TransferMatch<T>[] {
  const byAmount = new Map<number, { outs: T[]; ins: T[] }>();
  for (const row of rows) {
    if (row.amountCents === 0) continue;
    const group = byAmount.get(Math.abs(row.amountCents)) ?? { outs: [], ins: [] };
    (row.amountCents < 0 ? group.outs : group.ins).push(row);
    byAmount.set(Math.abs(row.amountCents), group);
  }

  const candidates: TransferMatch<T>[] = [];
  for (const { outs, ins } of byAmount.values()) {
    for (const out of outs) {
      for (const inRow of ins) {
        if (out.accountId === inRow.accountId) continue;
        if (out.categoryId !== null && inRow.categoryId !== null) continue;
        if (dismissed.has(pairKey(out.id, inRow.id))) continue;
        const days = Math.abs(dayNumber(out.date) - dayNumber(inRow.date));
        if (days > windowDays) continue;
        candidates.push({ out, in: inRow, days });
      }
    }
  }

  // Closest dates first; ties go to the earlier transactions so results are stable.
  candidates.sort((a, b) => a.days - b.days || a.out.id - b.out.id || a.in.id - b.in.id);
  const used = new Set<number>();
  const pairs: TransferMatch<T>[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.out.id) || used.has(candidate.in.id)) continue;
    used.add(candidate.out.id);
    used.add(candidate.in.id);
    pairs.push(candidate);
  }
  return pairs.sort(
    (a, b) => b.out.date.localeCompare(a.out.date) || b.out.id - a.out.id,
  );
}
