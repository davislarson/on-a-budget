import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, sum } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, importBatches, transactions, type Account } from "@/db/schema";
import { currentMonth, lastNMonths, monthBounds, shiftMonth } from "@/lib/dates";

export function listAccounts() {
  return db.select().from(accounts).orderBy(asc(accounts.name)).all();
}

export type AccountSummary = Account & {
  transactionCount: number;
  balanceCents: number;
};

export function listAccountSummaries(): AccountSummary[] {
  const totals = db
    .select({
      accountId: transactions.accountId,
      count: count(),
      sumCents: sum(transactions.amountCents).mapWith(Number),
    })
    .from(transactions)
    .groupBy(transactions.accountId)
    .all();
  const byAccount = new Map(totals.map((row) => [row.accountId, row]));
  return listAccounts().map((account) => {
    const total = byAccount.get(account.id);
    return {
      ...account,
      transactionCount: total?.count ?? 0,
      balanceCents: account.openingBalanceCents + (total?.sumCents ?? 0),
    };
  });
}

export function listCategories(options?: { includeArchived?: boolean }) {
  const rows = db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
  if (options?.includeArchived) return rows;
  return rows.filter((row) => !row.archived);
}

export type TransactionRow = {
  id: number;
  date: string;
  amountCents: number;
  payee: string;
  rawDescription: string;
  isTransfer: boolean;
  source: string;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string | null;
  categoryKind: "income" | "expense" | null;
};

export function listTransactions(filters: {
  month?: string;
  accountId?: number;
  categoryId?: number | "uncategorized";
}) {
  const conditions = [];
  if (filters.month) {
    const { start, end } = monthBounds(filters.month);
    conditions.push(gte(transactions.date, start));
    conditions.push(lte(transactions.date, end));
  }
  if (filters.accountId) {
    conditions.push(eq(transactions.accountId, filters.accountId));
  }
  if (filters.categoryId === "uncategorized") {
    conditions.push(isNull(transactions.categoryId));
    conditions.push(eq(transactions.isTransfer, false));
  } else if (typeof filters.categoryId === "number") {
    conditions.push(eq(transactions.categoryId, filters.categoryId));
  }

  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      rawDescription: transactions.rawDescription,
      isTransfer: transactions.isTransfer,
      source: transactions.source,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryKind: categories.kind,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all();
}

export function getTransaction(id: number) {
  return (
    db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .get() ?? null
  );
}

export type CategoryBudgetRow = {
  id: number;
  name: string;
  kind: "income" | "expense";
  monthlyCapCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  overBudget: boolean;
};

export function monthDashboard(month: string) {
  const { start, end } = monthBounds(month);
  const cats = listCategories();
  const monthTxs = db
    .select()
    .from(transactions)
    .where(and(gte(transactions.date, start), lte(transactions.date, end)))
    .all();

  const budgetTxs = monthTxs.filter((tx) => !tx.isTransfer);
  const incomeCents = budgetTxs
    .filter((tx) => tx.amountCents > 0)
    .reduce((sum, tx) => sum + tx.amountCents, 0);
  const spendCents = budgetTxs
    .filter((tx) => tx.amountCents < 0)
    .reduce((sum, tx) => sum + -tx.amountCents, 0);
  const uncategorizedCount = budgetTxs.filter((tx) => tx.categoryId === null).length;

  const spendByCategory = new Map<number, number>();
  const incomeByCategory = new Map<number, number>();
  for (const tx of budgetTxs) {
    if (tx.categoryId === null) continue;
    if (tx.amountCents < 0) {
      spendByCategory.set(tx.categoryId, (spendByCategory.get(tx.categoryId) ?? 0) + -tx.amountCents);
    } else if (tx.amountCents > 0) {
      incomeByCategory.set(tx.categoryId, (incomeByCategory.get(tx.categoryId) ?? 0) + tx.amountCents);
    }
  }

  const expenseRows: CategoryBudgetRow[] = cats
    .filter((cat) => cat.kind === "expense")
    .map((cat) => {
      const spentCents = spendByCategory.get(cat.id) ?? 0;
      const cap = cat.monthlyCapCents;
      const remainingCents = cap === null ? null : cap - spentCents;
      return {
        id: cat.id,
        name: cat.name,
        kind: cat.kind,
        monthlyCapCents: cap,
        spentCents,
        remainingCents,
        overBudget: cap !== null && spentCents > cap,
      };
    });

  const incomeRows = cats
    .filter((cat) => cat.kind === "income")
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      amountCents: incomeByCategory.get(cat.id) ?? 0,
    }));

  const allocatedCaps = expenseRows.reduce((sum, row) => sum + (row.monthlyCapCents ?? 0), 0);

  return {
    incomeCents,
    spendCents,
    leftoverCents: incomeCents - spendCents,
    allocatedCaps,
    uncategorizedCount,
    expenseRows,
    incomeRows,
    overBudget: expenseRows.filter((row) => row.overBudget),
  };
}

export function trends(endMonth: string, months = 12) {
  const monthKeys = lastNMonths(endMonth, months);
  const start = monthBounds(monthKeys[0]).start;
  const end = monthBounds(monthKeys[monthKeys.length - 1]).end;
  const cats = listCategories({ includeArchived: true });
  const txs = db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.date, start),
        lte(transactions.date, end),
        eq(transactions.isTransfer, false),
      ),
    )
    .all();

  const byMonth = monthKeys.map((month) => {
    const { start: s, end: e } = monthBounds(month);
    const inMonth = txs.filter((tx) => tx.date >= s && tx.date <= e);
    const incomeCents = inMonth.filter((tx) => tx.amountCents > 0).reduce((sum, tx) => sum + tx.amountCents, 0);
    const spendCents = inMonth.filter((tx) => tx.amountCents < 0).reduce((sum, tx) => sum + -tx.amountCents, 0);
    const spendByCategory: Record<string, number> = {};
    for (const cat of cats.filter((c) => c.kind === "expense")) {
      spendByCategory[cat.name] = inMonth
        .filter((tx) => tx.categoryId === cat.id && tx.amountCents < 0)
        .reduce((sum, tx) => sum + -tx.amountCents, 0);
    }
    return { month, incomeCents, spendCents, spendByCategory };
  });

  const expenseCategories = cats.filter((c) => c.kind === "expense" && !c.archived);

  return { monthKeys, byMonth, expenseCategories };
}

export function existingHashes(accountId: number) {
  const rows = db
    .select({ importHash: transactions.importHash })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNotNull(transactions.importHash)))
    .all();
  return new Set(rows.map((row) => row.importHash).filter((hash): hash is string => Boolean(hash)));
}

export type ImportHistoryRow = {
  id: number;
  filename: string;
  createdAt: string;
  accountName: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  // Imported transactions that haven't since been deleted individually.
  remainingCount: number;
};

export function listImportHistory(limit = 25): ImportHistoryRow[] {
  const remaining = db
    .select({ batchId: transactions.importBatchId, count: count() })
    .from(transactions)
    .where(isNotNull(transactions.importBatchId))
    .groupBy(transactions.importBatchId)
    .all();
  const remainingByBatch = new Map(remaining.map((row) => [row.batchId, row.count]));
  return db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      createdAt: importBatches.createdAt,
      accountName: accounts.name,
      rowCount: importBatches.rowCount,
      importedCount: importBatches.importedCount,
      skippedCount: importBatches.skippedCount,
    })
    .from(importBatches)
    .leftJoin(accounts, eq(importBatches.accountId, accounts.id))
    .orderBy(desc(importBatches.id))
    .limit(limit)
    .all()
    .map((row) => ({ ...row, remainingCount: remainingByBatch.get(row.id) ?? 0 }));
}

// The column mapping used by each account's most recent import, as stored JSON.
export function lastMappingByAccount(): Record<number, string> {
  const rows = db
    .select({ accountId: importBatches.accountId, mappedColumns: importBatches.mappedColumns })
    .from(importBatches)
    .where(isNotNull(importBatches.accountId))
    .orderBy(asc(importBatches.id))
    .all();
  const result: Record<number, string> = {};
  for (const row of rows) {
    if (row.accountId !== null) result[row.accountId] = row.mappedColumns;
  }
  return result;
}

// Averages over the last few complete months that have any activity, to guide cap-setting.
// Returns null when there's no history to average.
export function recentAverages(months = 3) {
  const { byMonth } = trends(shiftMonth(currentMonth(), -1), months);
  const active = byMonth.filter((month) => month.incomeCents > 0 || month.spendCents > 0);
  if (active.length === 0) return null;
  const average = (pick: (month: (typeof active)[number]) => number) =>
    Math.round(active.reduce((sum, month) => sum + pick(month), 0) / active.length);
  const spendByCategory: Record<string, number> = {};
  for (const name of Object.keys(active[0].spendByCategory)) {
    spendByCategory[name] = average((month) => month.spendByCategory[name] ?? 0);
  }
  return {
    monthCount: active.length,
    incomeCents: average((month) => month.incomeCents),
    spendCents: average((month) => month.spendCents),
    spendByCategory,
  };
}
