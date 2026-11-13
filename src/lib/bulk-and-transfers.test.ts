import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Every test runs against a throwaway database, never the real one.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "budget-test-"));
process.env.BUDGET_DB_PATH = path.join(directory, "test.sqlite");

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const actions = await import("@/lib/actions");
const queries = await import("@/lib/queries");
const { accounts, categories, categorySuggestions, transactions, transferDismissals } = schema;

let checking: number;
let card: number;
let groceries: number;

function addAccount(name: string, type: "checking" | "credit") {
  return db
    .insert(accounts)
    .values({ name, type, createdAt: new Date().toISOString() })
    .returning({ id: accounts.id })
    .get().id;
}

function addTx(accountId: number, date: string, amountCents: number, extra: Partial<typeof transactions.$inferInsert> = {}) {
  return db
    .insert(transactions)
    .values({ accountId, date, amountCents, payee: `tx ${amountCents}`, ...extra })
    .returning({ id: transactions.id })
    .get().id;
}

function get(id: number) {
  return db.select().from(transactions).where(eq(transactions.id, id)).get();
}

function form(entries: Array<[string, string | number]>) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, String(value));
  return data;
}

beforeAll(() => {
  checking = addAccount("Checking", "checking");
  card = addAccount("Card", "credit");
  groceries = db.select().from(categories).where(eq(categories.name, "Groceries")).get()!.id;
});

beforeEach(() => {
  db.delete(transferDismissals).run();
  db.delete(categorySuggestions).run();
  db.delete(transactions).run();
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("transfer pairs", () => {
  it("suggests a card payment and marks both sides as transfers, clearing categories", async () => {
    const out = addTx(checking, "2026-10-05", -45000, { categoryId: groceries });
    const inRow = addTx(card, "2026-10-06", 45000);
    addTx(card, "2026-10-06", -1200);

    const pairs = queries.listTransferPairs();
    expect(pairs.map((pair) => [pair.out.id, pair.in.id])).toEqual([[out, inRow]]);
    expect(pairs[0].out.accountName).toBe("Checking");

    await actions.markTransferPair(form([["outId", out], ["inId", inRow]]));
    expect(get(out)).toMatchObject({ isTransfer: true, categoryId: null });
    expect(get(inRow)).toMatchObject({ isTransfer: true });
    expect(queries.listTransferPairs()).toEqual([]);
  });

  it("refuses a pair that doesn't balance", async () => {
    const out = addTx(checking, "2026-10-05", -45000);
    const inRow = addTx(card, "2026-10-06", 45001);
    await actions.markTransferPair(form([["outId", out], ["inId", inRow]]));
    expect(get(out)?.isTransfer).toBe(false);
    expect(get(inRow)?.isTransfer).toBe(false);
  });

  it("marks several pairs at once", async () => {
    const a = [addTx(checking, "2026-09-05", -100), addTx(card, "2026-09-05", 100)];
    const b = [addTx(checking, "2026-10-05", -200), addTx(card, "2026-10-05", 200)];
    await actions.markTransferPairs(form([["pairs", a.join("-")], ["pairs", b.join("-")]]));
    const rows = db.select().from(transactions).where(inArray(transactions.id, [...a, ...b])).all();
    expect(rows.every((row) => row.isTransfer)).toBe(true);
  });

  it("stops suggesting a dismissed pair, and forgets it when a side is deleted", async () => {
    const out = addTx(checking, "2026-10-05", -700);
    const inRow = addTx(card, "2026-10-05", 700);
    await actions.dismissTransferPair(form([["outId", out], ["inId", inRow]]));
    await actions.dismissTransferPair(form([["outId", out], ["inId", inRow]]));
    expect(queries.listTransferPairs()).toEqual([]);
    expect(db.select().from(transferDismissals).all()).toHaveLength(1);

    await actions.deleteTransaction(form([["id", inRow]]));
    expect(db.select().from(transferDismissals).all()).toHaveLength(0);
  });
});

describe("bulkUpdateTransactions", () => {
  it("sets a category on the selected rows and skips transfers", async () => {
    const a = addTx(checking, "2026-10-01", -500);
    const b = addTx(checking, "2026-10-02", -600);
    const t = addTx(checking, "2026-10-03", -700, { isTransfer: true });
    const untouched = addTx(checking, "2026-10-04", -800);

    const result = await actions.bulkUpdateTransactions(
      {},
      form([["ids", a], ["ids", b], ["ids", t], ["op", "category"], ["categoryId", groceries]]),
    );
    expect(result).toEqual({ message: "Categorized 2 transactions. Skipped 1 transfer." });
    expect(get(a)?.categoryId).toBe(groceries);
    expect(get(b)?.categoryId).toBe(groceries);
    expect(get(t)?.categoryId).toBeNull();
    expect(get(untouched)?.categoryId).toBeNull();
  });

  it("clears categories when Uncategorized is picked", async () => {
    const a = addTx(checking, "2026-10-01", -500, { categoryId: groceries });
    const result = await actions.bulkUpdateTransactions({}, form([["ids", a], ["op", "category"], ["categoryId", ""]]));
    expect(result.message).toBe("Cleared the category on 1 transaction.");
    expect(get(a)?.categoryId).toBeNull();
  });

  it("refuses an archived category", async () => {
    const archived = db
      .insert(categories)
      .values({ name: "Old", kind: "expense", archived: true })
      .returning({ id: categories.id })
      .get().id;
    const a = addTx(checking, "2026-10-01", -500);
    const result = await actions.bulkUpdateTransactions({}, form([["ids", a], ["op", "category"], ["categoryId", archived]]));
    expect(result.error).toBeDefined();
    expect(get(a)?.categoryId).toBeNull();
  });

  it("marks and unmarks transfers", async () => {
    const a = addTx(checking, "2026-10-01", -500, { categoryId: groceries });
    const b = addTx(checking, "2026-10-02", -600);
    let result = await actions.bulkUpdateTransactions({}, form([["ids", a], ["ids", b], ["op", "transfer"]]));
    expect(result.message).toBe("Marked 2 transactions as transfers.");
    expect(get(a)).toMatchObject({ isTransfer: true, categoryId: null });

    result = await actions.bulkUpdateTransactions({}, form([["ids", a], ["op", "not-transfer"]]));
    expect(result.message).toBe("1 transaction no longer marked as a transfer.");
    expect(get(a)?.isTransfer).toBe(false);
    expect(get(b)?.isTransfer).toBe(true);
  });

  it("deletes the selected rows and their AI suggestions", async () => {
    const a = addTx(checking, "2026-10-01", -500);
    const keep = addTx(checking, "2026-10-02", -600);
    db.insert(categorySuggestions)
      .values({ transactionId: a, merchantKey: "expense|x", merchantText: "x", model: "m", createdAt: "" })
      .run();
    const result = await actions.bulkUpdateTransactions({}, form([["ids", a], ["op", "delete"]]));
    expect(result.message).toBe("Deleted 1 transaction.");
    expect(get(a)).toBeUndefined();
    expect(get(keep)).toBeDefined();
    expect(db.select().from(categorySuggestions).all()).toHaveLength(0);
  });

  it("needs a selection and a known action", async () => {
    expect((await actions.bulkUpdateTransactions({}, form([["op", "delete"]]))).error).toBeDefined();
    const a = addTx(checking, "2026-10-01", -500);
    expect((await actions.bulkUpdateTransactions({}, form([["ids", a], ["op", "explode"]]))).error).toBeDefined();
    expect((await actions.bulkUpdateTransactions({}, form([["ids", "abc"], ["op", "delete"]]))).error).toBeDefined();
    expect(get(a)).toBeDefined();
  });
});
