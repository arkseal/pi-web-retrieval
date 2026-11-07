import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  executeWebFetch,
  clearWebFetchCache,
  isPrivateOrBlockedHost,
  setHostLookupForTests,
} from "../src/web-fetch";

describe("web-fetch SSRF protection", () => {
  beforeEach(() => {
    clearWebFetchCache();
    setHostLookupForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    setHostLookupForTests(undefined);
  });

  it("identifies private and blocked hosts", () => {
    expect(isPrivateOrBlockedHost("localhost")).toBe(true);
    expect(isPrivateOrBlockedHost("sub.localhost")).toBe(true);
    expect(isPrivateOrBlockedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrBlockedHost("127.1.2.3")).toBe(true);
    expect(isPrivateOrBlockedHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrBlockedHost("::1")).toBe(true);
    expect(isPrivateOrBlockedHost("[::ffff:127.0.0.1]")).toBe(true);
    expect(isPrivateOrBlockedHost("::ffff:7f00:1")).toBe(true);
    expect(isPrivateOrBlockedHost("fd00::1")).toBe(true);
    expect(isPrivateOrBlockedHost("fe80::1")).toBe(true);
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

  it("allows private or localhost addresses when allowPrivate is true", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: any) => {
        return new Response("<html><body><h1>Local Dev Server</h1></body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }) as any;

      const res = await executeWebFetch({ url: "http://127.0.0.1:3000", allowPrivate: true });
      expect(res.output).toContain("# Local Dev Server");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("honors PI_WEB_FETCH_ALLOW_PRIVATE environment variable opt-in", async () => {
    const originalFetch = globalThis.fetch;
    const origEnv = process.env.PI_WEB_FETCH_ALLOW_PRIVATE;
    try {
      process.env.PI_WEB_FETCH_ALLOW_PRIVATE = "1";
      globalThis.fetch = (async (url: any) => {
        return new Response("Local content", { headers: { "Content-Type": "text/plain" } });
      }) as any;

      const res = await executeWebFetch({ url: "http://localhost:8080/api" });
      expect(res.output).toBe("Local content");
    } finally {
      process.env.PI_WEB_FETCH_ALLOW_PRIVATE = origEnv;
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks redirect to private/internal network addresses", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: any) => {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" },
        });
      }) as any;

      expect(executeWebFetch({ url: "https://public-site.com/bounce" })).rejects.toThrow(
        "private or local network address is blocked"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("follows legitimate redirects to public targets", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let step = 0;
      globalThis.fetch = (async (url: any) => {
        step++;
        if (step === 1) {
          return new Response(null, {
            status: 301,
            headers: { Location: "https://example.com/destination" },
          });
        }
        return new Response("Final page", { headers: { "Content-Type": "text/plain" } });
      }) as any;

      const res = await executeWebFetch({ url: "https://example.com/initial" });
      expect(res.output).toBe("Final page");
      expect(step).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks domains that resolve to any private IP (DNS rebinding / multi-record)", async () => {
    setHostLookupForTests(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(executeWebFetch({ url: "https://rebind.example.com/secret" })).rejects.toThrow(
      "resolved to blocked private address"
    );
  });
});

describe("web-fetch execution and caching", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearWebFetchCache();
    setHostLookupForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setHostLookupForTests(undefined);
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
