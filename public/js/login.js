// RedSecTools — Login page logic (with MFA support)

// Redirect to home if already logged in
(async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && !data.guest) {
        window.location.href = "/";
        return;
      }
    }
  } catch {}
})();

const REGISTER_MFA_STORAGE_KEY = "pendingRegistrationMfa";

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePwBtn = document.getElementById("toggle-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const keepSignedInCb = document.getElementById("keep-signed-in");
const ssoLoginBtn = document.getElementById("sso-login-btn");

// MFA elements
const loginSection = document.getElementById("login-section");
const mfaSection = document.getElementById("mfa-section");
const mfaCodeInput = document.getElementById("mfa-code");
const mfaVerifyBtn = document.getElementById("mfa-verify-btn");
const mfaError = document.getElementById("mfa-error");
const rememberBrowserCb = document.getElementById("remember-browser");
const recoveryToggle = document.getElementById("recovery-toggle");
const useRecoveryBtn = document.getElementById("use-recovery-btn");
const recoverySection = document.getElementById("recovery-section");
const recoveryCodeInput = document.getElementById("recovery-code");
const recoveryVerifyBtn = document.getElementById("recovery-verify-btn");

// MFA setup elements
const mfaSetupSection = document.getElementById("mfa-setup-section");
const setupQr = document.getElementById("setup-qr");
const setupSecret = document.getElementById("setup-secret");
const showSecretBtn = document.getElementById("show-secret-btn");
const secretText = document.getElementById("secret-text");
const setupRecoveryCodes = document.getElementById("setup-recovery-codes");
const recoveryCodesList = document.getElementById("recovery-codes-list");
const setupCodeInput = document.getElementById("setup-code");
const setupVerifyBtn = document.getElementById("setup-verify-btn");
const setupError = document.getElementById("setup-error");

// Password toggle
togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

// State held in closure for MFA flow
let pendingTempToken = null;
let pendingPassword = "";
let pendingRegistration = false;

(async function loadSsoConfig() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get("ssoError");
    if (ssoError) showError(ssoError);

    const res = await fetch("/api/auth/sso/config");
    if (!res.ok) return;
    const data = await res.json();
    if (!data.enabled || data.provider !== "saml") return;
    const returnTo = params.get("returnTo") || "/";
    const loginPath = data.loginPath || "/api/auth/sso/saml/login";
    ssoLoginBtn.href = `${loginPath}?returnTo=${encodeURIComponent(returnTo)}`;
    ssoLoginBtn.classList.remove("hidden");
    if (data.requireForLogin) {
      emailInput.disabled = true;
      passwordInput.disabled = true;
      keepSignedInCb.disabled = true;
      loginBtn.classList.add("hidden");
    }
  } catch {}
})();

// Login
loginBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Email and password are required");
    return;
  }

  loginBtn.disabled = true;
  loginError.classList.add("hidden");
  pendingPassword = password;
  pendingRegistration = false;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        keepSignedIn: keepSignedInCb.checked,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Login failed");
      return;
    }

    // CASE 1: Direct login success (no MFA or trusted device)
    if (data.success) {
      await finalizeAuthenticatedUser();
      return;
    }

    // CASE 2: MFA required — show TOTP verification
    if (data.mfaRequired) {
      pendingTempToken = data.tempToken;
      loginSection.classList.add("hidden");
      mfaSection.classList.remove("hidden");
      mfaCodeInput.focus();
      if (data.hasRecoveryCodes) {
        recoveryToggle.classList.remove("hidden");
      }
      return;
    }

    // CASE 3: MFA setup required by admin — show forced setup
    if (data.mfaSetupRequired) {
      pendingTempToken = data.tempToken;
      await showForcedMFASetup(password);
      return;
    }

    showError("Unexpected response");
  } catch {
    showError("Network error");
  } finally {
    loginBtn.disabled = false;
  }
});


// MFA verify (TOTP code)
mfaVerifyBtn.addEventListener("click", () => verifyMFA(mfaCodeInput.value));
recoveryVerifyBtn.addEventListener("click", () => verifyMFA(null, recoveryCodeInput.value.trim()));

async function verifyMFA(code, recoveryCode) {
  if (!pendingTempToken) return;

  const btn = recoveryCode ? recoveryVerifyBtn : mfaVerifyBtn;
  btn.disabled = true;
  mfaError.classList.add("hidden");

  try {
    const body = { tempToken: pendingTempToken };
    if (recoveryCode) body.recoveryCode = recoveryCode;
    else body.code = code;
    body.rememberBrowser = rememberBrowserCb.checked;

    const res = await fetch("/api/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.restartLogin) {
        pendingTempToken = null;
        mfaSection.classList.add("hidden");
        loginSection.classList.remove("hidden");
        showError(data.error);
      } else {
        showMFAError(data.error || "Verification failed");
      }
      return;
    }

    pendingTempToken = null;
    await finalizeAuthenticatedUser();
  } catch {
    showMFAError("Network error");
  } finally {
    btn.disabled = false;
  }
}

// Toggle recovery code input
useRecoveryBtn.addEventListener("click", () => {
  recoverySection.classList.remove("hidden");
  recoveryToggle.classList.add("hidden");
  recoveryCodeInput.focus();
});

// Forced MFA setup
async function showForcedMFASetup() {
  if (!pendingTempToken) return;

  loginSection.classList.add("hidden");
  mfaSetupSection.classList.remove("hidden");

  try {
    const res = await fetch("/api/auth/login/mfa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tempToken: pendingTempToken }),
    });

    const data = await res.json();

    if (!res.ok) {
      showSetupError(data.error || "Setup failed");
      return;
    }

    // Render QR code
    if (typeof qrcode !== "undefined") {
      var qr = qrcode(0, "M");
      qr.addData(data.provisioningURI);
      qr.make();
      setupQr.innerHTML = qr.createSvgTag(4);
    }

    secretText.textContent = data.secret;
    const codes = data.recoveryCodes || [];
    recoveryCodesList.innerHTML = codes.map(c => "<div>" + c + "</div>").join("");
    setupRecoveryCodes.classList.remove("hidden");
    setupCodeInput.focus();
  } catch {
    showSetupError("Network error");
  }
}

// Verify forced MFA setup
setupVerifyBtn.addEventListener("click", async () => {
  const code = setupCodeInput.value.trim();
  if (!code || !pendingTempToken) return;

  setupVerifyBtn.disabled = true;
  setupError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/login/mfa/setup/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tempToken: pendingTempToken, code }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.restartLogin) {
        resetPendingAuthState();
        mfaSetupSection.classList.add("hidden");
        loginSection.classList.remove("hidden");
        showError(data.error);
      } else {
        showSetupError(data.error || "Verification failed");
      }
      return;
    }

    pendingTempToken = null;
    await finalizeAuthenticatedUser();
  } catch {
    showSetupError("Network error");
  } finally {
    setupVerifyBtn.disabled = false;
  }
});

// Show manual secret key
showSecretBtn.addEventListener("click", () => {
  setupSecret.classList.remove("hidden");
  showSecretBtn.classList.add("hidden");
});

const storedRegistrationState = loadPendingRegistrationState();
if (storedRegistrationState?.tempToken) {
  pendingTempToken = storedRegistrationState.tempToken;
  pendingPassword = storedRegistrationState.password || "";
  pendingRegistration = true;
  showForcedMFASetup();
}

async function finalizeAuthenticatedUser() {
  try {
    if (pendingRegistration) {
      await initializeNewAccount(pendingPassword);
    } else if (pendingPassword) {
      await restoreKeys(pendingPassword);
    }
  } finally {
    resetPendingAuthState();
  }

  window.location.href = "/";
}

function loadPendingRegistrationState() {
  try {
    const raw = sessionStorage.getItem(REGISTER_MFA_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    sessionStorage.removeItem(REGISTER_MFA_STORAGE_KEY);
    return null;
  }
}

function resetPendingAuthState() {
  pendingTempToken = null;
  pendingPassword = "";
  pendingRegistration = false;
  sessionStorage.removeItem(REGISTER_MFA_STORAGE_KEY);
}

async function initializeNewAccount(password) {
  if (!window.ChatCrypto) {
    console.error("[chat] window.ChatCrypto not available — chat-crypto.js may have failed to load");
    return;
  }

  try {
    const existingBackupRes = await fetch("/api/chat/keys/backup");
    if (existingBackupRes.ok) {
      const existingBackup = await existingBackupRes.json();
      if (existingBackup.encryptedPrivateKey) {
        await restoreKeys(password);
        return;
      }
    }
  } catch (err) {
    console.error("[chat] Unable to check existing backup before initialization:", err);
  }

  try {
    const keyPair = await ChatCrypto.generateKeyPair();
    const backup = await ChatCrypto.encryptPrivateKey(keyPair.privateKey, password);
    if (!backup) throw new Error("encryptPrivateKey returned null");

    const publicKey = await ChatCrypto.exportPublicKey(keyPair.publicKey);
    const keyRes = await fetch("/api/chat/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        encryptedPrivateKey: backup.encryptedPrivateKey,
        privateKeyIv: backup.iv,
        privateKeySalt: backup.salt,
      }),
    });

    if (!keyRes.ok) {
      const errorData = await keyRes.json().catch(() => ({}));
      console.error("[chat] Key upload failed:", keyRes.status, errorData);
      return;
    }

    const meRes = await fetch("/api/auth/me");
    const meData = await meRes.json();
    if (meData.user) {
      await ChatCrypto.storeKeyInIndexedDB(meData.user.id, keyPair.privateKey);
    }
  } catch (err) {
    console.error("[chat] Account initialization failed:", err);
  }
}

// Key restoration (shared between all login paths)
async function restoreKeys(password) {
  // Restore chat private key from server backup
  try {
    if (window.ChatCrypto) {
      const backupRes = await fetch("/api/chat/keys/backup");
      if (backupRes.ok) {
        const backup = await backupRes.json();
        if (backup.encryptedPrivateKey) {
          const privateKey = await ChatCrypto.decryptPrivateKey(
            backup.encryptedPrivateKey, backup.privateKeyIv, backup.privateKeySalt, password
          );
          if (privateKey) {
            const meRes = await fetch("/api/auth/me");
            const meData = await meRes.json();
            if (meData.user) {
              await ChatCrypto.storeKeyInIndexedDB(meData.user.id, privateKey);
            }
          } else {
            console.error("[chat] decryptPrivateKey returned null — backup may be corrupted");
          }
        }
      } else {
        console.log("[chat] No key backup found (first login on new account or no chat keys yet)");
      }
    } else {
      console.error("[chat] window.ChatCrypto not available — chat-crypto.js may have failed to load");
    }
  } catch (err) {
    console.error("[chat] Key restore failed:", err);
  }

  // Restore vault master keys (personal vaults)
  try {
    if (window.VaultKeyStore) {
      const vaultsRes = await fetch("/api/vault/vaults");
      if (vaultsRes.ok) {
        const vaultsData = await vaultsRes.json();
        const personalVaults = (vaultsData.vaults || []).filter(v => v.type === "personal");
        for (const vault of personalVaults) {
          try {
            const mkRes = await fetch(`/api/vault/vaults/${vault.id}/master-key`);
            if (!mkRes.ok) continue;
            const mkData = await mkRes.json();
            const vc = await import("/js/vault-crypto.js");
            const masterKey = await vc.unlockPersonalVault(
              mkData.encryptedMasterKey, mkData.masterKeyIv, mkData.masterKeySalt, password
            );
            if (masterKey) {
              await VaultKeyStore.storeKey(vault.id, masterKey);
            }
          } catch (e) {
            console.error("[vault] Key restore failed for vault", vault.id, e);
          }
        }
      }
    }
  } catch (err) {
    console.error("[vault] Key restore failed:", err);
  }
}

// Enter key support
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });
emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") passwordInput.focus(); });
mfaCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") mfaVerifyBtn.click(); });
recoveryCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") recoveryVerifyBtn.click(); });
setupCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") setupVerifyBtn.click(); });

function showError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

function showMFAError(message) {
  mfaError.textContent = message;
  mfaError.classList.remove("hidden");
}

function showSetupError(message) {
  setupError.textContent = message;
  setupError.classList.remove("hidden");
}
