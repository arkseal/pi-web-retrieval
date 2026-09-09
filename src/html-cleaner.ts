export function cleanHtmlToMarkdown(html: string, maxCharacters = 12000): string {
  // 1. Remove unwanted blocks completely
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "");

  // 2. Headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, "\n#### $1\n");

  // 3. Formatting
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");

  // 4. Links: <a href="...">text</a> -> [text](url)
  text = text.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // 5. Paragraphs & Linebreaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");

  // 6. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // 7. Decode common entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&copy;/g, "©");

  // 8. Collapse whitespace
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n\n");

  if (text.length > maxCharacters) {
    return `${text.slice(0, maxCharacters)}\n\n(Content truncated at ${maxCharacters} characters to keep token impact small)`;
  }

  return text;
}
