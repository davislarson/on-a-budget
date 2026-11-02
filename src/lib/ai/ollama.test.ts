import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaAsk, OllamaError } from "./ollama";

const request = { prompt: "hello", schema: { type: "object" } };

function failureOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: OllamaError) => error.failure,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("createOllamaAsk", () => {
  it("sends the model, prompt, and schema, and parses the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '{"results":[]}' } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOllamaAsk("test-model")(request)).resolves.toEqual({ results: [] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "test-model", stream: false, format: request.schema });
    expect(body.messages[0].content).toBe("hello");
  });

  it("reports when Ollama isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await failureOf(createOllamaAsk("m")(request))).toBe("unavailable");
  });

  it("reports a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    expect(await failureOf(createOllamaAsk("m")(request))).toBe("timeout");
  });

  it("reports a model that isn't downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await failureOf(createOllamaAsk("m")(request))).toBe("model-missing");
  });

  it("reports an answer that isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "oops" } }))));
    expect(await failureOf(createOllamaAsk("m")(request))).toBe("bad-response");
  });
});
