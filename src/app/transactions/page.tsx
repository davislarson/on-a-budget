import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { MonthPicker } from "@/components/month-picker";
import { CategorySelect, TransactionButtons } from "@/components/transaction-controls";
import { TransactionForm } from "@/components/transaction-form";
import { formatMonthLabel, monthFromParam } from "@/lib/dates";
import { listAccounts, listCategories, listTransactions } from "@/lib/queries";

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const month = monthFromParam(param(params.month));
  const accountParam = Number(param(params.account)) || undefined;
  const categoryRaw = param(params.category);
  const categoryParam =
    categoryRaw === "uncategorized" ? "uncategorized" : Number(categoryRaw) || undefined;

  const accounts = listAccounts();
  const categories = listCategories();
  const rows = listTransactions({ month, accountId: accountParam, categoryId: categoryParam });

  const budgetRows = rows.filter((tx) => !tx.isTransfer);
  const inCents = budgetRows.filter((tx) => tx.amountCents > 0).reduce((sum, tx) => sum + tx.amountCents, 0);
  const outCents = budgetRows.filter((tx) => tx.amountCents < 0).reduce((sum, tx) => sum - tx.amountCents, 0);
  const filtered = accountParam !== undefined || categoryParam !== undefined;
  const monthLabel = formatMonthLabel(month);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <Suspense fallback={<span className="font-semibold">{monthLabel}</span>}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      <details className="card p-5" open={accounts.length > 0 && rows.length === 0 && !filtered}>
        <summary className="cursor-pointer font-semibold">Add a transaction</summary>
        <div className="mt-4">
          <TransactionForm accounts={accounts} categories={categories} />
        </div>
      </details>

      <section className="card p-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="month" value={month} />
          <label className="field">
            <span>Account</span>
            <select name="account" defaultValue={accountParam ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select name="category" defaultValue={categoryParam ?? ""}>
              <option value="">All categories</option>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
          {filtered && (
            <Link href={`/transactions?month=${month}`} className="btn text-muted hover:text-foreground">
              Clear
            </Link>
          )}
          <p className="ml-auto text-sm text-muted">
            {rows.length} transaction{rows.length === 1 ? "" : "s"} · in{" "}
            <Money cents={inCents} className="text-ok" /> · out <Money cents={outCents} />
          </p>
        </form>

        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            {filtered ? "No transactions match these filters." : `No transactions in ${monthLabel}.`}
          </p>
        ) : (
          <div className="table-wrap mt-4">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Account</th>
                  <th>Category</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr key={tx.id} className={tx.isTransfer ? "text-muted" : ""}>
                    <td className="whitespace-nowrap text-muted">{tx.date}</td>
                    <td>
                      <div>{tx.payee || tx.rawDescription || "—"}</div>
                      {tx.payee && tx.rawDescription && tx.rawDescription !== tx.payee && (
                        <div className="text-xs text-muted">{tx.rawDescription}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{tx.accountName}</td>
                    <td>
                      <CategorySelect
                        key={`${tx.id}-${tx.categoryId}`}
                        transactionId={tx.id}
                        categoryId={tx.categoryId}
                        isTransfer={tx.isTransfer}
                        categories={categories}
                      />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Money cents={tx.amountCents} signed className={tx.amountCents > 0 && !tx.isTransfer ? "text-ok" : ""} />
                    </td>
                    <td>
                      <TransactionButtons id={tx.id} isTransfer={tx.isTransfer} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
