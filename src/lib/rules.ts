export type Rule = {
  id: number;
  pattern: string;
  categoryId: number;
  categoryName: string;
  categoryKind: "income" | "expense";
  categoryArchived: boolean;
};

export type Matchable = { payee: string; description: string; amountCents: number };

export function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, " ").toLowerCase();
}

export function textMatches(pattern: string, tx: { payee: string; description: string }): boolean {
  const needle = normalizePattern(pattern);
  if (!needle) return false;
  return (
    normalizePattern(tx.payee).includes(needle) || normalizePattern(tx.description).includes(needle)
  );
}

// A rule only applies when the money flows the way its category expects: spending
// for an expense category, money in for an income category. A grocery refund is
// left for you to decide rather than filed as "Groceries" income.
function directionFits(rule: Rule, amountCents: number): boolean {
  return rule.categoryKind === "expense" ? amountCents < 0 : amountCents > 0;
}

// The most specific (longest) matching pattern wins; ties go to the older rule.
export function matchRule(rules: Rule[], tx: Matchable): Rule | null {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (rule.categoryArchived || !directionFits(rule, tx.amountCents) || !textMatches(rule.pattern, tx)) {
      continue;
    }
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.id < best.id)
    ) {
      best = rule;
    }
  }
  return best;
}
