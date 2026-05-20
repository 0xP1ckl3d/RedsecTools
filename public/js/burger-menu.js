// Burger menu — shared across all pages
// All links injected dynamically. Adding a new tool only requires changing TOOL_LINKS below.
// HTML pages only need: <nav id="burger-nav" class="burger-nav hidden"></nav>

const TOOL_LINKS = [
  { href: "/paste", label: "RedSecPaste" },
  { href: "/share", label: "RedSecShare" },
  { href: "/chat", label: "RedSecTeam" },
  { href: "/vault", label: "RedSecVault" },
  { href: "/calendar", label: "RedSecCal", key: "calendar" },
  { href: "/survey", label: "RedSecSurvey", key: "survey" },
  { href: "/wiki", label: "RedSecWiki", key: "wiki" },
  { href: "/threat", label: "RedSecThreat", key: "threat" },
  { href: "/reporter", label: "RedSecReporter", key: "reporter" },
  { href: "/engage", label: "RedSecEngage", key: "engage" },
  { href: "/minitools", label: "RedSecMiniTools", key: "minitools" },
  { href: "/ai", label: "RedSecAI", aiOnly: true },
];

function brandedLabel(defaultLabel) {
  var prefix = window.siteBrandPrefix;
  if (prefix && prefix !== "RedSec") return defaultLabel.replace(/RedSec/, prefix);
  return defaultLabel;
}

export function initBurgerMenu() {
  const btn = document.getElementById("burger-btn");
  const nav = document.getElementById("burger-nav");

  if (!btn || !nav) return;

  injectLinks(nav, [], { aiEnabled: false });

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

function injectLinks(nav, allowedToolKeys, options = {}) {
  let html = '<a href="/">Home</a>';
  const allowed = new Set(allowedToolKeys || []);
  const visibleTools = TOOL_LINKS.filter((link) => {
    if (link.aiOnly) return !!options.aiEnabled;
    return !link.key || !allowed.size || allowed.has(link.key);
  });

  if (visibleTools.length) {
    html += '<div class="burger-divider"></div>';
    html += '<details class="burger-tools-group">';
    html += '<summary>Tools</summary>';
    html += '<div class="burger-tools-list">';
    for (const link of visibleTools) {
      html += `<a href="${link.href}">${brandedLabel(link.label)}</a>`;
    }
    html += "</div></details>";
  }

  nav.innerHTML = html;
}

async function addAuthLinks(nav) {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    let aiEnabled = false;
    if (data.authenticated && !data.guest) {
      try {
        const aiRes = await fetch("/api/ai/status", { headers: { accept: "application/json" } });
        const aiStatus = await aiRes.json().catch(() => ({}));
        aiEnabled = aiRes.ok && aiStatus.enabled !== false;
      } catch (_) {
        aiEnabled = false;
      }
    }
    injectLinks(nav, (data.availableTools || []).map((tool) => tool.key), { aiEnabled });

    const divider = document.createElement("div");
    divider.className = "burger-divider";

    if (data.authenticated && !data.guest) {
      nav.appendChild(divider.cloneNode());
      const profileLink = document.createElement("a");
      profileLink.href = "/?view=profile";
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

// --- Centralized footer ---
(function initFooter() {
  const TOOL_NAMES = {
    "/": "RedSecTools",
    "/paste": "RedSecPaste",
    "/share": "RedSecShare",
    "/chat": "RedSecTeam",
    "/vault": "RedSecVault",
    "/calendar": "RedSecCal",
    "/wiki": "RedSecWiki",
    "/survey": "RedSecSurvey",
    "/threat": "RedSecThreat",
    "/reporter": "RedSecReporter",
    "/engage": "RedSecEngage",
    "/minitools": "RedSecMiniTools",
    "/ai": "RedSecAI",
  };

  const path = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "") || "/";
  let name = TOOL_NAMES[path];
  if (!name) {
    for (const [prefix, label] of Object.entries(TOOL_NAMES)) {
      if (prefix !== "/" && path.startsWith(prefix)) { name = label; break; }
    }
  }
  if (!name) name = "RedSecTools";

  const year = new Date().getFullYear();
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `&copy; ${year} <a href="/" class="text-accent hover:underline">RedSec</a> Offensive Security &mdash; ${name}`;

  const main = document.querySelector(".dashboard-main") || document.querySelector(".dashboard-content") || document.querySelector(".dashboard-layout");
  if (main) main.appendChild(footer);
})();
