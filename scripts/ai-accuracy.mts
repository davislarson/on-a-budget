// Measures how well local Ollama models categorize merchants you've already
// categorized, using the same grouping, prompt, and checks as the app (src/lib/ai).
//
//   npm run eval:ai -- qwen2.5:14b
//   npm run eval:ai -- qwen2.5:14b --examples=15 --chunk=5
//
//   --examples=N   show N of your other categorized merchants as examples
//   --chunk=N      merchants per request
//
// Opens the database read-only and only talks to Ollama. It prints totals only;
// merchant-level results go to a gitignored file next to the database.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { categorizeChunk, chunkMerchants, CHUNK_SIZE, type Suggestion } from "../src/lib/ai/categorize";
import { groupMerchants, type CategoryKind, type Merchant, type UncategorizedRow } from "../src/lib/ai/merchants";
import { createOllamaAsk } from "../src/lib/ai/ollama";
import type { CategorizedExample, CategoryChoice } from "../src/lib/ai/prompt";
import { textMatches } from "../src/lib/rules";

const TARGET = 0.85;

type CategorizedRow = UncategorizedRow & { category: string; kind: CategoryKind };
type Scored = Merchant & { expected: string; mixed: boolean };

const args = process.argv.slice(2);
const models = args.filter((arg) => !arg.startsWith("--"));
const numberFlag = (name: string, fallback: number) => {
  const flag = args.find((arg) => arg.startsWith(`--${name}=`));
  return flag ? Number(flag.split("=")[1]) : fallback;
};
const exampleCount = numberFlag("examples", 0);
const chunkSize = numberFlag("chunk", CHUNK_SIZE);
if (models.length === 0) {
  console.error("Name at least one Ollama model: npm run eval:ai -- qwen2.5:14b");
  process.exit(1);
}

const dbPath = path.resolve(process.env.BUDGET_DB_PATH ?? "data/budget.sqlite");
const reportPath = path.join(path.dirname(dbPath), "ai-accuracy-report.txt");

function load() {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = sqlite
    .prepare(
      `SELECT t.id, t.payee, t.raw_description AS description, t.amount_cents AS amountCents,
              c.name AS category, c.kind
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.is_transfer = 0 AND c.archived = 0`,
    )
    .all() as CategorizedRow[];
  const patterns = (sqlite.prepare("SELECT pattern FROM category_rules").all() as Array<{ pattern: string }>).map(
    (rule) => rule.pattern,
  );
  const categories = sqlite
    .prepare("SELECT id, name, kind FROM categories WHERE archived = 0 ORDER BY sort_order")
    .all() as CategoryChoice[];
  sqlite.close();

  // Rules run first in the real flow, and refunds are left for you to decide, so
  // neither would reach the AI.
  const eligible = rows.filter((row) => {
    const fits = row.kind === "expense" ? row.amountCents < 0 : row.amountCents > 0;
    return fits && !patterns.some((pattern) => textMatches(pattern, row));
  });
  const categoryOf = new Map(eligible.map((row) => [row.id, row.category]));
  const merchants: Scored[] = groupMerchants(eligible).map((merchant) => {
    const votes = new Map<string, number>();
    for (const id of merchant.transactionIds) {
      const category = categoryOf.get(id)!;
      votes.set(category, (votes.get(category) ?? 0) + 1);
    }
    // A merchant you've filed more than one way is scored against your most-used choice.
    const expected = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    return { ...merchant, expected, mixed: votes.size > 1 };
  });
  return { merchants, categories, skipped: rows.length - eligible.length };
}

// Takes examples from every category in turn. Merchants being asked about are left
// out, so the score only counts ones the model hasn't been shown the answer to.
function pickExamples(merchants: Scored[], kind: CategoryKind, chunk: Merchant[]): CategorizedExample[] {
  const byCategory = new Map<string, Scored[]>();
  for (const merchant of merchants) {
    if (merchant.kind !== kind || merchant.mixed || chunk.includes(merchant)) continue;
    byCategory.set(merchant.expected, [...(byCategory.get(merchant.expected) ?? []), merchant]);
  }
  const picked: CategorizedExample[] = [];
  while (picked.length < exampleCount && byCategory.size > 0) {
    for (const [category, list] of byCategory) {
      if (picked.length >= exampleCount) break;
      picked.push({ merchant: list.shift()!, categoryName: category });
      if (list.length === 0) byCategory.delete(category);
    }
  }
  return picked;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

const { merchants, categories, skipped } = load();
if (merchants.length === 0) {
  console.error("No categorized transactions to compare against.");
  process.exit(1);
}
console.log(
  `${merchants.length} merchants to check (${merchants.filter((merchant) => merchant.mixed).length} filed more than one way; ` +
    `${skipped} transactions skipped as refunds or already covered by rules).`,
);

const nameOf = new Map(categories.map((category) => [category.id, category.name]));
const report: string[] = [];
for (const model of models) {
  const ask = createOllamaAsk(model);
  const started = Date.now();
  const suggestions: Suggestion[] = [];
  let failedChunks = 0;
  let lastFailure = "";
  for (const { kind, merchants: chunk } of chunkMerchants(merchants, chunkSize)) {
    try {
      const examples = exampleCount > 0 ? pickExamples(merchants, kind, chunk) : [];
      suggestions.push(...(await categorizeChunk(kind, chunk, categories, ask, examples)));
    } catch (error) {
      failedChunks += 1;
      lastFailure = error instanceof Error ? error.message : String(error);
      suggestions.push(...chunk.map((merchant) => ({ merchant, categoryId: null, status: "no-answer" as const })));
    }
  }
  const seconds = (Date.now() - started) / 1000;

  const answered = suggestions.filter((s) => s.status === "suggested");
  const isCorrect = (s: Suggestion) => nameOf.get(s.categoryId!) === (s.merchant as Scored).expected;
  const correct = answered.filter(isCorrect).length;
  const accuracy = answered.length ? correct / answered.length : 0;
  const unsure = suggestions.filter((s) => s.status === "unsure").length;
  const noAnswer = suggestions.length - answered.length - unsure;
  console.log(
    `${model}: ${correct}/${answered.length} correct when answering (${percent(accuracy)}), ${unsure} unsure, ` +
      `${noAnswer} no answer, ${seconds.toFixed(1)}s. ${accuracy >= TARGET ? "Meets" : "Below"} the ${percent(TARGET)} target.`,
  );

  // Category names only: which of yours it mixes up, never which merchants.
  const confusions = new Map<string, number>();
  for (const s of answered.filter((s) => !isCorrect(s))) {
    const pair = `${(s.merchant as Scored).expected} -> ${nameOf.get(s.categoryId!)}`;
    confusions.set(pair, (confusions.get(pair) ?? 0) + 1);
  }
  if (confusions.size > 0) {
    const pairs = [...confusions].sort((a, b) => b[1] - a[1]).map(([pair, count]) => `${pair} x${count}`);
    console.log(`  Mix-ups (yours -> model's): ${pairs.join(", ")}`);
  }
  if (failedChunks > 0) console.log(`  ${failedChunks} batches failed: ${lastFailure}`);

  report.push(`== ${model} ${args.join(" ")}: ${correct}/${answered.length} correct, ${unsure} unsure, ${noAnswer} no answer`);
  for (const s of suggestions) {
    const scored = s.merchant as Scored;
    const answer = s.status === "suggested" ? nameOf.get(s.categoryId!) : s.status;
    const mark = s.status === "suggested" ? (isCorrect(s) ? "ok " : "BAD") : "?  ";
    report.push(`${mark} ${scored.text} -> ${answer} (yours: ${scored.expected})${scored.mixed ? " [filed more than one way]" : ""}`);
  }
  report.push("");
}
fs.appendFileSync(reportPath, `-- ${new Date().toISOString()}\n${report.join("\n")}\n`);
console.log(`Details by merchant: ${path.relative(process.cwd(), reportPath)}`);
