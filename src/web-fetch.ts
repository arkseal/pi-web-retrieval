import * as dns from "node:dns";
import { parseSourcegraphUrl, fetchSourcegraphGraphql, fetchSourcegraphFile } from "./sourcegraph.js";
import { cleanHtmlToMarkdown } from "./html-cleaner.js";

export interface WebFetchParams {
  url: string;
  maxCharacters?: number;
  allowPrivate?: boolean;
}

export interface WebFetchResult {
  output: string;
  source: string;
}

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024; // 2MB streaming cap to prevent memory exhaustion
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  result: WebFetchResult;
  expiresAt: number;
}

const fetchCache = new Map<string, CacheEntry>();

export type HostLookup = (
  hostname: string
) => Promise<Array<{ address: string; family?: number }>>;

const defaultHostLookup: HostLookup = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true });
  return Array.isArray(records) ? records : [records];
};

let activeHostLookup: HostLookup = defaultHostLookup;

export function setHostLookupForTests(lookup?: HostLookup): void {
  activeHostLookup = lookup ?? defaultHostLookup;
}

export function clearWebFetchCache(): void {
  fetchCache.clear();
}

/**
 * SSRF and private network access protection.
 * Blocks cloud instance metadata (AWS 169.254.169.254), loopback, and private IPv4/IPv6 blocks.
 */
export function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Remove IPv6 brackets and zone index if present
  const bracketStripped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const cleanHost = bracketStripped.split("%")[0].replace(/\.$/, "");

  if (
    !cleanHost ||
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost === "0.0.0.0" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost === "::" ||
    cleanHost === "0:0:0:0:0:0:0:1" ||
    cleanHost === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  // IPv6 Unique Local (fc00::/7) and Link-Local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanHost) || /^fe[89ab][0-9a-f]:/i.test(cleanHost)) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1)
  if (cleanHost.startsWith("::ffff:")) {
    const mapped = cleanHost.slice("::ffff:".length);
    if (mapped.includes(".")) {
      return isPrivateOrBlockedHost(mapped);
    }
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrBlockedHost(dotted);
    }
  }

  // AWS/GCP/Azure instance metadata service
  if (cleanHost.startsWith("169.254.")) {
    return true;
  }

  // Private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 100.64.0.0/10
  const ipv4Match = cleanHost.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);

    if (a === 127) return true; // Loopback
    if (a === 10) return true; // Class A private
    if (a === 172 && b >= 16 && b <= 31) return true; // Class B private
    if (a === 192 && b === 168) return true; // Class C private
    if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-grade NAT
    if (a === 0) return true;
  }

  return false;
}

async function validateHostSafety(
  hostname: string,
  allowPrivate: boolean,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("Request cancelled by signal");
  }
  if (allowPrivate) return;

  if (isPrivateOrBlockedHost(hostname)) {
    throw new Error(`Access to private or local network address is blocked: ${hostname}`);
  }

  // DNS lookup to guard against DNS rebinding (e.g. 127.0.0.1.nip.io)
  const dnsSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
    : AbortSignal.timeout(2000);
  try {
    const records = await new Promise<Array<{ address: string; family?: number }>>(
      (resolve, reject) => {
        const onAbort = () => reject(dnsSignal.reason ?? new Error("DNS lookup aborted"));
        if (dnsSignal.aborted) {
          onAbort();
          return;
        }
        dnsSignal.addEventListener("abort", onAbort, { once: true });
        activeHostLookup(hostname).then(
          (res) => {
            dnsSignal.removeEventListener("abort", onAbort);
            resolve(res);
          },
          (err) => {
            dnsSignal.removeEventListener("abort", onAbort);
            reject(err);
          }
        );
      }
    );
    for (const record of records) {
      if (isPrivateOrBlockedHost(record.address)) {
        throw new Error(`Domain '${hostname}' resolved to blocked private address: ${record.address}`);
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      throw new Error("Request cancelled by signal");
    }
    if (err?.message?.includes("blocked private address")) throw err;
    // Allow network fetch to handle standard resolution errors if dns.lookup fails in test/mock
  }
}

async function readStreamWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body || typeof response.body.getReader !== "function") {
    // Fallback for environments / mocks without full ReadableStream
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      if (signal?.aborted) {
        try { void reader.cancel().catch(() => {}); } catch {}
        throw new Error("Download aborted by signal");
      }

      const { done, value } = await reader.read();
      if (signal?.aborted) {
        try { void reader.cancel().catch(() => {}); } catch {}
        throw new Error("Download aborted by signal");
      }
      if (done) break;

      if (value) {
        totalBytes += value.byteLength;
        text += decoder.decode(value, { stream: true });

        if (totalBytes >= maxBytes) {
          try { void reader.cancel().catch(() => {}); } catch {}
          break;
        }
      }
    }
  } finally {
    text += decoder.decode();
    try { reader.releaseLock(); } catch {}
  }

  return text;
}

export async function executeWebFetch(
  params: WebFetchParams,
  signal?: AbortSignal
): Promise<WebFetchResult> {
  const initialUrl = (params.url ?? "").trim();
  if (!initialUrl.startsWith("http://") && !initialUrl.startsWith("https://")) {
    throw new Error("URL must begin with http:// or https://");
  }

  let parsed: URL;
  try {
    parsed = new URL(initialUrl);
  } catch {
    throw new Error(`Invalid URL: ${initialUrl}`);
  }

  const allowPrivate =
    params.allowPrivate ??
    (process.env.PI_WEB_FETCH_ALLOW_PRIVATE === "true" ||
      process.env.PI_WEB_FETCH_ALLOW_PRIVATE === "1");

  const maxChars = Math.min(Math.max(params.maxCharacters ?? 12000, 100), 100000);
  const cacheKey = `${parsed.toString()}#${maxChars}#priv:${allowPrivate}`;

  // 1. Check in-memory cache
  const cached = fetchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // 2. Sourcegraph URL interceptor
  const sgTarget = parseSourcegraphUrl(initialUrl);
  if (sgTarget) {
    if (sgTarget.type === "search") {
      const md = await fetchSourcegraphGraphql(sgTarget.query, signal);
      const res: WebFetchResult = { output: md, source: "sourcegraph-graphql" };
      fetchCache.set(cacheKey, { result: res, expiresAt: Date.now() + CACHE_TTL_MS });
      return res;
    }
    if (sgTarget.type === "file") {
      const md = await fetchSourcegraphFile(sgTarget, signal);
      const res: WebFetchResult = { output: md, source: "sourcegraph-file" };
      fetchCache.set(cacheKey, { result: res, expiresAt: Date.now() + CACHE_TTL_MS });
      return res;
    }
  }

  // 3. Standard Web Fetch with manual redirect validation + timeout + signal
  const timeoutSignal = AbortSignal.timeout(20000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let currentUrl = initialUrl;
  let redirectCount = 0;
  let res: Response;

  while (true) {
    if (combinedSignal.aborted) {
      throw new Error("Request cancelled by signal");
    }

    const currentParsed = new URL(currentUrl);
    if (currentParsed.protocol !== "http:" && currentParsed.protocol !== "https:") {
      throw new Error(`Disallowed protocol in redirect: ${currentParsed.protocol}`);
    }

    await validateHostSafety(currentParsed.hostname, allowPrivate, combinedSignal);

    res = await fetch(currentUrl, {
      headers: {
        Accept: "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.5, */*;q=0.1",
        "User-Agent": "Mozilla/5.0 (compatible; PiAgent/1.0)",
      },
      signal: combinedSignal,
      redirect: "manual",
    });

    // Check for HTTP redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      try { void res.body?.cancel().catch(() => {}); } catch {}
      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect status ${res.status} received without Location header`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    break;
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch ${currentUrl}: ${res.status} ${res.statusText}`);
  }

  // Check content-length header
  const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
  if (contentLength > 10 * 1024 * 1024) {
    throw new Error(`Response body exceeds maximum allowed size (${contentLength} bytes)`);
  }

  const contentType = res.headers.get("content-type") || "";
  const rawBody = await readStreamWithLimit(res, MAX_DOWNLOAD_BYTES, combinedSignal);

  let finalResult: WebFetchResult;

  if (contentType.includes("text/html") || rawBody.includes("<html") || rawBody.includes("<body")) {
    const markdown = cleanHtmlToMarkdown(rawBody, maxChars);
    finalResult = { output: markdown, source: "html-converted" };
  } else {
    // Raw text or markdown
    let clean = rawBody.trim();
    if (clean.length > maxChars) {
      clean = `${clean.slice(0, maxChars)}\n\n(Content truncated at ${maxChars} characters to keep token impact small)`;
    }
    finalResult = { output: clean, source: "raw-text" };
  }

  // Store in cache (bounded LRU eviction)
  if (fetchCache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = fetchCache.keys().next().value;
    if (firstKey) fetchCache.delete(firstKey);
  }
  fetchCache.set(cacheKey, { result: finalResult, expiresAt: Date.now() + CACHE_TTL_MS });

  return finalResult;
}
