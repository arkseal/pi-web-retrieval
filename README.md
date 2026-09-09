# pi-web-retrieval

Token-optimized web fetch and search with Sourcegraph GraphQL code scraper for the **pi** coding agent.

## Features

1. **Sourcegraph & GitHub GraphQL Code Interceptor:**
   Fetching `sourcegraph.com/...` or GitHub repositories normally downloads 1MB+ of client-side React bundles with zero useful code. This tool intercepts Sourcegraph URLs, queries `https://sourcegraph.com/.api/graphql` directly, and returns a clean 200–300 token markdown summary with exact line numbers and previews.

2. **Clean Markdown Fetcher (`web_fetch`):**
   - Negotiates `Accept: text/markdown` first (returns clean markdown for modern docs and `llms.txt`).
   - Strips `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, and SVG boilerplate before conversion.
   - Enforces a strict 12,000-character cap (~3,000 tokens) with an explicit truncation note.

3. **Lean Web Search (`web_search`):**
   - Supports Tavily (`TAVILY_API_KEY`) and Exa (`EXA_API_KEY`), with a free DuckDuckGo Instant Answer fallback.
   - Defaults to 8 results and a hard cap of 8,000 characters.

## Running Tests

```bash
bun test
```
