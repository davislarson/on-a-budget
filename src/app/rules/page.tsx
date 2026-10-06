import { connection } from "next/server";
import { ApplyRulesButton, RuleForm, RuleRow } from "@/components/rule-controls";
import { countUncategorized, listCategories, listRules, ruleMatchCounts } from "@/lib/queries";

export default async function RulesPage() {
  // Read rules at request time rather than baking them in at build time.
  await connection();
  const rules = listRules();
  const categories = listCategories();
  const matchCounts = ruleMatchCounts(rules);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Rules categorize transactions for you. They run on every import and only ever fill in
          transactions that have no category — they never change one you&apos;ve set.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Add a rule</h2>
        <div className="mt-4">
          <RuleForm categories={categories} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Matching ignores capitals. When several rules match, the longest text wins. A spending
          rule only applies to money going out, and an income rule to money coming in.
        </p>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Your rules</h2>
          {rules.length > 0 && <ApplyRulesButton uncategorizedCount={countUncategorized()} />}
        </div>
        {rules.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No rules yet. Add one above, or use “Make rule” next to a categorized transaction.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                matchCount={matchCounts.get(rule.id) ?? 0}
                categories={categories}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
