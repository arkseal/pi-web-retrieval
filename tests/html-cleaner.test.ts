import { describe, expect, it } from "bun:test";
import { cleanHtmlToMarkdown } from "../src/html-cleaner";

describe("HTML cleaner and markdown converter", () => {
  it("strips scripts, styles, nav, and footers", () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>alert('xss');</script>
        </head>
        <body>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <main>
            <h1>Main Title</h1>
            <p>This is the <strong>important</strong> content.</p>
          </main>
          <footer><p>&copy; 2026 Corporation</p></footer>
        </body>
      </html>
    `;

    const md = cleanHtmlToMarkdown(rawHtml, 10000);
    expect(md).toContain("# Main Title");
    expect(md).toContain("This is the **important** content.");
    expect(md).not.toContain("alert('xss')");
    expect(md).not.toContain("color: red");
    expect(md).not.toContain("Home");
    expect(md).not.toContain("Corporation");
  });

  it("enforces character budget and adds truncation notice", () => {
    const rawHtml = `<html><body><p>${"A".repeat(5000)}</p></body></html>`;
    const md = cleanHtmlToMarkdown(rawHtml, 500);

    expect(md.length).toBeLessThanOrEqual(580);
    expect(md).toContain("(Content truncated at 500 characters");
  });
});
