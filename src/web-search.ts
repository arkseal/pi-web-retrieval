export interface WebSearchParams {
  query: string;
  numResults?: number;
  maxCharacters?: number;
}

export async function executeWebSearch(params: WebSearchParams): Promise<{ output: string }> {
  const query = params.query.trim();
  const numResults = Math.min(params.numResults ?? 8, 15);
  const maxChars = params.maxCharacters ?? 8000;

  // 1. Tavily API
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
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results ?? []).map((r: any) => `### ${r.title}\nURL: ${r.url}\n${r.content}`);
        return { output: truncateOutput(results.join("\n\n"), maxChars) };
      }
    } catch {}
  }

  // 2. Exa API
  if (process.env.EXA_API_KEY) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.EXA_API_KEY,
        },
        body: JSON.stringify({
          query,
          numResults,
          useAutoprompt: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results ?? []).map((r: any) => `### ${r.title}\nURL: ${r.url}\n${r.text ?? ""}`);
        return { output: truncateOutput(results.join("\n\n"), maxChars) };
      }
    } catch {}
  }

  // 3. DuckDuckGo Instant Answer API (Free fallback, 0 keys required)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { "User-Agent": "PiAgent/1.0" } });
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
    output: `No search results returned for query: "${query}". Set TAVILY_API_KEY or EXA_API_KEY for comprehensive web search.`,
  };
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n(Search results truncated at ${maxChars} characters to protect context window)`;
}
