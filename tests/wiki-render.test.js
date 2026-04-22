const test = require("node:test");
const assert = require("node:assert/strict");

const { renderMarkdownToHtml, markdownToExcerpt } = require("../server/wiki-render");

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
    "| Name | Value |",
    "| --- | --- |",
    "| Team | Wiki |",
    "",
    "- [x] published",
    "",
    "[Internal](/wiki?page=abc123)",
  ].join("\n"));

  assert.ok(html.includes('<h1 id="heading">Heading</h1>'));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes('class="wiki-task-list"'));
  assert.ok(html.includes('href="/wiki?page=abc123"'));
});

test("markdownToExcerpt strips markdown and truncates safely", () => {
  const excerpt = markdownToExcerpt("## Heading\n\nParagraph with **bold** and [link](/wiki).", 24);
  assert.equal(excerpt, "Heading Paragraph with…");
});
