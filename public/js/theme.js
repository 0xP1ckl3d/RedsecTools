// Shared theme toggle logic
function applyTheme(theme) {
  const html = document.documentElement;
  const darkIcons = document.querySelectorAll(".dark-icon");
  const lightIcons = document.querySelectorAll(".light-icon");

  if (theme === "light") {
    html.classList.add("light");
    darkIcons.forEach((el) => el.classList.add("hidden"));
    lightIcons.forEach((el) => el.classList.remove("hidden"));
  } else {
    html.classList.remove("light");
    darkIcons.forEach((el) => el.classList.remove("hidden"));
    lightIcons.forEach((el) => el.classList.add("hidden"));
  }
}

// Set initial icon state from saved theme
applyTheme(localStorage.getItem("theme") || "dark");

document.querySelectorAll("#theme-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const current = localStorage.getItem("theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
});

import("./redsecai.js?v=20260507-ai-calendar").catch(() => {});
