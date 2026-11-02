import type { CategoryKind, Merchant } from "./merchants";
import { OllamaError, type AskModel } from "./ollama";
import { buildCategorizeRequest, UNSURE, type CategorizedExample, type CategoryChoice } from "./prompt";

export const CHUNK_SIZE = 25;

export type Suggestion = {
  merchant: Merchant;
  // Null when the model was unsure or gave no usable answer for this merchant.
  categoryId: number | null;
  status: "suggested" | "unsure" | "no-answer";
};

// Splits merchants into requests of one direction each, since a request only
// offers the categories for that direction.
export function chunkMerchants(merchants: Merchant[], size = CHUNK_SIZE): Array<{ kind: CategoryKind; merchants: Merchant[] }> {
  const chunks: Array<{ kind: CategoryKind; merchants: Merchant[] }> = [];
  for (const kind of ["expense", "income"] as const) {
    const group = merchants.filter((merchant) => merchant.kind === kind);
    for (let i = 0; i < group.length; i += size) {
      chunks.push({ kind, merchants: group.slice(i, i + size) });
    }
  }
  return chunks;
}

// Model output is never trusted: only a known merchant id and an active category
// for that direction count. Anything else leaves the merchant without a suggestion.
export function checkAnswers(
  answer: unknown,
  kind: CategoryKind,
  merchants: Merchant[],
  categories: CategoryChoice[],
): Suggestion[] {
  const results = (answer as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) {
    throw new OllamaError("bad-response", "The model's answer wasn't in the expected format.");
  }
  const answers = new Map<number, string>();
  for (const result of results) {
    const { id, category } = (result ?? {}) as { id?: unknown; category?: unknown };
    if (typeof id === "number" && typeof category === "string" && !answers.has(id)) {
      answers.set(id, category);
    }
  }
  return merchants.map((merchant, id) => {
    const category = answers.get(id);
    if (category === UNSURE) return { merchant, categoryId: null, status: "unsure" };
    const match = categories.find((choice) => choice.kind === kind && choice.name === category);
    return match
      ? { merchant, categoryId: match.id, status: "suggested" }
      : { merchant, categoryId: null, status: "no-answer" };
  });
}

// Tries a slow or garbled answer once more. Ollama being off or missing the model
// won't fix itself, so those fail straight away with a message to show.
export async function categorizeChunk(
  kind: CategoryKind,
  merchants: Merchant[],
  categories: CategoryChoice[],
  ask: AskModel,
  examples: CategorizedExample[] = [],
): Promise<Suggestion[]> {
  const request = buildCategorizeRequest(kind, merchants, categories, examples);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return checkAnswers(await ask(request), kind, merchants, categories);
    } catch (error) {
      const retryable = error instanceof OllamaError && (error.failure === "timeout" || error.failure === "bad-response");
      if (!retryable || attempt === 1) throw error;
    }
  }
}
