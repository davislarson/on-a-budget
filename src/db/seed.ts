import { count } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { categories } from "./schema";
import type * as schema from "./schema";

const DEFAULT_CATEGORIES: Array<{
  name: string;
  kind: "income" | "expense";
  monthlyCapCents: number | null;
  sortOrder: number;
}> = [
  { name: "Salary", kind: "income", monthlyCapCents: null, sortOrder: 1 },
  { name: "Side gig", kind: "income", monthlyCapCents: null, sortOrder: 2 },
  { name: "Housing", kind: "expense", monthlyCapCents: 150000, sortOrder: 10 },
  { name: "Groceries", kind: "expense", monthlyCapCents: 50000, sortOrder: 11 },
  { name: "Dining", kind: "expense", monthlyCapCents: 20000, sortOrder: 12 },
  { name: "Transport", kind: "expense", monthlyCapCents: 20000, sortOrder: 13 },
  { name: "Utilities", kind: "expense", monthlyCapCents: 20000, sortOrder: 14 },
  { name: "Health", kind: "expense", monthlyCapCents: 15000, sortOrder: 15 },
  { name: "Fun", kind: "expense", monthlyCapCents: 15000, sortOrder: 16 },
  { name: "Subscriptions", kind: "expense", monthlyCapCents: 5000, sortOrder: 17 },
  { name: "Other", kind: "expense", monthlyCapCents: 10000, sortOrder: 18 },
];

export function seedCategories(db: BetterSQLite3Database<typeof schema>) {
  const [{ value }] = db.select({ value: count() }).from(categories).all();
  if (value > 0) return;

  db.insert(categories).values(DEFAULT_CATEGORIES).run();
}
