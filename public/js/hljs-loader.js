// Lazy loader for highlight.js — only loads core + language packs on demand
var hljsLoaded = false;
var langLoaded = new Set();

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

  if (!hljsLoaded) {
    await loadScript("/js/vendor/highlight.min.js");
    hljsLoaded = true;
  }

  if (!langLoaded.has(lang)) {
    await loadScript("/js/vendor/hljs-" + lang + ".min.js");
    langLoaded.add(lang);
  }

  return true;
}

export function highlightCode(code, lang) {
  if (!window.hljs || lang === "plaintext") return null;
  try {
    return window.hljs.highlight(code, { language: lang }).value;
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
