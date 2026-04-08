// RedSecTools — Profile page logic

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
const updateUsernameBtn = document.getElementById("update-username-btn");
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
