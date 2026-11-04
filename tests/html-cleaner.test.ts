import { describe, expect, it } from "bun:test";
import { cleanHtmlToMarkdown, decodeHtmlEntities } from "../src/html-cleaner";

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

  it("handles multiline tags across newlines", () => {
    const html = `
      <h1>
        Multiline
        Heading
      </h1>
      <p>Here is <strong>bold across
      two lines</strong> and <code>code across
      lines</code>.</p>
    `;
    const md = cleanHtmlToMarkdown(html);
    expect(md).toContain("# Multiline Heading");
    expect(md).toContain("**bold across");
    expect(md).toContain("`code across");
  });

  it("converts preformatted code blocks into fenced markdown code blocks", () => {
    const html = `<pre><code>function test() {\n  return 42;\n}</code></pre>`;
    const md = cleanHtmlToMarkdown(html);
    expect(md).toContain("```\nfunction test() {\n  return 42;\n}\n```");
  });

  it("converts blockquotes and horizontal rules", () => {
    const html = `<blockquote>A famous quote</blockquote><hr/><p>After quote</p>`;
    const md = cleanHtmlToMarkdown(html);
    expect(md).toContain("> A famous quote");
    expect(md).toContain("---");
    expect(md).toContain("After quote");
  });

  it("parses single-quoted and unquoted links", () => {
    const html = `<p><a href='https://single.com'>Single</a> and <a href=https://unquoted.com>Unquoted</a></p>`;
    const md = cleanHtmlToMarkdown(html);
    expect(md).toContain("[Single](https://single.com)");
    expect(md).toContain("[Unquoted](https://unquoted.com)");
  });

  it("decodes named, decimal, and hex entities", () => {
    const input = "Tom &amp; Jerry &lt;3 cheese &mdash; &#8212; &#x27;quoted&#x27; &copy; 2026";
    const decoded = decodeHtmlEntities(input);
    expect(decoded).toContain("Tom & Jerry");
    expect(decoded).toContain("<3");
    expect(decoded).toContain("—");
    expect(decoded).toContain("'quoted'");
    expect(decoded).toContain("©");
  });

  it("enforces character budget and adds truncation notice", () => {
    const rawHtml = `<html><body><p>${"A".repeat(5000)}</p></body></html>`;
    const md = cleanHtmlToMarkdown(rawHtml, 500);

    expect(md.length).toBeLessThanOrEqual(580);
    expect(md).toContain("(Content truncated at 500 characters");
  });

  it("is resilient to pathological / ReDoS inputs", () => {
    // Unclosed script and style tags
    const pathological = "<script " + "a=".repeat(20000);
    const start = Date.now();
    const md = cleanHtmlToMarkdown(pathological, 1000);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Must process in under 100ms
  });
});
