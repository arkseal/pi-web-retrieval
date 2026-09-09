import { describe, expect, it } from "bun:test";
import { parseSourcegraphUrl, formatSourcegraphSearchMarkdown } from "../src/sourcegraph";

describe("Sourcegraph URL Parser & Formatter", () => {
  it("parses search URLs correctly", () => {
    const target = parseSourcegraphUrl("https://sourcegraph.com/search?q=context:global+repo:facebook/react+useState");
    expect(target).toBeDefined();
    expect(target?.type).toBe("search");
    if (target?.type === "search") {
      expect(target.query).toBe("context:global repo:facebook/react useState");
    }
  });

  it("parses repo file URLs correctly", () => {
    const target = parseSourcegraphUrl("https://sourcegraph.com/github.com/facebook/react/-/blob/packages/react/src/React.js");
    expect(target).toBeDefined();
    expect(target?.type).toBe("file");
    if (target?.type === "file") {
      expect(target.repoName).toBe("github.com/facebook/react");
      expect(target.filePath).toBe("packages/react/src/React.js");
    }
  });

  it("formats search results into compact markdown with line previews", () => {
    const mockData = {
      search: {
        results: {
          results: [
            {
              __typename: "FileMatch",
              repository: { name: "github.com/facebook/react", url: "https://github.com/facebook/react" },
              file: { path: "packages/react/src/React.js", url: "https://sourcegraph.com/..." },
              lineMatches: [
                { lineNumber: 42, preview: "export { useState } from './ReactHooks';" },
              ],
            },
          ],
          matchCount: 1,
        },
      },
    };

    const md = formatSourcegraphSearchMarkdown("useState", mockData);
    expect(md).toContain("# Sourcegraph Search");
    expect(md).toContain("github.com/facebook/react/packages/react/src/React.js");
    expect(md).toContain("L42: export { useState } from './ReactHooks';");
  });
});
