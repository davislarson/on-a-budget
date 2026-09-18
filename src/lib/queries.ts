import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { lastNMonths, monthBounds } from "@/lib/dates";

export function listAccounts() {
  return db.select().from(accounts).orderBy(asc(accounts.name)).all();
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

export function existingHashes(accountId: number, hashes: string[]) {
  if (hashes.length === 0) return new Set<string>();
  const rows = db
    .select({ importHash: transactions.importHash })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), inArray(transactions.importHash, hashes)))
    .all();
  return new Set(rows.map((row) => row.importHash).filter((hash): hash is string => Boolean(hash)));
}
