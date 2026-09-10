export interface WebSearchParams {
  query: string;
  numResults?: number;
  maxCharacters?: number;
  type?: "auto" | "fast" | "deep";
  livecrawl?: "fallback" | "preferred";
  contextMaxCharacters?: number;
}

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

export function getExaUrl(apiKey?: string): string {
  if (!apiKey) return EXA_MCP_URL;
  const url = new URL(EXA_MCP_URL);
  url.searchParams.set("exaApiKey", apiKey);
  return url.toString();
}

export function parseExaPayload(payload: string): string | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const data = JSON.parse(trimmed);
    if (data.isError || data.result?.isError) return undefined;
    const items = data.result?.content;
    if (Array.isArray(items)) {
      const textItem = items.find((item: any) => item?.type === "text" && typeof item?.text === "string");
      if (textItem?.text && !textItem.text.startsWith("web_search_exa error")) {
        return textItem.text;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function parseExaMcpResponse(body: string): string | undefined {
  const trimmed = body.trim();
  const direct = trimmed ? parseExaPayload(trimmed) : undefined;
  if (direct) return direct;

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = parseExaPayload(line.substring(6));
    if (data) return data;
  }
  return undefined;
}

export async function callExaMcp(
  query: string,
  options: {
    numResults?: number;
    type?: "auto" | "fast" | "deep";
    livecrawl?: "fallback" | "preferred";
    contextMaxCharacters?: number;
    apiKey?: string;
    timeoutMs?: number;
  } = {}
): Promise<string | undefined> {
  const url = getExaUrl(options.apiKey ?? process.env.EXA_API_KEY);
  const timeoutMs = options.timeoutMs ?? 25000;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query,
          type: options.type || "auto",
          numResults: options.numResults || 8,
          livecrawl: options.livecrawl || "fallback",
          ...(options.contextMaxCharacters ? { contextMaxCharacters: options.contextMaxCharacters } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) return undefined;
  const body = await res.text();
  return parseExaMcpResponse(body);
}

export async function executeWebSearch(params: WebSearchParams): Promise<{ output: string }> {
  const query = params.query.trim();
  const numResults = Math.min(params.numResults ?? 8, 20);
  const maxChars = params.maxCharacters ?? 8000;
  const contextMaxCharacters = params.contextMaxCharacters ?? maxChars;

  // 1. Tavily API (if configured)
  if (process.env.TAVILY_API_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          max_results: numResults,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results ?? []).map((r: any) => `### ${r.title}\nURL: ${r.url}\n${r.content}`);
        if (results.length > 0) {
          return { output: truncateOutput(results.join("\n\n"), maxChars) };
        }
      }
    } catch {}
  }

  // 2. Exa MCP (API key optional, works with or without EXA_API_KEY)
  try {
    const exaResult = await callExaMcp(query, {
      numResults,
      type: params.type,
      livecrawl: params.livecrawl,
      contextMaxCharacters,
      apiKey: process.env.EXA_API_KEY,
    });
    if (exaResult && exaResult.trim().length > 0) {
      return { output: truncateOutput(exaResult.trim(), maxChars) };
    }
  } catch {}

  // 3. DuckDuckGo Instant Answer API (Free fallback, 0 keys required)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PiAgent/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      const lines: string[] = [];
      if (data.AbstractText) {
        lines.push(`### ${data.Heading || query}\n${data.AbstractText}\nSource: ${data.AbstractURL}`);
      }
      const topics = data.RelatedTopics ?? [];
      for (const t of topics.slice(0, numResults)) {
        if (t.Text && t.FirstURL) {
          lines.push(`- ${t.Text}\n  ${t.FirstURL}`);
        }
      }
      if (lines.length > 0) {
        return { output: truncateOutput(lines.join("\n\n"), maxChars) };
      }
    }
  } catch {}

  return {
    output: `No search results returned for query: "${query}".`,
  };
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n(Search results truncated at ${maxChars} characters to protect context window)`;
}
