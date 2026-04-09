// Burger menu — shared across all pages
// All links injected dynamically. Adding a new tool only requires changing TOOL_LINKS below.
// HTML pages only need: <nav id="burger-nav" class="burger-nav hidden"></nav>

const TOOL_LINKS = [
  { href: "/", label: "Home", dividerAfter: true },
  { href: "/paste", label: "RedSecPaste" },
  { href: "/share", label: "RedSecShare" },
  { href: "/chat", label: "RedSecTeam" },
  { href: "/vault", label: "RedSecVault" },
];

// Contextual about links based on current page path
const ABOUT_LINKS = [
  { pathPrefix: "/vault", href: "/vault/about", label: "About this tool" },
  { pathPrefix: "/chat", href: "/chat/about", label: "About this tool" },
  { pathPrefix: "/share", href: "/share/about", label: "About this tool" },
  { pathPrefix: "/paste", href: "/paste/about", label: "About this tool" },
  { pathPrefix: "/p/", href: "/paste/about", label: "About this tool" },
];

export function initBurgerMenu() {
  const btn = document.getElementById("burger-btn");
  const nav = document.getElementById("burger-nav");

  if (!btn || !nav) return;

  // Always inject links (clear any existing static content)
  injectLinks(nav);

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

  // Add auth-aware links after tool links
  addAuthLinks(nav);
}

function injectLinks(nav) {
  let html = "";

  // Standard tool links
  for (const link of TOOL_LINKS) {
    html += `<a href="${link.href}">${link.label}</a>`;
    if (link.dividerAfter) {
      html += `<div class="burger-divider"></div>`;
    }
  }

  // Contextual "About" link for tool pages
  const path = window.location.pathname;
  const aboutMatch = ABOUT_LINKS.find(a => path.startsWith(a.pathPrefix));
  if (aboutMatch) {
    html += `<div class="burger-divider"></div>`;
    html += `<a href="${aboutMatch.href}">${aboutMatch.label}</a>`;
  }

  nav.innerHTML = html;
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
