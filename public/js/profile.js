import { showConfirmModal } from "./confirm-modal.js";

// RedSecTools — embedded homepage Profile view logic

const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const confirmPasswordInput = document.getElementById("confirm-new-password");
const toggleNewPwBtn = document.getElementById("toggle-new-pw");
const changePasswordBtn = document.getElementById("change-password-btn");
const passwordError = document.getElementById("password-error");
const passwordSuccess = document.getElementById("password-success");
const guestToolSelect = document.getElementById("guest-tool");
const guestExpirySelect = document.getElementById("guest-expiry");
const generateGuestBtn = document.getElementById("generate-guest-btn");
const guestLinkResult = document.getElementById("guest-link-result");
const guestLinkUrl = document.getElementById("guest-link-url");
const copyGuestBtn = document.getElementById("copy-guest-btn");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toast-text");

// --- Load current username ---
const usernameInput = document.getElementById("username-input");
const fullNameInput = document.getElementById("full-name-input");
const updateUsernameBtn = document.getElementById("update-username-btn");
const updateProfileBtn = document.getElementById("update-profile-btn");
const usernameError = document.getElementById("username-error");
const usernameSuccess = document.getElementById("username-success");

// --- Avatar elements ---
const avatarInput = document.getElementById("avatar-input");
const avatarPreview = document.getElementById("avatar-preview");
const avatarPlaceholder = document.getElementById("avatar-placeholder");
const uploadAvatarBtn = document.getElementById("upload-avatar-btn");
const removeAvatarBtn = document.getElementById("remove-avatar-btn");
const avatarError = document.getElementById("avatar-error");
const avatarSuccess = document.getElementById("avatar-success");

let currentUserId = null;

// --- Load user info (username + avatar) ---
(async () => {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.authenticated && data.user) {
      usernameInput.value = data.user.username;
      if (fullNameInput) fullNameInput.value = data.user.fullName || "";
      currentUserId = data.user.id;
      loadAvatar(data.user);
    }
  } catch {}
})();

// --- Update username ---
updateUsernameBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  usernameError.classList.add("hidden");
  usernameSuccess.classList.add("hidden");

  if (!username) {
    usernameError.textContent = "Username is required";
    usernameError.classList.remove("hidden");
    return;
  }

  updateUsernameBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/update-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    const data = await res.json();

    if (res.ok) {
      usernameSuccess.textContent = "Username updated";
      usernameSuccess.classList.remove("hidden");
    } else {
      usernameError.textContent = data.error || "Failed to update username";
      usernameError.classList.remove("hidden");
    }
  } catch {
    usernameError.textContent = "Network error";
    usernameError.classList.remove("hidden");
  } finally {
    updateUsernameBtn.disabled = false;
  }
});

updateProfileBtn?.addEventListener("click", async () => {
  usernameError.classList.add("hidden");
  usernameSuccess.classList.add("hidden");
  updateProfileBtn.disabled = true;
  try {
    const res = await fetch("/api/auth/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: fullNameInput?.value.trim() || "" }),
    });
    const data = await res.json();
    if (res.ok) {
      usernameSuccess.textContent = "Profile updated";
      usernameSuccess.classList.remove("hidden");
    } else {
      usernameError.textContent = data.error || "Failed to update profile";
      usernameError.classList.remove("hidden");
    }
  } catch {
    usernameError.textContent = "Network error";
    usernameError.classList.remove("hidden");
  } finally {
    updateProfileBtn.disabled = false;
  }
});

// --- Password toggle ---
toggleNewPwBtn.addEventListener("click", () => {
  const isPassword = newPasswordInput.type === "password";
  newPasswordInput.type = isPassword ? "text" : "password";
  toggleNewPwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  toggleNewPwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

// --- Change password ---
changePasswordBtn.addEventListener("click", async () => {
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  passwordError.classList.add("hidden");
  passwordSuccess.classList.add("hidden");

  if (!currentPassword || !newPassword || !confirmPassword) {
    showPasswordError("All fields are required");
    return;
  }

  if (newPassword !== confirmPassword) {
    showPasswordError("New passwords do not match");
    return;
  }

  if (newPassword.length < 12) {
    showPasswordError("New password must be at least 12 characters");
    return;
  }

  changePasswordBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json();

    if (res.ok) {
      currentPasswordInput.value = "";
      newPasswordInput.value = "";
      confirmPasswordInput.value = "";
      // Re-encrypt chat private key with new password
      try {
        if (window.ChatCrypto && currentUserId) {
          const privateKey = await ChatCrypto.getKeyFromIndexedDB(currentUserId);
          if (privateKey) {
            const newBackup = await ChatCrypto.encryptPrivateKey(privateKey, newPassword);
            if (newBackup) {
              await fetch("/api/chat/keys/backup", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  encryptedPrivateKey: newBackup.encryptedPrivateKey,
                  privateKeyIv: newBackup.iv,
                  privateKeySalt: newBackup.salt,
                }),
              });
            }
          }
        }
      } catch (err) {
        console.error("[chat] Key backup re-encryption failed:", err);
      }
      passwordSuccess.textContent = "Password changed successfully";
      passwordSuccess.classList.remove("hidden");
    } else {
      showPasswordError(data.error || "Failed to change password");
    }
  } catch {
    showPasswordError("Network error");
  } finally {
    changePasswordBtn.disabled = false;
  }
});

// --- Guest links ---
generateGuestBtn.addEventListener("click", async () => {
  const tool = guestToolSelect.value;
  const expiresIn = parseInt(guestExpirySelect.value, 10);

  generateGuestBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/guest-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, expiresIn }),
    });

    const data = await res.json();

    if (res.ok) {
      guestLinkUrl.value = data.url;
      guestLinkResult.classList.remove("hidden");
    } else {
      showToast(data.error || "Failed to generate link");
    }
  } catch {
    showToast("Network error");
  } finally {
    generateGuestBtn.disabled = false;
  }
});

copyGuestBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(guestLinkUrl.value).then(() => {
    copyGuestBtn.textContent = "Copied!";
    setTimeout(() => { copyGuestBtn.textContent = "Copy"; }, 2000);
  });
});

// --- Email guest link ---
const guestEmailSection = document.getElementById("guest-email-section");
const guestEmailTo = document.getElementById("guest-email-to");
const guestEmailBtn = document.getElementById("guest-email-btn");
const guestEmailResult = document.getElementById("guest-email-result");

(async () => {
  try {
    const res = await fetch("/api/auth/smtp-status");
    const data = await res.json();
    if (data.configured) guestEmailSection.classList.remove("hidden");
  } catch {}
})();

guestEmailBtn.addEventListener("click", async () => {
  const to = guestEmailTo.value.trim();
  if (!to) return;

  guestEmailBtn.disabled = true;
  guestEmailResult.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/email-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: to, url: guestLinkUrl.value, toolName: "RedSecTools Guest" }),
    });
    const data = await res.json();
    if (res.ok) {
      guestEmailResult.textContent = "Link sent!";
      guestEmailResult.className = "text-sm mt-1 text-accent";
      guestEmailTo.value = "";
    } else {
      guestEmailResult.textContent = data.error || "Failed to send";
      guestEmailResult.className = "text-sm mt-1 text-error";
    }
  } catch {
    guestEmailResult.textContent = "Network error";
    guestEmailResult.className = "text-sm mt-1 text-error";
  }
  guestEmailResult.classList.remove("hidden");
  guestEmailBtn.disabled = false;
});

// --- Avatar ---
function loadAvatar(user) {
  if (user.avatarUpdatedAt) {
    avatarPreview.src = `/api/avatar/${currentUserId}.webp?t=${Date.now()}`;
    avatarPreview.classList.remove("hidden");
    avatarPlaceholder.classList.add("hidden");
  }
  avatarPreview.addEventListener("error", () => {
    avatarPreview.classList.add("hidden");
    avatarPlaceholder.classList.remove("hidden");
  });
  avatarPreview.addEventListener("load", () => {
    avatarPreview.classList.remove("hidden");
    avatarPlaceholder.classList.add("hidden");
  });
}

uploadAvatarBtn.addEventListener("click", () => {
  avatarInput.click();
});

avatarInput.addEventListener("change", () => {
  const file = avatarInput.files[0];
  if (!file) return;

  avatarError.classList.add("hidden");
  avatarSuccess.classList.add("hidden");

  if (!file.type.startsWith("image/")) {
    showAvatarError("Please select an image file");
    avatarInput.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showAvatarError("Image must be smaller than 5MB");
    avatarInput.value = "";
    return;
  }

  handleAvatarUpload();
});

async function handleAvatarUpload() {
  const file = avatarInput.files[0];
  if (!file) return;

  avatarError.classList.add("hidden");
  avatarSuccess.classList.add("hidden");
  uploadAvatarBtn.disabled = true;
  removeAvatarBtn.disabled = true;

  const formData = new FormData();
  formData.append("avatar", file);

  try {
    const res = await fetch("/api/avatar", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (res.ok) {
      avatarPreview.src = `/api/avatar/${currentUserId}.webp?t=${Date.now()}`;
      avatarPreview.classList.remove("hidden");
      avatarPlaceholder.classList.add("hidden");
      avatarSuccess.textContent = "Photo updated";
      avatarSuccess.classList.remove("hidden");
    } else {
      showAvatarError(data.error || "Failed to upload photo");
    }
  } catch {
    showAvatarError("Network error");
  } finally {
    uploadAvatarBtn.disabled = false;
    removeAvatarBtn.disabled = false;
    avatarInput.value = "";
  }
}

removeAvatarBtn.addEventListener("click", handleAvatarDelete);

async function handleAvatarDelete() {
  avatarError.classList.add("hidden");
  avatarSuccess.classList.add("hidden");
  removeAvatarBtn.disabled = true;
  uploadAvatarBtn.disabled = true;

  try {
    const res = await fetch("/api/avatar", { method: "DELETE" });
    const data = await res.json();

    if (res.ok) {
      avatarPreview.classList.add("hidden");
      avatarPreview.src = "";
      avatarPlaceholder.classList.remove("hidden");
      avatarSuccess.textContent = "Photo removed";
      avatarSuccess.classList.remove("hidden");
    } else {
      showAvatarError(data.error || "Failed to remove photo");
    }
  } catch {
    showAvatarError("Network error");
  } finally {
    removeAvatarBtn.disabled = false;
    uploadAvatarBtn.disabled = false;
  }
}

function showAvatarError(message) {
  avatarError.textContent = message;
  avatarError.classList.remove("hidden");
}

// ============================================================
// MFA Management
// ============================================================

const mfaStatusBadge = document.getElementById("mfa-status-badge");
const mfaDisabledSection = document.getElementById("mfa-disabled-section");
const mfaEnabledSection = document.getElementById("mfa-enabled-section");
const mfaSetupFlow = document.getElementById("mfa-setup-flow");
const mfaSetupQr = document.getElementById("mfa-setup-qr");
const mfaRegenerateModal = document.getElementById("mfa-regenerate-modal");
const mfaDisableModal = document.getElementById("mfa-disable-modal");
const mfaSetupBtn = document.getElementById("mfa-setup-btn");
const mfaSetupPassword = document.getElementById("mfa-setup-password");
const mfaSetupStartBtn = document.getElementById("mfa-setup-start-btn");
const mfaSetupError = document.getElementById("mfa-setup-error");
const mfaQrContainer = document.getElementById("mfa-qr-container");
const mfaSecretDisplay = document.getElementById("mfa-secret-display");
const mfaSecretText = document.getElementById("mfa-secret-text");
const mfaShowSecretBtn = document.getElementById("mfa-show-secret-btn");
const mfaNewRecoveryCodes = document.getElementById("mfa-new-recovery-codes");
const mfaRecoveryCodesList = document.getElementById("mfa-recovery-codes-list");
const mfaVerifyCode = document.getElementById("mfa-verify-code");
const mfaVerifySetupBtn = document.getElementById("mfa-verify-setup-btn");
const mfaCancelSetupBtn = document.getElementById("mfa-cancel-setup-btn");
const mfaVerifyError = document.getElementById("mfa-verify-error");
const mfaRecoveryCount = document.getElementById("mfa-recovery-count");
const mfaTrustedCount = document.getElementById("mfa-trusted-count");
const mfaRegenerateBtn = document.getElementById("mfa-regenerate-btn");
const mfaRegenPassword = document.getElementById("mfa-regen-password");
const mfaRegenConfirmBtn = document.getElementById("mfa-regen-confirm-btn");
const mfaRegenCancelBtn = document.getElementById("mfa-regen-cancel-btn");
const mfaRegenCodesResult = document.getElementById("mfa-regen-codes-result");
const mfaRegenCodesList = document.getElementById("mfa-regen-codes-list");
const mfaRegenError = document.getElementById("mfa-regen-error");
const mfaRevokeTrustedBtn = document.getElementById("mfa-revoke-trusted-btn");
const mfaDisableBtn = document.getElementById("mfa-disable-btn");
const mfaDisablePassword = document.getElementById("mfa-disable-password");
const mfaDisableConfirmBtn = document.getElementById("mfa-disable-confirm-btn");
const mfaDisableCancelBtn = document.getElementById("mfa-disable-cancel-btn");
const mfaDisableError = document.getElementById("mfa-disable-error");

// Load MFA status
async function loadMFAStatus() {
  try {
    const res = await fetch("/api/auth/mfa/status");
    if (!res.ok) return;
    const data = await res.json();

    if (data.enabled) {
      mfaStatusBadge.textContent = "Enabled";
      mfaStatusBadge.className = "text-xs font-medium px-2.5 py-1 rounded-full bg-green-500/10 text-green-500";
      mfaDisabledSection.classList.add("hidden");
      mfaEnabledSection.classList.remove("hidden");
      mfaRecoveryCount.textContent = data.remainingCodes + " recovery codes remaining";
      mfaTrustedCount.textContent = data.trustedDeviceCount + " trusted browser(s)";
    } else {
      mfaStatusBadge.textContent = "Disabled";
      mfaStatusBadge.className = "text-xs font-medium px-2.5 py-1 rounded-full bg-secondary/20 text-secondary";
      mfaDisabledSection.classList.remove("hidden");
      mfaEnabledSection.classList.add("hidden");
    }
  } catch {}
}
loadMFAStatus();

// Start MFA setup
mfaSetupBtn.addEventListener("click", () => {
  mfaDisabledSection.classList.add("hidden");
  mfaSetupFlow.classList.remove("hidden");
  mfaSetupPassword.focus();
});

mfaSetupStartBtn.addEventListener("click", async () => {
  const password = mfaSetupPassword.value;
  if (!password) {
    mfaSetupError.textContent = "Password is required";
    mfaSetupError.classList.remove("hidden");
    return;
  }

  mfaSetupStartBtn.disabled = true;
  mfaSetupError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/mfa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      mfaSetupError.textContent = data.error || "Setup failed";
      mfaSetupError.classList.remove("hidden");
      return;
    }

    // Render QR code
    if (typeof qrcode !== "undefined") {
      var qr = qrcode(0, "M");
      qr.addData(data.provisioningURI);
      qr.make();
      mfaQrContainer.innerHTML = qr.createSvgTag(4);
    }

    mfaSecretText.textContent = data.secret;

    const codes = data.recoveryCodes || [];
    mfaRecoveryCodesList.innerHTML = codes.map(c => "<div>" + c + "</div>").join("");
    mfaNewRecoveryCodes.classList.remove("hidden");

    mfaSetupFlow.classList.add("hidden");
    mfaSetupQr.classList.remove("hidden");
    mfaVerifyCode.focus();
  } catch {
    mfaSetupError.textContent = "Network error";
    mfaSetupError.classList.remove("hidden");
  } finally {
    mfaSetupStartBtn.disabled = false;
  }
});

// Show manual secret key
mfaShowSecretBtn.addEventListener("click", () => {
  mfaSecretDisplay.classList.remove("hidden");
  mfaShowSecretBtn.classList.add("hidden");
});

// Verify MFA setup
mfaVerifySetupBtn.addEventListener("click", async () => {
  const code = mfaVerifyCode.value.trim();
  if (!code) return;

  mfaVerifySetupBtn.disabled = true;
  mfaVerifyError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/mfa/verify-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();

    if (!res.ok) {
      mfaVerifyError.textContent = data.error || "Verification failed";
      mfaVerifyError.classList.remove("hidden");
      return;
    }

    showToast("Two-factor authentication enabled");
    mfaSetupQr.classList.add("hidden");
    loadMFAStatus();
  } catch {
    mfaVerifyError.textContent = "Network error";
    mfaVerifyError.classList.remove("hidden");
  } finally {
    mfaVerifySetupBtn.disabled = false;
  }
});

mfaVerifyCode.addEventListener("keydown", (e) => { if (e.key === "Enter") mfaVerifySetupBtn.click(); });

// Cancel setup
mfaCancelSetupBtn.addEventListener("click", () => {
  mfaSetupQr.classList.add("hidden");
  loadMFAStatus();
});

// Regenerate recovery codes
mfaRegenerateBtn.addEventListener("click", () => {
  mfaEnabledSection.classList.add("hidden");
  mfaRegenerateModal.classList.remove("hidden");
  mfaRegenPassword.focus();
});

mfaRegenConfirmBtn.addEventListener("click", async () => {
  const password = mfaRegenPassword.value;
  if (!password) return;

  mfaRegenConfirmBtn.disabled = true;
  mfaRegenError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/mfa/regenerate-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      mfaRegenError.textContent = data.error || "Failed";
      mfaRegenError.classList.remove("hidden");
      return;
    }

    const codes = data.recoveryCodes || [];
    mfaRegenCodesList.innerHTML = codes.map(c => "<div>" + c + "</div>").join("");
    mfaRegenCodesResult.classList.remove("hidden");
    mfaRegenConfirmBtn.classList.add("hidden");
    mfaRegenPassword.classList.add("hidden");
    loadMFAStatus();
  } catch {
    mfaRegenError.textContent = "Network error";
    mfaRegenError.classList.remove("hidden");
  } finally {
    mfaRegenConfirmBtn.disabled = false;
  }
});

mfaRegenCancelBtn.addEventListener("click", () => {
  mfaRegenerateModal.classList.add("hidden");
  mfaRegenCodesResult.classList.add("hidden");
  mfaRegenConfirmBtn.classList.remove("hidden");
  mfaRegenPassword.classList.remove("hidden");
  mfaRegenPassword.value = "";
  mfaEnabledSection.classList.remove("hidden");
});

// Revoke trusted devices
mfaRevokeTrustedBtn.addEventListener("click", async () => {
  if (!await showConfirmModal({ title: "Revoke Trusted Browsers", message: "You will need to verify MFA on each browser next time.", confirmLabel: "Revoke All", danger: true })) return;

  try {
    const res = await fetch("/api/auth/mfa/trusted-devices", { method: "DELETE" });
    if (res.ok) {
      showToast("All trusted browsers revoked");
      loadMFAStatus();
    }
  } catch {}
});

// Disable MFA
mfaDisableBtn.addEventListener("click", () => {
  mfaEnabledSection.classList.add("hidden");
  mfaDisableModal.classList.remove("hidden");
  mfaDisablePassword.focus();
});

mfaDisableConfirmBtn.addEventListener("click", async () => {
  const password = mfaDisablePassword.value;
  if (!password) return;

  mfaDisableConfirmBtn.disabled = true;
  mfaDisableError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      mfaDisableError.textContent = data.error || "Failed";
      mfaDisableError.classList.remove("hidden");
      return;
    }

    showToast("Two-factor authentication disabled");
    mfaDisableModal.classList.add("hidden");
    mfaDisablePassword.value = "";
    loadMFAStatus();
  } catch {
    mfaDisableError.textContent = "Network error";
    mfaDisableError.classList.remove("hidden");
  } finally {
    mfaDisableConfirmBtn.disabled = false;
  }
});

mfaDisableCancelBtn.addEventListener("click", () => {
  mfaDisableModal.classList.add("hidden");
  mfaDisablePassword.value = "";
  mfaEnabledSection.classList.remove("hidden");
});

// --- Helpers ---
function showPasswordError(message) {
  passwordError.textContent = message;
  passwordError.classList.remove("hidden");
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => { toast.classList.add("hidden"); }, 3000);
}
