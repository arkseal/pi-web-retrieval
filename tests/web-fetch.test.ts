import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  executeWebFetch,
  clearWebFetchCache,
  isPrivateOrBlockedHost,
} from "../src/web-fetch";

describe("web-fetch SSRF protection", () => {
  it("identifies private and blocked hosts", () => {
    expect(isPrivateOrBlockedHost("localhost")).toBe(true);
    expect(isPrivateOrBlockedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrBlockedHost("127.1.2.3")).toBe(true);
    expect(isPrivateOrBlockedHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrBlockedHost("::1")).toBe(true);
    expect(isPrivateOrBlockedHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrBlockedHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrBlockedHost("172.16.5.4")).toBe(true);
    expect(isPrivateOrBlockedHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrBlockedHost("100.64.0.1")).toBe(true);

    expect(isPrivateOrBlockedHost("example.com")).toBe(false);
    expect(isPrivateOrBlockedHost("sourcegraph.com")).toBe(false);
    expect(isPrivateOrBlockedHost("api.github.com")).toBe(false);
  });

  it("rejects fetch to private or local addresses", async () => {
    expect(executeWebFetch({ url: "http://127.0.0.1:8080/secret" })).rejects.toThrow(
      "private or local network address is blocked"
    );
    expect(executeWebFetch({ url: "http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(
      "private or local network address is blocked"
    );
  });

  it("rejects non-http/https URLs", async () => {
    expect(executeWebFetch({ url: "ftp://example.com/file" })).rejects.toThrow("URL must begin with http:// or https://");
    expect(executeWebFetch({ url: "file:///etc/passwd" })).rejects.toThrow("URL must begin with http:// or https://");
  });
});

describe("web-fetch execution and caching", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearWebFetchCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("caches successful fetch results", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: any) => {
      callCount++;
      return new Response("<html><body><h1>Hello World</h1></body></html>", {
        headers: { "Content-Type": "text/html" },
      });
    }) as any;

    const res1 = await executeWebFetch({ url: "https://example.com/page" });
    expect(res1.output).toContain("# Hello World");
    expect(callCount).toBe(1);

    // Second call should come from cache without invoking fetch
    const res2 = await executeWebFetch({ url: "https://example.com/page" });
    expect(res2.output).toContain("# Hello World");
    expect(callCount).toBe(1);
  });

  it("supports cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    expect(executeWebFetch({ url: "https://example.com/abort" }, controller.signal)).rejects.toThrow();
  });
});
