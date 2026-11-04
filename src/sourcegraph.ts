export type SourcegraphTarget =
  | { type: "search"; query: string }
  | { type: "repo"; repoName: string; rev?: string }
  | { type: "file"; repoName: string; rev?: string; filePath: string };

export function parseSourcegraphUrl(url: string): SourcegraphTarget | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "sourcegraph.com" && parsed.hostname !== "www.sourcegraph.com") {
      return null;
    }

    if (parsed.pathname.startsWith("/search")) {
      const q = parsed.searchParams.get("q")?.trim();
      if (!q) return null;
      return { type: "search", query: q };
    }

    const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length < 3) return null;

    const hyphenIndex = parts.indexOf("-");
    const repoParts = hyphenIndex === -1 ? parts : parts.slice(0, hyphenIndex);
    if (repoParts.length < 3) return null;

    const lastRepoPart = repoParts[repoParts.length - 1];
    const atIndex = lastRepoPart.indexOf("@");
    let rev: string | undefined;
    let repoTail = lastRepoPart;
    if (atIndex > 0) {
      repoTail = lastRepoPart.slice(0, atIndex);
      rev = lastRepoPart.slice(atIndex + 1) || undefined;
    }

    repoParts[repoParts.length - 1] = repoTail;
    const repoName = repoParts.join("/");

    if (hyphenIndex !== -1 && parts[hyphenIndex + 1] === "blob") {
      const filePath = parts.slice(hyphenIndex + 2).join("/");
      if (!filePath) return null;
      return { type: "file", repoName, rev, filePath };
    }

    return { type: "repo", repoName, rev };
  } catch {
    return null;
  }
}

export function formatSourcegraphSearchMarkdown(query: string, data: any): string {
  const results = data?.search?.results?.results ?? [];
  let md = `# Sourcegraph Search\n\n**Query:** \`${query}\`\n\n`;

  if (results.length === 0) {
    md += "_No results found._\n";
    return md;
  }

  const maxResults = 10;
  for (const item of results.slice(0, maxResults)) {
    if (item.__typename === "FileMatch") {
      const repoName = item.repository?.name ?? "unknown";
      const filePath = item.file?.path ?? "unknown";
      md += `### ${repoName}/${filePath}\n\n`;

      const lines = item.lineMatches ?? [];
      if (lines.length > 0) {
        md += "```text\n";
        for (const lm of lines.slice(0, 5)) {
          const preview = (lm.preview ?? "").replace(/\n/g, " ").trim();
          md += `L${lm.lineNumber ?? 0}: ${preview}\n`;
        }
        md += "```\n\n";
      }
    }
  }

  if (results.length > maxResults) {
    md += `[... and ${results.length - maxResults} more matches omitted]\n`;
  }

  return md.trim();
}

const SEARCH_QUERY = `query Search($query: String!) {
  search(query: $query, version: V2) {
    results {
      results {
        __typename
        ... on FileMatch {
          repository { name url }
          file { path url }
          lineMatches { preview lineNumber }
        }
      }
      matchCount
    }
  }
}`;

export async function fetchSourcegraphGraphql(
  query: string,
  signal?: AbortSignal
): Promise<string> {
  const endpoint = "https://sourcegraph.com/.api/graphql";
  const timeoutSignal = AbortSignal.timeout(15000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "PiAgent/1.0",
    },
    body: JSON.stringify({ query: SEARCH_QUERY, variables: { query } }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    throw new Error(`Sourcegraph API error: ${res.statusText}`);
  }

  const json = await res.json();
  return formatSourcegraphSearchMarkdown(query, json.data);
}

export async function fetchSourcegraphFile(
  target: { repoName: string; rev?: string; filePath: string },
  signal?: AbortSignal
): Promise<string> {
  const rev = target.rev ?? "HEAD";
  const rawUrl = `https://sourcegraph.com/${target.repoName}@${rev}/-/raw/${target.filePath}`;
  const timeoutSignal = AbortSignal.timeout(15000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(rawUrl, {
    headers: { "User-Agent": "PiAgent/1.0" },
    signal: combinedSignal,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Sourcegraph file ${target.filePath}: ${res.status} ${res.statusText}`);
  }

  const content = await res.text();
  return `# ${target.repoName}/${target.filePath}\n\n\`\`\`\n${content}\n\`\`\``;
}
