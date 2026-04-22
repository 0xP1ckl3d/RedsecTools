// RedSecShare — Multi-file create/upload page logic
import { createEncryptedShare } from "./file-crypto.js";

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const shareLimitHint = document.getElementById("share-limit-hint");
const fileList = document.getElementById("file-list");
const fileListBody = document.getElementById("file-list-body");
const fileCountEl = document.getElementById("file-count");
const totalSizeEl = document.getElementById("total-size");
const passwordInput = document.getElementById("password");
const togglePwBtn = document.getElementById("toggle-password");
const burnCheckbox = document.getElementById("burn");
const expiresSelect = document.getElementById("expires");
const createBtn = document.getElementById("create-btn");
const createForm = document.getElementById("create-form");
const resultDiv = document.getElementById("result");
const shareUrl = document.getElementById("share-url");
const copyBtn = document.getElementById("copy-btn");
const newBtn = document.getElementById("new-btn");
const burnNotice = document.getElementById("burn-notice");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toast-text");

let selectedFiles = [];
let shareConfig = {
  maxFileSizeMb: 250,
  maxFileSizeBytes: 250 * 1024 * 1024,
  maxFilesPerShare: 8,
};

async function loadShareConfig() {
  try {
    const res = await fetch("/api/share/config");
    if (!res.ok) return;
    const data = await res.json();
    shareConfig = {
      maxFileSizeMb: data.maxFileSizeMb || 250,
      maxFileSizeBytes: data.maxFileSizeBytes || (250 * 1024 * 1024),
      maxFilesPerShare: data.maxFilesPerShare || 8,
    };
  } catch {}

  if (shareLimitHint) {
    shareLimitHint.textContent = `Up to ${shareConfig.maxFilesPerShare} file${shareConfig.maxFilesPerShare === 1 ? "" : "s"} per share. Max ${shareConfig.maxFileSizeMb}MB per file.`;
  }
}

// --- Password toggle ---

togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

// --- Drop zone ---

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  addFiles(Array.from(e.dataTransfer.files));
});

dropZone.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

function addFiles(newFiles) {
  for (const file of newFiles) {
    if (file.size > shareConfig.maxFileSizeBytes) {
      showToast(`"${file.name}" exceeds the ${shareConfig.maxFileSizeMb}MB per-file limit`);
      continue;
    }
    if (selectedFiles.length >= shareConfig.maxFilesPerShare) {
      showToast(`You can attach up to ${shareConfig.maxFilesPerShare} file${shareConfig.maxFilesPerShare === 1 ? "" : "s"} per share`);
      break;
    }
    // Avoid duplicates by name+size
    if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      selectedFiles.push(file);
    }
  }
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  if (selectedFiles.length === 0) {
    fileList.classList.add("hidden");
    createBtn.disabled = true;
    return;
  }

  fileList.classList.remove("hidden");
  fileListBody.innerHTML = "";

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  fileCountEl.textContent = `${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`;
  totalSizeEl.textContent = formatSize(totalSize);

  selectedFiles.forEach((file, i) => {
    const row = document.createElement("div");
    row.className = "flex justify-between items-center py-1.5 border-b border-theme last:border-0";
    row.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <svg class="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <span class="text-sm truncate">${escapeHtml(file.name)}</span>
        <span class="text-xs text-muted shrink-0">${formatSize(file.size)}</span>
      </div>
      <button type="button" class="remove-file-btn text-muted hover:text-error text-sm shrink-0 ml-2" data-index="${i}">Remove</button>
    `;
    fileListBody.appendChild(row);
  });

  createBtn.disabled = false;
}

fileListBody.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-file-btn")) {
    removeFile(parseInt(e.target.dataset.index, 10));
  }
});

// --- Create ---

createBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) {
    showToast("Select at least one file");
    return;
  }

  const password = passwordInput.value;
  const burn = burnCheckbox.checked;
  const expiresIn = parseInt(expiresSelect.value, 10);

  showLoading("Encrypting files...");
  createBtn.disabled = true;

  try {
    // Read all files as ArrayBuffers
    const fileBuffers = [];
    for (const file of selectedFiles) {
      showLoading(`Reading "${file.name}"...`);
      const buffer = await readFileAsArrayBuffer(file);
      fileBuffers.push({ buffer, name: file.name, type: file.type, size: file.size });
    }

    // Encrypt all files
    showLoading("Encrypting files...");
    const encrypted = await createEncryptedShare(fileBuffers, password || null);

    // Build FormData
    const formData = new FormData();

    // Add encrypted files
    for (let i = 0; i < encrypted.files.length; i++) {
      const ef = encrypted.files[i];
      formData.append("files", new Blob([ef.ciphertext]), `file_${i}`);
    }

    // Build metadata JSON
    const fileMeta = encrypted.files.map((ef) => ({
      iv: ef.iv,
      encryptedFilename: ef.encryptedFilename,
      filenameIv: ef.filenameIv,
      fileSize: ef.fileSize,
      mimeType: ef.mimeType,
      ivPassword: ef.ivPassword,
    }));

    const metadata = {
      expiresIn,
      hasPassword: encrypted.hasPassword,
      burnAfterReading: burn,
      salt: encrypted.salt,
      files: fileMeta,
    };

    formData.append("metadata", JSON.stringify(metadata));

    // Upload with progress
    showLoading("Uploading...");
    const result = await uploadWithProgress("/api/share", formData, (progress) => {
      loadingText.textContent = `Uploading... ${Math.round(progress * 100)}%`;
    });

    if (!result.ok) {
      const err = await result.json();
      throw new Error(err.error || "Upload failed");
    }

    const { id } = await result.json();

    // Build share URL
    const url = `${window.location.origin}/s/${id}#${encrypted.keyBase64}`;

    // Show result
    createForm.classList.add("hidden");
    resultDiv.classList.remove("hidden");
    shareUrl.value = url;

    if (burn) {
      burnNotice.classList.remove("hidden");
    }
  } catch (err) {
    showToast(err.message || "Failed to create share");
  } finally {
    hideLoading();
    createBtn.disabled = false;
  }
});

// --- Upload with XHR for progress ---

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, json: () => Promise.resolve(JSON.parse(xhr.responseText)) });
      } else {
        try {
          resolve({ ok: false, json: () => Promise.resolve(JSON.parse(xhr.responseText)) });
        } catch {
          resolve({ ok: false, json: () => Promise.resolve({ error: "Upload failed" }) });
        }
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(formData);
  });
}

// --- Utility ---

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showLoading(text) {
  loading.classList.remove("hidden");
  loadingText.textContent = text;
}

function hideLoading() {
  loading.classList.add("hidden");
}

// --- Copy / New ---

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(shareUrl.value).then(() => {
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
  });
});

newBtn.addEventListener("click", () => {
  selectedFiles = [];
  fileInput.value = "";
  passwordInput.value = "";
  burnCheckbox.checked = false;
  expiresSelect.value = "86400";
  fileList.classList.add("hidden");
  dropZone.classList.remove("hidden");
  resultDiv.classList.add("hidden");
  createForm.classList.remove("hidden");
  burnNotice.classList.add("hidden");
  createBtn.disabled = true;
});

// --- Email link ---
const emailSection = document.getElementById("email-link-section");
const emailTo = document.getElementById("email-to");
const emailBtn = document.getElementById("email-btn");
const emailResult = document.getElementById("email-result");

(async () => {
  await loadShareConfig();
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
      body: JSON.stringify({ email: to, url: shareUrl.value, toolName: "RedSecShare" }),
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

// --- Toast ---

function showToast(message) {
  toastText.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => { toast.classList.add("hidden"); }, 3000);
}

// --- Init ---
// Burger menu auto-initializes via burger-menu.js script tag
