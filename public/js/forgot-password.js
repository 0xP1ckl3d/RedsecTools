// RedSecTools — Forgot password page logic

const emailInput = document.getElementById("email");
const requestBtn = document.getElementById("request-btn");
const requestError = document.getElementById("request-error");
const requestSuccess = document.getElementById("request-success");

requestBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showError("Please enter your email address");
    return;
  }

  requestBtn.disabled = true;
  requestError.classList.add("hidden");
  requestSuccess.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Always show success to prevent email enumeration
    requestSuccess.textContent = "If an account exists with that email, a reset link has been sent.";
    requestSuccess.classList.remove("hidden");
    emailInput.value = "";
  } catch {
    showError("Network error. Please try again.");
  } finally {
    requestBtn.disabled = false;
  }
});

emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") requestBtn.click();
});

function showError(message) {
  requestError.textContent = message;
  requestError.classList.remove("hidden");
}
