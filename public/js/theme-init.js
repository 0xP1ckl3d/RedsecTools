// Synchronous theme detection — runs in <head> to prevent flash
if (localStorage.getItem("theme") === "light") {
  document.documentElement.classList.add("light");
}

// Site-wide primary palette. Cache first, then refresh from the server.
(function () {
  var validThemes = { red: true, green: true, blue: true, orange: true, purple: true };
  function apply(theme) {
    var next = validThemes[theme] ? theme : "red";
    document.documentElement.setAttribute("data-primary-theme", next);
    try { localStorage.setItem("site-primary-theme", next); } catch {}
  }
  try { apply(localStorage.getItem("site-primary-theme") || "red"); } catch { apply("red"); }
  fetch("/api/site-theme", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { if (data && data.primaryTheme) apply(data.primaryTheme); })
    .catch(function () {});
})();

// Footer year rendering (waits for DOM)
document.addEventListener("DOMContentLoaded", function () {
  var els = document.querySelectorAll(".current-year");
  for (var i = 0; i < els.length; i++) {
    els[i].textContent = new Date().getFullYear();
  }
});
