import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { MonthPicker } from "@/components/month-picker";
import {
  CategoryChart,
  IncomeSpendingChart,
  Legend,
  NetChart,
  type CategorySeries,
  type MonthPoint,
} from "@/components/trend-charts";
import { currentMonth, formatMonthLabel, monthFromParam } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { trends } from "@/lib/queries";

const RANGES = [6, 12, 24];

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function TrendsPage({ searchParams }: PageProps<"/trends">) {
  const params = await searchParams;
  const endMonth = monthFromParam(param(params.month));
  const requested = Number(param(params.months));
  const range = RANGES.includes(requested) ? requested : 12;

  const { byMonth, expenseCategories } = trends(endMonth, range);
  const points: MonthPoint[] = byMonth.map((month) => ({
    month: month.month,
    incomeCents: month.incomeCents,
    spendCents: month.spendCents,
    netCents: month.incomeCents - month.spendCents,
  }));
  const hasData = points.some((point) => point.incomeCents > 0 || point.spendCents > 0);
  // Averages use complete months only; a month still in progress would drag them down.
  const thisMonth = currentMonth();
  const active = points.filter(
    (point) => point.month < thisMonth && (point.incomeCents > 0 || point.spendCents > 0),
  );
  const average = (pick: (point: MonthPoint) => number) =>
    active.length ? Math.round(active.reduce((sum, point) => sum + pick(point), 0) / active.length) : 0;
  const totalIncome = active.reduce((sum, point) => sum + point.incomeCents, 0);
  const totalNet = active.reduce((sum, point) => sum + point.netCents, 0);
  const savingsRate = totalIncome > 0 ? Math.round((totalNet / totalIncome) * 100) : null;

  const categories: CategorySeries[] = expenseCategories.map((category) => ({
    id: category.id,
    name: category.name,
    capCents: category.monthlyCapCents,
    points: byMonth.map((month) => ({
      month: month.month,
      spentCents: month.spendByCategory[category.name] ?? 0,
    })),
  }));
  const monthsNote =
    active.length === 0
      ? "No complete months yet"
      : `Average of ${active.length} complete month${active.length === 1 ? "" : "s"}`;
  const stat = (pick: (point: MonthPoint) => number) =>
    active.length === 0 ? "—" : formatCents(average(pick));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1" role="group" aria-label="Number of months">
          {RANGES.map((months) => (
            <Link
              key={months}
              href={`/trends?month=${endMonth}&months=${months}`}
              aria-current={months === range ? "true" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                months === range ? "bg-foreground text-background" : "text-muted hover:bg-card"
              }`}
            >
              {months} months
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>ending</span>
          <Suspense fallback={<span className="font-semibold">{formatMonthLabel(endMonth)}</span>}>
            <MonthPicker month={endMonth} />
          </Suspense>
        </div>
      </div>

      {!hasData ? (
        <div className="card p-8 text-center text-muted">
          No transactions in these {range} months.{" "}
          <Link href="/import" className="font-semibold text-accent hover:underline">
            Import a CSV
          </Link>{" "}
          to see trends.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Monthly income" note={monthsNote}>
              {stat((point) => point.incomeCents)}
            </Stat>
            <Stat label="Monthly spending" note={monthsNote}>
              {stat((point) => point.spendCents)}
            </Stat>
            <Stat label="Left over per month" note={monthsNote}>
              {stat((point) => point.netCents)}
            </Stat>
            <Stat label="Savings rate" note="Share of income not spent">
              {savingsRate === null ? "—" : `${savingsRate}%`}
            </Stat>
          </div>

          <section className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Income and spending</h2>
              <Legend
                items={[
                  { label: "Income", color: "var(--series-1)" },
                  { label: "Spending", color: "var(--series-2)" },
                ]}
              />
            </div>
            <p className="mt-1 text-sm text-muted">Transfers are left out. Click a month to see its transactions.</p>
            <div className="mt-4">
              <IncomeSpendingChart data={points} />
            </div>
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Left over each month</h2>
              <Legend
                items={[
                  { label: "Left over", color: "var(--series-1)" },
                  { label: "Overspent", color: "var(--viz-negative)" },
                ]}
              />
            </div>
            <p className="mt-1 text-sm text-muted">Income minus spending.</p>
            <div className="mt-4">
              <NetChart data={points} />
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Spending by category</h2>
            <p className="mt-1 text-sm text-muted">
              Each chart has its own scale. The dashed line is the category&apos;s monthly cap. Click a bar
              to see those transactions.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((series) => (
                <div key={series.id}>
                  <p className="text-sm font-medium">
                    {series.name}
                    <span className="font-normal text-muted">
                      {series.capCents === null ? " · no cap" : ` · cap ${formatCents(series.capCents)}`}
                    </span>
                  </p>
                  <CategoryChart series={series} />
                </div>
              ))}
            </div>
          </section>

          <details className="card p-5">
            <summary className="cursor-pointer font-semibold">View as a table</summary>
            <div className="table-wrap mt-4">
              <table className="data">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Income</th>
                    <th className="text-right">Spending</th>
                    <th className="text-right">Left over</th>
                    {categories.map((series) => (
                      <th key={series.id} className="text-right">
                        {series.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {points.map((point, index) => (
                    <tr key={point.month}>
                      <td className="whitespace-nowrap">
                        <Link href={`/transactions?month=${point.month}`} className="hover:underline">
                          {formatMonthLabel(point.month)}
                        </Link>
                      </td>
                      <td className="text-right">
                        <Money cents={point.incomeCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={point.spendCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={point.netCents} signed className={point.netCents < 0 ? "text-danger" : ""} />
                      </td>
                      {categories.map((series) => (
                        <td key={series.id} className="text-right">
                          <Money cents={series.points[index].spentCents} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Stat({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold">{children}</div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
