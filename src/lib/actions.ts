"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  accountTypes,
  accounts,
  categories,
  categoryKinds,
  categoryRules,
  importBatches,
  transactions,
} from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { importHash } from "@/lib/hash";
import { tryDollarsToCents } from "@/lib/money";
import { isValidIsoDate, todayIso } from "@/lib/dates";
import { readRow, type ImportMapping, type MappedRow, type ReadRow } from "@/lib/import-mapping";
import { existingHashes, listRules } from "@/lib/queries";
import { matchRule, normalizePattern } from "@/lib/rules";

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

const CAP_ERROR = "Enter the monthly cap as a dollar amount, like 250 or 250.00.";

// Empty input means "no cap"; returns undefined when the input isn't a valid amount.
function parseCap(raw: string): number | null | undefined {
  if (raw === "") return null;
  const cents = tryDollarsToCents(raw);
  if (cents === null || cents < 0) return undefined;
  return cents;
}

function activeCategories(kind: (typeof categoryKinds)[number]) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.kind, kind), eq(categories.archived, false)))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
}

function nameTaken(kind: (typeof categoryKinds)[number], name: string, exceptId?: number) {
  return activeCategories(kind).some(
    (cat) => cat.id !== exceptId && cat.name.toLowerCase() === name.toLowerCase(),
  );
}

// Income sorts ahead of expenses wherever both kinds are listed together.
function sortBase(kind: (typeof categoryKinds)[number]) {
  return kind === "income" ? 0 : 1000;
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = formString(formData, "name");
  const kind = formString(formData, "kind");
  if (!name) return fail(formData, "Category name is required.");
  if (!isOneOf(categoryKinds, kind)) return fail(formData, "Pick income or expense.");
  if (nameTaken(kind, name)) return fail(formData, `You already have a category called "${name}".`);
  const cap = kind === "expense" ? parseCap(formString(formData, "monthlyCap")) : null;
  if (cap === undefined) return fail(formData, CAP_ERROR);
  const last = activeCategories(kind).at(-1);
  db.insert(categories)
    .values({
      name,
      kind,
      monthlyCapCents: cap,
      sortOrder: Math.max(sortBase(kind), last?.sortOrder ?? 0) + 1,
      archived: false,
    })
    .run();
  revalidateAll();
  return {};
}

export async function updateCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  const category = id ? findCategory(id) : undefined;
  if (!id || !category) return fail(formData, "That category no longer exists.");
  const name = formString(formData, "name");
  if (!name) return fail(formData, "Category name is required.");
  if (nameTaken(category.kind, name, id)) {
    return fail(formData, `You already have a category called "${name}".`);
  }
  const cap = category.kind === "expense" ? parseCap(formString(formData, "monthlyCap")) : null;
  if (cap === undefined) return fail(formData, CAP_ERROR);
  db.update(categories).set({ name, monthlyCapCents: cap }).where(eq(categories.id, id)).run();
  revalidateAll();
  return {};
}

export async function moveCategory(formData: FormData) {
  const id = parseId(formData.get("id"));
  const category = id ? findCategory(id) : undefined;
  if (!category || category.archived) return;
  const ordered = activeCategories(category.kind);
  const from = ordered.findIndex((cat) => cat.id === category.id);
  const to = formString(formData, "direction") === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  // Renumber the whole list: stored orders can tie, so swapping two values isn't enough.
  db.transaction((tx) => {
    ordered.forEach((cat, index) => {
      tx.update(categories)
        .set({ sortOrder: sortBase(category.kind) + index + 1 })
        .where(eq(categories.id, cat.id))
        .run();
    });
  });
  revalidateAll();
}

// Archiving hides a category from pickers and the budget; its transactions keep it.
export async function archiveCategory(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  db.update(categories).set({ archived: true }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function restoreCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  const category = id ? findCategory(id) : undefined;
  if (!id || !category) return fail(formData, "That category no longer exists.");
  if (nameTaken(category.kind, category.name, id)) {
    return fail(formData, `You already have an active category called "${category.name}". Rename it first.`);
  }
  const last = activeCategories(category.kind).at(-1);
  db.update(categories)
    .set({ archived: false, sortOrder: Math.max(sortBase(category.kind), last?.sortOrder ?? 0) + 1 })
    .where(eq(categories.id, id))
    .run();
  revalidateAll();
  return {};
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
  | { error?: undefined; imported: number; duplicates: number; unreadable: number; categorized: number };

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
  if (unique.length === 0) return { imported: 0, duplicates, unreadable, categorized: 0 };

  const rules = listRules();
  const categoryIds = unique.map((row) => matchRule(rules, row)?.categoryId ?? null);
  const categorized = categoryIds.filter((id) => id !== null).length;

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
          unique.slice(i, i + INSERT_CHUNK).map((row, offset) => ({
            accountId: input.accountId,
            categoryId: categoryIds[i + offset],
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
  return { imported: unique.length, duplicates, unreadable, categorized };
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

// Categorizes uncategorized, non-transfer transactions that match a rule.
// Never changes a category that's already set. Returns how many were updated.
function applyRulesToUncategorized(): number {
  const rules = listRules();
  if (rules.length === 0) return 0;
  const pending = db
    .select({
      id: transactions.id,
      payee: transactions.payee,
      description: transactions.rawDescription,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(isNull(transactions.categoryId), eq(transactions.isTransfer, false)))
    .all();
  let updated = 0;
  db.transaction((tx) => {
    for (const row of pending) {
      const rule = matchRule(rules, row);
      if (!rule) continue;
      tx.update(transactions).set({ categoryId: rule.categoryId }).where(eq(transactions.id, row.id)).run();
      updated += 1;
    }
  });
  return updated;
}

function categorizedMessage(count: number) {
  return count === 0
    ? "No uncategorized transactions matched."
    : `Categorized ${count} transaction${count === 1 ? "" : "s"}.`;
}

function validateRule(
  formData: FormData,
  exceptId?: number,
): { error: string } | { pattern: string; categoryId: number } {
  const pattern = normalizePattern(formString(formData, "pattern"));
  if (pattern.length < 2) return { error: "Enter at least 2 characters to match on." };
  const categoryId = parseId(formData.get("categoryId"));
  const category = categoryId ? findCategory(categoryId) : undefined;
  if (!categoryId || !category || category.archived) return { error: "Pick a category." };
  const duplicate = listRules().some((rule) => rule.id !== exceptId && rule.pattern === pattern);
  if (duplicate) return { error: `You already have a rule for "${pattern}".` };
  return { pattern, categoryId };
}

export async function createRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rule = validateRule(formData);
  if ("error" in rule) return fail(formData, rule.error);
  db.insert(categoryRules).values({ ...rule, createdAt: new Date().toISOString() }).run();
  const updated = applyRulesToUncategorized();
  revalidateAll();
  return { message: `Rule added. ${categorizedMessage(updated)}` };
}

export async function updateRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(formData.get("id"));
  if (!id) return fail(formData, "That rule no longer exists.");
  const rule = validateRule(formData, id);
  if ("error" in rule) return fail(formData, rule.error);
  db.update(categoryRules).set(rule).where(eq(categoryRules.id, id)).run();
  revalidateAll();
  return {};
}

// Deleting a rule leaves the transactions it already categorized as they are.
export async function deleteRule(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  db.delete(categoryRules).where(eq(categoryRules.id, id)).run();
  revalidateAll();
}

export async function applyRules(): Promise<ActionState> {
  const updated = applyRulesToUncategorized();
  revalidateAll();
  return { message: categorizedMessage(updated) };
}

// "Always categorize this payee like this": makes a rule from a categorized
// transaction and applies it to anything still uncategorized.
export async function createRuleFromTransaction(formData: FormData) {
  const id = parseId(formData.get("id"));
  if (!id) return;
  const tx = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!tx || tx.isTransfer || tx.categoryId === null) return;
  const pattern = normalizePattern(tx.payee || tx.rawDescription);
  if (pattern.length < 2) return;
  if (!listRules().some((rule) => rule.pattern === pattern)) {
    db.insert(categoryRules)
      .values({ pattern, categoryId: tx.categoryId, createdAt: new Date().toISOString() })
      .run();
  }
  applyRulesToUncategorized();
  revalidateAll();
}
