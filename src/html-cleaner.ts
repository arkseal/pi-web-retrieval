const MAX_RAW_HTML_SIZE = 500_000; // 500KB pre-processing limit to protect CPU/memory

const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&lsquo;": "'",
  "&rsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
  "&bull;": "•",
  "&times;": "×",
  "&divide;": "÷",
};

export function decodeHtmlEntities(text: string): string {
  // 1. Decode numeric entities (decimal & hex)
  let decoded = text.replace(/&#(\d+);/g, (_, dec) => {
    try {
      const code = parseInt(dec, 10);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });

  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try {
      const code = parseInt(hex, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    } catch {
      return "";
    }
  });

  // 2. Decode named entities
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    decoded = decoded.replaceAll(entity, char);
  }

  return decoded;
}

export function cleanHtmlToMarkdown(html: string, maxCharacters = 12000): string {
  if (!html) return "";

  // Guard against massive inputs by pre-slicing
  let text = html.length > MAX_RAW_HTML_SIZE ? html.slice(0, MAX_RAW_HTML_SIZE) : html;

  // 1. Remove non-content structural blocks (ReDoS-safe non-greedy matching)
  text = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "");

  // 2. Protect preformatted code blocks from whitespace manipulation
  const codeBlocks: string[] = [];
  text = text.replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`\n\`\`\`\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`);
    return `\x00CODEBLOCK_${idx}\x00`;
  });
  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`\n\`\`\`\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // 3. Headings (multiline aware, collapse internal whitespace)
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, h) => `\n# ${h.replace(/\s+/g, " ").trim()}\n`);
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, h) => `\n## ${h.replace(/\s+/g, " ").trim()}\n`);
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, h) => `\n### ${h.replace(/\s+/g, " ").trim()}\n`);
  text = text.replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, h) => `\n#### ${h.replace(/\s+/g, " ").trim()}\n`);

  // 4. Blockquotes
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, bq) => {
    const lines = bq.trim().split("\n").map((l: string) => `> ${l.trim()}`);
    return `\n${lines.join("\n")}\n`;
  });

  // 5. Formatting
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, s) => `**${s.trim()}**`);
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, s) => `*${s.trim()}*`);
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, s) => `\`${s.trim()}\``);

  // 6. Links: support double quotes, single quotes, and unquoted hrefs
  text = text.replace(
    /<a\b[^>]*?\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_, hrefDouble, hrefSingle, hrefBare, linkText) => {
      const href = (hrefDouble || hrefSingle || hrefBare || "").trim();
      const content = (linkText || "").replace(/\s+/g, " ").trim();
      if (!href) return content;
      if (!content) return href;
      return `[${content}](${href})`;
    }
  );

  // 7. Structural dividers and breaks
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n---\n");
  text = text.replace(/<br\b[^>]*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `- ${item.replace(/\s+/g, " ").trim()}\n`);

  // 8. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // 9. Decode HTML entities
  text = decodeHtmlEntities(text);

  // 10. Clean up spacing outside code blocks
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // 11. Restore code blocks
  text = text.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx, 10)] ?? "");

  let result = text.trim();

  // Token / Character Budget Enforcement
  const effectiveMax = Math.max(100, maxCharacters);
  if (result.length > effectiveMax) {
    return `${result.slice(0, effectiveMax)}\n\n(Content truncated at ${effectiveMax} characters to keep token impact small)`;
  }

  return result;
}
