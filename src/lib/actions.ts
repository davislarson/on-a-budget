"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accountTypes, accounts, categories, categoryKinds, importBatches, transactions } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { importHash } from "@/lib/hash";
import { tryDollarsToCents } from "@/lib/money";
import { isValidIsoDate, todayIso } from "@/lib/dates";
import { readRow, type ImportMapping, type MappedRow, type ReadRow } from "@/lib/import-mapping";
import { existingHashes } from "@/lib/queries";

const MAX_IMPORT_ROWS = 50_000;
const INSERT_CHUNK = 500;

function revalidateAll() {
  revalidatePath("/", "layout");
}

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function formValues(formData: FormData) {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

function fail(formData: FormData, error: string): ActionState {
  return { error, values: formValues(formData) };
}

function parseId(value: FormDataEntryValue | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isOneOf<T extends string>(options: readonly T[], value: string): value is T {
  return (options as readonly string[]).includes(value);
}

function findAccount(id: number) {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

function findCategory(id: number) {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

const OPENING_BALANCE_ERROR =
  "Enter the starting balance as a dollar amount, like 1500 or -320.50.";

// Empty input means zero; returns undefined when the input isn't a valid amount.
function parseOpeningBalance(raw: string): number | undefined {
  if (raw === "") return 0;
  return tryDollarsToCents(raw) ?? undefined;
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = formString(formData, "name");
  const type = formString(formData, "type");
  const institution = formString(formData, "institution") || null;
  if (!name) return fail(formData, "Account name is required.");
  if (!isOneOf(accountTypes, type)) return fail(formData, "Pick an account type.");
  const openingBalanceCents = parseOpeningBalance(formString(formData, "openingBalance"));
  if (openingBalanceCents === undefined) return fail(formData, OPENING_BALANCE_ERROR);
  db.insert(accounts)
    .values({
      name,
      type,
      institution,
      openingBalanceCents,
      source: "manual",
      createdAt: new Date().toISOString(),
    })
    .run();
  revalidateAll();
  return {};
}

export async function updateAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  const name = formString(formData, "name");
  const type = formString(formData, "type");
  const institution = formString(formData, "institution") || null;
  if (!id || !findAccount(id)) return fail(formData, "That account no longer exists.");
  if (!name) return fail(formData, "Account name is required.");
  if (!isOneOf(accountTypes, type)) return fail(formData, "Pick an account type.");
  const openingBalanceCents = parseOpeningBalance(formString(formData, "openingBalance"));
  if (openingBalanceCents === undefined) return fail(formData, OPENING_BALANCE_ERROR);
  db.update(accounts)
    .set({ name, type, institution, openingBalanceCents })
    .where(eq(accounts.id, id))
    .run();
  revalidateAll();
  return {};
}

export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  if (!id || !findAccount(id)) return fail(formData, "That account no longer exists.");
  const tx = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, id)).get();
  if (tx) {
    return fail(formData, "This account still has transactions. Delete or move them first.");
  }
  db.transaction((tx) => {
    // Import history for an account with no transactions left has nothing to undo.
    tx.delete(importBatches).where(eq(importBatches.accountId, id)).run();
    tx.delete(accounts).where(eq(accounts.id, id)).run();
  });
  revalidateAll();
  return {};
}

// Empty input means "no cap"; returns undefined when the input isn't a valid amount.
function parseCap(raw: string): number | null | undefined {
  if (raw === "") return null;
  const cents = tryDollarsToCents(raw);
  if (cents === null || cents < 0) return undefined;
  return cents;
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = formString(formData, "name");
  const kind = formString(formData, "kind");
  if (!name) return fail(formData, "Category name is required.");
  if (!isOneOf(categoryKinds, kind)) return fail(formData, "Pick income or expense.");
  const duplicate = db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.kind, kind), eq(categories.archived, false)))
    .all()
    .some((cat) => cat.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return fail(formData, `You already have a category called "${name}".`);
  const cap = kind === "expense" ? parseCap(formString(formData, "monthlyCap")) : null;
  if (cap === undefined) return fail(formData, "Enter the monthly cap as a dollar amount, like 250 or 250.00.");
  db.insert(categories)
    .values({
      name,
      kind,
      monthlyCapCents: cap,
      sortOrder: kind === "income" ? 50 : 100,
      archived: false,
    })
    .run();
  revalidateAll();
  return {};
}

export async function updateCategoryCap(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  const category = id ? findCategory(id) : undefined;
  if (!id || !category) return fail(formData, "That category no longer exists.");
  if (category.kind !== "expense") return fail(formData, "Only expense categories have caps.");
  const cap = parseCap(formString(formData, "monthlyCap"));
  if (cap === undefined) return fail(formData, "Enter the monthly cap as a dollar amount, like 250 or 250.00.");
  db.update(categories).set({ monthlyCapCents: cap }).where(eq(categories.id, id)).run();
  revalidateAll();
  return {};
}

export async function archiveCategory(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  db.update(categories).set({ archived: true }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function createTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const accountId = parseId(formData.get("accountId"));
  const date = formString(formData, "date") || todayIso();
  const type = formString(formData, "type");
  const payee = formString(formData, "payee");
  const rawDescription = formString(formData, "rawDescription");
  const categoryRaw = formString(formData, "categoryId");

  if (!accountId || !findAccount(accountId)) return fail(formData, "Pick an account.");
  if (!isOneOf(["expense", "income", "transfer"] as const, type)) return fail(formData, "Pick a transaction type.");
  if (!isValidIsoDate(date)) return fail(formData, "Enter a valid date.");
  const absCents = tryDollarsToCents(formString(formData, "amount"));
  if (absCents === null || absCents === 0) {
    return fail(formData, "Enter the amount as a dollar figure, like 12.50.");
  }

  const isTransfer = type === "transfer";
  let categoryId: number | null = null;
  if (!isTransfer && categoryRaw) {
    categoryId = parseId(categoryRaw);
    const category = categoryId ? findCategory(categoryId) : undefined;
    if (!category || category.archived) return fail(formData, "That category no longer exists.");
    if (category.kind !== type) {
      return fail(formData, `"${category.name}" is an ${category.kind} category. Pick one that matches the type.`);
    }
  }
  const amountCents = type === "income" ? Math.abs(absCents) : -Math.abs(absCents);

  db.insert(transactions)
    .values({
      accountId,
      categoryId,
      date,
      amountCents,
      payee,
      rawDescription,
      source: "manual",
      isTransfer,
    })
    .run();
  revalidateAll();
  return {};
}

export async function updateTransactionCategory(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  const categoryRaw = formString(formData, "categoryId");
  const categoryId = categoryRaw ? parseId(categoryRaw) : null;
  if (categoryRaw && (!categoryId || !findCategory(categoryId))) return;
  db.update(transactions).set({ categoryId }).where(eq(transactions.id, id)).run();
  revalidateAll();
}

export async function toggleTransfer(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  const current = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!current) return;
  db.update(transactions)
    .set({
      isTransfer: !current.isTransfer,
      categoryId: !current.isTransfer ? null : current.categoryId,
    })
    .where(eq(transactions.id, id))
    .run();
  revalidateAll();
}

export async function deleteTransaction(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  db.delete(transactions).where(eq(transactions.id, id)).run();
  revalidateAll();
}

export type ImportResult =
  | { error: string }
  | { error?: undefined; imported: number; duplicates: number; unreadable: number };

export async function importCsvRows(input: {
  accountId: number;
  filename: string;
  mapping: ImportMapping;
  rows: MappedRow[];
}): Promise<ImportResult> {
  if (!Number.isInteger(input.accountId) || !findAccount(input.accountId)) {
    return { error: "That account no longer exists." };
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { error: "The file has no rows to import." };
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    return { error: `That file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.` };
  }
  const invert = input.mapping?.amountMode === "single" && input.mapping.invert === true;

  const prepared: Array<ReadRow & { hash: string }> = [];
  const seen = new Map<string, number>();

  for (const raw of input.rows) {
    const row = readRow(
      {
        date: String(raw?.date ?? ""),
        amount: String(raw?.amount ?? ""),
        payee: String(raw?.payee ?? "").trim(),
        description: String(raw?.description ?? "").trim(),
      },
      invert,
    );
    if (!row) continue;
    const details = {
      accountId: input.accountId,
      date: row.date,
      amountCents: row.amountCents,
      description: row.description || row.payee,
    };
    // Two identical rows in one file are separate transactions (e.g. two coffees
    // on the same day), so number the repeats rather than collapsing them.
    const baseHash = importHash(details);
    const occurrence = seen.get(baseHash) ?? 0;
    seen.set(baseHash, occurrence + 1);
    const hash = occurrence === 0 ? baseHash : importHash({ ...details, occurrence });
    prepared.push({ ...row, hash });
  }

  const existing = existingHashes(input.accountId);
  const unique = prepared.filter((row) => !existing.has(row.hash));
  const duplicates = prepared.length - unique.length;
  const unreadable = input.rows.length - prepared.length;

  // Nothing new (e.g. the same file again): leave no entry in the import history.
  if (unique.length === 0) return { imported: 0, duplicates, unreadable };

  db.transaction((tx) => {
    const batch = tx
      .insert(importBatches)
      .values({
        accountId: input.accountId,
        filename: String(input.filename).slice(0, 255),
        mappedColumns: JSON.stringify(input.mapping ?? {}),
        rowCount: input.rows.length,
        importedCount: unique.length,
        skippedCount: duplicates + unreadable,
        createdAt: new Date().toISOString(),
      })
      .returning({ id: importBatches.id })
      .get();

    for (let i = 0; i < unique.length; i += INSERT_CHUNK) {
      tx.insert(transactions)
        .values(
          unique.slice(i, i + INSERT_CHUNK).map((row) => ({
            accountId: input.accountId,
            date: row.date,
            amountCents: row.amountCents,
            payee: row.payee,
            rawDescription: row.description,
            source: "csv" as const,
            importHash: row.hash,
            isTransfer: false,
            importBatchId: batch.id,
          })),
        )
        .run();
    }

    tx.update(accounts).set({ source: "csv" }).where(eq(accounts.id, input.accountId)).run();
  });

  revalidateAll();
  return { imported: unique.length, duplicates, unreadable };
}

// Removes the transactions an import added (those still present) and its history entry.
export async function undoImport(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  db.transaction((tx) => {
    tx.delete(transactions).where(eq(transactions.importBatchId, id)).run();
    tx.delete(importBatches).where(eq(importBatches.id, id)).run();
  });
  revalidateAll();
}
