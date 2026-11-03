import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Every test runs against a throwaway database, never the real one.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "budget-test-"));
process.env.BUDGET_DB_PATH = path.join(directory, "test.sqlite");

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const actions = await import("@/lib/actions");
const queries = await import("@/lib/queries");
const { accounts, categories, categoryRules, categorySuggestions, importBatches, transactions } = schema;

const mapping = {
  amountMode: "single",
  date: "date",
  amount: "amount",
  debit: "",
  credit: "",
  payee: "payee",
  description: "description",
  invert: false,
} as const;

let accountId: number;
let groceries: number;
let salary: number;

function categoryId(name: string) {
  return db.select().from(categories).where(eq(categories.name, name)).get()!.id;
}

function row(payee: string, amount: string, date = "2026-10-01") {
  return { date, amount, payee, description: "" };
}

// Answers every merchant in the prompt with the given category.
function stubOllama(category: string) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { messages } = JSON.parse(init.body);
    const ids = [...messages[0].content.matchAll(/^(\d+): /gm)].map((match) => Number(match[1]));
    const results = ids.map((id) => ({ id, category }));
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ results }) } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function importRows(rows: ReturnType<typeof row>[]) {
  const result = await actions.importCsvRows({ accountId, filename: "test.csv", mapping, rows });
  expect(result.error).toBeUndefined();
}

function transactionCategory(payee: string) {
  return db.select().from(transactions).where(eq(transactions.payee, payee)).get()?.categoryId;
}

beforeAll(() => {
  accountId = db
    .insert(accounts)
    .values({ name: "Test", type: "checking", createdAt: new Date().toISOString() })
    .returning({ id: accounts.id })
    .get().id;
  groceries = categoryId("Groceries");
  salary = categoryId("Salary");
});

beforeEach(() => {
  db.delete(categorySuggestions).run();
  db.delete(transactions).run();
  db.delete(importBatches).run();
  db.delete(categoryRules).run();
});

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("suggestNextChunk", () => {
  it("asks once per merchant and changes no transaction", async () => {
    await importRows([row("SAFEWAY #1", "-10.00"), row("SAFEWAY #2", "-20.00")]);
    const fetchMock = stubOllama("Groceries");

    expect(await actions.suggestNextChunk()).toEqual({ checked: 1, remaining: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transactionCategory("SAFEWAY #1")).toBeNull();

    const [group] = queries.listPendingSuggestions();
    expect(group).toMatchObject({ categoryId: groceries, count: 2, typicalCents: 1500, kind: "expense" });
  });

  it("doesn't send anything a rule already categorized", async () => {
    db.insert(categoryRules)
      .values({ pattern: "safeway", categoryId: groceries, createdAt: new Date().toISOString() })
      .run();
    await importRows([row("SAFEWAY", "-10.00")]);
    const fetchMock = stubOllama("Dining");

    expect(await actions.suggestNextChunk()).toEqual({ checked: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transactionCategory("SAFEWAY")).toBe(groceries);
  });

  it("keeps the import and reports it when Ollama is off, then can try again", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const failed = await actions.suggestNextChunk();
    expect(failed.error).toContain("Ollama");
    expect(queries.listUncheckedRows()).toHaveLength(1);

    stubOllama("Groceries");
    expect(await actions.suggestNextChunk()).toEqual({ checked: 1, remaining: 0 });
  });

  it("saves an unsure answer without a category and doesn't ask again", async () => {
    await importRows([row("MYSTERY", "-10.00")]);
    const fetchMock = stubOllama("UNSURE");
    await actions.suggestNextChunk();
    await actions.suggestNextChunk();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queries.listPendingSuggestions()[0].categoryId).toBeNull();
  });
});

describe("acceptSuggestions", () => {
  it("applies the category to every transaction for that merchant", async () => {
    await importRows([row("SAFEWAY #1", "-10.00"), row("SAFEWAY #2", "-20.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();
    const [{ merchantKey }] = queries.listPendingSuggestions();

    const result = await actions.acceptSuggestions([{ merchantKey, categoryId: groceries, makeRule: false }]);
    expect(result.message).toBe("Categorized 2 transactions.");
    expect(transactionCategory("SAFEWAY #2")).toBe(groceries);
    expect(queries.listPendingSuggestions()).toEqual([]);
    expect(db.select().from(categoryRules).all()).toEqual([]);
  });

  it("never overwrites a category set in the meantime", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();
    const [{ merchantKey }] = queries.listPendingSuggestions();
    const dining = categoryId("Dining");
    db.update(transactions).set({ categoryId: dining }).run();

    expect(queries.listPendingSuggestions()).toEqual([]);
    await actions.acceptSuggestions([{ merchantKey, categoryId: groceries, makeRule: false }]);
    expect(transactionCategory("SAFEWAY")).toBe(dining);
  });

  it("makes a rule without store numbers when asked, which then handles the next import", async () => {
    await importRows([row("SAFEWAY #1", "-10.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();
    const [{ merchantKey }] = queries.listPendingSuggestions();
    await actions.acceptSuggestions([{ merchantKey, categoryId: groceries, makeRule: true }]);
    expect(db.select().from(categoryRules).all().map((rule) => rule.pattern)).toEqual(["safeway"]);

    await importRows([row("SAFEWAY #2", "-30.00", "2026-10-02")]);
    expect(transactionCategory("SAFEWAY #2")).toBe(groceries);
  });

  it("refuses a category for the wrong direction", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();
    const [{ merchantKey }] = queries.listPendingSuggestions();

    const result = await actions.acceptSuggestions([{ merchantKey, categoryId: salary, makeRule: false }]);
    expect(result.error).toBeDefined();
    expect(transactionCategory("SAFEWAY")).toBeNull();
  });
});

describe("dismissSuggestions", () => {
  it("removes the merchant from review and doesn't ask again", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    const fetchMock = stubOllama("Groceries");
    await actions.suggestNextChunk();
    await actions.dismissSuggestions(queries.listPendingSuggestions()[0].merchantKey);

    expect(queries.listPendingSuggestions()).toEqual([]);
    expect(await actions.suggestNextChunk()).toEqual({ checked: 0, remaining: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transactionCategory("SAFEWAY")).toBeNull();
  });
});

describe("removing transactions", () => {
  it("undoing an import also removes its suggestions", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();
    const batch = db.select().from(importBatches).get()!;

    const form = new FormData();
    form.set("id", String(batch.id));
    await actions.undoImport(form);
    expect(db.select().from(transactions).all()).toEqual([]);
    expect(db.select().from(categorySuggestions).all()).toEqual([]);
  });

  it("deleting one transaction removes its suggestion", async () => {
    await importRows([row("SAFEWAY", "-10.00")]);
    stubOllama("Groceries");
    await actions.suggestNextChunk();

    const form = new FormData();
    form.set("id", String(db.select().from(transactions).get()!.id));
    await actions.deleteTransaction(form);
    expect(db.select().from(categorySuggestions).all()).toEqual([]);
  });
});
