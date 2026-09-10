import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  EXA_MCP_URL,
  getExaUrl,
  parseExaMcpResponse,
  parseExaPayload,
  executeWebSearch,
} from "../src/web-search";

describe("Exa URL constructor", () => {
  it("returns base MCP URL when no API key is provided", () => {
    expect(getExaUrl()).toBe(EXA_MCP_URL);
    expect(getExaUrl(undefined)).toBe("https://mcp.exa.ai/mcp");
  });

  it("appends exaApiKey query parameter when API key is provided", () => {
    expect(getExaUrl("my-secret-key")).toBe("https://mcp.exa.ai/mcp?exaApiKey=my-secret-key");
    expect(getExaUrl("key with spaces")).toBe("https://mcp.exa.ai/mcp?exaApiKey=key+with+spaces");
  });
});

describe("Exa MCP payload & response parser", () => {
  const sampleText = "Title: Example\nURL: https://example.com\nHighlights: Great result";

  it("parses direct JSON-RPC result payload", () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: sampleText }],
      },
    });

    expect(parseExaPayload(payload)).toBe(sampleText);
    expect(parseExaMcpResponse(payload)).toBe(sampleText);
  });

  it("parses SSE event-stream payload", () => {
    const sse = [
      "event: message",
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: sampleText }] },
      })}`,
      "",
    ].join("\n");

    expect(parseExaMcpResponse(sse)).toBe(sampleText);
  });

  it("handles non-JSON SSE frames and ignores them", () => {
    const sse = [
      ": keep-alive ping",
      "data: [DONE]",
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: sampleText }] },
      })}`,
    ].join("\n");

    expect(parseExaMcpResponse(sse)).toBe(sampleText);
  });

  it("rejects error results", () => {
    const errorPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [{ type: "text", text: "web_search_exa error (401): Invalid API key" }],
      },
    });

    expect(parseExaPayload(errorPayload)).toBeUndefined();
    expect(parseExaMcpResponse(errorPayload)).toBeUndefined();
  });
});

describe("executeWebSearch flow", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.EXA_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("uses Exa MCP without API key by default", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "Title: Test\nURL: https://test.com\nSnippet" }],
          },
        }),
        { status: 200 }
      );
    }) as any;

    const result = await executeWebSearch({
      query: "hello world",
      numResults: 5,
      type: "fast",
      livecrawl: "preferred",
    });

    expect(capturedUrl).toBe("https://mcp.exa.ai/mcp");
    expect(capturedBody.params.name).toBe("web_search_exa");
    expect(capturedBody.params.arguments).toEqual({
      query: "hello world",
      numResults: 5,
      type: "fast",
      livecrawl: "preferred",
      contextMaxCharacters: 8000,
    });
    expect(result.output).toContain("Title: Test");
  });

  it("attaches exaApiKey when EXA_API_KEY is in environment", async () => {
    process.env.EXA_API_KEY = "test-env-key";
    let capturedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "Authenticated result" }],
          },
        }),
        { status: 200 }
      );
    }) as any;

    const result = await executeWebSearch({ query: "auth query" });
    expect(capturedUrl).toBe("https://mcp.exa.ai/mcp?exaApiKey=test-env-key");
    expect(result.output).toBe("Authenticated result");
  });

  it("falls back to DuckDuckGo when Exa fails", async () => {
    let fetchCount = 0;

    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchCount++;
      const urlStr = url.toString();
      if (urlStr.includes("mcp.exa.ai")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (urlStr.includes("duckduckgo.com")) {
        return new Response(
          JSON.stringify({
            Heading: "DDG Result",
            AbstractText: "Fallback answer from DDG",
            AbstractURL: "https://duckduckgo.com/ddg",
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    const result = await executeWebSearch({ query: "duck fallback" });
    expect(fetchCount).toBe(2);
    expect(result.output).toContain("Fallback answer from DDG");
  });

  it("truncates output when maxCharacters is exceeded", async () => {
    const longText = "A".repeat(1000);
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: longText }],
          },
        }),
        { status: 200 }
      );
    }) as any;

    const result = await executeWebSearch({ query: "long test", maxCharacters: 100 });
    expect(result.output.length).toBeLessThan(200);
    expect(result.output).toContain("(Search results truncated at 100 characters");
  });
});
