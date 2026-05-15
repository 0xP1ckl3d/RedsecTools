const { escapeHtml } = require("./rich-content");

function sanitizeHref(href) {
  const value = String(href || "").trim();
  if (!value) return "#";
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return "#";
}

function sanitizeImageSrc(src) {
  const value = String(src || "").trim();
  if (/^\/api\/reporter\/proposals\/supporting-images\/[A-Za-z0-9_-]+\/download$/.test(value)) return value;
  if (/^\/api\/reporter\/evidence\/[A-Za-z0-9_-]+\/download$/.test(value)) return value;
  return "";
}

function slugifyHeading(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function applyInlineFormatting(text) {
  const tokens = [];
  let output = escapeHtml(text || "");

  output = output.replace(/`([^`]+)`/g, (_, code) => {
    const token = `__WIKI_TOKEN_${tokens.length}__`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const safeSrc = sanitizeImageSrc(src);
    if (!safeSrc) return "";
    const token = `__WIKI_TOKEN_${tokens.length}__`;
    tokens.push(`<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt || "")}">`);
    return token;
  });

  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeHref(href);
    const token = `__WIKI_TOKEN_${tokens.length}__`;
    const isInternal = safeHref.startsWith("/");
    tokens.push(
      `<a href="${escapeHtml(safeHref)}"${isInternal ? "" : ' rel="noopener noreferrer" target="_blank"'}>${escapeHtml(label)}</a>`
    );
    return token;
  });

  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  output = output.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  tokens.forEach((html, index) => {
    output = output.replace(`__WIKI_TOKEN_${index}__`, html);
  });

  return output;
}

function stripMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownToExcerpt(markdown, maxLength = 220) {
  const plain = stripMarkdown(markdown);
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function parseTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const headerLine = lines[startIndex];
  const dividerLine = lines[startIndex + 1];
  if (!headerLine.includes("|") || !dividerLine.includes("|")) return null;
  const dividerCells = dividerLine.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (!dividerCells.length || dividerCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;

  const parseCells = (line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    return cells;
  };
  const headers = parseCells(headerLine);
  const rows = [];
  let cursor = startIndex + 2;
  while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
    rows.push(parseCells(lines[cursor]));
    cursor += 1;
  }

  return {
    consumed: cursor - startIndex,
    html: `
      <table>
        <thead><tr>${headers.map((cell) => `<th>${applyInlineFormatting(cell)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${applyInlineFormatting(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    `,
  };
}

function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const html = [];
  let index = 0;
  let listType = null;
  let inCodeBlock = false;
  let codeLang = "";
  const codeLines = [];

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  function closeCodeBlock() {
    if (!inCodeBlock) return;
    const safeLang = /^[a-z0-9_-]+$/i.test(codeLang) ? codeLang.toLowerCase() : "plaintext";
    html.push(`<pre class="wiki-code-block"><code class="language-${safeLang}" data-code-lang="${safeLang}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    inCodeBlock = false;
    codeLang = "";
    codeLines.length = 0;
  }

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        closeCodeBlock();
      } else {
        closeList();
        inCodeBlock = true;
        codeLang = trimmed.replace(/^```/, "").trim();
      }
      index += 1;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      index += 1;
      continue;
    }

    if (!trimmed) {
      closeList();
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      closeList();
      html.push(table.html);
      index += table.consumed;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      closeList();
      html.push("<hr>");
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const anchor = slugifyHeading(text);
      html.push(`<h${level} id="${escapeHtml(anchor)}">${applyInlineFormatting(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s+/.test(trimmed)) {
      closeList();
      html.push(`<blockquote>${applyInlineFormatting(trimmed.replace(/^>\s+/, ""))}</blockquote>`);
      index += 1;
      continue;
    }

    if (/^- \[[ xX]\]\s+/.test(trimmed)) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push('<ul class="wiki-task-list">');
      }
      const checked = /^- \[[xX]\]\s+/.test(trimmed);
      const label = trimmed.replace(/^- \[[ xX]\]\s+/, "");
      html.push(`<li class="wiki-task-item"><input type="checkbox" disabled${checked ? " checked" : ""}><span>${applyInlineFormatting(label)}</span></li>`);
      index += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${applyInlineFormatting(trimmed.replace(/^[-*+]\s+/, ""))}</li>`);
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${applyInlineFormatting(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      index += 1;
      continue;
    }

    closeList();
    html.push(`<p>${applyInlineFormatting(trimmed)}</p>`);
    index += 1;
  }

  closeCodeBlock();
  closeList();
  return html.join("\n");
}

module.exports = {
  renderMarkdownToHtml,
  markdownToExcerpt,
};
