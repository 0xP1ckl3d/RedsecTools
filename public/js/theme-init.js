// Synchronous theme detection — runs in <head> to prevent flash
if (localStorage.getItem("theme") === "light") {
  document.documentElement.classList.add("light");
}

// Synchronous sidebar state restoration — prevents FOUC on page load
// Pages default to collapsed, so we only need early CSS when user wants expanded
if (localStorage.getItem("sidebar-collapsed") === "false") {
  document.documentElement.classList.add("sidebar-starts-expanded");
}

// Site-wide primary palette. Cache first, then refresh from the server.
(function () {
  var validThemes = { red: true, green: true, blue: true, orange: true, purple: true };

  function applyCustom(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var hr = Math.max(0, Math.round(r * 0.8));
    var hg = Math.max(0, Math.round(g * 0.8));
    var hb = Math.max(0, Math.round(b * 0.8));
    document.documentElement.setAttribute("data-primary-theme", "custom");
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty("--accent-hover", "#" + hr.toString(16).padStart(2,"0") + hg.toString(16).padStart(2,"0") + hb.toString(16).padStart(2,"0"));
    document.documentElement.style.setProperty("--accent-glow", "rgba(" + r + ", " + g + ", " + b + ", 0.25)");
    document.documentElement.style.setProperty("--accent-muted", "rgba(" + r + ", " + g + ", " + b + ", 0.12)");
    document.documentElement.style.setProperty("--selection-bg", "rgba(" + r + ", " + g + ", " + b + ", 0.3)");
  }

  function apply(theme, customHex) {
    if (theme === "custom" && customHex && /^#[0-9A-Fa-f]{6}$/.test(customHex)) {
      applyCustom(customHex);
    } else {
      var next = validThemes[theme] ? theme : "red";
      document.documentElement.setAttribute("data-primary-theme", next);
    }
    try { localStorage.setItem("site-primary-theme", theme); } catch {}
    if (theme === "custom" && customHex) {
      try { localStorage.setItem("site-custom-theme-hex", customHex); } catch {}
    }
  }

  try {
    var cached = localStorage.getItem("site-primary-theme") || "red";
    var cachedHex = localStorage.getItem("site-custom-theme-hex") || "";
    apply(cached, cachedHex);
  } catch { apply("red"); }

  fetch("/api/site-theme", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && data.primaryTheme) apply(data.primaryTheme, data.customHex || "");
    })
    .catch(function () {});
})();

// Brand prefix — each replaceable "RedSec" is wrapped in <span data-bp>RedSec</span>.
// This function simply sets those span textContents. Nothing else is touched.
window.siteBrandPrefix = "RedSec";
window.brandName = function (suffix) { return (window.siteBrandPrefix || "RedSec") + suffix; };

function applyBrandLogo(version) {
  var v = version ? "?v=" + version : "";
  var icon = document.querySelector("link[rel~='icon']");
  if (icon) icon.href = "/brand-logo.webp" + v;

  function insertLogoImg() {
    var spans = document.querySelectorAll("[data-bp]");
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      if (span.getAttribute("data-bp-logo") === "true") continue;
      var img = document.createElement("img");
      img.src = "/brand-logo.webp" + v;
      img.alt = "";
      img.className = "brand-logo-img";
      img.style.cssText = "height:1.5em;width:auto;vertical-align:middle;display:inline;margin-right:0.25rem;";
      span.parentNode.insertBefore(img, span);
      span.setAttribute("data-bp-logo", "true");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", insertLogoImg);
  } else {
    insertLogoImg();
  }
}

function applyBrand(prefix) {
  if (!prefix || prefix === "RedSec") return;
  window.siteBrandPrefix = prefix;

  function doApply() {
    var spans = document.querySelectorAll("[data-bp]");
    for (var i = 0; i < spans.length; i++) spans[i].textContent = prefix;
    var phs = document.querySelectorAll("[data-bp-ph]");
    for (var i = 0; i < phs.length; i++) {
      phs[i].placeholder = phs[i].placeholder.replace(/RedSec/g, prefix);
    }
    if (document.title) document.title = document.title.replace(/RedSec(?=[A-Z])/g, prefix);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", doApply);
  } else {
    doApply();
  }
}

// Apply cached brand immediately to prevent flash
try {
  var cachedBrand = localStorage.getItem("site-brand-prefix");
  if (cachedBrand && cachedBrand !== "RedSec") applyBrand(cachedBrand);
} catch {}

// Apply cached logo state immediately to prevent flash
try {
  if (localStorage.getItem("site-brand-logo") === "true") {
    applyBrandLogo(localStorage.getItem("site-brand-logo-version") || "");
  }
} catch {}

// Refresh from server — reload if brand changed so DOM is fresh
fetch("/api/site-theme", { credentials: "same-origin" })
  .then(function (res) { return res.ok ? res.json() : null; })
  .then(function (data) {
    var server = (data && data.brandPrefix && data.brandPrefix !== "RedSec") ? data.brandPrefix : "";
    var cached = "";
    try { cached = localStorage.getItem("site-brand-prefix") || ""; } catch {}

    var serverLogo = !!(data && data.hasBrandLogo);
    var cachedLogo = "";
    try { cachedLogo = localStorage.getItem("site-brand-logo") || ""; } catch {}

    var serverVersion = (data && data.brandLogoVersion) || "";
    var cachedVersion = "";
    try { cachedVersion = localStorage.getItem("site-brand-logo-version") || ""; } catch {}

    var brandChanged = server !== cached;
    var logoChanged = String(serverLogo) !== cachedLogo || (serverLogo && serverVersion !== cachedVersion);

    if (server) { try { localStorage.setItem("site-brand-prefix", server); } catch {} }
    else { try { localStorage.removeItem("site-brand-prefix"); } catch {} }
    try { localStorage.setItem("site-brand-logo", String(serverLogo)); } catch {}
    try { localStorage.setItem("site-brand-logo-version", serverVersion); } catch {}

    if (brandChanged || logoChanged) {
      location.reload();
    } else if (serverLogo) {
      applyBrandLogo(serverVersion);
    }
  })
  .catch(function () {});

// Footer year rendering (waits for DOM)
document.addEventListener("DOMContentLoaded", function () {
  var els = document.querySelectorAll(".current-year");
  for (var i = 0; i < els.length; i++) {
    els[i].textContent = new Date().getFullYear();
  }
});

// Sidebar state persistence + collapsed tooltips
document.addEventListener("DOMContentLoaded", function () {
  var collapsed = localStorage.getItem("sidebar-collapsed") === "true";

  // Apply stored state to sidebar (remove the pre-FOUC class, set actual state)
  document.documentElement.classList.remove("sidebar-starts-expanded");
  var sidebars = document.querySelectorAll(".dashboard-sidebar");
  sidebars.forEach(function (sidebar) {
    if (collapsed) sidebar.classList.add("collapsed");
    else sidebar.classList.remove("collapsed");
  });

  // Set data-tooltip on nav items and link toggles from their text labels
  document.querySelectorAll(".dashboard-sidebar .sidebar-nav-item").forEach(function (item) {
    var text = item.querySelector(".sidebar-nav-text");
    if (text) item.setAttribute("data-tooltip", text.textContent.trim());
  });
  document.querySelectorAll(".dashboard-sidebar .sidebar-links-toggle").forEach(function (toggle) {
    var title = toggle.querySelector(".sidebar-links-title");
    if (title) toggle.setAttribute("data-tooltip", title.textContent.trim());
  });

  // Intercept ALL sidebar collapse button clicks to persist state
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".sidebar-collapse-btn, [data-tool-sidebar-toggle]");
    if (!btn) return;

    // Find the target sidebar
    var sidebar = null;
    var targetId = btn.getAttribute("data-tool-sidebar-toggle");
    if (targetId) {
      sidebar = document.getElementById(targetId);
    } else {
      sidebar = btn.closest(".dashboard-sidebar");
    }
    if (!sidebar) return;

    // Toggle will be handled by the page's own handler — we just persist
    // Use requestAnimationFrame to read the state AFTER the toggle
    requestAnimationFrame(function () {
      var isNowCollapsed = sidebar.classList.contains("collapsed");
      try { localStorage.setItem("sidebar-collapsed", isNowCollapsed ? "true" : "false"); } catch {}
    });
  });
});
