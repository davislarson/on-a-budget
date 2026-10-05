"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, categories, importBatches, transactions } from "@/db/schema";
import { importHash } from "@/lib/hash";
import { dollarsToCents, tryDollarsToCents } from "@/lib/money";
import { parseFlexibleDate, todayIso } from "@/lib/dates";
import { existingHashes } from "@/lib/queries";

function revalidateAll() {
  revalidatePath("/", "layout");
}

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createAccount(formData: FormData) {
  const name = formString(formData, "name");
  const type = formString(formData, "type") as "checking" | "savings" | "credit";
  const institution = formString(formData, "institution") || null;
  if (!name) throw new Error("Account name is required");
  if (!["checking", "savings", "credit"].includes(type)) {
    throw new Error("Invalid account type");
  }
  db.insert(accounts)
    .values({
      name,
      type,
      institution,
      source: "manual",
      createdAt: new Date().toISOString(),
    })
    .run();
  revalidateAll();
}

export async function updateAccount(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = formString(formData, "name");
  const type = formString(formData, "type") as "checking" | "savings" | "credit";
  const institution = formString(formData, "institution") || null;
  if (!id || !name) throw new Error("Account is required");
  db.update(accounts)
    .set({ name, type, institution })
    .where(eq(accounts.id, id))
    .run();
  revalidateAll();
}

export async function deleteAccount(formData: FormData) {
  const id = Number(formData.get("id"));
  const tx = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, id)).get();
  if (tx) {
    throw new Error("Cannot delete an account that still has transactions");
  }
  db.delete(accounts).where(eq(accounts.id, id)).run();
  revalidateAll();
}

export async function createCategory(formData: FormData) {
  const name = formString(formData, "name");
  const kind = formString(formData, "kind") as "income" | "expense";
  const capRaw = formString(formData, "monthlyCap");
  if (!name) throw new Error("Category name is required");
  const monthlyCapCents =
    kind === "expense" && capRaw ? dollarsToCents(capRaw) : null;
  db.insert(categories)
    .values({
      name,
      kind,
      monthlyCapCents,
      sortOrder: kind === "income" ? 50 : 100,
      archived: false,
    })
    .run();
  revalidateAll();
}

export async function updateCategoryCap(formData: FormData) {
  const id = Number(formData.get("id"));
  const capRaw = formString(formData, "monthlyCap");
  const monthlyCapCents = capRaw === "" ? 0 : dollarsToCents(capRaw);
  db.update(categories).set({ monthlyCapCents }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function archiveCategory(formData: FormData) {
  const id = Number(formData.get("id"));
  db.update(categories).set({ archived: true }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function createTransaction(formData: FormData) {
  const accountId = Number(formData.get("accountId"));
  const date = formString(formData, "date") || todayIso();
  const type = formString(formData, "type");
  const amountRaw = formString(formData, "amount");
  const payee = formString(formData, "payee");
  const rawDescription = formString(formData, "rawDescription");
  const categoryRaw = formString(formData, "categoryId");
  if (!accountId) throw new Error("Pick an account");
  const absCents = dollarsToCents(amountRaw);
  const isTransfer = type === "transfer";
  const amountCents = type === "income" ? Math.abs(absCents) : -Math.abs(absCents);
  const categoryId = categoryRaw ? Number(categoryRaw) : null;

  db.insert(transactions)
    .values({
      accountId,
      categoryId: isTransfer ? null : categoryId,
      date,
      amountCents,
      payee,
      rawDescription,
      source: "manual",
      isTransfer,
    })
    .run();
  revalidateAll();
}

export async function updateTransactionCategory(formData: FormData) {
  const id = Number(formData.get("id"));
  const categoryRaw = formString(formData, "categoryId");
  const categoryId = categoryRaw ? Number(categoryRaw) : null;
  db.update(transactions).set({ categoryId }).where(eq(transactions.id, id)).run();
  revalidateAll();
}

export async function toggleTransfer(formData: FormData) {
  const id = Number(formData.get("id"));
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
  const id = Number(formData.get("id"));
  db.delete(transactions).where(eq(transactions.id, id)).run();
  revalidateAll();
}

export type ImportRowInput = {
  date: string;
  amount: string;
  payee?: string;
  description?: string;
};

export async function importCsvRows(input: {
  accountId: number;
  filename: string;
  mapping: Record<string, string>;
  invertAmounts: boolean;
  rows: ImportRowInput[];
}) {
  const found = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!found) throw new Error("Account not found");

  const prepared: Array<{
    date: string;
    amountCents: number;
    payee: string;
    rawDescription: string;
    hash: string;
  }> = [];

  for (const row of input.rows) {
    const date = parseFlexibleDate(row.date);
    const parsed = tryDollarsToCents(row.amount);
    if (!date || parsed === null || parsed === 0) continue;
    let amountCents = parsed;
    if (input.invertAmounts) amountCents = -amountCents;
    const rawDescription = (row.description ?? "").trim();
    const payee = (row.payee ?? "").trim() || rawDescription.slice(0, 80);
    const hash = importHash({
      accountId: input.accountId,
      date,
      amountCents,
      description: rawDescription || payee,
    });
    prepared.push({ date, amountCents, payee, rawDescription, hash });
  }

  const hashes = prepared.map((row) => row.hash);
  const existing = existingHashes(input.accountId, hashes);
  const unique = prepared.filter((row) => !existing.has(row.hash));
  const skipped = prepared.length - unique.length + (input.rows.length - prepared.length);

  const batch = db
    .insert(importBatches)
    .values({
      filename: input.filename,
      mappedColumns: JSON.stringify(input.mapping),
      rowCount: input.rows.length,
      importedCount: unique.length,
      skippedCount: skipped,
      createdAt: new Date().toISOString(),
    })
    .returning({ id: importBatches.id })
    .get();

  if (unique.length > 0) {
    db.insert(transactions)
      .values(
        unique.map((row) => ({
          accountId: input.accountId,
          date: row.date,
          amountCents: row.amountCents,
          payee: row.payee,
          rawDescription: row.rawDescription,
          source: "csv" as const,
          importHash: row.hash,
          isTransfer: false,
          importBatchId: batch?.id,
        })),
      )
      .run();

    db.update(accounts).set({ source: "csv" }).where(eq(accounts.id, input.accountId)).run();
  }

  revalidateAll();
  return {
    imported: unique.length,
    skipped,
    parsed: prepared.length,
  };
}

