export type CategoryKind = "income" | "expense";

export type UncategorizedRow = {
  id: number;
  payee: string;
  description: string;
  amountCents: number;
};

export type Merchant = {
  key: string;
  kind: CategoryKind;
  text: string;
  description: string;
  typicalCents: number;
  transactionIds: number[];
};

// Groups "PANDA EXPRESS #724" and "PANDA EXPRESS #301" as one merchant.
export function merchantKey(text: string): string {
  const words = text
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => !/\d/.test(word) && word !== "#");
  return words.join(" ") || text.toUpperCase().trim();
}

function withoutLongNumbers(text: string): string {
  return text.replace(/#?\d{4,}/g, "").trim();
}

// One entry per merchant and direction, so a merchant that appears 12 times needs
// one AI decision. Money in and money out stay apart because they have different
// categories to choose from.
export function groupMerchants(rows: UncategorizedRow[]): Merchant[] {
  const merchants = new Map<string, Merchant>();
  const totals = new Map<string, number>();
  for (const row of rows) {
    const text = row.payee || row.description;
    if (row.amountCents === 0 || !text.trim()) continue;
    const kind: CategoryKind = row.amountCents < 0 ? "expense" : "income";
    const key = `${kind}|${merchantKey(text)}`;
    const merchant = merchants.get(key) ?? {
      key,
      kind,
      text: withoutLongNumbers(text),
      description: row.payee && row.description !== row.payee ? withoutLongNumbers(row.description) : "",
      typicalCents: 0,
      transactionIds: [],
    };
    const total = (totals.get(key) ?? 0) + Math.abs(row.amountCents);
    totals.set(key, total);
    merchant.transactionIds.push(row.id);
    merchant.typicalCents = Math.round(total / merchant.transactionIds.length);
    merchants.set(key, merchant);
  }
  return [...merchants.values()];
}
