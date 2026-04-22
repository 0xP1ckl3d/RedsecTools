const test = require("node:test");
const assert = require("node:assert/strict");

const { renderMarkdownToHtml } = require("../server/wiki-render");

test("renderMarkdownToHtml renders markdown structure and escapes raw html", () => {
  const html = renderMarkdownToHtml([
    "# Heading",
    "",
    "Paragraph with **bold** and *italic* and `code`.",
    "",
    "- one",
    "- two",
    "",
    "```",
    "<script>alert(1)</script>",
    "```",
    "",
    "[Internal](/wiki)",
  ].join("\n"));

  assert.ok(html.includes("<h1>Heading</h1>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes('href="/wiki"'));
});
