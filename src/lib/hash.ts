import { createHash } from "node:crypto";

export function importHash(input: {
  accountId: number;
  date: string;
  amountCents: number;
  description: string;
}): string {
  const normalized = `${input.accountId}|${input.date}|${input.amountCents}|${input.description.trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex");
}
