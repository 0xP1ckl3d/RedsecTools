let hljsLoaded = false;
const langLoaded = new Set();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function ensureHljs(lang) {
  if (lang === "plaintext") return false;
  if (!hljsLoaded) {
    await loadScript("vendor/highlight.min.js");
    hljsLoaded = true;
  }
  if (!langLoaded.has(lang)) {
    await loadScript(`vendor/hljs-${lang}.min.js`);
    langLoaded.add(lang);
  }
  return true;
}

function highlightCode(code, lang) {
  if (!window.hljs || lang === "plaintext") return null;
  try {
    return window.hljs.highlight(code, { language: lang }).value;
  } catch {
    return null;
  }
}

function updateGutter(gutterEl, lineCount) {
  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    html += `<div>${i}</div>`;
  }
  gutterEl.innerHTML = html;
}

export {
  ensureHljs,
  highlightCode,
  updateGutter,
};
