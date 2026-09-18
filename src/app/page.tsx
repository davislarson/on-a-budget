import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { MonthPicker } from "@/components/month-picker";
import { formatMonthLabel, monthFromParam } from "@/lib/dates";
import { listAccounts, listTransactions, monthDashboard, type CategoryBudgetRow } from "@/lib/queries";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { month: monthParam } = await searchParams;
  const month = monthFromParam(typeof monthParam === "string" ? monthParam : undefined);

  if (listAccounts().length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to On a Budget</h1>
        <p className="mt-2 text-muted">Add an account to start tracking your money.</p>
        <Link href="/accounts" className="btn btn-primary mt-6">
          Add an account
        </Link>
      </div>
    );
  }

  const data = monthDashboard(month);
  const recent = listTransactions({ month }).slice(0, 8);
  const monthLabel = formatMonthLabel(month);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Suspense fallback={<span className="font-semibold">{monthLabel}</span>}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Income">
          <Money cents={data.incomeCents} className="text-ok" />
        </Stat>
        <Stat label="Spending">
          <Money cents={data.spendCents} />
        </Stat>
        <Stat label="Left over">
          <Money
            cents={data.leftoverCents}
            signed
            className={data.leftoverCents < 0 ? "text-danger" : "text-ok"}
          />
        </Stat>
        <Stat label="Budgeted">
          <Money cents={data.allocatedCaps} />
          {data.incomeCents > 0 && (
            <p className="mt-1 text-xs text-muted">
              {Math.round((data.allocatedCaps / data.incomeCents) * 100)}% of income
            </p>
          )}
        </Stat>
      </div>

      {(data.overBudget.length > 0 || data.uncategorizedCount > 0) && (
        <div className="flex flex-col gap-2">
          {data.overBudget.length > 0 && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              Over budget in {data.overBudget.map((row) => row.name).join(", ")}.
            </p>
          )}
          {data.uncategorizedCount > 0 && (
            <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
              {data.uncategorizedCount} transaction{data.uncategorizedCount === 1 ? "" : "s"} still need a
              category.{" "}
              <Link
                href={`/transactions?month=${month}&category=uncategorized`}
                className="font-semibold text-accent underline-offset-2 hover:underline"
              >
                Categorize them
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold">Spending by category</h2>
          <ul className="mt-4 flex flex-col gap-4">
            {data.expenseRows.map((row) => (
              <BudgetRow key={row.id} row={row} month={month} />
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Income</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            {data.incomeRows.map((row) => (
              <li key={row.id} className="flex justify-between">
                <span>{row.name}</span>
                <Money cents={row.amountCents} className={row.amountCents > 0 ? "text-ok" : "text-muted"} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Recent transactions</h2>
          <Link href={`/transactions?month=${month}`} className="text-sm font-semibold text-accent hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No transactions in {monthLabel}.{" "}
            <Link href="/import" className="font-semibold text-accent hover:underline">
              Import a CSV
            </Link>{" "}
            or{" "}
            <Link href="/transactions" className="font-semibold text-accent hover:underline">
              add one manually
            </Link>
            .
          </p>
        ) : (
          <div className="table-wrap mt-2">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Category</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((tx) => (
                  <tr key={tx.id}>
                    <td className="whitespace-nowrap text-muted">{tx.date}</td>
                    <td>{tx.payee || tx.rawDescription}</td>
                    <td className="text-muted">
                      {tx.isTransfer ? "Transfer" : (tx.categoryName ?? "Uncategorized")}
                    </td>
                    <td className="text-right">
                      <Money cents={tx.amountCents} signed className={tx.amountCents > 0 ? "text-ok" : ""} />
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold">{children}</div>
    </div>
  );
}

function BudgetRow({ row, month }: { row: CategoryBudgetRow; month: string }) {
  const cap = row.monthlyCapCents;
  const pct = cap ? Math.min(100, (row.spentCents / cap) * 100) : 0;
  const barColor = row.overBudget ? "bg-danger" : pct >= 85 ? "bg-amber-500" : "bg-accent";

  return (
    <li>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <Link href={`/transactions?month=${month}&category=${row.id}`} className="font-medium hover:underline">
          {row.name}
        </Link>
        <span className="text-muted">
          <Money cents={row.spentCents} className="text-foreground" />
          {cap !== null && (
            <>
              {" / "}
              <Money cents={cap} />
            </>
          )}
        </span>
      </div>
      {cap !== null ? (
        <>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`mt-1 text-xs ${row.overBudget ? "text-danger" : "text-muted"}`}>
            {row.overBudget ? (
              <>
                <Money cents={-(row.remainingCents ?? 0)} /> over
              </>
            ) : (
              <>
                <Money cents={row.remainingCents ?? 0} /> left
              </>
            )}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted">No cap set</p>
      )}
    </li>
  );
}
