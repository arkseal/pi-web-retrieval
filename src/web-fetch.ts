import { parseSourcegraphUrl, fetchSourcegraphGraphql } from "./sourcegraph.js";
import { cleanHtmlToMarkdown } from "./html-cleaner.js";

export interface WebFetchParams {
  url: string;
  maxCharacters?: number;
}

export async function executeWebFetch(params: WebFetchParams): Promise<{ output: string; source: string }> {
  const url = params.url.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must begin with http:// or https://");
  }

  // 1. Sourcegraph URL interceptor: avoids downloading 1MB of React bundle
  const sgTarget = parseSourcegraphUrl(url);
  if (sgTarget && sgTarget.type === "search") {
    const md = await fetchSourcegraphGraphql(sgTarget.query);
    return { output: md, source: "sourcegraph-graphql" };
  }

  // 2. Standard Web Fetch with content negotiation
  const maxChars = params.maxCharacters ?? 12000;
  const res = await fetch(url, {
    headers: {
      Accept: "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.5, */*;q=0.1",
      "User-Agent": "Mozilla/5.0 (compatible; PiAgent/1.0)",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const rawBody = await res.text();

  if (contentType.includes("text/html") || rawBody.includes("<html") || rawBody.includes("<body")) {
    const markdown = cleanHtmlToMarkdown(rawBody, maxChars);
    return { output: markdown, source: "html-converted" };
  }

  // Raw text or markdown
  let clean = rawBody.trim();
  if (clean.length > maxChars) {
    clean = `${clean.slice(0, maxChars)}\n\n(Content truncated at ${maxChars} characters to keep token impact small)`;
  }

  return { output: clean, source: "raw-text" };
}
