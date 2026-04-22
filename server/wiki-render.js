const { escapeHtml } = require("./rich-content");

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, href) => {
      const safeHref = /^\/|^https?:\/\//i.test(href) ? href : "#";
      return `<a href="${escapeHtml(safeHref)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const html = [];
  let inList = null;
  let inCodeBlock = false;
  const codeLines = [];

  function closeList() {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  }

  function closeCodeBlock() {
    if (inCodeBlock) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      inCodeBlock = false;
      codeLines.length = 0;
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) closeCodeBlock();
      else {
        closeList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      closeList();
      html.push(`<h3>${renderInline(trimmed.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      closeList();
      html.push(`<h2>${renderInline(trimmed.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      closeList();
      html.push(`<h1>${renderInline(trimmed.replace(/^#\s+/, ""))}</h1>`);
      continue;
    }
    if (/^>\s+/.test(trimmed)) {
      closeList();
      html.push(`<blockquote>${renderInline(trimmed.replace(/^>\s+/, ""))}</blockquote>`);
      continue;
    }
    if (/^- /.test(trimmed)) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInline(trimmed.replace(/^- /, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInline(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeCodeBlock();
  closeList();
  return html.join("\n");
}

module.exports = {
  renderMarkdownToHtml,
};
