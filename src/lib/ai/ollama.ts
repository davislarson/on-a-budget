import type { CategorizeRequest } from "./prompt";

export const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const TIMEOUT_MS = 120_000;

export type OllamaFailure = "unavailable" | "model-missing" | "timeout" | "bad-response";

export class OllamaError extends Error {
  constructor(
    readonly failure: OllamaFailure,
    message: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export type AskModel = (request: CategorizeRequest) => Promise<unknown>;

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
}

export function createOllamaAsk(model: string = ollamaModel()): AskModel {
  const url = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;
  return async ({ prompt, schema }) => {
    let response: Response;
    try {
      response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model,
          stream: false,
          format: schema,
          // Ollama's default context can cut off a long prompt without saying so.
          options: { temperature: 0, num_ctx: 8192 },
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new OllamaError("timeout", `${model} took too long to answer.`);
      }
      throw new OllamaError("unavailable", "Couldn't reach Ollama. Is it running?");
    }
    if (response.status === 404) {
      throw new OllamaError("model-missing", `Ollama doesn't have ${model}. Run: ollama pull ${model}`);
    }
    if (!response.ok) {
      throw new OllamaError("bad-response", `Ollama returned an error (${response.status}).`);
    }
    try {
      const body = (await response.json()) as { message: { content: string } };
      return JSON.parse(body.message.content);
    } catch {
      throw new OllamaError("bad-response", `${model} returned an answer that couldn't be read.`);
    }
  };
}
