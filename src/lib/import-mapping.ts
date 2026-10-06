import { isValidIsoDate, parseFlexibleDate } from "@/lib/dates";
import { tryDollarsToCents } from "@/lib/money";

// Which CSV column feeds each field. Empty string means "not mapped".
export type ImportMapping = {
  date: string;
  // "single": one signed amount column. "split": separate money-out / money-in columns.
  amountMode: "single" | "split";
  amount: string;
  debit: string;
  credit: string;
  payee: string;
  description: string;
  // Single mode only: the bank lists spending as positive numbers.
  invert: boolean;
};

export const emptyMapping: ImportMapping = {
  date: "",
  amountMode: "single",
  amount: "",
  debit: "",
  credit: "",
  payee: "",
  description: "",
  invert: false,
};

export type CsvRow = Record<string, string>;

function pick(headers: string[], patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = headers.find((header) => pattern.test(header.trim()));
    if (match) return match;
  }
  return "";
}

export function guessMapping(headers: string[]): ImportMapping {
  const debit = pick(headers, [/^debit/i, /withdrawal/i, /money out/i, /debit/i]);
  const credit = pick(headers, [/^credit/i, /deposit/i, /money in/i, /credit/i]);
  const amount = pick(headers, [/^amount$/i, /amount/i]);
  const description = pick(headers, [/^description$/i, /description/i, /memo/i, /details/i, /narrative/i]);
  const payee = pick(
    headers.filter((header) => header !== description),
    [/payee/i, /merchant/i, /^name$/i],
  );
  return {
    date: pick(headers, [/^transaction date$/i, /^date$/i, /date/i, /posted/i]),
    amountMode: !amount && debit && credit ? "split" : "single",
    amount,
    debit,
    credit,
    payee,
    description,
    invert: false,
  };
}

// A saved mapping is only reusable if every column it names is still in the file.
export function mappingFits(mapping: ImportMapping, headers: string[]): boolean {
  const used = [
    mapping.date,
    ...(mapping.amountMode === "single" ? [mapping.amount] : [mapping.debit, mapping.credit]),
    mapping.payee,
    mapping.description,
  ].filter(Boolean);
  return used.length > 0 && used.every((column) => headers.includes(column));
}

export function parseSavedMapping(json: string): ImportMapping | null {
  try {
    const value = JSON.parse(json) as Partial<ImportMapping> | null;
    if (!value || typeof value.date !== "string" || !value.date) return null;
    return {
      ...emptyMapping,
      ...value,
      amountMode: value.amountMode === "split" ? "split" : "single",
      invert: value.invert === true,
    };
  } catch {
    return null;
  }
}

export function mappingIsComplete(mapping: ImportMapping): boolean {
  if (!mapping.date) return false;
  return mapping.amountMode === "single" ? Boolean(mapping.amount) : Boolean(mapping.debit || mapping.credit);
}

export type MappedRow = {
  date: string;
  // Signed dollars as a string, before any sign flip.
  amount: string;
  payee: string;
  description: string;
};

export function mapRow(row: CsvRow, mapping: ImportMapping): MappedRow {
  const cell = (column: string) => (column ? String(row[column] ?? "").trim() : "");
  let amount = "";
  if (mapping.amountMode === "single") {
    amount = cell(mapping.amount);
  } else {
    const out = tryDollarsToCents(cell(mapping.debit));
    const into = tryDollarsToCents(cell(mapping.credit));
    if (out) amount = (-Math.abs(out) / 100).toFixed(2);
    else if (into) amount = (Math.abs(into) / 100).toFixed(2);
  }
  return {
    date: cell(mapping.date),
    amount,
    payee: cell(mapping.payee),
    description: cell(mapping.description),
  };
}

export type ReadRow = { date: string; amountCents: number; payee: string; description: string };

// Returns null when the row can't be imported (bad date, bad or zero amount).
export function readRow(mapped: MappedRow, invert: boolean): ReadRow | null {
  const date = parseFlexibleDate(mapped.date);
  const cents = tryDollarsToCents(mapped.amount);
  if (!date || !isValidIsoDate(date) || cents === null || cents === 0) return null;
  return {
    date,
    amountCents: invert ? -cents : cents,
    payee: mapped.payee || mapped.description.slice(0, 80),
    description: mapped.description,
  };
}
