// Synchronous theme detection — runs in <head> to prevent flash
if (localStorage.getItem("theme") === "light") {
  document.documentElement.classList.add("light");
}

// Footer year rendering (waits for DOM)
document.addEventListener("DOMContentLoaded", function () {
  var els = document.querySelectorAll(".current-year");
  for (var i = 0; i < els.length; i++) {
    els[i].textContent = new Date().getFullYear();
  }
});
