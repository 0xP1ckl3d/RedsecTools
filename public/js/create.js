import { createEncryptedPaste } from "./crypto.js";
import { ensureHljs, highlightCode, updateGutter } from "./hljs-loader.js";

const contentEl = document.getElementById("content");
const passwordEl = document.getElementById("password");
const expiresEl = document.getElementById("expires");
const syntaxEl = document.getElementById("syntax");
const burnEl = document.getElementById("burn");
const createBtn = document.getElementById("create-btn");
const previewBtn = document.getElementById("preview-btn");
const createForm = document.getElementById("create-form");
const resultEl = document.getElementById("result");
const shareUrlEl = document.getElementById("share-url");
const copyBtn = document.getElementById("copy-btn");
const newBtn = document.getElementById("new-btn");
const togglePwBtn = document.getElementById("toggle-password");
const charCount = document.getElementById("char-count");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const burnNotice = document.getElementById("burn-notice");
const toastEl = document.getElementById("toast");
const toastText = document.getElementById("toast-text");

// Preview modal
const previewModal = document.getElementById("preview-modal");
const previewContent = document.getElementById("preview-content");
const previewGutter = document.getElementById("preview-gutter");
const closePreview = document.getElementById("close-preview");

// Editor line numbers
const editorGutter = document.getElementById("editor-gutter");

function updateEditorGutter() {
  const lines = contentEl.value.split("\n").length;
  updateGutter(editorGutter, lines);
}

contentEl.addEventListener("input", () => {
  charCount.textContent = `${contentEl.value.length} characters`;
  updateEditorGutter();
});

updateEditorGutter();

togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordEl.type === "password";
  passwordEl.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

function showToast(message, duration = 3000) {
  toastText.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), duration);
}

// --- Preview ---
previewBtn.addEventListener("click", async () => {
  const content = contentEl.value;
  if (!content.trim()) {
    showToast("Nothing to preview.");
    return;
  }

  const syntax = syntaxEl.value;
  const lines = content.split("\n").length;
  updateGutter(previewGutter, lines);

  const loaded = await ensureHljs(syntax);
  const highlighted = loaded ? highlightCode(content, syntax) : null;

  if (highlighted) {
    previewContent.innerHTML = highlighted;
  } else {
    previewContent.textContent = content;
  }

  previewModal.classList.remove("hidden");
});

closePreview.addEventListener("click", () => {
  previewModal.classList.add("hidden");
});

previewModal.addEventListener("click", (e) => {
  if (e.target === previewModal) previewModal.classList.add("hidden");
});

// --- Create ---
createBtn.addEventListener("click", async () => {
  const content = contentEl.value.trim();
  if (!content) {
    showToast("Please enter some content.");
    return;
  }

  const password = passwordEl.value;
  const expiresIn = parseInt(expiresEl.value, 10);
  const burnAfterReading = burnEl.checked;
  const syntax = syntaxEl.value;

  createBtn.disabled = true;
  loadingEl.classList.remove("hidden");
  loadingText.textContent = password ? "Encrypting and deriving key (this may take a moment)..." : "Encrypting your note...";

  try {
    const result = await createEncryptedPaste(content, password);

    loadingText.textContent = "Uploading encrypted note...";

    const res = await fetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciphertext: result.ciphertext,
        iv: result.iv,
        ivPassword: result.ivPassword,
        salt: result.salt,
        hasPassword: result.hasPassword,
        burnAfterReading,
        expiresIn,
        syntax,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create paste");
    }

    const { id } = await res.json();
    const origin = window.location.origin;
    const shareUrl = `${origin}/p/${id}#${result.keyBase64}`;

    shareUrlEl.value = shareUrl;
    createForm.classList.add("hidden");
    resultEl.classList.remove("hidden");

    if (burnAfterReading) {
      burnNotice.classList.remove("hidden");
    }
  } catch (err) {
    showToast(err.message || "Failed to create note.");
  } finally {
    loadingEl.classList.add("hidden");
    createBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
  } catch {
    shareUrlEl.select();
    document.execCommand("copy");
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
  }
});

newBtn.addEventListener("click", () => {
  contentEl.value = "";
  passwordEl.value = "";
  expiresEl.value = "86400";
  syntaxEl.value = "plaintext";
  burnEl.checked = false;
  charCount.textContent = "0 characters";
  burnNotice.classList.add("hidden");
  resultEl.classList.add("hidden");
  createForm.classList.remove("hidden");
  updateEditorGutter();
});

// --- Email link ---
const emailSection = document.getElementById("email-link-section");
const emailTo = document.getElementById("email-to");
const emailBtn = document.getElementById("email-btn");
const emailResult = document.getElementById("email-result");

// Check if SMTP is configured
(async () => {
  try {
    const res = await fetch("/api/auth/smtp-status");
    const data = await res.json();
    if (data.configured) emailSection.classList.remove("hidden");
  } catch {}
})();

emailBtn.addEventListener("click", async () => {
  const to = emailTo.value.trim();
  if (!to) return;

  emailBtn.disabled = true;
  emailResult.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/email-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: to, url: shareUrlEl.value, toolName: "RedSecPaste" }),
    });
    const data = await res.json();
    if (res.ok) {
      emailResult.textContent = "Link sent!";
      emailResult.className = "text-sm mt-1 text-accent";
      emailTo.value = "";
    } else {
      emailResult.textContent = data.error || "Failed to send";
      emailResult.className = "text-sm mt-1 text-error";
    }
  } catch {
    emailResult.textContent = "Network error";
    emailResult.className = "text-sm mt-1 text-error";
  }
  emailResult.classList.remove("hidden");
  emailBtn.disabled = false;
});
