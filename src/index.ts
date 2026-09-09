import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeWebFetch } from "./web-fetch.js";
import { executeWebSearch } from "./web-search.js";

export { executeWebFetch } from "./web-fetch.js";
export { executeWebSearch } from "./web-search.js";
export { parseSourcegraphUrl, formatSourcegraphSearchMarkdown } from "./sourcegraph.js";
export { cleanHtmlToMarkdown } from "./html-cleaner.js";

export default function webRetrievalExtension(pi: ExtensionAPI) {
  // 1. Web Fetch Tool
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable content from a URL as markdown. Automatically queries Sourcegraph GraphQL for code/repo search links to bypass heavy SPAs. Strips scripts/nav/footers.",
    promptSnippet: "Fetch web pages or documentation converted to clean markdown",
    parameters: Type.Object(
      {
        url: Type.String({ description: "The HTTP or HTTPS URL to fetch" }),
        maxCharacters: Type.Optional(
          Type.Number({
            description: "Maximum character budget (defaults to 12,000 chars / ~3,000 tokens)",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params) {
      const result = await executeWebFetch(params);
      return {
        content: [{ type: "text", text: result.output }],
        details: { url: params.url, source: result.source },
      };
    },
  });

  // 2. Web Search Tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web with token-bounded results. Supports Tavily, Exa, or free instant lookup. Caps results to protect context window.",
    promptSnippet: "Search the web for up-to-date documentation or facts",
    parameters: Type.Object(
      {
        query: Type.String({ description: "The search query" }),
        numResults: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 15,
            description: "Number of search results to return (default: 8)",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params) {
      const result = await executeWebSearch(params);
      return {
        content: [{ type: "text", text: result.output }],
        details: { query: params.query },
      };
    },
  });
}
