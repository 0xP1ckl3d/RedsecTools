import { importKey, decrypt, decryptPasteWithPassword } from "./crypto.js";
import { ensureHljs, highlightCode, updateGutter } from "./hljs-loader.js";

const loadingState = document.getElementById("loading-state");
const passwordPrompt = document.getElementById("password-prompt");
const passwordInput = document.getElementById("password-input");
const decryptBtn = document.getElementById("decrypt-btn");
const passwordError = document.getElementById("password-error");
const decryptedEl = document.getElementById("decrypted");
const noteContent = document.getElementById("note-content");
const codeGutter = document.getElementById("code-gutter");
const codeContainer = document.getElementById("code-container");
const burnNotice = document.getElementById("burn-notice");
const copyContentBtn = document.getElementById("copy-content-btn");
const errorNotFound = document.getElementById("error-not-found");
const errorExpired = document.getElementById("error-expired");
const errorInvalid = document.getElementById("error-invalid");
const errorDecrypt = document.getElementById("error-decrypt");

let pasteData = null;

const _capturedKey = window.location.hash.length > 1 ? window.location.hash.slice(1) : null;
if (window.location.hash) {
  history.replaceState(null, "", window.location.pathname);
}

function hideAll() {
  loadingState.classList.add("hidden");
  passwordPrompt.classList.add("hidden");
  decryptedEl.classList.add("hidden");
  errorNotFound.classList.add("hidden");
  errorExpired.classList.add("hidden");
  errorInvalid.classList.add("hidden");
  errorDecrypt.classList.add("hidden");
}

function showError(el) {
  hideAll();
  el.classList.remove("hidden");
}

function getPasteId() {
  const match = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{22})$/);
  return match ? match[1] : null;
}

function getFragmentKey() {
  return _capturedKey;
}

async function renderContent(plaintext, syntax) {
  const lines = plaintext.split("\n").length;
  updateGutter(codeGutter, lines);

  const loaded = await ensureHljs(syntax);
  const highlighted = loaded ? highlightCode(plaintext, syntax) : null;

  if (highlighted) {
    noteContent.innerHTML = highlighted;
  } else {
    noteContent.textContent = plaintext;
  }
}

async function loadPaste() {
  const pasteId = getPasteId();
  if (!pasteId) {
    showError(errorNotFound);
    return;
  }

  try {
    const res = await fetch(`/api/paste/${pasteId}`);
    if (res.status === 404) { showError(errorNotFound); return; }
    if (res.status === 410) { showError(errorExpired); return; }
    if (!res.ok) { showError(errorNotFound); return; }

    pasteData = await res.json();
    const keyB64 = getFragmentKey();

    if (pasteData.hasPassword) {
      if (!keyB64) { showError(errorInvalid); return; }
      hideAll();
      passwordPrompt.classList.remove("hidden");
      passwordInput.focus();
    } else {
      if (!keyB64) { showError(errorInvalid); return; }
      await tryDecrypt(keyB64);
    }
  } catch {
    showError(errorNotFound);
  }
}

async function tryDecrypt(keyB64, password) {
  try {
    let plaintext;

    if (password) {
      plaintext = await decryptPasteWithPassword(
        pasteData.ciphertext, pasteData.iv, pasteData.ivPassword,
        pasteData.salt, password, keyB64,
      );
    } else {
      const key = await importKey(keyB64);
      plaintext = await decrypt(pasteData.ciphertext, key, pasteData.iv);
    }

    hideAll();
    await renderContent(plaintext, pasteData.syntax || "plaintext");
    decryptedEl.classList.remove("hidden");
    if (pasteData.burned) burnNotice.classList.remove("hidden");
  } catch {
    if (password) {
      passwordError.classList.remove("hidden");
      passwordInput.value = "";
      passwordInput.focus();
    } else {
      showError(errorDecrypt);
    }
  }
}

decryptBtn.addEventListener("click", async () => {
  const password = passwordInput.value;
  if (!password) return;
  const keyB64 = getFragmentKey();
  if (!keyB64) { showError(errorInvalid); return; }

  decryptBtn.disabled = true;
  passwordError.classList.add("hidden");
  await tryDecrypt(keyB64, password);
  decryptBtn.disabled = false;
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") decryptBtn.click();
});

copyContentBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(noteContent.textContent);
    copyContentBtn.textContent = "Copied!";
    setTimeout(() => (copyContentBtn.textContent = "Copy"), 2000);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(noteContent);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
    copyContentBtn.textContent = "Copied!";
    setTimeout(() => (copyContentBtn.textContent = "Copy"), 2000);
  }
});

loadPaste();
