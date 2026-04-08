// Burger menu — shared across all pages
// Each page includes the burger HTML in its header; this module wires up behavior.

export function initBurgerMenu() {
  const btn = document.getElementById("burger-btn");
  const nav = document.getElementById("burger-nav");

  if (!btn || !nav) return;

  // Set contextual "About" link based on current path
  const aboutLink = document.getElementById("burger-about");
  if (aboutLink) {
    const path = window.location.pathname;
    if (path.startsWith("/share")) {
      aboutLink.href = "/share/about";
    } else if (path.startsWith("/p/") || path.startsWith("/paste")) {
      aboutLink.href = "/paste/about";
    } else {
      aboutLink.href = "/paste/about";
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !nav.classList.contains("hidden");
    nav.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      nav.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  // Add auth-aware links
  addAuthLinks(nav);
}

async function addAuthLinks(nav) {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();

    const divider = document.createElement("div");
    divider.className = "burger-divider";

    if (data.authenticated && !data.guest) {
      nav.appendChild(divider.cloneNode());
      const profileLink = document.createElement("a");
      profileLink.href = "/profile";
      profileLink.textContent = `Profile (${data.user.username})`;
      nav.appendChild(profileLink);

      const adminLink = document.createElement("a");
      adminLink.href = "/admin";
      adminLink.textContent = "Admin Panel";
      nav.appendChild(adminLink);

      const logoutLink = document.createElement("a");
      logoutLink.href = "#";
      logoutLink.textContent = "Logout";
      logoutLink.addEventListener("click", async (e) => {
        e.preventDefault();
        // Clear chat private key from IndexedDB
        try {
          if (window.ChatCrypto && data.user) {
            await ChatCrypto.removeKeyFromIndexedDB(data.user.id);
          }
        } catch (err) {
          console.error("[chat] Failed to clear IndexedDB key on logout:", err);
        }
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.reload();
      });
      nav.appendChild(logoutLink);
    } else if (data.guest) {
      // Guest users — show limited info, no profile access
      nav.appendChild(divider.cloneNode());
      const guestNote = document.createElement("span");
      guestNote.className = "text-muted text-sm px-3";
      guestNote.textContent = `Guest (by ${data.invitedBy})`;
      nav.appendChild(guestNote);
    } else {
      nav.appendChild(divider.cloneNode());
      const loginLink = document.createElement("a");
      loginLink.href = "/login";
      loginLink.textContent = "Login";
      nav.appendChild(loginLink);
    }
  } catch {
    // Not logged in — add login link
    const divider = document.createElement("div");
    divider.className = "burger-divider";
    nav.appendChild(divider);
    const loginLink = document.createElement("a");
    loginLink.href = "/login";
    loginLink.textContent = "Login";
    nav.appendChild(loginLink);
  }
}

// Auto-initialize when loaded as standalone module
initBurgerMenu();
