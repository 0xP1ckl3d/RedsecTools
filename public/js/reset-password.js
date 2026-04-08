// RedSecTools — Reset password page logic

const resetForm = document.getElementById("reset-form");
const resetSuccess = document.getElementById("reset-success");
const invalidToken = document.getElementById("invalid-token");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");
const togglePwBtn = document.getElementById("toggle-password");
const resetBtn = document.getElementById("reset-btn");
const resetError = document.getElementById("reset-error");

// Extract token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

if (!token) {
  resetForm.classList.add("hidden");
  invalidToken.classList.remove("hidden");
}

// Password toggle
togglePwBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePwBtn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
  togglePwBtn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
});

// Reset
resetBtn.addEventListener("click", async () => {
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!password || !confirmPassword) {
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

  resetBtn.disabled = true;
  resetError.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });

    const data = await res.json();

    if (res.ok) {
      resetForm.classList.add("hidden");
      resetSuccess.classList.remove("hidden");
    } else {
      if (res.status === 400) {
        resetForm.classList.add("hidden");
        invalidToken.classList.remove("hidden");
      } else {
        showError(data.error || "Reset failed");
      }
    }
  } catch {
    showError("Network error");
  } finally {
    resetBtn.disabled = false;
  }
});

confirmPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") resetBtn.click(); });

function showError(message) {
  resetError.textContent = message;
  resetError.classList.remove("hidden");
}
