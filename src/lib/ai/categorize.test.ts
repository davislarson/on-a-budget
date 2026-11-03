import { describe, expect, it, vi } from "vitest";
import { categorizeChunk, checkAnswers, chunkMerchants } from "./categorize";
import { groupMerchants, merchantKey, type Merchant } from "./merchants";
import { OllamaError } from "./ollama";
import { buildCategorizeRequest, type CategoryChoice } from "./prompt";

const categories: CategoryChoice[] = [
  { id: 1, name: "Salary", kind: "income" },
  { id: 2, name: "Groceries", kind: "expense" },
  { id: 3, name: "Dining", kind: "expense" },
];

function merchant(text: string, kind: Merchant["kind"] = "expense"): Merchant {
  return { key: `${kind}|${text}`, kind, text, description: "", typicalCents: 1250, transactionIds: [1] };
}

describe("merchantKey", () => {
  it("ignores store numbers", () => {
    expect(merchantKey("PANDA EXPRESS #724")).toBe(merchantKey("Panda Express #301"));
  });

  it("falls back to the full text when every word has a digit", () => {
    expect(merchantKey("7-11 24/7")).toBe("7-11 24/7");
  });
});

describe("groupMerchants", () => {
  it("makes one merchant from repeats and averages the amount", () => {
    const [panda, ...rest] = groupMerchants([
      { id: 1, payee: "PANDA EXPRESS #724", description: "", amountCents: -1000 },
      { id: 2, payee: "PANDA EXPRESS #301", description: "", amountCents: -2000 },
    ]);
    expect(rest).toEqual([]);
    expect(panda).toMatchObject({ kind: "expense", typicalCents: 1500, transactionIds: [1, 2] });
  });

  it("keeps money in and money out apart", () => {
    const merchants = groupMerchants([
      { id: 1, payee: "ACME", description: "", amountCents: -1000 },
      { id: 2, payee: "ACME", description: "", amountCents: 1000 },
    ]);
    expect(merchants.map((m) => m.kind)).toEqual(["expense", "income"]);
  });

  it("uses the description when there is no payee, and removes long numbers", () => {
    const [only] = groupMerchants([{ id: 1, payee: "", description: "CARD 12345678 COFFEE", amountCents: -500 }]);
    expect(only.text).toBe("CARD  COFFEE");
    expect(only.description).toBe("");
  });

  it("removes a long store number along with its #", () => {
    const [only] = groupMerchants([{ id: 1, payee: "CVS/PHARMACY #0912", description: "", amountCents: -500 }]);
    expect(only.text).toBe("CVS/PHARMACY");
  });

  it("skips rows with no text or a zero amount", () => {
    expect(
      groupMerchants([
        { id: 1, payee: " ", description: "", amountCents: -500 },
        { id: 2, payee: "ACME", description: "", amountCents: 0 },
      ]),
    ).toEqual([]);
  });
});

describe("buildCategorizeRequest", () => {
  it("offers only the categories for that direction, plus unsure", () => {
    const { prompt, schema } = buildCategorizeRequest("expense", [merchant("SAFEWAY")], categories);
    expect(prompt).toContain("Groceries");
    expect(prompt).not.toContain("Salary");
    expect(JSON.stringify(schema)).toContain('"enum":["Groceries","Dining","UNSURE"]');
  });

  it("includes the description, the typical amount, and any examples", () => {
    const { prompt } = buildCategorizeRequest(
      "expense",
      [{ ...merchant("SAFEWAY"), description: "POS PURCHASE" }],
      categories,
      [{ merchant: merchant("TACO TRUCK"), categoryName: "Dining" }],
    );
    expect(prompt).toContain("0: SAFEWAY | description: POS PURCHASE | about $12.50");
    expect(prompt).toContain("- TACO TRUCK | about $12.50 -> Dining");
  });
});

describe("chunkMerchants", () => {
  it("separates directions and respects the size", () => {
    const chunks = chunkMerchants([merchant("A"), merchant("B"), merchant("C"), merchant("D", "income")], 2);
    expect(chunks.map((chunk) => [chunk.kind, chunk.merchants.length])).toEqual([
      ["expense", 2],
      ["expense", 1],
      ["income", 1],
    ]);
  });
});

describe("checkAnswers", () => {
  const merchants = [merchant("SAFEWAY"), merchant("MYSTERY")];

  it("maps names to category ids and keeps unsure answers empty", () => {
    const answer = { results: [{ id: 0, category: "Groceries" }, { id: 1, category: "UNSURE" }] };
    expect(checkAnswers(answer, "expense", merchants, categories).map((s) => [s.categoryId, s.status])).toEqual([
      [2, "suggested"],
      [null, "unsure"],
    ]);
  });

  it("rejects made-up categories, wrong-direction categories, and unknown ids", () => {
    const answer = {
      results: [
        { id: 0, category: "Crypto" },
        { id: 1, category: "Salary" },
        { id: 99, category: "Groceries" },
      ],
    };
    expect(checkAnswers(answer, "expense", merchants, categories).map((s) => s.status)).toEqual([
      "no-answer",
      "no-answer",
    ]);
  });

  it("marks a merchant the model skipped as no answer", () => {
    const answer = { results: [{ id: 0, category: "Groceries" }] };
    expect(checkAnswers(answer, "expense", merchants, categories)[1].status).toBe("no-answer");
  });

  it("throws on an answer in the wrong shape", () => {
    expect(() => checkAnswers({ nope: [] }, "expense", merchants, categories)).toThrow(OllamaError);
    expect(() => checkAnswers(null, "expense", merchants, categories)).toThrow(OllamaError);
  });
});

describe("categorizeChunk", () => {
  const merchants = [merchant("SAFEWAY")];
  const good = { results: [{ id: 0, category: "Groceries" }] };

  it("retries once after a timeout", async () => {
    const ask = vi.fn().mockRejectedValueOnce(new OllamaError("timeout", "slow")).mockResolvedValueOnce(good);
    const [suggestion] = await categorizeChunk("expense", merchants, categories, ask);
    expect(suggestion.categoryId).toBe(2);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("retries once after an unreadable answer, then gives up", async () => {
    const ask = vi.fn().mockResolvedValue({ nope: [] });
    await expect(categorizeChunk("expense", merchants, categories, ask)).rejects.toThrow(OllamaError);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry when Ollama is off", async () => {
    const ask = vi.fn().mockRejectedValue(new OllamaError("unavailable", "off"));
    await expect(categorizeChunk("expense", merchants, categories, ask)).rejects.toThrow("off");
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
