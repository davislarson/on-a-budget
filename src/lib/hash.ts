import { createHash } from "node:crypto";

export function importHash(input: {
  accountId: number;
  date: string;
  amountCents: number;
  description: string;
  // 0 for the first row with these details in a file, 1 for the second, and so on,
  // so genuine same-day repeats get distinct hashes that are stable across re-imports.
  occurrence?: number;
}): string {
  const base = `${input.accountId}|${input.date}|${input.amountCents}|${input.description.trim().toLowerCase()}`;
  const normalized = input.occurrence ? `${base}|${input.occurrence}` : base;
  return createHash("sha256").update(normalized).digest("hex");
}
