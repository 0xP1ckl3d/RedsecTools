// RedSecTools — Login page logic

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePwBtn = document.getElementById("toggle-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");

// Password toggle
togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

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

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (res.ok) {
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
      window.location.href = "/";
    } else {
      showError(data.error || "Login failed");
    }
  } catch {
    showError("Network error");
  } finally {
    loginBtn.disabled = false;
  }
});

// Enter key support
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });
emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") passwordInput.focus(); });

function showError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}
