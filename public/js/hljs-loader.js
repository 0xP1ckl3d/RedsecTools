// Lazy loader for highlight.js — only loads core + language packs on demand
var hljsLoaded = false;
var langLoaded = new Set();
var LANG_ALIASES = {
  py: "python", js: "javascript", ts: "typescript",
  sh: "bash", shell: "bash", yml: "yaml",
  cs: "csharp", rb: "ruby", rs: "rust",
  golang: "go", kt: "kotlin", ps: "powershell",
  pl: "perl", env: "ini", dos: "bat",
  textile: "markdown", md: "markdown",
  docker: "dockerfile", makefile: "makefile"
};
var AVAILABLE = new Set([
  "bash","c","cpp","csharp","css","diff","dockerfile","go","ini",
  "java","javascript","json","kotlin","lua","markdown","perl",
  "php","plaintext","powershell","python","r","ruby","rust",
  "scala","sql","swift","typescript","vim","xml","yaml"
]);
function resolveLang(lang) {
  var resolved = LANG_ALIASES[lang] || lang;
  return AVAILABLE.has(resolved) ? resolved : null;
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) {
      resolve();
      return;
    }
    var s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function ensureHljs(lang) {
  if (lang === "plaintext") return false;

  var resolved = resolveLang(lang);
  if (!resolved) return false;

  if (!hljsLoaded) {
    await loadScript("/js/vendor/highlight.min.js");
    hljsLoaded = true;
  }

  if (!langLoaded.has(resolved)) {
    await loadScript("/js/vendor/hljs-" + resolved + ".min.js");
    langLoaded.add(resolved);
  }

  return true;
}

export function highlightCode(code, lang) {
  if (!window.hljs || lang === "plaintext") return null;
  var resolved = resolveLang(lang);
  if (!resolved) return null;
  try {
    return window.hljs.highlight(code, { language: resolved }).value;
  } catch {
    return null;
  }
}

export function updateGutter(gutterEl, lineCount) {
  var html = "";
  for (var i = 1; i <= lineCount; i++) {
    html += "<div>" + i + "</div>";
  }
  gutterEl.innerHTML = html;
}
