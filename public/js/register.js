// RedSecTools — Register page logic

const registerForm = document.getElementById("register-form");
const invalidToken = document.getElementById("invalid-token");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");
const togglePwBtn = document.getElementById("toggle-password");
const registerBtn = document.getElementById("register-btn");
const registerError = document.getElementById("register-error");

// Extract token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

if (!token) {
  registerForm.classList.add("hidden");
  invalidToken.classList.remove("hidden");
}

// Password toggle
togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

// Register
registerBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!username || !password || !confirmPassword) {
    showError("All fields are required");
    return;
  }

  if (password !== confirmPassword) {
    showError("Passwords do not match");
    return;
  }

  if (password.length < 12) {
    showError("Password must be at least 12 characters");
    return;
  }

  registerBtn.disabled = true;
  registerError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username, password }),
    });

    const data = await res.json();

    if (res.ok) {
      // Generate RSA key pair for chat, encrypt backup with password, upload
      try {
        if (window.ChatCrypto) {
          console.log("[chat] Generating RSA key pair...");
          const keyPair = await ChatCrypto.generateKeyPair();
          console.log("[chat] Key pair generated, encrypting backup...");
          const backup = await ChatCrypto.encryptPrivateKey(keyPair.privateKey, password);
          if (!backup) throw new Error("encryptPrivateKey returned null");
          const publicKeyB64 = await ChatCrypto.exportPublicKey(keyPair.publicKey);
          console.log("[chat] Uploading public key + encrypted backup...");

          const keyRes = await fetch("/api/chat/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              publicKey: publicKeyB64,
              encryptedPrivateKey: backup.encryptedPrivateKey,
              privateKeyIv: backup.iv,
              privateKeySalt: backup.salt,
            }),
          });

          if (keyRes.ok) {
            console.log("[chat] Key upload successful");
          } else {
            const keyErr = await keyRes.json();
            console.error("[chat] Key upload failed:", keyRes.status, keyErr);
          }

          const meRes = await fetch("/api/auth/me");
          const meData = await meRes.json();
          if (meData.user) {
            await ChatCrypto.storeKeyInIndexedDB(meData.user.id, keyPair.privateKey);
            console.log("[chat] Private key stored in IndexedDB");
          }
        } else {
          console.error("[chat] window.ChatCrypto not available — chat-crypto.js may have failed to load");
        }
      } catch (err) {
        console.error("[chat] Key generation/upload failed:", err);
      }
      window.location.href = "/";
    } else {
      showError(data.error || "Registration failed");
    }
  } catch {
    showError("Network error");
  } finally {
    registerBtn.disabled = false;
  }
});

// Enter key support
confirmPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") registerBtn.click(); });

function showError(message) {
  registerError.textContent = message;
  registerError.classList.remove("hidden");
}
