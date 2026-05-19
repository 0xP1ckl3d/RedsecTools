// RedSecShare — Multi-file view/download page logic
import { importKey, base64ToArray } from "./crypto.js";
import { decryptFile, decryptFileWithPassword, decryptFilename } from "./file-crypto.js";
import { escapeHtml } from "./ui-components.js";

const loadingState = document.getElementById("loading-state");
const passwordPrompt = document.getElementById("password-prompt");
const passwordInput = document.getElementById("password-input");
const passwordError = document.getElementById("password-error");
const decryptBtn = document.getElementById("decrypt-btn");
const filePanel = document.getElementById("file-panel");
const burnNotice = document.getElementById("burn-notice");
const selectAllBtn = document.getElementById("select-all-btn");
const downloadSelectedBtn = document.getElementById("download-selected-btn");
const fileTableBody = document.getElementById("file-table-body");
const errorNotFound = document.getElementById("error-not-found");
const errorExpired = document.getElementById("error-expired");
const errorInvalid = document.getElementById("error-invalid");
const errorDecrypt = document.getElementById("error-decrypt");
const downloadProgress = document.getElementById("download-progress");
const progressText = document.getElementById("progress-text");

let shareId = null;
let urlKey = null;
let shareMeta = null;
let decryptedFilenames = [];

// --- Parse URL ---
const pathParts = window.location.pathname.split("/");
shareId = pathParts[pathParts.length - 1];
const fragment = window.location.hash.slice(1);

if (!fragment) {
  loadingState.classList.add("hidden");
  errorInvalid.classList.remove("hidden");
} else {
  urlKey = fragment;
  fetchShareMeta();
}

// --- Fetch metadata ---
async function fetchShareMeta() {
  try {
    const res = await fetch(`/api/share/${shareId}`);

    if (res.status === 404 || res.status === 410) {
      loadingState.classList.add("hidden");
      errorNotFound.classList.remove("hidden");
      return;
    }

    if (!res.ok) {
      loadingState.classList.add("hidden");
      errorNotFound.classList.remove("hidden");
      return;
    }

    shareMeta = await res.json();

    // If burned, the share was already accessed — show not found
    if (shareMeta.burned) {
      loadingState.classList.add("hidden");
      errorNotFound.classList.remove("hidden");
      return;
    }

    // Decrypt filenames for display
    const key = await importKey(urlKey);
    decryptedFilenames = [];
    for (const f of shareMeta.files) {
      try {
        const realName = await decryptFilename(f.encryptedFilename, key, f.filenameIv);
        decryptedFilenames.push(realName);
      } catch {
        decryptedFilenames.push("encrypted-file");
      }
    }

    loadingState.classList.add("hidden");

    if (shareMeta.hasPassword) {
      passwordPrompt.classList.remove("hidden");
    } else {
      showFilePanel();
    }
  } catch {
    loadingState.classList.add("hidden");
    errorNotFound.classList.remove("hidden");
  }
}

function showFilePanel() {
  filePanel.classList.remove("hidden");

  if (shareMeta.burnAfterReading) {
    burnNotice.classList.remove("hidden");
  }

  // Render file table
  fileTableBody.innerHTML = "";
  shareMeta.files.forEach((f, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="file-checkbox" data-index="${i}" checked></td>
      <td class="text-sm">${escapeHtml(decryptedFilenames[i])}</td>
      <td class="text-xs text-muted">${formatSize(f.fileSize)}</td>
      <td><button class="download-single-btn btn-secondary text-xs px-2 py-1" data-index="${i}">Download</button></td>
    `;
    fileTableBody.appendChild(tr);
  });

  updateDownloadSelected();
}

// --- Password decrypt ---

decryptBtn.addEventListener("click", async () => {
  const password = passwordInput.value;
  if (!password) return;

  decryptBtn.disabled = true;
  passwordError.classList.add("hidden");

  // We can't verify the password without downloading — just show files
  // Actual password verification happens on download
  showFilePanel();
  passwordPrompt.classList.add("hidden");
});

// --- File downloads ---

fileTableBody.addEventListener("click", async (e) => {
  if (e.target.classList.contains("download-single-btn")) {
    const index = parseInt(e.target.dataset.index, 10);
    await downloadAndDecryptFile(index);
  }
});

selectAllBtn.addEventListener("click", () => {
  const checkboxes = fileTableBody.querySelectorAll(".file-checkbox");
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  updateDownloadSelected();
});

downloadSelectedBtn.addEventListener("click", async () => {
  const checkboxes = fileTableBody.querySelectorAll(".file-checkbox:checked");
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));

  for (let i = 0; i < indices.length; i++) {
    progressText.textContent = `Downloading ${i + 1} of ${indices.length}...`;
    await downloadAndDecryptFile(indices[i]);
  }
  progressText.textContent = "";
});

fileTableBody.addEventListener("change", (e) => {
  if (e.target.classList.contains("file-checkbox")) {
    updateDownloadSelected();
  }
});

function updateDownloadSelected() {
  const checked = fileTableBody.querySelectorAll(".file-checkbox:checked").length;
  downloadSelectedBtn.textContent = `Download Selected (${checked})`;
  downloadSelectedBtn.disabled = checked === 0;
}

async function downloadAndDecryptFile(index) {
  const fileMeta = shareMeta.files[index];
  const fileName = decryptedFilenames[index];

  try {
    const res = await fetch(`/api/share/${shareId}/file/${fileMeta.id}`);

    if (res.status === 404 || res.status === 410) {
      showToast("File no longer available");
      return;
    }

    if (!res.ok) {
      throw new Error("Download failed");
    }

    const encryptedBuffer = await res.arrayBuffer();
    const key = await importKey(urlKey);

    let decryptedBuffer;

    if (shareMeta.hasPassword) {
      const password = passwordInput.value;
      if (!password) {
        showToast("Password required");
        return;
      }

      const { innerCiphertext, urlKey: k2 } = await decryptFileWithPassword(
        encryptedBuffer,
        fileMeta.ivPassword,
        shareMeta.salt,
        password,
        urlKey,
      );
      decryptedBuffer = await decryptFile(innerCiphertext, k2, fileMeta.iv);
    } else {
      decryptedBuffer = await decryptFile(encryptedBuffer, key, fileMeta.iv);
    }

    // Trigger browser download
    const blob = new Blob([decryptedBuffer], { type: fileMeta.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Mark row as downloaded
    const btn = fileTableBody.querySelector(`[data-index="${index}"]`);
    if (btn) {
      btn.textContent = "Downloaded";
      btn.disabled = true;
    }
  } catch (err) {
    if (shareMeta.hasPassword) {
      passwordError.classList.remove("hidden");
      passwordError.textContent = "Incorrect password or corrupted data.";
      filePanel.classList.add("hidden");
      passwordPrompt.classList.remove("hidden");
      decryptBtn.disabled = false;
    } else {
      showToast("Decryption failed: " + (err.message || "unknown error"));
    }
  }
}

// --- Utility ---

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// --- Toast ---
const toast = document.getElementById("toast");
const toastText = document.getElementById("toast-text");

function showToast(message) {
  toastText.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => { toast.classList.add("hidden"); }, 3000);
}

// --- Init ---
// Burger menu auto-initializes via burger-menu.js script tag
