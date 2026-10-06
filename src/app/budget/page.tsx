import { connection } from "next/server";
import { ArchivedCategoryRow, CategoryForm, CategoryRow } from "@/components/category-controls";
import { Money } from "@/components/money";
import { listCategories, recentAverages } from "@/lib/queries";

export default async function BudgetPage() {
  // Read categories at request time rather than baking them in at build time.
  await connection();
  const all = listCategories({ includeArchived: true });
  const expenses = all.filter((cat) => cat.kind === "expense" && !cat.archived);
  const incomes = all.filter((cat) => cat.kind === "income" && !cat.archived);
  const archived = all.filter((cat) => cat.archived);
  const averages = recentAverages();

  const budgetedCents = expenses.reduce((sum, cat) => sum + (cat.monthlyCapCents ?? 0), 0);
  const uncappedCount = expenses.filter((cat) => cat.monthlyCapCents === null).length;
  const leftCents = averages ? averages.incomeCents - budgetedCents : null;
  const basis = averages
    ? `Average of your last ${averages.monthCount === 1 ? "month" : `${averages.monthCount} months`}`
    : "No complete months of history yet";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Budget</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Budgeted per month" note={uncappedCount > 0 ? `${uncappedCount} without a cap` : undefined}>
          <Money cents={budgetedCents} />
        </Stat>
        <Stat label="Typical income" note={basis}>
          {averages ? <Money cents={averages.incomeCents} className="text-ok" /> : "—"}
        </Stat>
        <Stat
          label={leftCents !== null && leftCents < 0 ? "Over-budgeted by" : "Left unbudgeted"}
          note={
            leftCents === null
              ? undefined
              : leftCents < 0
                ? "Your caps add up to more than you typically earn"
                : "Typical income minus your caps"
          }
        >
          {leftCents === null ? (
            "—"
          ) : (
            <Money cents={Math.abs(leftCents)} className={leftCents < 0 ? "text-danger" : ""} />
          )}
        </Stat>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Spending categories</h2>
        <p className="mt-1 text-sm text-muted">
          A cap is the most you plan to spend in a category each month. The dashboard tracks
          spending against it.
        </p>
        <ul className="mt-2 divide-y divide-line">
          {expenses.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              averageCents={averages?.spendByCategory[category.name]}
              isFirst={index === 0}
              isLast={index === expenses.length - 1}
            />
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <CategoryForm kind="expense" />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Income categories</h2>
        <ul className="mt-2 divide-y divide-line">
          {incomes.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              isFirst={index === 0}
              isLast={index === incomes.length - 1}
            />
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <CategoryForm kind="income" />
        </div>
      </section>

      {archived.length > 0 && (
        <details className="card p-5">
          <summary className="cursor-pointer font-semibold">
            Archived categories ({archived.length})
          </summary>
          <p className="mt-2 text-sm text-muted">
            Archived categories are hidden from pickers and the budget. Transactions already in
            them keep their category.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {archived.map((category) => (
              <ArchivedCategoryRow key={category.id} category={category} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold">{children}</div>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}
